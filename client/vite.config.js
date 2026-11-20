import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the site under /harvest.x/, so the build is given VITE_BASE=/harvest.x/. Locally and on Netlify it stays "/".
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: { port: 5173 },
});
