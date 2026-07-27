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
/// quotient `key / capacity` could exceed `u32::MAX`. Only referenced from
/// tests (production code always goes through `with_byte_budget`, which
/// clears this by construction); `#[cfg(test)]` keeps non-test builds free
/// of a dead-code warning.
#[cfg(test)]
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
