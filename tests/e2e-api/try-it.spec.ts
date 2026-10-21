import { expect, test, type BrowserContext } from '@playwright/test'

/*
  What an agent would get and Connect an agent on the real service: the Try it page asks
  POST /api/v1/try-it for the scope in its address and shows the facts in the order the service
  ranked them; Connect an agent shows the address, the clients and the tools GET /api/v1/connect
  gives every signed-in person. Report a gap sends POST /api/v1/gaps/reports, and the
  administrator finds the gap on the Gaps page, marked as from people, with no name on it.
*/

type Reply = { result: { status: string; items?: { id: string; title: string }[] } }
type Connect = { address: string | null; tools: string[]; clients: { name: string }[] }

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

const scope = {
  metrics: ['metric:average_order_value'],
  dimension_filters: [{ dimension: 'dim:market', values: ['val:market/united_kingdom'] }],
  window: { from: '2026-09-08', to: '2026-10-07' },
}

test('Try it shows the facts the service delivers, in its order', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_maria@example.test')
  const session = await context.request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const asked = await context.request.post('/api/v1/try-it', {
    headers: { origin: baseURL!, 'x-heed-csrf': csrfToken },
    data: scope,
  })
  expect(asked.ok(), await asked.text()).toBe(true)
  const reply = (await asked.json()) as Reply
  expect(reply.result.status).toBe('matched')
  const titles = (reply.result.items ?? []).map((item) => item.title)
  expect(titles.length).toBeGreaterThan(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(
    '/try-it?about=metric:average_order_value,val:market/united_kingdom&from=2026-09-08&to=2026-10-07',
  )
  const delivered = page.getByRole('list', { name: 'What the agent gets, in order' })
  await expect(delivered).toBeVisible({ timeout: 15_000 })
  await expect(delivered.getByRole('listitem').getByRole('link')).toHaveText(titles)
  await expect(page.locator('[data-slot="try-it-outcome"]')).toHaveText('Found')
  await expect(page.getByLabel('what the agent is told', { exact: true })).toContainText(
    'State the documented fact',
  )
})

test('Connect an agent shows what the service says a person may connect', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_maria@example.test')
  const info = (await (await context.request.get('/api/v1/connect')).json()) as Connect
  expect(info.address).toBeTruthy()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/settings?section=connect')
  await expect(page.getByLabel('the address for agents', { exact: true })).toHaveText(
    info.address!,
    {
      timeout: 15_000,
    },
  )
  await expect(page.locator('[data-slot="connect-client"]')).toHaveCount(info.clients.length)
  await expect(page.locator('[data-slot="connect-client"]').first()).toContainText('Claude Code')
  // The gateway test switches a tool off and on beside this one, so only the first is certain.
  await expect(
    page.getByRole('list', { name: 'The tools an agent gets' }).getByRole('listitem').first(),
  ).toContainText('Get facts for a question')
})

test('a person reports a gap from Try it, and the administrator finds it from people', async ({
  page,
  context,
  baseURL,
}) => {
  // A month of its own before any seeded fact, so nothing applies and earlier runs stay apart.
  const month = new Date(Date.UTC(1980, Date.now() % 120, 1))
  const from = month.toISOString().slice(0, 10)
  const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10)
  await signIn(context, baseURL!, 'per_maria@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(
    `/try-it?about=metric:average_order_value,val:market/united_kingdom&from=${from}&to=${to}`,
  )
  await expect(page.locator('[data-slot="try-it-no-match"]')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Report a gap' }).click()
  const dialog = page.getByRole('dialog', { name: 'Report a gap' })
  await expect(dialog.locator('[data-slot="report-gap-about"]')).toContainText(
    'Average order value, United Kingdom',
  )
  await dialog.getByRole('textbox').fill('No facts about the United Kingdom that month.')
  const sent = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/gaps/reports') && response.ok(),
  )
  await dialog.getByRole('button', { name: 'Report gap' }).click()
  const { id } = (await (await sent).json()) as { id: string }
  await expect(page.getByText('Gap reported', { exact: true })).toBeVisible()
  await expect(dialog).toHaveCount(0)

  // One report is below the minimum: Maria, who manages nothing, does not see the gap.
  expect((await context.request.get(`/api/v1/gaps/${id}`)).status()).toBe(404)

  await signIn(context, baseURL!, 'admin-try-it@example.test')
  const gap = (await (await context.request.get(`/api/v1/gaps/${id}`)).json()) as {
    openedBy: string
    type: string
    reports: number
    personReports: number
    topic: { metrics: string[]; month: string }
    notes: { source: string; note: string }[]
  }
  expect(gap).toMatchObject({
    openedBy: 'person',
    type: 'missing',
    reports: 1,
    personReports: 1,
    topic: { metrics: ['metric:average_order_value'], month: from },
  })
  expect(gap.notes).toEqual([
    expect.objectContaining({
      source: 'person',
      note: 'No facts about the United Kingdom that month.',
    }),
  ])
  // An administrator's Gaps address opens Health's Gaps view with the gap as its record.
  await page.goto(`/gaps?origin=person&gap=${id}`)
  await expect(page).toHaveURL(/\/health\?view=gaps/)
  const record = page.locator('[data-slot="record-pane"]')
  await expect(
    record.getByRole('heading', { name: 'Average order value in United Kingdom' }),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(record.locator('[data-slot="from-people-badge"]')).toBeVisible()
  await expect(record.getByText("From a person's report")).toBeVisible()
  // The list, filtered to what people reported, has it as the open row.
  await expect(page.locator(`[data-row-id="gap:${id}"]`)).toHaveAttribute('data-open', 'true')
})
