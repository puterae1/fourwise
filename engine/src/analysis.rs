//! The `analyse` core: the data behind `docs/ENGINE.md`'s `AnalysisResult`,
//! built natively (no `wasm_bindgen` in this module) so it is directly
//! testable with `cargo test`. `src/lib.rs` wraps [`analyse`] in a thin
//! `#[wasm_bindgen]` function that serialises [`AnalysisResult`] with
//! `serde_wasm_bindgen`.
//!
//! Every decision here is pinned by the amended §WASM boundary of
//! `docs/ENGINE.md` (2026-07-28):
//!
//! - 0-indexed columns and squares throughout.
//! - `columns[i].score` is the CHILD position's score negated -- i.e. from
//!   the analysed position's mover's point of view, not the mover-after-
//!   playing-column-`i`'s point of view -- **except** when column `i`
//!   itself completes a four-in-a-row for the analysed position's mover.
//!   That case is scored DIRECTLY (see `immediate_win_score` and the guard
//!   at the top of `analyse_with_book`'s per-column loop), never by
//!   negating a solved or booked child: the child of a winning move is
//!   already terminal, and handing a terminal position to the solver or
//!   the book violates the precondition both rely on -- that a position
//!   handed to them never already contains a just-completed alignment for
//!   the player who moved into it (Wave 11 fix, 2026-07-29; see
//!   `docs/ENGINE.md`'s amended per-column pin for the defect this
//!   corrects and `docs/STATUS.md`'s "Post-Phase-2 findings" item 4 for
//!   the original report).
//! - `best` is `None` unless every non-full column is a `Score`.
//! - `sideToMove` is `'first'` iff an even number of plies have been
//!   played -- a ply-parity fact about the position, not the seat model
//!   (which lives entirely in the game/web layer).
//! - `threats` uses the raw bitboard index `col * WIDTH_STRIDE + row`
//!   (`row` 0 at the bottom), which is exactly the bit position
//!   `winning_positions` already returns -- no re-encoding needed.
//! - `nodes` is nodes spent in *this* call only (the `Solver`'s node
//!   counter is cumulative over its whole lifetime, per the
//!   transposition-table-reuse pin, so this module differences it).
//! - No `elapsedMs` anywhere: the engine is clock-free by construction.

use serde::Serialize;

use crate::book::Book;
use crate::position::{winning_positions, Position, WIDTH};
use crate::solver::Solver;

/// One column's analysis outcome. Tagged so it serialises to exactly the
/// TS union in `docs/ENGINE.md`:
/// `{ kind: 'score', score } | { kind: 'full' } | { kind: 'unknown' }`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ColumnEval {
    /// Exact score, from the perspective of the player to move in the
    /// *analysed* position (i.e. the negation of the child position's own
    /// score -- see the module doc comment's "score point of view" pin).
    Score { score: i32 },
    /// The column is already full: no move exists there.
    Full,
    /// The node budget was exhausted before this column's score was
    /// proven. Per SPEC's "no placeholder data" rule, this must be
    /// rendered honestly as still-thinking, never as a guessed score.
    Unknown,
}

/// `docs/ENGINE.md`: `'first'` iff an even number of plies have been
/// played so far -- deliberately not a colour, and deliberately a fact
/// about ply count rather than about which bitboard is `current`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum SideToMove {
    First,
    Second,
}

/// Winning-square indices for both sides, 0-based `col * 7 + row` (row 0 at
/// the bottom, sentinel row never included -- `winning_positions` already
/// excludes it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Threats {
    /// Squares that would complete a four for the player to move.
    pub current: Vec<u32>,
    /// Squares that would complete a four for the player NOT to move.
    pub opponent: Vec<u32>,
}

/// The full result of one `analyse` call, matching `docs/ENGINE.md`'s
/// `AnalysisResult` TS interface field-for-field (`serde` handles the
/// `camelCase` rename at the WASM boundary).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResult {
    /// Length 7, index = 0-based column.
    pub columns: Vec<ColumnEval>,
    /// 0-based; `None` unless every non-full column is `Score`.
    pub best: Option<u32>,
    /// `true` iff no column is `Unknown`.
    pub complete: bool,
    pub side_to_move: SideToMove,
    pub threats: Threats,
    /// Nodes actually spent in this call (not the solver's lifetime total).
    pub nodes: u32,
}

