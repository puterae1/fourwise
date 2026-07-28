//! Transposition table for the negamax search.
//!
//! Keyed on [`crate::position::Position::key`] (`current + mask`), which
//! Wave 1 already proved collision-free to depth 10. Fixed-size,
//! open-addressed with a single slot per index and unconditional
//! replacement on collision (no chaining, no probing) -- the same trade
//! Pascal Pons makes: a slot already holding a *different* position is
//! simply overwritten.
//!
//! ## Two measured mistakes on the way here
//!
//! It's worth recording both, since either one alone looks like a
//! reasonable design and the combination is what actually mattered.
//!
//! **Mistake 1: wide entries.** A first version stored the full 64-bit key
//! plus a 4-byte score/bound in every slot (16 bytes once aligned). That
//! halves the usable slot count for a given memory budget compared to
//! Pons's own packing.
//!
//! **Mistake 2: power-of-two sizing with a plain bitmask index.** The fix
//! for mistake 1 replaced the stored key with a `partial_key` derived from
//! splitting `key` at the table's `log2(capacity)` bit boundary
//! (`index = key & (capacity - 1)`, `partial_key = key >> log2(capacity)`).
//! That's lossless arithmetic, but it is also *exactly* the same operation
//! as "look only at the lowest N bits of the key" -- and this
//! representation's `key` is built from 7-bit-per-column fields, so the
//! lowest `log2(capacity)` bits come almost entirely from the first 3-4
//! columns. Two positions that differ only in column 5 or 6 -- extremely
//! common, since move ordering visits every column -- can land on the
//! *same* index no matter how different they are, while the index space
//! goes almost unused for variation in the columns that weren't in those
//! low bits. Measured effect of shipping both mistakes together: solving
//! the nearly-empty two-ply position `"14"` took **over a minute** and
//! didn't finish in that window it was killed at. Fixing only mistake 1
//! (keeping the power-of-two bitmask) made it *worse*, not better,
//! confirming the index scheme -- not entry size -- was the dominant
//! problem.
//!
//! **The fix.** Size the table to a prime number of slots and index with
//! true `%` (not `&`). Modulo by a prime, unlike masking to a power of
//! two, mixes every bit of the dividend into the result -- there is no
//! "these bits never affect the index" set the way there is for `&`. Pons
//! documents this is exactly what his own reference implementation does.
//! `partial_key = key / capacity` (the quotient) paired with
//! `index = key % capacity` (the remainder) is Euclidean division: it
//! reconstructs `key` exactly (`key == partial_key * capacity + index`)
//! for *any* capacity, prime or not -- so this is still lossless, just
//! with a capacity choice that also distributes well. With capacity near
//! the default 64 MB budget's ~8.4 million slots, `key < 2^50` gives a
//! quotient comfortably under `2^32`, so `partial_key: u32` still holds it
//! exactly.
//!
//! Score values also never need more than a handful of bits: the negamax
//! window here never exceeds roughly +-21 (see `docs/ENGINE.md`'s score
//! range), so a signed byte (`i8`) is exact, not an approximation.

/// A cached alpha-beta search result for one position.
///
/// Alpha-beta rarely gets to compute an *exact* score for an interior node
/// (that requires every move to have been tried without a cutoff); far more
/// often it proves only a bound:
///
/// - `Lower(v)`: a beta cutoff occurred, the true score is at least `v`.
/// - `Upper(v)`: no move raised alpha above the window's floor, the true
///   score is at most `v`.
/// - `Exact(v)`: the true score, proven without a cutoff on either side.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Bound {
    Exact(i32),
    Lower(i32),
    Upper(i32),
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Empty = 0,
    Exact = 1,
    Lower = 2,
    Upper = 3,
}

/// 8 bytes: `partial_key` (4) + `value` (1) + `kind` (1) + 2 bytes padding
/// for `u32` alignment. See the module doc comment for why `partial_key`
/// safely omits the bits already implied by a slot's index.
#[derive(Clone, Copy)]
struct Slot {
    partial_key: u32,
    value: i8,
    kind: Kind,
}

impl Default for Slot {
    fn default() -> Self {
        Slot {
            partial_key: 0,
            value: 0,
            kind: Kind::Empty,
        }
    }
}

/// Default size budget: ~64 MB, per `docs/ENGINE.md`.
pub const DEFAULT_BYTE_BUDGET: usize = 64 * 1024 * 1024;

