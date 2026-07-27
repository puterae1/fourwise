//! Reference correctness suite: Pascal Pons's six published benchmark sets
//! (<http://blog.gamesolver.org/solving-connect-four/02-test-protocol/>),
//! plus the seat-model proof tests requested alongside them (mirror
//! symmetry; colour independence lives in `src/position.rs` -- see that
//! file for why).
//!
//! ## Fixture files
//!
//! `tests/fixtures/*.txt`, one line per position: `<moves> <expected score>`,
//! moves in the standard 1-7 column notation. Downloaded verbatim from
//! `blog.gamesolver.org/data/Test_*` (1000 lines each, 6000 total).
//!
//! ## Debug vs. release split
//!
//! Every fixture test asserts an *exact* score match -- not close, exact,
//! per `docs/ENGINE.md`. But an unoptimised (debug) full search is far too
//! slow to run 1000 begin-game positions in: Pons's own benchmarking page
//! reports a *weak* solver averaging 7.95s and 93M explored nodes *per
//! position* on the hardest ("Begin-Hard") set. That set has no business
//! running by default.
//!
//! The split follows the difficulty buckets themselves, not an arbitrary
//! cutoff:
//!
//! - `test_l3_r1` (End-Easy) and `test_l2_r1` (Middle-Easy) always have
//!   fewer than 14 cells left to fill, and `test_l2_r2` (Middle-Medium),
//!   despite its wider "remaining moves" band, is dominated by a board
//!   that is already mostly committed. Pons's own reference numbers for an
//!   unoptimised solver put these at 3.7us / 176us / 2.4ms mean per
//!   position -- cheap enough to run un-ignored, in debug, as part of
//!   plain `cargo test`.
//! - `test_l1_r1`/`r2`/`r3` (Begin-Easy/Medium/Hard) start from at most 14
//!   moves played, i.e. close to a full-width, full-depth search. These
//!   are `#[ignore]`d; run them with:
//!   `cargo test --release -- --ignored --include-ignored`.

use connect4_engine::position::{Position, HEIGHT, WIDTH};
use connect4_engine::solver::Solver;

fn fixture_path(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

/// Run every `<moves> <score>` line in a fixture file through a single
/// (reused, for speed) `Solver`, asserting an exact score match.
fn assert_fixture_exact(name: &str) {
    let path = fixture_path(name);
    let contents = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read fixture {path}: {e}"));

    let mut solver = Solver::new();
    let mut checked = 0usize;

    for (i, line) in contents.lines().enumerate() {
        let line_no = i + 1;
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.split_whitespace();
        let moves = parts
            .next()
            .unwrap_or_else(|| panic!("{name}:{line_no}: missing moves field in {line:?}"));
        let expected_str = parts
            .next()
            .unwrap_or_else(|| panic!("{name}:{line_no}: missing score field in {line:?}"));
        let expected: i32 = expected_str.parse().unwrap_or_else(|e| {
            panic!("{name}:{line_no}: expected score {expected_str:?} is not an integer: {e}")
        });

        let pos = Position::from_moves(moves)
            .unwrap_or_else(|e| panic!("{name}:{line_no}: invalid position {moves:?}: {e}"));
        let actual = solver.solve(&pos);

        assert_eq!(
            actual, expected,
            "{name}:{line_no}: position {moves:?} expected score {expected}, got {actual}"
        );
        checked += 1;
    }

    assert!(
        checked > 900,
        "{name}: expected roughly 1000 fixture lines, only checked {checked} -- \
         did the download get truncated?"
    );
}

#[test]
fn test_l3_r1_end_easy() {
    assert_fixture_exact("test_l3_r1.txt");
}

#[test]
fn test_l2_r1_middle_easy() {
    assert_fixture_exact("test_l2_r1.txt");
}

#[test]
fn test_l2_r2_middle_medium() {
    assert_fixture_exact("test_l2_r2.txt");
}

#[test]
#[ignore = "begin-game full search; run with: cargo test --release -- --ignored --include-ignored"]
fn test_l1_r1_begin_easy() {
    assert_fixture_exact("test_l1_r1.txt");
}

#[test]
#[ignore = "begin-game full search; run with: cargo test --release -- --ignored --include-ignored"]
fn test_l1_r2_begin_medium() {
    assert_fixture_exact("test_l1_r2.txt");
}

#[test]
#[ignore = "begin-game full search; run with: cargo test --release -- --ignored --include-ignored"]
fn test_l1_r3_begin_hard() {
    assert_fixture_exact("test_l1_r3.txt");
}

// ---------------------------------------------------------------------
// Seat-model proof: mirror symmetry.
//
// Colour independence (swapping which side is "current") needs direct
// access to Position's private fields to construct, and so lives as a
// unit test inside `src/position.rs` instead of here -- see that file.
// ---------------------------------------------------------------------

/// A handful of real fixture positions, deliberately drawn from the
/// cheapest ("End-Easy" / "Middle-Easy") sets so this stays fast in debug
/// mode too: few cells are left empty, so the search tree from each is
/// tiny regardless of build profile.
fn sample_positions() -> Vec<&'static str> {
    vec![
        "2252576253462244111563365343671351441",
        "7422341735647741166133573473242566",
        "23163416124767223154467471272416755633",
        "5554224333234511764415115",
        "52753311433677442422121",
        "1233722555341451114725221333",
    ]
}

