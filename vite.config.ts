import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// `base` must match the repo name for a GitHub Pages project site
// (served at username.github.io/<repo>/). Preview serves the built files, so it needs the
// same base or every asset 404s. Dev stays at '/'.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/clustr-app/' : '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // transformers.js ships its own wasm/ort; don't let Vite pre-bundle it.
    exclude: ['@huggingface/transformers'],
  },
}));
