import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { devKey, mintDevToken } from '../../src/server/mcp/auth.ts'

/*
  The owner's story end to end on the real service (Workbench plan, slice V7). On the demo seed
  (npm run seed) the newest weekly run of Sales got worse on one question: its note on net
  revenue and test accounts was given an end date of 30 September, so an agent asking about
  October is not given the note. Jon, the owner of Sales, notices it in
  Health, compares the two runs, reads the note's change, suggests a change that puts the note
  back in service, attaches the test to it, submits and accepts it (a low-risk change, FR-206),
  resolves the gap agents raised on the same scope, runs Sales and sees the gap verified by
  test. An agent asking the question gets the note from the new edition.

  It changes the demo's story for good (the note's next version, an edition, the gap), so it runs
  once per seed, after the other projects (playwright.api.config.ts); on the bulk seed alone it
  says so and skips. Every wait is on a condition the service or the screen reaches, never a
  fixed time: the evaluation worker starts a queued run within a minute, and a busy machine makes
  the run slower, so the test has room.
*/

test.describe.configure({ timeout: 480_000 })

const apiUrl = `http://127.0.0.1:${process.env.PW_API_PORT ?? 3100}`

async function signIn(request: APIRequestContext, origin: string, email: string) {
  const response = await request.post('/api/v1/auth/sign-in', {
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

/** The service's answer to a request the page sends to `path`, from now on. */
function answer(page: Page, method: string, path: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method && new URL(response.url()).pathname === path,
  )
}

/** The items get_context gives the local Claude Code client for a question. */
async function agentGets(
  question: string,
): Promise<{ id: string; title: string; summary: string }[]> {
  // The service signs nothing: it checks tokens against the dev key it keeps beside it.
  const key = await devKey(process.env.MCP_DEV_KEY_FILE ?? '.heed-dev-key.pem', 'test')
  const token = await mintDevToken(
    key,
    process.env.MCP_RESOURCE_URL ?? `http://localhost:${process.env.PW_API_PORT ?? 3100}/mcp`,
  )
  const wire = new Client(
    { name: 'owner-e2e', version: '1.0.0' },
    { versionNegotiation: { mode: 'auto' } },
  )
  await wire.connect(
    new StreamableHTTPClientTransport(new URL(`${apiUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  )
  try {
    const reply = await wire.callTool({ name: 'get_context', arguments: { question } })
    expect(reply.isError, JSON.stringify(reply.content)).not.toBe(true)
    return (
      (reply.structuredContent as { items?: { id: string; title: string; summary: string }[] })
        .items ?? []
    )
  } finally {
    await wire.close()
  }
}

const strip = (page: Page) => page.getByRole('toolbar', { name: 'Domain and runs' })
const record = (page: Page) => page.locator('[data-slot="record-pane"]')
const actions = (page: Page) => page.getByRole('complementary', { name: 'Actions' })
const workList = (page: Page) => page.getByRole('region', { name: 'Work list' })
const verification = (page: Page) => actions(page).locator('[data-slot="gap-verification"]')
const fact = (page: Page, name: string) =>
  verification(page).locator('dt', { hasText: name }).locator('xpath=following-sibling::dd')

// The demo's regression (db/seed/test-questions.ts, `regression` in src/web/mocks/items.ts).
const QUESTION = 'net-revenue-month-to-date'
const TITLE = 'How is net revenue in Spain doing in October 2026?'
const NOTE = 'itm_q2upr28v'
const NOTE_TITLE = 'Net revenue excludes test accounts'
// The open gap agents raised on the same scope, which the seed links to the question.
const GAP = 'ca9a0000-0000-4000-8000-00000000000a'

test('an owner fixes a regression from Health, and the next edition and a run verify it', async ({
  page,
  context,
  baseURL,
}) => {
  const origin = baseURL!
  await signIn(context.request, origin, 'per_jon@example.test')
  const seeded = await context.request.get(`/api/v1/evals/questions/${QUESTION}`)
  test.skip(
    seeded.status() === 404,
    'The demo seed is not loaded (npm run seed); the bulk seed has no test questions or runs.',
  )
  const gap = await context.request.get(`/api/v1/gaps/${GAP}`)
  expect(
    ((await gap.json()) as { status: string }).status,
    'The story runs once per demo seed; seed it again to run it again.',
  ).toBe('open')
  // What AI apps get today: the note ended, so it is not given for October.
  expect((await agentGets(TITLE)).map((item) => item.id)).not.toContain(NOTE)

  // Health: Sales got worse on one question, which the work list opens.
  await page.goto('/health?area=area_sales')
  await expect(strip(page).getByRole('list', { name: 'Results' })).toContainText('1 got worse', {
    timeout: 15_000,
  })
  await workList(page)
    .getByRole('navigation', { name: 'Work list views' })
    .getByRole('link', { name: /^Got worse/ })
    .click()
  const rows = workList(page).locator('[data-row-link]')
  await expect(rows).toHaveCount(1)
  await rows.first().click()
  await expect(page).toHaveURL(new RegExp(`open=question(%3A|:)${QUESTION}`))
  await expect(record(page).getByRole('heading', { level: 2 })).toHaveText(TITLE)

  // Compare: the note was given in the run before and not in the newest. The caveat is still
  // mentioned, because other domains' notes with the same words carry it (db/seed/demo.ts).
  await page.keyboard.press('Shift+C')
  const focus = page.locator('[data-slot="compare-focus"]')
  const got = focus
    .getByRole('region', { name: 'Facts it got', exact: true })
    .getByRole('list', { name: 'Facts it got' })
    .getByRole('listitem')
    .filter({ has: page.locator(`a[href$="/library/${NOTE}"]`) })
  await expect(got).toHaveCount(2, { timeout: 15_000 })
  await expect(got.first()).toContainText('Must get · given in')
  await expect(got.last()).toContainText('Must get · not given')
  await page.keyboard.press('Escape')
  await expect(focus).toHaveCount(0)

  // The item change between the two runs' editions: the note was given an end date.
  const changed = record(page).getByRole('list', { name: 'Changed facts' })
  await expect(changed).toContainText('Given before, not given now.', { timeout: 15_000 })
  await expect(changed).toContainText('From 9 Nov 2025 to 30 Sept 2026 (last day)')

  // Correction: suggest a change that puts the note back in service. First-time buyers in
  // its scope is Customer value's metric, whose domain warning would hold a low-risk change.
  await actions(page).getByRole('link', { name: 'Suggest a change' }).click()
  await expect(page).toHaveURL(new RegExp(`/library/${NOTE}/suggest`))
  await page.getByRole('button', { name: 'Remove First-time buyers' }).click()
  await page.getByRole('button', { name: 'Remove the end date' }).click()
  await page
    .getByRole('textbox', { name: 'What is wrong with the current version? (optional)' })
    .fill('It ended on 30 September, but net revenue still excludes test accounts.')
  await expect(page).toHaveURL(/draft=/, { timeout: 15_000 })
  await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute(
    'data-status',
    'saved',
    { timeout: 15_000 },
  )
  const draftId = new URL(page.url()).searchParams.get('draft')!

  // Back in Health, the question's Correction lists the open change and attaches the test to it.
  await page.goBack()
  await expect(record(page).getByRole('heading', { level: 2 })).toHaveText(TITLE)
  const open = actions(page).getByRole('list', { name: 'Open changes' })
  await expect(open).toContainText(NOTE_TITLE, { timeout: 15_000 })
  const attached = answer(page, 'POST', `/api/v1/proposals/${draftId}/tests`)
  await actions(page)
    .getByRole('button', { name: `Attach to ${NOTE_TITLE}` })
    .click()
  expect((await attached).ok()).toBe(true)
  await expect(
    actions(page).getByText(
      `Attached to ${NOTE_TITLE}. It shows with its checks, and never blocks it.`,
    ),
  ).toBeVisible()

  // The change: submit it, and its checks report the attached test with it.
  await open.getByRole('link', { name: NOTE_TITLE }).click()
  await expect(page).toHaveURL(new RegExp(`/proposals/${draftId}$`))
  await page.getByRole('button', { name: 'Continue editing' }).click()
  const submitted = answer(page, 'POST', `/api/v1/proposals/${draftId}/submit`)
  await page.getByRole('button', { name: 'Send for review' }).click()
  expect((await submitted).ok()).toBe(true)
  await expect(page).toHaveURL(new RegExp(`/proposals/${draftId}$`))
  const test_ = page.getByRole('list', { name: 'Attached tests' }).getByRole('listitem')
  await expect(test_).toContainText(TITLE, { timeout: 15_000 })
  await expect(test_).toContainText('It finds the fact with this change, not without it.')
  await expect(page.getByRole('region', { name: 'Attached tests' })).toContainText(
    'We report them, and they never block a decision.',
  )
  const levels = page.getByRole('list', { name: 'Checks' }).getByRole('listitem')
  await expect(levels).toHaveCount(3)
  await expect(levels.getByRole('img', { name: 'Passed' })).toHaveCount(3)

  // Review: a low-risk change whose checks pass, which its owner may accept (FR-206).
  const claimed = answer(page, 'POST', `/api/v1/proposals/${draftId}/claim`)
  await page.getByRole('button', { name: 'Claim', exact: true }).click()
  expect((await claimed).ok()).toBe(true)
  await expect(page.getByText('Claimed by you').first()).toBeVisible({ timeout: 15_000 })
  await page
    .getByRole('region', { name: 'Your decision' })
    .getByRole('button', { name: 'Accept', exact: true })
    .click()
  const accepting = page.getByRole('alertdialog', { name: 'Accept this change?' })
  await accepting
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('Test accounts are still left out of net revenue.')
  const decided = answer(page, 'POST', `/api/v1/proposals/${draftId}/decisions`)
  await accepting.getByRole('button', { name: 'Accept' }).click()
  const response = await decided
  expect(response.ok()).toBe(true)
  // The screen names no edition; the decision's answer says which one it made.
  const edition = ((await response.json()) as { edition: { label: string } }).edition.label
  await expect(accepting).toBeHidden({ timeout: 0 })
  await expect(page.getByText(/^(From then on, )?AI apps get it\.$/).first()).toBeVisible({
    timeout: 15_000,
  })
  expect(edition).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/)

  // The next edition: an agent asking the question now gets the note and its caveat.
  const given = await agentGets(TITLE)
  const note = given.find((item) => item.id === NOTE)
  expect(`${note?.title}: ${note?.summary}`).toContain('excludes test accounts')

  // The gap on the same scope: resolved with the new edition live, not yet verified by test.
  await page.goto(`/health?area=area_sales&open=gap:${GAP}`)
  await expect(strip(page)).toContainText('AI apps get the facts as of', { timeout: 15_000 })
  await expect(record(page).getByRole('heading', { name: 'Net revenue in Spain' })).toBeVisible()
  await expect(record(page).getByRole('list', { name: 'Linked tests' })).toContainText(TITLE)
  await actions(page).getByRole('button', { name: 'Mark resolved' }).click()
  const resolving = page.getByRole('alertdialog', { name: 'Mark this gap as resolved?' })
  await resolving
    .getByRole('textbox', { name: 'Why' })
    .fill('The note on net revenue and test accounts is back in service.')
  const resolved = answer(page, 'POST', `/api/v1/gaps/${GAP}/status`)
  await resolving.getByRole('button', { name: 'Mark resolved' }).click()
  expect((await resolved).ok()).toBe(true)
  await expect(resolving).toHaveCount(0, { timeout: 0 })
  await expect(fact(page, 'Resolved')).toHaveText(/^Marked resolved .+\.$/)
  await expect(fact(page, 'Checked by a test')).toHaveText(
    'Not yet. It waits for a weekly or full run to pass on what AI apps get since it was resolved. 0 of 1 linked test has passed.',
  )

  // Run Sales now: the worker asks every question of Sales on the new edition.
  await verification(page).getByRole('button', { name: 'Run Sales now' }).click()
  const running = page.getByRole('dialog', { name: 'Run Sales now?' })
  await expect(running.locator('[data-slot="run-estimate"]')).toContainText('question', {
    timeout: 15_000,
  })
  const started = answer(page, 'POST', '/api/v1/evals/areas/area_sales/runs')
  await running.getByRole('button', { name: 'Start the run' }).click()
  expect((await started).ok()).toBe(true)
  await expect(running).toHaveCount(0, { timeout: 0 })
  await expect
    .poll(
      async () => {
        const read = await context.request.get(`/api/v1/gaps/${GAP}`)
        return ((await read.json()) as { verifiedAt: string | null }).verifiedAt
      },
      { timeout: 420_000, intervals: [5_000] },
    )
    .not.toBeNull()

  // Verified by test, on the edition that resolved it, by the run that just finished.
  await page.reload()
  await expect(record(page).locator('[data-slot="verified-badge"]')).toHaveText(
    'Checked by a test',
    { timeout: 15_000 },
  )
  await expect(fact(page, 'Checked by a test')).toHaveText(/^Yes, by the full run of .+\.$/)
  await expect(record(page).getByRole('list', { name: 'Linked tests' })).toContainText('Passed ')
})
