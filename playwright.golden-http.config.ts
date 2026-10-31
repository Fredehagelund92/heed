import { defineConfig } from '@playwright/test'

/*
  The golden journeys in http mode (golden plan, section 8.2): the same job specs as
  playwright.config.ts, on a production build of the web app with VITE_API_MODE=http, whose
  preview server forwards /api/v1 to the Heed service on PostgreSQL 18. The global setup seeds the
  mockup's demo week into a template database (tests/e2e/http); each journey starts on its own
  copy with its own service, so they run one at a time. Only the journeys whose screens are wired
  run here (testIgnore lists the rest). GOLDEN_DATABASE_URL names a superuser's
  connection (default: TEST_DATABASE_URL, then the local server).
*/

const webPort = Number(process.env.PW_GOLDEN_WEB_PORT ?? 4175)
const apiPort = Number(process.env.PW_GOLDEN_API_PORT ?? 3110)
const ci = Boolean(process.env.CI)

process.env.GOLDEN_MODE = 'http'
process.env.GOLDEN_API_PORT = String(apiPort)
process.env.GOLDEN_WEB_ORIGIN = `http://localhost:${webPort}`

export default defineConfig({
  testDir: 'tests/e2e',
  // Every spec in tests/e2e runs here unless it is listed below as one that needs the mock
  // binding. A new journey runs in http mode by default; one whose screen is not wired yet adds a
  // line here with its reason. One spec per line, so two pull requests that each add one merge
  // cleanly.
  testIgnore: [
    // Addresses, axe and the docs controls check the mock build's pages (playwright.config.ts).
    /\/addresses\.spec\.ts$/,
    /\/axe\.spec\.ts$/,
    /\/docs-controls\.spec\.ts$/,
    // J8 asks the mock for a loading, failed or offline state (?state=), which the service has not.
    /\/j8-states\.spec\.ts$/,
    // J29 times saves the mock delays on purpose (docs/design/motion.md).
    /\/j29-motion\.spec\.ts$/,
  ],
  outputDir: 'test-results/golden-http/output',
  globalSetup: './tests/e2e/http/global-setup.ts',
  // The demo week's fixtures live with the app (src/web), under its path aliases.
  tsconfig: './tsconfig.web.json',
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
      `tsc -p tsconfig.web.json --noEmit && vite build --outDir ../../dist/web-http --emptyOutDir && ` +
      `vite preview --outDir ../../dist/web-http --port ${webPort}`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: !ci,
    timeout: 180_000,
    env: { VITE_API_MODE: 'http', HEED_API_URL: `http://127.0.0.1:${apiPort}` },
  },
})
