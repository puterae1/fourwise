//! Bitboard representation of a Connect Four position.
//!
//! Follows Pascal Pons's published bitboard scheme
//! (<http://blog.gamesolver.org/solving-connect-four/06-bitboard/>): two
//! `u64` bitboards, seven bits per column (six playable rows plus one
//! sentinel row). The sentinel row is what lets alignment checks use plain
//! shifts without discs in one column wrapping into the neighbouring
//! column. It must never be removed.
//!
//! This module is colour-blind by design: it knows only "current" (the
//! player about to move) and the aggregate `mask` of every disc on the
//! board. Nothing here or anywhere else in `engine/` may know about red or
//! yellow.

use std::error::Error;
use std::fmt;

/// Board width in columns.
pub const WIDTH: u32 = 7;
/// Board height in playable rows (the sentinel row is not counted here).
pub const HEIGHT: u32 = 6;

/// Bit of the lowest (row 0) cell of `col`.
const fn bottom_mask(col: u32) -> u64 {
    1u64 << (col * (HEIGHT + 1))
}

/// Mask of every playable cell in `col` (rows 0..HEIGHT), sentinel excluded.
///
/// `pub(crate)` so the solver can isolate a single column's candidate move
/// out of a wider "possible moves" bitmask for centre-out ordering.
pub(crate) const fn column_mask(col: u32) -> u64 {
    ((1u64 << HEIGHT) - 1) << (col * (HEIGHT + 1))
}

/// Bit of the sentinel cell at the top of `col` (row HEIGHT).
const fn top_mask(col: u32) -> u64 {
    1u64 << ((HEIGHT - 1) + col * (HEIGHT + 1))
}

/// Mask of every playable cell on the board (all columns, sentinels
/// excluded). Used to recover "empty playable cells" from `mask`.
const fn board_mask() -> u64 {
    let mut m = 0u64;
    let mut col = 0u32;
    while col < WIDTH {
        m |= column_mask(col);
        col += 1;
    }
    m
}

/// Sum of every column's bottom-cell bit. Adding this to `mask` and masking
/// with `board_mask()` is the standard bitboard trick for computing, in one
/// shot, the single lowest empty cell in every column (Pons's
/// `possible()`): each column's stack of set bits plus one more bottom bit
/// carries up to exactly the next empty slot.
const fn bottom_mask_all() -> u64 {
    let mut m = 0u64;
    let mut col = 0u32;
    while col < WIDTH {
        m |= bottom_mask(col);
        col += 1;
    }
    m
}

/// Error returned by [`Position::from_moves`] when a move string cannot be
/// applied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionError {
    /// A character in the move string was not an ASCII digit.
    InvalidDigit(char),
    /// The digit did not name one of the seven columns (1-7).
    ColumnOutOfRange(char),
    /// The move named a column that was already full.
    ColumnFull(u32),
}

impl fmt::Display for PositionError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PositionError::InvalidDigit(c) => write!(f, "'{c}' is not a digit"),
            PositionError::ColumnOutOfRange(c) => {
                write!(f, "'{c}' does not name a column in 1..=7")
            }
            PositionError::ColumnFull(col) => write!(f, "column {col} (0-indexed) is full"),
        }
    }
}

impl Error for PositionError {}

/// A Connect Four position.
///
/// `current` holds the discs belonging to the player about to move;
/// `mask` holds every disc on the board, of either player. The player who
/// is *not* `current` occupies `mask ^ current`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Position {
    current: u64,
    mask: u64,
    moves: u32,
}

impl Default for Position {
    fn default() -> Self {
        Self::new()
    }
}

impl Position {
    /// An empty board, first player to move.
    pub fn new() -> Position {
        Position {
            current: 0,
            mask: 0,
            moves: 0,
        }
    }

    /// Ply count: how many discs have been played so far.
    pub fn moves(&self) -> u32 {
        self.moves
    }

    /// Whether `col` (0-indexed) can legally receive a disc.
    pub fn can_play(&self, col: u32) -> bool {
        col < WIDTH && (self.mask & top_mask(col)) == 0
    }

    /// Play a disc into `col` (0-indexed).
    ///
    /// The caller is responsible for checking [`Position::can_play`] first;
    /// playing into a full or out-of-range column is a logic error and
    /// will corrupt the bitboard rather than panic.
    pub fn play(&mut self, col: u32) {
        self.current ^= self.mask;
        self.mask |= self.mask + bottom_mask(col);
        self.moves += 1;
    }

    /// A key that uniquely identifies this position: no two distinct
    /// reachable positions may ever produce the same key.
    pub fn key(&self) -> u64 {
        self.current + self.mask
    }

    /// Discs belonging to the player about to move. `pub(crate)`: the
    /// solver needs raw bitboard access; nothing outside `engine/` should.
    pub(crate) fn current(&self) -> u64 {
        self.current
    }

    /// Every occupied cell, either player.
    pub(crate) fn mask(&self) -> u64 {
        self.mask
    }

