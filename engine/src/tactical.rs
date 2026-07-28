//! Tactical fallback: `docs/SPEC.md` §3.1's 2026-07-28 post-gate amendment.
//!
//! When the budgeted `analyse` search hits its node cap without completing
//! every column, the game layer needs SOME complete, honest signal it can
//! safely act on -- not a choice among whichever columns happened to
//! finish under a deep-but-partial search, which is exactly the defect
//! class the owner reproduced live ("ignored an open-ended three-across at
//! move 8 because the refuting columns were unsolved"). This module is
//! that signal: a search bounded by PLY DISTANCE rather than node count,
//! so it is exhaustive -- and therefore provably correct -- within its
//! horizon, and honest about anything past it (scored as a draw, never
//! guessed at with a heuristic).
//!
//! **Deliberately independent of `solver::negamax`.** That function's core
//! is pinned untouched by this wave's brief ("book consultation and
//! tactical search sit beside it, not inside it"). This is a genuinely
//! different search (a ply budget, not a node budget, and a different
//! terminal rule -- horizon-as-draw instead of unbounded), so it earns its
//! own small alpha-beta implementation rather than threading a second stop
//! condition through the existing one. It reuses `Position`'s pub(crate)
//! move-generation helpers (`non_losing_moves`, `can_win_next`, `possible`,
//! `play_move`) -- the same primitives `solver.rs` uses -- so both engines
//! agree on what a "legal, non-immediately-losing move" is; only the
//! recursion's stop condition differs.
//!
//! ## Horizon semantics (a judgement call, recorded explicitly)
//!
//! `max_ply` in [`tactical_analyse`] is the number of plies searched
//! **from each child position** (i.e. AFTER the move into the column being
//! evaluated), mirroring exactly how `analysis::analyse` hands each child
//! the same `node_budget` rather than charging it for the "free" act of
//! playing the move itself. So `max_ply` plies of total search happen
//! beyond the move actually played -- `max_ply + 1` plies of information
//! from the analysed root, in total, including that move. SPEC.md's
//! amendment does not pin this convention explicitly; this choice keeps
//! the two budgeted searches structurally consistent with each other,
//! which matters because Wave 9's game layer will call both from the same
//! site under the same cap-expiry logic.

use serde::Serialize;

use crate::book::Book;
use crate::position::{column_mask, winning_positions, Position, WIDTH};

/// Total playable cells on the board (7 * 6 = 42) -- same constant
/// `solver.rs` derives, recomputed independently here rather than exposed
/// from that module, to keep this module self-contained.
const TOTAL_CELLS: i32 = (WIDTH * crate::position::HEIGHT) as i32;

/// Column visit order for move generation: centre-out, same rationale and
/// same order as `solver.rs`'s `COLUMN_ORDER` (a large effect on
/// alpha-beta cutoff rate, cheap to apply).
const COLUMN_ORDER: [u32; WIDTH as usize] = [3, 2, 4, 1, 5, 0, 6];

/// The score of a position that already has a winning move available.
/// Same one-line formula as `solver.rs`'s private `immediate_win_score`,
/// reimplemented here (not exposed from `solver.rs`) to keep this module
/// independent of that one's internals.
fn immediate_win_score(pos: &Position) -> i32 {
    (TOTAL_CELLS + 1 - pos.moves() as i32) / 2
}

/// Number of winning squares the move `m` would create if played -- used
/// only for move ordering (more threats first), never for scoring: this
/// module returns exact values or an honest horizon-draw, never a
/// heuristic evaluation.
fn move_score(pos: &Position, m: u64) -> u32 {
    winning_positions(pos.current() | m, pos.mask() | m).count_ones()
}

