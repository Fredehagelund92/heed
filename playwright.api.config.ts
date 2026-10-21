import { defineConfig, devices } from '@playwright/test'

/*
  The front end on the real API: a production build in http mode (VITE_API_MODE=http) whose
  preview server forwards /api/v1 to the Heed service, which reads PostgreSQL. The database must
  already be migrated and hold the bulk demo seed (docs/development.md, "Run the front end on the service").
  E2E_DATABASE_URL names it; the default is the local development database. E2E_DATABASE_SERVE_URL
  names the MCP gateway's serving connection when a `role=` option is used to pick the roles.
*/

const ci = Boolean(process.env.CI)
const webPort = Number(process.env.PW_API_WEB_PORT ?? 4174)
const apiPort = Number(process.env.PW_API_PORT ?? 3100)
const apiUrl = `http://127.0.0.1:${apiPort}`

export default defineConfig({
  testDir: 'tests/e2e-api',
  outputDir: 'test-results/e2e-api',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/e2e-api' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    trace: 'on-first-retry',
    reducedMotion: 'reduce',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /(editions|review|live|owner)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    // The live test reads the announcement of Maria's newest notification, which a parallel test
    // acting on her proposals would replace, so it runs once those have finished.
    {
      name: 'live',
      testMatch: /live\.spec\.ts/,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    // Release tests change what agents are served (going back to an edition), and with it the
    // library the other tests count, so they run once the rest has finished.
    {
      name: 'release',
      testMatch: /editions\.spec\.ts/,
      dependencies: ['live'],
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    // Accepting a proposal publishes an edition too, and these tests read the live edition, so
    // they run after the release tests rather than beside them.
    {
      name: 'review',
      testMatch: /\/review\.spec\.ts$/,
      dependencies: ['release'],
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    // A decision shown before the service answers: it accepts and publishes too, so it follows
    // the review tests rather than running beside them.
    {
      name: 'optimistic',
      testMatch: /optimistic-review\.spec\.ts/,
      dependencies: ['review'],
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
    // The owner's story fixes the demo's regression for good: it publishes an edition, resolves
    // a gap other tests read open and runs Sales, so it runs last.
    {
      name: 'owner',
      testMatch: /owner\.spec\.ts/,
      dependencies: ['optimistic'],
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    {
      command: 'node src/server/main.ts',
      url: `${apiUrl}/health/ready`,
      reuseExistingServer: !ci,
      timeout: 30_000,
      env: {
        NODE_ENV: 'test',
        PORT: String(apiPort),
        LOG_LEVEL: 'warn',
        DATABASE_URL:
          process.env.E2E_DATABASE_URL ??
          'postgres://context_layer_api@localhost:5432/context_layer_dev',
        // The MCP gateway's serving role. Left out, the service derives it from DATABASE_URL by
        // swapping the user, which keeps a `role=` option the serving role may not take.
        ...(process.env.E2E_DATABASE_SERVE_URL
          ? { DATABASE_URL_SERVE: process.env.E2E_DATABASE_SERVE_URL }
          : {}),
        CL_WEB_ORIGINS: `http://localhost:${webPort}`,
        // The login server for agents lives at the MCP address's origin, this service.
        MCP_RESOURCE_URL: `http://localhost:${apiPort}/mcp`,
        CL_OAUTH_DYNAMIC_REGISTRATION: 'on',
        CL_FIXED_TODAY: '2026-10-07',
        // The demo identities and an administrator for each parallel spec that needs one.
        CL_DEV_PEOPLE_FILE: 'tests/e2e-api/people.yml',
        // web-sources.spec.ts serves the page the assistant reads on this machine.
        CL_WEB_READ_LOOPBACK: 'on',
      },
    },
    {
      command:
        'vite build --mode e2e --outDir ../../dist/e2e-api --emptyOutDir && ' +
        `vite preview --outDir ../../dist/e2e-api --port ${webPort}`,
      url: `http://localhost:${webPort}`,
      reuseExistingServer: !ci,
      timeout: 120_000,
      env: { VITE_API_MODE: 'http', HEED_API_URL: apiUrl },
    },
  ],
})
