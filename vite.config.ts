import { defineConfig } from 'vitest/config';

// `base: './'` keeps asset URLs relative so the built site works from any path
// (GitHub Pages project sites live under /<repo-name>/).
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