/// The exhaustive-within-`remaining_plies` score of `pos`, from the
/// perspective of the player to move. Three outcomes only, per the "no
/// heuristic evaluation" requirement:
///
/// - A proven win or loss, exact, if it resolves within `remaining_plies`
///   (or "for free": an already-immediate win/loss/draw costs nothing,
///   exactly as in `solver.rs`'s negamax -- see the module doc comment).
/// - `0` for a genuine draw (the board fills with no winner).
/// - `0` for a position that is NOT resolved within `remaining_plies` --
///   indistinguishable, by design, from a genuine draw: the horizon is
///   honestly reported as "unknown, treated as a draw", never as a guess
///   at which side is actually better.
fn tactical_score(pos: &Position, remaining_plies: u32, mut alpha: i32, beta: i32) -> i32 {
    debug_assert!(alpha < beta);

    // Free, exact terminal checks -- identical in spirit to solver.rs's
    // negamax, and not gated by `remaining_plies`: these facts are already
    // knowable about `pos` itself without searching any deeper.
    if pos.can_win_next() {
        return immediate_win_score(pos);
    }
    let moves = pos.moves() as i32;
    let possible = pos.non_losing_moves();
    if possible == 0 {
        // Every legal move hands the opponent an immediate win: a forced
        // loss, same convention as solver.rs's negamax.
        return -(TOTAL_CELLS - moves) / 2;
    }
    if moves >= TOTAL_CELLS - 2 {
        // Fewer than two cells remain and neither side has an immediate
        // win: the board fills with no winner. A REAL draw, not a
        // horizon-truncation one, though the two are represented
        // identically (both `0`) per this function's contract.
        return 0;
    }

    // Genuinely undecided and requires looking further ahead: if the
    // horizon is exhausted, this is exactly the "treated as a draw"
    // case the SPEC amendment calls for.
    if remaining_plies == 0 {
        return 0;
    }

    let mut candidates: [(u64, u32); WIDTH as usize] = [(0, 0); WIDTH as usize];
    let mut count = 0usize;
    for &col in COLUMN_ORDER.iter() {
        let m = possible & column_mask(col);
        if m != 0 {
            candidates[count] = (m, move_score(pos, m));
            count += 1;
        }
    }
    let candidates = &mut candidates[..count];
    candidates.sort_by_key(|&(_, score)| std::cmp::Reverse(score));

    for &(m, _) in candidates.iter() {
        let mut child = *pos;
        child.play_move(m);
        // `non_losing_moves()` already guarantees `child` has no
        // immediate win available to its own mover, same invariant
        // solver.rs's negamax relies on.
        let score = -tactical_score(&child, remaining_plies - 1, -beta, -alpha);
        if score >= beta {
            return score;
        }
        if score > alpha {
            alpha = score;
        }
    }
    alpha
}

/// The exact-within-horizon score of `pos` itself (not a per-column
/// breakdown). Exposed for direct testing and for
/// [`tactical_analyse_with_book`]'s per-column loop.
pub fn tactical_search(pos: &Position, max_ply: u32) -> i32 {
    let moves = pos.moves() as i32;
    let alpha = -(TOTAL_CELLS - moves) / 2;
    let beta = (TOTAL_CELLS + 1 - moves) / 2;
    tactical_score(pos, max_ply, alpha, beta)
}

/// One column's tactical-fallback outcome. Unlike `analysis::ColumnEval`,
/// there is no `Unknown` variant: a complete fixed-depth search always
/// produces a value for every legal column (score-or-honest-horizon-draw),
/// by construction -- that completeness is the entire point of this
/// module.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TacticalEval {
    /// Exact within the search horizon (or an honest horizon-draw), from
    /// the perspective of the player to move in the ANALYSED position --
    /// same "negated child score" point-of-view convention as
    /// `analysis::AnalysisResult`.
    Score { score: i32 },
    /// The column is already full: no move exists there.
    Full,
}

/// The full result of one `tactical_analyse` call.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TacticalAnalysis {
    /// Length 7, index = 0-based column.
    pub columns: Vec<TacticalEval>,
    /// 0-based; `None` only when every column is `Full` (no legal move at
    /// all). Lowest-column tie-break among equal scores, matching
    /// `analysis::analyse`'s convention.
    pub best: Option<u32>,
}

