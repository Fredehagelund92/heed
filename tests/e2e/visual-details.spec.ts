import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of a context item's Details, open in the quick view (design contract 5.5),
// at 1440 and 390 wide, light and dark: an item with a quote and a link to an archived item, and a
// draft with neither. Each platform keeps its own baselines, as visual-inbox-pane.spec.ts says;
// where a platform has none yet the check skips, and `--update-snapshots` on that platform writes
// them.

const items = ['itm_0tmqp7o1', 'itm_draft_spain_returns']
const widths = [
  { name: '1440', viewport: { width: 1440, height: 900 } },
  { name: '390', viewport: { width: 390, height: 844 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const id of items)
        test(id, async ({ page }, info) => {
          const shot = `${id}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot)) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot} for ${process.platform} yet: write one with --update-snapshots`,
          )
          await page.goto(`/context?dock=context.${id}&theme=${theme}`)
          const dock = page.getByRole('region', { name: 'Context' })
          await dock.getByRole('button', { name: 'Details', exact: true }).click()
          await expect(
            dock.getByRole('group', { name: 'More about this context item' }),
          ).toBeVisible()
          await page.evaluate(() => document.fonts.ready)
          await expect(dock).toHaveScreenshot(shot, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
          })
        })
    })
