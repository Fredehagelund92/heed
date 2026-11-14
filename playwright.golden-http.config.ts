import { defineConfig } from '@playwright/test'

/*
  The golden journeys in http mode (golden plan, section 8.2): the same job specs as
  playwright.config.ts, on a production build of the web app with VITE_API_MODE=http, whose
  preview server forwards /api/v1 to the Heed service on PostgreSQL 18. The global setup seeds the
  demo week into a template database (tests/e2e/http); each journey starts on its own
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
    // Buttons and fields are measured on the mock build's pages too.
    /\/buttons-fields\.spec\.ts$/,
    // The pane's screenshot baselines are of the mock's demo data.
    /\/visual-inbox-pane\.spec\.ts$/,
    // The definition answers' baselines are of the mock's demo data too.
    /\/visual-ask-definition\.spec\.ts$/,
    // So are Overview's.
    /\/visual-overview\.spec\.ts$/,
    // And Details' and the review Preview's.
    /\/visual-details\.spec\.ts$/,
    /\/visual-review-preview\.spec\.ts$/,
    // The loop answers' baselines are the mock's examples, opened by their address.
    /\/visual-ask-loop\.spec\.ts$/,
    /\/docs-controls\.spec\.ts$/,
    // J8 asks the mock for a loading, failed or offline state (?state=), which the service has not.
    /\/j8-states\.spec\.ts$/,
    // J29 times saves the mock delays on purpose (docs/design/motion.md).
    /\/j29-motion\.spec\.ts$/,
    // J46 reads the names the mock makes; the service's are the own-data journey (tests/e2e-own).
    /\/j46-names\.spec\.ts$/,
    // J47 holds and fails the item's read by the mock's ?state=, which the service has not.
    /\/j47-peek-check\.spec\.ts$/,
    // J48 asks the mock for a model of hundreds of views (?views=); the service's Cube is the
    // server's own there, whose views are its file's (tests/integration/cube-view-list.test.ts).
    /\/j48-view-allowlist\.spec\.ts$/,
    // J3 states asks the mock for each of the six answer states by its example question; the
    // service's demo week has no check that fails to run.
    /\/j3-ask-states\.spec\.ts$/,
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
      `vite build --outDir ../../dist/web-http --emptyOutDir && ` +
      `vite preview --outDir ../../dist/web-http --port ${webPort}`,
    url: `http://localhost:${webPort}`,
    reuseExistingServer: !ci,
    timeout: 180_000,
    env: { VITE_API_MODE: 'http', HEED_API_URL: `http://127.0.0.1:${apiPort}` },
  },
})
