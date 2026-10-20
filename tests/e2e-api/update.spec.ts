import { expect, test, type Page } from '@playwright/test'

/*
  An update that one side has not caught up with, on the real service: every answer names the
  contract the service speaks (x-heed-api), and the app was built for the contract of this code.
  The spec makes the service name another one, as a service started before an update does, and
  checks that Proposals says how to catch up instead of blaming the connection. A failure of the
  service itself, on the same contract, says so too.
*/

const otherContract = 'feedfeedfeedfeed'
const proposalsRead = /\/api\/v1\/proposals(\?|$)/

// Reads the page still has in flight when a test ends (live updates, polling) end with it.
test.afterEach(({ page }) => page.unrouteAll({ behavior: 'ignoreErrors' }))

async function signIn(page: Page, origin: string) {
  const response = await page.request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: 'per_maria@example.test' },
  })
  expect(response.ok()).toBe(true)
}

/** Every answer of the service names another contract; the proposals read fails too, when asked. */
async function serviceOfOtherCode(page: Page, { failProposals = false } = {}) {
  await page.route('**/api/v1/**', async (route) => {
    // A live stream stays open; it names the contract like any answer, but is left alone here.
    if (route.request().headers().accept?.includes('text/event-stream')) return route.continue()
    const response = await route.fetch()
    const headers = { ...response.headers(), 'x-heed-api': otherContract }
    if (failProposals && proposalsRead.test(route.request().url()))
      await route.fulfill({
        status: 500,
        headers,
        json: { defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'Old code' },
      })
    else await route.fulfill({ response, headers })
  })
}

test('a service started before an update says it was updated, not that the connection failed', async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL!)
  await serviceOfOtherCode(page, { failProposals: true })
  await page.goto('/proposals?view=mine')

  const advice = 'The app was updated and is still starting. Try again in a few minutes.'
  await expect(page.getByRole('status', { name: 'The app was updated' })).toHaveText(advice)
  const failure = page.getByRole('alert').filter({ hasText: "We couldn't load your proposals" })
  await expect(failure).toContainText(`Your proposals are safe. ${advice}`)
  await expect(failure).not.toContainText('connection')
  await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0)
})

test('a page left open from before an update says to reload it', async ({ page, baseURL }) => {
  await signIn(page, baseURL!)
  await serviceOfOtherCode(page)
  // The web server already serves a build of the contract the service speaks: this page is old.
  await page.route('**/heed-version.json', (route) =>
    route.fulfill({ json: { api: otherContract } }),
  )
  await page.goto('/proposals?view=mine')

  const banner = page.getByRole('status', { name: 'The app was updated' })
  await expect(banner).toContainText('The app was updated. Reload the page to use the new version.')
  await expect(banner.getByRole('button', { name: 'Reload' })).toBeVisible()
  // The proposals still read: the page only warns.
  await expect(page.getByRole('heading', { name: "We couldn't load your proposals" })).toHaveCount(
    0,
  )
})

test('a failure of the service itself says so, and that its log says why', async ({
  page,
  baseURL,
}) => {
  await signIn(page, baseURL!)
  await page.route(proposalsRead, async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      status: 500,
      headers: response.headers(),
      json: { defined: false, code: 'INTERNAL_SERVER_ERROR', status: 500, message: 'Failed' },
    })
  })
  await page.goto('/proposals?view=mine')

  const failure = page.getByRole('alert').filter({ hasText: "We couldn't load your proposals" })
  await expect(failure).toContainText(
    'Your proposals are safe. Something went wrong on our side. Try again, and tell the data team if it keeps happening.',
  )
  await expect(page.getByRole('status', { name: 'The app was updated' })).toHaveCount(0)
})
