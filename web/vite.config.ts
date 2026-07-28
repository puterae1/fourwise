import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves this as a project site, not a user/org site, so the
// production build is deployed under `/fourwise/` rather than `/`. Local
// dev (`npm run dev`) and `vite preview` must keep the root path, so this
// only changes for `vite build`, which Vite's config function reports via
// `command === 'build'` (both `dev` and `preview` report `'serve'`).
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/fourwise/' : '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  server: {
    port: 5183,
    strictPort: true,
  },
}));