/// Smallest table size at which `partial_key: u32` is guaranteed lossless
/// for a real `Position::key()` (bounded by ~2^50): below this, the
/// quotient `key / capacity` could exceed `u32::MAX` and get silently
/// truncated by the `as u32` cast in `split()`. That truncation is not
/// merely "the table gets less useful" -- it breaks the invariant the
/// whole design leans on ("a `partial_key` match proves exact key
/// equality"): two genuinely different keys that happen to share the same
/// low 32 bits of their (truncated) quotient, at the same index, would
/// alias, and `get()` could hand back one position's score for a
/// completely different position. `SharedTranspositionTable::with_capacity`
/// enforces this floor by construction (see its call to
/// `entries.max(MIN_SAFE_CAPACITY)` below) rather than merely documenting
/// it, precisely because it -- unlike the plain `TranspositionTable` below,
/// see its own doc comment -- is reachable from a CLI flag
/// (`tools/gen_book.rs`'s `--tt-mb`) with real ~49-bit `Position` keys on
/// the other end.
const MIN_SAFE_CAPACITY: usize = 1 << 18;

/// A fixed-size, open-addressed transposition table.
pub struct TranspositionTable {
    slots: Vec<Slot>,
    /// Number of slots, deliberately prime (see the module doc comment for
    /// why plain power-of-two sizing was measured to perform far worse).
    capacity: u64,
}

impl TranspositionTable {
    /// Build a table with a prime slot count at least `entries` (so lookup
    /// stays a true modulo, not a masked-off subset of key bits).
    ///
    /// Sizes below `2^18` slots make the lossless key-splitting scheme
    /// (see the module doc comment) lossy -- `partial_key` would need more
    /// than 32 bits to hold the quotient for a real `Position::key`. This
    /// constructor does not enlarge the table to compensate: that's fine
    /// for tests deliberately built small to exercise collision behaviour
    /// with tiny synthetic keys, but any table backing a real search
    /// should stay at or above the default 64 MB budget.
    ///
    /// **Deliberately NOT clamped to `MIN_SAFE_CAPACITY` the way
    /// `SharedTranspositionTable::with_capacity` is (see that type's doc
    /// comment for the risk both share).** Two things make this safe as
    /// shipped, both checked directly rather than assumed: (1) every
    /// production/WASM code path constructs this table only via
    /// `Solver::new`, which always calls `with_byte_budget(
    /// DEFAULT_BYTE_BUDGET)` -- a fixed 64 MB, ~8.4M slots, far above the
    /// floor -- never a caller-chosen size; `Solver::with_tt` (the only
    /// other way to inject a capacity) has no caller anywhere in this
    /// crate or `tools/` today. (2) Every existing small-capacity use is
    /// this module's own test suite, deliberately exercising collision
    /// behaviour with small synthetic keys (`1`, `2`, `5`, `42`, ...) far
    /// below the ~49-bit range where truncation could alias -- exactly the
    /// documented contract above. Unlike `SharedTranspositionTable`, no CLI
    /// flag or other external input reaches this constructor's `entries`
    /// argument with a real `Position::key()` on the other end, so there is
    /// no live path to the wrong-score risk today. If a future caller ever
    /// changes that (e.g. a CLI flag reusing `with_tt` for a real search),
    /// it would need the same floor `SharedTranspositionTable` now has.
    pub fn with_capacity(entries: usize) -> Self {
        let capacity = smallest_prime_at_least(entries.max(2));
        TranspositionTable {
            slots: vec![Slot::default(); capacity],
            capacity: capacity as u64,
        }
    }

    /// Build a table sized to fit within `byte_budget` bytes.
    pub fn with_byte_budget(byte_budget: usize) -> Self {
        let entry_size = std::mem::size_of::<Slot>();
        Self::with_capacity((byte_budget / entry_size).max(1))
    }

    /// Number of slots in the table (prime).
    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    /// Split a full key into (slot index, quotient). Lossless for any
    /// capacity: `partial_key as u64 * capacity + index as u64 == key`.
    fn split(&self, key: u64) -> (usize, u32) {
        let index = (key % self.capacity) as usize;
        let partial_key = (key / self.capacity) as u32;
        (index, partial_key)
    }

    /// Look up the cached bound for `key`, if this table currently holds
    /// one (a different position may have overwritten the slot).
    pub fn get(&self, key: u64) -> Option<Bound> {
        let (index, partial_key) = self.split(key);
        let slot = &self.slots[index];
        if slot.kind == Kind::Empty || slot.partial_key != partial_key {
            return None;
        }
        let value = slot.value as i32;
        match slot.kind {
            Kind::Empty => unreachable!("checked above"),
            Kind::Exact => Some(Bound::Exact(value)),
            Kind::Lower => Some(Bound::Lower(value)),
            Kind::Upper => Some(Bound::Upper(value)),
        }
    }

