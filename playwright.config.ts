import { defineConfig } from '@playwright/test'

/*
  The golden journeys of the web app (src/web): the approved mockup's job specs (J1 to J30,
  apps/mockup/e2e), on a production build of the app with the mock binding, with axe on every
  place at 390 and 1440 in light and dark (axe.spec.ts). The motion journey runs twice: as most
  people see it, and with reduced motion, where nothing may move and every result must still
  arrive. PW_WEB_PORT lets two checkouts run them side by side.
*/

const port = Number(process.env.PW_WEB_PORT ?? 4174)
const ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results/e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report/e2e' }]]
    : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium' },
    { name: 'reduced-motion', testMatch: /j29-motion/, use: { reducedMotion: 'reduce' } },
  ],
  // A production build served as is: no module is compiled on first visit, so a journey never
  // waits on the dev server under parallel load.
  webServer: {
    command: `npm run build && npm run preview -- --port ${port}`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
})
