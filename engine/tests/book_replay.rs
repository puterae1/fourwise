//! Sample-replay verification: gate #2's write/read-boundary evidence
//! (owner ruling 2, `docs/STATUS.md`). The risk this file exists to catch
//! is NOT "does the solver compute the right score" -- that is already
//! fixture-proven in `reference.rs` -- it is "did the book's binary
//! serialisation, mirror canonicalisation, and this crate's independent
//! read-side implementation of that canonicalisation, all agree with each
//! other at the write/read boundary". So every check here goes through the
//! REAL `book::Book::load` reading REAL book bytes from disk, and
//! recomputes each sample entry's canonical key INDEPENDENTLY of the
//! JSON's own recorded `key` field -- via `Position::from_moves` plus a
//! SEPARATE re-derivation of mirror-canonicalisation that operates on move
//! strings (column-digit remapping), not on `book::mirror_key`'s raw bit
//! shuffling. Two independently-implemented paths agreeing is the actual
//! evidence; reusing `book.rs`'s own (private) mirror arithmetic here
//! would just be checking the loader against itself.
//!
//! ## Two artifact sets
//!
//! - **Rehearsal** (`book_rehearsal_v1.bin` / `book_rehearsal_sample_v1.
//!   json`, committed fixtures): generated in this wave via
//!   `cargo run --release --bin gen_book -- --depth 8 --max-positions 300
//!   --tt-mb 1024 --threads 10 --seed 42`, proving the whole mechanism
//!   end-to-end before the real depth-8 artifacts exist. The REPLAY half
//!   (JSON parsing, independent key recomputation, loader lookup -- no
//!   search at all) is fast regardless of build profile and runs
//!   un-ignored. The RESOLVE half (fresh-`Solver`-per-entry re-solves)
//!   is genuinely slow even for "a handful" of entries: every entry this
//!   generator produced landed at ply 8 (see this file's
//!   `deterministic_indices` doc comment for why), which is deep enough
//!   that a cold, debug-mode solve is minutes-to-untenable (the exact
//!   reason `reference.rs` ignores its own Begin-tier, ply<=14, fixture
//!   sets) -- so, consistent with that established convention, the
//!   resolve half is `#[ignore]`d and release-mode-intended, not run by
//!   plain `cargo test`.
//! - **Production** (`web/public/book.bin` / `book_sample_v1.json`, not
//!   yet generated as of this wave -- the real depth-8 run is a detached,
//!   multi-hour process on the owner's machine, `docs/STATUS.md`): a
//!   `#[ignore]`d test that FAILS LOUDLY with an "artifact missing"
//!   message if invoked before those files exist, per this wave's
//!   instruction -- never a silent skip-pass.

use connect4_engine::book::Book;
use connect4_engine::position::Position;
use connect4_engine::solver::Solver;

// ---------------------------------------------------------------------
// Minimal hand-rolled JSON reader.
//
// Zero new dependencies (this crate has no `serde_json`, by design -- see
// `tools/gen_book.rs`'s own hand-rolled JSON writer). This is a small,
// general-enough recursive-descent parser for the schema `docs/ENGINE.md`
// documents (`{"version","depth","seed","count","entries":[{"moves",
// "key","score"}, ...]}`) -- ASCII only (move-digit strings and small
// integers never need escapes or non-ASCII), but otherwise not special-
// cased to one exact byte layout, so it tolerates ordinary whitespace/
// formatting variation rather than assuming gen_book's writer emits one
// specific byte-for-byte layout.
// ---------------------------------------------------------------------

#[derive(Debug, Clone)]
enum Json {
    Number(f64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    fn get(&self, key: &str) -> &Json {
        match self {
            Json::Object(fields) => fields
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v)
                .unwrap_or_else(|| panic!("JSON object missing field {key:?}")),
            other => panic!("expected an object looking for {key:?}, got {other:?}"),
        }
    }

    fn as_array(&self) -> &[Json] {
        match self {
            Json::Array(items) => items,
            other => panic!("expected an array, got {other:?}"),
        }
    }

    fn as_str(&self) -> &str {
        match self {
            Json::String(s) => s,
            other => panic!("expected a string, got {other:?}"),
        }
    }

    fn as_i64(&self) -> i64 {
        match self {
            Json::Number(n) => *n as i64,
            other => panic!("expected a number, got {other:?}"),
        }
    }
}

