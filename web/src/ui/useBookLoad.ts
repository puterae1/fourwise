// Wave 9: kicks off the opening-book fetch+load exactly once per distinct
// `EngineClient` instance, WITHOUT blocking first paint or engine init --
// this is a pure side effect with no rendered state at all (no loading
// spinner, no "book ready" flag anyone consumes). `App.tsx` is the one
// production caller, mounted alongside `useEngineClient`'s own client.
//
// Failure of ANY kind -- a network error, an HTTP error (the CURRENT live
// state, since `book.bin` does not exist yet), or an honest `ok: false`
// validation rejection of a fetched-but-corrupt book -- degrades to plain
// search SILENTLY, per SPEC: no user-visible error, at most one
// `console.info` line. The single-flight/retry discipline itself lives in
// `EngineClient.loadBookFromNetwork` (mirrors `.calibrate()`'s own
// single-flight pattern exactly); this hook never re-implements it, it just
// calls that method once and reports the outcome quietly.

import { useEffect, useRef } from 'react';
import type { EngineClient } from '../engine/client.js';

export function useBookLoad(client: EngineClient | null): void {
  // Guards against firing twice for the SAME client instance (e.g. React
  // StrictMode's mount/cleanup/mount dance in dev) -- `loadBookFromNetwork`
  // is already single-flight internally, so this is not needed for
  // correctness of the underlying fetch, but it keeps the "at most one
  // console.info line" promise honest even under a double-invoke, and keeps
  // this the one place that decides "have I already acted on this client".
  const attemptedFor = useRef<EngineClient | null>(null);

  useEffect(() => {
    if (!client) return;
    if (attemptedFor.current === client) return;
    attemptedFor.current = client;

    let cancelled = false;
    client.loadBookFromNetwork().then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          // eslint-disable-next-line no-console
          console.info('fourwise: opening book failed validation; continuing with plain search.');
        }
        // `ok: true` needs no log at all -- silent success is the normal,
        // unremarkable case (SPEC: "no console spam beyond one info line").
      },
      () => {
        if (cancelled) return;
        // eslint-disable-next-line no-console
        console.info('fourwise: opening book unavailable; continuing with plain search.');
      },
    );

    return () => {
      cancelled = true;
    };
  }, [client]);
}
