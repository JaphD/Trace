import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: '127.0.0.1', hmr: process.env.DISABLE_HMR !== 'true' },
  build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'] } } } },
});