struct JsonParser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn new(s: &'a str) -> Self {
        JsonParser {
            bytes: s.as_bytes(),
            pos: 0,
        }
    }

    fn skip_ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn expect_byte(&mut self, c: u8) {
        assert_eq!(
            self.peek(),
            Some(c),
            "expected {:?} at byte offset {} of the JSON text",
            c as char,
            self.pos
        );
        self.pos += 1;
    }

    fn expect_literal(&mut self, lit: &str) {
        for c in lit.bytes() {
            self.expect_byte(c);
        }
    }

    fn parse_value(&mut self) -> Json {
        self.skip_ws();
        match self.peek() {
            Some(b'{') => self.parse_object(),
            Some(b'[') => self.parse_array(),
            Some(b'"') => Json::String(self.parse_string()),
            Some(b't') => {
                self.expect_literal("true");
                Json::Number(1.0)
            }
            Some(b'f') => {
                self.expect_literal("false");
                Json::Number(0.0)
            }
            Some(b'n') => {
                self.expect_literal("null");
                Json::Number(0.0)
            }
            _ => self.parse_number(),
        }
    }

    fn parse_object(&mut self) -> Json {
        self.expect_byte(b'{');
        let mut fields = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Json::Object(fields);
        }
        loop {
            self.skip_ws();
            let key = self.parse_string();
            self.skip_ws();
            self.expect_byte(b':');
            let value = self.parse_value();
            fields.push((key, value));
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    break;
                }
                other => panic!("unexpected byte {other:?} in JSON object at offset {}", self.pos),
            }
        }
        Json::Object(fields)
    }

    fn parse_array(&mut self) -> Json {
        self.expect_byte(b'[');
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Json::Array(items);
        }
        loop {
            items.push(self.parse_value());
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    break;
                }
                other => panic!("unexpected byte {other:?} in JSON array at offset {}", self.pos),
            }
        }
        Json::Array(items)
    }

    fn parse_string(&mut self) -> String {
        self.skip_ws();
        self.expect_byte(b'"');
        let mut s = String::new();
        loop {
            let c = self.peek().expect("unterminated JSON string");
            self.pos += 1;
            match c {
                b'"' => break,
                b'\\' => {
                    let esc = self.peek().expect("unterminated JSON escape");
                    self.pos += 1;
                    match esc {
                        b'"' => s.push('"'),
                        b'\\' => s.push('\\'),
                        b'/' => s.push('/'),
                        b'n' => s.push('\n'),
                        b't' => s.push('\t'),
                        b'r' => s.push('\r'),
                        other => panic!("unsupported JSON escape \\{}", other as char),
                    }
                }
                _ => s.push(c as char),
            }
        }
        s
    }

    fn parse_number(&mut self) -> Json {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        let text = std::str::from_utf8(&self.bytes[start..self.pos])
            .expect("JSON number bytes should be ASCII digits/-/.");
        Json::Number(text.parse().unwrap_or_else(|e| panic!("bad JSON number {text:?}: {e}")))
    }
}

fn parse_json(text: &str) -> Json {
    let mut parser = JsonParser::new(text);
    let value = parser.parse_value();
    parser.skip_ws();
    assert_eq!(parser.pos, parser.bytes.len(), "trailing bytes after the top-level JSON value");
    value
}

// ---------------------------------------------------------------------
// Sample file model
// ---------------------------------------------------------------------

struct SampleEntry {
    moves: String,
    key: u64,
    score: i32,
}

struct SampleFile {
    entries: Vec<SampleEntry>,
}

fn parse_sample_file(text: &str) -> SampleFile {
    let root = parse_json(text);
    let entries = root
        .get("entries")
        .as_array()
        .iter()
        .map(|entry| SampleEntry {
            moves: entry.get("moves").as_str().to_string(),
            key: entry.get("key").as_i64() as u64,
            score: entry.get("score").as_i64() as i32,
        })
        .collect();
    SampleFile { entries }
}

// ---------------------------------------------------------------------
// Independent canonical-key recomputation.
//
// Deliberately NOT `book::mirror_key` (that function is `pub(crate)`,
// invisible from here anyway, since `tests/` compiles as an external
// crate) -- and deliberately not a re-derivation of its bit-shuffling
// algorithm either. This instead mirrors the MOVE STRING itself (column
// digit `d` <-> `8 - d`, the same technique `reference.rs`'s own
// `a_position_and_its_left_right_mirror_score_identically` test uses) and
// replays it through `Position::from_moves` to get the mirrored key. Two
// structurally different implementations of the same symmetry agreeing is
// what makes this an independent check rather than a restatement of
// `book.rs`'s own arithmetic.
// ---------------------------------------------------------------------

