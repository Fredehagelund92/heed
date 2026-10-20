import { expect, test, type BrowserContext } from '@playwright/test'

/*
  The session on the real service: the user menu reads the roles /api/v1/auth/session returns,
  a visit without a session lands on the sign-in page, whose picker lists the dev people with
  the roles the service holds for them, and Sign out goes through the browser with the session's
  CSRF token and the page's origin, as every change will.
*/

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

test('an owner reads their role and areas in the user menu', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, 'per_jon@example.test')
  await page.goto('/library')
  await expect(page.locator('#library-count')).toHaveText(/facts$/, { timeout: 15_000 })
  await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales and Sandbox')
  await page
    .locator('[data-slot="sidebar"]')
    .getByRole('button', { name: /Jon Abara/ })
    .click()
  await expect(page.getByRole('menu')).toContainText('Owner of Sales and Sandbox')
})

test('a contributor is a contributor', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, 'per_maria@example.test')
  await page.goto('/')
  await expect(page.getByTestId('user-role')).toHaveText('Contributor', { timeout: 15_000 })
})

test('a visit without a session goes to the sign-in page, which signs in', async ({ page }) => {
  await page.goto('/library')
  await expect(page).toHaveURL(/\/signed-out\?from=%2Flibrary/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible()
  await expect(page.locator('#library-count')).toHaveCount(0)
  await page.getByRole('combobox', { name: 'Sign in as' }).click()
  const jon = page.getByRole('group', { name: 'Owners' }).getByRole('option', { name: /Jon Abara/ })
  await expect(jon).toContainText('Sales')
  await jon.click()
  await page.getByRole('button', { name: 'Continue as Jon Abara' }).click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales and Sandbox')
})

test('Sign out ends the session on the service', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, 'per_sofia@example.test')
  await page.goto('/library')
  await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales', {
    timeout: 15_000,
  })
  const signOut = page.waitForRequest((request) => request.url().endsWith('/api/v1/auth/sign-out'))
  await page.locator('[data-slot="sidebar"]').getByRole('button', { name: /Sofia/ }).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  const request = await signOut
  expect(request.headers()['x-heed-csrf']).toMatch(/^[a-f0-9]{64}$/)
  expect((await request.response())?.status()).toBe(200)
  await expect(page).toHaveURL(/\/signed-out/)
  expect((await context.request.get('/api/v1/me')).status()).toBe(401)
  // Signing in again on the page goes back.
  await page.getByRole('combobox', { name: 'Sign in as' }).click()
  await page.getByRole('option', { name: /Sofia/ }).click()
  await page.getByRole('button', { name: 'Continue as Sofia Brandt' }).click()
  await expect(page).toHaveURL(/\/library$/)
  await expect(page.getByTestId('user-role')).toHaveText('Owner of Sales')
})
