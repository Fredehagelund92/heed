import { defineConfig } from '@playwright/test'

/*
  The golden journeys in http mode (golden plan, section 8.2): the same job specs as
  playwright.app.config.ts, on a production build of the new app with VITE_API_MODE=http, whose
  preview server forwards /api/v1 to the Heed service on PostgreSQL 18. The global setup seeds the
  mockup's demo week into a template database (tests/e2e-app/http); each journey starts on its own
  copy with its own service, so they run one at a time. Only the journeys whose screens are wired
  run here; each later pull request adds its own. GOLDEN_DATABASE_URL names a superuser's
  connection (default: TEST_DATABASE_URL, then the local server).
*/

const webPort = Number(process.env.PW_GOLDEN_WEB_PORT ?? 4175)
const apiPort = Number(process.env.PW_GOLDEN_API_PORT ?? 3110)
const ci = Boolean(process.env.CI)

process.env.GOLDEN_MODE = 'http'
process.env.GOLDEN_API_PORT = String(apiPort)
process.env.GOLDEN_WEB_ORIGIN = `http://localhost:${webPort}`

export default defineConfig({
  testDir: 'tests/e2e-app',
  // The Inbox, its quick view, the review and the setup checklist (P6b).
  testMatch: /\/j(1|4|5|7|13|14|15|16|17|18|19|23)-[a-z0-9-]+\.spec\.ts$/,
  outputDir: 'test-results/golden-http/output',
  globalSetup: './tests/e2e-app/http/global-setup.ts',
  // The demo week's fixtures live with the app (src/app), under its path aliases.
  tsconfig: './tsconfig.app.json',
  fullyParallel: false,
  workers: 1,
  // Each journey copies the demo week and starts its service first, and every read is a real
  // request, so a journey takes longer than on the mock.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/golden-http' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${webPort}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command:
      `tsc -p tsconfig.app.json --noEmit && vite build -c vite.app.config.ts --outDir ../../dist/app-http --emptyOutDir && ` +
      `vite preview -c vite.app.config.ts --outDir ../../dist/app-http --port ${webPort}`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: !ci,
    timeout: 180_000,
    env: { VITE_API_MODE: 'http', HEED_API_URL: `http://127.0.0.1:${apiPort}` },
  },
})
