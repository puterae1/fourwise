//! Opening-book loader.
//!
//! **Implemented strictly from `docs/ENGINE.md`'s "Book format v1" section
//! alone** -- deliberately without reading `tools/gen_book.rs`'s writer
//! internals (mirror/canonicalisation/serialisation code), per this wave's
//! doc-independence instruction. An independent read-side implementation is
//! what catches write/read-boundary divergence; peeking at the writer would
//! defeat the point. If anything below required a guess the doc did not
//! settle, it is called out in this module's doc comments (and reported to
//! the orchestrator as a doc-sufficiency finding) rather than silently
//! resolved by matching the writer's behaviour.
//!
//! Every failure mode here resolves to `Err(BookError)`, never a panic and
//! never a partial load: `docs/ENGINE.md`'s lookup protocol step 5 requires
//! a corrupt or absent book to behave as a total, silent miss -- callers
//! (`lib.rs`'s `load_book` export) are responsible for turning `Err` into
//! "book absent, fall through to plain search" rather than surfacing it to
//! the user.

use std::fmt;

use crate::position::{Position, HEIGHT, WIDTH};

const MAGIC: [u8; 4] = *b"FWBK";
const SUPPORTED_VERSION: u8 = 1;
/// 4 (magic) + 1 (version) + 1 (depth) + 4 (count), per the binary layout
/// table.
const HEADER_LEN: usize = 10;
const KEY_BYTES: usize = 8;
const SCORE_BYTES: usize = 1;

/// Bits per column field in a `Position::key()` -- `HEIGHT + 1`, named per
/// the doc's own instruction not to reuse `WIDTH` even though they are
/// numerically equal for this board size.
const STRIDE: u32 = HEIGHT + 1;
const COLUMN_FIELD_MASK: u64 = (1 << STRIDE) - 1; // 0x7F

/// Mirror a full `Position::key()` left-right, column by column. An
/// independent re-derivation of the algorithm `docs/ENGINE.md`'s
/// "Canonicalisation rule" section gives verbatim (including the "why this
/// is valid without splitting back into `current`/`mask`" argument) --
/// deliberately not shared code with `tools/gen_book.rs`.
fn mirror_key(key: u64) -> u64 {
    let mut out = 0u64;
    for col in 0..WIDTH {
        let field = (key >> (col * STRIDE)) & COLUMN_FIELD_MASK;
        let mirrored_col = WIDTH - 1 - col;
        out |= field << (mirrored_col * STRIDE);
    }
    out
}

/// `canonical_key(key) = min(key, mirror_key(key))`, exactly as the doc
/// specifies. `pub(crate)` so this module's own `#[cfg(test)]` suite
/// below (and `tactical.rs`, which needs it to plant a book entry under
/// its own test) can exercise it directly on a raw key, without needing a
/// full `Position`. Not `pub`: nothing outside this crate needs raw-key
/// canonicalisation -- `Book::lookup` is the public surface.
pub(crate) fn canonical_key(key: u64) -> u64 {
    key.min(mirror_key(key))
}

