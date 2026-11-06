import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig } from '@playwright/test'

/*
  The web app on an install with nothing in it: the service on a database that `npm run db:migrate`
  prepared with SEED_DEMO=off, its own secret store, no Cube model, and an http mode build of the
  app whose preview server forwards /api/v1 to it. The database must already be prepared and
  empty; E2E_DATABASE_URL names it as the service's role and E2E_DATABASE_SERVE_URL the MCP
  gateway's serving connection. Its ports are its own (3121 and 4178 unless PW_OWN_API_PORT and
  PW_OWN_WEB_PORT say otherwise).
*/

const ci = Boolean(process.env.CI)
const webPort = Number(process.env.PW_OWN_WEB_PORT ?? 4178)
const apiPort = Number(process.env.PW_OWN_API_PORT ?? 3121)
const apiUrl = `http://127.0.0.1:${apiPort}`

export default defineConfig({
  testDir: 'tests/e2e-own',
  outputDir: 'test-results/e2e-own',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/e2e-own' }]]
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
        HEED_WEB_ORIGINS: `http://localhost:${webPort}`,
        MCP_RESOURCE_URL: `http://localhost:${apiPort}/mcp`,
        HEED_DEV_PEOPLE_FILE: 'db/seed/people.local.yml',
        HEED_SECRETS_DIR: join(mkdtempSync(join(tmpdir(), 'heed-own-data-')), 'secrets'),
      },
    },
    {
      command:
        `vite build --outDir ../../dist/web-own --emptyOutDir && ` +
        `vite preview --outDir ../../dist/web-own --port ${webPort}`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: !ci,
      timeout: 180_000,
      env: { VITE_API_MODE: 'http', HEED_API_URL: apiUrl },
    },
  ],
})
