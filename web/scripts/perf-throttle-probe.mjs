#!/usr/bin/env node
// Standalone probe backing a specific claim `perf.mjs` makes in its own
// printed caveat: CDP `Emulation.setCPUThrottlingRate` throttles a page's
// MAIN thread but does NOT measurably slow down a dedicated Web Worker's
// execution in this Chrome build. That claim used to exist only as prose in
// `perf.mjs`'s console output, with no committed artifact behind it
// (verifier audit, Wave 6a) -- this script IS the artifact: it times the
// same busy-loop on the main thread and inside a `Worker`, at CPU throttling
// rates 1x/4x/6x, and prints both.
//
// Usage: `node scripts/perf-throttle-probe.mjs` (from `web/`). Needs a page
// to load -- reuses the dev server on 5183 exactly like `perf.mjs` (starts
// it if nothing is listening there yet, and never tears down a server it
// didn't start).
//
// Expected result, if the claim holds: the main-thread timings scale
// roughly with the throttling rate (4x rate -> ~4x slower, 6x -> ~6x
// slower); the Worker timings stay roughly flat across all three rates.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const PORT = 5183;
const BASE_URL = `http://localhost:${PORT}`;
const RATES = [1, 4, 6];
const LOOP_ITERATIONS = 200_000_000;

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
    'No system Chrome/Chromium found. Set PUPPETEER_EXECUTABLE_PATH to its binary and re-run this script.',
  );
}

async function isServerUp() {
  try {
    const res = await fetch(BASE_URL, { method: 'GET' });
    return res.ok || res.status === 404;
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

async function ensureDevServer() {
  if (await isServerUp()) {
    console.log(`[probe] reusing the dev server already running on ${BASE_URL}`);
    return;
  }
  console.log(`[probe] starting \`npm run dev\` on port ${PORT}...`);
  const child = spawn('npm', ['run', 'dev'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  await waitForServer(30_000);
  console.log('[probe] dev server is up.');
  // Deliberately not torn down -- same policy as `perf.mjs`.
}

async function timeMainThread(browser, rate) {
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const ms = await page.evaluate((n) => {
    const start = performance.now();
    let x = 0;
    for (let i = 0; i < n; i++) x += i;
    return performance.now() - start;
  }, LOOP_ITERATIONS);
  await page.close();
  return ms;
}

async function timeWorker(browser, rate) {
  const page = await browser.newPage();
  const client = await page.createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate });
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  const ms = await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        const src = `
          const start = performance.now();
          let x = 0;
          for (let i = 0; i < ${n}; i++) x += i;
          postMessage(performance.now() - start);
        `;
        const blob = new Blob([src], { type: 'application/javascript' });
        const url = URL.createObjectURL(blob);
        const worker = new Worker(url);
        worker.onmessage = (event) => {
          worker.terminate();
          URL.revokeObjectURL(url);
          resolve(event.data);
        };
      }),
    LOOP_ITERATIONS,
  );
  await page.close();
  return ms;
}

async function main() {
  const executablePath = findChrome();
  await ensureDevServer();

  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const results = [];
    for (const rate of RATES) {
      const mainMs = await timeMainThread(browser, rate);
      const workerMs = await timeWorker(browser, rate);
      results.push({ rate, mainMs, workerMs });
      console.log(`[probe] rate ${rate}x -- main thread: ${mainMs.toFixed(1)}ms, Worker: ${workerMs.toFixed(1)}ms`);
    }

    const baseline = results[0];
    console.log('\n| rate | main thread (ms) | main/1x ratio | Worker (ms) | Worker/1x ratio |');
    console.log('|------|-------------------|---------------|-------------|-----------------|');
    for (const r of results) {
      console.log(
        `| ${String(r.rate).padEnd(4)} | ${r.mainMs.toFixed(1).padEnd(17)} | ${(r.mainMs / baseline.mainMs).toFixed(2).padEnd(13)} | ${r.workerMs.toFixed(1).padEnd(11)} | ${(r.workerMs / baseline.workerMs).toFixed(2).padEnd(15)} |`,
      );
    }

    console.log(
      '\n[probe] If CDP CPU throttling propagated into Workers the way it does into the main thread, the\n' +
        '  "Worker/1x ratio" column above would track the rate (~4.0 at 4x, ~6.0 at 6x) the same way the main\n' +
        '  thread column does. Read the printed ratios directly -- this script draws no conclusion for you.',
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[probe] failed:', err);
  process.exitCode = 1;
});
