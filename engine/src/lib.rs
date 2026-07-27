//! `docs/ENGINE.md` §WASM boundary: the only two exports are `analyse` and
//! `legal_moves`, both 0-indexed, both taking the standard 1-7 move-string
//! notation for the position. No `best_move` -- levels are a game-layer
//! concern (see the amended spec's "Levels" pin). No clocks, no RNG.
//!
//! The transposition-table-lifetime pin ("allocated ONCE per worker...
//! reused across every `analyse` call") is what the `thread_local!` below
//! is for: exactly one `Solver` per WASM instance, never rebuilt per call.
//!
//! **A note on what `cargo test` can and cannot exercise here.**
//! `#[wasm_bindgen]`-attributed functions call into `JsValue` machinery
//! (e.g. `JsValue::from_str`) that is genuinely unimplemented outside a
//! `wasm32` target -- calling one natively aborts the test process, not a
//! normal assertion failure. So the two exported functions below are kept
//! as thin as possible (parse, delegate, convert the error channel) and
//! are exercised only by `wasm-pack build` succeeding; every actual
//! decision they make (parsing, 0-indexing, the `AnalysisResult` shape) is
//! implemented in native, plain-Rust helpers/modules (`analysis::analyse`,
//! `legal_moves_native` below) that `cargo test` covers directly.

pub mod analysis;
pub mod position;
pub mod solver;
pub mod tt;

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

use crate::position::{Position, PositionError, WIDTH};
use crate::solver::Solver;

thread_local! {
    /// The one persistent `Solver` (and its transposition table) for this
    /// WASM instance. Per the TT-lifetime pin, this must never be rebuilt
    /// inside `analyse` -- doing so would throw away exactly the cached
    /// work that makes the worker's "re-issue with a bigger budget" loop
    /// cheap.
    static SOLVER: RefCell<Solver> = RefCell::new(Solver::new());
}

/// 0-indexed columns that can currently receive a disc. Plain-Rust core of
/// the `legal_moves` export, natively testable (no `JsValue` involved).
fn legal_moves_native(position: &str) -> Result<Vec<u32>, PositionError> {
    let pos = Position::from_moves(position)?;
    Ok((0..WIDTH).filter(|&col| pos.can_play(col)).collect())
}

/// `docs/ENGINE.md`: `analyse(position, node_budget) -> AnalysisResult`.
///
/// Returns `Result<JsValue, JsValue>` rather than a bare `JsValue` so an
/// invalid position string throws a catchable JS error instead of
/// panicking -- `wasm_bindgen` maps an `Err` return to a thrown exception.
/// This is an implementation detail of *how* the pinned "throw, don't
/// panic" requirement is met, not a change to the pinned function name,
/// parameters, or 0-indexing.
#[wasm_bindgen]
pub fn analyse(position: &str, node_budget: u32) -> Result<JsValue, JsValue> {
    let pos = Position::from_moves(position).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = SOLVER.with(|cell| analysis::analyse(&mut cell.borrow_mut(), &pos, node_budget));
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("failed to serialise AnalysisResult: {e}")))
}

/// `docs/ENGINE.md`: `legal_moves(position) -> Vec<u32>`, 0-indexed columns
/// that can currently receive a disc.
#[wasm_bindgen]
pub fn legal_moves(position: &str) -> Result<Vec<u32>, JsValue> {
    legal_moves_native(position).map_err(|e| JsValue::from_str(&e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legal_moves_lists_every_column_on_an_empty_board_zero_indexed() {
        assert_eq!(legal_moves_native("").unwrap(), vec![0, 1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn legal_moves_excludes_a_full_column() {
        // "111111": six plays fills column 0 (0-indexed) solid.
        assert_eq!(legal_moves_native("111111").unwrap(), vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn invalid_position_strings_are_rejected_not_panicked() {
        assert!(legal_moves_native("x").is_err());
        assert!(legal_moves_native("9").is_err());
        assert!(legal_moves_native("11111111").is_err()); // eighth play into a full column 0
    }
}
