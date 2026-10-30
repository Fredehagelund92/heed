import { defineConfig } from '@playwright/test'

/*
  The web app on what `docker compose up` gives a new install: the service on a database that
  `npm run db:migrate` prepared with SEED_DEMO=on (the demo's 1,500 items, its people, quality
  history and gaps, beside the demo Cube model in db/seed/cube), and an http mode build of the app
  whose preview server forwards /api/v1 to it. The database must already be prepared;
  E2E_DATABASE_URL names it as the service's role (default: the local development database), and
  E2E_DATABASE_SERVE_URL the MCP gateway's serving connection when a `role=` option picks the
  roles. Its ports are its own (3120 and 4177 unless PW_SEED_API_PORT and PW_SEED_WEB_PORT say
  otherwise).
*/

const ci = Boolean(process.env.CI)
const webPort = Number(process.env.PW_SEED_WEB_PORT ?? 4177)
const apiPort = Number(process.env.PW_SEED_API_PORT ?? 3120)
const apiUrl = `http://127.0.0.1:${apiPort}`

export default defineConfig({
  testDir: 'tests/e2e-seed',
  outputDir: 'test-results/e2e-seed',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/e2e-seed' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: [
    {
      command: 'node src/server/main.ts',
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: !ci,
      timeout: 60_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(apiPort),
        LOG_LEVEL: 'warn',
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          'postgres://context_layer_api@localhost:5432/context_layer_dev',
        ...(process.env.E2E_DATABASE_SERVE_URL
          ? { DATABASE_URL_SERVE: process.env.E2E_DATABASE_SERVE_URL }
          : {}),
        CL_WEB_ORIGINS: `http://localhost:${webPort}`,
        MCP_RESOURCE_URL: `http://localhost:${apiPort}/mcp`,
        // As compose.yaml runs it: the demo Cube model, and the demo people's sign-in.
        CUBE_MODEL_DIR: 'db/seed/cube',
        CL_DEV_PEOPLE_FILE: 'db/seed/people.local.yml',
      },
    },
    {
      command:
        `vite build --outDir ../../dist/web-seed --emptyOutDir && ` +
        `vite preview --outDir ../../dist/web-seed --port ${webPort}`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: !ci,
      timeout: 180_000,
      env: { VITE_API_MODE: 'http', HEED_API_URL: apiUrl },
    },
  ],
})
