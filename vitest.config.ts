import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Opt-in sandbox tests read their credentials from a local, git-ignored .env file.
try {
  process.loadEnvFile('.env');
} catch {
  // No .env file: sandbox tests are skipped.
}

export default defineConfig({
  resolve: {
    alias: {
      // Test packages against each other's sources, without building first.
      '@payenv/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
  },
});
