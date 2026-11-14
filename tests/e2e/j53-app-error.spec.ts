import { expect, go, mode, test } from './go.ts'

// J53: when the app cannot start, it says so on its own page: what happened, a Try again that
// opens the app in place once the service answers, and the request id to give an admin.

const REQUEST_ID = '0b5e2c1a-7d4f-4e8a-9c3b-2f6a1d8e5b70'

test('a failed start shows the app error page, and Try again opens the app', async ({ page }) => {
  test.skip(mode !== 'http', "The mock's shared reads always answer.")
  // The shell's read of the workspace's people fails, as it did under load (UX audit, P12).
  const fail = /\/api\/v1\/members(\?|$)/
  await page.route(fail, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      headers: { 'x-request-id': REQUEST_ID },
      body: JSON.stringify({
        defined: false,
        code: 'INTERNAL_SERVER_ERROR',
        status: 500,
        message: 'Internal server error',
      }),
    }),
  )
  await go(page, '/inbox')
  await expect(page.getByRole('heading', { name: "Your workspace didn't open" })).toBeVisible()
  await expect(page.getByText('Something went wrong!')).toHaveCount(0)
  await expect(page.getByText(REQUEST_ID)).toBeVisible()
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(retry).toBeVisible()

  // Try again while it still fails: the same page, with the new request's id.
  await retry.click()
  await expect(page.getByRole('heading', { name: "Your workspace didn't open" })).toBeVisible()

  // The service answers again: Try again opens the app where it was, without loading the page.
  await page.unroute(fail)
  await page.evaluate(() => ((window as unknown as { stayed: boolean }).stayed = true))
  await retry.click()
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await expect(page).toHaveURL(/\/inbox$/)
  expect(await page.evaluate(() => (window as unknown as { stayed?: boolean }).stayed)).toBe(true)
})