    /// Store (or overwrite) the bound for `key`.
    pub fn insert(&mut self, key: u64, bound: Bound) {
        let (index, partial_key) = self.split(key);
        let (value, kind) = match bound {
            Bound::Exact(v) => (v, Kind::Exact),
            Bound::Lower(v) => (v, Kind::Lower),
            Bound::Upper(v) => (v, Kind::Upper),
        };
        debug_assert!(
            (i8::MIN as i32..=i8::MAX as i32).contains(&value),
            "score {value} does not fit in the packed i8 slot; \
             docs/ENGINE.md's score range is -18..=18, so this indicates a \
             search bug, not a table sizing problem"
        );
        self.slots[index] = Slot {
            partial_key,
            value: value as i8,
            kind,
        };
    }

    /// Discard every cached entry without changing capacity.
    pub fn clear(&mut self) {
        for slot in &mut self.slots {
            *slot = Slot::default();
        }
    }
}

// ---------------------------------------------------------------------
// Shared, lock-free table -- used only by `tools/gen_book.rs`'s parallel
// book generator. The WASM/runtime engine (`Solver::new()`/`Solver::
// with_tt`) keeps using the plain `TranspositionTable` above, byte-for-byte
// unchanged, so nothing about the single-threaded path's behaviour moves.
// ---------------------------------------------------------------------

use std::sync::atomic::{AtomicU64, Ordering};

/// Pack `(partial_key, value, kind)` into one 64-bit word: `partial_key` in
/// the high 32 bits, `value` (the packed `i8`, as its raw bit pattern) in
/// bits 8..16, `kind`'s tag in bits 0..2. Plenty of unused bits in between
/// -- this only needs to fit in 64, not be dense -- kept simple and
/// unambiguous to decode.
fn pack_word(partial_key: u32, value: i8, kind: Kind) -> u64 {
    ((partial_key as u64) << 32) | ((value as u8 as u64) << 8) | (kind as u64)
}

fn unpack_word(word: u64) -> (u32, i8, Kind) {
    let kind = match word & 0b11 {
        0 => Kind::Empty,
        1 => Kind::Exact,
        2 => Kind::Lower,
        3 => Kind::Upper,
        _ => unreachable!("word & 0b11 is always 0..=3"),
    };
    let value = ((word >> 8) & 0xFF) as u8 as i8;
    let partial_key = (word >> 32) as u32;
    (partial_key, value, kind)
}

/// A transposition table shared, lock-free, across multiple solver threads.
///
/// ## Safety argument: why a racy read can never yield a WRONG score
///
/// Each slot is exactly one `AtomicU64` (`pack_word`/`unpack_word` above),
/// and every access is a single `load`/`store` on that one word with
/// `Ordering::Relaxed` -- no other field, no second word, nothing split
/// across two atomics that could be observed half-updated.
///
/// **Precondition this argument depends on, and how it's guaranteed, not
/// assumed:** point 2 below requires `capacity >= MIN_SAFE_CAPACITY`, or
/// the `partial_key = key / capacity` quotient can itself overflow `u32`
/// and get silently truncated -- which would let two genuinely different
/// keys alias. This is enforced BY CONSTRUCTION: every constructor
/// (`with_capacity`, `with_byte_budget`) clamps up to that floor, so a
/// `SharedTranspositionTable` value can never exist below it. This is not
/// merely documented or merely tested -- it cannot be constructed any other
/// way (see `with_capacity`'s doc comment for why this matters specifically
/// for this type, reachable from `--tt-mb`, and not for the plain
/// `TranspositionTable`).
///
/// 1. **No torn reads are structurally possible.** An `AtomicU64` load or
///    store lowers to one atomic machine instruction. A concurrent reader
///    can only ever observe some word that was actually, wholly, written by
///    *one* store -- never a byte-for-byte mix of an old store and a new
///    one. There is no intermediate state to observe, so "torn read" is not
///    a failure mode this design has to defend against at all -- it cannot
///    happen, not merely "is made unlikely".
/// 2. **A `partial_key` match is proof of exact key equality, not a
///    probabilistic hash match -- GIVEN the floor above holds.**
///    `index = key % capacity`, `partial_key = key / capacity` is exact
///    Euclidean division (see the module doc comment above):
///    `partial_key as u64 * capacity + index == key` losslessly, for any
///    key up to the ~2^50 bound `Position::key()` is bounded by, precisely
///    because `capacity >= MIN_SAFE_CAPACITY` guarantees the quotient fits
///    in `u32` without truncation. So if `get(key)` finds a slot whose
///    `partial_key` doesn't match, that slot provably holds a *different*
///    key's entry (overwritten by another thread since), and `get` reports
///    a clean miss (`None`) -- never that other position's score
///    attributed to this one.
/// 3. **A stale-but-still-matching entry for the same key is still a true
///    bound.** `Bound::Exact/Lower/Upper` are only ever inserted after
///    `negamax` has actually *proven* them for that exact position (see
///    `solver.rs`) -- a proven bound is a fact about the position's real
///    game-theoretic score, not a claim scoped to whichever alpha-beta
///    window happened to prove it (standard alpha-beta TT theory: a bound
///    proven under one search window remains a correct, if possibly looser
///    than ideal, bound under any other window on the same position). So
///    even if two threads race to solve the same position and one
///    overwrites the other's entry, whichever word survives the race is
///    still a *correct* bound for that key. Concurrency can therefore only
///    ever cost wasted work -- a redundant re-solve, or pruning with a
///    looser bound than an uncontended run would have had -- never an
///    incorrect exact score. `Solver::solve`'s final answer is proven
///    order/TT-content-independent by construction (every insert follows
///    from a real, locally-complete alpha-beta proof; nothing is ever
///    trusted from the table without the same bound-safety checks the
///    single-threaded path already uses), which is exactly what makes the
///    parallel generator's byte-identical-output requirement achievable at
///    all.
pub struct SharedTranspositionTable {
    slots: Vec<AtomicU64>,
    /// Number of slots, prime -- same reasoning as `TranspositionTable`'s
    /// `capacity` (see the module doc comment).
    capacity: u64,
}

