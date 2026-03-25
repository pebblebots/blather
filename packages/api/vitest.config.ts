import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@blather/api': fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      '@blather/db': fileURLToPath(new URL('../db/src/index.ts', import.meta.url)),
      '@blather/types': fileURLToPath(new URL('../types/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    passWithNoTests: true,
    include: ['src/**/*.test.ts'],
  },
});
