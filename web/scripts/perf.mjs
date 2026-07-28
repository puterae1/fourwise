#!/usr/bin/env node
// Wave 6a perf-smoke harness runner (`docs/ROADMAP.md` gate #3's desk proxy).
//
// Drives the dev-only `?perf` harness (`src/perf/PerfHarness.tsx`) through
// headless system Chrome via `puppeteer-core` (sanctioned dependency — no
// bundled Chromium download), applying CDP `Emulation.setCPUThrottlingRate`
// at 1x (baseline), 4x and 6x, and prints a table:
//
//   position | ply | ms@1x | ms@4x | ms@6x | pass/fail vs the 400ms@4x bar
//
// ...plus a WORST CASE summary row (owner ruling, 2026-07-28, mid-Wave-6a):
// the overall pass/fail verdict keys off the single slowest position at 4x
// across the whole ply 12-25 suite, never an average -- "a gate that passes
// on average and stalls on one position in ten fails in the bar."
//
// This is explicitly a SMOKE TEST (ROADMAP.md gate #3's own wording): throttled
// desktop Chrome is a poor proxy for mobile WASM performance (memory
// bandwidth, JIT, the 64MB TT is bandwidth-sensitive). The actual gate
// evidence is a real phone on the deployed URL. Numbers here are reported
// exactly as measured — a miss is a finding to report, not a reason to
// loosen the bar or retry until it passes.
//
// Usage: `npm run perf` (from `web/`). Expects (or starts) the Vite dev
// server on port 5183 — the harness is dev-gated (`main.tsx`) and does not
// exist in a production build at all, so this must run against `vite dev`,
// never `vite preview`.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 5183;
const BASE_URL = `http://localhost:${PORT}`;
const RATES = [1, 4, 6];
const BAR_MS_AT_4X = 400;
const PER_RATE_TIMEOUT_MS = 10 * 60 * 1000; // generous — see PerfHarness's own per-position abort

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', // macOS
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    'No system Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH to its binary and re-run `npm run perf`.',
  );
}

async function isServerUp() {
  try {
    const res = await fetch(BASE_URL, { method: 'GET' });
    return res.ok || res.status === 404; // any response at all means something is listening
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerUp()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Dev server did not come up on ${BASE_URL} within ${timeoutMs}ms.`);
}

/** Starts `vite dev` if nothing is already listening on PORT. Returns a
 * cleanup function -- a NO-OP if a server was already running (we never
 * touch a server we didn't start), so a manually-started `npm run dev`
 * survives this script exactly as the task's Definition of Done wants
 * ("dev server running on 5183"). */
async function ensureDevServer() {
  if (await isServerUp()) {
    console.log(`[perf] reusing the dev server already running on ${BASE_URL}`);
    return async () => {};
  }
  console.log(`[perf] starting \`npm run dev\` on port ${PORT}...`);
  const child = spawn('npm', ['run', 'dev'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await waitForServer(30_000);
  console.log('[perf] dev server is up.');
  // Deliberately NOT torn down at the end -- the task's Definition of Done
  // wants the dev server left running on 5183.
  return async () => {};
}

async function runAtRate(browser, rate) {
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate });

  await page.goto(`${BASE_URL}/?perf`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#perf-harness[data-status="done"]', { timeout: PER_RATE_TIMEOUT_MS });
  const json = await page.$eval('#perf-json', (el) => el.textContent ?? '[]');
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 }); // leave the page in a sane state before closing
  await page.close();
  return JSON.parse(json);
}

/** Worst (= slowest, max) `msN` across every position -- owner ruling
 * (2026-07-28, mid-Wave-6a): "report the WORST case across the ply 12-25
 * suite, not the median -- a gate that passes on average and stalls on one
 * position in ten fails in the bar." The verdict below keys off this, not
 * off an average or a per-row pass count. */
function worstCase(rows, rate) {
  const key = `ms${rate}`;
  let worst = null;
  for (const r of rows) {
    if (r[key] === undefined) continue;
    if (worst === null || r[key] > worst[key]) worst = r;
  }
  return worst;
}

