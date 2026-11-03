import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of Observability's Overview (design contract 9, Screenshots), at 1440 and
// 390 wide, light and dark: the numbers and the chart as it opens, narrowed to Not found, the
// topics as Questions' old address opens them, filtered by chips with the facets beside them, and
// with days selected on the chart. Fonts render a little differently on each system,
// so each platform keeps its own baselines (Playwright's default path ends in the platform's
// name). Where a platform has none yet the check says so and skips; `npx playwright test
// tests/e2e/visual-overview.spec.ts --update-snapshots` on that platform writes them, for review
// by eye in a pull request.

const places = [
  { name: 'overview', address: '/observability' },
  { name: 'not-found', address: '/observability?answer=missing' },
  { name: 'topics', address: '/observability/questions' },
  // The filter bar: a chip that leaves a value out, chips in an order of their own, the facets.
  { name: 'filtered', address: '/observability?market=Norway&answer=!missing&chips=market,answer' },
  // Days selected on the chart: the numbers add them up, and the bar reads them as a chip.
  { name: 'days', address: '/observability?range=30&days=2026-10-12..2026-10-18' },
]
const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const { name, address } of places)
        test(name, async ({ page }, info) => {
          const shot = `${name}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot)) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot} for ${process.platform} yet: write one with --update-snapshots`,
          )
          await page.goto(`${address}${address.includes('?') ? '&' : '?'}theme=${theme}`)
          await expect(page.getByRole('heading', { name: 'Topics' })).toBeAttached()
          await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'))
          await page.evaluate(() => document.fonts.ready)
          await expect(page).toHaveScreenshot(shot, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
          })
        })
    })
