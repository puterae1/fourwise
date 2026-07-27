//! Unit tests for the bitboard `Position`: legality, gravity, alignment
//! detection (including the column-boundary cases the sentinel bit exists
//! to prevent), `from_moves` parsing, and key uniqueness.

use std::collections::{HashMap, HashSet};

use connect4_engine::position::{alignment, winning_positions, Position, PositionError, HEIGHT, WIDTH};

/// Bit index of `(col, row)` in the 7-bit-per-column layout, row 0 at the
/// bottom, matching the internal `bottom_mask`/`top_mask` layout.
fn bit(col: u32, row: u32) -> u64 {
    1u64 << (col * (HEIGHT + 1) + row)
}

// ---------------------------------------------------------------------
// Legality and gravity
// ---------------------------------------------------------------------

#[test]
fn new_position_is_empty_with_every_column_open() {
    let pos = Position::new();
    assert_eq!(pos.moves(), 0);
    for col in 0..WIDTH {
        assert!(pos.can_play(col), "column {col} should be open on an empty board");
    }
}

#[test]
fn discs_stack_from_the_bottom() {
    // Six discs into the same column exactly fill it; a seventh is illegal.
    let mut pos = Position::new();
    for i in 0..HEIGHT {
        assert!(pos.can_play(3), "column 3 should still have room ({i} discs so far)");
        pos.play(3);
    }
    assert!(!pos.can_play(3), "column 3 should be full after HEIGHT discs");
    assert_eq!(pos.moves(), HEIGHT);
}

#[test]
fn full_column_is_illegal_and_rejected_by_from_moves() {
    let full = "4".repeat(HEIGHT as usize); // fills column index 3 exactly
    let pos = Position::from_moves(&full).expect("filling a column exactly should succeed");
    assert!(!pos.can_play(3));

    let overfull = format!("{full}4");
    let err = Position::from_moves(&overfull).expect_err("a 7th disc in column 3 must be rejected");
    assert_eq!(err, PositionError::ColumnFull(3));
}

#[test]
fn other_columns_remain_playable_while_one_is_full() {
    let full = "4".repeat(HEIGHT as usize);
    let pos = Position::from_moves(&full).unwrap();
    for col in 0..WIDTH {
        if col == 3 {
            assert!(!pos.can_play(col));
        } else {
            assert!(pos.can_play(col), "column {col} should still be open");
        }
    }
}

// ---------------------------------------------------------------------
// play / replay invariant (no undo(); Position is Copy)
// ---------------------------------------------------------------------

#[test]
fn replaying_a_move_prefix_from_scratch_reproduces_the_identical_position() {
    let moves = "445536271";
    let mut pos = Position::new();
    let mut snapshot_after_5: Option<Position> = None;

    for (i, c) in moves.chars().enumerate() {
        let col = c.to_digit(10).unwrap() - 1;
        pos.play(col);
        if i == 4 {
            // Take a copy (Position is Copy) partway through play.
            snapshot_after_5 = Some(pos);
        }
    }

    let replay_prefix = &moves[..5];
    let replayed = Position::from_moves(replay_prefix).unwrap();

    assert_eq!(
        snapshot_after_5.unwrap(),
        replayed,
        "replaying the same move prefix from scratch must reproduce the exact \
         (current, mask, moves) triple"
    );
}

// ---------------------------------------------------------------------
// from_moves parsing
// ---------------------------------------------------------------------

#[test]
fn from_moves_round_trips_through_play() {
    let moves = "4415263";
    let via_from_moves = Position::from_moves(moves).unwrap();

    let mut via_play = Position::new();
    for c in moves.chars() {
        via_play.play(c.to_digit(10).unwrap() - 1);
    }

    assert_eq!(via_from_moves, via_play);
    assert_eq!(via_from_moves.moves(), moves.len() as u32);
}

#[test]
fn from_moves_rejects_non_digit_characters() {
    let err = Position::from_moves("4a3").unwrap_err();
    assert_eq!(err, PositionError::InvalidDigit('a'));
}

#[test]
fn from_moves_rejects_columns_outside_one_to_seven() {
    assert_eq!(
        Position::from_moves("8").unwrap_err(),
        PositionError::ColumnOutOfRange('8')
    );
    assert_eq!(
        Position::from_moves("0").unwrap_err(),
        PositionError::ColumnOutOfRange('0')
    );
}

#[test]
fn from_moves_maps_digit_one_to_leftmost_column() {
    let mut pos = Position::new();
    pos.play(0); // column index 0 == leftmost
    assert_eq!(Position::from_moves("1").unwrap(), pos);
}

// ---------------------------------------------------------------------
// Alignment detection
// ---------------------------------------------------------------------

#[test]
fn alignment_detects_vertical_four() {
    let mut discs = 0u64;
    for row in 0..4 {
        discs |= bit(2, row);
    }
    assert!(alignment(discs));
}