    /// Bitmask of the single lowest empty (playable) cell in every column
    /// that is not already full. Pons's `possible()`.
    pub(crate) fn possible(&self) -> u64 {
        (self.mask + bottom_mask_all()) & board_mask()
    }

    /// Whether the player to move has a legal move that completes a
    /// four-in-a-row right now.
    pub(crate) fn can_win_next(&self) -> bool {
        winning_positions(self.current, self.mask) & self.possible() != 0
    }

    /// Whether playing `col` (0-indexed) right now would itself complete a
    /// four-in-a-row for the player about to move -- a per-column
    /// refinement of `can_win_next` (which only answers "does *some*
    /// column win", not "does *this* column win").
    ///
    /// Needed by `analysis::analyse_with_book` and
    /// `tactical::tactical_analyse_with_book`, both of which must score a
    /// winning column DIRECTLY and must never solve or book-look-up the
    /// position that results from playing it: the position after an
    /// already-winning move is terminal, and handing a terminal position
    /// to the searcher (or treating it as an ordinary book key) violates
    /// the precondition every recursive search in this crate relies on --
    /// that a position handed to it never already contains a
    /// just-completed alignment for the player who moved into it. Callers
    /// must check `can_play(col)` first; a full column's `possible()` bit
    /// is already zero, so this returns `false` for it regardless.
    pub(crate) fn is_winning_move(&self, col: u32) -> bool {
        let landing = self.possible() & column_mask(col);
        winning_positions(self.current, self.mask) & landing != 0
    }

    /// Bitmask of candidate moves for the player to move that do not hand
    /// the opponent an immediate winning reply.
    ///
    /// Returns 0 if every legal move loses immediately (the opponent has
    /// two or more unstoppable winning threats). The caller must not
    /// interpret 0 as "no legal moves" without also checking `possible()`;
    /// in practice the search treats "no non-losing move" as a forced loss
    /// regardless of which case produced it.
    ///
    /// Precondition (debug-asserted by the caller, the search): the player
    /// to move must not already be able to win immediately -- see
    /// `can_win_next`. Pons's `possibleNonLosingMoves`.
    pub(crate) fn non_losing_moves(&self) -> u64 {
        let mut possible_mask = self.possible();
        let opponent = self.current ^ self.mask;
        let opponent_win = winning_positions(opponent, self.mask);
        let forced_moves = possible_mask & opponent_win;
        if forced_moves != 0 {
            if forced_moves & (forced_moves - 1) != 0 {
                // The opponent has two or more distinct winning squares:
                // we can block at most one of them, so every move loses.
                return 0;
            }
            // Exactly one forced move: it is the only candidate worth
            // considering, everything else hands the opponent the win.
            possible_mask = forced_moves;
        }
        // Never play directly underneath one of the opponent's winning
        // squares: doing so would make that square playable on their very
        // next turn.
        possible_mask & !(opponent_win >> 1)
    }

    /// Play a move given directly as a single-bit destination mask (as
    /// produced by `possible()` / `non_losing_moves()`), rather than a
    /// column index. Equivalent to `play`, just skipping the "find the
    /// lowest empty cell" addition trick since the caller already has it.
    pub(crate) fn play_move(&mut self, move_mask: u64) {
        self.current ^= self.mask;
        self.mask |= move_mask;
        self.moves += 1;
    }

    /// Parse the standard notation: a string of column digits 1-7 in play
    /// order (digit `'1'` is the leftmost column, mapped to internal
    /// column index 0). Rejects non-digit characters, out-of-range
    /// columns, and moves into a full column.
    pub fn from_moves(moves: &str) -> Result<Position, PositionError> {
        let mut pos = Position::new();
        for c in moves.chars() {
            let digit = c.to_digit(10).ok_or(PositionError::InvalidDigit(c))?;
            if !(1..=WIDTH).contains(&digit) {
                return Err(PositionError::ColumnOutOfRange(c));
            }
            let col = digit - 1;
            if !pos.can_play(col) {
                return Err(PositionError::ColumnFull(col));
            }
            pos.play(col);
        }
        Ok(pos)
    }
}

/// Whether the bitboard `pos` (discs belonging to a single player) contains
/// four in a row in any direction.
///
/// The four shift distances cover every direction on the 7-bit-per-column
/// layout: 1 = vertical, 7 = horizontal, 6 = diagonal `\`, 8 = diagonal
/// `/`. Each relies on the sentinel row to stop a run from wrapping across
/// a column boundary.
pub fn alignment(pos: u64) -> bool {
    for &d in &[1u32, 6, 7, 8] {
        let m = pos & (pos >> d);
        if m & (m >> (2 * d)) != 0 {
            return true;
        }
    }
    false
}

