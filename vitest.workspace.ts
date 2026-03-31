import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/api/vitest.config.ts',
  'packages/web/vitest.config.ts',
  'packages/types/vitest.config.ts',
  'packages/db/vitest.config.ts',
]);