impl SharedTranspositionTable {
    /// Build a table with a prime slot count at least `entries`, clamped up
    /// to at least `MIN_SAFE_CAPACITY`. The clamp is load-bearing, not a
    /// convenience: below that floor, `partial_key: u32` can no longer
    /// losslessly hold `key / capacity` for a real `Position::key()`, which
    /// breaks the "a `partial_key` match proves exact key equality"
    /// invariant this whole table's safety argument depends on (see the
    /// struct doc comment above and `MIN_SAFE_CAPACITY`'s own comment) --
    /// a genuine wrong-score risk, not merely wasted work, since this type
    /// (unlike the plain `TranspositionTable`) is reachable from
    /// `tools/gen_book.rs`'s `--tt-mb` CLI flag with real ~49-bit keys on
    /// the other end. Enforced HERE, at the table layer, rather than only
    /// at the CLI, so every construction path (including any future
    /// caller) is safe by construction, not by the caller's discipline.
    pub fn with_capacity(entries: usize) -> Self {
        let capacity = smallest_prime_at_least(entries.max(MIN_SAFE_CAPACITY));
        let slots = (0..capacity).map(|_| AtomicU64::new(0)).collect();
        SharedTranspositionTable {
            slots,
            capacity: capacity as u64,
        }
    }

    /// Build a table sized to fit within `byte_budget` bytes.
    pub fn with_byte_budget(byte_budget: usize) -> Self {
        let entry_size = std::mem::size_of::<AtomicU64>();
        Self::with_capacity((byte_budget / entry_size).max(1))
    }

    /// Number of slots in the table (prime).
    pub fn capacity(&self) -> usize {
        self.slots.len()
    }

    fn split(&self, key: u64) -> (usize, u32) {
        let index = (key % self.capacity) as usize;
        let partial_key = (key / self.capacity) as u32;
        (index, partial_key)
    }

    /// Look up the cached bound for `key`. `&self`, not `&mut self`: any
    /// number of threads may call this concurrently with each other and
    /// with `insert` -- see the safety argument above.
    pub fn get(&self, key: u64) -> Option<Bound> {
        let (index, partial_key) = self.split(key);
        let word = self.slots[index].load(Ordering::Relaxed);
        let (stored_partial, value, kind) = unpack_word(word);
        if kind == Kind::Empty || stored_partial != partial_key {
            return None;
        }
        let v = value as i32;
        match kind {
            Kind::Empty => unreachable!("checked above"),
            Kind::Exact => Some(Bound::Exact(v)),
            Kind::Lower => Some(Bound::Lower(v)),
            Kind::Upper => Some(Bound::Upper(v)),
        }
    }

