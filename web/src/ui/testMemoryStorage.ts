// Test-only helper. In this project's pinned toolchain (vitest 4 + jsdom on
// a Node build that ships its own experimental global `localStorage`),
// `window.localStorage` inside the jsdom test environment is a plain
// object with none of the `Storage` methods -- `setItem`/`getItem`/`clear`
// are all `undefined`, independent of anything this app does. Real
// browsers are unaffected; this is purely a test-environment gap.
//
// `seatStorage.ts` already accepts an injectable `Storage` for exactly this
// reason, but `App.tsx` calls it with the default (real `window.localStorage`)
// so its tests need a working one installed. This installs a minimal
// in-memory `Storage` in place of the broken one, so seat-persistence tests
// exercise the same `getItem`/`setItem`/JSON round trip production code
// actually runs.

export function installMemoryLocalStorage(): void {
  const data = new Map<string, string>();
  const memoryStorage: Storage = {
    getItem: (key: string) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      data.set(key, String(value));
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(window, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}