#[test]
fn alignment_detects_horizontal_four() {
    let mut discs = 0u64;
    for col in 0..4 {
        discs |= bit(col, 2);
    }
    assert!(alignment(discs));
}

#[test]
fn alignment_detects_ascending_diagonal() {
    // '/' diagonal: row increases with column, shift distance HEIGHT + 2 = 8.
    let mut discs = 0u64;
    for i in 0..4 {
        discs |= bit(i, i);
    }
    assert!(alignment(discs));
}

#[test]
fn alignment_detects_descending_diagonal() {
    // '\' diagonal: row decreases with column, shift distance HEIGHT = 6.
    let mut discs = 0u64;
    for i in 0..4 {
        discs |= bit(i, 3 - i);
    }
    assert!(alignment(discs));
}

#[test]
fn alignment_is_false_for_three_in_a_row() {
    let mut discs = 0u64;
    for row in 0..3 {
        discs |= bit(2, row);
    }
    assert!(!alignment(discs));
}

/// The sentinel row exists precisely to stop this: without it, three discs
/// at the top of one column plus one disc at the bottom of the next
/// column would sit on four consecutive bits and be misread as a vertical
/// four-in-a-row that spans a column boundary. With the sentinel's
/// always-empty bit sitting between them, the shift-by-1 chain breaks.
#[test]
fn alignment_does_not_false_positive_across_a_column_boundary() {
    let discs = bit(0, 3) | bit(0, 4) | bit(0, 5) | bit(1, 0);
    assert!(
        !alignment(discs),
        "three discs at the top of column 0 plus one at the bottom of \
         column 1 must not read as a vertical four"
    );

    // Confirm this is genuinely a boundary artifact and not just "four
    // bits aren't set": the equivalent *within* one column is a real win.
    let real_vertical = bit(0, 2) | bit(0, 3) | bit(0, 4) | bit(0, 5);
    assert!(alignment(real_vertical));
}

// ---------------------------------------------------------------------
// winning_positions
// ---------------------------------------------------------------------

#[test]
fn winning_positions_flags_the_cell_above_three_stacked_discs() {
    let current = bit(0, 0) | bit(0, 1) | bit(0, 2);
    let mask = current;
    let threats = winning_positions(current, mask);
    assert_eq!(threats, bit(0, 3));
}

#[test]
fn winning_positions_flags_both_ends_of_an_open_three_horizontally() {
    // Discs at columns 1, 2, 3 on row 0; columns 0 and 4 empty at row 0.
    let current = bit(1, 0) | bit(2, 0) | bit(3, 0);
    let mask = current;
    let threats = winning_positions(current, mask);
    assert_eq!(threats, bit(0, 0) | bit(4, 0));
}

#[test]
fn winning_positions_excludes_cells_already_occupied() {
    // Same open three, but the extension cell at column 4 is occupied by
    // the opponent, so only column 0 should remain a threat.
    let current = bit(1, 0) | bit(2, 0) | bit(3, 0);
    let opponent = bit(4, 0);
    let mask = current | opponent;
    let threats = winning_positions(current, mask);
    assert_eq!(threats, bit(0, 0));
}

#[test]
fn winning_positions_is_empty_on_an_empty_board() {
    assert_eq!(winning_positions(0, 0), 0);
}

// ---------------------------------------------------------------------
// Key uniqueness (depth-10 reachable-state enumeration)
// ---------------------------------------------------------------------

#[test]
fn key_never_collides_across_distinct_positions_to_depth_10() {
    const MAX_DEPTH: u32 = 10;

    // Distinctness is judged by full struct equality (derived PartialEq on
    // Position), independent of `key()` -- otherwise a broken key() could
    // silently merge two different positions during enumeration and hide
    // the very bug this test exists to catch.
    let mut visited: HashSet<Position> = HashSet::new();
    let root = Position::new();
    visited.insert(root);
    let mut frontier = vec![root];

    for _ in 0..MAX_DEPTH {
        let mut next_frontier = Vec::new();
        for pos in &frontier {
            for col in 0..WIDTH {
                if pos.can_play(col) {
                    let mut child = *pos;
                    child.play(col);
                    if visited.insert(child) {
                        next_frontier.push(child);
                    }
                }
            }
        }
        frontier = next_frontier;
    }

    assert!(
        visited.len() > 1,
        "sanity check: enumeration should have found more than the root position"
    );

    let mut by_key: HashMap<u64, Position> = HashMap::with_capacity(visited.len());
    for pos in &visited {
        match by_key.get(&pos.key()) {
            Some(existing) => assert_eq!(
                *existing, *pos,
                "key() collided for two distinct positions: {existing:?} vs {pos:?}"
            ),
            None => {
                by_key.insert(pos.key(), *pos);
            }
        }
    }
}
