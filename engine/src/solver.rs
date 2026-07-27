//! Negamax with alpha-beta pruning, following Pascal Pons's published
//! bitboard solver (<http://blog.gamesolver.org/>) exactly. See
//! `docs/ENGINE.md` §Search for the required optimisations and the score
//! convention; this module implements them in the order specified there:
//!
//! 1. Alpha-beta (the baseline negamax below).
//! 2. Immediate win check -- [`Solver::solve`] returns without recursing at
//!    all if the position already has a winning move.
//! 3. Avoid-losing-moves pruning -- [`crate::position::Position::non_losing_moves`],
//!    which also forces a single reply when the opponent has exactly one
//!    unstoppable threat, and prunes the whole node to an immediate loss
//!    when the opponent has two or more.
//! 4. Centre-out move ordering -- `COLUMN_ORDER`.
//! 5. Transposition table -- `crate::tt`.
//! 6. Iterative deepening with null-window search -- the `min`/`max` score
//!    narrowing loop in [`Solver::solve`], each iteration a zero-width
//!    `negamax(pos, med, med + 1)` probe.
//! 7. Move ordering by threat count -- [`move_score`].
//!
//! **Score convention** (`docs/ENGINE.md`): positive means the player to
//! move wins; `score = 22 - stones_the_winner_will_have_played`; range
//! -18..=18; 0 is a draw. This module knows only "current" (player to
//! move) and "opponent" -- no colour names belong here.
//!
//! An important structural invariant worth stating explicitly, because it
//! is easy to "fix" by accident into a slower, redundant form: `negamax`
//! is only ever called on positions where the player to move does *not*
//! already have an immediate win. That invariant is established once, at
//! the top of [`Solver::solve`], and then maintained by construction --
//! every child position handed to a recursive `negamax` call comes from
//! `non_losing_moves()`, which by definition never hands the *next* player
//! (the opponent, who becomes "current" in the child) an immediately
//! playable winning square. There is deliberately no repeated
//! `can_win_next` check inside the recursive loop; the `debug_assert!` at
//! the top of `negamax` is what documents and checks that invariant.

use crate::position::{column_mask, winning_positions, Position, HEIGHT, WIDTH};
use crate::tt::{Bound, TranspositionTable};

/// Total playable cells on the board (7 * 6 = 42).
const TOTAL_CELLS: i32 = (WIDTH * HEIGHT) as i32;

/// Column visit order for move generation: centre-out. Cheap and, per
/// `docs/ENGINE.md`, a large effect on alpha-beta cutoff rate.
const COLUMN_ORDER: [u32; WIDTH as usize] = [3, 2, 4, 1, 5, 0, 6];

/// A reusable negamax searcher with its own transposition table.
///
/// Positions are searched by value (`Position` is `Copy`); nothing here
/// mutates or shares state across searches except the transposition table,
/// which is safe and beneficial to reuse across independent positions
/// (the key already uniquely identifies a position, regardless of which
/// search asked for it).
pub struct Solver {
    tt: TranspositionTable,
    nodes: u64,
}

impl Default for Solver {
    fn default() -> Self {
        Self::new()
    }
}

impl Solver {
    /// A solver with a transposition table sized to the ~64 MB budget in
    /// `docs/ENGINE.md`.
    pub fn new() -> Self {
        Solver {
            tt: TranspositionTable::with_byte_budget(crate::tt::DEFAULT_BYTE_BUDGET),
            nodes: 0,
        }
    }

    /// Build a solver with a caller-supplied transposition table (tests use
    /// this for smaller tables to keep debug runs fast).
    pub fn with_tt(tt: TranspositionTable) -> Self {
        Solver { tt, nodes: 0 }
    }

    /// Number of `negamax` calls made across every `solve` this solver has
    /// run. Exposed for benchmarking, not correctness.
    pub fn node_count(&self) -> u64 {
        self.nodes
    }

    /// The exact score of `pos`, from the perspective of the player to
    /// move, per `docs/ENGINE.md`'s convention.
    pub fn solve(&mut self, pos: &Position) -> i32 {
        // Optimisation 2: immediate win check. A very cheap test relative
        // to a full search, and one that fires often in practice (this is
        // called once per column per UI analysis, not just at the root of
        // a single search) -- see the module-level invariant note above
        // for why this never needs re-checking deeper in the tree.
        if pos.can_win_next() {
            return immediate_win_score(pos);
        }

        // Optimisation 6: iterative deepening via null-window search. This
        // is Pons's score-space binary search: repeatedly probe a
        // zero-width window `[med, med + 1]` and use whether the result
        // fails high or low to shrink `[min, max]` until they meet.
        let moves = pos.moves() as i32;
        let mut min = -(TOTAL_CELLS - moves) / 2;
        let mut max = (TOTAL_CELLS + 1 - moves) / 2;

        while min < max {
            let mut med = min + (max - min) / 2;
            if med <= 0 && min / 2 < med {
                med = min / 2;
            } else if med >= 0 && max / 2 > med {
                med = max / 2;
            }
            let r = self.negamax(pos, med, med + 1);
            if r <= med {
                max = r;
            } else {
                min = r;
            }
        }
        min
    }

