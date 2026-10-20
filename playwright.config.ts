import { defineConfig, devices } from '@playwright/test'

// PW_PORT lets two checkouts run their browser tests side by side.
const port = Number(process.env.PW_PORT ?? 4173)
const storybookPort = Number(process.env.PW_STORYBOOK_PORT ?? 4183)
const ci = Boolean(process.env.CI)

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  // One baseline per screenshot, no platform in the name: baselines are Linux baselines made by the
  // update-snapshots workflow on the same runner image as CI.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002 },
  },
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'on-first-retry',
    reducedMotion: 'reduce',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 } }],
  webServer: [
    {
      command: `npm run build:e2e && npm run preview:e2e -- --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !ci,
      timeout: 120_000,
    },
    {
      // The static Storybook for tests/e2e/stories.spec.ts.
      command: `npm run build-storybook -- --quiet && npx vite preview --config .storybook/vite.config.ts --outDir storybook-static --strictPort --port ${storybookPort}`,
      url: `http://localhost:${storybookPort}/index.json`,
      reuseExistingServer: !ci,
      timeout: 240_000,
    },
  ],
})
