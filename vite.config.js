import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, /api is proxied to Rails so no CORS setup is needed.
// 127.0.0.1 (not "localhost") avoids IPv6 resolution problems with Rails.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': { target: process.env.API_TARGET ?? 'http://localhost:3001', changeOrigin: true } },
  },
});