fn mirror_moves(moves: &str) -> String {
    moves
        .chars()
        .map(|c| {
            let d = c.to_digit(10).expect("sample moves are single ASCII digits");
            std::char::from_digit(8 - d, 10).expect("mirrored digit is still 1..=7")
        })
        .collect()
}

fn independent_canonical_key(moves: &str) -> u64 {
    let pos = Position::from_moves(moves).unwrap_or_else(|e| panic!("sample moves {moves:?} invalid: {e}"));
    let mirrored_moves = mirror_moves(moves);
    let mirrored_pos = Position::from_moves(&mirrored_moves)
        .unwrap_or_else(|e| panic!("mirrored sample moves {mirrored_moves:?} invalid: {e}"));
    pos.key().min(mirrored_pos.key())
}

// ---------------------------------------------------------------------
// Deterministic, seeded subset selection (splitmix64 finaliser -- a
// well-known, tiny, dependency-free hash; used only to get a reproducible
// "shuffle" over entry indices, not for any cryptographic purpose).
// ---------------------------------------------------------------------

fn splitmix64(mut x: u64) -> u64 {
    x = x.wrapping_add(0x9E37_79B9_7F4A_7C15);
    let mut z = x;
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^ (z >> 31)
}

/// Indices into `pool` selected deterministically from `seed`, up to
/// `count` of them (fewer if `pool` is smaller). Reproducible across runs
/// -- same `seed` and `pool` always yields the same selection -- without
/// needing a stored/shared RNG state.
fn deterministic_indices(pool_len: usize, count: usize, seed: u64) -> Vec<usize> {
    let mut scored: Vec<(u64, usize)> = (0..pool_len)
        .map(|i| (splitmix64(seed ^ (i as u64)), i))
        .collect();
    scored.sort_unstable_by_key(|&(score, _)| score);
    scored.into_iter().take(count).map(|(_, i)| i).collect()
}

