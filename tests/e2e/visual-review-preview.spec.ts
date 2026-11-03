import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of the review's Preview (design contract 9, Screenshots), at 1440 and 390
// wide, light and dark: an edit and a new item, each drawn as its context item's page draws it.
// Each platform keeps its own baselines, as visual-inbox-pane.spec.ts says; where a platform has
// none yet the check skips, and `--update-snapshots` on that platform writes them.

const reviews = ['sug-ines', 'gap-spain']
const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const id of reviews)
        test(id, async ({ page }, info) => {
          const shot = `${id}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot)) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot} for ${process.platform} yet: write one with --update-snapshots`,
          )
          await page.goto(`/inbox/${id}/review?view=preview&theme=${theme}`)
          const preview = page.getByRole('region', { name: 'Preview' })
          await expect(preview.getByRole('heading', { level: 3 })).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          await expect(preview).toHaveScreenshot(shot, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
          })
        })
    })
