import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './ui/App.js';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("index.html is missing the #root element the app mounts into.");
}
// Re-bound to its own `const` with an explicit non-null type: TypeScript's
// narrowing of `rootElement` from the guard above does not reliably survive
// into `bootstrap`'s nested async closure below (the same pattern
// `useGameController.ts`'s `activeGame` works around).
const container: HTMLElement = rootElement;

// Wave 6a's perf-smoke harness (`docs/ROADMAP.md` gate #3's desk proxy):
// reachable only via `?perf` on the Vite DEV server, and only because
// `import.meta.env.DEV` is statically `true` there. In a production build
// (`npm run build`) Vite/Rollup replaces `import.meta.env.DEV` with the
// literal `false`, so this whole branch — including the dynamic `import()`,
// which is what actually pulls the harness module and its fixture literals
// into a chunk — is dead code and gets tree-shaken out entirely. Normal
// users of the deployed app can never reach it, with or without the query
// param, because the code simply isn't there to run.
async function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  if (import.meta.env.DEV && params.has('perf')) {
    const { PerfHarness } = await import('./perf/PerfHarness.js');
    createRoot(container).render(<PerfHarness />);
    return;
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
