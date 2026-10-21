import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

/*
  The review loop on the real service (slice W5): Maria writes, Jon finds it in To review, reads
  the diff and the checks, claims it, accepts it, an edition is published, and Maria sees it
  accepted with the edition's number. And the owner's edit (review.edit): Jon raises a note to
  high risk and every check runs again. Every step after the setup goes through the browser.
  Each step waits for the service's answer to the request it sends and, after a write, for the
  screen to finish it: a write stays busy until the screen has read again what it changed. A busy
  machine makes both slower than any fixed wait, so the test's budget bounds them, and the screen
  then gets the usual time to show the result.
*/

/**
 * The longest a run took at a one-minute load near 70 (October 2026) was two and a half minutes;
 * three gives it room.
 */
test.describe.configure({ timeout: 180_000 })

async function signIn(request: APIRequestContext, origin: string, email: string) {
  const response = await request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok(), await response.text()).toBe(true)
  const { csrfToken } = (await response.json()) as { csrfToken: string }
  return { origin, 'x-heed-csrf': csrfToken }
}

function write(
  request: APIRequestContext,
  headers: Record<string, string>,
  url: string,
  data: unknown,
) {
  return request.post(url, {
    headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
    data,
  })
}

/** The service's answer to a request the page sends to `path`, from now on. */
function answer(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === path,
  )
}