    /// Store (or overwrite) the bound for `key`. `&self`, not `&mut self`:
    /// this is the interior-mutability point that makes a shared,
    /// lock-free table possible at all -- see the safety argument above.
    pub fn insert(&self, key: u64, bound: Bound) {
        let (index, partial_key) = self.split(key);
        let (value, kind) = match bound {
            Bound::Exact(v) => (v, Kind::Exact),
            Bound::Lower(v) => (v, Kind::Lower),
            Bound::Upper(v) => (v, Kind::Upper),
        };
        debug_assert!(
            (i8::MIN as i32..=i8::MAX as i32).contains(&value),
            "score {value} does not fit in the packed i8 slot; \
             docs/ENGINE.md's score range is -18..=18, so this indicates a \
             search bug, not a table sizing problem"
        );
        let word = pack_word(partial_key, value as i8, kind);
        self.slots[index].store(word, Ordering::Relaxed);
    }

    /// Discard every cached entry without changing capacity.
    pub fn clear(&self) {
        for slot in &self.slots {
            slot.store(0, Ordering::Relaxed);
        }
    }
}

fn is_prime(n: usize) -> bool {
    if n < 2 {
        return false;
    }
    if n.is_multiple_of(2) {
        return n == 2;
    }
    let mut i = 3usize;
    while i.saturating_mul(i) <= n {
        if n.is_multiple_of(i) {
            return false;
        }
        i += 2;
    }
    true
}

