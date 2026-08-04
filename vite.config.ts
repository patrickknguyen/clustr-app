import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// `base` must match the repo name for a GitHub Pages project site
// (served at username.github.io/<repo>/). Dev stays at '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/clustr-app/' : '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // transformers.js ships its own wasm/ort; don't let Vite pre-bundle it.
    exclude: ['@huggingface/transformers'],
  },
}));
