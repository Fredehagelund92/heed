import { expect, test, type APIRequestContext } from '@playwright/test'

/*
  Maria's loop on the real service (slice W4): she sends a proposal, Jon claims it and asks for
  changes, and she follows it on the Proposals page, reads his reason, replies, sends it again
  and finally withdraws it. Every step after the setup goes through the browser; the events the
  page shows are the service's own.
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

test('Maria follows her proposal through a request for changes, replies, resends and withdraws it', async ({
  page,
  context,
  playwright,
  baseURL,
}) => {
  const origin = baseURL!
  // A word of its own, so the run finds its proposal among those of earlier runs.
  const marker = `Run${Date.now().toString(36)}`
  const title = `Online sales to Norway stopped on 4 August 2026 after a new customs rule ${marker}.`
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

  // Jon, the owner of Sales, in a session of his own.
  const jonRequest = await playwright.request.newContext({ baseURL })
  const jon = await signIn(jonRequest, origin, 'per_jon@example.test')
  const current = async () =>
    (
      (await (await jonRequest.get(`/api/v1/proposals/${draft.id}`)).json()) as {
        revision: number
      }
    ).revision
  expect(
    (
      await write(jonRequest, jon, `/api/v1/proposals/${draft.id}/claim`, {
        revision: await current(),
      })
    ).ok(),
  ).toBe(true)
  const reason = 'Please add the link to the regulator notice.'
  expect(
    (
      await write(jonRequest, jon, `/api/v1/proposals/${draft.id}/decisions`, {
        revision: await current(),
        outcome: 'request_changes',
        reason,
      })
    ).ok(),
  ).toBe(true)
  await jonRequest.dispose()

  // Maria finds it under Needs you and reads Jon's reason.
  await page.goto('/proposals')
  const row = page.getByRole('table', { name: 'Your proposals' }).getByRole('link', { name: title })
  await expect(row).toBeVisible({ timeout: 15_000 })
  // Her row opens it in the docked panel, with the reviewer's word; expand opens the page.
  await row.click()
  const panel = page.locator('[data-slot="dock-panel"]')
  await expect(panel.locator('[data-slot="decision-alert"]')).toContainText(reason)
  await panel.getByRole('link', { name: 'Open page' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Changes requested')
  await expect(page.getByRole('list', { name: 'Where it stands' })).toContainText(
    'Claimed by Jon Abara',
  )
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText(reason)

  // She replies, then sends it again from the form.
  await page.getByRole('textbox', { name: 'Reply to Jon' }).fill('Added the link to the notice.')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(
    page.getByRole('list', { name: 'Comments' }).locator('[data-slot="comment"]').last(),
  ).toContainText('Added the link to the notice.')
  await page
    .getByRole('button', { name: 'Edit and send again', exact: true })
    .filter({ visible: true })
    .first()
    .click()
  await expect(page).toHaveURL(new RegExp(`/library/new\\?draft=${draft.id}$`))
  await expect(page.getByRole('textbox', { name: 'Summary', exact: true })).toContainText(marker)
  await page
    .getByRole('button', { name: 'Send for review', exact: true })
    .filter({ visible: true })
    .click()
  await expect(page).toHaveURL(new RegExp(`/proposals/${draft.id}$`), { timeout: 15_000 })
  await expect(page.getByRole('list', { name: 'Where it stands' })).toContainText('Sent again')
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Waiting for review')

  // And withdraws it with a reason.
  await page
    .getByRole('button', { name: 'Withdraw', exact: true })
    .filter({ visible: true })
    .click()
  const dialog = page.getByRole('alertdialog', { name: 'Withdraw this proposal?' })
  await dialog.getByRole('textbox', { name: 'Why' }).fill('The regulator lifted the order.')
  await dialog.getByRole('button', { name: 'Withdraw' }).click()
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Withdrawn')

  const events = (await (
    await context.request.get(`/api/v1/proposals/${draft.id}/events`)
  ).json()) as { kind: string; data: Record<string, unknown> }[]
  expect(events.map((event) => event.kind)).toEqual(
    expect.arrayContaining([
      'created',
      'submitted',
      'claimed',
      'decided',
      'commented',
      'withdrawn',
    ]),
  )
  expect(events.filter((event) => event.kind === 'submitted')).toHaveLength(2)
  expect(events.find((event) => event.kind === 'withdrawn')?.data.reason).toBe(
    'The regulator lifted the order.',
  )
})

test('Maria discards a draft she will not send', async ({ page, context, baseURL }) => {
  const maria = await signIn(context.request, baseURL!, 'per_maria@example.test')
  const marker = `Draft${Date.now().toString(36)}`
  const created = await write(context.request, maria, '/api/v1/proposals', {
    channel: 'form',
    draft: {
      kind: 'note',
      summaryMarkup: `A note to throw away ${marker}.`,
      areaId: 'area_sandbox',
    },
  })
  expect(created.ok(), await created.text()).toBe(true)
  const { id } = (await created.json()) as { id: string }
  await page.goto(`/proposals/${id}`)
  await expect(page.getByRole('list', { name: 'Where it stands' })).toContainText('Not sent yet')
  await page
    .getByRole('button', { name: 'Discard draft', exact: true })
    .filter({ visible: true })
    .click()
  await page
    .getByRole('alertdialog', { name: 'Discard this draft?' })
    .getByRole('button', { name: 'Discard draft' })
    .click()
  // The discard and the reads after it go to the service, which the other tests share.
  await expect(page).toHaveURL(/\/proposals$/, { timeout: 15_000 })
  await expect(page.getByRole('table', { name: 'Your proposals' })).toBeVisible()
  await expect(page.getByText(marker)).toHaveCount(0)
  expect((await context.request.get(`/api/v1/proposals/${id}`)).status()).toBe(404)
})
