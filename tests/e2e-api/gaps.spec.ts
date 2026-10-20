import { expect, test, type APIRequestContext } from '@playwright/test'

/*
  The Gaps page on the real service, for everyone Health is not for (Workbench plan, slice W8): a
  contributor keeps it in the sidebar, with its gaps and its topic counts. Reporting a gap from Try
  it is in try-it.spec.ts; an owner's and an administrator's gaps are in Health
  (health.spec.ts), where their old Gaps links land.
*/

async function signIn(request: APIRequestContext, origin: string, email: string) {
  const response = await request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

test('a contributor keeps the Gaps page, its list and its topic counts', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context.request, baseURL!, 'per_maria@example.test')
  await page.goto('/')
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
  await sidebar.getByRole('link', { name: 'Gaps' }).click({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/gaps$/)
  // The service's answer: a gap list, or the line that says there is none yet.
  await expect(
    page.locator('[role="table"][aria-label="Gaps"], [data-slot="empty"]').first(),
  ).toBeVisible({ timeout: 15_000 })
  const views = page.getByRole('navigation', { name: 'Gap views' })
  await views.getByRole('link', { name: /^Topic counts/ }).click()
  await expect(page).toHaveURL(/view=topics/)
  // Nothing sent her to Health.
  await expect(page).toHaveURL(/\/gaps/)
  await expect(sidebar.getByRole('link', { name: 'Health' })).toHaveCount(0)
})
