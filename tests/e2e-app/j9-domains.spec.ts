import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// J9, domains: each is a document of its own; a new one is added from the grid and, while empty,
// can be deleted; one with context can't; its words reach the context editor's domain list.

test('a domain opens as its own page', async ({ page }) => {
  await go(page, '/settings/domains')
  await page
    .getByRole('list', { name: 'Domains' })
    .getByRole('listitem')
    .filter({ hasText: 'Sales' })
    .click()
  await expect(page).toHaveURL(/\/settings\/domains\/sales/)
  await expect(page.getByRole('textbox', { name: 'Name' })).toHaveValue('Sales')
  await expect(page.getByRole('link', { name: /items/ })).toBeVisible()
})

test('a new domain is added, and while empty it can be deleted', async ({ page }) => {
  await go(page, '/settings/domains')
  await page
    .getByRole('list', { name: 'Domains' })
    .getByRole('listitem')
    .filter({ hasText: 'Add a domain' })
    .click()
  await page.getByRole('textbox', { name: 'Name' }).fill('Finance')
  await page.getByRole('button', { name: 'Add the domain' }).click()
  await expect(page).toHaveURL(/\/settings\/domains\/finance/)
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: /Delete the domain/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page).toHaveURL(/\/settings\/domains$/)
  await expect(
    page
      .getByRole('list', { name: 'Domains' })
      .getByRole('listitem')
      .filter({ hasText: 'Finance' }),
  ).toHaveCount(0)
})

test("a domain with context can't be deleted", async ({ page }) => {
  await go(page, '/settings/domains/sales')
  await page.getByRole('button', { name: 'More' }).click()
  await expect(page.getByRole('menuitem', { name: /Delete the domain/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
})

test("the domain's words reach the context editor's domain list", async ({ page }) => {
  await go(page, '/context/new')
  await page.getByRole('button', { name: /^Domain/ }).click()
  await expect(page.getByRole('option', { name: /Orders, revenue and the basket/ })).toBeVisible()
})
