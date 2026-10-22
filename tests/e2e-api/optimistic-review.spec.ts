import { expect, test, type APIRequestContext, type Page, type Route } from '@playwright/test'

/*
  A decision shows at once on the real service (the captain's pilot, 16 Oct 2026: after three
  accepts the screen took seconds to show them). The service is made slow, or made to refuse, for
  the decision only, so the screen can be watched before its answer: the proposal leaves To review
  and its bar says it is being saved at once; the answer then shows; a refusal brings it back with
  a message that says why. Each runs with the review tests' budget for a busy machine.
*/

// One after another: each counts the proposals waiting for Jon, which another would change.
test.describe.configure({ mode: 'serial', timeout: 180_000 })

/** How soon the screen must show a decision: well within the 200 ms aimed for, on a busy machine. */
const AT_ONCE_MS = 1_500
/** How long the service is held back: longer than the screen may take to show the decision. */
const SLOW_MS = 4_000

async function signIn(request: APIRequestContext, origin: string, email: string) {
  const response = await request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const { csrfToken } = (await response.json()) as { csrfToken: string }
  return { origin, 'x-heed-csrf': csrfToken }
}

/** Maria sends a low-risk note to Sales and answers with its id. */
async function mariaSends(request: APIRequestContext, origin: string, title: string) {
  const maria = await signIn(request, origin, 'per_maria@example.test')
  const post = (url: string, data: unknown) =>
    request.post(url, { headers: { ...maria, 'idempotency-key': crypto.randomUUID() }, data })
  const created = await post('/api/v1/proposals', {
    channel: 'form',
    draft: {
      kind: 'note',
      summaryMarkup: title,
      scope: {
        metrics: ['metric:units_sold'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/poland' }],
      },
      validity: { start: '2026-09-01', end: '2026-10-01' },
      evidence: [
        {
          url: 'https://wiki.example/units-sold-poland',
          quote: 'Poland units sold includes the September promotion.',
          date: '2026-10-02',
        },
      ],
      areaId: 'area_sales',
      riskLevel: 'low',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const draft = (await created.json()) as { id: string; revision: number }
  const submitted = await post(`/api/v1/proposals/${draft.id}/submit`, {
    revision: draft.revision,
  })
  expect(submitted.ok(), await submitted.text()).toBe(true)
  return draft.id
}

/** Holds the decisions the page sends back for `ms`, then lets them through or refuses them. */
async function slowDecisions(page: Page, path: RegExp, ms: number, refuse = false) {
  await page.route(
    (url) => path.test(url.pathname),
    async (route: Route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      await new Promise((resolve) => setTimeout(resolve, ms))
      if (!refuse) return route.fallback()
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          defined: false,
          code: 'CONFLICT',
          status: 409,
          message:
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
        }),
      })
    },
  )
}

const queue = (page: Page) => page.getByRole('table', { name: 'Proposals to review' })
const toast = (page: Page) => page.locator('[data-slot="toast"]')