/// Smallest prime `>= n`. `n` is assumed small enough (at most a few
/// hundred million, as bounded by any realistic memory budget) that a
/// trial-division search is instant.
fn smallest_prime_at_least(n: usize) -> usize {
    let mut candidate = n.max(2);
    while !is_prime(candidate) {
        candidate += 1;
    }
    candidate
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_a_stored_value() {
        let mut tt = TranspositionTable::with_capacity(1024);
        tt.insert(42, Bound::Exact(7));
        assert_eq!(tt.get(42), Some(Bound::Exact(7)));
    }

    #[test]
    fn miss_returns_none() {
        let tt = TranspositionTable::with_capacity(1024);
        assert_eq!(tt.get(12345), None);
    }

    #[test]
    fn distinguishes_bound_kinds() {
        let mut tt = TranspositionTable::with_capacity(1024);
        tt.insert(1, Bound::Lower(3));
        tt.insert(2, Bound::Upper(-4));
        assert_eq!(tt.get(1), Some(Bound::Lower(3)));
        assert_eq!(tt.get(2), Some(Bound::Upper(-4)));
    }

    #[test]
    fn capacity_is_prime_and_at_least_requested() {
        let tt = TranspositionTable::with_capacity(1000);
        assert!(tt.capacity() >= 1000);
        assert!(is_prime(tt.capacity()), "{} is not prime", tt.capacity());
    }

    #[test]
    fn a_colliding_key_overwrites_rather_than_panics() {
        // Whatever the distribution, forcing a tiny table guarantees a
        // collision; the table must survive it (simply losing the older
        // entry), not panic or corrupt state.
        let mut tt = TranspositionTable::with_capacity(1);
        tt.insert(1, Bound::Exact(1));
        tt.insert(2, Bound::Exact(2));
        // Only the most recent insert can possibly still be present.
        assert_eq!(tt.get(2), Some(Bound::Exact(2)));
    }

    #[test]
    fn clear_removes_every_entry() {
        let mut tt = TranspositionTable::with_capacity(64);
        tt.insert(5, Bound::Exact(1));
        tt.clear();
        assert_eq!(tt.get(5), None);
    }

    #[test]
    fn slot_is_eight_bytes() {
        // The whole point of the repacking documented at the top of this
        // file: a regression back to a wider slot silently halves (or
        // worse) the usable table size for the same memory budget.
        assert_eq!(std::mem::size_of::<Slot>(), 8);
    }

    #[test]
    fn default_budget_clears_the_minimum_safe_capacity() {
        let tt = TranspositionTable::with_byte_budget(DEFAULT_BYTE_BUDGET);
        assert!(tt.capacity() >= MIN_SAFE_CAPACITY);
    }

    // -------------------------------------------------------------
    // SharedTranspositionTable
    // -------------------------------------------------------------

    #[test]
    fn shared_table_round_trips_a_stored_value() {
        let tt = SharedTranspositionTable::with_capacity(1024);
        tt.insert(42, Bound::Exact(7));
        assert_eq!(tt.get(42), Some(Bound::Exact(7)));
    }

    #[test]
    fn shared_table_miss_returns_none() {
        let tt = SharedTranspositionTable::with_capacity(1024);
        assert_eq!(tt.get(12345), None);
    }

    #[test]
    fn shared_table_distinguishes_bound_kinds() {
        let tt = SharedTranspositionTable::with_capacity(1024);
        tt.insert(1, Bound::Lower(3));
        tt.insert(2, Bound::Upper(-4));
        assert_eq!(tt.get(1), Some(Bound::Lower(3)));
        assert_eq!(tt.get(2), Some(Bound::Upper(-4)));
    }

    #[test]
    fn shared_table_colliding_key_overwrites_rather_than_panics() {
        // `with_capacity(1)` is now clamped up to `MIN_SAFE_CAPACITY` (see
        // the audit fix), so this no longer produces a 2-slot table --
        // force a genuine collision at whatever prime capacity actually
        // results instead of assuming a specific small number. Keys `1`
        // and `1 + capacity` always land on the SAME index (`% capacity`)
        // with different quotients (`partial_key`s `0` and `1`), so this
        // stays a real forced collision regardless of capacity.
        let tt = SharedTranspositionTable::with_capacity(1);
        assert!(tt.capacity() >= MIN_SAFE_CAPACITY);
        let key_a = 1u64;
        let key_b = 1u64 + tt.capacity;
        tt.insert(key_a, Bound::Exact(1));
        tt.insert(key_b, Bound::Exact(2));
        assert_eq!(tt.get(key_b), Some(Bound::Exact(2)));
        // The first key's slot was reused by the second key, so a lookup
        // for it must be a clean miss (partial_key mismatch), never the
        // wrong position's score.
        assert_eq!(tt.get(key_a), None);
    }

    #[test]
    fn shared_table_clear_removes_every_entry() {
        let tt = SharedTranspositionTable::with_capacity(64);
        tt.insert(5, Bound::Exact(1));
        tt.clear();
        assert_eq!(tt.get(5), None);
    }

    #[test]
    fn shared_table_split_is_lossless_like_the_owned_table() {
        let tt = SharedTranspositionTable::with_byte_budget(DEFAULT_BYTE_BUDGET);
        let sample_keys: Vec<u64> = vec![0, 1, 0x3F_FFFF_FFFF, (1u64 << 49) - 1, (1u64 << 49) + 12345];
        for key in sample_keys {
            let (index, partial_key) = tt.split(key);
            let reconstructed = (partial_key as u64) * tt.capacity + (index as u64);
            assert_eq!(reconstructed, key, "key {key:#x} did not round-trip through split()");
        }
    }

    /// Post-Wave-7.1-audit fix: `with_capacity` must clamp a too-small
    /// request UP to `MIN_SAFE_CAPACITY`, not honour it verbatim -- this is
    /// the enforcement half of the fix (the round-trip test below is the
    /// "and it actually prevents the bug" half).
    #[test]
    fn shared_table_with_capacity_clamps_a_tiny_request_up_to_the_safe_floor() {
        for tiny in [0usize, 1, 2, 10, 1000] {
            let tt = SharedTranspositionTable::with_capacity(tiny);
            assert!(
                tt.capacity() >= MIN_SAFE_CAPACITY,
                "requested {tiny}, got capacity {} which is below MIN_SAFE_CAPACITY ({MIN_SAFE_CAPACITY})",
                tt.capacity()
            );
        }
    }

    #[test]
    fn shared_table_with_byte_budget_clamps_a_tiny_budget_up_to_the_safe_floor() {
        // 1 byte requests essentially nothing; without the floor this would
        // round down to a capacity of 1 or 2 slots.
        let tt = SharedTranspositionTable::with_byte_budget(1);
        assert!(tt.capacity() >= MIN_SAFE_CAPACITY);
    }

    /// The concrete bug this wave's audit finding was about: at a small
    /// enough capacity, `partial_key = key / capacity` overflows `u32` and
    /// gets silently truncated by the `as u32` cast, so two DIFFERENT real
    /// ~49-bit keys can alias to the identical `(index, partial_key)` pair
    /// -- a wrong-score risk, not merely wasted work.
    ///
    /// **Carried-forward nit (Wave 7.1 audit, fixed Wave 8): what actually
    /// discriminates here.** This test's own round-trip loop does NOT, by
    /// itself, catch a removed clamp: at the unclamped capacity
    /// (`smallest_prime_at_least(10)` = 11), each of these four keys still
    /// round-trips against ITSELF, because `get` and `insert` compute the
    /// same (truncated, if the clamp were removed) `partial_key` from the
    /// same key deterministically -- self-consistency survives truncation
    /// even though the underlying arithmetic has become lossy. Proving the
    /// clamp specifically requires either (a) two DIFFERENT keys that
    /// truncate to the same `(index, partial_key)` pair at the unclamped
    /// capacity (not attempted here, since constructing one deliberately
    /// is exactly the `k` / `k + capacity` collision form used by
    /// `shared_table_colliding_key_overwrites_rather_than_panics` above,
    /// which tests overwrite-on-collision semantics, a different property
    /// than aliasing prevention), or (b) directly asserting the clamp
    /// fired. This test does (b) -- the `assert!(tt.capacity() >=
    /// MIN_SAFE_CAPACITY, ...)` line immediately below is the assertion
    /// that actually fails if the clamp is removed; the round-trip loop
    /// that follows is a real, additional sanity check (realistic ~2^50
    /// keys survive at the CLAMPED capacity, which the doc comment
    /// originally over-claimed as "proof" on its own) but is not itself
    /// what catches a missing clamp. `distinct_keys_at_realistic_table_
    /// size_never_alias` and `shared_table_split_is_lossless_like_the_
    /// owned_table` are the tests that directly exercise lossless
    /// round-tripping of realistic keys at full production scale.
    #[test]
    fn shared_table_round_trips_realistic_keys_even_when_constructed_with_a_tiny_requested_capacity() {
        let tt = SharedTranspositionTable::with_capacity(10);
        assert!(tt.capacity() >= MIN_SAFE_CAPACITY, "clamp did not apply");

        let realistic_keys: Vec<(u64, i32)> = vec![
            ((1u64 << 49) - 1, 17),
            ((1u64 << 49) + 12345, -3),
            (0x1FF_FFFF_FFFF, 0),
            (0x3F_FFFF_FFFF, -18),
        ];
        for (key, value) in &realistic_keys {
            tt.insert(*key, Bound::Exact(*value));
        }
        for (key, value) in &realistic_keys {
            assert_eq!(
                tt.get(*key),
                Some(Bound::Exact(*value)),
                "key {key:#x} did not round-trip -- a small requested capacity likely let its \
                 partial_key quotient overflow u32 and alias with another key"
            );
        }
    }

    /// Direct test of the packing this module's safety argument leans on:
    /// every `(partial_key, value, kind)` combination that can legally
    /// occur must survive a pack/unpack round trip exactly. A mutation that
    /// overlaps the bit ranges (e.g. shrinking the value field, or reusing
    /// bits between `kind` and `value`) would corrupt some combination here
    /// even though `shared_table_round_trips_a_stored_value` above (which
    /// only exercises one value) might still pass.
    #[test]
    fn pack_unpack_round_trips_every_bound_kind_across_the_full_i8_range() {
        let partial_keys = [0u32, 1, 0xFFFF, u32::MAX];
        let kinds = [Kind::Exact, Kind::Lower, Kind::Upper];
        for &partial_key in &partial_keys {
            for &kind in &kinds {
                for value in i8::MIN..=i8::MAX {
                    let word = pack_word(partial_key, value, kind);
                    let (got_partial, got_value, got_kind) = unpack_word(word);
                    assert_eq!(got_partial, partial_key);
                    assert_eq!(got_value, value);
                    assert!(got_kind == kind);
                }
            }
        }
    }

    #[test]
    fn pack_unpack_empty_word_decodes_as_empty() {
        // A freshly-allocated slot is all-zero (`AtomicU64::new(0)`), which
        // must decode as `Kind::Empty` -- this is what makes a brand new
        // table start out entirely as misses, with no separate
        // initialisation pass needed.
        let (_, _, kind) = unpack_word(0);
        assert!(kind == Kind::Empty);
    }

    /// Real concurrency, not just a sequential smoke test: many threads
    /// hammering many DISTINCT keys must all read back exactly what was
    /// written, with zero corruption -- this is the direct evidence for "no
    /// torn reads" under genuine multi-threaded contention, not just the
    /// structural argument in the doc comment. Keys are every integer in
    /// `0..threads*per_thread` with a table capacity strictly larger than
    /// that range, so `key % capacity == key`: every key maps to its own
    /// index and a collision is impossible by construction (not merely
    /// unlikely), keeping this test's assertions unconditional.
    #[test]
    fn shared_table_survives_many_threads_writing_disjoint_keys_concurrently() {
        use std::sync::Arc;
        use std::thread;

        const THREADS: u64 = 8;
        const PER_THREAD: u64 = 5_000;
        let tt = Arc::new(SharedTranspositionTable::with_capacity(
            (THREADS * PER_THREAD) as usize + 1,
        ));
        assert!(
            tt.capacity() as u64 > THREADS * PER_THREAD,
            "capacity must exceed every key used below for the no-collision argument to hold"
        );

        thread::scope(|scope| {
            for t in 0..THREADS {
                let tt = Arc::clone(&tt);
                scope.spawn(move || {
                    for i in 0..PER_THREAD {
                        let key = t * PER_THREAD + i;
                        let value = ((key % 37) as i32) - 18; // stays in -18..=18
                        tt.insert(key, Bound::Exact(value));
                    }
                });
            }
        });

        for t in 0..THREADS {
            for i in 0..PER_THREAD {
                let key = t * PER_THREAD + i;
                let value = ((key % 37) as i32) - 18;
                assert_eq!(
                    tt.get(key),
                    Some(Bound::Exact(value)),
                    "key {key:#x} did not round-trip after concurrent writes"
                );
            }
        }
    }

    /// Many threads racing to overwrite the SAME key repeatedly: this is
    /// the case the safety argument's point 3 is about. Every read, at
    /// every point during the race, must decode to a *valid* bound (a real
    /// `Kind` variant with an in-range value) -- never a mid-write garbage
    /// state -- because a torn/half-written word is structurally
    /// impossible for a single `AtomicU64`.
    #[test]
    fn shared_table_racing_writers_on_the_same_key_never_produce_a_corrupt_read() {
        use std::sync::atomic::AtomicBool;
        use std::sync::Arc;
        use std::thread;

        let tt = Arc::new(SharedTranspositionTable::with_capacity(1024));
        let stop = Arc::new(AtomicBool::new(false));
        const KEY: u64 = 777;
        // Writers are bounded by iteration count as well as `stop`, quite
        // deliberately: if a corruption bug makes the reader below panic
        // BEFORE it sets `stop`, an unbounded `while !stop` writer loop
        // would spin forever and hang the whole test binary instead of
        // reporting the failure (`thread::scope` still waits for every
        // spawned thread, panicking or not, before propagating the
        // panic) -- caught by running exactly this mutation during this
        // wave's mutation-testing pass.
        const MAX_WRITER_ITERS: i32 = 500_000;

        thread::scope(|scope| {
            for w in 0..4 {
                let tt = Arc::clone(&tt);
                let stop = Arc::clone(&stop);
                scope.spawn(move || {
                    let mut i: i32 = 0;
                    while !stop.load(Ordering::Relaxed) && i < MAX_WRITER_ITERS {
                        let v = (i % 19) - 9 + w; // stays comfortably in -18..=18
                        tt.insert(KEY, Bound::Exact(v));
                        i = i.wrapping_add(1);
                    }
                });
            }

            let reader_tt = Arc::clone(&tt);
            let reader_stop = Arc::clone(&stop);
            scope.spawn(move || {
                for _ in 0..200_000 {
                    match reader_tt.get(KEY) {
                        None => {} // a concurrent insert simply hadn't landed yet
                        Some(Bound::Exact(v)) => {
                            assert!(
                                (i8::MIN as i32..=i8::MAX as i32).contains(&v),
                                "decoded value {v} out of range: word must have been corrupted"
                            );
                        }
                        Some(other) => panic!("decoded an impossible bound kind: {other:?}"),
                    }
                }
                reader_stop.store(true, Ordering::Relaxed);
            });
        });
    }

    #[test]
    fn distinct_keys_at_realistic_table_size_never_alias() {
        // At the default 64 MB budget, capacity is comfortably above the
        // 2^18 floor the module doc comment calls out, so partial_key
        // must reconstruct every distinct real `Position::key()` value
        // without loss. Exercise that directly against a spread of
        // representative key magnitudes (up to just under the documented
        // ~50-bit bound) rather than trusting the arithmetic unverified.
        let tt = TranspositionTable::with_byte_budget(DEFAULT_BYTE_BUDGET);
        let sample_keys: Vec<u64> = vec![
            0,
            1,
            0x3F_FFFF_FFFF,  // 2^38 - 1
            0x1FF_FFFF_FFFF, // 2^41 - 1
            (1u64 << 49) - 1,
            (1u64 << 49) + 12345,
        ];
        for key in sample_keys {
            let (index, partial_key) = tt.split(key);
            let reconstructed = (partial_key as u64) * tt.capacity + (index as u64);
            assert_eq!(
                reconstructed, key,
                "key {key:#x} did not round-trip through split(); partial_key truncated it"
            );
        }
    }
}
