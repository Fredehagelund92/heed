import { expect, go, test } from './go.ts'

// J19, the Source review: the source is the review. A Fields table says which fields change, with
// their value now and suggested, and folds the rest; the Text diff shows the stored text line by
// line with its numbers, removed lines before added ones, and only the changed words marked. N
// and P step through the changes. Preview is a quiet toggle for the rich text, and no view hides
// what must be decided: the clash gate and the claim check stay in both.

test('the source is the review: changed fields, then the text, with only the changed words marked', async ({
  page,
}) => {
  await go(page, '/inbox/sug-ines/review')
  const source = page.getByRole('region', { name: 'The source' })
  await expect(source).toBeVisible()
  await expect(page.getByRole('button', { name: 'Show the preview' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  // The Fields table: the source page changed, the other eight fold into one line that opens.
  const fields = source.getByRole('region', { name: 'Fields' })
  await expect(fields.getByRole('row', { name: 'Source, changed' })).toContainText('-october')
  const same = fields.getByRole('button', { name: /^8 the same: Title, Kind, Domain, Owner/ })
  await same.click()
  await expect(fields.getByRole('rowheader', { name: /Owner/ })).toBeVisible()
  await expect(
    fields.getByRole('button', { name: 'Hide the 8 that stay the same' }),
  ).toHaveAttribute('aria-expanded', 'true')

  // The Text diff: the number that changed, not the sentence, and the new link as its words.
  const text = source.getByRole('region', { name: 'Text' })
  await expect(text.locator('del').first()).toContainText('312')
  await expect(text.locator('ins').first()).toContainText('340')
  await expect(text.locator('ins').last()).toContainText('accounts')
  await expect(text.getByText('[@')).toHaveCount(0)
  const signs = await text
    .locator('[aria-label=added], [aria-label=removed]')
    .evaluateAll((els: { getAttribute(n: string): string | null }[]) =>
      els.map((e) => e.getAttribute('aria-label')),
    )
  expect(signs).toEqual(['removed', 'added'])

  // N steps to each change, field first, then the text.
  await page.keyboard.press('n')
  await expect(source.getByText('Change 1 of 2')).toBeVisible()
  await expect(fields.getByRole('row', { name: 'Source, changed' })).toBeFocused()
  await page.keyboard.press('n')
  await expect(text.getByRole('group', { name: 'Change 1 of 1 in the text' })).toBeFocused()
  await page.keyboard.press('p')
  await expect(source.getByText('Change 1 of 2')).toBeVisible()
})

test('Preview shows the rich text, and the clash gate stays in both views', async ({ page }) => {
  await go(page, '/inbox/sug-sofia-clash/review')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  const gate = page.getByRole('radiogroup', { name: /^How this relates to / })
  await expect(gate.first()).toBeVisible()
  const relations = await gate.count()
  expect(relations).toBeGreaterThan(0)
  await expect(decide.getByText('Not ready: choose how they relate.')).toBeVisible()

  const preview = page.getByRole('button', { name: 'Show the preview' })
  await preview.click()
  await expect(preview).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'The source' })).toHaveCount(0)
  await expect(gate).toHaveCount(relations)
  await preview.click()
  await expect(page.getByRole('region', { name: 'The source' })).toBeVisible()
  await expect(gate).toHaveCount(relations)
})

test('an agent’s claim check stays in both views', async ({ page }) => {
  await go(page, '/inbox/sug-agent/review')
  const claims = page.getByRole('table').filter({ hasText: 'In the copied sentence' })
  await expect(claims).toBeVisible()
  await page.getByRole('button', { name: 'Show the preview' }).click()
  await expect(claims).toBeVisible()
})
