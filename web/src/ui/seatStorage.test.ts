// Dedicated unit tests for `seatStorage.ts`'s garbage-input path (a gap
// left open since Wave 5a: the seat prompt/App integration tests exercise
// valid stored seats via `firstRun.test.tsx`, but nothing previously drove
// `loadStoredSeat` with malformed data directly). Runs in the default
// `node` environment -- every call here passes an explicit fake `Storage`,
// so `window.localStorage` (the default parameter) is never evaluated.

import { describe, expect, it } from 'vitest';
import { loadStoredSeat, saveSeat, SEAT_STORAGE_KEY } from './seatStorage.js';

function makeMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

describe('loadStoredSeat -- valid input', () => {
  it('round-trips a saved seat', () => {
    const storage = makeMemoryStorage();
    saveSeat({ firstMover: 'yellow', userColour: 'red' }, storage);
    expect(loadStoredSeat(storage)).toEqual({ firstMover: 'yellow', userColour: 'red' });
  });

  it('returns null on a fresh storage with nothing stored', () => {
    expect(loadStoredSeat(makeMemoryStorage())).toBeNull();
  });
});

describe('loadStoredSeat -- garbage input never crashes, always null', () => {
  it('malformed JSON', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, '{ this is not json');
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('valid JSON that is not an object (a bare string)', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify('red'));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('valid JSON that is not an object (a number)', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify(42));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('valid JSON, null', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify(null));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('valid JSON object, wrong shape: missing both fields', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ someOtherKey: true }));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('valid JSON object, wrong shape: only one of the two fields present', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'red' }));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('non-colour value for firstMover', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'blue', userColour: 'red' }));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('non-colour value for userColour', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 'red', userColour: 'green' }));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('non-string colour values (numbers)', () => {
    const storage = makeMemoryStorage();
    storage.setItem(SEAT_STORAGE_KEY, JSON.stringify({ firstMover: 1, userColour: 2 }));
    expect(loadStoredSeat(storage)).toBeNull();
  });

  it('returns null (never throws) if the underlying storage throws on getItem', () => {
    const storage: Storage = {
      getItem: () => {
        throw new Error('quota exceeded, or private browsing');
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(loadStoredSeat(storage)).toBeNull();
  });
});

describe('saveSeat -- best-effort, never throws', () => {
  it('does not throw when the underlying storage throws on setItem', () => {
    const storage: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    };
    expect(() => saveSeat({ firstMover: 'red', userColour: 'yellow' }, storage)).not.toThrow();
  });
});
