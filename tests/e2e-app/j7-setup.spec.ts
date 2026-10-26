import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// J7: a new workspace reaches its first grounded answer: write first, connect later, about ten actions.
test('a new workspace gets its first grounded answer', async ({ page }) => {
  await go(page, '/inbox?demo=setup')
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  const about = page.getByRole('textbox', { name: 'About our business' })
  await about.click()
  // Typed as one input, as a paste would be: key by key, a loaded machine ran past the time limit.
  await page.keyboard.insertText('We are an outdoor-gear retailer with a webshop and stores.')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Write context', exact: true }).click()
  await page
    .getByRole('textbox', { name: 'Title' })
    .fill('Orders in Norway fell after the customs stop')
  const text = page.getByRole('textbox', { name: 'What agents should know' })
  await text.click()
  await page.keyboard.insertText(
    'Orders in Norway fell to almost nothing after a customs rule stopped online sales on 4 August 2026.',
  )
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://customs.example/norway')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.press('End')
  await box.press('Enter')
  await expect(page.getByRole('log').getByText('Checked', { exact: true })).toBeVisible()
})
