import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// The viewer is built once into viewer-dist (committed), so a project using
// sinopia serves it without Vue or Vite. `base: './'` lets one build serve a
// single map at / and many maps at /p/<name>/.
export default defineConfig({
  root: fileURLToPath(new URL('./src/viewer', import.meta.url)),
  base: './',
  plugins: [vue(), tailwindcss()],
  build: {
    outDir: fileURLToPath(new URL('./viewer-dist', import.meta.url)),
    emptyOutDir: true,
  },
});
