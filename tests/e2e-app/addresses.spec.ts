import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// The app's addresses are paths (/inbox), one to one with the mockup's #/ addresses, each with its
// search params checked. An old #/ link and the mockup's renamed places still land where they live
// now, and a link inside the app moves without loading the page again.

test('an old #/ link lands on its path, with its query', async ({ page }) => {
  await page.goto('/#/inbox?demo=week&card=check-returns')
  await expect(page).toHaveURL(/\/inbox\?demo=week&card=check-returns$/)
  await expect(page.locator('[data-row="check-returns"]')).toBeVisible()
})

test('a renamed place and an old peek land where they live now', async ({ page }) => {
  await go(page, '/library?dock=fact.itm_ra39ow6c')
  await expect(page).toHaveURL(/\/context\?dock=context\.itm_ra39ow6c$/)
  await expect(page.getByRole('region', { name: /Context/ }).last()).toBeVisible()
})

test('the app opens on the Inbox, and an unknown address shows it too', async ({ page }) => {
  await go(page, '/')
  await expect(page).toHaveURL(/\/inbox$/)
  await go(page, '/nowhere')
  await expect(
    page.locator('[data-sidebar=sidebar]').first().getByRole('link', { name: /Inbox/ }),
  ).toBeVisible()
})

test('a link inside the app moves without loading the page again', async ({ page }) => {
  await go(page, '/inbox')
  await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true))
  await page
    .locator('[data-sidebar=sidebar]')
    .first()
    .getByRole('link', { name: 'Context' })
    .click()
  await expect(page).toHaveURL(/\/context$/)
  await expect(page.locator('tbody tr').first()).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true)
  await page.goBack()
  await expect(page).toHaveURL(/\/inbox$/)
})