/// Analyse every legal column of `pos`, spending at most `node_budget`
/// total nodes across all seven columns (immediate wins are free -- see
/// `Solver::solve_budgeted`'s doc comment). `solver` is expected to be
/// long-lived and reused across calls: its transposition table persists,
/// which is what makes a later call with a bigger budget cheaper than
/// starting over (`docs/ENGINE.md`'s TT-lifetime pin).
///
/// Equivalent to `analyse_with_book(solver, pos, node_budget, None)` --
/// kept as its own function, with its own signature UNCHANGED by this
/// wave, so every pre-existing test in this module keeps compiling and
/// passing byte-for-byte against the pre-book behaviour.
pub fn analyse(solver: &mut Solver, pos: &Position, node_budget: u32) -> AnalysisResult {
    analyse_with_book(solver, pos, node_budget, None)
}

/// `analyse`, but consulting `book` first for each column's child position
/// (`docs/ENGINE.md`: "book consulted before search wherever a position is
/// solved/analysed; on hit, the score is used directly"). A book hit costs
/// no node budget at all -- it is a direct table lookup, not a search --
/// so `budget_remaining` is only ever spent on columns the book misses.
/// `book: None` (absent, or deliberately disabled -- see `lib.rs`'s
/// permanent book-disabled flag) falls through to exactly the pre-book
/// `solve_budgeted` path, so this is provably behaviourally identical to
/// `analyse` in that case -- see this module's
/// `book_none_matches_the_book_agnostic_analyse_exactly` test.
pub fn analyse_with_book(
    solver: &mut Solver,
    pos: &Position,
    node_budget: u32,
    book: Option<&Book>,
) -> AnalysisResult {
    let call_start_nodes = solver.node_count();
    let mut budget_remaining = node_budget as u64;

    let mut columns = Vec::with_capacity(WIDTH as usize);
    for col in 0..WIDTH {
        if !pos.can_play(col) {
            columns.push(ColumnEval::Full);
            continue;
        }

        // Wave 11 guard: a column that completes four-in-a-row for `pos`'s
        // own mover must be scored DIRECTLY, before any book lookup and
        // before any solve of the resulting child. The child of a winning
        // move is already terminal -- `Solver::solve_budgeted` (and a book
        // lookup, which is only ever populated with non-terminal positions
        // per `docs/ENGINE.md`'s book format) both assume the position
        // they are handed does NOT already contain a just-completed
        // alignment for the player who moved into it. Solving or
        // book-looking-up an already-won child violates that precondition
        // silently and returns a fictional score -- this is exactly the
        // defect this guard exists to close. See this module's
        // `an_immediate_win_column_is_scored_directly_never_solved` test.
        if pos.is_winning_move(col) {
            columns.push(ColumnEval::Score {
                score: immediate_win_score(pos),
            });
            continue;
        }

        let mut child = *pos;
        child.play(col);

        if let Some(book_score) = book.and_then(|b| b.lookup(&child)) {
            columns.push(ColumnEval::Score {
                score: -book_score,
            });
            continue;
        }

        let before = solver.node_count();
        let outcome = solver.solve_budgeted(&child, budget_remaining);
        let spent = solver.node_count() - before;
        budget_remaining = budget_remaining.saturating_sub(spent);

        columns.push(match outcome {
            // Score point of view pin: this column's score, from the
            // ANALYSED position's mover's perspective, is the negation of
            // the child's own score.
            Some(child_score) => ColumnEval::Score {
                score: -child_score,
            },
            None => ColumnEval::Unknown,
        });
    }

    let complete = columns
        .iter()
        .all(|c| !matches!(c, ColumnEval::Unknown));

    let best = best_column(&columns);

    let side_to_move = if pos.moves().is_multiple_of(2) {
        SideToMove::First
    } else {
        SideToMove::Second
    };

    let opponent = pos.mask() ^ pos.current();
    let threats = Threats {
        current: bits_to_squares(winning_positions(pos.current(), pos.mask())),
        opponent: bits_to_squares(winning_positions(opponent, pos.mask())),
    };

    let nodes = (solver.node_count() - call_start_nodes) as u32;

    AnalysisResult {
        columns,
        best,
        complete,
        side_to_move,
        threats,
        nodes,
    }
}

/// The score of a column that completes a four-in-a-row for `pos`'s own
/// mover, computed directly rather than by playing/solving/booking the
/// resulting (already-terminal) child -- see the Wave 11 guard in
/// `analyse_with_book`. `docs/ENGINE.md`'s score convention:
/// `score = 22 - stones_the_winner_will_have_played`, and the winner here
/// is `pos`'s own mover, who will have played
/// `stones_of_mover_after_move = floor(pos.moves() / 2) + 1` stones once
/// this move lands.
///
/// **Must always agree with `solver.rs`'s private `immediate_win_score`**,
/// which computes this exact convention for the same underlying case (a
/// position with `can_win_next() == true`, scored directly from that
/// position rather than by negating a child) -- there must be exactly one
/// convention for "the score of a position whose mover just won", not two
/// independently-typed formulas that could drift apart. Proven equal (via
/// `solver::solve`, since `solver.rs`'s formula is private to that module)
/// by this module's `immediate_win_score_agrees_with_the_solvers_own_formula`
/// test.
fn immediate_win_score(pos: &Position) -> i32 {
    let stones_of_mover_after_move = pos.moves() / 2 + 1;
    22 - stones_of_mover_after_move as i32
}

