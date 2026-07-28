import { defineConfig } from 'vitest/config';

// Engine and game-layer tests load the real wasm module (or pure TS) directly
// in Node (no browser, no worker, no DOM) — see docs/ENGINE.md "Boundary
// mechanics". `environment: 'node'` stays the default for exactly that
// reason. Wave 4b's component tests render React components and need a DOM;
// rather than flipping every test over to jsdom (and paying its startup cost
// on tests that never touch a component), those `.test.tsx` files opt in
// individually with a `// @vitest-environment jsdom` docblock at the top of
// the file. `include` is widened to pick them up.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 20000,
  },
});