/// Column `d` (1-indexed, as in the move notation) mirrors to `8 - d`:
/// column 1 <-> 7, 2 <-> 6, 3 <-> 5, 4 stays put.
fn mirror_moves(moves: &str) -> String {
    moves
        .chars()
        .map(|c| {
            let d = c.to_digit(10).expect("fixture moves are single ASCII digits");
            std::char::from_digit(8 - d, 10).expect("mirrored digit is still 1..=7")
        })
        .collect()
}

#[test]
fn a_position_and_its_left_right_mirror_score_identically() {
    let mut solver = Solver::new();
    for moves in sample_positions() {
        let pos = Position::from_moves(moves).unwrap_or_else(|e| panic!("{moves:?}: {e}"));
        let mirrored_moves = mirror_moves(moves);
        let mirrored = Position::from_moves(&mirrored_moves)
            .unwrap_or_else(|e| panic!("mirror of {moves:?} ({mirrored_moves:?}): {e}"));

        let score = solver.solve(&pos);
        let mirrored_score = solver.solve(&mirrored);
        assert_eq!(
            score, mirrored_score,
            "position {moves:?} (score {score}) and its mirror {mirrored_moves:?} \
             (score {mirrored_score}) must score identically"
        );
    }
}

// ---------------------------------------------------------------------
// Negamax self-consistency (docs/ENGINE.md, amended): for a sample of
// non-terminal positions, score(P) must equal the maximum over legal
// moves `c` of `-score(P.play(c))`. The two terminal cases -- an
// immediate winning move available, or a full drawn board -- are handled
// directly instead of via the max-over-children recursion, since neither
// one is what that recursion is actually claiming.
// ---------------------------------------------------------------------

/// Every `stride`-th non-blank line's moves field from a fixture file,
/// deliberately ignoring the expected-score column: that column is
/// already exercised exactly by the fixture tests above, and this test
/// checks a different property (internal consistency of `score`, not
/// its match against a published answer). Sampling by stride rather than
/// exhaustively keeps this fast in debug while still covering each file
/// end-to-end rather than just its first few lines.
fn sample_moves_from_fixture(name: &str, stride: usize) -> Vec<String> {
    let path = fixture_path(name);
    let contents = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("failed to read fixture {path}: {e}"));

    contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .step_by(stride)
        .map(|line| {
            line.split_whitespace()
                .next()
                .unwrap_or_else(|| panic!("{name}: missing moves field in {line:?}"))
                .to_string()
        })
        .collect()
}

/// The score of a position already known (via `can_win_next`) to have an
/// immediate winning move, per `docs/ENGINE.md`'s score convention:
/// `22 - stones_the_winner_will_have_played`, i.e. the mover wins with
/// their very next stone. This is the same one-line public formula
/// `solver.rs` uses internally (there as a private `immediate_win_score`
/// helper) -- reimplemented here from the documented formula rather than
/// exposed from the crate, since the point of this test is to check the
/// solver's *internal* self-consistency against an independently-derived
/// expectation, not to reuse its own private helper as the oracle.
fn win_in_one_score(pos: &Position) -> i32 {
    let total_cells = (WIDTH * HEIGHT) as i32;
    (total_cells + 1 - pos.moves() as i32) / 2
}