/// Why a byte blob failed to parse as a valid v1 book. Never shown to an
/// end user (the loader's whole job is to make a corrupt book behave
/// exactly like an absent one) -- exposed publicly only so callers (the
/// wasm `load_book` export, and this module's own tests) can report *why*
/// a load failed, e.g. for developer-facing diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BookError {
    /// Fewer than 10 bytes: not even a complete header.
    TooShortForHeader,
    /// The first 4 bytes were not ASCII `FWBK`.
    BadMagic,
    /// The version byte was not `1`.
    UnsupportedVersion(u8),
    /// The file is shorter than `10 + count * 8` bytes -- truncated inside
    /// (or before) the keys section.
    TruncatedKeys,
    /// The file is shorter than `10 + count * 9` bytes -- the keys section
    /// parsed fully but the scores section didn't.
    TruncatedScores,
    /// The file is longer than `10 + count * 9` bytes. Not covered
    /// explicitly by ENGINE.md's lookup protocol (a doc-sufficiency
    /// finding, reported alongside this crate's delivery report); treated
    /// as corrupt rather than "extra bytes ignored", since a book that
    /// doesn't match its own declared `count` exactly is not trustworthy
    /// ground truth -- the safer reading of "corrupt file" in step 5.
    TrailingBytes,
    /// The `count` field's implied byte length overflows `usize` (relevant
    /// on the 32-bit `wasm32-unknown-unknown` target, where a maliciously
    /// or corruptly large `count` could otherwise overflow the
    /// `10 + count * 9` arithmetic).
    SizeOverflow,
    /// Keys were not in strictly ascending order (a doc-sufficiency
    /// finding: the doc says "sorted ascending" without saying whether
    /// duplicates are permitted; this loader requires strict ascent,
    /// which also rejects duplicates -- canonical keys are a deduplication
    /// key by construction, so a duplicate can only mean corruption, and
    /// binary search over a sorted-with-duplicates array would be
    /// well-defined but pointlessly ambiguous about which duplicate is
    /// "the" entry).
    KeysNotSortedAscending,
}

impl fmt::Display for BookError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            BookError::TooShortForHeader => write!(f, "file is shorter than the 10-byte header"),
            BookError::BadMagic => write!(f, "magic bytes are not 'FWBK'"),
            BookError::UnsupportedVersion(v) => write!(f, "unsupported book version {v} (expected 1)"),
            BookError::TruncatedKeys => write!(f, "file is truncated inside the keys section"),
            BookError::TruncatedScores => write!(f, "file is truncated inside the scores section"),
            BookError::TrailingBytes => write!(f, "file has trailing bytes beyond the declared entry count"),
            BookError::SizeOverflow => write!(f, "declared entry count overflows the platform's address space"),
            BookError::KeysNotSortedAscending => write!(f, "keys are not strictly ascending"),
        }
    }
}

impl std::error::Error for BookError {}

/// A loaded, validated opening book: a sorted array of canonical keys and
/// a parallel array of scores. Every entry's score is that entry's own
/// position's score, side-to-move POV, exactly as `solver.rs` and every
/// other score in this engine -- no adjustment on lookup, per the doc's
/// "no sign-flip, no move remapping, on a mirror hit" pin.
#[derive(Debug)]
pub struct Book {
    keys: Vec<u64>,
    scores: Vec<i8>,
    depth: u8,
}

impl Book {
    /// Parse and validate a v1 book from raw bytes. Any structural problem
    /// -- short read, bad magic, wrong version, size mismatch, unsorted
    /// keys -- returns `Err` rather than panicking or returning a partial
    /// `Book`. Callers must treat `Err` as "no book" (`docs/ENGINE.md`
    /// lookup protocol step 5), never surface it to the user.
    pub fn load(bytes: &[u8]) -> Result<Book, BookError> {
        if bytes.len() < HEADER_LEN {
            return Err(BookError::TooShortForHeader);
        }
        if bytes[0..4] != MAGIC {
            return Err(BookError::BadMagic);
        }
        let version = bytes[4];
        if version != SUPPORTED_VERSION {
            return Err(BookError::UnsupportedVersion(version));
        }
        let depth = bytes[5];
        let count = u32::from_le_bytes([bytes[6], bytes[7], bytes[8], bytes[9]]) as usize;

        let keys_len = count
            .checked_mul(KEY_BYTES)
            .ok_or(BookError::SizeOverflow)?;
        let keys_start = HEADER_LEN;
        let keys_end = keys_start
            .checked_add(keys_len)
            .ok_or(BookError::SizeOverflow)?;
        if bytes.len() < keys_end {
            return Err(BookError::TruncatedKeys);
        }

        let scores_len = count
            .checked_mul(SCORE_BYTES)
            .ok_or(BookError::SizeOverflow)?;
        let scores_start = keys_end;
        let scores_end = scores_start
            .checked_add(scores_len)
            .ok_or(BookError::SizeOverflow)?;
        if bytes.len() < scores_end {
            return Err(BookError::TruncatedScores);
        }
        if bytes.len() > scores_end {
            return Err(BookError::TrailingBytes);
        }

        let mut keys = Vec::with_capacity(count);
        for i in 0..count {
            let off = keys_start + i * KEY_BYTES;
            let raw: [u8; 8] = bytes[off..off + KEY_BYTES]
                .try_into()
                .expect("slice is exactly KEY_BYTES long by construction");
            keys.push(u64::from_le_bytes(raw));
        }

        // Sorted-ascending validation, per the doc's binary layout table
        // and lookup protocol (binary search requires it): strict ascent,
        // see `BookError::KeysNotSortedAscending`'s doc comment for why
        // this loader treats "not strictly increasing" (including exact
        // duplicates) as corruption rather than tolerating it.
        for w in keys.windows(2) {
            if w[0] >= w[1] {
                return Err(BookError::KeysNotSortedAscending);
            }
        }

        let mut scores = Vec::with_capacity(count);
        for i in 0..count {
            scores.push(bytes[scores_start + i] as i8);
        }

        Ok(Book {
            keys,
            scores,
            depth,
        })
    }

