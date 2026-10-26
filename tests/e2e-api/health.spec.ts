import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { devKey, mintDevToken } from '../../src/server/mcp/auth.ts'

/*
  Health on the real service (Workbench plan, slice W8; the Workbench until the navigation
  decision of 12 October 2026), where it took over from Quality and from the owners' Gaps page:
  the domain health, a test question written through the form and an import checked, a run
  started and opened as a record; the refusals by role, the service's answer and the page's; the
  old Workbench, Quality and Gaps addresses landing on the matching Health state; an agent's gap
  turned into a draft from Health; and a contributor who keeps the Gaps page.

  CI's seed (npm run seed -- --items-only) has no test questions, runs or gaps, so those tests make their own
  and read nothing a parallel test could change. The last test walks the owner's story on the
  demo seed (npm run seed: twelve weekly runs, the newest Sales run failing one question on
  its caveat, and the open gap on the same scope); on the bulk seed alone it says so and skips.
*/

const apiUrl = `http://127.0.0.1:${process.env.PW_API_PORT ?? 3100}`

async function signIn(request: APIRequestContext, origin: string, email: string) {
  const response = await request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

/**
 * The service's answer to a write the page sends to `path`, from now on. A dialog stays open
 * until the write is answered and the screen has read again what it changed, which a busy machine
 * makes slower than any fixed wait: the test waits for the answer, then the test's budget bounds
 * the rest (as in review.spec.ts).
 */
function answer(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === path,
  )
}

const strip = (page: Page) => page.getByRole('toolbar', { name: 'Domain and runs' })
const grid = (page: Page) => page.getByRole('table', { name: 'Domain health' })
const record = (page: Page) => page.locator('[data-slot="record-pane"]')
const actions = (page: Page) => page.getByRole('complementary', { name: 'Actions' })
const workList = (page: Page) => page.getByRole('region', { name: 'Work list' })
const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })
const overviewActions = (page: Page) => page.getByRole('group', { name: 'Test questions' })

test('an owner finds Health in the sidebar, writes a test question and runs their domain', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context.request, baseURL!, 'per_jon@example.test')
  await page.goto('/')
  await sidebar(page).getByRole('link', { name: 'Health' }).click({ timeout: 15_000 })
  await expect(page).toHaveURL(/\/health$/)
  await expect(sidebar(page).getByRole('link', { name: 'Gaps' })).toHaveCount(0)
  await expect(grid(page).getByRole('rowheader')).toHaveText(['Sales', 'Sandbox'], {
    timeout: 15_000,
  })
  await expect(strip(page)).toContainText('Agents get the facts as of')
  await expect(page.locator('[data-slot="quality-verdict"]')).toBeVisible()

  // A question of its own, so this test does not depend on another's.
  const name = `orders-netherlands-${Date.now().toString(36)}`
  await overviewActions(page).getByRole('button', { name: 'Write a test question' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write a test question' })
  await dialog.getByRole('combobox', { name: 'Domain' }).click()
  await page.getByRole('option', { name: 'Sales' }).click()
  await dialog
    .getByRole('textbox', { name: 'As a person asks it' })
    .fill('Why did orders in the Netherlands fall last week?')
  await dialog.getByRole('textbox', { name: 'Short name' }).fill(name)
  await dialog
    .getByRole('textbox', { name: 'Precisely' })
    .fill('What explains orders in the Netherlands between 28 September and 4 October 2026?')
  await dialog.getByRole('textbox', { name: 'Where it comes from' }).fill('Sales, October 2026')
  const added = answer(page, 'PUT', `/api/v1/evals/questions/${name}`)
  await dialog.getByRole('button', { name: 'Add the question' }).click()
  expect((await added).ok()).toBe(true)
  await expect(dialog).toHaveCount(0, { timeout: 0 })
  await expect(page).toHaveURL(new RegExp(`open=question(%3A|:)${name}`))
  await expect(record(page).getByRole('heading', { level: 2 })).toHaveText(
    'Why did orders in the Netherlands fall last week?',
  )
  await expect(record(page).getByRole('region', { name: 'Details' })).toContainText(name)

  // An import is checked by the service before anything is saved.
  await record(page).getByRole('button', { name: 'Close' }).click()
  await overviewActions(page).getByRole('button', { name: 'Import' }).click()
  const importing = page.getByRole('dialog', { name: 'Import test questions' })
  await importing.getByRole('textbox', { name: 'The questions' }).fill('- id: only-a-name\n')
  await importing.getByRole('button', { name: 'Check' }).click()
  await expect(importing.locator('[data-slot="import-report"]')).toContainText(
    '1 entry needs a fix first',
  )
  await importing.getByRole('button', { name: 'Cancel' }).click()

  // A full run of Sales from its record: the estimate, then the run as the record.
  await page.goto('/health?open=domain:area_sales')
  await actions(page).getByRole('button', { name: 'Run Sales' }).click({ timeout: 15_000 })
  const running = page.getByRole('dialog', { name: 'Run Sales now?' })
  // The estimate asks the service; a busy machine takes more than the default 5 s.
  await expect(running.locator('[data-slot="run-estimate"]')).toContainText('question', {
    timeout: 15_000,
  })
  const started = answer(page, 'POST', '/api/v1/evals/areas/area_sales/runs')
  await running.getByRole('button', { name: 'Start the run' }).click()
  expect((await started).ok()).toBe(true)
  await expect(running).toHaveCount(0, { timeout: 0 })
  await expect(page).toHaveURL(/open=run(%3A|:)/)
  await expect(record(page).getByRole('heading', { level: 2 }).first()).toHaveText(/^Full run, /)
})

