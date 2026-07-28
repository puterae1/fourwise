//! Opening-book generator. Enumerates every reachable, non-terminal
//! `Position` at ply 0 through `--depth` (inclusive), solves each exactly
//! with the shared negamax `Solver`, mirror-deduplicates, and writes the
//! binary format documented in `docs/ENGINE.md`'s "Book format v1" section
//! -- that section is the authority on the file layout and the
//! canonicalisation (mirror) rule; this file implements it, not the other
//! way round.
//!
//! Wired as a `[[bin]]` target of the `connect4_engine` package (see
//! `engine/Cargo.toml`) but the source stays at `tools/gen_book.rs` per the
//! repo layout, so this compiles as a *separate* crate from the library --
//! only the library's genuinely `pub` surface (`Position`, `Solver`,
//! `TranspositionTable`, `WIDTH`, `HEIGHT`) is visible here, the same
//! constraint `engine/tests/*.rs` already lives under. Anything this file
//! needs that isn't `pub` (in particular: "did the move just played
//! complete a four-in-a-row", since `Position::current`/`mask` are
//! `pub(crate)`) is reimplemented independently below -- the same
//! independent-oracle pattern `engine/tests/reference.rs`'s `Grid` uses for
//! exactly the same reason.
//!
//! ## CLI
//!
//! ```text
//! gen_book --depth 8 --out book.bin --tt-mb 4096 --verify-sample 1000 \
//!          --seed 42 --threads N --max-positions N --sample-out PATH [--resume]
//! ```
//!
//! See `Args::parse` for defaults. `--tt-mb` sizes ONE `SharedTranspositionTable`
//! (Wave 7.1: shared, lock-free, across every worker thread -- see
//! `solve_parallel` and `connect4_engine::tt::SharedTranspositionTable`'s doc
//! comment for the concurrency design and safety argument) that is reused
//! across every position solved this run (deepest ply first, so shallower
//! positions inherit a warm table -- see `solve_order`).
//!
//! `--threads` (default: `std::thread::available_parallelism()`) sizes the
//! worker pool. Every thread runs its own `Solver` but all of them share the
//! one `SharedTranspositionTable`, which is the entire point of
//! parallelising this way rather than giving each thread an isolated table:
//! isolated tables would throw away the cross-position warming that makes
//! later (shallower) solves in the run cheap.
//!
//! `--max-positions N` solves only the first `N` positions of the
//! deterministic solve order (see `solve_order`), regardless of `--threads`
//! -- the same fixed key SET is handed to the worker pool either way, just
//! distributed across however many threads are running. This exists so a
//! serial (`--threads 1`) and a parallel (`--threads N`) run over the same
//! `--max-positions` value can be diffed byte-for-byte as a correctness
//! check on parallelism itself, without paying for a full run. See
//! `solve_parallel`'s doc comment for why this determinism holds.
//!
//! `--sample-out` overrides where the verification-sample JSON is written
//! (default: `engine/tests/fixtures/book_sample_v1.json`, resolved via
//! `CARGO_MANIFEST_DIR`). Exists so evidence/test runs never clobber the
//! real fixture path.
//!
//! ## Resumability
//!
//! Every solved `(canonical key, score)` pair is appended, flushed, to a
//! `<out>.checkpoint` text log as soon as it is known -- so a `kill -9`
//! mid-run loses at most whatever was in flight across all worker threads
//! at that instant, never anything already written. `--resume` reloads that
//! log and skips re-solving anything it already contains; without
//! `--resume` a fresh run truncates any stale checkpoint first. Concurrent
//! writers share one `BufWriter` behind one `Mutex` (see `solve_parallel`'s
//! `SolveState`), so every checkpoint line is written and flushed as a
//! single, indivisible critical section -- lines from different threads can
//! never interleave or tear, only interleave *between* whole lines. The
//! final book is written to a temp file and renamed into place
//! (`write_book`), so a crash during the *final* write can never leave a
//! half-written book at the real output path either.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::{self, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use connect4_engine::position::{Position, HEIGHT, WIDTH};
use connect4_engine::solver::Solver;
use connect4_engine::tt::SharedTranspositionTable;

/// Bits allocated to each column in `Position::key()` -- see
/// `docs/ENGINE.md`'s Representation section. Named separately from
/// `WIDTH` even though both equal 7 for this board size: that is a
/// numeric coincidence of 6-tall/7-wide Connect Four, not an identity.
const STRIDE: u32 = HEIGHT + 1;
const COLUMN_FIELD_MASK: u64 = (1 << STRIDE) - 1;
/// Total playable cells on the board (7 * 6 = 42): a full board.
const TOTAL_CELLS: u32 = WIDTH * HEIGHT;

fn main() {
    let args = Args::parse(std::env::args().skip(1));
    println!(
        "[gen_book] depth={} out={} tt_mb={} verify_sample={} seed={} resume={} threads={} \
         max_positions={:?} sample_out={}",
        args.depth,
        args.out.display(),
        args.tt_mb,
        args.verify_sample,
        args.seed,
        args.resume,
        args.threads,
        args.max_positions,
        args.sample_out.display(),
    );

    let enum_start = Instant::now();
    let layers = enumerate(args.depth);
    let per_ply_counts: Vec<usize> = layers.iter().map(Vec::len).collect();
    let total_raw: usize = per_ply_counts.iter().sum();
    println!(
        "[gen_book] enumeration complete in {:.2}s -- per-ply counts (pre-mirror-dedup): {:?}",
        enum_start.elapsed().as_secs_f64(),
        per_ply_counts
    );

    let canonical = canonicalize(&layers);
    println!(
        "[gen_book] canonicalisation complete: {} unique positions ({} raw before mirror-dedup)",
        canonical.len(),
        total_raw
    );

    let checkpoint_path = checkpoint_path_for(&args.out);
    let scores: HashMap<u64, i8> = if args.resume {
        load_checkpoint(&checkpoint_path)
    } else {
        let _ = fs::remove_file(&checkpoint_path);
        HashMap::new()
    };
    let already_checkpointed = scores.len();

    // `--max-positions` truncates the deterministic solve order itself
    // (before the checkpoint filter below), so the exact same fixed key set
    // is targeted regardless of `--threads` -- see `apply_max_positions`.
    let order = apply_max_positions(solve_order(&canonical), args.max_positions);
    let to_solve: Vec<u64> = order
        .into_iter()
        .filter(|k| !scores.contains_key(k))
        .collect();
    let total_to_solve = to_solve.len();
    println!(
        "[gen_book] {already_checkpointed} positions already checkpointed, {total_to_solve} left to solve"
    );

    let scores = solve_parallel(
        &canonical,
        &to_solve,
        args.tt_mb,
        args.threads,
        scores,
        &checkpoint_path,
        canonical.len(),
    );

    // Entries come from `canonical.keys()` filtered through `scores` (not
    // straight from `scores`) so any stale checkpoint key that isn't part
    // of THIS run's canonical set (e.g. a leftover from a different
    // `--depth`) is silently excluded, exactly as the original serial
    // implementation only ever wrote keys it recognised. Without
    // `--max-positions`, every canonical key must have ended up solved --
    // that invariant is worth checking explicitly rather than silently
    // writing a truncated book.
    let mut entries: Vec<(u64, i8)> = canonical
        .keys()
        .filter_map(|k| scores.get(k).map(|&s| (*k, s)))
        .collect();
    if args.max_positions.is_none() {
        assert_eq!(
            entries.len(),
            canonical.len(),
            "every canonical key must have a score by the time solving is done (full run, no --max-positions)"
        );
    }
    entries.sort_unstable_by_key(|(k, _)| *k);

    write_book(&args.out, args.depth, &entries).unwrap_or_else(|e| {
        panic!("failed to write book to {}: {e}", args.out.display())
    });
    println!(
        "[gen_book] wrote {} entries ({} bytes) to {}",
        entries.len(),
        book_byte_len(entries.len()),
        args.out.display()
    );

    let sample_count = args.verify_sample.min(entries.len());
    let sample = sample_entries(&canonical, &entries, sample_count, args.seed);
    write_sample_json(&args.sample_out, args.depth, args.seed, &sample).unwrap_or_else(|e| {
        panic!("failed to write sample fixture to {}: {e}", args.sample_out.display())
    });
    println!(
        "[gen_book] wrote {} sample entries to {}",
        sample.len(),
        args.sample_out.display()
    );
}

