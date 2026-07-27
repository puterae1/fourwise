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
const fn column_mask(col: u32) -> u64 {
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
