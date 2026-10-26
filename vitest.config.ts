import { defineConfig } from 'vitest/config';

// The "@massimiliano-dev/source" export condition maps workspace packages to their TypeScript sources,
// so tests never depend on a previous build.
const conditions = ['@massimiliano-dev/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts'],
          // Blocks every connection to a non-loopback host: unit tests can never reach a real gateway.
          setupFiles: ['./test/no-network.ts'],
          exclude: ['**/*.gateway.test.ts', '**/node_modules/**'],
          environment: 'node',
        },
      },
      {
        // Smoke tests against the real FSE gateway (PRE environment only). They are skipped unless
        // FSE_GATEWAY_ENV and the credential variables are set: see CONTRIBUTING.md.
        extends: true,
        test: {
          name: 'gateway',
          include: ['packages/*/test/**/*.gateway.test.ts'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 60_000,
        },
      },
    ],
  },
});
