import { expect, go, test } from './go.ts'

// J19, the Source view: a labelled toggle named "View source"; removed lines before added ones,
// and inside them only the changed words marked.

test('Source shows removals first, with only the changed words marked', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  const toggle = page.getByRole('button', { name: 'View source' })
  await expect(toggle).toHaveText('Source')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const removed = page.locator('pre del')
  const added = page.locator('pre ins')
  await expect(removed.first()).toHaveText('312')
  await expect(added.first()).toHaveText('340')
  const lines = page.locator('pre > div')
  const signs = await lines
    .locator('span[aria-label]')
    .evaluateAll((els: { getAttribute(n: string): string | null }[]) =>
      els.map((e) => e.getAttribute('aria-label')),
    )
  expect(signs.indexOf('removed')).toBeLessThan(signs.indexOf('added'))
})
