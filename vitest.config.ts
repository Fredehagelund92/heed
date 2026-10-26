import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/unit/setup.ts'],
          env: { VITE_MOCK_LATENCY_MS: '0' },
        },
      },
      {
        // The new web app's own units (src/app), moved with its code from the mockup.
        extends: true,
        test: {
          name: 'app',
          environment: 'node',
          include: ['tests/app/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'tests/app/integration/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'lint-rules',
          environment: 'node',
          include: ['tests/lint/**/*.test.ts'],
          testTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/server/**/*.test.ts'],
        },
      },
      {
        // Needs PostgreSQL 18, so `npm test` leaves it out: run `npm run test:integration`.
        extends: true,
        test: {
          name: 'integration',
          globalSetup: ['tests/integration/global-setup.ts'],
          hookTimeout: 30_000,
          testTimeout: 30_000,
          environment: 'node',
          include: ['tests/integration/**/*.test.ts', 'tests/app/integration/**/*.test.ts'],
          env: {
            TEST_DATABASE_URL:
              process.env.TEST_DATABASE_URL ?? 'postgres://localhost:5432/postgres',
          },
        },
      },
    ],
  },
})
