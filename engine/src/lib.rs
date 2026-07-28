//! `docs/ENGINE.md` §WASM boundary: `analyse` and `legal_moves`, both
//! 0-indexed, both taking the standard 1-7 move-string notation for the
//! position. No `best_move` -- levels are a game-layer concern (see the
//! amended spec's "Levels" pin). No clocks, no RNG.
//!
//! Wave 8 adds three more exports, all additive to the pinned surface
//! above (nothing about `analyse`'s or `legal_moves`'s own name,
//! parameters, or 0-indexing changes):
//!
//! - `load_book(bytes) -> BookLoadResult` -- hands the worker-fetched
//!   opening-book bytes to `book::Book::load`, reporting a validation
//!   verdict rather than throwing: a corrupt or absent book is never a
//!   user-visible error (`docs/ENGINE.md` lookup protocol step 5), so this
//!   is a plain return value, not a `Result` that throws on `Err`.
//! - `set_book_enabled(enabled)` -- the PERMANENT book-disabled flag from
//!   the owner's ruling 3: independent of whether a book is loaded, this
//!   toggle can force every lookup to miss, so the tactical fallback (and
//!   plain search) paths can be exercised deliberately in tests and, if
//!   ever needed, in the field.
//! - `tactical_fallback(position, max_ply) -> TacticalAnalysis` -- the
//!   SPEC.md §3.1 amendment's complete fixed-depth search, for the game
//!   layer to call on cap expiry instead of choosing among a partial deep
//!   search's unevenly-solved columns.
//!
//! `analyse` itself is updated to consult the book (if loaded and
//! enabled) before falling through to search, per `docs/ENGINE.md`: "book
//! consulted before search wherever a position is solved/analysed".
//!
//! The transposition-table-lifetime pin ("allocated ONCE per worker...
//! reused across every `analyse` call") is what the `thread_local!` below
//! is for: exactly one `Solver` per WASM instance, never rebuilt per call.
//! The book state is `thread_local!` for the same reason and the same
//! lifetime -- loaded once (when the worker's fetch completes) and reused
//! across every subsequent call.
//!
//! **A note on what `cargo test` can and cannot exercise here.**
//! `#[wasm_bindgen]`-attributed functions call into `JsValue` machinery
//! (e.g. `JsValue::from_str`) that is genuinely unimplemented outside a
//! `wasm32` target -- calling one natively aborts the test process, not a
//! normal assertion failure. So every exported function is kept as thin as
//! possible (parse, delegate, convert the error channel) and is exercised
//! only by `wasm-pack build` succeeding; every actual decision it makes
//! (parsing, 0-indexing, result shapes, book-state transitions) is
//! implemented in native, plain-Rust helpers/modules (`analysis::analyse`,
//! `tactical::tactical_analyse_with_book`, `legal_moves_native`,
//! `load_book_into` below) that `cargo test` covers directly.

pub mod analysis;
pub mod book;
pub mod position;
pub mod solver;
pub mod tactical;
pub mod tt;

use std::cell::RefCell;

use serde::Serialize;
use wasm_bindgen::prelude::*;

use crate::book::Book;
use crate::position::{Position, PositionError, WIDTH};
use crate::solver::Solver;

/// Book state for one WASM instance: the loaded book, if any, plus the
/// PERMANENT enabled/disabled flag from owner ruling 3. `enabled` starts
/// `true` and is changed ONLY by an explicit `set_book_enabled` call --
/// loading a new book never resets it, which is what "permanent" means
/// here: once a caller has deliberately disabled the book (e.g. to
/// exercise the tactical fallback / plain-search path), it stays disabled
/// until explicitly re-enabled, regardless of any other activity.
struct BookSlot {
    book: Option<Book>,
    enabled: bool,
}

impl BookSlot {
    fn new() -> Self {
        BookSlot {
            book: None,
            enabled: true,
        }
    }

    /// The book to actually consult right now: `None` if no book has ever
    /// loaded successfully, OR if the permanent disabled flag is set --
    /// both cases must behave identically to plain search, per
    /// `docs/ENGINE.md`.
    fn active(&self) -> Option<&Book> {
        if self.enabled {
            self.book.as_ref()
        } else {
            None
        }
    }
}

