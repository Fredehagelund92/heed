import { expect, test, type APIRequestContext } from '@playwright/test'

/*
  Live updates on the real service (slice W7): Maria has the Proposals page open; Jon, in a
  session of his own, claims her proposal and asks for changes. Her list, her bell and the
  sidebar count change through the service's event stream (server-sent events through the
  preview server's proxy), without a reload, and the bell's notification opens the proposal.
*/

async function signIn(request: APIRequestContext, origin: string, email: string) {
  const response = await request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
  const { csrfToken } = (await response.json()) as { csrfToken: string }
  return { origin, 'x-heed-csrf': csrfToken }
}

/** A change as the browser sends it: the session's change token and a retry key of its own. */
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

test("an owner's decision reaches the writer's bell without a reload", async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = baseURL!
  // A word of its own, so the run finds its proposal among those of earlier runs.
  const marker = `Live${Date.now().toString(36)}`
  const title = `Online sales to Norway stopped on 4 August 2026 ${marker}.`
  const maria = await signIn(context.request, origin, 'per_maria@example.test')
  const created = await write(context.request, maria, '/api/v1/proposals', {
    channel: 'form',
    draft: {
      kind: 'event',
      summaryMarkup: title,
      scope: {
        metrics: ['metric:units_sold'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      validity: { start: '2026-08-04', end: null },
      evidence: [
        {
          url: 'https://news.example/norway-online-sales-stopped',
          quote: 'The customs office ordered carriers to stop taking webshop parcels for Norway.',
          date: '2026-08-05',
        },
      ],
      areaId: 'area_sales',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const draft = (await created.json()) as { id: string; revision: number }
  const submitted = await write(context.request, maria, `/api/v1/proposals/${draft.id}/submit`, {
    revision: draft.revision,
  })
  expect(submitted.ok()).toBe(true)

  let loads = 0
  page.on('load', () => (loads += 1))
  // The page opens its live stream as it loads; the service answers once the stream is open.
  const streaming = page.waitForResponse((response) => response.url().endsWith('/api/v1/events'))
  await page.goto(`/proposals?q=${marker}`)
  await streaming
  const row = page
    .getByRole('table', { name: 'Your proposals' })
    .getByRole('row')
    .filter({ hasText: marker })
  await expect(row).toContainText('Waiting for review')
  const bell = page.getByRole('button', { name: /^Notifications(, \d+ unread)?$/ })
  await expect(bell).toBeVisible()
  const unread = async () =>
    Number(/, (\d+) unread/.exec((await bell.getAttribute('aria-label')) ?? '')?.[1] ?? 0)
  // Other tests act on Maria's proposals at the same time, so the count only ever grows here.
  const before = await unread()

  // Jon, the owner of Sales, in a session of his own.
  const jonRequest = await playwright.request.newContext({ baseURL })
  const jon = await signIn(jonRequest, origin, 'per_jon@example.test')
  const revision = async () =>
    (
      (await (await jonRequest.get(`/api/v1/proposals/${draft.id}`)).json()) as {
        revision: number
      }
    ).revision
  expect(
    (
      await write(jonRequest, jon, `/api/v1/proposals/${draft.id}/claim`, {
        revision: await revision(),
      })
    ).ok(),
  ).toBe(true)
  await expect(row).toContainText('In review')
  await expect.poll(unread).toBeGreaterThanOrEqual(before + 1)

  const decided = await write(jonRequest, jon, `/api/v1/proposals/${draft.id}/decisions`, {
    revision: await revision(),
    outcome: 'request_changes',
    reason: 'Add the regulator notice as the source.',
  })
  expect(decided.ok(), await decided.text()).toBe(true)
  await expect(row).toContainText('Changes requested')
  await expect.poll(unread).toBeGreaterThanOrEqual(before + 2)
  await expect(page.getByRole('status').filter({ hasText: 'New notification' })).toHaveText(
    `New notification: Jon Abara asked for changes: ${title}`,
  )
  expect(loads).toBe(1)

  // The notification opens the proposal and is read from then on.
  await bell.click()
  const panel = page.getByRole('dialog', { name: 'Notifications' })
  await expect(
    panel.getByRole('link', { name: `Unread: Jon Abara claimed the review: ${title}` }),
  ).toBeVisible()
  await panel.getByRole('link', { name: `Unread: Jon Abara asked for changes: ${title}` }).click()
  await expect(page).toHaveURL(new RegExp(`/proposals/${draft.id}$`))
  await bell.click()
  await expect(
    panel.getByRole('link', {
      name: `Jon Abara asked for changes: ${title} “Add the regulator notice as the source.”`,
      exact: true,
    }),
  ).toBeVisible()
  await jonRequest.dispose()
})
