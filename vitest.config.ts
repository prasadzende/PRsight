import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared'), '@analysis': resolve('src/analysis') } },
  test: { include: ['tests/**/*.test.ts'], exclude: ['tests/e2e/**'], environment: 'node' },
});
