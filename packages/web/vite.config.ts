import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'child_process';

const gitHash = execSync('git rev-parse --short HEAD').toString().trim();
const gitHashFull = execSync('git rev-parse HEAD').toString().trim();
const gitDate = execSync('git log -1 --format=%ci').toString().trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __GIT_HASH__: JSON.stringify(gitHash),
    __GIT_HASH_FULL__: JSON.stringify(gitHashFull),
    __GIT_DATE__: JSON.stringify(gitDate),
  },
  server: {
    port: 5173,
    allowedHosts: ['.ts.net'],
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/api/ws': {
        target: (process.env.VITE_API_URL || 'http://localhost:3000').replace('http', 'ws'),
        ws: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
});