fn log_progress(done: usize, total: usize, canonical_total: usize, elapsed: std::time::Duration) {
    let elapsed_s = elapsed.as_secs_f64().max(0.001);
    let rate = done as f64 / elapsed_s;
    let remaining = total.saturating_sub(done);
    let eta_s = if rate > 0.0 { remaining as f64 / rate } else { f64::INFINITY };
    println!(
        "[gen_book] solved {done}/{total} this run ({canonical_total} total canonical positions) \
         elapsed={elapsed_s:.1}s rate={rate:.2}/s eta={eta_s:.1}s"
    );
}

/// Truncate the deterministic solve order to its first `n` entries (`None`
/// = no limit). Applied BEFORE the checkpoint-skip filter, so
/// `--max-positions` always targets the same fixed prefix of the
/// deterministic order regardless of what has already been checkpointed or
/// how many threads end up solving it.
fn apply_max_positions(mut order: Vec<u64>, max_positions: Option<usize>) -> Vec<u64> {
    if let Some(n) = max_positions {
        order.truncate(n);
    }
    order
}

// ---------------------------------------------------------------------
// Parallel solve loop (Wave 7.1)
// ---------------------------------------------------------------------

/// Everything that must be touched under a single lock while a worker
/// thread reports one solved position: the checkpoint writer (so lines from
/// different threads can never interleave or tear -- only ever appear in
/// some whole-line order), the accumulated scores map (so the final book
/// build sees every solve, from whichever thread produced it), and the
/// progress-line bookkeeping (`done`, `last_progress`).
struct SolveState {
    writer: BufWriter<File>,
    scores: HashMap<u64, i8>,
    done: usize,
    last_progress: Instant,
}

/// Solve every key in `to_solve` using `threads` worker threads sharing one
/// `SharedTranspositionTable`, appending a flushed checkpoint line for each
/// as it completes, and returns `initial_scores` merged with every newly
/// solved `(key, score)`.
///
/// **Determinism (why `--threads 1` and `--threads N` produce the identical
/// resulting map, key for key and score for score):** which KEYS get
/// solved is fixed entirely by `to_solve`, computed once before any thread
/// starts -- `threads` only changes how a shared work-stealing cursor
/// (`next_index`, a plain `AtomicUsize`) hands out indices into that same
/// fixed slice, never which positions exist to be claimed. Each `Solver`'s
/// own answer for a given position is exact and, by construction
/// (`docs/ENGINE.md`'s determinism note; every value inserted into the
/// shared table is a value `negamax` fully proved, never a partial or
/// context-dependent one), independent of what the shared transposition
/// table happens to contain when it runs -- a warm cache makes a solve
/// *faster*, never different. So every thread, in whatever order it
/// happens to run, computes the one true score for whatever key it claims,
/// and the returned `HashMap` (unordered by construction, so insertion
/// order is irrelevant to its final contents) ends up with exactly the same
/// key/score pairs no matter how many threads did the work or how their
/// work interleaved.
fn solve_parallel(
    canonical: &HashMap<u64, CanonicalEntry>,
    to_solve: &[u64],
    tt_mb: usize,
    threads: usize,
    initial_scores: HashMap<u64, i8>,
    checkpoint_path: &Path,
    canonical_total: usize,
) -> HashMap<u64, i8> {
    let threads = threads.max(1);
    let total_to_solve = to_solve.len();
    // Print roughly 100 times over the run, but never less often than every
    // 2000 positions and never so often it floods a `nohup`-redirected log.
    // This is the count-based half of the progress requirement; the
    // time-based half (at least every 60s, so a fresh `nohup` log shows an
    // ETA quickly even before 1% of a huge run is done) is enforced inside
    // the critical section below via `last_progress`.
    let progress_interval = (total_to_solve / 100).clamp(1, 2000);

    let checkpoint_file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(checkpoint_path)
        .unwrap_or_else(|e| panic!("failed to open checkpoint {}: {e}", checkpoint_path.display()));

    let state = Mutex::new(SolveState {
        writer: BufWriter::new(checkpoint_file),
        scores: initial_scores,
        done: 0,
        last_progress: Instant::now(),
    });

    // Wave 7.1's TT strategy: ONE shared, lock-free table (see
    // `connect4_engine::tt::SharedTranspositionTable`'s doc comment for the
    // full safety argument) rather than per-thread tables. Per-thread
    // tables would kill the cross-position warming that makes later
    // (shallower, per `solve_order`) solves cheap; a mutex around a single
    // owned table would kill the parallelism this wave exists to add.
    let tt = Arc::new(SharedTranspositionTable::with_byte_budget(tt_mb * 1024 * 1024));
    let next_index = AtomicUsize::new(0);
    let solve_start = Instant::now();

    thread::scope(|scope| {
        for _ in 0..threads {
            let tt = Arc::clone(&tt);
            let next_index = &next_index;
            let state = &state;
            scope.spawn(move || {
                let mut solver = Solver::with_shared_tt(tt);
                loop {
                    // Work-stealing over a fixed, shared slice: every
                    // thread races to claim the next unclaimed index, so
                    // faster threads (or ones that got a warmer table)
                    // naturally pick up more work, with no static
                    // per-thread partition to go uneven.
                    let i = next_index.fetch_add(1, Ordering::Relaxed);
                    if i >= to_solve.len() {
                        break;
                    }
                    let key = to_solve[i];
                    let entry = canonical
                        .get(&key)
                        .expect("to_solve only ever contains keys present in canonical");
                    let score = solver.solve(&entry.pos);
                    let score_i8 = i8::try_from(score).unwrap_or_else(|_| {
                        panic!("score {score} for key {key:#x} does not fit in i8")
                    });

                    // Small, deliberate critical section: guards the tiny
                    // I/O + hashmap-insert + progress check, never the
                    // solving itself (which happened above, unlocked).
                    let mut st = state.lock().expect("checkpoint/scores mutex poisoned");
                    st.scores.insert(key, score_i8);
                    writeln!(st.writer, "{key:016x} {score}")
                        .expect("failed to append checkpoint line");
                    st.writer
                        .flush()
                        .expect("failed to flush checkpoint (resumability depends on this)");
                    st.done += 1;
                    let done = st.done;
                    let time_for_progress = st.last_progress.elapsed() >= Duration::from_secs(60);
                    if done.is_multiple_of(progress_interval) || done == total_to_solve || time_for_progress {
                        log_progress(done, total_to_solve, canonical_total, solve_start.elapsed());
                        st.last_progress = Instant::now();
                    }
                }
            });
        }
    });

    state
        .into_inner()
        .expect("checkpoint/scores mutex poisoned")
        .scores
}

// ---------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------

struct Args {
    depth: u8,
    out: PathBuf,
    tt_mb: usize,
    verify_sample: usize,
    seed: u64,
    resume: bool,
    threads: usize,
    max_positions: Option<usize>,
    sample_out: PathBuf,
}

impl Args {
    fn parse<I: Iterator<Item = String>>(mut it: I) -> Args {
        let mut depth = 8u8;
        let mut out = PathBuf::from("book.bin");
        let mut tt_mb = 4096usize;
        let mut verify_sample = 1000usize;
        let mut seed = 0u64;
        let mut resume = false;
        let mut threads = default_threads();
        let mut max_positions = None;
        let mut sample_out = default_sample_path();

        while let Some(arg) = it.next() {
            match arg.as_str() {
                "--depth" => depth = expect_value(&mut it, "--depth").parse().expect("--depth must be an integer 0..=255"),
                "--out" => out = PathBuf::from(expect_value(&mut it, "--out")),
                "--tt-mb" => tt_mb = expect_value(&mut it, "--tt-mb").parse().expect("--tt-mb must be a positive integer"),
                "--verify-sample" => {
                    verify_sample = expect_value(&mut it, "--verify-sample")
                        .parse()
                        .expect("--verify-sample must be a non-negative integer")
                }
                "--seed" => seed = expect_value(&mut it, "--seed").parse().expect("--seed must be an unsigned integer"),
                "--resume" => resume = true,
                "--threads" => {
                    threads = expect_value(&mut it, "--threads")
                        .parse()
                        .expect("--threads must be a positive integer")
                }
                "--max-positions" => {
                    max_positions = Some(
                        expect_value(&mut it, "--max-positions")
                            .parse()
                            .expect("--max-positions must be a non-negative integer"),
                    )
                }
                "--sample-out" => sample_out = PathBuf::from(expect_value(&mut it, "--sample-out")),
                other => panic!(
                    "unrecognised argument {other:?}; expected one of \
                     --depth --out --tt-mb --verify-sample --seed --resume \
                     --threads --max-positions --sample-out"
                ),
            }
        }

        Args {
            depth,
            out,
            tt_mb,
            verify_sample,
            seed,
            resume,
            threads,
            max_positions,
            sample_out,
        }
    }
}

