import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from GitHub Pages (/roadwatch/)
  // and from any local folder, not just a domain root.
  base: './',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
