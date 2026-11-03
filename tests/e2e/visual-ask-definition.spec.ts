import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// Screenshot baselines of an Ask answer that leads with its definition (design contract 5.8), at
// 1440 and 390 wide, light and dark: the definition as the whole answer under its Definition mark,
// and the definition before a Checked answer's context. Each platform keeps its own baselines, as
// visual-inbox-pane.spec.ts says; where a platform has none yet the check skips, and
// `npx playwright test tests/e2e/visual-ask-definition.spec.ts --update-snapshots` writes them.

const answers = [
  { id: 'definition-only', question: 'What does churn rate mean?' },
  { id: 'definition-then-context', question: 'What is Orders?' },
]
// Tall enough that the whole answer sits above the composer, which stays at the foot.
const widths = [
  { name: '1440', viewport: { width: 1440, height: 1200 } },
  { name: '390', viewport: { width: 390, height: 1800 } },
] as const

for (const { name: width, viewport } of widths)
  for (const theme of ['light', 'dark'] as const)
    test.describe(`${width}, ${theme}`, () => {
      test.use({ viewport, colorScheme: theme })
      for (const { id, question } of answers)
        test(id, async ({ page }, info) => {
          const shot = `${id}-${width}-${theme}.png`
          const update = info.config.updateSnapshots
          test.skip(
            !existsSync(info.snapshotPath(shot)) && update !== 'all' && update !== 'changed',
            `No baseline of ${shot} for ${process.platform} yet: write one with --update-snapshots`,
          )
          await page.goto(`/ask?n=visual-${id}&theme=${theme}`)
          const box = page.getByRole('textbox', { name: 'Ask a question' })
          await box.click()
          await box.pressSequentially(question)
          await box.press('Enter')
          const turn = page.locator('[data-turn]').first()
          await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible()
          await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
          // The definition and what follows it, without the question's time or the composer.
          await box.blur()
          await page.evaluate(() => document.fonts.ready)
          await expect(turn.locator('.group\\/msg')).toHaveScreenshot(shot, {
            animations: 'disabled',
            caret: 'hide',
            maxDiffPixelRatio: 0.01,
          })
        })
    })