/// `docs/ENGINE.md`: `best` is `None` unless every non-full column is
/// `Score` (an `Unknown` column anywhere means "not yet decidable"; a board
/// made entirely of `Full` columns has nothing to recommend). Ties broken
/// towards the lowest column index -- not specified by the amended spec,
/// so recorded here as the judgement call it is.
fn best_column(columns: &[ColumnEval]) -> Option<u32> {
    let mut any_scored = false;
    let mut best_idx = None;
    let mut best_score = i32::MIN;
    for (i, c) in columns.iter().enumerate() {
        match c {
            ColumnEval::Score { score } => {
                any_scored = true;
                if *score > best_score {
                    best_score = *score;
                    best_idx = Some(i as u32);
                }
            }
            ColumnEval::Full => {}
            ColumnEval::Unknown => return None,
        }
    }
    if any_scored {
        best_idx
    } else {
        None
    }
}

/// Convert a winning-positions bitmask into a sorted list of 0-based
/// `col * 7 + row` square indices. `winning_positions` already masks out
/// the sentinel row and every occupied cell, so every set bit here is a
/// genuine, currently-empty, playable-eventually square.
fn bits_to_squares(bits: u64) -> Vec<u32> {
    (0..49u32).filter(|&i| bits & (1u64 << i) != 0).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::solve as solve_free;

    /// End-Easy fixtures (see `tests/reference.rs` / `src/solver.rs`'s own
    /// tests for why these are safe to run un-ignored in debug mode: fewer
    /// than 14 cells left to fill keeps the tree tiny regardless of build
    /// profile).
    const END_EASY: &[&str] = &[
        "2252576253462244111563365343671351441",
        "7422341735647741166133573473242566",
    ];

    /// (a) Per-column point of view, split by case: a HAND-DERIVED direct
    /// score (computed inline here, NOT by calling this module's own
    /// `immediate_win_score` -- reusing the function under test would make
    /// the assertion tautological) for every column that itself completes
    /// four-in-a-row, and a negated direct solve of the resulting child for
    /// every non-terminal column.
    ///
    /// **Provenance note (Wave 11).** The ORIGINAL version of this test
    /// (Wave 3) asserted every scored column against `-solve(child)`
    /// unconditionally, with no winning-column branch at all -- because
    /// that IS what the original (buggy) implementation did for every
    /// column, the test necessarily agreed with it. Both `END_EASY`
    /// fixtures below happen to have ZERO winning columns among their
    /// legal moves (confirmed directly: `Position::is_winning_move` is
    /// `false` for every legal column of both), so the original test
    /// validated the implementation against exactly the rule it
    /// implemented and never exercised the winning-move case at all --
    /// vacuous for the immediate-win defect class this wave fixes
    /// (`docs/STATUS.md`'s "Post-Phase-2 findings" item 4; see also
    /// `docs/ENGINE.md`'s amended per-column pin). This rewritten version
    /// keeps the `END_EASY` fixtures for the non-terminal branch (still a
    /// real, useful assertion) and adds `MIXED_WIN_AND_SEARCH`, a fixture
    /// with both a genuinely winning column and ordinary non-terminal
    /// columns, to exercise the branch the original never reached.
    #[test]
    fn each_scored_column_is_correct_for_its_case_direct_win_or_negated_child_solve() {
        // Also one of the four gamesolver-verified regression fixtures
        // below; reused here because it is hand-confirmed (via
        // `Position::is_winning_move`) to have exactly one winning column
        // (4, 0-indexed) alongside six ordinary non-terminal ones.
        const MIXED_WIN_AND_SEARCH: &str = "1264234";

        let mut fixtures: Vec<&str> = END_EASY.to_vec();
        fixtures.push(MIXED_WIN_AND_SEARCH);

        let mut solver = Solver::new();
        for &moves in &fixtures {
            let pos = Position::from_moves(moves).unwrap();
            // "1264234" is a much earlier-game (harder to fully solve)
            // position than the END_EASY fixtures, hence the larger
            // budget -- same figure the regression test below needs for
            // the same fixture.
            let result = analyse(&mut solver, &pos, 5_000_000);
            assert!(
                result.complete,
                "{moves:?}: expected a generous budget to complete every column"
            );
            for col in 0..WIDTH {
                if !pos.can_play(col) {
                    assert_eq!(result.columns[col as usize], ColumnEval::Full);
                    continue;
                }
                if pos.is_winning_move(col) {
                    // Hand-derived independently of `immediate_win_score`:
                    // docs/ENGINE.md's convention is
                    // `score = 22 - stones_the_winner_will_have_played`,
                    // and the mover here will have played
                    // `floor(pos.moves() / 2) + 1` stones once this move
                    // lands.
                    let expected = 22 - (pos.moves() / 2 + 1) as i32;
                    assert_eq!(
                        result.columns[col as usize],
                        ColumnEval::Score { score: expected },
                        "{moves:?} column {col}: a winning move must score the direct win \
                         value, never a negated child solve"
                    );
                } else {
                    let mut child = pos;
                    child.play(col);
                    let direct = solve_free(&child);
                    assert_eq!(
                        result.columns[col as usize],
                        ColumnEval::Score { score: -direct },
                        "{moves:?} column {col}: expected -{direct} (negated child solve), got {:?}",
                        result.columns[col as usize]
                    );
                }
            }
        }
    }

    /// This module's `immediate_win_score` must agree with `solver.rs`'s
    /// own private formula of the same name -- both express
    /// `docs/ENGINE.md`'s single "22 - stones" convention for a position
    /// with an immediate win, and must never drift into two different
    /// numbers for the same case. `solver.rs`'s formula is private to that
    /// module, so the independent proof goes through `solver::solve`
    /// (which returns exactly that formula's value for any position with
    /// `can_win_next() == true`, per `solve_inner`'s own short-circuit).
    #[test]
    fn immediate_win_score_agrees_with_the_solvers_own_formula() {
        let positions = [
            "273747",
            "1264234",
            "353676321354762",
            "612375344567673432",
            "1451336251725537574",
        ];
        for &moves in &positions {
            let pos = Position::from_moves(moves).unwrap();
            assert!(
                pos.can_win_next(),
                "{moves:?}: fixture should already have an immediate win for its own mover"
            );
            let solved = solve_free(&pos);
            assert_eq!(
                immediate_win_score(&pos),
                solved,
                "{moves:?}: this module's immediate_win_score must agree with the solver's own"
            );
        }
    }

    /// The Wave 11 guard's whole point: a winning column must be resolved
    /// for free, exactly like `docs/ENGINE.md`'s budget-exempt
    /// immediate-win pin already promises for the position-level
    /// `Solver::solve_budgeted`. A budget of ZERO is enough to prove the
    /// column was never handed to the solver (which would report
    /// `Unknown` under a budget this tight for anything requiring real
    /// search) or to a book (there is none here) -- it can only have come
    /// from the direct-score guard.
    #[test]
    fn an_immediate_win_column_is_scored_directly_even_under_a_zero_node_budget() {
        let pos = Position::from_moves("1264234").unwrap();
        assert!(pos.is_winning_move(4));
        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 0);
        assert_eq!(
            result.columns[4],
            ColumnEval::Score { score: 18 },
            "the winning column must be resolved for free, per docs/ENGINE.md's \
             budget-exempt immediate-win pin"
        );
    }

    /// (4a) Regression: the four gamesolver-verified positions where the
    /// pre-Wave-11 defect (solving an already-won child instead of scoring
    /// the winning move directly) produced a WRONG per-column array,
    /// confirmed by diffing against connect4.gamesolver.org on 2026-07-29
    /// (`docs/STATUS.md`'s "Post-Phase-2 findings" item 4). Ground truth
    /// columns below are gamesolver's own 1-indexed convention (column 1 =
    /// leftmost), transcribed directly into this crate's 0-indexed
    /// `ColumnEval` vec (index 0 = column 1) -- no other conversion:
    /// gamesolver's score convention already matches this engine's
    /// (positive = the side to move wins, magnitude = speed). None of
    /// these four positions has a full column.
    #[test]
    fn regression_gamesolver_verified_full_column_arrays() {
        let cases: &[(&str, [i32; 7])] = &[
            ("1264234", [-2, -3, 7, 3, 18, -5, -6]),
            ("353676321354762", [-13, -13, -13, 0, -13, 14, -13]),
            ("612375344567673432", [11, 11, 12, 11, 11, 12, 11]),
            ("1451336251725537574", [11, -11, -10, 12, -10, -10, 11]),
        ];
        let mut solver = Solver::new();
        for &(moves, expected) in cases {
            let pos = Position::from_moves(moves).unwrap();
            let result = analyse(&mut solver, &pos, 5_000_000);
            assert!(
                result.complete,
                "{moves:?}: expected a generous budget to complete every column"
            );
            for (col, &want) in expected.iter().enumerate() {
                assert_eq!(
                    result.columns[col],
                    ColumnEval::Score { score: want },
                    "{moves:?} column {col}: expected {want} (gamesolver ground truth), got {:?}",
                    result.columns[col]
                );
            }
        }
    }

    /// (4b) The "throw away the win" scenario: a position whose ONLY
    /// WINNING move (not merely one of several) is an immediate win --
    /// `best` must pick it rather than a non-losing but non-winning
    /// alternative. "353676321354762" (also one of the four regression
    /// fixtures above; ground truth `[-13,-13,-13,0,-13,14,-13]`) is the
    /// right vehicle for this specifically because column 5 (0-indexed) is
    /// the UNIQUE column with a positive score in the whole array -- every
    /// other legal column is either a loss (-13) or, at best, a draw (0,
    /// column 3). `"1264234"` (used in an earlier draft of this test) does
    /// NOT actually pin this scenario: its ground truth
    /// `[-2,-3,7,3,18,-5,-6]` has THREE winning columns (3, 4, and 7 in
    /// gamesolver's 1-indexed notation), so even garbage per-column scoring
    /// that merely failed to negate the immediate win would still have left
    /// `best` landing on some winning column there -- the pre-Wave-11
    /// defect (guardless code scoring the winning column as `-14` instead
    /// of `+14`) would, on THIS fixture, have handed `best` to the
    /// column-3 draw instead, which is exactly the failure mode this test
    /// exists to catch.
    #[test]
    fn the_only_winning_column_is_selected_as_best() {
        let pos = Position::from_moves("353676321354762").unwrap();
        assert!(
            pos.is_winning_move(5),
            "column 5 (0-indexed) should be this fixture's one immediate win"
        );

        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 1_000_000);
        assert!(result.complete, "expected a generous budget to complete every column");

        assert_eq!(
            result.columns[5],
            ColumnEval::Score { score: 14 },
            "column 5 must score the direct win value (22 - 8 stones), got {:?}",
            result.columns[5]
        );
        for col in 0..WIDTH {
            if col == 5 {
                continue;
            }
            match result.columns[col as usize] {
                ColumnEval::Score { score } => assert!(
                    score <= 0,
                    "column {col} should be a loss or a draw at best, got {score}"
                ),
                ColumnEval::Full => {}
                ColumnEval::Unknown => panic!("column {col} should be resolved under a generous budget"),
            }
        }

        assert_eq!(
            result.best,
            Some(5),
            "the unique winning column must be selected, not a non-winning alternative"
        );
    }

    /// (4c) An immediate win competing with a slower (search-proven,
    /// non-immediate) win: "612375344567673432" has two immediate-win
    /// columns (2 and 5, both scoring 12, confirmed via
    /// `Position::is_winning_move`) and several columns that still win for
    /// the mover but only via deeper forced play (scoring 11 -- positive,
    /// so a genuine win, but strictly lower, i.e. slower). The immediate
    /// win must score strictly higher, and `best` (lowest-index tie-break
    /// among the two immediate wins) must select column 2.
    #[test]
    fn an_immediate_win_scores_higher_than_a_slower_win_and_is_selected() {
        let pos = Position::from_moves("612375344567673432").unwrap();
        assert!(
            pos.is_winning_move(2),
            "column 2 should be an immediate win in this fixture"
        );
        assert!(
            !pos.is_winning_move(0),
            "column 0 should NOT be an immediate win (it wins only via deeper search)"
        );

        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 1_000_000);

        let immediate = match result.columns[2] {
            ColumnEval::Score { score } => score,
            other => panic!("column 2 should be a Score, got {other:?}"),
        };
        let slower = match result.columns[0] {
            ColumnEval::Score { score } => score,
            other => panic!("column 0 should be a Score, got {other:?}"),
        };
        assert!(
            slower > 0,
            "column 0 should still be a genuine (if slower) win for the mover, got {slower}"
        );
        assert!(
            immediate > slower,
            "the immediate win (col 2, {immediate}) must score strictly higher than the \
             slower win (col 0, {slower})"
        );
        assert_eq!(
            result.best,
            Some(2),
            "lowest-index tie-break among the two immediate-win columns (2 and 5)"
        );
    }

    /// (b) Budget behaviour, low end: a tiny (in fact zero) budget must
    /// leave at least one non-immediate-win, non-full column `Unknown` and
    /// report `complete: false`.
    #[test]
    fn a_tiny_budget_yields_unknown_columns_and_incomplete() {
        let pos = Position::from_moves(END_EASY[0]).unwrap();
        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 0);
        assert!(!result.complete);
        assert!(
            result
                .columns
                .iter()
                .any(|c| matches!(c, ColumnEval::Unknown)),
            "expected at least one Unknown column under a zero node budget, got {:?}",
            result.columns
        );
    }

    /// (b) Budget behaviour, high end: a generous budget completes, and
    /// every scored column matches its expected score for its case --
    /// negated direct solve for a non-terminal column, hand-derived direct
    /// win value for a column that itself completes four (Wave 11: the
    /// original unconditional `-solve(child)` oracle here would silently
    /// mis-grade a fixture with a winning column, so the case split is
    /// applied even though `END_EASY[1]` happens to have none).
    #[test]
    fn a_generous_budget_completes_and_matches_direct_solves() {
        let pos = Position::from_moves(END_EASY[1]).unwrap();
        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 1_000_000);
        assert!(result.complete);
        for col in 0..WIDTH {
            if !pos.can_play(col) {
                continue;
            }
            if pos.is_winning_move(col) {
                let expected = 22 - (pos.moves() / 2 + 1) as i32;
                assert_eq!(result.columns[col as usize], ColumnEval::Score { score: expected });
            } else {
                let mut child = pos;
                child.play(col);
                let direct = solve_free(&child);
                assert_eq!(result.columns[col as usize], ColumnEval::Score { score: -direct });
            }
        }
    }

    /// (c) Budget monotonicity / restart: re-issuing `analyse` on the SAME
    /// solver (transposition table warm) with a bigger budget must
    /// complete even when the first, tiny-budget call did not. Same
    /// case-split oracle as the test above, for the same reason.
    #[test]
    fn a_bigger_budget_on_the_same_solver_completes_after_a_tiny_one_did_not() {
        let pos = Position::from_moves(END_EASY[0]).unwrap();
        let mut solver = Solver::new();

        let first = analyse(&mut solver, &pos, 0);
        assert!(!first.complete);

        let second = analyse(&mut solver, &pos, 1_000_000);
        assert!(second.complete, "re-issue with a much larger budget must complete");

        for col in 0..WIDTH {
            if !pos.can_play(col) {
                continue;
            }
            if pos.is_winning_move(col) {
                let expected = 22 - (pos.moves() / 2 + 1) as i32;
                assert_eq!(second.columns[col as usize], ColumnEval::Score { score: expected });
            } else {
                let mut child = pos;
                child.play(col);
                let direct = solve_free(&child);
                assert_eq!(second.columns[col as usize], ColumnEval::Score { score: -direct });
            }
        }
    }

    /// (d) `sideToMove` parity: even ply count is `'first'`, odd is
    /// `'second'` -- a fact about the position string, independent of
    /// colour or seat.
    #[test]
    fn side_to_move_matches_ply_parity() {
        let mut solver = Solver::new();

        let empty = Position::new();
        assert_eq!(
            analyse(&mut solver, &empty, 1).side_to_move,
            SideToMove::First
        );

        let one_ply = Position::from_moves("4").unwrap();
        assert_eq!(
            analyse(&mut solver, &one_ply, 1).side_to_move,
            SideToMove::Second
        );

        let two_ply = Position::from_moves("44").unwrap();
        assert_eq!(
            analyse(&mut solver, &two_ply, 1).side_to_move,
            SideToMove::First
        );

        let three_ply = Position::from_moves("445").unwrap();
        assert_eq!(
            analyse(&mut solver, &three_ply, 1).side_to_move,
            SideToMove::Second
        );
    }

    /// (e) Threats correctness on a hand-crafted position with known
    /// winning squares. "273747" (also used in `src/solver.rs`'s tests) is
    /// the player to move having three in a row across columns 1-3
    /// (0-indexed), row 0, open at both ends -- columns 0 and 4 are the
    /// two winning squares, both at row 0 (bitboard index `col * 7 + 0`).
    /// The opponent has stacked three discs in column 6 (rows 0-2), which
    /// *is* itself a live vertical threat -- the empty cell directly above
    /// (column 6, row 3, index `6 * 7 + 3 = 45`) would complete their four
    /// if they got to play it. (Caught by first writing this test with the
    /// wrong expectation -- "three stacked discs, no threat yet" -- and
    /// having it fail: three-in-a-column is exactly one disc short of a
    /// vertical four, which is a threat by definition.)
    #[test]
    fn threats_reports_the_known_winning_squares() {
        let pos = Position::from_moves("273747").unwrap();
        assert!(pos.can_win_next(), "test fixture should have live threats");

        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 1_000_000);

        let mut current = result.threats.current.clone();
        current.sort_unstable();
        assert_eq!(current, vec![0, 28], "column 0 and column 4, both row 0");

        let mut opponent = result.threats.opponent.clone();
        opponent.sort_unstable();
        assert_eq!(
            opponent,
            vec![45],
            "column 6 row 3: directly above the opponent's stacked three"
        );
    }

    /// (f) Full-column reporting: a column filled solid (6 discs,
    /// alternating players so there is no vertical four) must report
    /// `ColumnEval::Full`, distinct from a real score of any magnitude.
    #[test]
    fn a_full_column_reports_full_not_a_score() {
        // "1111111": fills column 0 (0-indexed) with 6 alternating discs
        // (no four-in-a-row, since consecutive discs alternate owners),
        // then the 7th "1" is illegal and never reached because
        // `from_moves` would reject it -- so this uses exactly 6 characters
        // to land the last stone and leave column 0 full without playing a
        // 7th move into it.
        let pos = Position::from_moves("111111").unwrap();
        assert!(!pos.can_play(0), "column 0 should be full after 6 plays");

        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 5_000);
        assert_eq!(result.columns[0], ColumnEval::Full);
    }

    /// The case that motivates the budget pin itself: an unbudgeted full
    /// solve of the empty board takes ~115s (`docs/ENGINE.md`'s measured
    /// figure). 1000 nodes is nowhere near enough to prove a single column
    /// from here, so every one of the 7 (all non-full) columns must come
    /// back honestly `Unknown` rather than a guess, and the result as a
    /// whole must not claim `complete` or offer a `best`.
    #[test]
    fn the_empty_board_under_a_tiny_budget_is_all_unknown_and_incomplete() {
        let pos = Position::new();
        let mut solver = Solver::new();
        let result = analyse(&mut solver, &pos, 1_000);

        assert!(!result.complete);
        assert_eq!(result.best, None);
        for (col, eval) in result.columns.iter().enumerate() {
            assert_eq!(
                *eval,
                ColumnEval::Unknown,
                "column {col}: expected Unknown under a 1000-node budget from the empty board, got {eval:?}"
            );
        }
    }

    /// Cross-position TT reuse must never corrupt results: analysing A,
    /// then a different position B, then A again on the SAME `Solver`
    /// (same warm transposition table) must give A the identical answer
    /// both times -- every field except `nodes` (which legitimately
    /// differs, since the table is warmer the second time A is analysed).
    #[test]
    fn analysing_a_then_b_then_a_again_gives_a_the_same_answer_both_times() {
        let a = Position::from_moves(END_EASY[0]).unwrap();
        let b = Position::from_moves(END_EASY[1]).unwrap();
        let mut solver = Solver::new();

        let first_a = analyse(&mut solver, &a, 1_000_000);
        assert!(first_a.complete, "A should complete under a generous budget");

        let result_b = analyse(&mut solver, &b, 1_000_000);
        assert!(result_b.complete, "B should complete under a generous budget");

        let second_a = analyse(&mut solver, &a, 1_000_000);
        assert!(second_a.complete, "A should still complete the second time");

        assert_eq!(first_a.columns, second_a.columns);
        assert_eq!(first_a.best, second_a.best);
        assert_eq!(first_a.complete, second_a.complete);
        assert_eq!(first_a.side_to_move, second_a.side_to_move);
        assert_eq!(first_a.threats, second_a.threats);
        // `nodes` is deliberately excluded from this comparison -- the
        // second call over a warm TT is expected to spend fewer nodes,
        // not the same number.
    }

    // -------------------------------------------------------------
    // Book integration (Wave 8). All additive: none of the tests above
    // this point are modified.
    // -------------------------------------------------------------

    /// Minimal, self-contained v1 book byte builder for this module's own
    /// tests -- independent of `book.rs`'s own `#[cfg(test)]`-private
    /// builder, and of `tools/gen_book.rs`'s writer.
    fn build_test_book(depth: u8, entries: &[(u64, i8)]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"FWBK");
        out.push(1u8); // version
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

    /// `book: None` must be behaviourally identical to the pre-book
    /// `analyse` on sampled positions -- the equivalence
    /// `docs/ENGINE.md`'s absent/disabled requirement asks for. This
    /// doesn't just call the same code path (that would be tautological,
    /// since `analyse` is defined as `analyse_with_book(.., None)`); it
    /// independently re-asserts field-by-field equality so a future change
    /// that splits the two code paths would still be caught.
    #[test]
    fn book_none_matches_the_book_agnostic_analyse_exactly() {
        for &moves in END_EASY {
            let pos = Position::from_moves(moves).unwrap();
            let mut solver_a = Solver::new();
            let mut solver_b = Solver::new();
            let via_analyse = analyse(&mut solver_a, &pos, 1_000_000);
            let via_with_book_none = analyse_with_book(&mut solver_b, &pos, 1_000_000, None);
            assert_eq!(via_analyse.columns, via_with_book_none.columns);
            assert_eq!(via_analyse.best, via_with_book_none.best);
            assert_eq!(via_analyse.complete, via_with_book_none.complete);
            assert_eq!(via_analyse.side_to_move, via_with_book_none.side_to_move);
            assert_eq!(via_analyse.threats, via_with_book_none.threats);
            assert_eq!(via_analyse.nodes, via_with_book_none.nodes);
        }
    }

    /// A book hit must be used DIRECTLY (no search at all -- zero nodes
    /// spent on that column) and must match the position's true solved
    /// score, proving the book path is genuinely exercised rather than
    /// merely not contradicted.
    #[test]
    fn a_book_hit_is_used_directly_with_zero_nodes_spent_on_that_column() {
        let pos = Position::from_moves(END_EASY[0]).unwrap();
        // Column 3 (0-indexed) is legal from this fixture position (few
        // cells left, but not full); build a child and get its TRUE score
        // from the already fixture-proven solver as ground truth.
        let col = (0..WIDTH).find(|&c| pos.can_play(c)).expect("at least one legal column");
        let mut child = pos;
        child.play(col);
        let true_child_score = crate::solver::solve(&child);

        let canon = crate::book::canonical_key(child.key());
        // `depth` set past this fixture's own ply (37+) rather than a
        // realistic book depth of 8: this test's fixture is deliberately
        // an END_EASY position (few cells left, so the search is cheap
        // enough to run un-ignored in debug), which is far past any real
        // book's generated depth -- the `depth` field is only a fast-path
        // hint (docs/ENGINE.md), so declaring it generously here just
        // avoids that hint short-circuiting the lookup this test exists
        // to prove, without weakening what's actually being tested (the
        // binary search + score-used-directly behaviour).
        let book_bytes = build_test_book(60, &[(canon, true_child_score as i8)]);
        let book = Book::load(&book_bytes).unwrap();

        let mut solver = Solver::new();
        // A budget of 0: if the book is NOT consulted, this column would
        // have to come back Unknown (or, if it happens to be an immediate
        // win, still cost the free win-check but never touch the book
        // path this test is trying to prove) -- a budget this tight only
        // succeeds if the book hit is what resolved it.
        let result = analyse_with_book(&mut solver, &pos, 0, Some(&book));

        assert_eq!(
            result.columns[col as usize],
            ColumnEval::Score { score: -true_child_score },
            "a book hit must resolve the column directly under a zero node budget"
        );
    }

    /// The "disabled" half of ruling 3's book-absent/disabled distinction
    /// lives one layer up (`lib.rs` owns the enabled/disabled flag; this
    /// module only ever sees `Option<&Book>`) -- but the equivalence this
    /// module is responsible for is that a `Some(&book)` that MISSES for
    /// every child position behaves identically to `None`, which is what
    /// "disabled" ultimately reduces to at this layer once `lib.rs`
    /// resolves the flag to a book reference.
    #[test]
    fn a_book_that_misses_every_child_matches_book_none_exactly() {
        let pos = Position::from_moves(END_EASY[1]).unwrap();
        // A book with real entries, but for keys that cannot possibly
        // match any child of this fixture position (chosen far outside
        // any real Position::key() range reachable from it).
        let unrelated_bytes = build_test_book(8, &[(999_999_999_998, -5), (999_999_999_999, 5)]);
        let unrelated_book = Book::load(&unrelated_bytes).unwrap();

        let mut solver_a = Solver::new();
        let mut solver_b = Solver::new();
        let with_missing_book = analyse_with_book(&mut solver_a, &pos, 1_000_000, Some(&unrelated_book));
        let with_none = analyse_with_book(&mut solver_b, &pos, 1_000_000, None);

        assert_eq!(with_missing_book.columns, with_none.columns);
        assert_eq!(with_missing_book.best, with_none.best);
        assert_eq!(with_missing_book.complete, with_none.complete);
    }
}