thread_local! {
    /// The one persistent `Solver` (and its transposition table) for this
    /// WASM instance. Per the TT-lifetime pin, this must never be rebuilt
    /// inside `analyse` -- doing so would throw away exactly the cached
    /// work that makes the worker's "re-issue with a bigger budget" loop
    /// cheap.
    static SOLVER: RefCell<Solver> = RefCell::new(Solver::new());

    /// The one persistent book state for this WASM instance -- see
    /// `BookSlot`'s doc comment.
    static BOOK: RefCell<BookSlot> = RefCell::new(BookSlot::new());
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
///
/// Wave 8: now consults the loaded-and-enabled book (if any) before
/// falling through to search, via `analysis::analyse_with_book`. An
/// absent, disabled, or never-loaded book behaves identically to the
/// pre-book `analysis::analyse` -- see `BookSlot::active` and
/// `analysis.rs`'s `book_none_matches_the_book_agnostic_analyse_exactly`.
#[wasm_bindgen]
pub fn analyse(position: &str, node_budget: u32) -> Result<JsValue, JsValue> {
    let pos = Position::from_moves(position).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = SOLVER.with(|solver_cell| {
        BOOK.with(|book_cell| {
            let book_slot = book_cell.borrow();
            analysis::analyse_with_book(
                &mut solver_cell.borrow_mut(),
                &pos,
                node_budget,
                book_slot.active(),
            )
        })
    });
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("failed to serialise AnalysisResult: {e}")))
}

/// `docs/ENGINE.md`: `legal_moves(position) -> Vec<u32>`, 0-indexed columns
/// that can currently receive a disc.
#[wasm_bindgen]
pub fn legal_moves(position: &str) -> Result<Vec<u32>, JsValue> {
    legal_moves_native(position).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// The outcome of one `load_book` call: whether the bytes parsed as a
/// valid v1 book, and if so how many entries and to what depth. Never an
/// error the caller must catch -- `docs/ENGINE.md`'s lookup protocol
/// requires a corrupt/absent book to be a silent fallback to plain search,
/// so this is a plain, always-successful return value describing what
/// happened, not a thrown exception.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookLoadResult {
    pub ok: bool,
    pub entries: u32,
    pub depth: u8,
    pub error: Option<String>,
}

/// Plain-Rust core of the `load_book` export, natively testable. On
/// success, replaces `state.book`. On failure, deliberately leaves
/// `state.book` untouched (a judgement call `docs/ENGINE.md` does not
/// pin: this loader treats "a later load attempt was corrupt" as no
/// reason to discard a previously-good book, rather than the alternative
/// of clearing it -- either is defensible, but silently discarding a
/// working book on a subsequent bad fetch felt like the worse failure
/// mode to risk). `state.enabled` is never touched by this function --
/// see `BookSlot`'s doc comment for why that flag is permanent.
fn load_book_into(state: &mut BookSlot, bytes: &[u8]) -> BookLoadResult {
    match Book::load(bytes) {
        Ok(book) => {
            let entries = book.len() as u32;
            let depth = book.depth();
            state.book = Some(book);
            BookLoadResult {
                ok: true,
                entries,
                depth,
                error: None,
            }
        }
        Err(e) => BookLoadResult {
            ok: false,
            entries: 0,
            depth: 0,
            error: Some(e.to_string()),
        },
    }
}

/// Hand opening-book bytes (fetched by the web worker, Wave 9) to the
/// loader. Returns a validation verdict, never throws -- see
/// `BookLoadResult`'s doc comment for why a corrupt book is not an error
/// channel.
#[wasm_bindgen]
pub fn load_book(bytes: &[u8]) -> Result<JsValue, JsValue> {
    let result = BOOK.with(|cell| load_book_into(&mut cell.borrow_mut(), bytes));
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("failed to serialise BookLoadResult: {e}")))
}

/// The permanent book-disabled flag (owner ruling 3): forces every book
/// lookup to miss, regardless of whether a book is loaded, until this is
/// called again with `true`. Exists so the tactical-fallback and
/// plain-search paths can be exercised deliberately once the book is
/// otherwise always available.
#[wasm_bindgen]
pub fn set_book_enabled(enabled: bool) {
    BOOK.with(|cell| cell.borrow_mut().enabled = enabled);
}