fn expect_value<I: Iterator<Item = String>>(it: &mut I, flag: &str) -> String {
    it.next().unwrap_or_else(|| panic!("{flag} requires a value"))
}

/// Default worker thread count: every logical core the OS reports, or `1`
/// if that can't be determined (e.g. a sandboxed environment) -- never `0`.
fn default_threads() -> usize {
    std::thread::available_parallelism()
        .map(std::num::NonZeroUsize::get)
        .unwrap_or(1)
}

/// `engine/tests/fixtures/book_sample_v1.json`, resolved via
/// `CARGO_MANIFEST_DIR` (the `engine/` crate root at build time) so this
/// works regardless of the process's current directory when `cargo run`
/// invokes it.
fn default_sample_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/book_sample_v1.json")
}

// ---------------------------------------------------------------------
// Mirroring / canonicalisation -- docs/ENGINE.md "Book format v1"
// ---------------------------------------------------------------------

/// See `docs/ENGINE.md`'s "Book format v1" section for the derivation:
/// valid to apply directly to a raw `Position::key()` because
/// `current_col + mask_col <= 126 < 128` never carries across a column
/// boundary.
fn mirror_key(key: u64) -> u64 {
    let mut out = 0u64;
    for col in 0..WIDTH {
        let field = (key >> (col * STRIDE)) & COLUMN_FIELD_MASK;
        let mirrored_col = WIDTH - 1 - col;
        out |= field << (mirrored_col * STRIDE);
    }
    out
}

fn canonical_key(key: u64) -> u64 {
    key.min(mirror_key(key))
}

/// Mirror a move-sequence string (1-indexed column digits, as `Position`'s
/// standard notation uses): column `d` (1..=7) maps to `8 - d`. Replaying
/// this reaches exactly the position `mirror_key` would compute from the
/// original sequence's raw key -- asserted directly in this file's tests.
fn mirror_moves(moves: &str) -> String {
    moves
        .chars()
        .map(|c| {
            let d = c.to_digit(10).expect("move sequences are single ASCII digits");
            std::char::from_digit((WIDTH + 1) - d, 10).expect("mirrored digit stays in 1..=7")
        })
        .collect()
}

// ---------------------------------------------------------------------
// Terminal detection -- independent of Position's private bitboards
// ---------------------------------------------------------------------

/// Tracks board state in parallel with a `Position` purely to answer "does
/// playing `col` right now complete a four-in-a-row for the player to
/// move" and nothing else. Deliberately reimplemented rather than reusing
/// `Position`'s own (inaccessible, `pub(crate)`) win detection -- see the
/// module doc comment.
#[derive(Clone, Copy)]
struct TerminalTracker {
    cells: [[Option<bool>; HEIGHT as usize]; WIDTH as usize],
    heights: [usize; WIDTH as usize],
    first_to_move: bool,
}

impl TerminalTracker {
    fn new() -> TerminalTracker {
        TerminalTracker {
            cells: [[None; HEIGHT as usize]; WIDTH as usize],
            heights: [0; WIDTH as usize],
            first_to_move: true,
        }
    }

    /// Would dropping a disc into `col` right now complete a four-in-a-row
    /// for the player about to move? Caller is responsible for having
    /// already checked the column has room.
    fn is_winning_move(&self, col: usize) -> bool {
        let row = self.heights[col];
        let player = self.first_to_move;
        const DIRECTIONS: [(isize, isize); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];
        for (dc, dr) in DIRECTIONS {
            let mut run = 1u32; // the hypothetical disc itself
            for sign in [1isize, -1isize] {
                let mut cc = col as isize + dc * sign;
                let mut rr = row as isize + dr * sign;
                while (0..WIDTH as isize).contains(&cc)
                    && (0..HEIGHT as isize).contains(&rr)
                    && self.cells[cc as usize][rr as usize] == Some(player)
                {
                    run += 1;
                    cc += dc * sign;
                    rr += dr * sign;
                }
            }
            if run >= 4 {
                return true;
            }
        }
        false
    }

    fn play(&mut self, col: usize) {
        let row = self.heights[col];
        self.cells[col][row] = Some(self.first_to_move);
        self.heights[col] += 1;
        self.first_to_move = !self.first_to_move;
    }
}

// ---------------------------------------------------------------------
// Production enumerator
// ---------------------------------------------------------------------

/// One discovered position: its raw (pre-mirror-dedup) key, the `Position`
/// itself, and one move sequence (of possibly several) that reaches it.
type RawEntry = (u64, Position, String);

#[derive(Clone)]
struct Candidate {
    pos: Position,
    tracker: TerminalTracker,
    seq: String,
}

/// Every reachable, non-terminal position at ply 0..=depth, deduplicated by
/// transposition (not yet by mirror -- see `canonicalize`), grouped by ply.
/// A raw position's ply is `pos.moves()`, which is fixed by its stone
/// count regardless of which move order reached it, so a global
/// "seen" set (rather than a per-ply one) is sufficient and correct:
/// no key can recur at a later ply once recorded at an earlier one.
fn enumerate(depth: u8) -> Vec<Vec<RawEntry>> {
    let mut seen: HashSet<u64> = HashSet::new();
    let mut frontier = vec![Candidate {
        pos: Position::new(),
        tracker: TerminalTracker::new(),
        seq: String::new(),
    }];
    let mut layers: Vec<Vec<RawEntry>> = Vec::new();

    for ply in 0..=depth {
        let mut unique: HashMap<u64, Candidate> = HashMap::new();
        for c in frontier {
            let key = c.pos.key();
            if seen.contains(&key) {
                continue;
            }
            unique.entry(key).or_insert(c);
        }
        for key in unique.keys() {
            seen.insert(*key);
        }

        let layer: Vec<RawEntry> = unique
            .iter()
            .map(|(key, c)| (*key, c.pos, c.seq.clone()))
            .collect();
        layers.push(layer);

        if ply == depth {
            break;
        }

        let mut next_frontier = Vec::new();
        for c in unique.into_values() {
            for col in 0..WIDTH {
                if !c.pos.can_play(col) {
                    continue;
                }
                if c.tracker.is_winning_move(col as usize) {
                    // Terminal (a win): the position this move reaches is
                    // excluded from the book, and nothing past it is
                    // reachable through legal play, so do not descend.
                    continue;
                }
                let mut child_pos = c.pos;
                child_pos.play(col);
                if child_pos.moves() == TOTAL_CELLS {
                    // Terminal (a full, drawn board): excluded from the
                    // book for the same reason -- no legal moves remain
                    // from here, so there is nothing to descend into
                    // regardless.
                    continue;
                }
                let mut child_tracker = c.tracker;
                child_tracker.play(col as usize);
                let mut child_seq = c.seq.clone();
                child_seq.push(char::from_digit(col + 1, 10).expect("col + 1 is 1..=7"));
                next_frontier.push(Candidate {
                    pos: child_pos,
                    tracker: child_tracker,
                    seq: child_seq,
                });
            }
        }
        frontier = next_frontier;
    }

    layers
}

/// A canonical (mirror-deduplicated) book entry: `pos.key()` is exactly
/// the canonical key it is stored under, and `seq` reaches that exact
/// position (not merely a mirror-equivalent one) -- required so Wave 8's
/// sample-replay test recomputes the same key independently.
struct CanonicalEntry {
    pos: Position,
    seq: String,
    ply: u8,
}