/** Maria sends a low-risk note to Sales and answers with its id. */
async function mariaSends(request: APIRequestContext, origin: string, title: string) {
  const maria = await signIn(request, origin, 'per_maria@example.test')
  const created = await write(request, maria, '/api/v1/proposals', {
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
  const submitted = await write(request, maria, `/api/v1/proposals/${draft.id}/submit`, {
    revision: draft.revision,
  })
  expect(submitted.ok(), await submitted.text()).toBe(true)
  return draft.id
}

test('Maria writes, Jon reviews and accepts, an edition is published and Maria sees Accepted', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = baseURL!
  const marker = `Run${Date.now().toString(36)}`
  const title = `Units sold in Poland for September 2026 includes a one-off promotion ${marker}.`
  const writer = await playwright.request.newContext({ baseURL })
  const id = await mariaSends(writer, origin, title)
  await writer.dispose()

  // Jon opens To review, finds it under Sales and decides in the docked panel beside the
  // queue, without leaving it.
  await signIn(context.request, origin, 'per_jon@example.test')
  const queued = answer(page, 'GET', '/api/v1/review/queue')
  await page.goto('/proposals')
  expect((await queued).ok()).toBe(true)
  const queue = page.getByRole('table', { name: 'Proposals to review' })
  const row = queue.getByRole('link', { name: title })
  await expect(row).toBeVisible({ timeout: 15_000 })
  const opened = answer(page, 'GET', `/api/v1/proposals/${id}/review`)
  await row.click()
  expect((await opened).ok()).toBe(true)
  const panel = page.locator('[data-slot="dock-panel"]')
  await expect(panel.getByRole('heading', { level: 2, name: title })).toBeVisible()
  await expect(page).toHaveURL(new RegExp(`/proposals\\?panel=${id}$`))
  await expect(panel.getByRole('table', { name: 'What changed, field by field' })).toContainText(
    'Where it applies',
  )
  await panel.getByRole('tab', { name: /Checks/ }).click()
  await expect(panel.getByRole('list', { name: 'Checks' }).getByRole('listitem')).toHaveCount(3)
  await panel.getByRole('button', { name: 'Details of Finds the right questions' }).click()
  await expect(panel.getByRole('list', { name: 'Test questions' })).toBeVisible()

  const claimed = answer(page, 'POST', `/api/v1/proposals/${id}/claim`)
  const claim = panel.getByRole('button', { name: 'Claim', exact: true })
  await claim.click()
  expect((await claimed).ok()).toBe(true)
  await expect(claim).toHaveCount(0, { timeout: 0 })
  await expect(panel.getByText('Claimed by you').first()).toBeVisible({ timeout: 15_000 })

  const bar = panel.getByRole('region', { name: 'Your decision' })
  await expect(bar).toContainText('Your decision, as owner of Sales')
  await bar.getByRole('button', { name: 'Accept', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept this proposal?' })
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('Matches the promotion calendar.')
  const decided = answer(page, 'POST', `/api/v1/proposals/${id}/decisions`)
  await dialog.getByRole('button', { name: 'Accept' }).click()
  const response = await decided
  expect(response.ok()).toBe(true)
  // The screen names no edition; the decision's answer says which one it made.
  const edition = ((await response.json()) as { edition: { label: string } | null }).edition?.label
  expect(edition).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)
  await expect(dialog).toBeHidden({ timeout: 0 })
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText('Agents get it.', {
    timeout: 15_000,
  })

  const editions = (await (await context.request.get('/api/v1/editions?limit=5')).json()) as {
    label: string
    live: boolean
  }[]
  expect(editions.find((candidate) => candidate.live)?.label).toBe(edition)

  // Maria, in her own session, sees it accepted, and that agents get it.
  await context.clearCookies()
  await signIn(context.request, origin, 'per_maria@example.test')
  const read = answer(page, 'GET', `/api/v1/proposals/${id}/review`)
  await page.goto(`/proposals/${id}`)
  expect((await read).ok()).toBe(true)
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Accepted')
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText('Agents get it.')
})

test('Jon raises a note to high risk in review and every check runs again', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = baseURL!
  const marker = `Edit${Date.now().toString(36)}`
  const title = `Units sold in Poland for September 2026 includes a one-off promotion ${marker}.`
  const writer = await playwright.request.newContext({ baseURL })
  const id = await mariaSends(writer, origin, title)
  await writer.dispose()

  await signIn(context.request, origin, 'per_jon@example.test')
  const opened = answer(page, 'GET', `/api/v1/proposals/${id}/review`)
  await page.goto(`/proposals/${id}`)
  expect((await opened).ok()).toBe(true)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({
    timeout: 15_000,
  })
  await expect(page.getByRole('list', { name: 'Checks' }).getByRole('listitem')).toHaveCount(3)
  await page.locator('[data-slot="owner-edit"]').getByRole('button', { name: 'Change' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Change the review settings' })
  await dialog.getByRole('radio', { name: /High risk/ }).click()
  await dialog
    .getByRole('textbox', { name: 'Why are you changing them?' })
    .fill('A promotion changes every units sold answer.')
  const edited = answer(page, 'POST', `/api/v1/proposals/${id}/review-edits`)
  await dialog.getByRole('button', { name: 'Save and check again' }).click()
  expect((await edited).ok()).toBe(true)
  await expect(dialog).toBeHidden({ timeout: 0 })
  await expect(page.getByRole('list', { name: 'Checks' }).getByRole('listitem')).toHaveCount(5)
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('High risk')
  // The answer tests have not passed yet, so Accept waits and says why.
  await expect(
    page.getByRole('region', { name: 'Your decision' }).getByRole('button', { name: /Accept/ }),
  ).toHaveAttribute('aria-disabled', 'true')

  const events = (await (await context.request.get(`/api/v1/proposals/${id}/events`)).json()) as {
    kind: string
  }[]
  expect(events.map((event) => event.kind)).toContain('edited')
})

test('an administrator accepts their own item and their own term, and the history says so', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = baseURL!
  const marker = `Own${Date.now().toString(36)}`
  const title = `Units sold in Poland for October 2026 includes a one-off promotion ${marker}.`
  // The administrator, with no role in Sales, proposes an item there and a term (FR-206).
  const admin = await signIn(context.request, origin, 'administrator@example.test')
  const created = await write(context.request, admin, '/api/v1/proposals', {
    channel: 'form',
    draft: {
      kind: 'note',
      summaryMarkup: title,
      scope: {
        metrics: ['metric:units_sold'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/poland' }],
      },
      validity: { start: '2026-10-01', end: '2026-10-31' },
      evidence: [
        {
          url: 'https://wiki.example/units-sold-poland-october',
          quote: 'Poland units sold includes the October promotion.',
          date: '2026-10-02',
        },
      ],
      areaId: 'area_sales',
      riskLevel: 'low',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const draft = (await created.json()) as { id: string; revision: number }
  const sent = await write(context.request, admin, `/api/v1/proposals/${draft.id}/submit`, {
    revision: draft.revision,
  })
  expect(sent.ok(), await sent.text()).toBe(true)
  const key = `metric:own_${marker.toLowerCase()}`
  const proposed = await write(context.request, admin, '/api/v1/vocabulary/proposals', {
    key,
    kind: 'metric',
    parentKey: null,
    name: `Own ${marker}`,
    aliases: [],
    areaId: 'area_sales',
    definitionRefs: [],
  })
  expect(proposed.ok(), await proposed.text()).toBe(true)
  const term = (await proposed.json()) as { id: string }

  // Both wait in their own To review, selectable like any other.
  const queued = answer(page, 'GET', '/api/v1/review/queue')
  await page.goto('/proposals')
  expect((await queued).ok()).toBe(true)
  const queue = page.getByRole('table', { name: 'Proposals to review' })
  await expect(queue.getByRole('link', { name: title })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-slot="decide-note"]')).toHaveCount(0)

  // The item: the bar names the capacity and that it is theirs; Accept publishes it.
  const opened = answer(page, 'GET', `/api/v1/proposals/${draft.id}/review`)
  await page.goto(`/proposals/${draft.id}`)
  expect((await opened).ok()).toBe(true)
  const bar = page.getByRole('region', { name: 'Your decision' })
  await expect(bar).toContainText('Your decision, as admin', { timeout: 15_000 })
  await expect(bar).toContainText('You can decide your own proposal.')
  await bar.getByRole('button', { name: 'Accept', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept this proposal?' })
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('Matches the promotion calendar.')
  const decided = answer(page, 'POST', `/api/v1/proposals/${draft.id}/decisions`)
  await dialog.getByRole('button', { name: 'Accept' }).click()
  expect((await decided).ok()).toBe(true)
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText('Agents get it.', {
    timeout: 15_000,
  })
  // Decided, it reads as the proposer's status page, its history open.
  const history = page.getByRole('list', { name: 'History' })
  await expect(history).toContainText('accepted it as admin')
  await expect(history).toContainText('Decided by its proposer.')

  // The term, the same way.
  const read = answer(page, 'GET', `/api/v1/proposals/${term.id}/review`)
  await page.goto(`/proposals/${term.id}`)
  expect((await read).ok()).toBe(true)
  const termBar = page.getByRole('region', { name: 'Your decision' })
  await expect(termBar).toContainText('Your decision, as admin', { timeout: 15_000 })
  await termBar.getByRole('button', { name: 'Accept', exact: true }).click()
  const termDialog = page.getByRole('alertdialog', { name: /^Accept/ })
  await termDialog
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('Cube defines it.')
  const termDecided = answer(page, 'POST', `/api/v1/proposals/${term.id}/decisions`)
  await termDialog.getByRole('button', { name: 'Accept' }).click()
  expect((await termDecided).ok()).toBe(true)
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Accepted', {
    timeout: 15_000,
  })
  const events = (await (
    await context.request.get(`/api/v1/proposals/${term.id}/events`)
  ).json()) as { kind: string; data: { capacity?: string; byProposer?: boolean } }[]
  expect(events.find((event) => event.kind === 'decided')?.data).toMatchObject({
    capacity: 'administrator',
    byProposer: true,
  })
})
