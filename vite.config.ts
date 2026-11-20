import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
// The app is served from the root of its own domain, clustr.design, so every command uses
// the default base of '/'.
export default defineConfig({
  base: '/',
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // transformers.js ships its own wasm/ort; don't let Vite pre-bundle it.
    exclude: ['@huggingface/transformers'],
  },
});