function formatTable(byPosition) {
  const rows = [...byPosition.values()].sort((a, b) => a.ply - b.ply);
  const header = ['position', 'ply', 'ms@1x', 'ms@4x', 'ms@6x', 'pass @4x (<400ms)'];
  const widths = header.map((h) => h.length);

  function rowValues(r, label) {
    return [
      label ?? r.moves,
      String(r.ply),
      r.ms1 !== undefined ? r.ms1.toFixed(1) : 'n/a',
      r.ms4 !== undefined ? r.ms4.toFixed(1) : 'n/a',
      r.ms6 !== undefined ? r.ms6.toFixed(1) : 'n/a',
      r.ms4 !== undefined ? (r.ms4 < BAR_MS_AT_4X ? 'PASS' : 'FAIL') : 'n/a',
    ];
  }

  const cells = rows.map((r) => rowValues(r));

  // The worst-case summary row: independently worst PER RATE column (the
  // slowest position at 1x need not be the slowest at 4x/6x), plus its own
  // pass/fail keyed off the worst ms@4x specifically -- this is the row the
  // gate verdict actually reads, not any individual position's row above it.
  const w1 = worstCase(rows, 1);
  const w4 = worstCase(rows, 4);
  const w6 = worstCase(rows, 6);
  const summary = [
    'WORST CASE',
    '-',
    w1 ? w1.ms1.toFixed(1) : 'n/a',
    w4 ? w4.ms4.toFixed(1) : 'n/a',
    w6 ? w6.ms6.toFixed(1) : 'n/a',
    w4 ? (w4.ms4 < BAR_MS_AT_4X ? 'PASS' : 'FAIL') : 'n/a',
  ];

  const allRows = [...cells, summary];
  allRows.forEach((values) => values.forEach((v, i) => (widths[i] = Math.max(widths[i], v.length))));

  const pad = (v, i) => v.padEnd(widths[i]);
  const line = (values) => '| ' + values.map(pad).join(' | ') + ' |';
  const sep = '|-' + widths.map((w) => '-'.repeat(w)).join('-|-') + '-|';
  const summarySep = sep; // same rule, printed again to set the summary row apart visually
  const lines = [line(header), sep, ...cells.map(line), summarySep, line(summary)];
  return { table: lines.join('\n'), worst4: w4 };
}

async function main() {
  const executablePath = findChrome();
  await ensureDevServer();

  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const byPosition = new Map();
    for (const rate of RATES) {
      console.log(`[perf] running the suite at CPU throttling rate ${rate}x...`);
      const results = await runAtRate(browser, rate);
      for (const r of results) {
        const entry = byPosition.get(r.moves) ?? { moves: r.moves, ply: r.ply, source: r.source };
        entry[`ms${rate}`] = r.ms;
        entry[`complete${rate}`] = r.complete;
        byPosition.set(r.moves, entry);
      }
    }

    const { table, worst4 } = formatTable(byPosition);
    console.log('\n' + table + '\n');

    console.log(
      '[perf] CAVEAT -- see `scripts/perf-throttle-probe.mjs` (run it with `npm run perf:probe`) for the\n' +
        '  committed, standalone artifact behind this claim: CDP `Emulation.setCPUThrottlingRate` throttles this\n' +
        '  page\'s MAIN thread but was measured NOT to slow down a dedicated Web Worker\'s execution at all in this\n' +
        '  Chrome build (a busy-loop timed ~4x/~6x slower on the main thread at those rates, but the SAME loop\n' +
        '  run inside a Worker came back within noise of its 1x time). The engine analysis this harness times runs\n' +
        '  entirely inside a Worker (CLAUDE.md invariant #4), so the ms@4x/ms@6x columns above are NOT genuinely\n' +
        '  CPU-constrained measurements of the analysis path -- they are close to a second and third 1x sample.\n' +
        '  Treat every "PASS" above as "fast at 1x, sampled three times", not as verified headroom under 4x/6x\n' +
        '  load. This is consistent with ROADMAP.md gate #3 already treating desk numbers as a smoke test only and\n' +
        '  requiring a real phone for actual gate evidence.',
    );

    const anyMissing = [...byPosition.values()].some((r) => !r.complete1 || !r.complete4 || !r.complete6);
    if (anyMissing) {
      console.log(
        '[perf] NOTE: at least one run did not reach `complete: true` within the per-position timeout -- its ms figure above is a lower bound, not a settled result.',
      );
    }

    // Owner ruling (2026-07-28, mid-Wave-6a): the gate verdict keys off the
    // WORST case at 4x, not an average and not "did most positions pass" --
    // one stall in ten is a failed bar, full stop. Per-row PASS/FAIL above
    // still shows which position(s), if any, are the problem.
    const failures = [...byPosition.values()].filter((r) => r.ms4 !== undefined && r.ms4 >= BAR_MS_AT_4X);
    if (worst4 && worst4.ms4 >= BAR_MS_AT_4X) {
      console.log(
        `[perf] FINDING: worst case at 4x is ${worst4.ms4.toFixed(1)}ms (position ${worst4.moves}, ply ${worst4.ply}) -- ` +
          `MISSES the 400ms@4x bar. ${failures.length} position(s) total missed it: ` +
          failures.map((r) => `${r.moves} (ply ${r.ply}, ${r.ms4.toFixed(1)}ms)`).join(', '),
      );
    } else if (worst4) {
      console.log(
        `[perf] worst case at 4x is ${worst4.ms4.toFixed(1)}ms (position ${worst4.moves}, ply ${worst4.ply}) -- ` +
          'stays under the 400ms@4x bar, so every position does.',
      );
    } else {
      console.log('[perf] no ms@4x samples were collected -- nothing to verdict.');
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[perf] failed:', err);
  process.exitCode = 1;
});
