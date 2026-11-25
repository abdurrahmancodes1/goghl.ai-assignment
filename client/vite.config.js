import { defineConfig } from 'vite';

// Browser requests stay same-origin; backend credentials never enter the bundle.
const target = process.env.API_PROXY_TARGET || 'http://localhost:4000';
export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target },
      '/auth': { target },
      '/healthz': { target },
      '/ws': { target, ws: true },
    },
  },
});