/// `docs/SPEC.md` §3.1's 2026-07-28 amendment: a complete, fixed-depth
/// tactical search for the game layer to call on cap expiry, instead of
/// choosing among a partial deep search's unevenly-solved columns. See
/// `tactical.rs`'s module doc comment for `max_ply`'s exact meaning and
/// the horizon-as-draw contract. Consults the loaded-and-enabled book
/// first, same as `analyse`.
#[wasm_bindgen]
pub fn tactical_fallback(position: &str, max_ply: u32) -> Result<JsValue, JsValue> {
    let pos = Position::from_moves(position).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let result = BOOK.with(|book_cell| {
        let book_slot = book_cell.borrow();
        tactical::tactical_analyse_with_book(&pos, max_ply, book_slot.active())
    });
    serde_wasm_bindgen::to_value(&result)
        .map_err(|e| JsValue::from_str(&format!("failed to serialise TacticalAnalysis: {e}")))
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

    // -------------------------------------------------------------
    // Book state (Wave 8). All additive: none of the tests above this
    // point are modified.
    // -------------------------------------------------------------

    /// Minimal, self-contained v1 book byte builder for this module's own
    /// tests -- independent of `book.rs`'s and `analysis.rs`'s own
    /// `#[cfg(test)]`-private builders, and of `tools/gen_book.rs`'s
    /// writer.
    fn build_test_book(depth: u8, entries: &[(u64, i8)]) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(b"FWBK");
        out.push(1u8);
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
    fn a_new_book_slot_has_no_book_and_is_enabled_by_default() {
        let slot = BookSlot::new();
        assert!(slot.active().is_none());
        assert!(slot.enabled);
    }

    #[test]
    fn loading_a_well_formed_book_makes_it_active() {
        let mut slot = BookSlot::new();
        let bytes = build_test_book(8, &[(10, 1), (20, -2)]);
        let result = load_book_into(&mut slot, &bytes);
        assert_eq!(
            result,
            BookLoadResult {
                ok: true,
                entries: 2,
                depth: 8,
                error: None,
            }
        );
        assert!(slot.active().is_some());
    }

    #[test]
    fn loading_a_corrupt_book_reports_failure_and_leaves_no_active_book() {
        let mut slot = BookSlot::new();
        let result = load_book_into(&mut slot, b"not a book");
        assert!(!result.ok);
        assert_eq!(result.entries, 0);
        assert_eq!(result.depth, 0);
        assert!(result.error.is_some(), "a failed load should explain why");
        assert!(slot.active().is_none());
    }

    #[test]
    fn a_corrupt_reload_does_not_discard_a_previously_good_book() {
        // Documented judgement call (see `load_book_into`'s doc comment):
        // a later bad load must not clobber an earlier good one.
        let mut slot = BookSlot::new();
        let good_bytes = build_test_book(8, &[(10, 1)]);
        let first = load_book_into(&mut slot, &good_bytes);
        assert!(first.ok);
        assert!(slot.active().is_some());

        let second = load_book_into(&mut slot, b"garbage");
        assert!(!second.ok);
        assert!(
            slot.active().is_some(),
            "a corrupt reload must not discard the previously-loaded good book"
        );
    }

    /// The permanent-disabled flag (owner ruling 3): once set, it stays
    /// set even across an unrelated book (re)load -- `load_book_into`
    /// never touches `enabled`.
    #[test]
    fn disabling_the_book_survives_a_subsequent_successful_load() {
        let mut slot = BookSlot::new();
        let bytes = build_test_book(8, &[(10, 1)]);
        load_book_into(&mut slot, &bytes);
        assert!(slot.active().is_some());

        slot.enabled = false;
        assert!(
            slot.active().is_none(),
            "disabling must make active() report None even though a book is loaded"
        );

        // Loading again (still valid bytes) must not silently re-enable it.
        let reload = load_book_into(&mut slot, &bytes);
        assert!(reload.ok);
        assert!(
            slot.active().is_none(),
            "the disabled flag must be PERMANENT: a fresh successful load must not re-enable it"
        );

        slot.enabled = true;
        assert!(slot.active().is_some(), "re-enabling must restore the loaded book");
    }
}