/// Tactical fallback with no book consulted -- equivalent to
/// `tactical_analyse_with_book(pos, max_ply, None)`. Kept as its own
/// function (rather than requiring every caller to pass `None`) purely for
/// caller convenience.
pub fn tactical_analyse(pos: &Position, max_ply: u32) -> TacticalAnalysis {
    tactical_analyse_with_book(pos, max_ply, None)
}

/// Tactical fallback, book-aware: per `docs/ENGINE.md`, "book consulted
/// before search wherever a position is solved/analysed". For each legal
/// column, the resulting child position is looked up in `book` FIRST; a
/// hit is the book's own ground-truth score (not horizon-limited at all,
/// strictly more informative than the fallback search), used directly. A
/// miss (including `book: None`, i.e. absent or deliberately disabled --
/// see `lib.rs`'s permanent book-disabled flag) falls through to
/// [`tactical_search`].
pub fn tactical_analyse_with_book(
    pos: &Position,
    max_ply: u32,
    book: Option<&Book>,
) -> TacticalAnalysis {
    let mut columns = Vec::with_capacity(WIDTH as usize);
    for col in 0..WIDTH {
        if !pos.can_play(col) {
            columns.push(TacticalEval::Full);
            continue;
        }
        let mut child = *pos;
        child.play(col);

        let child_score = book
            .and_then(|b| b.lookup(&child))
            .unwrap_or_else(|| tactical_search(&child, max_ply));

        columns.push(TacticalEval::Score {
            score: -child_score,
        });
    }

    let best = best_column(&columns);

    TacticalAnalysis { columns, best }
}