/// An engine-independent replay of a moves string, used only to answer
/// "does the side to move have an immediate winning move right now?" for
/// the terminal-case split in [`negamax_self_consistency`].
///
/// `Position::can_win_next` answers exactly this question, but it is
/// `pub(crate)` -- invisible from this file, since `tests/` compiles as
/// an external crate and only `position.rs`'s genuinely `pub` surface
/// (`WIDTH`, `HEIGHT`, `Position::{new,moves,can_play,play,from_moves}`,
/// `alignment`, `winning_positions`) is reachable, and none of those
/// expose a `Position`'s two private bitboards. Rather than widen that
/// public API for one test, this reimplements the check from scratch
/// against a plain 2D grid: an independent oracle, not a reuse of the
/// engine's own bitboard machinery, which is arguably the more honest
/// check anyway. `first` here just tracks alternating turns by parity
/// (mirroring the engine's colour-blind "current mover" concept) and
/// carries no colour meaning.
struct Grid {
    cells: [[Option<bool>; HEIGHT as usize]; WIDTH as usize],
    heights: [usize; WIDTH as usize],
    first_to_move: bool,
}

impl Grid {
    fn from_moves(moves: &str) -> Grid {
        let mut g = Grid {
            cells: [[None; HEIGHT as usize]; WIDTH as usize],
            heights: [0; WIDTH as usize],
            first_to_move: true,
        };
        for c in moves.chars() {
            let col = c.to_digit(10).expect("sampled moves are single ASCII digits") as usize - 1;
            let row = g.heights[col];
            g.cells[col][row] = Some(g.first_to_move);
            g.heights[col] += 1;
            g.first_to_move = !g.first_to_move;
        }
        g
    }

    fn can_play(&self, col: usize) -> bool {
        self.heights[col] < HEIGHT as usize
    }

    /// Would dropping a disc for the player to move into `col` complete a
    /// four-in-a-row?
    fn is_winning_move(&self, col: usize) -> bool {
        if !self.can_play(col) {
            return false;
        }
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

    fn has_winning_move(&self) -> bool {
        (0..WIDTH as usize).any(|c| self.is_winning_move(c))
    }
}

#[test]
fn negamax_self_consistency() {
    let mut solver = Solver::new();

    let mut sampled = Vec::new();
    sampled.extend(sample_moves_from_fixture("test_l3_r1.txt", 70));
    sampled.extend(sample_moves_from_fixture("test_l2_r1.txt", 70));
    sampled.extend(sample_moves_from_fixture("test_l2_r2.txt", 70));

    assert!(
        (30..=50).contains(&sampled.len()),
        "expected roughly 30-50 sampled positions across the three cheap \
         fixture sets, got {} -- did a fixture file's line count change?",
        sampled.len()
    );

    for moves in &sampled {
        let pos = Position::from_moves(moves)
            .unwrap_or_else(|e| panic!("invalid sampled position {moves:?}: {e}"));

        let score = solver.solve(&pos);

        // Terminal case 1: an immediate winning move is available. The
        // solver short-circuits through `can_win_next` and never
        // recurses into children at all for this position, so there is
        // no max-over-children property to check -- compare directly
        // against the documented win-in-one formula instead. Detected
        // via the independent `Grid` oracle above, not the engine's own
        // (inaccessible from here) `can_win_next`.
        if Grid::from_moves(moves).has_winning_move() {
            assert_eq!(
                score,
                win_in_one_score(&pos),
                "position {moves:?} has an immediate win available; \
                 expected the direct win-in-one score"
            );
            continue;
        }

        let legal_cols: Vec<u32> = (0..WIDTH).filter(|&c| pos.can_play(c)).collect();

        // Terminal case 2: a full, drawn board. No legal moves remain to
        // recurse into, so the score is 0 by definition, not by a
        // max-over-(empty)-children computation.
        if legal_cols.is_empty() {
            assert_eq!(
                score, 0,
                "position {moves:?} is a full board and must score as a draw"
            );
            continue;
        }

        // Non-terminal case: score(P) must equal the maximum, over every
        // legal reply, of the negated child score.
        let best_child_score = legal_cols
            .iter()
            .map(|&c| {
                let mut child = pos;
                child.play(c);
                -solver.solve(&child)
            })
            .max()
            .expect("legal_cols was just checked non-empty");

        assert_eq!(
            score, best_child_score,
            "position {moves:?}: score {score} does not match the max \
             over children's negated scores {best_child_score}"
        );
    }
}
