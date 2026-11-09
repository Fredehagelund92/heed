import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of Ask's loop answers in every state direction C draws (FR-349, FR-718 to
// FR-720), at 1440 and 390 wide, light and dark: each the service's own turn on the demo week
// (src/web/api/mock/data/loop-examples.json), opened by its example address. Each platform keeps
// its own baselines, as visual-inbox-pane.spec.ts says; where a platform has none yet the check
// skips, and `npx playwright test tests/e2e/visual-ask-loop.spec.ts --update-snapshots` writes them.

const answers = [
  'loop-checked',
  'loop-missing',
  'loop-conflict',
  'loop-stale',
  'loop-list',
  'loop-long',
  'loop-question',
  'loop-overview',
  'loop-overview-due',
  'loop-overview-domain',
]
const widths = [
  { name: '1440', viewport: { width: 1440, height: 1200 } },
  { name: '390', viewport: { width: 390, height: 1800 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const id of answers)
        test(id, async ({ page }, info) => {
          const shot = `${id}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot)) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot} for ${process.platform} yet: write one with --update-snapshots`,
          )
          await page.goto(`/ask?example=${id}&theme=${theme}`)
          const turn = page.locator('[data-turn]').first()
          // The example and its answer's own code load with the first loop answer.
          await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible({
            timeout: 20_000,
          })
          // The question with how it was read, and the answer, without the composer.
          await page.evaluate(() => document.fonts.ready)
          await expect(turn).toHaveScreenshot(shot, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
          })
        })
    })