/// Lowest-column tie-break among the maximum score, matching
/// `analysis::analyse`'s `best_column` convention. `None` iff every column
/// is `Full` (a completely filled board has nothing to recommend).
fn best_column(columns: &[TacticalEval]) -> Option<u32> {
    let mut best_idx = None;
    let mut best_score = i32::MIN;
    for (i, c) in columns.iter().enumerate() {
        if let TacticalEval::Score { score } = c {
            if *score > best_score {
                best_score = *score;
                best_idx = Some(i as u32);
            }
        }
    }
    best_idx
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::solver::{solve as solve_free, Solver};

    /// End-Easy fixtures, same rationale as `solver.rs`/`analysis.rs`'s own
    /// tests: fewer than 14 cells left to fill keeps the tree tiny
    /// regardless of build profile, so these are safe to run un-ignored in
    /// debug mode.
    const END_EASY: &[&str] = &[
        "2252576253462244111563365343671351441",
        "7422341735647741166133573473242566",
    ];

    /// A generous `max_ply` on a near-end-of-game position must agree
    /// exactly with the full, unbounded solver -- the horizon is wide
    /// enough to cover the whole rest of the game, so there is nothing
    /// left for it to truncate.
    #[test]
    fn a_generous_horizon_matches_the_full_solver_on_shallow_positions() {
        for &moves in END_EASY {
            let pos = Position::from_moves(moves).unwrap();
            let expected = solve_free(&pos);
            // `TOTAL_CELLS` plies is always enough to reach the end of any
            // game from any position.
            let actual = tactical_search(&pos, TOTAL_CELLS as u32);
            assert_eq!(
                actual, expected,
                "{moves:?}: tactical_search with a generous horizon should match the full solve"
            );
        }
    }

    #[test]
    fn each_scored_column_is_the_negated_direct_tactical_search_of_its_child() {
        let pos = Position::from_moves(END_EASY[0]).unwrap();
        let result = tactical_analyse(&pos, TOTAL_CELLS as u32);
        for col in 0..WIDTH {
            if !pos.can_play(col) {
                assert_eq!(result.columns[col as usize], TacticalEval::Full);
                continue;
            }
            let mut child = pos;
            child.play(col);
            let direct = tactical_search(&child, TOTAL_CELLS as u32);
            match result.columns[col as usize] {
                TacticalEval::Score { score } => assert_eq!(score, -direct),
                other => panic!("column {col}: expected a Score, got {other:?}"),
            }
        }
    }

    #[test]
    fn a_full_column_reports_full_not_a_score() {
        let pos = Position::from_moves("111111").unwrap(); // fills column 0
        assert!(!pos.can_play(0));
        let result = tactical_analyse(&pos, 4);
        assert_eq!(result.columns[0], TacticalEval::Full);
    }

    #[test]
    fn best_ties_break_towards_the_lowest_column_index() {
        // The empty board is left-right symmetric, so every column's
        // tactical score at a shallow, uniform horizon is identical (or at
        // least column 0's is tied for the max across some horizon) --
        // rather than relying on that coincidence, directly construct the
        // tie case against the TacticalEval type.
        let columns = vec![
            TacticalEval::Score { score: 3 },
            TacticalEval::Full,
            TacticalEval::Score { score: 5 },
            TacticalEval::Score { score: 5 },
            TacticalEval::Score { score: 1 },
            TacticalEval::Full,
            TacticalEval::Score { score: 5 },
        ];
        assert_eq!(best_column(&columns), Some(2), "lowest-index column among the tied maximum (5) is column 2");
    }

    #[test]
    fn best_is_none_when_every_column_is_full() {
        let columns = vec![TacticalEval::Full; 7];
        assert_eq!(best_column(&columns), None);
    }

    /// Determinism: repeated calls with identical inputs must produce
    /// byte-identical results. Nothing in this module reads global mutable
    /// state, but this is exactly the kind of property that silently rots
    /// under a careless future change (e.g. iterating a `HashMap`), so it
    /// is pinned directly.
    #[test]
    fn tactical_analyse_is_deterministic_across_repeated_calls() {
        let pos = Position::from_moves("2273").unwrap();
        let first = tactical_analyse(&pos, 6);
        let second = tactical_analyse(&pos, 6);
        assert_eq!(first, second);
    }

    // -------------------------------------------------------------
    // The owner's move-8 defect repro class: an open-ended three that a
    // shallow-but-complete search must refute, together with the horizon
    // boundary (N vs N+1) that same construction exposes for free.
    //
    // Construction, hand-verified: moves "7375" (0-indexed cols 6,2,6,4)
    // reaches a position at ply 4 where the mover ("A", first player) has
    // two harmless stacked discs in column 6 and the opponent ("O",
    // second player) has a SPLIT two -- discs at column 2 and column 4,
    // row 0, with column 3 (between them) and columns 1/5 (the eventual
    // open ends) all still empty. Neither side has an immediate threat
    // yet (`can_win_next` false, `non_losing_moves` non-empty for A), so
    // resolving this position requires real look-ahead, not a free
    // static check:
    //
    //   - If A plays anywhere irrelevant (e.g. column 0) and O then plays
    //     column 3, O completes an OPEN three across columns 2-3-4 (both
    //     column 1 and column 5 empty) -- an unstoppable double threat.
    //     That is discovered 2 plies past the root position (A's bad
    //     move, then O's column-3 reply), which is exactly 1 ply of
    //     RECURSION inside `tactical_search`'s search over column 0's
    //     child (O's reply is the one node it must expand to see the
    //     forced loss two plies later resolves via a free `non_losing_
    //     moves` check at the grandchild, costing no further budget).
    // -------------------------------------------------------------

    const TRAP_ROOT: &str = "7375";

    #[test]
    fn the_root_trap_position_is_not_resolved_by_a_free_static_check() {
        // Sanity check on the hand-derived construction itself: if this
        // fails, the position doesn't actually require search (the test
        // below would then be vacuous).
        let pos = Position::from_moves(TRAP_ROOT).unwrap();
        assert!(!pos.can_win_next(), "trap root should have no immediate win for the mover");
        assert_ne!(pos.non_losing_moves(), 0, "trap root should not already be a forced loss");
    }

    /// "Open-ended three must be refuted at small N": at horizon 1 (small
    /// by any measure), a column that ignores the developing open three
    /// (column 0, an arbitrary far-away move) must be flagged as a severe
    /// loss for the mover, while the blocking column (3, denying the
    /// opponent the split) must not be.
    #[test]
    fn an_open_ended_three_in_the_making_is_refuted_at_a_small_horizon() {
        let pos = Position::from_moves(TRAP_ROOT).unwrap();
        let result = tactical_analyse(&pos, 1);

        let ignoring_the_threat = match result.columns[0] {
            TacticalEval::Score { score } => score,
            other => panic!("column 0 should be a Score, got {other:?}"),
        };
        let blocking_the_split = match result.columns[3] {
            TacticalEval::Score { score } => score,
            other => panic!("column 3 should be a Score, got {other:?}"),
        };

        assert!(
            ignoring_the_threat < -10,
            "ignoring the developing open three (column 0) must score as a severe loss at horizon 1, got {ignoring_the_threat}"
        );
        assert!(
            blocking_the_split > ignoring_the_threat,
            "blocking the split (column 3) must score better than ignoring the threat: \
             blocking={blocking_the_split}, ignoring={ignoring_the_threat}"
        );
    }

    /// Horizon boundary, exact: the SAME construction, one ply shorter of
    /// horizon, must fail to see the trap at all (an honest horizon-draw,
    /// `0`) -- proving the earlier test's refutation genuinely depends on
    /// having enough horizon, not on some free static check that would
    /// have caught it regardless of `max_ply`.
    #[test]
    fn the_same_trap_is_invisible_one_ply_short_of_the_horizon_that_refutes_it() {
        let pos = Position::from_moves(TRAP_ROOT).unwrap();

        let too_shallow = tactical_analyse(&pos, 0);
        let ignoring_at_n0 = match too_shallow.columns[0] {
            TacticalEval::Score { score } => score,
            other => panic!("column 0 should be a Score, got {other:?}"),
        };
        assert_eq!(
            ignoring_at_n0, 0,
            "at horizon 0 the trap must be invisible (honest horizon-draw), got {ignoring_at_n0}"
        );

        let deep_enough = tactical_analyse(&pos, 1);
        let ignoring_at_n1 = match deep_enough.columns[0] {
            TacticalEval::Score { score } => score,
            other => panic!("column 0 should be a Score, got {other:?}"),
        };
        assert!(
            ignoring_at_n1 < -10,
            "at horizon 1 the SAME column must now be refuted, got {ignoring_at_n1}"
        );
    }

    /// A second, independent horizon-boundary proof: rather than relying
    /// solely on the one hand-derived trap above, empirically find the
    /// minimal horizon at which a real (fixture-adjacent) position's
    /// tactical score first matches its fully-solved value, using the
    /// already fixture-proven `Solver` as the oracle. Below that minimal
    /// horizon the tactical score must be `0` (unresolved); at and above
    /// it, it must match exactly and stay matching (monotonic
    /// convergence). Guards against the boundary test class being an
    /// artefact of one specific hand-built position.
    #[test]
    fn a_real_positions_tactical_score_converges_to_the_full_solve_at_a_discoverable_horizon() {
        let moves = END_EASY[0];
        let pos = Position::from_moves(moves).unwrap();
        let expected = solve_free(&pos);
        assert_ne!(expected, 0, "test needs a decisive (non-draw) position to prove a boundary exists");

        let mut minimal_matching_horizon = None;
        for n in 0..=(TOTAL_CELLS as u32) {
            let actual = tactical_search(&pos, n);
            if actual == expected {
                minimal_matching_horizon = Some(n);
                break;
            }
            assert_eq!(
                actual, 0,
                "before the position resolves, tactical_search must report an honest horizon-draw (0), got {actual} at horizon {n}"
            );
        }
        let n_min = minimal_matching_horizon
            .expect("a generous horizon (TOTAL_CELLS) must eventually match the full solve");

        // The boundary itself: one ply short must NOT yet match (unless
        // n_min is 0, i.e. it was already resolved for free).
        if n_min > 0 {
            assert_eq!(
                tactical_search(&pos, n_min - 1),
                0,
                "one ply short of the discovered minimal horizon must still be an honest horizon-draw"
            );
        }
        // And it must stay matching for a larger horizon too (monotonic).
        assert_eq!(tactical_search(&pos, n_min + 1), expected);
    }

    // -------------------------------------------------------------
    // Book integration: ruling 3 requires the fallback tested with the
    // book both ABSENT and present-but-DISABLED (`None` in both cases at
    // this layer -- `lib.rs` owns the "disabled" representation, this
    // module only ever sees `Option<&Book>`), proving the path is
    // exercised deliberately rather than only incidentally skipped
    // because no book happened to be loaded.
    // -------------------------------------------------------------

    #[test]
    fn book_absent_matches_the_book_agnostic_entry_point_exactly() {
        let pos = Position::from_moves(END_EASY[1]).unwrap();
        let with_none = tactical_analyse_with_book(&pos, 6, None);
        let plain = tactical_analyse(&pos, 6);
        assert_eq!(with_none, plain);
    }

    #[test]
    fn a_book_hit_is_used_directly_and_overrides_the_horizon_limited_search() {
        // Build a position whose tactical_search at a TINY horizon would
        // NOT yet resolve (an honest 0), then plant a book entry for the
        // CHILD of column 3 with a score that could only have come from
        // the book (not from the shallow search), proving the book is
        // actually consulted rather than merely not contradicted.
        let pos = Position::from_moves(TRAP_ROOT).unwrap();
        let mut child = pos;
        child.play(3);

        let planted_score: i8 = -7; // deliberately not derivable from a 0-ply search
        let canon = crate::book::canonical_key(child.key());
        let book_bytes = build_test_book(8, &[(canon, planted_score)]);
        let book = crate::book::Book::load(&book_bytes).unwrap();

        let result = tactical_analyse_with_book(&pos, 0, Some(&book));
        let column_3 = match result.columns[3] {
            TacticalEval::Score { score } => score,
            other => panic!("column 3 should be a Score, got {other:?}"),
        };
        assert_eq!(
            column_3, -(planted_score as i32),
            "a book hit must be used directly (negated for the parent's POV), not overridden by the horizon search"
        );
    }

    /// Minimal, self-contained v1 book byte builder for this module's own
    /// book-integration test, independent of `book.rs`'s own test-module
    /// builder (that one is `#[cfg(test)]`-private to `book.rs`).
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

    // Reuse the full solver as ground truth for one more cross-check: at
    // a horizon covering the ENTIRE remaining game, tactical_analyse's
    // best column must be at least as good as the true best (it can never
    // FIND a better one than reality, only fail to see far enough -- and
    // at a generous-enough horizon it always sees far enough).
    #[test]
    fn a_generous_horizon_recommends_a_column_matching_the_full_solvers_verdict() {
        use crate::analysis::{analyse, ColumnEval};

        let pos = Position::from_moves(END_EASY[1]).unwrap();
        let mut solver = Solver::new();
        let full = analyse(&mut solver, &pos, 1_000_000);
        let tactical = tactical_analyse(&pos, TOTAL_CELLS as u32);

        for col in 0..WIDTH {
            match (&full.columns[col as usize], &tactical.columns[col as usize]) {
                (ColumnEval::Full, TacticalEval::Full) => {}
                (ColumnEval::Score { score: a }, TacticalEval::Score { score: b }) => {
                    assert_eq!(a, b, "column {col}: full-analysis score and generous-horizon tactical score must agree");
                }
                (a, b) => panic!("column {col}: mismatched shapes {a:?} vs {b:?}"),
            }
        }
    }
}
