import { expect, test } from '@playwright/test'
import { go, signOut, userMenu } from './go.ts'

// The app's addresses are paths (/inbox), one to one with the old #/ addresses, each with its
// search params checked. An old #/ link and a renamed place still land where they live
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

test('the app opens on the Inbox for someone with something to decide, and an unknown address says it is not found', async ({
  page,
}) => {
  await go(page, '/')
  await expect(page).toHaveURL(/\/inbox$/)
  await go(page, '/nowhere')
  await expect(page).toHaveURL(/\/nowhere$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found')
})

test('someone with nothing to decide opens on Ask, with the Inbox in the sidebar', async ({
  page,
}) => {
  // Ravi owns no domain, and nothing waits on Ravi.
  await go(page, '/inbox')
  await signOut(page)
  await page.getByRole('button', { name: /Ravi Kapoor/ }).click()
  await expect(page).toHaveURL(/\/ask$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Ask' })).toBeVisible()
  await expect(userMenu(page)).toContainText('Ravi Kapoor')
  const sidebar = page.locator('[data-sidebar=sidebar]').first()
  await expect(sidebar.getByRole('link', { name: 'Inbox', exact: true })).toBeVisible()
  // Opened again, the app opens on Ask; /signin opened again leads there too.
  await go(page, '/')
  await expect(page).toHaveURL(/\/ask$/)
  await go(page, '/signin')
  await expect(page).toHaveURL(/\/ask$/)
  // The Inbox is a click away, and Back from it returns to Ask, not to the app's opening.
  await sidebar.getByRole('link', { name: 'Inbox', exact: true }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page.getByText('Nothing needs you')).toBeVisible()
  await page.goBack()
  await expect(page).toHaveURL(/\/ask$/)
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
