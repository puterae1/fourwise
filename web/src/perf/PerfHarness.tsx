// Dev-only perf-smoke harness — ROADMAP.md gate #3's desk proxy. NOT part of
// the normal UX: only reachable via `?perf` on the DEV server, and gated
// behind `import.meta.env.DEV` in `main.tsx` so a production build (`npm run
// build`) tree-shakes this whole module out (`import()` inside a statically-
// `false` `if` is dead code Rollup removes entirely — verified by grepping
// `dist/` for a string unique to this file after a production build).
//
// Runs the fixed `PERF_POSITIONS` suite (`positions.ts`) to completion
// through the REAL production path: `createEngineClient()` (the real Worker
// + wasm module), `analyseProgressive` (the same escalating-budget call
// `useGameController.ts` makes), timed with `performance.now()`. One fresh
// client per position — a fresh Worker, a fresh wasm instance, an empty
// transposition table — so one position's cache can never subsidise the
// next one's timing.
//
// `scripts/perf.mjs` drives this page three times (1x/4x/6x CPU throttling
// via CDP), reading the JSON this component renders into `#perf-json` once
// `#perf-harness`'s `data-status` reaches `"done"`.

import { useEffect, useRef, useState } from 'react';
import { createEngineClient } from '../engine/client.js';
import { PERF_POSITIONS } from './positions.js';

/** Generous headroom over what any of these positions should need (SPEC's
 * own gate: ply >= 12 completes under 1s on-device) — this is a smoke test,
 * not a hard timeout, so it only guards against a genuine hang, not against
 * a slow-but-real result. */
const NODE_BUDGET_CEILING = 200_000_000;
/** Per-position abort: if a position hasn't completed by this wall-clock
 * budget, `analyseProgressive` returns its last (incomplete) result instead
 * of hanging the whole suite — see `engine/client.ts`'s `signal` handling. */
const PER_POSITION_TIMEOUT_MS = 30_000;

export interface PerfResultEntry {
  moves: string;
  ply: number;
  source: string;
  ms: number;
  complete: boolean;
  nodes: number;
}

export function PerfHarness() {
  const [results, setResults] = useState<PerfResultEntry[]>([]);
  const [status, setStatus] = useState<'running' | 'done'>('running');
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return; // guards a StrictMode-style double-invoke; this component isn't mounted under StrictMode itself (see main.tsx), but costs nothing to guard anyway
    ranRef.current = true;

    void (async () => {
      const out: PerfResultEntry[] = [];
      for (const pos of PERF_POSITIONS) {
        const client = createEngineClient();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), PER_POSITION_TIMEOUT_MS);
        const start = performance.now();
        let result;
        try {
          result = await client.analyseProgressive(pos.moves, {
            budgetCeiling: NODE_BUDGET_CEILING,
            signal: controller.signal,
            onUpdate: () => {},
          });
        } finally {
          clearTimeout(timeout);
        }
        const ms = performance.now() - start;
        client.terminate();
        out.push({
          moves: pos.moves,
          ply: pos.ply,
          source: pos.source,
          ms,
          complete: result.complete,
          nodes: result.nodes,
        });
        setResults([...out]);
      }
      setStatus('done');
    })();
  }, []);

  return (
    <div id="perf-harness" data-status={status}>
      <h1>fourwise perf harness (dev only — not part of the shipped app)</h1>
      <p>
        Running {PERF_POSITIONS.length} fixed positions (plies {PERF_POSITIONS[0]?.ply}–
        {PERF_POSITIONS[PERF_POSITIONS.length - 1]?.ply}) to completion through the real
        Worker/wasm path. {results.length} / {PERF_POSITIONS.length} done.
      </p>
      <pre id="perf-json">{JSON.stringify(results)}</pre>
    </div>
  );
}
