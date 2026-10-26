import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// J20, synonyms as tags: a comma or Enter makes a tag at once, a word that means something else
// says who has it and is never saved, Backspace selects then removes, Escape keeps what was made.
// The list folds synonyms into their definition's row; a term's editor has one optional
// Another name for, and clearing it brings the meaning back.

test('typing words and commas makes tags; a taken word says who has it', async ({ page }) => {
  await go(page, '/definitions/Gross%20sales')
  const box = page.getByRole('textbox', { name: 'Add another name for Gross sales' })
  await box.fill('Sales Value,')
  const tags = page
    .getByRole('region', { name: 'Also called' })
    .or(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Also called' }) }))
  await expect(tags.getByText('Sales Value', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Added synonym Sales Value.' }),
  ).toBeAttached()
  await box.fill('Gross takings, turnover,')
  await expect(tags.getByText('Gross takings', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({
      hasText: '“turnover” is already another name for Net revenue, added by Sofia Brandt.',
    }),
  ).toBeVisible()
  // Backspace in the empty box selects the last tag, then removes it.
  await box.press('Backspace')
  await expect(
    page.getByRole('status').filter({ hasText: 'Gross takings selected.' }),
  ).toBeAttached()
  await box.press('Backspace')
  await expect(tags.getByText('Gross takings', { exact: true })).toHaveCount(0)
  // Escape lets go of what is half typed; the tags stay.
  await box.fill('half')
  await box.press('Escape')
  await expect(box).toHaveValue('')
  await expect(tags.getByText('Sales Value', { exact: true })).toBeVisible()
})

test('the list folds synonyms into their row; Terms counts only real terms', async ({ page }) => {
  await go(page, '/definitions')
  const gross = page.locator('tr').filter({ hasText: /^Gross sales/ })
  await expect(gross).toContainText('Also called')
  await expect(gross).toContainText('GMV')
  await expect(page.locator('tr').filter({ hasText: /^GMV/ })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /Terms/ })).toContainText('5')
  await page.getByPlaceholder('Search definitions').fill('turnover')
  await expect(page.locator('tr').filter({ hasText: 'Net revenue' })).toContainText(
    'matches: Turnover',
  )
  await page.getByPlaceholder('Search definitions').fill('')
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /Show synonyms as rows/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('tr').filter({ hasText: /^GMV/ })).toHaveCount(1)
})

test("a term's editor: Another name for folds the meaning; clearing it brings it back, with Undo", async ({
  page,
}) => {
  await go(page, '/definitions/Webshop/edit')
  await expect(page.getByRole('textbox', { name: 'What it means' })).toContainText(
    'Orders placed on larchwood.example',
  )
  await page.getByRole('button', { name: /^Another name for/ }).click()
  await page.getByRole('option', { name: 'Gross sales' }).click()
  await expect(page.getByText('Uses the meaning of')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'What it means' })).toHaveCount(0)
  await page.getByRole('button', { name: /^Another name for/ }).click()
  await page.getByRole('option', { name: 'Not another name: give it its own meaning' }).click()
  await expect(page.getByRole('textbox', { name: 'What it means' })).toContainText(
    'Orders placed on larchwood.example',
  )
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Uses the meaning of')).toBeVisible()
})