fn canonicalize(layers: &[Vec<RawEntry>]) -> HashMap<u64, CanonicalEntry> {
    let mut map: HashMap<u64, CanonicalEntry> = HashMap::new();
    for (ply, layer) in layers.iter().enumerate() {
        for (key, pos, seq) in layer {
            let canon = canonical_key(*key);
            map.entry(canon).or_insert_with(|| {
                if *key == canon {
                    CanonicalEntry { pos: *pos, seq: seq.clone(), ply: ply as u8 }
                } else {
                    // The canonical side is this position's mirror, which
                    // this branch of enumeration never actually visited
                    // (it visited `key`, not `mirror_key(key)`). Rebuild it
                    // by mirroring the move sequence and replaying -- see
                    // docs/ENGINE.md for why this reaches exactly
                    // `canonical_key(key)`.
                    let mirrored_seq = mirror_moves(seq);
                    let mirrored_pos = Position::from_moves(&mirrored_seq)
                        .expect("mirroring a valid move sequence must remain valid");
                    debug_assert_eq!(
                        mirrored_pos.key(),
                        canon,
                        "mirror_key(key) must match replaying the mirrored move sequence"
                    );
                    CanonicalEntry { pos: mirrored_pos, seq: mirrored_seq, ply: ply as u8 }
                }
            });
        }
    }
    map
}

/// Deepest-ply-first, so shallower (and generally more expensive, per
/// `docs/ENGINE.md`'s empty-board measurement) positions are solved last,
/// against a transposition table already warmed by every deeper position
/// solved so far. Ties within a ply are broken by key purely for
/// deterministic, reproducible progress logs across runs.
fn solve_order(canonical: &HashMap<u64, CanonicalEntry>) -> Vec<u64> {
    let mut order: Vec<u64> = canonical.keys().copied().collect();
    order.sort_unstable_by_key(|k| (std::cmp::Reverse(canonical[k].ply), *k));
    order
}

// ---------------------------------------------------------------------
// Checkpointing
// ---------------------------------------------------------------------

fn checkpoint_path_for(out: &Path) -> PathBuf {
    PathBuf::from(format!("{}.checkpoint", out.display()))
}

/// Parses whatever lines are well-formed and silently skips the rest --
/// deliberately tolerant of a checkpoint file truncated mid-line by a
/// `kill -9` exactly while a line was being written (the write it wrote
/// mid-flush is lost, not corrupting anything else; that lost entry is
/// simply re-solved on resume).
fn load_checkpoint(path: &Path) -> HashMap<u64, i8> {
    let mut map = HashMap::new();
    let Ok(contents) = fs::read_to_string(path) else {
        return map;
    };
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let (Some(key_hex), Some(score_str)) = (parts.next(), parts.next()) else {
            continue;
        };
        let (Ok(key), Ok(score)) = (u64::from_str_radix(key_hex, 16), score_str.parse::<i32>()) else {
            continue;
        };
        let Ok(score) = i8::try_from(score) else {
            continue;
        };
        map.insert(key, score);
    }
    map
}

// ---------------------------------------------------------------------
// Binary book format v1 -- docs/ENGINE.md is the authority on this layout
// ---------------------------------------------------------------------

const MAGIC: [u8; 4] = *b"FWBK";
const FORMAT_VERSION: u8 = 1;
/// Header size in bytes: magic(4) + version(1) + depth(1) + count(4).
const HEADER_LEN: usize = 10;

fn book_byte_len(count: usize) -> usize {
    HEADER_LEN + count * 9 // 8 bytes/key + 1 byte/score, parallel arrays
}

/// Writes `entries` (must already be sorted ascending by key) to `path`
/// via a temp file + rename, so a crash mid-write can never leave a
/// partially-written file at `path` itself.
fn write_book(path: &Path, depth: u8, entries: &[(u64, i8)]) -> io::Result<()> {
    debug_assert!(
        entries.windows(2).all(|w| w[0].0 < w[1].0),
        "write_book requires entries sorted ascending by key with no duplicates"
    );

    let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));
    {
        let file = File::create(&tmp_path)?;
        let mut w = BufWriter::new(file);
        w.write_all(&MAGIC)?;
        w.write_all(&[FORMAT_VERSION, depth])?;
        w.write_all(&(entries.len() as u32).to_le_bytes())?;
        for (key, _) in entries {
            w.write_all(&key.to_le_bytes())?;
        }
        for (_, score) in entries {
            w.write_all(&[*score as u8])?;
        }
        w.flush()?;
    }
    fs::rename(&tmp_path, path)?;
    Ok(())
}

// ---------------------------------------------------------------------
// Seeded sampling -- no external RNG dependency: a small, deterministic,
// well-known constant-based PRNG (SplitMix64) is more than sufficient for
// picking a verification sample and keeps this bin's dependency surface
// identical to the library's.
// ---------------------------------------------------------------------

struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    fn new(seed: u64) -> SplitMix64 {
        SplitMix64 { state: seed }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
}

/// Selects (without replacement) up to `n` of `entries` via a seeded
/// partial Fisher-Yates shuffle, returning them sorted by key for a stable,
/// readable JSON fixture. Clamps silently if `n > entries.len()`.
fn sample_entries(
    canonical: &HashMap<u64, CanonicalEntry>,
    entries: &[(u64, i8)],
    n: usize,
    seed: u64,
) -> Vec<(String, u64, i8)> {
    let take = n.min(entries.len());
    let mut idx: Vec<usize> = (0..entries.len()).collect();
    let mut rng = SplitMix64::new(seed);
    for i in 0..take {
        let remaining = idx.len() - i;
        let j = i + (rng.next_u64() as usize % remaining);
        idx.swap(i, j);
    }
    let mut picked: Vec<(String, u64, i8)> = idx[..take]
        .iter()
        .map(|&i| {
            let (key, score) = entries[i];
            let seq = canonical
                .get(&key)
                .expect("every entry key must have a canonical entry")
                .seq
                .clone();
            (seq, key, score)
        })
        .collect();
    picked.sort_unstable_by_key(|(_, key, _)| *key);
    picked
}

