import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Everything server-side is proxied to the API so cookies are
// same-origin and no CORS config exists anywhere.
const api = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': api,
      '/dev': api,
      '/v1': { target: api, ws: true },
      '/healthz': api,
    },
  },
});