test('an accept shows at once while the service is slow, then shows its edition', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = baseURL!
  const title = `Poland units sold counts the promotion once ${Date.now().toString(36)}.`
  const writer = await playwright.request.newContext({ baseURL })
  const id = await mariaSends(writer, origin, title)
  await writer.dispose()

  await signIn(context.request, origin, 'per_jon@example.test')
  await page.goto(`/proposals/${id}`)
  const bar = page.getByRole('region', { name: 'Your decision' })
  await expect(bar).toContainText('Your decision, as owner of Sales', { timeout: 30_000 })
  await slowDecisions(page, /\/api\/v1\/proposals\/[^/]+\/decisions$/, SLOW_MS)

  await bar.getByRole('button', { name: 'Accept', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept this proposal?' })
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('Matches the promotion calendar.')
  const decided = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === `/api/v1/proposals/${id}/decisions`,
  )
  const clicked = Date.now()
  await dialog.getByRole('button', { name: 'Accept' }).click()

  // At once, long before the service answers: the dialog is gone and the bar says it is saving,
  // with nothing else to choose.
  await expect(bar).toHaveAttribute('data-state', 'saving', { timeout: AT_ONCE_MS })
  await expect(dialog).toBeHidden({ timeout: AT_ONCE_MS })
  expect(Date.now() - clicked).toBeLessThan(SLOW_MS)
  await expect(bar.getByRole('button', { name: 'Accepting' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(bar.getByRole('button', { name: 'Reject' })).toHaveCount(0)

  // Then the service's answer: decided, and published.
  expect((await decided).ok()).toBe(true)
  await expect(toast(page)).toContainText('Agents get it within a minute.', { timeout: 15_000 })
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Accepted', {
    timeout: 15_000,
  })
})

test('an accept the service refuses comes back to To review, with why', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = baseURL!
  const title = `Poland units sold is read again after the refusal ${Date.now().toString(36)}.`
  const writer = await playwright.request.newContext({ baseURL })
  await mariaSends(writer, origin, title)
  await writer.dispose()

  await signIn(context.request, origin, 'per_jon@example.test')
  await page.goto('/proposals')
  const link = queue(page).getByRole('link', { name: title })
  await expect(link).toBeVisible({ timeout: 30_000 })
  // The To review chip counts what waits for Jon, down to none (the sidebar hides a zero).
  const chip = page.getByRole('navigation', { name: 'Proposal views' }).getByRole('link', {
    name: /^To review/,
  })
  const waiting = (n: number) => new RegExp(`^To review\\s*${n.toLocaleString('en')}$`)
  const before = Number(/\d+/.exec((await chip.textContent()) ?? '')?.[0])
  await link.click()
  const panel = page.locator('[data-slot="dock-panel"]')
  const bar = panel.getByRole('region', { name: 'Your decision' })
  await expect(bar).toContainText('Your decision, as owner of Sales', { timeout: 30_000 })
  await slowDecisions(page, /\/api\/v1\/proposals\/[^/]+\/decisions$/, SLOW_MS, true)

  await bar.getByRole('button', { name: 'Accept', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept this proposal?' })
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('Matches the promotion calendar.')
  await dialog.getByRole('button', { name: 'Accept' }).click()

  // The row and its count leave at once.
  await expect(link).toHaveCount(0, { timeout: AT_ONCE_MS })
  await expect(chip).toHaveAccessibleName(waiting(before - 1), { timeout: AT_ONCE_MS })

  // The refusal brings it back, and says what did not happen and why.
  await expect(toast(page)).toContainText(`Not accepted: ${title}`, { timeout: 15_000 })
  await expect(toast(page)).toContainText('Someone changed this proposal after you opened it.')
  await expect(link).toBeVisible()
  await expect(chip).toHaveAccessibleName(waiting(before))
})

test('a bulk accept the service refuses brings its proposals back', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = baseURL!
  const stamp = Date.now().toString(36)
  const titles = [1, 2].map((n) => `Poland units sold bulk note ${n} ${stamp}.`)
  const writer = await playwright.request.newContext({ baseURL })
  for (const title of titles) await mariaSends(writer, origin, title)
  await writer.dispose()

  await signIn(context.request, origin, 'per_jon@example.test')
  await page.goto('/proposals')
  const links = titles.map((title) => queue(page).getByRole('link', { name: title }))
  await expect(links[1]!).toBeVisible({ timeout: 30_000 })
  for (const title of titles)
    await queue(page)
      .getByRole('checkbox', { name: `Select ${title}` })
      .click()
  await slowDecisions(page, /\/api\/v1\/review\/decisions$/, 1_000, true)
  await page
    .getByRole('region', { name: 'Selected proposals' })
    .getByRole('button', { name: 'Accept' })
    .click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept 2 selected proposals?' })
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting them?' })
    .fill('Checked the source')
  await dialog.getByRole('button', { name: 'Accept 2' }).click()

  // Held for Undo: gone at once. Let it go, and the refusal brings both back.
  for (const link of links) await expect(link).toHaveCount(0, { timeout: AT_ONCE_MS })
  await expect(toast(page).filter({ hasText: 'Nothing was decided' })).toContainText(
    'The proposals are back in To review.',
    { timeout: 30_000 },
  )
  for (const link of links) await expect(link).toBeVisible()
})