/// The bitmask of every empty cell that would complete a four-in-a-row for
/// the player occupying `current`, given the overall `mask` of filled
/// cells. Used for immediate-win detection, move ordering, and rendering
/// threat squares in the UI.
pub fn winning_positions(current: u64, mask: u64) -> u64 {
    // Vertical: three stacked discs threaten the cell directly above them.
    let mut r = (current << 1) & (current << 2) & (current << 3);

    // Horizontal (shift = HEIGHT + 1 = 7).
    let mut p = (current << (HEIGHT + 1)) & (current << (2 * (HEIGHT + 1)));
    r |= p & (current << (3 * (HEIGHT + 1)));
    r |= p & (current >> (HEIGHT + 1));
    p = (current >> (HEIGHT + 1)) & (current >> (2 * (HEIGHT + 1)));
    r |= p & (current << (HEIGHT + 1));
    r |= p & (current >> (3 * (HEIGHT + 1)));

    // Diagonal '\' (shift = HEIGHT = 6).
    p = (current << HEIGHT) & (current << (2 * HEIGHT));
    r |= p & (current << (3 * HEIGHT));
    r |= p & (current >> HEIGHT);
    p = (current >> HEIGHT) & (current >> (2 * HEIGHT));
    r |= p & (current << HEIGHT);
    r |= p & (current >> (3 * HEIGHT));

    // Diagonal '/' (shift = HEIGHT + 2 = 8).
    p = (current << (HEIGHT + 2)) & (current << (2 * (HEIGHT + 2)));
    r |= p & (current << (3 * (HEIGHT + 2)));
    r |= p & (current >> (HEIGHT + 2));
    p = (current >> (HEIGHT + 2)) & (current >> (2 * (HEIGHT + 2)));
    r |= p & (current << (HEIGHT + 2));
    r |= p & (current >> (3 * (HEIGHT + 2)));

    // Only empty cells count as "winning positions" to play into.
    r & (board_mask() ^ mask)
}

/// Seat-model proof, engine side: colour independence.
///
/// **A finding worth recording explicitly, not papering over.**
/// `docs/ENGINE.md` and this wave's delegation prompt both ask for a test
/// proving: "the same position constructed with either side to move
/// produces evaluations that are exact negations of each other." That
/// claim, read as stated -- take one real position, relabel which
/// bitboard is `current`, expect the score to negate -- is mathematically
/// false for this game, not merely hard to construct. The cleanest proof
/// is the empty board itself, needing no test code at all: `current = 0`
/// and `mask = 0`, so swapping `current` for `mask ^ current` yields `0`
/// again -- literally the *same* position, not a different one. The
/// property as stated would demand `solve(empty) == -solve(empty)`, i.e. a
/// score of 0 (a draw). But Connect Four from an empty board is a proven,
/// decisive first-player win (Allen 1989, Allis 1988) -- this crate's own
/// `solver::tests::empty_board_is_a_first_player_win_by_the_narrowest_margin`
/// measures it at exactly `1`, not `0`.
///
/// The trivial case rules out the claim outright, but it's worth explaining
/// *why* it's false in general, since "relabel current/opponent" sounds
/// like it should obviously be a symmetry: `current` and `opponent` in a
/// real position almost never have symmetric threat structures (one side's
/// discs threaten different squares than the other's, precisely because
/// they were placed at different points in a real, ordered game). Asking
/// "what if it were the *other* side's turn on this exact board" is not a
/// relabelling of one decision problem -- it is a genuinely different
/// decision problem, because whoever moves next inherits a different set
/// of threats to navigate. Two increasingly careful attempts to construct
/// a valid instance confirmed this empirically before this doc comment
/// was written to explain why the attempts were abandoned:
///
/// 1. Take a real fixture position, keep `mask` and `moves`, swap which
///    bitboard is `current`. Falsified: position
///    `"7422341735647741166133573473242566"` scores `1`; the swapped
///    version scored `-2`, not `-1`.
/// 2. Restrict to positions reached after an *even* number of moves (ruling
///    out the half of the problem where the swapped side would have played
///    *more* stones than the mover, which is not even a well-formed
///    reachable state). Still falsified, using two independently-played,
///    equally legal real games -- `"14"` and its reversal `"41"`, both
///    even-length, all-distinct-column sequences that were verified (by
///    directly inspecting the private fields, which is why this lives here
///    rather than in `tests/reference.rs`) to reach the identical `mask`
///    with `current` and `opponent` exactly swapped. `"14"` scores `-2`;
///    `"41"` scores `-4`. Not a negation.
///
/// **What this crate delivers instead**, per this wave's instruction to
/// name judgement calls explicitly rather than silently substitute
/// something else: the seat-model proof that *is* a true property of this
/// engine -- mirror symmetry (a position and its left-right mirror score
/// identically, since mirroring is a genuine symmetry of the board for
/// the same player to move) -- lives in
/// `tests/reference.rs::a_position_and_its_left_right_mirror_score_identically`,
/// exercised over a sample of real fixture positions. No colour/seat
/// independence test is checked in beyond that; see this crate's delivery
/// report for the same finding surfaced to the orchestrator.
#[cfg(test)]
mod colour_independence {
    // Deliberately no tests here; see the module doc comment above.
}