fn fixture_path(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

// ---------------------------------------------------------------------
// Rehearsal: replay (fast, un-ignored) + a handful of re-solves
// (`#[ignore]`d -- see the module doc comment for why).
// ---------------------------------------------------------------------

/// Load the rehearsal book + sample, verify EVERY sample entry: replay
/// its move string, recompute its canonical key independently, assert it
/// against the JSON's own recorded key, then look it up through the REAL
/// loader over the REAL book bytes and assert the score matches. No
/// search happens anywhere in this test -- every check is a table
/// operation -- so this is fast in either build profile and runs
/// un-ignored.
#[test]
fn rehearsal_book_replay_matches_the_real_loader() {
    let book_bytes = std::fs::read(fixture_path("book_rehearsal_v1.bin"))
        .expect("rehearsal book fixture missing -- see this wave's report for how it was generated");
    let book = Book::load(&book_bytes).expect("the committed rehearsal book must be well-formed");

    let sample_text = std::fs::read_to_string(fixture_path("book_rehearsal_sample_v1.json"))
        .expect("rehearsal sample fixture missing");
    let sample = parse_sample_file(&sample_text);
    assert!(
        sample.entries.len() >= 100,
        "expected a substantial rehearsal sample, got {} entries",
        sample.entries.len()
    );

    for entry in &sample.entries {
        let recomputed_key = independent_canonical_key(&entry.moves);
        assert_eq!(
            recomputed_key, entry.key,
            "sample entry {:?}: independently recomputed canonical key does not match the JSON's recorded key",
            entry.moves
        );

        let pos = Position::from_moves(&entry.moves).unwrap();
        let looked_up = book
            .lookup(&pos)
            .unwrap_or_else(|| panic!("sample entry {:?} (key {}) was not found via the real loader", entry.moves, entry.key));
        assert_eq!(
            looked_up, entry.score,
            "sample entry {:?}: loader score does not match the JSON's recorded score",
            entry.moves
        );
    }
}

/// A handful of fresh-`Solver`-per-entry re-solves against the rehearsal
/// book: proves the mechanism ruling 3 requires (independent verification
/// via the RUNTIME solver, not merely internal self-consistency) actually
/// works, end-to-end, before the production artifacts exist.
///
/// `#[ignore]`d and release-mode-intended: every entry this rehearsal
/// book contains landed at ply 8 (all 300 of its `--max-positions`-capped
/// entries did, empirically -- see the module doc comment), which is deep
/// enough that a cold debug-mode solve is exactly the class of fixture
/// `reference.rs` already ignores (`test_l1_r1`/`r2`/`r3`, "at most 14
/// moves played"). Consistent with that established convention rather
/// than inventing a different one for this file.
#[test]
#[ignore = "real search at ply 8; run in release: cargo test --release --test book_replay -- --ignored"]
fn rehearsal_book_resolve_matches_a_handful_of_fresh_solves() {
    let book_bytes = std::fs::read(fixture_path("book_rehearsal_v1.bin")).expect("rehearsal book fixture missing");
    let book = Book::load(&book_bytes).expect("the committed rehearsal book must be well-formed");

    let sample_text = std::fs::read_to_string(fixture_path("book_rehearsal_sample_v1.json"))
        .expect("rehearsal sample fixture missing");
    let sample = parse_sample_file(&sample_text);

    const HANDFUL: usize = 6;
    let indices = deterministic_indices(sample.entries.len(), HANDFUL, 0xC0FF_EE42_u64);
    assert!(!indices.is_empty(), "rehearsal sample must be non-empty to select from");

    for &i in &indices {
        let entry = &sample.entries[i];
        let pos = Position::from_moves(&entry.moves).unwrap();

        // The book's own answer, via the real loader (ground truth this
        // re-solve is checked against).
        let book_score = book
            .lookup(&pos)
            .unwrap_or_else(|| panic!("selected entry {:?} missing from the book", entry.moves));

        // A FRESH solver, zero shared state with the loader or with any
        // other entry's re-solve -- per ruling 3's amendment, this is
        // what makes the check independent rather than merely internally
        // consistent.
        let mut fresh_solver = Solver::new();
        let resolved = fresh_solver.solve(&pos);

        assert_eq!(
            resolved, book_score,
            "entry {:?}: fresh runtime solve ({resolved}) does not match the book's score ({book_score})",
            entry.moves
        );
        assert_eq!(resolved, entry.score, "entry {:?}: fresh solve does not match the JSON's recorded score", entry.moves);
    }
}

// ---------------------------------------------------------------------
// Production: the real depth-8 book/sample, once they exist.
// ---------------------------------------------------------------------

const PRODUCTION_BOOK_PATH_HINT: &str = "web/public/book.bin";
const PRODUCTION_SAMPLE_FIXTURE: &str = "book_sample_v1.json";

fn production_book_path() -> String {
    // `web/public/` lives at the repo root, one level up from `engine/`.
    format!("{}/../web/public/book.bin", env!("CARGO_MANIFEST_DIR"))
}

/// The full gate-#2 evidence run against the REAL depth-8 book: replays
/// every sample entry (same independent-key-recompute + real-loader-
/// lookup protocol as the rehearsal test), then re-solves 200
/// deterministically-seeded entries at ply >= 4 PLUS 5-10 entries at
/// ply <= 3 -- each through a FRESH `Solver::new()`, zero shared state --
/// per the owner's 2026-07-28 amendment recorded in `docs/STATUS.md`.
///
/// The ply<=3 pool is built directly (short move sequences constructed
/// here, looked up in the production book via `Book::lookup`) rather than
/// filtered out of the sample file: canonical positions at ply<=3 are a
/// vanishingly small fraction of the full ~129,498-entry depth-8 book
/// (roughly 0.1%, by a back-of-envelope count of un-deduplicated
/// possibilities), so a 1,000-entry RANDOM sample is not reliably going
/// to contain 5-10 of them -- relying on the sample for this half would
/// make the test's own pass/fail depend on how the random seed happened
/// to land, for the exact "least fixture-covered" tier ruling 3 was
/// written to guarantee coverage of. Documented as a judgement call in
/// this wave's report.
///
/// `#[ignore]`d and release-mode-intended (minutes, deliberately, per the
/// owner's ruling); FAILS LOUDLY -- not a silent skip -- if the
/// production artifacts are absent, so this can never be mistaken for a
/// pass before the real depth-8 run lands.
#[test]
#[ignore = "release-mode gate #2 evidence against the production depth-8 book; run: cargo test --release --test book_replay -- --ignored"]
fn production_book_replay_and_resolve() {
    let book_path = production_book_path();
    let book_bytes = std::fs::read(&book_path).unwrap_or_else(|e| {
        panic!(
            "ARTIFACT MISSING: production book not found at {book_path} ({PRODUCTION_BOOK_PATH_HINT}): {e}. \
             The depth-8 generation run has not completed yet -- see docs/STATUS.md. This is not a pass; \
             it is a loud, deliberate failure so this test can never be mistaken for having verified anything."
        )
    });
    let book = Book::load(&book_bytes)
        .unwrap_or_else(|e| panic!("production book at {book_path} failed to load: {e}"));

    let sample_path = fixture_path(PRODUCTION_SAMPLE_FIXTURE);
    let sample_text = std::fs::read_to_string(&sample_path).unwrap_or_else(|e| {
        panic!(
            "ARTIFACT MISSING: production sample not found at {sample_path}: {e}. \
             The depth-8 generation run writes this file at completion -- see docs/STATUS.md. \
             This is not a pass; it is a loud, deliberate failure."
        )
    });
    let sample = parse_sample_file(&sample_text);
    assert!(
        sample.entries.len() >= 500,
        "expected the production sample to have roughly 1,000 entries, got {}",
        sample.entries.len()
    );

    // --- Replay: every sample entry, independent key recompute + real loader lookup. ---
    for entry in &sample.entries {
        let recomputed_key = independent_canonical_key(&entry.moves);
        assert_eq!(
            recomputed_key, entry.key,
            "sample entry {:?}: independently recomputed canonical key mismatch",
            entry.moves
        );
        let pos = Position::from_moves(&entry.moves).unwrap();
        let looked_up = book
            .lookup(&pos)
            .unwrap_or_else(|| panic!("sample entry {:?} not found via the real loader", entry.moves));
        assert_eq!(looked_up, entry.score, "sample entry {:?}: loader score mismatch", entry.moves);
    }

    // --- Re-solve: 200 seeded entries at ply >= 4, from the sample pool. ---
    let deep_pool: Vec<&SampleEntry> = sample.entries.iter().filter(|e| e.moves.len() >= 4).collect();
    assert!(
        deep_pool.len() >= 200,
        "expected at least 200 sample entries at ply >= 4, got {}",
        deep_pool.len()
    );
    let deep_indices = deterministic_indices(deep_pool.len(), 200, 0x5EED_5EED_u64);
    for &i in &deep_indices {
        let entry = deep_pool[i];
        let pos = Position::from_moves(&entry.moves).unwrap();
        let mut fresh_solver = Solver::new();
        let resolved = fresh_solver.solve(&pos);
        assert_eq!(
            resolved, entry.score,
            "ply>=4 re-solve mismatch for {:?}: fresh solve {resolved} vs book/sample score {}",
            entry.moves, entry.score
        );
    }

    // --- Re-solve: 5-10 entries at ply <= 3, constructed directly and
    // looked up in the production book (see this function's doc comment
    // for why the sample pool is not relied on for this half). ---
    let shallow_moves: Vec<&str> = vec![
        "",
        "4",
        "1",
        "44",
        "41",
        "14",
        "444",
        "123",
    ];
    let mut shallow_checked = 0usize;
    for moves in &shallow_moves {
        let pos = Position::from_moves(moves).unwrap();
        let Some(book_score) = book.lookup(&pos) else {
            // A non-terminal position at ply<=3 should always be in a
            // real depth-8 book; a miss here is worth knowing about, not
            // silently skipping, but is not fatal to this loop trying
            // the rest of the list -- continue and let the final count
            // assertion below catch an unexpectedly small pool.
            continue;
        };
        let mut fresh_solver = Solver::new();
        let resolved = fresh_solver.solve(&pos);
        assert_eq!(
            resolved, book_score,
            "ply<=3 re-solve mismatch for {moves:?}: fresh solve {resolved} vs book score {book_score}"
        );
        shallow_checked += 1;
    }
    assert!(
        (5..=10).contains(&shallow_checked),
        "expected 5-10 ply<=3 entries actually re-solved against the production book, got {shallow_checked}"
    );
}
