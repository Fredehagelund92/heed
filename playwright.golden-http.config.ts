import { defineConfig } from '@playwright/test'

/*
  The golden journeys in http mode (golden plan, section 8.2): the same job specs as
  playwright.config.ts, on a production build of the web app with VITE_API_MODE=http, whose
  preview server forwards /api/v1 to the Heed service on PostgreSQL 18. The global setup seeds the
  mockup's demo week into a template database (tests/e2e/http); each journey starts on its own
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
  testDir: 'tests/e2e',
  // The Inbox, its quick view, the review and the setup checklist (P6b); Context, Definitions, the
  // editor and Related (P7c); Ask (P10); Help and the docs (P13); People, invites and owners (P8);
  // Observability (P12); comments, reactions and mentions (P9b); domains and connecting an agent
  // (P11a); a read's suggestions (P11b); figures in Ask (P11a, part 2); the Applies to picker's
  // dimension values (J31); sorting both ways (J32); Observability's Summary; and an agent's consent page, which the
  // mockup leaves out (golden plan 2.3); and how many calls a page load makes.
  testMatch:
    /\/(j(1|2|3|4|5|6|7|9|10|11|12|13|14|15|16|17|18|19|20|21|22|23|24|25|26|27|28|30|31|32)-[a-z0-9-]+|consent|calls)\.spec\.ts$/,
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
