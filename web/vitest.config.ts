import { defineConfig } from 'vitest/config';

// Engine tests load the real wasm module directly in Node (no browser, no
// worker, no DOM) — see docs/ENGINE.md "Boundary mechanics". `environment:
// 'node'` is deliberate: none of Wave 3's tests render a component.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 20000,
  },
});
