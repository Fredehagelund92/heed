import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of the Inbox pane (design contract 9, Screenshots), at 1440 and 390 wide,
// light and dark: a suggestion, a conflict, a Not found draft and a card with no answers to
// compare. Fonts render a little differently on each system, so each platform keeps its own
// baselines (Playwright's default path ends in the platform's name). Where a platform has none
// yet the check says so and skips; `npx playwright test tests/e2e/visual-inbox-pane.spec.ts
// --update-snapshots` on that platform writes them, for review by eye in a pull request.

const cards = ['sug-ines', 'sug-sofia-clash', 'gap-spain', 'check-returns']
const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const id of cards)
        test(id, async ({ page }, info) => {
          const shot = `${id}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot)) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot} for ${process.platform} yet: write one with --update-snapshots`,
          )
          await page.goto(`/inbox?card=${id}&theme=${theme}`)
          const pane = page
            .getByRole('region', { name: /./ })
            .filter({ has: page.getByRole('button', { name: 'Previous' }) })
          await expect(pane.getByRole('heading', { level: 2 }).last()).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          await expect(pane).toHaveScreenshot(shot, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
          })
        })
    })