test('a contributor and an auditor are refused by the page and by the service, and keep Gaps', async ({
  page,
  context,
  baseURL,
}) => {
  for (const email of ['per_maria@example.test', 'auditor@example.test']) {
    await signIn(context.request, baseURL!, email)
    const reads = await Promise.all(
      ['/api/v1/quality/fix-next', '/api/v1/quality/history', '/api/v1/evals/runs'].map((path) =>
        context.request.get(path, { headers: { origin: baseURL! } }),
      ),
    )
    expect(reads.map((response) => response.status())).toEqual([403, 403, 403])
    // An old Quality link lands on Health, which says whose page it is.
    await page.goto('/quality?view=questions')
    await expect(page).toHaveURL(/\/health\?view=questions$/)
    await expect(page.getByText('Health is for owners and admins', { exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect(grid(page)).toHaveCount(0)
    await expect(sidebar(page).getByRole('link', { name: 'Gaps' })).toBeVisible()
    await expect(sidebar(page).getByRole('link', { name: 'Health' })).toHaveCount(0)
  }
})

test('an administrator sees every domain, and the old addresses land on Health', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context.request, baseURL!, 'admin-health@example.test')
  await page.goto('/quality?area=area_sales')
  await expect(page).toHaveURL(/\/health\?area=area_sales$/)
  await expect(grid(page).getByRole('rowheader')).toHaveText(['Sales'], { timeout: 15_000 })
  await page.goto('/workbench?view=runs')
  await expect(page).toHaveURL(/\/health\?view=runs$/)
  await page.goto('/evals?tab=evals')
  await expect(page).toHaveURL(/\/health$/)
  await expect(grid(page).getByRole('rowheader')).toHaveText(
    ['Customer value', 'Marketing', 'Paid media', 'Sales', 'Sandbox'],
    { timeout: 15_000 },
  )
  await workList(page)
    .getByRole('navigation', { name: 'Work list views' })
    .getByRole('link', { name: /^Runs/ })
    .click()
  await expect(page).toHaveURL(/view=runs/)
  await page.goto('/gaps?status=open')
  await expect(page).toHaveURL(/\/health\?view=gaps&status=open$/)
  // The topic counts stay on the Gaps page, linked from Health's Gaps view.
  await workList(page).getByRole('link', { name: 'See what agents ask about, per week' }).click()
  await expect(page).toHaveURL(/\/gaps\?view=topics$/)
  await expect(page.getByRole('navigation', { name: 'Gap views' })).toBeVisible()
})

/** Calls report_gap as the local Claude Code client, with a dev token the service accepts. */
async function reportGap(args: Record<string, unknown>): Promise<string> {
  // The service signs nothing: it checks tokens against the dev key it keeps beside it.
  const key = await devKey(process.env.MCP_DEV_KEY_FILE ?? '.heed-dev-key.pem', 'test')
  // The service's MCP address is on its own port (playwright.api.config.ts), the token's audience.
  const token = await mintDevToken(
    key,
    process.env.MCP_RESOURCE_URL ?? `http://localhost:${process.env.PW_API_PORT ?? 3100}/mcp`,
  )
  const wire = new Client(
    { name: 'workbench-e2e', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  try {
    const reply = await wire.callTool({ name: 'report_gap', arguments: args })
    expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true)
    const content = reply.structuredContent as { recorded?: boolean; gap_id?: string }
    expect(content.recorded, JSON.stringify(reply.structuredContent)).toBe(true)
    return content.gap_id!
  } finally {
    await wire.close()
  }
}

test('an agent reports a gap and the administrator turns it into a draft from Health', async ({
  page,
  context,
  baseURL,
}) => {
  // A month of its own, so the run finds its topic among those of earlier runs.
  const month = new Date(Date.UTC(2015, Date.now() % 120, 1))
  const from = month.toISOString().slice(0, 10)
  const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10)
  const gapId = await reportGap({
    question: 'Why did orders in Norway drop?',
    metrics: ['orders'],
    dimension_filters: [{ dimension: 'market', values: ['norway'] }],
    window: { from, to },
  })

  await signIn(context.request, baseURL!, 'admin-health@example.test')
  // The link an owner had for the gap lands on its record in Health.
  await page.goto(`/gaps?gap=${gapId}`)
  await expect(page).toHaveURL(new RegExp(`/health\\?view=gaps&open=gap(%3A|:)${gapId}$`))
  await expect(record(page).getByRole('heading', { name: 'Orders in Norway' })).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    record(page).getByRole('list', { name: "The metrics, names and month it's about" }),
  ).toContainText('Orders')
  // One report is below the minimum, so even the administrator reads "Fewer than 5".
  await record(page).getByRole('tab', { name: 'Table' }).click()
  await expect(record(page).getByRole('table', { name: 'Weekly counts of the gap' })).toContainText(
    'Fewer than 5',
  )

  // Orders has no area in the vocabulary; Cube gives it Sales, so the gap is Sales's
  // (CON-206) and the draft goes there without asking.
  await expect(record(page).getByText('Sales', { exact: true })).toBeVisible()
  await actions(page).getByRole('button', { name: 'Start a draft' }).click()

  await expect(page).toHaveURL(
    new RegExp(`/library/new\\?draft=[a-f0-9-]+&asked=${from.slice(0, 7)}$`),
  )
  await expect(page.getByRole('button', { name: 'Remove Orders' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Market Norway' })).toBeVisible()
  // The month is when people asked, not when the fact applies: the dates stay empty, and the
  // month is a hint beside them.
  await expect(page.getByRole('textbox', { name: 'From', exact: true })).toHaveValue('')
  const asked = month.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  await expect(page.getByText(`People asked about ${asked}.`, { exact: false })).toBeVisible()

  // The first save of the handed-over draft goes through without a conflict: the form starts
  // from the draft's current revision, not the one startDraft answered with.
  const conflicts: string[] = []
  page.on('response', (response) => {
    if (response.status() === 409) conflicts.push(response.url())
  })
  const draftId = new URL(page.url()).searchParams.get('draft')!
  const summary = page.getByRole('textbox', { name: 'Summary', exact: true })
  await summary.click()
  await summary.pressSequentially('Orders in Norway were reported missing by an agent.')
  await expect
    .poll(
      async () => {
        const draft = await context.request.get(`/api/v1/proposals/${draftId}`)
        return ((await draft.json()) as { draft: { summary?: string } }).draft.summary
      },
      { timeout: 15_000 },
    )
    .toBe('Orders in Norway were reported missing by an agent.')
  await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute(
    'data-status',
    'saved',
  )
  expect(conflicts).toEqual([])

  const gap = await context.request.get(`/api/v1/gaps/${gapId}`)
  expect(await gap.json()).toMatchObject({ status: 'proposal_made' })
})

test('an owner writes a test from a gap, links and unlinks it, and resolving waits for a run', async ({
  page,
  context,
  baseURL,
}) => {
  // A month of its own, and a metric of Sales only, so the gap is this test's and Sales's.
  const month = new Date(Date.UTC(2005, Date.now() % 120, 1))
  const from = month.toISOString().slice(0, 10)
  const to = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10)
  const gapId = await reportGap({
    question: 'How many support contacts were there in Norway?',
    metrics: ['metric:support_contacts'],
    dimension_filters: [{ dimension: 'market', values: ['norway'] }],
    window: { from, to },
  })
  await signIn(context.request, baseURL!, 'per_jon@example.test')
  await page.goto(`/health?open=gap:${gapId}`)
  await expect(
    record(page).getByRole('heading', { name: 'Support contacts in Norway' }),
  ).toBeVisible({
    timeout: 15_000,
  })
  await expect(record(page).getByText('No test is linked yet.')).toBeVisible()

  // Write a test from the gap: the gap's domain and scope, the wording the owner's own.
  const name = `support-contacts-${Date.now().toString(36)}`
  await actions(page).getByRole('button', { name: 'Write a test from this gap' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write a test question' })
  await expect(dialog.locator('[data-slot="from-gap"]')).toContainText(
    'Written from a gap: Support contacts in Norway',
  )
  await expect(dialog.getByRole('combobox', { name: 'Domain' })).toHaveText(/Sales/)
  await dialog
    .getByRole('textbox', { name: 'As a person asks it' })
    .fill('How busy was support that month?')
  await dialog.getByRole('textbox', { name: 'Short name' }).fill(name)
  await dialog
    .getByRole('textbox', { name: 'Precisely' })
    .fill('How many support contacts were there in the month, in total?')
  const added = answer(page, 'PUT', `/api/v1/evals/questions/${name}`)
  await dialog.getByRole('button', { name: 'Add the question' }).click()
  expect((await added).ok()).toBe(true)
  await expect(dialog).toHaveCount(0, { timeout: 0 })
  const tests = record(page).getByRole('list', { name: 'Linked tests' })
  await expect(tests.getByRole('listitem')).toHaveText([/How busy was support that month\?/])
  // The service kept the gap's scope and month on the question.
  const saved = await context.request.get(`/api/v1/evals/questions/${name}`)
  expect(await saved.json()).toMatchObject({
    area: 'area_sales',
    scope: {
      metrics: ['support_contacts'],
      dimension_filters: [{ dimension: 'market', values: ['norway'] }],
      window: { from, to },
    },
  })

  // Unlink it, and link it again from the picker.
  await tests.getByRole('button', { name: 'Unlink How busy was support that month?' }).click()
  await expect(record(page).getByText('No test is linked yet.')).toBeVisible()
  await actions(page)
    .getByRole('combobox', { name: 'Link a test question' })
    .fill('How busy was support')
  await page.getByRole('option', { name: 'How busy was support that month?' }).click()
  await actions(page).getByRole('button', { name: 'Link the test' }).click()
  await expect(tests.getByRole('listitem')).toHaveCount(1)

  // Resolved records the live edition; Verified by test waits for a passing run on it.
  await actions(page).getByRole('button', { name: 'Mark resolved' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Mark this gap as resolved?' })
  await confirm.getByRole('textbox', { name: 'Why' }).fill('The support item now covers it.')
  const resolved = answer(page, 'POST', `/api/v1/gaps/${gapId}/status`)
  await confirm.getByRole('button', { name: 'Mark resolved' }).click()
  expect((await resolved).ok()).toBe(true)
  await expect(confirm).toHaveCount(0, { timeout: 0 })
  const verification = actions(page).locator('[data-slot="gap-verification"]')
  await expect(verification).toContainText(/Marked resolved .+\./)
  await expect(verification).toContainText(
    'Not yet. It waits for a weekly or full run to pass on what agents get since it was resolved. 0 of 1 linked test has passed.',
  )
  await expect(verification.getByRole('button', { name: 'Run Sales now' })).toBeVisible()
  const gap = await context.request.get(`/api/v1/gaps/${gapId}`)
  expect(await gap.json()).toMatchObject({ status: 'resolved', verifiedAt: null })

  // Its history is the lifecycle the service logged.
  await record(page).getByRole('tab', { name: 'History' }).click()
  const history = record(page).getByRole('list', { name: 'History' })
  await expect(history).toContainText('Marked resolved')
  await expect(history).toContainText('Why: The support item now covers it.')
  await expect(history).toContainText('Test unlinked: How busy was support that month?')
  await expect(history.getByText('Test linked: How busy was support that month?')).toHaveCount(2)
})

const REGRESSION = 'net-revenue-month-to-date'
// The seed asks it for its month (db/seed/test-questions.ts); the mock says "this month".
const REGRESSION_TITLE = 'How is net revenue in Spain doing in October 2026?'

test('on the demo seed, an owner walks the regression from Got worse to its two runs side by side', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context.request, baseURL!, 'per_jon@example.test')
  const seeded = await context.request.get(`/api/v1/evals/questions/${REGRESSION}`)
  test.skip(
    seeded.status() === 404,
    'The demo seed is not loaded (npm run seed); the bulk seed has no test questions or runs.',
  )
  expect(seeded.ok()).toBe(true)

  // The old Quality link to the question's results opens its Test result in Health.
  await page.goto(`/quality?view=questions&panel=question:${REGRESSION}&tab=results`)
  await expect(page).toHaveURL(
    new RegExp(`/health\\?view=questions&open=question(%3A|:)${REGRESSION}&tab=result$`),
  )
  await expect(record(page).getByRole('heading', { level: 2 })).toHaveText(REGRESSION_TITLE, {
    timeout: 15_000,
  })

  // From the start: Sales in scope, the newest weekly run against the one before.
  await page.goto('/health?area=area_sales')
  await expect(strip(page).getByRole('list', { name: 'Results' })).toContainText('1 got worse', {
    timeout: 15_000,
  })
  await expect(page.locator('[data-slot="quality-verdict"]')).toContainText('1 got worse')
  const views = workList(page).getByRole('navigation', { name: 'Work list views' })
  await views.getByRole('link', { name: /^Got worse/ }).click()
  await expect(page).toHaveURL(/view=worse/)
  const rows = workList(page).locator('[data-row-link]')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(REGRESSION_TITLE)
  await rows.first().click()
  await expect(page).toHaveURL(new RegExp(`open=question(%3A|:)${REGRESSION}`))
  await expect(record(page).getByRole('heading', { level: 2 })).toHaveText(REGRESSION_TITLE)

  // Evidence: the caveat check failed in the newest run and passed in the one before.
  const checks = record(page).getByRole('list', { name: 'Checks' })
  await expect(checks).toBeVisible({ timeout: 15_000 })
  await expect(checks.getByRole('listitem').filter({ hasText: 'Fact mentioned' })).toContainText(
    'Fail',
  )
  // The open gap on the same scope in production, which the seed opened beside the question.
  await expect(record(page).getByRole('list', { name: 'Gaps on this topic' })).toContainText(
    'Net revenue in Spain',
  )
  await expect(record(page).getByRole('region', { name: 'How it is asked' })).toBeVisible()

  // Test result, then the compare focus over the record with Shift C, and back with Escape.
  await record(page).getByRole('tab', { name: 'Test result' }).click()
  await expect(page).toHaveURL(/tab=result/)
  await page.keyboard.press('Shift+C')
  const focus = page.locator('[data-slot="compare-focus"]')
  await expect(focus).toBeVisible()
  await expect(page).toHaveURL(/mode=compare/)
  await expect(
    focus.getByRole('region', { name: 'Mentions what it must', exact: true }),
  ).toContainText('missing')
  await page.keyboard.press('Escape')
  await expect(focus).toHaveCount(0)
  await expect(page).not.toHaveURL(/mode=compare/)
  await expect(record(page).getByRole('heading', { level: 2 })).toHaveText(REGRESSION_TITLE)
  await expect(workList(page).locator(`[data-row-id="question:${REGRESSION}"]`)).toHaveAttribute(
    'data-open',
    'true',
  )
})