    /// The `--depth` this book was generated to. Metadata / fast-path hint
    /// only, per the doc -- `lookup` uses it to short-circuit a query whose
    /// ply already exceeds it, but a binary-search miss is authoritative
    /// regardless of this value.
    pub fn depth(&self) -> u8 {
        self.depth
    }

    /// Number of entries in the book.
    pub fn len(&self) -> usize {
        self.keys.len()
    }

    /// Whether the book has zero entries (a structurally valid but useless
    /// book -- distinct from "absent", which is `None` one level up).
    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    /// Look up `pos`'s own score, if the book has an entry for it.
    ///
    /// Follows `docs/ENGINE.md`'s lookup protocol exactly: canonicalise via
    /// `min(key, mirror_key(key))` (never search for the raw key directly,
    /// since roughly half of all positions are stored only under their
    /// mirror's key), binary search the sorted key array, and -- the trap
    /// the doc calls out by name -- apply **no sign flip and no move
    /// remapping** on a hit, because mirroring is score-preserving, not
    /// score-negating. `scores[i]` is directly `pos`'s own score.
    pub fn lookup(&self, pos: &Position) -> Option<i32> {
        // Fast-path hint from the doc: a ply beyond the book's generated
        // depth cannot be present, so skip the search entirely. This is an
        // optimisation, not a correctness requirement -- the binary search
        // below would also simply miss -- but the doc calls it out
        // explicitly as part of the protocol (step 3), so it is
        // implemented as its own checkable step rather than folded away.
        if pos.moves() > self.depth as u32 {
            return None;
        }
        let canonical = canonical_key(pos.key());
        self.keys
            .binary_search(&canonical)
            .ok()
            .map(|i| self.scores[i] as i32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------
    // mirror_key / canonical_key
    // -------------------------------------------------------------

    #[test]
    fn mirror_key_is_its_own_inverse() {
        let sample_keys = [0u64, 1, 0x7F, 0x3F_FFFF_FFFF, (1u64 << 49) - 1, 0x1234_5678_9ABC];
        for &k in &sample_keys {
            assert_eq!(mirror_key(mirror_key(k)), k, "mirror_key should be an involution for {k:#x}");
        }
    }

    #[test]
    fn mirror_key_of_a_real_position_matches_the_left_right_mirrored_move_sequence() {
        // Independent cross-check against `Position::key()` for a real
        // (non-symmetric) position, rather than only exercising the raw
        // bit-shuffling in isolation.
        let pos = Position::from_moves("1234").unwrap();
        let mirrored_moves: String = "1234"
            .chars()
            .map(|c| {
                let d = c.to_digit(10).unwrap();
                std::char::from_digit(8 - d, 10).unwrap()
            })
            .collect();
        let mirrored_pos = Position::from_moves(&mirrored_moves).unwrap();
        assert_eq!(mirror_key(pos.key()), mirrored_pos.key());
    }

    #[test]
    fn canonical_key_picks_the_smaller_of_a_key_and_its_mirror() {
        let pos = Position::from_moves("1234").unwrap();
        let key = pos.key();
        let mirror = mirror_key(key);
        assert_eq!(canonical_key(key), key.min(mirror));
        assert_eq!(canonical_key(mirror), key.min(mirror), "canonicalising either side of a mirror pair must agree");
    }

    #[test]
    fn canonical_key_of_a_symmetric_position_is_the_position_itself() {
        // A position with no left-right asymmetry (e.g. the empty board)
        // mirrors to itself; canonicalisation must be a no-op.
        let pos = Position::new();
        assert_eq!(canonical_key(pos.key()), pos.key());
    }

    // -------------------------------------------------------------
    // Binary layout construction helper for tests
    // -------------------------------------------------------------

    /// Build valid v1 book bytes from a list of `(key, score)` pairs,
    /// already assumed sorted and canonical by the caller -- a minimal,
    /// independent writer used ONLY by this test module, not shared with
    /// `tools/gen_book.rs`.
    fn build_book_bytes(depth: u8, entries: &[(u64, i8)]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&MAGIC);
        out.push(SUPPORTED_VERSION);
        out.push(depth);
        out.extend_from_slice(&(entries.len() as u32).to_le_bytes());
        for (key, _) in entries {
            out.extend_from_slice(&key.to_le_bytes());
        }
        for (_, score) in entries {
            out.push(*score as u8);
        }
        out
    }

    #[test]
    fn loads_a_well_formed_minimal_book() {
        let bytes = build_book_bytes(4, &[(10, 1), (20, -2), (30, 0)]);
        let book = Book::load(&bytes).expect("well-formed book should load");
        assert_eq!(book.depth(), 4);
        assert_eq!(book.len(), 3);
        assert!(!book.is_empty());
    }

    #[test]
    fn loads_an_empty_book_with_zero_entries() {
        let bytes = build_book_bytes(0, &[]);
        let book = Book::load(&bytes).expect("a zero-entry book is structurally valid");
        assert_eq!(book.len(), 0);
        assert!(book.is_empty());
    }

    // -------------------------------------------------------------
    // Corrupt-input validation matrix
    // -------------------------------------------------------------

    /// `Book` intentionally derives `Debug` (for `unwrap_err()`'s trait
    /// bound and test failure messages) but not `PartialEq` -- nothing
    /// outside this test module needs to compare two `Book`s for equality
    /// -- so error-path assertions compare `BookError` values directly via
    /// `unwrap_err()`, rather than deriving `PartialEq` on `Book` just to
    /// satisfy `assert_eq!` on the whole `Result`.
    fn assert_book_err(bytes: &[u8], expected: BookError) {
        assert_eq!(Book::load(bytes).unwrap_err(), expected);
    }

    #[test]
    fn rejects_an_empty_file() {
        assert_book_err(&[], BookError::TooShortForHeader);
    }

    #[test]
    fn rejects_a_file_truncated_inside_the_header() {
        let bytes = build_book_bytes(4, &[(10, 1)]);
        for len in 0..HEADER_LEN {
            assert_book_err(&bytes[..len], BookError::TooShortForHeader);
        }
    }

    #[test]
    fn rejects_bad_magic() {
        let mut bytes = build_book_bytes(4, &[(10, 1)]);
        bytes[0] = b'X';
        assert_book_err(&bytes, BookError::BadMagic);
    }

    #[test]
    fn rejects_every_byte_of_a_scrambled_magic() {
        for i in 0..4 {
            let mut bytes = build_book_bytes(4, &[(10, 1)]);
            bytes[i] ^= 0xFF;
            assert_book_err(&bytes, BookError::BadMagic);
        }
    }

    #[test]
    fn rejects_an_unsupported_version() {
        let mut bytes = build_book_bytes(4, &[(10, 1)]);
        bytes[4] = 2;
        assert_book_err(&bytes, BookError::UnsupportedVersion(2));

        let mut bytes = build_book_bytes(4, &[(10, 1)]);
        bytes[4] = 0;
        assert_book_err(&bytes, BookError::UnsupportedVersion(0));
    }

    #[test]
    fn rejects_a_file_truncated_at_every_offset_inside_the_keys_section() {
        let bytes = build_book_bytes(4, &[(10, 1), (20, -2), (30, 3)]);
        let keys_end = HEADER_LEN + 3 * KEY_BYTES;
        for len in HEADER_LEN..keys_end {
            assert_book_err(&bytes[..len], BookError::TruncatedKeys);
        }
    }

    #[test]
    fn rejects_a_file_truncated_at_every_offset_inside_the_scores_section() {
        let bytes = build_book_bytes(4, &[(10, 1), (20, -2), (30, 3)]);
        let keys_end = HEADER_LEN + 3 * KEY_BYTES;
        let scores_end = keys_end + 3;
        for len in keys_end..scores_end {
            assert_book_err(&bytes[..len], BookError::TruncatedScores);
        }
    }

    #[test]
    fn rejects_trailing_bytes_beyond_the_declared_count() {
        let mut bytes = build_book_bytes(4, &[(10, 1), (20, -2)]);
        bytes.push(0xAB);
        assert_book_err(&bytes, BookError::TrailingBytes);
    }

    #[test]
    fn rejects_unsorted_keys() {
        let bytes = build_book_bytes(4, &[(20, 1), (10, -2), (30, 3)]);
        assert_book_err(&bytes, BookError::KeysNotSortedAscending);
    }

    #[test]
    fn rejects_duplicate_keys() {
        let bytes = build_book_bytes(4, &[(10, 1), (10, -2), (30, 3)]);
        assert_book_err(&bytes, BookError::KeysNotSortedAscending);
    }

    #[test]
    fn rejects_a_count_field_whose_implied_size_overflows_usize() {
        // A `count` this large can never be backed by a real in-memory
        // byte slice, but the arithmetic computing its implied length
        // (`count * 8`, `count * 1`) must not itself overflow/panic --
        // this is the concrete risk on the 32-bit wasm32 target, where
        // `usize` is 32 bits, so a `count` near `u32::MAX` overflows a
        // `usize` multiplication by 8 well before any real allocation is
        // attempted.
        let mut bytes = vec![0u8; HEADER_LEN];
        bytes[0..4].copy_from_slice(&MAGIC);
        bytes[4] = SUPPORTED_VERSION;
        bytes[5] = 8;
        bytes[6..10].copy_from_slice(&u32::MAX.to_le_bytes());
        let result = Book::load(&bytes);
        let err = result.err();
        assert!(
            matches!(err, Some(BookError::SizeOverflow) | Some(BookError::TruncatedKeys)),
            "a count implying an unrepresentable or absurd size must error cleanly, got {err:?}"
        );
    }

    #[test]
    fn rejects_random_bytes_without_ever_panicking() {
        // Seeded fuzz loop: a small deterministic xorshift PRNG (no new
        // dependency) feeding `Book::load` a spread of random-length,
        // random-content buffers. The only contract under test is "never
        // panics" -- an occasional false-accept is not being hunted here
        // (random bytes coincidentally passing every structural check,
        // including strict key ordering, is astronomically unlikely, but
        // not the point of this test either way).
        let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
        let mut next = || {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            state
        };
        for _ in 0..2000 {
            let len = (next() % 64) as usize;
            let bytes: Vec<u8> = (0..len).map(|_| (next() % 256) as u8).collect();
            let _ = Book::load(&bytes); // must not panic regardless of outcome
        }
    }

    // -------------------------------------------------------------
    // Lookup semantics
    // -------------------------------------------------------------

    #[test]
    fn lookup_hits_a_position_stored_directly_under_its_own_key() {
        let pos = Position::from_moves("444444").unwrap(); // centre-column stack: mirrors to itself, so key == canonical_key(key)
        let key = pos.key();
        let canon = canonical_key(key);
        let bytes = build_book_bytes(8, &[(canon, 5)]);
        let book = Book::load(&bytes).unwrap();
        assert_eq!(book.lookup(&pos), Some(5));
    }

    #[test]
    fn lookup_hits_a_position_stored_only_under_its_mirror_key_with_no_sign_flip() {
        // "no sign-flip, no move remapping, on a mirror hit" -- the trap
        // ENGINE.md calls out by name. Build a position whose OWN key is
        // the larger of the two (so it is stored only under its mirror's
        // key), and assert the score comes back completely unmodified.
        let pos = Position::from_moves("1234").unwrap();
        let own_key = pos.key();
        let mirror = mirror_key(own_key);
        assert_ne!(own_key, mirror, "test fixture must be genuinely asymmetric");

        // Whichever of the two is smaller is what canonical_key(own_key)
        // resolves to -- store the entry there directly. If `own_key` IS
        // the canonical one, use the *other* fixture position below
        // instead so this test always exercises the "queried key is the
        // larger, non-stored side" path.
        let canon = canonical_key(own_key);
        let (query_pos, stored_score) = if canon == own_key {
            // own_key was already the smaller side; use its mirror
            // sequence instead so the QUERY position is the larger side.
            let mirrored_moves: String = "1234"
                .chars()
                .map(|c| {
                    let d = c.to_digit(10).unwrap();
                    std::char::from_digit(8 - d, 10).unwrap()
                })
                .collect();
            (Position::from_moves(&mirrored_moves).unwrap(), 7i8)
        } else {
            (pos, 7i8)
        };

        assert_ne!(
            canonical_key(query_pos.key()),
            query_pos.key(),
            "query position must be the larger (non-canonical) side of its mirror pair"
        );

        let bytes = build_book_bytes(8, &[(canonical_key(query_pos.key()), stored_score)]);
        let book = Book::load(&bytes).unwrap();
        assert_eq!(
            book.lookup(&query_pos),
            Some(stored_score as i32),
            "a mirror-hit must return the stored score completely unmodified -- no negation"
        );
    }

    #[test]
    fn lookup_misses_a_position_not_present_in_the_book() {
        let bytes = build_book_bytes(8, &[(1, 1), (2, 2)]);
        let book = Book::load(&bytes).unwrap();
        let pos = Position::from_moves("444444").unwrap();
        // Vanishingly unlikely to collide with keys 1 or 2; if it ever
        // does, this assertion catches it rather than silently no-op-ing.
        assert_ne!(canonical_key(pos.key()), 1);
        assert_ne!(canonical_key(pos.key()), 2);
        assert_eq!(book.lookup(&pos), None);
    }

    #[test]
    fn lookup_misses_a_position_whose_ply_exceeds_the_book_depth() {
        let pos = Position::from_moves("444444").unwrap(); // 6 plies
        let canon = canonical_key(pos.key());
        // Store the entry (so an unbounded search WOULD hit it), but
        // declare the book's depth as less than this position's ply --
        // the fast-path-hint miss must apply regardless.
        let bytes = build_book_bytes(3, &[(canon, 9)]);
        let book = Book::load(&bytes).unwrap();
        assert_eq!(book.lookup(&pos), None);
    }

    #[test]
    fn lookup_on_an_empty_book_always_misses() {
        let bytes = build_book_bytes(8, &[]);
        let book = Book::load(&bytes).unwrap();
        let pos = Position::from_moves("444").unwrap();
        assert_eq!(book.lookup(&pos), None);
    }
}