/// Hand-rolled JSON writer: the sample's only string field (`moves`) is
/// always ASCII digits, so there is no escaping to get wrong, and this
/// avoids adding a `serde_json` dependency for one small, fixed-shape
/// artifact.
fn write_sample_json(
    path: &Path,
    depth: u8,
    seed: u64,
    sample: &[(String, u64, i8)],
) -> io::Result<()> {
    let mut out = String::new();
    out.push_str("{\n");
    out.push_str(&format!("  \"version\": 1,\n  \"depth\": {depth},\n  \"seed\": {seed},\n  \"count\": {},\n", sample.len()));
    out.push_str("  \"entries\": [\n");
    for (i, (moves, key, score)) in sample.iter().enumerate() {
        let comma = if i + 1 < sample.len() { "," } else { "" };
        out.push_str(&format!(
            "    {{ \"moves\": \"{moves}\", \"key\": {key}, \"score\": {score} }}{comma}\n"
        ));
    }
    out.push_str("  ]\n}\n");

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, out)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -------------------------------------------------------------
    // Mirroring
    // -------------------------------------------------------------

    /// Same sample positions `engine/tests/reference.rs` uses for its own
    /// mirror-symmetry proof, so this reuses an already-trusted fixture
    /// set rather than inventing new ones.
    fn sample_move_sequences() -> Vec<&'static str> {
        vec![
            "2252576253462244111563365343671351441",
            "7422341735647741166133573473242566",
            "23163416124767223154467471272416755633",
            "5554224333234511764415115",
            "52753311433677442422121",
            "1233722555341451114725221333",
            "", // empty board
            "4",
            "44",
            "445536271",
        ]
    }

    #[test]
    fn mirror_key_matches_replaying_the_mirrored_move_sequence() {
        for moves in sample_move_sequences() {
            let pos = Position::from_moves(moves).unwrap_or_else(|e| panic!("{moves:?}: {e}"));
            let mirrored_moves = mirror_moves(moves);
            let mirrored_pos = Position::from_moves(&mirrored_moves)
                .unwrap_or_else(|e| panic!("mirror of {moves:?} ({mirrored_moves:?}): {e}"));
            assert_eq!(
                mirror_key(pos.key()),
                mirrored_pos.key(),
                "mirror_key({moves:?}) must equal the key of replaying {mirrored_moves:?}"
            );
        }
    }

    #[test]
    fn mirror_key_is_its_own_inverse() {
        for moves in sample_move_sequences() {
            let pos = Position::from_moves(moves).unwrap();
            assert_eq!(mirror_key(mirror_key(pos.key())), pos.key());
        }
    }

    #[test]
    fn a_centre_column_only_sequence_is_its_own_mirror() {
        // Column 4 (1-indexed) is the board's centre; a sequence using only
        // that column must be a fixed point of mirroring.
        let pos = Position::from_moves("444444").unwrap();
        assert_eq!(mirror_key(pos.key()), pos.key());
    }

    #[test]
    fn canonical_key_agrees_for_a_position_and_its_mirror() {
        for moves in sample_move_sequences() {
            let pos = Position::from_moves(moves).unwrap();
            let mirrored = Position::from_moves(&mirror_moves(moves)).unwrap();
            assert_eq!(canonical_key(pos.key()), canonical_key(mirrored.key()));
        }
    }

    // -------------------------------------------------------------
    // Production enumerator: known reference counts
    // -------------------------------------------------------------

    /// Pons's own published counts (pre-mirror-dedup) for the first five
    /// plies of Connect Four: a hard check, not just a soft log, since
    /// they are exact and well known.
    #[test]
    fn enumeration_matches_known_ply_counts_0_through_4() {
        let layers = enumerate(4);
        let counts: Vec<usize> = layers.iter().map(Vec::len).collect();
        assert_eq!(counts, vec![1, 7, 49, 238, 1120]);
    }

    #[test]
    fn enumeration_depth_zero_is_just_the_empty_board() {
        let layers = enumerate(0);
        assert_eq!(layers.len(), 1);
        assert_eq!(layers[0].len(), 1);
        assert_eq!(layers[0][0].0, Position::new().key());
    }

    #[test]
    fn enumeration_never_yields_a_position_with_an_already_completed_win() {
        // "273747": a known win-in-one position for the *mover* -- so
        // playing the winning column reaches a genuinely terminal
        // position. That reached position must never appear as an
        // enumerated candidate at any depth deep enough to reach it.
        let layers = enumerate(7);
        let winning_child = Position::from_moves("2737471").unwrap().key(); // column 0 (0-indexed), digit "1", completes the four
        for layer in &layers {
            assert!(
                layer.iter().all(|(k, _, _)| *k != winning_child),
                "a position immediately following a completed win must never be enumerated"
            );
        }
    }

    // -------------------------------------------------------------
    // Canonicalisation properties
    // -------------------------------------------------------------

    #[test]
    fn canonicalize_never_lists_a_position_and_its_distinct_mirror_both() {
        let layers = enumerate(5);
        let canonical = canonicalize(&layers);
        for &key in canonical.keys() {
            let mirrored = mirror_key(key);
            if mirrored != key {
                assert!(
                    !canonical.contains_key(&mirrored),
                    "canonical map contains both {key:#x} and its mirror {mirrored:#x}"
                );
            }
        }
    }

    #[test]
    fn every_canonical_entry_key_matches_its_own_stored_position() {
        let layers = enumerate(5);
        let canonical = canonicalize(&layers);
        for (&key, entry) in &canonical {
            assert_eq!(
                entry.pos.key(),
                key,
                "canonical entry's stored position must key() to exactly the map key it's under"
            );
            let replayed = Position::from_moves(&entry.seq)
                .unwrap_or_else(|e| panic!("canonical seq {:?} for {key:#x}: {e}", entry.seq));
            assert_eq!(
                replayed.key(),
                key,
                "replaying the canonical entry's stored move sequence must reproduce its key"
            );
        }
    }

    #[test]
    fn canonicalize_is_a_true_dedup_at_most_half_of_raw_survives() {
        let layers = enumerate(5);
        let total_raw: usize = layers.iter().map(Vec::len).sum();
        let canonical = canonicalize(&layers);
        assert!(
            canonical.len() <= total_raw,
            "canonicalisation must never increase the position count"
        );
        // Ply 0 (the empty board) is its own mirror, so equality across
        // the whole run is impossible unless *every* other ply were also
        // entirely self-symmetric -- a real board isn't, so this must be
        // a strict decrease overall.
        assert!(canonical.len() < total_raw);
    }

    // -------------------------------------------------------------
    // Independent enumeration cross-check (naive 2D grid + HashSet oracle,
    // no bitboards) -- required by this wave's delegation prompt.
    // -------------------------------------------------------------

    #[derive(Clone)]
    struct NaiveBoard {
        cells: [[Option<bool>; HEIGHT as usize]; WIDTH as usize],
        heights: [usize; WIDTH as usize],
        first_to_move: bool,
    }

    impl NaiveBoard {
        fn new() -> NaiveBoard {
            NaiveBoard {
                cells: [[None; HEIGHT as usize]; WIDTH as usize],
                heights: [0; WIDTH as usize],
                first_to_move: true,
            }
        }

        fn can_play(&self, col: usize) -> bool {
            self.heights[col] < HEIGHT as usize
        }

        fn is_winning_move(&self, col: usize) -> bool {
            let row = self.heights[col];
            let player = self.first_to_move;
            const DIRECTIONS: [(isize, isize); 4] = [(1, 0), (0, 1), (1, 1), (1, -1)];
            for (dc, dr) in DIRECTIONS {
                let mut run = 1u32;
                for sign in [1isize, -1isize] {
                    let mut cc = col as isize + dc * sign;
                    let mut rr = row as isize + dr * sign;
                    while (0..WIDTH as isize).contains(&cc)
                        && (0..HEIGHT as isize).contains(&rr)
                        && self.cells[cc as usize][rr as usize] == Some(player)
                    {
                        run += 1;
                        cc += dc * sign;
                        rr += dr * sign;
                    }
                }
                if run >= 4 {
                    return true;
                }
            }
            false
        }

        fn play(&mut self, col: usize) {
            let row = self.heights[col];
            self.cells[col][row] = Some(self.first_to_move);
            self.heights[col] += 1;
            self.first_to_move = !self.first_to_move;
        }

        /// A plain-text encoding of the full grid, used only as a
        /// `HashSet`/`HashMap` key for transposition dedup -- no bitboard
        /// arithmetic anywhere in this type.
        fn grid_key(&self) -> String {
            let mut s = String::with_capacity(64);
            for col in 0..WIDTH as usize {
                for row in 0..HEIGHT as usize {
                    s.push(match self.cells[col][row] {
                        None => '.',
                        Some(true) => 'A',
                        Some(false) => 'B',
                    });
                }
                s.push('|');
            }
            s
        }
    }

    /// Naive, independent oracle: per-ply sets of unique reachable
    /// non-terminal boards (as move sequences reaching one representative
    /// each), found by a plain 2D-grid DFS with a `HashSet<String>` for
    /// transposition dedup -- structurally nothing shared with
    /// `enumerate`'s bitboard implementation.
    fn naive_enumerate(depth: u8) -> Vec<Vec<String>> {
        let mut seen: HashSet<String> = HashSet::new();
        let mut frontier: Vec<(NaiveBoard, String)> = vec![(NaiveBoard::new(), String::new())];
        let mut layers: Vec<Vec<String>> = Vec::new();

        for ply in 0..=depth {
            let mut unique: HashMap<String, (NaiveBoard, String)> = HashMap::new();
            for (board, seq) in frontier {
                let gk = board.grid_key();
                if seen.contains(&gk) {
                    continue;
                }
                unique.entry(gk).or_insert((board, seq));
            }
            for gk in unique.keys() {
                seen.insert(gk.clone());
            }

            layers.push(unique.values().map(|(_, seq)| seq.clone()).collect());

            if ply == depth {
                break;
            }

            let mut next_frontier = Vec::new();
            for (board, seq) in unique.into_values() {
                for col in 0..WIDTH as usize {
                    if !board.can_play(col) {
                        continue;
                    }
                    if board.is_winning_move(col) {
                        continue;
                    }
                    let mut next_board = board.clone();
                    next_board.play(col);
                    let filled: usize = next_board.heights.iter().sum();
                    if filled == TOTAL_CELLS as usize {
                        continue;
                    }
                    let mut next_seq = seq.clone();
                    next_seq.push(char::from_digit(col as u32 + 1, 10).unwrap());
                    next_frontier.push((next_board, next_seq));
                }
            }
            frontier = next_frontier;
        }

        layers
    }

    #[test]
    fn production_enumerator_agrees_with_the_naive_oracle_up_to_ply_5() {
        const DEPTH: u8 = 5;
        let production = enumerate(DEPTH);
        let naive = naive_enumerate(DEPTH);

        assert_eq!(production.len(), naive.len());

        for ply in 0..=DEPTH as usize {
            let prod_counts = production[ply].len();
            let naive_counts = naive[ply].len();
            assert_eq!(
                prod_counts, naive_counts,
                "ply {ply}: production enumerator found {prod_counts} positions, \
                 naive oracle found {naive_counts}"
            );

            // Translate the naive oracle's move sequences into engine keys
            // (the only point this test touches the engine's bitboard
            // representation at all) and compare raw key sets directly.
            let prod_keys: HashSet<u64> = production[ply].iter().map(|(k, _, _)| *k).collect();
            let naive_keys: HashSet<u64> = naive[ply]
                .iter()
                .map(|seq| Position::from_moves(seq).unwrap().key())
                .collect();
            assert_eq!(
                prod_keys, naive_keys,
                "ply {ply}: production and naive enumerators disagree on the raw key set"
            );

            // And after applying the identical canonicalisation rule to
            // both independently, the canonical key sets must also agree.
            let prod_canonical: HashSet<u64> = prod_keys.iter().map(|&k| canonical_key(k)).collect();
            let naive_canonical: HashSet<u64> = naive_keys.iter().map(|&k| canonical_key(k)).collect();
            assert_eq!(
                prod_canonical, naive_canonical,
                "ply {ply}: canonical key sets disagree between production and naive enumerators"
            );
        }
    }

    // -------------------------------------------------------------
    // Serialisation round-trip (writer correctness; not the loader --
    // Wave 8 owns replaying through the real `book.rs`)
    // -------------------------------------------------------------

    /// Minimal, test-only reader mirroring exactly what a loader must do
    /// per docs/ENGINE.md's binary layout table -- deliberately
    /// independent of `write_book`'s own byte-shuffling so a writer bug
    /// (e.g. wrong endianness, off-by-one header size) has a real chance
    /// of being caught rather than both sides sharing the same mistake.
    fn read_book_for_test(path: &Path) -> (u8, u8, Vec<u64>, Vec<i8>) {
        let bytes = fs::read(path).expect("read book file");
        assert_eq!(&bytes[0..4], b"FWBK", "magic mismatch");
        let version = bytes[4];
        let depth = bytes[5];
        let count = u32::from_le_bytes(bytes[6..10].try_into().unwrap()) as usize;
        let keys_start = 10;
        let keys_end = keys_start + count * 8;
        let scores_end = keys_end + count;
        assert_eq!(bytes.len(), scores_end, "file length does not match header's count");

        let keys: Vec<u64> = bytes[keys_start..keys_end]
            .chunks_exact(8)
            .map(|c| u64::from_le_bytes(c.try_into().unwrap()))
            .collect();
        let scores: Vec<i8> = bytes[keys_end..scores_end].iter().map(|&b| b as i8).collect();
        (version, depth, keys, scores)
    }

    #[test]
    fn write_book_then_read_back_round_trips() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "gen_book_test_{}_{}.bin",
            std::process::id(),
            "round_trip"
        ));
        let entries: Vec<(u64, i8)> = vec![
            (5, -3),
            (100, 0),
            (1_000_000_000_000, 18),
            (u64::MAX, -18),
        ];
        // write_book requires ascending-sorted input.
        let mut sorted = entries.clone();
        sorted.sort_unstable_by_key(|(k, _)| *k);

        write_book(&path, 4, &sorted).expect("write_book should succeed");
        let (version, depth, keys, scores) = read_book_for_test(&path);

        assert_eq!(version, 1);
        assert_eq!(depth, 4);
        assert_eq!(keys.len(), sorted.len());
        assert_eq!(scores.len(), sorted.len());
        assert!(keys.windows(2).all(|w| w[0] < w[1]), "keys must be sorted ascending");
        for (i, (k, s)) in sorted.iter().enumerate() {
            assert_eq!(keys[i], *k);
            assert_eq!(scores[i], *s);
        }

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn write_book_leaves_no_tmp_file_behind_on_success() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("gen_book_test_{}_notmp.bin", std::process::id()));
        write_book(&path, 1, &[(1, 0), (2, 1)]).unwrap();
        let tmp_path = PathBuf::from(format!("{}.tmp", path.display()));
        assert!(!tmp_path.exists(), "temp file should have been renamed away");
        let _ = fs::remove_file(&path);
    }

    // -------------------------------------------------------------
    // Checkpoint round-trip
    // -------------------------------------------------------------

    #[test]
    fn checkpoint_round_trips_through_load_and_append() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("gen_book_test_{}_checkpoint.log", std::process::id()));
        let _ = fs::remove_file(&path);

        {
            let file = OpenOptions::new().create(true).append(true).open(&path).unwrap();
            let mut w = BufWriter::new(file);
            writeln!(w, "{:016x} {}", 42u64, -5).unwrap();
            writeln!(w, "{:016x} {}", 1_000_000u64, 3).unwrap();
            w.flush().unwrap();
        }

        let loaded = load_checkpoint(&path);
        assert_eq!(loaded.get(&42), Some(&-5));
        assert_eq!(loaded.get(&1_000_000), Some(&3));
        assert_eq!(loaded.len(), 2);

        let _ = fs::remove_file(&path);
    }

    #[test]
    fn checkpoint_load_of_a_missing_file_is_an_empty_map_not_an_error() {
        let path = PathBuf::from("/nonexistent/gen_book/checkpoint/path.log");
        assert!(load_checkpoint(&path).is_empty());
    }

    #[test]
    fn checkpoint_load_tolerates_a_truncated_trailing_line() {
        let dir = std::env::temp_dir();
        let path = dir.join(format!("gen_book_test_{}_truncated.log", std::process::id()));
        fs::write(&path, "0000000000000001 5\n0000000000000002 -3\n000000000000000").unwrap();

        let loaded = load_checkpoint(&path);
        assert_eq!(loaded.get(&1), Some(&5));
        assert_eq!(loaded.get(&2), Some(&-3));
        assert_eq!(loaded.len(), 2, "the truncated trailing line must be silently skipped");

        let _ = fs::remove_file(&path);
    }

    // -------------------------------------------------------------
    // Sampling
    // -------------------------------------------------------------

    #[test]
    fn sample_entries_clamps_to_the_available_count_and_stays_sorted() {
        let layers = enumerate(3);
        let canonical = canonicalize(&layers);
        let mut entries: Vec<(u64, i8)> = canonical.keys().map(|&k| (k, 0)).collect();
        entries.sort_unstable_by_key(|(k, _)| *k);

        let requested = entries.len() + 500; // deliberately more than available
        let sample = sample_entries(&canonical, &entries, requested, 7);
        assert_eq!(sample.len(), entries.len(), "must clamp, not panic or pad");
        assert!(sample.windows(2).all(|w| w[0].1 < w[1].1), "sample must be sorted by key");

        for (moves, key, _) in &sample {
            let replayed = Position::from_moves(moves).unwrap();
            assert_eq!(replayed.key(), *key, "sampled move sequence must reach its recorded key");
        }
    }

    #[test]
    fn sample_entries_is_deterministic_for_a_fixed_seed() {
        let layers = enumerate(4);
        let canonical = canonicalize(&layers);
        let mut entries: Vec<(u64, i8)> = canonical.keys().map(|&k| (k, 0)).collect();
        entries.sort_unstable_by_key(|(k, _)| *k);

        let a = sample_entries(&canonical, &entries, 20, 12345);
        let b = sample_entries(&canonical, &entries, 20, 12345);
        assert_eq!(a, b);
    }

    // -------------------------------------------------------------
    // CLI parsing
    // -------------------------------------------------------------

    #[test]
    fn args_parse_defaults() {
        let args = Args::parse(std::iter::empty());
        assert_eq!(args.depth, 8);
        assert_eq!(args.out, PathBuf::from("book.bin"));
        assert_eq!(args.tt_mb, 4096);
        assert_eq!(args.verify_sample, 1000);
        assert_eq!(args.seed, 0);
        assert!(!args.resume);
        assert!(args.threads >= 1, "thread count must never default to 0");
        assert_eq!(args.max_positions, None, "unlimited by default");
        assert_eq!(args.sample_out, default_sample_path());
    }

    #[test]
    fn args_parse_overrides_every_flag() {
        let raw = [
            "--depth", "4", "--out", "/tmp/x.bin", "--tt-mb", "256", "--verify-sample", "200",
            "--seed", "42", "--resume", "--threads", "3", "--max-positions", "50",
            "--sample-out", "/tmp/sample.json",
        ];
        let args = Args::parse(raw.into_iter().map(String::from));
        assert_eq!(args.depth, 4);
        assert_eq!(args.out, PathBuf::from("/tmp/x.bin"));
        assert_eq!(args.tt_mb, 256);
        assert_eq!(args.verify_sample, 200);
        assert_eq!(args.seed, 42);
        assert!(args.resume);
        assert_eq!(args.threads, 3);
        assert_eq!(args.max_positions, Some(50));
        assert_eq!(args.sample_out, PathBuf::from("/tmp/sample.json"));
    }

    #[test]
    fn default_threads_is_never_zero() {
        assert!(default_threads() >= 1);
    }

    // -------------------------------------------------------------
    // apply_max_positions
    // -------------------------------------------------------------

    #[test]
    fn apply_max_positions_none_is_unlimited() {
        let order = vec![5u64, 3, 9, 1];
        assert_eq!(apply_max_positions(order.clone(), None), order);
    }

    #[test]
    fn apply_max_positions_takes_a_fixed_prefix() {
        let order = vec![5u64, 3, 9, 1, 7];
        assert_eq!(apply_max_positions(order, Some(2)), vec![5u64, 3]);
    }

    #[test]
    fn apply_max_positions_clamps_when_n_exceeds_the_order_length() {
        let order = vec![5u64, 3];
        assert_eq!(apply_max_positions(order.clone(), Some(500)), order);
    }

    // -------------------------------------------------------------
    // Small end-to-end integration (real solving, but deliberately NOT via
    // `enumerate()`/opening positions).
    //
    // A judgement call worth recording: an earlier version of this test
    // ran `enumerate(2)` from the empty board and solved every resulting
    // position. That was measured, not assumed, to be a mistake -- ply-2
    // positions have 40 empty cells, so each solve is nearly as expensive
    // as the fully-empty-board case `solver.rs` itself only runs
    // `#[ignore]`d in release (~115s measured, per `docs/ENGINE.md`), and
    // there were ~25 of them plus a second unwarmed-TT solve per entry for
    // verification. It was killed manually after running past 60s with no
    // end in sight. The genuine opening-depth end-to-end proof is the
    // mandatory depth-4 rehearsal run this wave's delegation prompt
    // requires as a separate, deliberate `cargo run --release` invocation
    // -- not something `cargo test`, ignored or not, should attempt on its
    // own. What this test proves instead, cheaply and un-ignored even in
    // debug: the write -> read -> score pipeline is correct end-to-end
    // against REAL solved scores, using the same End-Easy fixture
    // positions `solver.rs`/`analysis.rs` already trust for exactly this
    // reason (fewer than 14 cells left to fill keeps the tree tiny
    // regardless of build profile). `enumerate`'s own correctness is
    // proven separately (and far more cheaply) by the ply-count and
    // naive-oracle cross-check tests above.
    // -------------------------------------------------------------

    #[test]
    fn end_to_end_pipeline_matches_direct_solves_on_real_endgame_positions() {
        const END_EASY: &[&str] = &[
            "2252576253462244111563365343671351441",
            "7422341735647741166133573473242566",
        ];

        let mut solver = Solver::new();
        let mut entries: Vec<(u64, i8)> = Vec::new();
        let mut seq_by_key: HashMap<u64, String> = HashMap::new();
        for &moves in END_EASY {
            let pos = Position::from_moves(moves).unwrap();
            let key = canonical_key(pos.key());
            // These fixtures are not mirrors of one another and are deep
            // enough that a collision is not a realistic concern; a plain
            // insert (not or_insert) is fine and would panic loudly if
            // that assumption were ever wrong.
            assert!(seq_by_key.insert(key, moves.to_string()).is_none());
            let score = solver.solve(&pos);
            entries.push((key, score as i8));
        }
        entries.sort_unstable_by_key(|(k, _)| *k);

        let dir = std::env::temp_dir();
        let path = dir.join(format!("gen_book_test_{}_e2e.bin", std::process::id()));
        write_book(&path, 40, &entries).unwrap();
        let (_, depth, keys, scores) = read_book_for_test(&path);

        assert_eq!(depth, 40);
        assert_eq!(keys.len(), entries.len());
        for (i, key) in keys.iter().enumerate() {
            let moves = seq_by_key.get(key).expect("every written key came from a fixture above");
            let pos = Position::from_moves(moves).unwrap();
            let direct = connect4_engine::solver::solve(&pos);
            assert_eq!(
                scores[i] as i32, direct,
                "book score for key {key:#x} (moves {moves:?}) disagrees with a fresh direct solve"
            );
        }

        let _ = fs::remove_file(&path);
    }

    // -------------------------------------------------------------
    // Parallel solve loop (Wave 7.1): determinism, real known-score
    // correctness, and checkpoint line-atomicity under genuine
    // multi-threaded contention.
    //
    // Uses real Pons End-Easy fixture positions (<=8 empty cells, so each
    // solve is genuinely fast even in debug) as a synthetic `canonical` map
    // built directly -- deliberately NOT via `enumerate()` from the empty
    // board, for the same cost reason `end_to_end_pipeline_...` above
    // documents. This both keeps the test fast AND lets it assert against
    // scores the Pons fixture file already asserts independently, so it is
    // checking `solve_parallel` against known ground truth, not merely
    // against itself.
    // -------------------------------------------------------------

    /// Loads `n` fixture lines from `test_l3_r1.txt` (Pons End-Easy) as a
    /// synthetic `(canonical map, deterministic key order, expected i32
    /// scores)` triple -- independent of `enumerate`/`canonicalize`'s own
    /// production path.
    fn synthetic_canonical_from_fixtures(
        n: usize,
    ) -> (HashMap<u64, CanonicalEntry>, Vec<u64>, HashMap<u64, i32>) {
        let fixture_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/test_l3_r1.txt");
        let contents = fs::read_to_string(&fixture_path)
            .unwrap_or_else(|e| panic!("failed to read {}: {e}", fixture_path.display()));

        let mut canonical: HashMap<u64, CanonicalEntry> = HashMap::new();
        let mut expected: HashMap<u64, i32> = HashMap::new();
        for line in contents.lines().take(n) {
            let mut parts = line.split_whitespace();
            let moves = parts.next().expect("fixture line has a move sequence");
            let expected_score: i32 = parts
                .next()
                .expect("fixture line has an expected score")
                .parse()
                .expect("fixture score is an integer");
            let pos = Position::from_moves(moves).expect("fixture move sequence is legal");
            let key = canonical_key(pos.key());
            // Fixture lines are independent positions deep enough into
            // distinct games that a canonical-key collision across them is
            // not a realistic concern -- assert it loudly if ever wrong
            // rather than silently dropping a line.
            assert!(
                canonical
                    .insert(
                        key,
                        CanonicalEntry { pos, seq: moves.to_string(), ply: pos.moves() as u8 }
                    )
                    .is_none(),
                "unexpected canonical-key collision among fixture lines at {moves:?}"
            );
            expected.insert(key, expected_score);
        }

        let mut order: Vec<u64> = canonical.keys().copied().collect();
        order.sort_unstable(); // deterministic order, independent of HashMap iteration
        (canonical, order, expected)
    }

    /// Strictly parses one checkpoint line as `solve_parallel` writes it
    /// (`{key:016x} {score}`), panicking (failing the test) on anything
    /// that doesn't match exactly -- this is what would catch a torn or
    /// interleaved line if the checkpoint writer's mutex were ever removed
    /// or narrowed to not cover the whole write+flush.
    fn parse_checkpoint_line_strict(line: &str) -> (u64, i32) {
        let mut parts = line.split(' ');
        let key_hex = parts.next().unwrap_or_else(|| panic!("empty checkpoint line"));
        let score_str = parts
            .next()
            .unwrap_or_else(|| panic!("checkpoint line {line:?} missing a score field"));
        assert!(
            parts.next().is_none(),
            "checkpoint line {line:?} has extra fields -- possible torn/interleaved write"
        );
        assert_eq!(
            key_hex.len(),
            16,
            "checkpoint line {line:?}'s key field is not exactly 16 hex characters -- \
             possible torn/interleaved write"
        );
        let key = u64::from_str_radix(key_hex, 16)
            .unwrap_or_else(|e| panic!("checkpoint line {line:?} has an invalid hex key: {e}"));
        let score: i32 = score_str
            .parse()
            .unwrap_or_else(|e| panic!("checkpoint line {line:?} has an invalid score: {e}"));
        (key, score)
    }

    #[test]
    fn parallel_solve_matches_known_fixture_scores_and_is_deterministic_across_thread_counts() {
        let (canonical, order, expected) = synthetic_canonical_from_fixtures(40);
        assert_eq!(order.len(), 40, "sanity: the fixture file has at least 40 lines");

        let dir = std::env::temp_dir();
        let serial_ckpt = dir.join(format!("gen_book_test_{}_parallel_serial.ckpt", std::process::id()));
        let parallel_ckpt = dir.join(format!("gen_book_test_{}_parallel_8t.ckpt", std::process::id()));
        let _ = fs::remove_file(&serial_ckpt);
        let _ = fs::remove_file(&parallel_ckpt);

        let serial_scores = solve_parallel(
            &canonical,
            &order,
            1, // tt_mb: kept tiny, this is a correctness test not a perf one
            1, // threads
            HashMap::new(),
            &serial_ckpt,
            canonical.len(),
        );
        let parallel_scores = solve_parallel(
            &canonical,
            &order,
            1,
            8, // threads: real contention on the same shared table
            HashMap::new(),
            &parallel_ckpt,
            canonical.len(),
        );

        // 1. Both runs solved exactly the fixed key set, nothing more,
        //    nothing less -- this is what would catch "break the fixed-set
        //    assignment" (e.g. a bug where thread count changed which keys
        //    got solved).
        let order_set: HashSet<u64> = order.iter().copied().collect();
        assert_eq!(serial_scores.keys().copied().collect::<HashSet<_>>(), order_set);
        assert_eq!(parallel_scores.keys().copied().collect::<HashSet<_>>(), order_set);

        // 2. Every score matches the independently-known-correct Pons
        //    fixture value, for BOTH thread counts -- not just "the two
        //    runs agree with each other" (which alone wouldn't catch two
        //    runs being consistently wrong the same way).
        for &key in &order {
            let want = expected[&key];
            assert_eq!(
                serial_scores[&key] as i32, want,
                "serial (threads=1) score for key {key:#x} disagrees with the Pons fixture"
            );
            assert_eq!(
                parallel_scores[&key] as i32, want,
                "parallel (threads=8) score for key {key:#x} disagrees with the Pons fixture"
            );
        }

        // 3. Byte-for-byte determinism claim, stated directly: identical
        //    maps regardless of thread count.
        assert_eq!(
            serial_scores, parallel_scores,
            "solve_parallel must return identical scores regardless of thread count"
        );

        // 4. Checkpoint line-atomicity: every line in both files parses
        //    strictly, covers exactly the expected key set once each, with
        //    no torn/interleaved/duplicate lines -- the parallel file is
        //    the meaningful case (real contention from 8 threads sharing
        //    one writer), the serial file is the control.
        for (path, label) in [(&serial_ckpt, "serial"), (&parallel_ckpt, "parallel")] {
            let contents = fs::read_to_string(path).unwrap_or_else(|e| panic!("{label}: {e}"));
            let lines: Vec<&str> = contents.lines().collect();
            assert_eq!(
                lines.len(),
                order.len(),
                "{label}: expected exactly {} checkpoint lines, got {}",
                order.len(),
                lines.len()
            );
            let mut seen_keys: HashSet<u64> = HashSet::new();
            for line in &lines {
                let (key, score) = parse_checkpoint_line_strict(line);
                assert!(
                    order_set.contains(&key),
                    "{label}: checkpoint line for key {key:#x} is not in the expected key set"
                );
                assert!(
                    seen_keys.insert(key),
                    "{label}: key {key:#x} appears more than once in the checkpoint -- \
                     a torn write could plausibly manifest as a duplicate/garbled key"
                );
                assert_eq!(
                    score, expected[&key],
                    "{label}: checkpoint line for key {key:#x} has the wrong score"
                );
            }
            assert_eq!(seen_keys, order_set, "{label}: checkpoint does not cover every expected key exactly once");
        }

        let _ = fs::remove_file(&serial_ckpt);
        let _ = fs::remove_file(&parallel_ckpt);
    }

    #[test]
    fn parallel_solve_with_max_positions_style_truncation_is_thread_count_independent() {
        // Exercises `apply_max_positions` feeding into `solve_parallel`
        // exactly as `main()` wires them: the same fixed prefix, solved
        // under two different thread counts, must yield the identical
        // (smaller) result.
        let (canonical, full_order, expected) = synthetic_canonical_from_fixtures(40);
        let truncated = apply_max_positions(full_order, Some(15));
        assert_eq!(truncated.len(), 15);

        let dir = std::env::temp_dir();
        let ckpt_a = dir.join(format!("gen_book_test_{}_maxpos_1t.ckpt", std::process::id()));
        let ckpt_b = dir.join(format!("gen_book_test_{}_maxpos_5t.ckpt", std::process::id()));
        let _ = fs::remove_file(&ckpt_a);
        let _ = fs::remove_file(&ckpt_b);

        let scores_a = solve_parallel(&canonical, &truncated, 1, 1, HashMap::new(), &ckpt_a, canonical.len());
        let scores_b = solve_parallel(&canonical, &truncated, 1, 5, HashMap::new(), &ckpt_b, canonical.len());

        assert_eq!(scores_a.len(), 15);
        assert_eq!(scores_a, scores_b);
        for (&key, &score) in &scores_a {
            assert_eq!(score as i32, expected[&key]);
        }

        let _ = fs::remove_file(&ckpt_a);
        let _ = fs::remove_file(&ckpt_b);
    }

    #[test]
    fn solve_parallel_honours_an_already_populated_initial_scores_map() {
        // Resume semantics: a key already present in `initial_scores` (as
        // if loaded from a checkpoint) must survive untouched in the
        // result even though it is absent from `to_solve` -- and the
        // checkpoint file must NOT gain a duplicate line for it (nothing
        // was re-solved).
        let (canonical, order, expected) = synthetic_canonical_from_fixtures(10);
        let (already_solved_key, to_solve): (u64, Vec<u64>) =
            (order[0], order[1..].to_vec());

        let mut initial = HashMap::new();
        initial.insert(already_solved_key, expected[&already_solved_key] as i8);

        let dir = std::env::temp_dir();
        let ckpt = dir.join(format!("gen_book_test_{}_resume.ckpt", std::process::id()));
        let _ = fs::remove_file(&ckpt);

        let result = solve_parallel(&canonical, &to_solve, 1, 4, initial, &ckpt, canonical.len());

        assert_eq!(result.len(), order.len());
        for &key in &order {
            assert_eq!(result[&key] as i32, expected[&key]);
        }

        let contents = fs::read_to_string(&ckpt).unwrap();
        assert_eq!(
            contents.lines().count(),
            to_solve.len(),
            "the pre-checkpointed key must not be re-solved or re-written"
        );
        assert!(
            !contents.contains(&format!("{already_solved_key:016x}")),
            "the pre-checkpointed key must not appear in this run's checkpoint output"
        );

        let _ = fs::remove_file(&ckpt);
    }
}
