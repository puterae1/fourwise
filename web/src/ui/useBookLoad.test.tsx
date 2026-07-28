// @vitest-environment jsdom

// `useBookLoad` (Wave 9): fires `client.loadBookFromNetwork()` once per
// client, WITHOUT blocking first paint (no rendered state at all -- this is
// a pure side effect), and degrades any failure silently (SPEC: no
// user-visible error, at most one console.info line). The
// single-flight/retry mechanism itself is `EngineClient.
// loadBookFromNetwork`'s own job (covered by `engine/client.test.ts`); this
// file covers the hook's OWN responsibilities: fire-once-per-client, silent
// failure, and no misapplied state if the component moves on before the
// fetch settles (the stale-race precedent, applied here: there is nothing
// this hook renders, so "misapplied state" means "acts on a call that is no
// longer current" -- covered below by asserting nothing happens after
// unmount/client-change).

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useBookLoad } from './useBookLoad.js';
import type { EngineClient } from '../engine/client.js';
import type { BookLoadResult } from '../engine/types.js';

afterEach(cleanup);

function notUsedHere(name: string): never {
  throw new Error(`${name}() is not used by this test`);
}

function makeFakeClient(): { client: EngineClient; calls: number; settle: (result: BookLoadResult) => void; reject: (err: Error) => void } {
  let calls = 0;
  let resolveFn: ((result: BookLoadResult) => void) | null = null;
  let rejectFn: ((err: Error) => void) | null = null;
  const client: EngineClient = {
    analyse: async () => notUsedHere('analyse'),
    analyseProgressive: async () => notUsedHere('analyseProgressive'),
    calibrate: async () => notUsedHere('calibrate'),
    tacticalFallback: async () => notUsedHere('tacticalFallback'),
    setBookEnabled: async () => notUsedHere('setBookEnabled'),
    loadBookFromNetwork: () => {
      calls++;
      return new Promise<BookLoadResult>((resolve, reject) => {
        resolveFn = resolve;
        rejectFn = reject;
      });
    },
    terminate: () => {},
  };
  return {
    client,
    get calls() {
      return calls;
    },
    settle: (result: BookLoadResult) => resolveFn!(result),
    reject: (err: Error) => rejectFn!(err),
  };
}

function Harness({ client }: { client: EngineClient | null }) {
  useBookLoad(client);
  return null;
}

let infoSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  infoSpy.mockRestore();
});

describe('useBookLoad', () => {
  it('does nothing while client is null (no crash, nothing to call)', () => {
    render(<Harness client={null} />);
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('calls loadBookFromNetwork exactly once for a given client', () => {
    const fake = makeFakeClient();
    render(<Harness client={fake.client} />);
    expect(fake.calls).toBe(1);
  });

  it('a successful load (ok: true) logs nothing at all', async () => {
    const fake = makeFakeClient();
    render(<Harness client={fake.client} />);
    fake.settle({ ok: true, entries: 100, depth: 8, error: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it('a validation rejection (ok: false, corrupt book) logs exactly one info line, never throws/rejects visibly', async () => {
    const fake = makeFakeClient();
    render(<Harness client={fake.client} />);
    fake.settle({ ok: false, entries: 0, depth: 0, error: 'bad header' });
    await Promise.resolve();
    await Promise.resolve();
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it('a network/HTTP failure (the current live state -- book.bin does not exist yet) logs exactly one info line', async () => {
    const fake = makeFakeClient();
    render(<Harness client={fake.client} />);
    fake.reject(new Error('Opening book fetch returned HTTP 404 for /book.bin'));
    await Promise.resolve();
    await Promise.resolve();
    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(infoSpy.mock.calls[0]![0]).not.toMatch(/404|error|Error/); // no raw error text leaked into the user-visible-ish channel
  });

  it('re-rendering with the SAME client instance never calls loadBookFromNetwork a second time', () => {
    const fake = makeFakeClient();
    const { rerender } = render(<Harness client={fake.client} />);
    rerender(<Harness client={fake.client} />);
    rerender(<Harness client={fake.client} />);
    expect(fake.calls).toBe(1);
  });

  it('a genuinely NEW client instance triggers a fresh call (retryable, per client)', () => {
    const fakeA = makeFakeClient();
    const fakeB = makeFakeClient();
    const { rerender } = render(<Harness client={fakeA.client} />);
    expect(fakeA.calls).toBe(1);
    rerender(<Harness client={fakeB.client} />);
    expect(fakeB.calls).toBe(1);
    expect(fakeA.calls).toBe(1); // the old client's own count is untouched
  });

  it('stale-race: unmounting before the fetch settles means nothing fires afterwards -- no misapplied state, no error', async () => {
    const fake = makeFakeClient();
    const { unmount } = render(<Harness client={fake.client} />);
    unmount();
    // The promise resolves AFTER the component (and this hook's effect) is
    // long gone -- must be a complete no-op, not a crash or a late log.
    fake.settle({ ok: false, entries: 0, depth: 0, error: 'too late' });
    await Promise.resolve();
    await Promise.resolve();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