    fn negamax(&mut self, pos: &Position, mut alpha: i32, mut beta: i32) -> i32 {
        debug_assert!(alpha < beta);
        debug_assert!(
            !pos.can_win_next(),
            "negamax must never be called on a position with an immediate win available; \
             the caller (solve(), or this function's own move loop via non_losing_moves) \
             is responsible for filtering those out first"
        );

        self.nodes += 1;

        let moves = pos.moves() as i32;

        // Optimisation 3: avoid-losing-moves pruning. `non_losing_moves`
        // both filters out moves that hand the opponent an immediate win
        // and collapses this node to a proven loss (empty return) when the
        // opponent already has two or more unstoppable threats.
        let possible = pos.non_losing_moves();
        if possible == 0 {
            return -(TOTAL_CELLS - moves) / 2;
        }

        // Every remaining cell will be filled with no winner: a draw.
        if moves >= TOTAL_CELLS - 2 {
            return 0;
        }

        // Tighten the window to the range of scores actually reachable
        // from here -- win-by-parent can't happen faster than `moves + 2`.
        let min = -(TOTAL_CELLS - 2 - moves) / 2;
        if alpha < min {
            alpha = min;
            if alpha >= beta {
                return alpha;
            }
        }
        let max = (TOTAL_CELLS - 1 - moves) / 2;
        if beta > max {
            beta = max;
            if alpha >= beta {
                return beta;
            }
        }

        // Optimisation 5: transposition table probe.
        let key = pos.key();
        if let Some(bound) = self.tt.get(key) {
            match bound {
                Bound::Exact(v) => return v,
                Bound::Lower(v) => {
                    if v > alpha {
                        alpha = v;
                        if alpha >= beta {
                            return alpha;
                        }
                    }
                }
                Bound::Upper(v) => {
                    if v < beta {
                        beta = v;
                        if alpha >= beta {
                            return beta;
                        }
                    }
                }
            }
        }

        // Optimisations 4 and 7: enumerate centre-out, then stable-sort by
        // threat count descending (ties keep the centre-out order).
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

        let original_alpha = alpha;
        for &(m, _) in candidates.iter() {
            let mut child = *pos;
            child.play_move(m);
            // See the module-level invariant note: `child.can_win_next()`
            // is guaranteed false here by construction of `non_losing_moves`.
            let score = -self.negamax(&child, -beta, -alpha);

            if score >= beta {
                self.tt.insert(key, Bound::Lower(score));
                return score;
            }
            if score > alpha {
                alpha = score;
            }
        }

        let bound = if alpha > original_alpha {
            Bound::Exact(alpha)
        } else {
            Bound::Upper(alpha)
        };
        self.tt.insert(key, bound);
        alpha
    }
}

/// The score of a position that already has a winning move available: the
/// player to move wins with their very next stone.
fn immediate_win_score(pos: &Position) -> i32 {
    (TOTAL_CELLS + 1 - pos.moves() as i32) / 2
}

/// Number of winning squares the move `m` (a single-bit destination mask)
/// would create for the player to move, if played. Used to order moves
/// within a node by how many future threats they open up. Pons's
/// `moveScore`.
fn move_score(pos: &Position, m: u64) -> u32 {
    winning_positions(pos.current() | m, pos.mask() | m).count_ones()
}

/// Convenience one-shot solve with a freshly built solver and transposition
/// table. Prefer reusing a [`Solver`] (e.g. across the fixture sets in
/// `tests/reference.rs`, or across the 7 columns of one UI analysis call)
/// when solving more than one position.
pub fn solve(pos: &Position) -> i32 {
    Solver::new().solve(pos)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Connect Four from an empty board is a proven first-player win (Allen
    /// 1989, Allis 1988), *not* a draw -- an assumption this test got wrong
    /// on the first pass, caught only by actually measuring it (see
    /// `docs/ENGINE.md`'s "empty board" performance note and this crate's
    /// top-level report for the measured time and node count). Score 1
    /// means the win is razor-thin: the winning side needs every one of
    /// their 21 stones under perfect defence.
    ///
    /// A full solve of the empty board is also the single most expensive
    /// position in the entire game tree -- measured at over a minute in
    /// release, let alone debug. It has no place in the always-run debug
    /// suite; run it via `cargo test --release -- --ignored --include-ignored`.
    #[test]
    #[ignore = "full game-tree solve; run in release: cargo test --release -- --ignored --include-ignored"]
    fn empty_board_is_a_first_player_win_by_the_narrowest_margin() {
        let pos = Position::new();
        assert_eq!(solve(&pos), 1);
    }

    #[test]
    fn a_position_with_an_immediate_win_scores_it_without_searching() {
        // "273747": the player to move plays columns 1,2,3 (0-indexed) on
        // row 0 -- three in a row, open at both ends -- while the
        // opponent stacks discs in column 6 out of the way. Column 0 or 4
        // now completes a horizontal four immediately. This check must
        // short-circuit through `can_win_next` rather than fall through to
        // a full search, so it stays fast in debug mode too.
        let pos = Position::from_moves("273747").unwrap();
        assert!(
            pos.can_win_next(),
            "test fixture position should have an immediate win available"
        );
        assert_eq!(solve(&pos), immediate_win_score(&pos));
    }

    #[test]
    fn reusing_a_solver_across_positions_gives_the_same_answers_as_fresh_ones() {
        // Deliberately near-end-of-game (few cells left empty): this runs
        // in debug mode as part of the fast `cargo test` suite, and
        // unoptimised negamax on a near-empty board can take minutes.
        // These two lines are End-Easy fixtures from
        // `tests/fixtures/test_l3_r1.txt` (fewer than 14 cells left to
        // fill), which keeps the search tree tiny regardless of build
        // profile. Full-strength correctness across every difficulty is
        // proven by `tests/reference.rs` in release mode.
        let positions = [
            "2252576253462244111563365343671351441",
            "7422341735647741166133573473242566",
        ];
        let mut shared = Solver::new();
        for moves in positions {
            let pos = Position::from_moves(moves).unwrap();
            let shared_score = shared.solve(&pos);
            let fresh_score = Solver::new().solve(&pos);
            assert_eq!(
                shared_score, fresh_score,
                "solving {moves:?} with a reused solver must match a fresh one"
            );
        }
    }
}
