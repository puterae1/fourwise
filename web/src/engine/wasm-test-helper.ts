// Test-only helper: loads the real wasm bytes from disk so vitest can run
// against the actual engine in Node, per `docs/ENGINE.md` "Boundary
// mechanics" (init accepts wasm bytes directly: `init({ module_or_path:
// readFileSync(...) })` — proven to work in Node).
//
// Not imported by any production code path.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const wasmPath = fileURLToPath(new URL('./pkg/connect4_engine_bg.wasm', import.meta.url));

export function readWasmBytes(): Buffer {
  return readFileSync(wasmPath);
}
