import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, QUALITY_FAILED_TRY, QUALITY_WEEKLY_RUN, settle, themes, widths } from './support'

/*
  Health on the mock (Workbench plan, slices W4 to W7; the Workbench until the navigation
  decision of 12 October 2026, on the Workbench page template): the route behind the Quality
  audience, the three-pane template with its fold rules, the record pane and the scope strip, the
  domain overview with nothing open, the work list with its views, search and keys, the question,
  run and domain records with their tabs and the action panel, the gap and item records with
  theirs (the Gaps page's owner cases, ported), and the compare focus over a question's record,
  on the demo's regression (src/web/mocks/items.ts, `regression`). As Jon (owner of Sales
  and Sandbox), Ravi (administrator) and Maria (contributor, refused). Since slice W8 it is the
  sidebar's entry in the lower group for the people it is for, it has Quality's cases (ported from
  quality.spec.ts), and the old Workbench, Quality and owners' Gaps addresses land on its
  matching state. What a domain is, and editing it, is in domain-about.spec.ts.
*/

const [desktop, tablet, phone] = widths

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

const box = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect()
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
    })

const strip = (page: Page) => page.getByRole('toolbar', { name: 'Domain and runs' })
const pane = (page: Page) => page.locator('[data-slot="record-pane"]')
const actions = (page: Page) => page.getByRole('complementary', { name: 'Actions' })
const grid = (page: Page) => page.getByRole('table', { name: 'Domain health' })
const workList = (page: Page) => page.getByRole('region', { name: 'Work list' })
const rows = (page: Page) => workList(page).locator('[data-row-link]')
const listBody = (page: Page) => page.locator('[data-slot="workbench-list-body"]')
const views = (page: Page) => page.getByRole('navigation', { name: 'Work list views' })
const meta = (page: Page) => pane(page).locator('[data-slot="dock-meta"]')
const REGRESSION = 'How is net revenue in Spain doing this month?'

async function noSideways(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
  ).toBeLessThanOrEqual(0)
}

async function axe(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
    ),
  ).toEqual([])
}

test('a contributor is told whose page it is, and nothing of it is shown', async ({ page }) => {
  await signInAs(page, 'per_maria')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(page.getByText('Health is for owners and admins', { exact: true })).toBeVisible()
  await expect(strip(page)).toHaveCount(0)
  await expect(page.locator('[data-template="workbench"]')).toHaveCount(0)
})

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Main navigation' })

test('the sidebar offers it in the lower group in place of Quality and Gaps, and g then w goes there', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/', { ...desktop, theme: 'light' })
  await expect(sidebar(page).getByRole('link', { name: 'Health' })).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Quality' })).toHaveCount(0)
  await expect(sidebar(page).getByRole('link', { name: 'Gaps' })).toHaveCount(0)
  await page.locator('main').click({ position: { x: 900, y: 600 } })
  await page.keyboard.press('g')
  await page.keyboard.press('w')
  await expect(page).toHaveURL(/\/health$/)
  await expect(strip(page)).toBeVisible()
  await expect(sidebar(page).getByRole('link', { name: 'Health' })).toHaveAttribute(
    'aria-current',
    'page',
  )
})

const RUN_ID = QUALITY_WEEKLY_RUN
const EARLIER_RUN = '00000000-0000-4000-b000-000000000080'
const A_TRY = '00000000-0000-4000-b000-00000009002b'
const NORWAY_ID = 'ca9a0000-0000-4000-8000-000000000001'

/**
 * Every row of the plan's redirect table (Workbench plan, 3.3), and the Workbench's own old
 * address (navigation decision), followed in the browser.
 */
const redirects: { from: string; to: string; person: string }[] = [
  { from: '/workbench', to: '/health', person: 'per_jon' },
  {
    from: `/workbench?view=runs&open=run:${QUALITY_WEEKLY_RUN}&tab=changes`,
    to: `/health?view=runs&open=run:${QUALITY_WEEKLY_RUN}&tab=changes`,
    person: 'per_ravi',
  },
  { from: '/quality', to: '/health', person: 'per_jon' },
  {
    from: '/quality?area=area_sales',
    to: '/health?area=area_sales',
    person: 'per_jon',
  },
  {
    from: '/quality?view=questions&q=units sold&area=area_sales',
    to: '/health?area=area_sales&view=questions&q=units sold',
    person: 'per_jon',
  },
  { from: '/quality?view=runs', to: '/health?view=runs', person: 'per_ravi' },
  {
    from: '/quality?panel=domain:area_sales&tab=runs',
    to: '/health?open=domain:area_sales&tab=runs',
    person: 'per_jon',
  },
  {
    from: '/quality?view=questions&panel=question:units-sold-source-lag&tab=results',
    to: '/health?view=questions&open=question:units-sold-source-lag&tab=result',
    person: 'per_jon',
  },
  {
    from: '/quality?panel=question:units-sold-source-lag&tab=overview',
    to: '/health?open=question:units-sold-source-lag&tab=evidence',
    person: 'per_jon',
  },
  {
    from: `/quality?view=runs&panel=run:${RUN_ID}&tab=changes&against=${EARLIER_RUN}&cell=${A_TRY}`,
    to: `/health?view=runs&open=run:${RUN_ID}&tab=changes&against=${EARLIER_RUN}&cell=${A_TRY}`,
    person: 'per_ravi',
  },
  { from: '/evals?tab=evals', to: '/health', person: 'per_jon' },
  { from: '/gaps', to: '/health?view=gaps', person: 'per_jon' },
  {
    from: `/gaps?q=north&area=area_sales&status=open&type=missing&gap=${NORWAY_ID}`,
    to: `/health?view=gaps&q=north&area=area_sales&status=open&type=missing&open=gap:${NORWAY_ID}`,
    person: 'per_jon',
  },
  { from: '/gaps?origin=person', to: '/health?view=gaps&origin=person', person: 'per_ravi' },
  // The topic counts stay on the Gaps page, and everyone else keeps the Gaps page as it was.
  { from: '/gaps?view=topics', to: '/gaps?view=topics', person: 'per_jon' },
  { from: `/gaps?gap=${NORWAY_ID}`, to: `/gaps?gap=${NORWAY_ID}`, person: 'per_maria' },
  { from: '/gaps', to: '/gaps', person: 'per_lars' },
]

/** The address as a path and its params, in any order, with `:` written either way. */
function address(url: string) {
  const parsed = new URL(url, 'http://localhost')
  return {
    path: parsed.pathname,
    params: Object.fromEntries([...parsed.searchParams.entries()].sort()),
  }
}

for (const { from, to, person } of redirects)
  test(`${from} as ${person} lands on ${to}`, async ({ page }) => {
    await signInAs(page, person)
    await openPage(page, from, { ...desktop, theme: 'light' })
    await expect.poll(() => address(page.url())).toEqual(address(to))
    if (to.startsWith('/health')) await expect(strip(page)).toBeVisible()
    else await expect(page.getByRole('navigation', { name: 'Gap views' })).toBeVisible()
  })

test('Back from a redirected address does not return to the old one', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/', { ...desktop, theme: 'light' })
  await page.goto(`/gaps?gap=${NORWAY_ID}`)
  // A full page load waits for the roles, then redirects and loads Health's chunk: on a busy
  // machine that is more than the default five seconds.
  await expect(pane(page).getByRole('heading', { name: 'Orders in Norway' })).toBeVisible({
    timeout: 15_000,
  })
  await page.goBack()
  await expect(page).toHaveURL(/\/$/)
})

test('with nothing open, an owner sees the scope, the list pane and the domain overview', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(page).toHaveTitle('Health - Heed')
  await expect(strip(page).getByRole('combobox', { name: 'Domain' })).toHaveText(/All domains/)
  await expect(strip(page)).toContainText(/AI apps get the facts as of \d{1,2} \w{3,4} \d{4}/)
  // Read out as counts: "8 of 9", not "8/9", and each number with its own words. The demo's
  // regression (mocks/items.ts) fails one question in the newest weekly run and retrieval pass.
  await expect(strip(page).getByRole('list', { name: 'Results' })).toMatchAriaSnapshot(`
    - list "Results":
      - listitem: Right facts 8 of 9
      - listitem: Right answers 8 of 9
      - listitem: 1 got worse
  `)
  await expect(rows(page).first()).toContainText(REGRESSION)
  const overview = page.locator('[data-slot="workbench-overview"]')
  await expect(overview.getByRole('heading', { name: 'Your domains' })).toBeVisible()
  await expect(overview).toContainText('All domains · nothing open')
  await expect(page.locator('[data-slot="quality-verdict"]')).toContainText(
    'No clear change since last time: 0 questions got better and 1 got worse.',
  )
  await expect(grid(page).getByRole('rowheader')).toHaveText(['Sales', 'Sandbox'])
  // Nothing open: no record, no actions, and the sidebar stays expanded.
  await expect(pane(page)).toHaveCount(0)
  await expect(actions(page)).toHaveCount(0)
  expect((await box(page, '[data-slot="sidebar-gap"]')).right).toBe(256)
  await noSideways(page)
})

test('the overview of every domain shows how each AI app fared this week, small counts hidden', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  const apps = page.getByRole('table', { name: 'Tool calls this week per AI app' })
  // The demo's week (mocks/app-days.ts): most calls first, a count below 5 never shown.
  await expect(apps.getByRole('rowheader')).toHaveText([
    'Claude Code',
    'Built-in test runs',
    'Cursor',
    'ChatGPT',
    'Claude app',
  ])
  await expect(apps.locator('[data-app-family="claude_code"]')).toContainText('142')
  await expect(apps.locator('[data-app-family="cursor"]')).toContainText('11 (29%)')
  await expect(
    apps.locator('[data-app-family="claude_ai"] [data-slot="hidden-count"]'),
  ).toHaveCount(2)
  await expect(page.getByText('never by its own name or who used it')).toBeVisible()
  // A domain in scope: a request names no domain, so the apps are not shown there.
  await openPage(page, '/health?area=area_sales', { ...desktop, theme: 'light' })
  await expect(page.locator('[data-slot="quality-verdict"]')).toBeVisible()
  await expect(apps).toHaveCount(0)
})

test('an owner of one domain sees the AI apps on the overview of the only domain they look after', async ({
  page,
}) => {
  await signInAs(page, 'per_tomas')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(page.locator('[data-slot="quality-verdict"]')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Tool calls this week per AI app' })).toBeVisible()
})

test('the page stays put and each pane scrolls on its own', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await page.setViewportSize({ width: desktop.width, height: 480 })
  await openPage(page, '/health', { width: desktop.width, height: 480, theme: 'light' })
  await expect(grid(page)).toBeVisible()
  const sizes = await page.evaluate(() => ({
    document: document.documentElement.scrollHeight,
    window: window.innerHeight,
  }))
  expect(sizes.document).toBe(sizes.window)
  const overview = page.locator('[data-slot="workbench-overview"]')
  const scrolls = await overview.evaluate((element) => element.scrollHeight > element.clientHeight)
  expect(scrolls).toBe(true)
  await overview.evaluate((element) => element.scrollTo({ top: 200 }))
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await overview.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})

test('one domain in scope compares its newest run with the run before, or a chosen one', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/health?area=area_sales', { ...desktop, theme: 'light' })
  const compared = strip(page).getByRole('combobox', { name: 'Compared with' })
  await expect(compared).toContainText('Weekly run, 28 Sept 2026')
  // The demo's regression fails one question in the newest run, against any earlier run.
  const verdict = page.locator('[data-slot="quality-verdict"]')
  await expect(verdict).toContainText('0 questions got better and 1 got worse')
  await expect(verdict).toContainText('across 1 domain')
  await compared.click()
  await page.getByRole('option', { name: /Weekly run, 21 Sept 2026/ }).click()
  await expect(page).toHaveURL(/against=[0-9a-f-]{36}/)
  await expect(compared).toContainText('Weekly run, 21 Sept 2026')
  await expect(verdict).toContainText('0 questions got better and 1 got worse')
  // Another domain starts again from its own runs.
  await strip(page).getByRole('combobox', { name: 'Domain' }).click()
  await page.getByRole('option', { name: 'Marketing' }).click()
  await expect(page).toHaveURL(/area=area_marketing/)
  await expect(page).not.toHaveURL(/against=/)
})

test('a domain without test questions says so, with the way to them', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/health?area=area_marketing', { ...desktop, theme: 'light' })
  await expect(strip(page)).toContainText('No test questions yet.')
  await expect(strip(page).getByRole('link', { name: 'Test questions' })).toHaveAttribute(
    'href',
    '/health?area=area_marketing&open=domain%3Aarea_marketing&tab=questions',
  )
  await expect(strip(page).getByRole('combobox', { name: 'Compared with' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Write the first test question' })).toBeVisible()
})

test('a domain opens as a record beside the list, folds the sidebar, and Escape closes it', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await grid(page).getByRole('link', { name: 'Sales, open' }).click()
  await expect(page).toHaveURL(/open=domain(%3A|:)area_sales/)
  await expect(pane(page).getByRole('heading', { name: 'Sales', exact: true })).toBeVisible()
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Overview')
  await expect.poll(async () => (await box(page, '[data-slot="sidebar-gap"]')).right).toBe(48)

  // Three panes: the list (316), the record, the actions (280) to the window's edge.
  const list = await box(page, '[data-slot="workbench-list"]')
  const record = await box(page, '[data-slot="record-pane"]')
  const side = await box(page, '[data-slot="record-actions"]')
  expect(list.left).toBe(48)
  expect(list.right - list.left).toBe(316)
  expect(record.left).toBe(list.right)
  expect(side.left).toBe(record.right)
  expect(side.right).toBe(desktop.width)
  expect(side.right - side.left).toBe(280)
  expect(side.top).toBe(record.top)

  await pane(page).getByRole('tab', { name: 'Runs' }).click()
  await expect(page).toHaveURL(/tab=runs/)
  await pane(page).getByRole('tab', { name: 'Overview' }).click()
  await expect(page).not.toHaveURL(/tab=/)

  await pane(page).getByRole('tab', { name: 'Overview' }).press('Escape')
  await expect(page).not.toHaveURL(/open=/)
  await expect(pane(page)).toHaveCount(0)
  await expect.poll(async () => (await box(page, '[data-slot="sidebar-gap"]')).right).toBe(256)
  await noSideways(page)
})

test("a tab the record does not have falls back to the record's first", async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?open=question:units-sold-source-lag&tab=changes', {
    ...desktop,
    theme: 'light',
  })
  await expect(
    pane(page).getByRole('heading', { name: 'Is yesterday’s count of units sold complete?' }),
  ).toBeVisible()
  await expect(pane(page).getByRole('tab')).toHaveText(['Checks', 'Test result', 'History'])
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Checks')
  await expect(pane(page).getByRole('list', { name: 'Checks' })).toBeVisible()
})

const REGRESSED = '/health?open=question:net-revenue-month-to-date'
const checks = (page: Page) => pane(page).getByRole('list', { name: 'Checks' })

test('the regressed question: its checks on both editions, what Heed gave it, and why', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?open=domain:area_sales&tab=questions', {
    ...desktop,
    theme: 'light',
  })
  await pane(page)
    .getByRole('link', { name: 'How is net revenue in Spain doing this month?' })
    .click()
  await expect(page).toHaveURL(/open=question(%3A|:)net-revenue-month-to-date/)
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Checks')
  await expect(pane(page).locator('[data-slot="got-worse"]')).toHaveText('Got worse')
  await expect(pane(page).locator('[data-slot="fixture"]')).toContainText(
    'Nobody asked it for real.',
  )
  await expect(pane(page).locator('[data-slot="fixture"]')).toContainText(
    'Read from the weekly run of 5 Oct 2026, against the weekly run of 28 Sept 2026.',
  )

  // Each check on the newest weekly run, beside the run before it.
  await expect(checks(page).getByRole('listitem')).toHaveText([
    /Right facts\s*Fail\s*Failed: expected facts given\s*Before: passed/,
    /Expected facts given\s*Fail\s*0 of 6 tries\s*Before: 6 of 6 tries/,
    /Wrong facts kept out\s*Pass\s*6 of 6 tries/,
    /Fact cited\s*Pass/,
    /Fact mentioned\s*Fail\s*0 of 6 tries\s*Before: 6 of 6 tries/,
    /No cause claimed\s*Pass/,
  ])

  // The note the question expects was given before and not now.
  const delivered = pane(page).locator('[data-slot="delivered"]')
  await expect(delivered.getByRole('columnheader')).toHaveText([
    'Fact',
    '28 Sept 2026',
    '5 Oct 2026',
  ])
  await expect(delivered.getByRole('row').nth(1)).toHaveText(
    /Net revenue excludes test accounts\s*Must get · changed between the runs\s*Given in 6 of 6\s*Not given/,
  )

  // What changed in that note between the two editions: the diff kit's card.
  const changes = pane(page).getByRole('list', { name: 'Changed facts' })
  await expect(changes).toContainText('Must get. Given before, not given now.')
  const card = changes.getByRole('article', { name: 'Net revenue excludes test accounts' })
  await expect(card).toContainText('Changed')
  await expect(card).toContainText('Version 1 to 2')
  await expect(card).toContainText('30 Sept 2026')

  // The open gap on the same scope, with its anonymous counts: nothing from 1 to 4 is printed.
  const gaps = pane(page).getByRole('list', { name: 'Gaps on this topic' })
  await expect(gaps.locator('[data-slot="scope-gap"]')).toHaveCount(1)
  await expect(gaps).toContainText('Net revenue in Spain')
  await expect(gaps).toContainText('Fewer than 5')
  for (const cell of await gaps.getByRole('cell').allTextContents())
    expect(cell.trim()).not.toMatch(/^[1-4]$/)

  // The actions beside it: its test, and the correction of the note.
  await expect(actions(page).getByRole('heading', { level: 2 })).toHaveText(['Test', 'Correction'])
  await expect(actions(page).getByRole('link', { name: 'Suggest a change' })).toHaveAttribute(
    'href',
    '/library/itm_q2upr28v/suggest',
  )
  await expect(actions(page).getByRole('button', { name: 'Run Sales' })).toBeVisible()
  await noSideways(page)
})

test('the work list opens the regressed question from Got worse, with its evidence', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?view=worse', { ...desktop, theme: 'light' })
  await rows(page).first().click()
  await expect(page).toHaveURL(/open=question(%3A|:)net-revenue-month-to-date/)
  await expect(meta(page)).toHaveText('Test question · 1 of 1')
  await expect(pane(page).locator('[data-slot="got-worse"]')).toBeVisible()
  await expect(checks(page)).toBeVisible()
  await expect(actions(page).getByRole('heading', { level: 2 })).toHaveText(['Test', 'Correction'])
})

test('its test result: each try by wording and edition, a transcript in place, the judge', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, REGRESSED, { ...desktop, theme: 'light' })
  await pane(page).getByRole('tab', { name: 'Test result' }).click()
  await expect(page).toHaveURL(/tab=result/)
  await expect(pane(page).locator('[data-slot="only-edition"]')).toHaveText('Only the facts differ')
  const tries = pane(page).locator('[data-slot="tries"]')
  await expect(tries.getByRole('list', { name: 'Tries on 5 Oct 2026' })).toHaveCount(2)
  await expect(tries.getByRole('link', { name: /try 1 on 5 Oct 2026: failed/ })).toHaveCount(2)
  await expect(tries.getByRole('link', { name: /on 28 Sept 2026: passed/ })).toHaveCount(6)
  await expect(
    pane(page).getByRole('list', { name: 'Mentioned' }).getByRole('listitem'),
  ).toHaveText([
    /28 Sept 2026\s*Pass\s*mentioned in 6 of 6 tries/,
    /5 Oct 2026\s*Fail\s*mentioned in 0 of 6 tries/,
  ])
  await expect(pane(page).locator('[data-slot="answer"]').first()).toContainText(
    'Judge: The answer leaves out the expected caveat',
  )

  // A try opens its transcript in the same tab; the address keeps it, and back returns.
  await tries
    .getByRole('link', {
      name: 'Natural wording, try 1 on 5 Oct 2026: failed. Open its transcript',
    })
    .click()
  await expect(page).toHaveURL(new RegExp(`cell=${QUALITY_FAILED_TRY}`))
  const transcript = pane(page).locator('[data-slot="transcript"]')
  await expect(transcript).toContainText('Calls get_context')
  await page.reload()
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Test result')
  await expect(transcript).toContainText('Calls get_context')
  await transcript.getByRole('button', { name: 'All results' }).click()
  await expect(page).not.toHaveURL(/cell=/)
  await expect(tries).toBeVisible()

  // The two runs side by side, question by question, as the run's changes.
  await pane(page).getByRole('link', { name: 'Every question in the two runs' }).click()
  await expect(page).toHaveURL(new RegExp(`open=run(%3A|:)${QUALITY_WEEKLY_RUN}`))
  await expect(page).toHaveURL(/tab=changes/)
  await expect(pane(page).getByRole('heading', { name: 'Weekly run, 5 Oct 2026' })).toBeVisible()
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Changes')
  await expect(pane(page)).toContainText('0 better, 1 worse.')
})

test('its history: the runs, the retrieval pass that changed, and the edition that changed it', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, `${REGRESSED}&tab=history`, { ...desktop, theme: 'light' })
  const history = pane(page).getByRole('list', { name: 'History' })
  await expect(history.getByRole('listitem').nth(0)).toContainText('Right facts check')
  await expect(history.getByRole('listitem').nth(1)).toContainText('Weekly run')
  await expect(history.getByRole('listitem').nth(1)).toContainText('Fails')
  await expect(history.getByRole('listitem').nth(2)).toContainText(
    'Right facts check, starts failing',
  )
  await expect(history.getByRole('listitem').nth(3)).toContainText(
    'ChangedNet revenue excludes test accounts',
  )
  await expect(history.getByRole('listitem').nth(3)).toContainText('Version 1 to 2')
  await expect(history.getByRole('listitem').nth(4)).toContainText('Passes')
  // A run opens as its own record.
  await history.getByRole('link', { name: 'Weekly run' }).first().click()
  await expect(page).toHaveURL(new RegExp(`open=run(%3A|:)${QUALITY_WEEKLY_RUN}`))
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Summary')
})

const focus = (page: Page) => page.locator('[data-slot="compare-focus"]')
const row = (page: Page, name: string) => focus(page).getByRole('region', { name, exact: true })
const side = (page: Page, name: string, which: 'baseline' | 'candidate') =>
  row(page, name).locator(`[data-side="${which}"]`)
const tries = (page: Page, name: string, which: 'baseline' | 'candidate') =>
  side(page, name, which)
    .getByRole('list', { name: /natural wording/ })
    .getByRole('listitem')
/** Sales's weekly run of 31 Aug 2026, judged by the judge the mock replaced on 1 Sept. */
const EARLIER_JUDGE_RUN = '00000000-0000-4000-b000-00000000008b'

test('Shift C compares the two runs side by side, and Escape returns to the same row', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await rows(page).first().click()
  await expect(page).toHaveURL(/open=question(%3A|:)net-revenue-month-to-date/)
  await expect(pane(page).locator('[data-slot="got-worse"]')).toBeVisible()
  // The list scrolled away from the open row, as the design's check had it.
  await listBody(page).evaluate((element) => element.scrollTo({ top: 150 }))
  expect(await listBody(page).evaluate((element) => element.scrollTop)).toBe(150)

  await page.keyboard.press('Shift+C')
  await expect(page).toHaveURL(/mode=compare/)
  // Shift C is not C: no Add a fact form opens.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(focus(page)).toBeFocused()
  await expect(focus(page).getByRole('heading', { level: 2 })).toHaveText(REGRESSION)
  await expect(focus(page).locator('[data-slot="only-edition"]')).toHaveText(
    'Only the facts differ',
  )
  // The record widens over the list and the actions, which stay underneath, out of reach.
  expect(await box(page, '[data-slot="compare-focus"]')).toEqual(
    await box(page, '[data-slot="workbench-panes"]'),
  )
  for (const under of ['[data-slot="workbench-list"]', '[data-slot="record-workspace"]'])
    expect(
      await page.locator(under).evaluate((element) => element.closest('[inert]') !== null),
    ).toBe(true)

  // The two sides, row by row: the run, the tries, the checks, the caveat, what Heed gave the
  // test, the first try's answer and the judge.
  await expect(focus(page).getByRole('heading', { level: 3 })).toHaveText([
    'Run',
    'Tries',
    'Checks',
    'Mentions what it must',
    'Facts it got',
    'Answer, try 1',
    'Judge',
  ])
  await expect(side(page, 'Run', 'baseline')).toContainText('Passes')
  await expect(side(page, 'Run', 'baseline')).toContainText('Weekly run, 28 Sept 2026')
  await expect(side(page, 'Run', 'candidate')).toContainText('Fails')
  await expect(side(page, 'Run', 'candidate')).toContainText('Weekly run, 5 Oct 2026')
  await expect(tries(page, 'Tries', 'baseline')).toHaveText([
    'Try 1: passed',
    'Try 2: passed',
    'Try 3: passed',
  ])
  await expect(tries(page, 'Tries', 'candidate')).toHaveText([
    'Try 1: failed',
    'Try 2: failed',
    'Try 3: failed',
  ])
  await expect(tries(page, 'Mentions what it must', 'baseline')).toHaveText([
    'Try 1: mentioned',
    'Try 2: mentioned',
    'Try 3: mentioned',
  ])
  await expect(tries(page, 'Mentions what it must', 'candidate')).toHaveText([
    'Try 1: missing',
    'Try 2: missing',
    'Try 3: missing',
  ])
  await expect(side(page, 'Checks', 'baseline')).toContainText(
    /Fact mentioned\s*Pass\s*6 of 6 tries/,
  )
  await expect(side(page, 'Checks', 'candidate')).toContainText(
    /Fact mentioned\s*Fail\s*0 of 6 tries/,
  )
  await expect(side(page, 'Facts it got', 'baseline')).toContainText(
    /Net revenue excludes test accounts\s*Must get · given in 6 of 6/,
  )
  await expect(side(page, 'Facts it got', 'candidate')).toContainText(
    /Net revenue excludes test accounts\s*Must get · not given/,
  )
  await expect(side(page, 'Judge', 'candidate')).toContainText(
    'The answer leaves out the expected caveat',
  )
  // Every cell says which side it is: to a screen reader here, and to the eye when stacked.
  await expect(side(page, 'Answer, try 1', 'baseline')).toContainText('Earlier run · 28 Sept 2026')
  await expect(side(page, 'Answer, try 1', 'candidate')).toContainText('Newer run · 5 Oct 2026')

  // The list rests while the focus is open; Escape leaves the focus first.
  await page.keyboard.press('j')
  await expect(page).toHaveURL(/open=question(%3A|:)net-revenue-month-to-date/)
  await page.keyboard.press('Escape')
  await expect(focus(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(/mode=compare/)
  await expect(page).toHaveURL(/open=question(%3A|:)net-revenue-month-to-date/)
  await expect(pane(page)).toBeVisible()
  await expect(rows(page).first()).toBeFocused()
  expect(await listBody(page).evaluate((element) => element.scrollTop)).toBe(150)
  // A second Escape closes the record, as before.
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/open=/)
})

test('the Compare button opens the focus, and Leave compare and Back return to the record', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, `${REGRESSED}&tab=result`, { ...desktop, theme: 'light' })
  const open = pane(page).getByRole('button', { name: 'Compare', exact: true })
  await expect(open).toHaveAttribute('aria-keyshortcuts', 'Shift+C')
  await open.click()
  await expect(page).toHaveURL(/mode=compare/)
  await focus(page)
    .getByRole('button', { name: /Leave compare/ })
    .click()
  await expect(focus(page)).toHaveCount(0)
  await expect(page).not.toHaveURL(/mode=compare/)
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Test result')
  await expect(open).toBeFocused()

  // From the Test result tab too; the browser's Back leaves the focus.
  const sideBySide = pane(page).getByRole('button', { name: 'Compare side by side' })
  await sideBySide.click()
  await expect(focus(page)).toBeVisible()
  await page.goBack()
  await expect(focus(page)).toHaveCount(0)
  await expect(page).toHaveURL(/tab=result/)
  await expect(sideBySide).toBeFocused()

  // The address keeps the focus: a reload opens on the two runs, and Escape still leaves.
  await page.goForward()
  await expect(page).toHaveURL(/mode=compare/)
  await page.reload()
  await expect(row(page, 'Judge')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(focus(page)).toHaveCount(0)
  await expect(pane(page)).toBeVisible()
})

test('compared with a run another judge scored, the focus says it is not only the edition', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, `${REGRESSED}&area=area_sales&against=${EARLIER_JUDGE_RUN}&mode=compare`, {
    ...desktop,
    theme: 'light',
  })
  const confounded = focus(page).locator('[data-slot="confounded"]')
  await expect(confounded).toContainText('Not only the facts')
  await expect(confounded).toContainText('Also different: the judge.')
  await expect(focus(page).locator('[data-slot="only-edition"]')).toHaveCount(0)
  await expect(side(page, 'Run', 'baseline')).toContainText(
    'Judged by mock-scripted-judge-earlier (differs)',
  )
  await expect(side(page, 'Run', 'candidate')).toContainText(
    'Judged by mock-scripted-judge (differs)',
  )
  await expect(side(page, 'Run', 'baseline')).toContainText('Weekly run, 31 Aug 2026')
})

test("1, 2 and 3 show the open record's tabs, and rest while comparing", async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, REGRESSED, { ...desktop, theme: 'light' })
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Checks')
  // The keys are the list's: they act once its rows are there.
  await expect(rows(page).first()).toBeVisible()
  await page.keyboard.press('2')
  await expect(page).toHaveURL(/tab=result/)
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Test result')
  await page.keyboard.press('3')
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('History')
  await page.keyboard.press('1')
  await expect(page).not.toHaveURL(/tab=/)
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Checks')
  await page.keyboard.press('Shift+C')
  await expect(focus(page)).toBeVisible()
  await page.keyboard.press('2')
  await expect(page).not.toHaveURL(/tab=/)
})

test('on a phone the two runs stack, each cell labelled, and the back arrow leaves', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, REGRESSED, { ...phone, theme: 'light' })
  const open = pane(page).getByRole('button', { name: 'Compare side by side' })
  expect((await open.boundingBox())!.height).toBe(44)
  await open.click()
  await expect(focus(page)).toBeVisible()
  await expect(pane(page)).toBeHidden()
  // One under the other, as wide as each other, each saying which side it is.
  const baseline = await side(page, 'Judge', 'baseline').boundingBox()
  const candidate = await side(page, 'Judge', 'candidate').boundingBox()
  expect(candidate!.y).toBeGreaterThanOrEqual(baseline!.y + baseline!.height)
  expect(candidate!.width).toBe(baseline!.width)
  await expect(
    side(page, 'Judge', 'baseline').getByText('Earlier run · 28 Sept 2026'),
  ).toBeVisible()
  await expect(side(page, 'Judge', 'candidate').getByText('Newer run · 5 Oct 2026')).toBeVisible()
  await noSideways(page)
  const back = focus(page).getByRole('button', { name: 'Leave compare' })
  expect((await back.boundingBox())!.height).toBe(44)
  await back.click()
  await expect(focus(page)).toHaveCount(0)
  await expect(pane(page)).toBeVisible()
  await expect(open).toBeFocused()
})

test('a run opens with its summary, changes and results, and its actions', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, `/health?open=run:${QUALITY_WEEKLY_RUN}&tab=results`, {
    ...desktop,
    theme: 'light',
  })
  await expect(pane(page).getByRole('tab')).toHaveText(['Summary', 'Changes', 'Results'])
  await expect(pane(page).getByRole('list', { name: 'Results' })).toBeVisible()
  await expect(actions(page).getByRole('heading', { level: 2 })).toHaveText(['Run'])
  await expect(actions(page)).toContainText('This run has ended.')
  // A question in its results opens in the record pane.
  await pane(page)
    .getByRole('link', { name: 'How is net revenue in Spain doing this month?' })
    .click()
  await expect(page).toHaveURL(/open=question(%3A|:)net-revenue-month-to-date/)
  await expect(pane(page).locator('[data-slot="got-worse"]')).toBeVisible()
})

test('an owner runs the domain from its record and lands on the new run', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?open=domain:area_sales', { ...desktop, theme: 'light' })
  await expect(actions(page).getByRole('heading', { level: 2 })).toHaveText(['Test'])
  await actions(page).getByRole('button', { name: 'Write a test question' }).click()
  await expect(page.getByRole('dialog', { name: 'Write a test question' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await actions(page).getByRole('button', { name: 'Run Sales' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.locator('[data-slot="run-estimate"]')).toBeVisible()
  await dialog.getByRole('button', { name: 'Start the run' }).click()
  await expect(page).toHaveURL(/open=run(%3A|:)[0-9a-f-]{36}/)
  await expect(pane(page).getByRole('heading', { level: 2 }).first()).toContainText('Full run')
})

test("a question's test actions open Quality's dialogs", async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, REGRESSED, { ...desktop, theme: 'light' })
  await actions(page).getByRole('button', { name: 'Set it aside' }).click()
  await expect(
    page.getByRole('alertdialog', { name: 'Set this test question aside?' }),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await actions(page).getByRole('button', { name: 'Edit the test question' }).click()
  await expect(page.getByRole('dialog', { name: 'Edit the test question' })).toBeVisible()
})

// ---- Quality's cases, ported (slice W8: the Quality page is retired) ----

for (const size of [desktop, tablet])
  test(`the assistant's ratings fit beside the launcher at ${size.name}px`, async ({ page }) => {
    await signInAs(page, 'per_ravi')
    await openPage(page, '/health', { ...size, theme: 'light' })
    const ratings = page.getByRole('table', {
      name: "The assistant's ratings this week, per domain",
    })
    await expect(ratings.getByRole('columnheader')).toHaveText([
      'Domain',
      'Good answer',
      'Something was wrong',
    ])
    await expect(ratings.getByRole('row').filter({ hasText: 'Sales' })).toContainText(
      'Fewer than 5',
    )
    await ratings.scrollIntoViewIfNeeded()
    // Each count ends left of the launcher, so no scroll position puts one under it, and none
    // is cut.
    const launcher = (await box(page, '[data-slot="assistant-launcher"]')).left
    const counts = await ratings.getByRole('cell').evaluateAll((cells) =>
      cells.map((cell) => {
        const text = cell.lastElementChild!
        return {
          right: text.getBoundingClientRect().right,
          cut: cell.scrollWidth > cell.clientWidth,
        }
      }),
    )
    expect(counts.length).toBeGreaterThan(0)
    for (const count of counts) {
      expect(count.right).toBeLessThan(launcher)
      expect(count.cut).toBe(false)
    }
    await noSideways(page)
  })

test('an administrator sees every domain, and choosing one narrows the scope to it', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(grid(page).getByRole('rowheader')).toHaveText([
    'Customer value',
    'Marketing',
    'Paid media',
    'Sales',
    'Sandbox',
  ])
  const sales = grid(page).getByRole('row').filter({ hasText: 'Sales' })
  await expect(sales.getByRole('cell').nth(0)).toHaveText('1 failing')
  await expect(sales.getByRole('cell').nth(3)).toHaveText('1 worse')
  await expect(grid(page).getByRole('row').filter({ hasText: 'Marketing' })).toContainText(
    'No test questions yet.',
  )
  await strip(page).getByRole('combobox', { name: 'Domain' }).click()
  await page.getByRole('option', { name: 'Sales' }).click()
  await expect(page).toHaveURL(/area=area_sales/)
  await expect(grid(page).getByRole('rowheader')).toHaveText(['Sales'])
  await expect(page.getByRole('group', { name: 'Test questions' }).getByRole('button')).toHaveText([
    'Write a test question',
    'Run Sales',
    'Import',
    'Export',
  ])
})

test('a first run says what to do in the overview and in every view', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'empty'))
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(page.locator('[data-slot="quality-verdict"]')).toContainText(
    'No weekly test run has finished yet',
  )
  await expect(grid(page).getByRole('row').filter({ hasText: 'Sales' })).toContainText(
    'No test questions yet',
  )
  await views(page)
    .getByRole('link', { name: /^Test questions/ })
    .click()
  await expect(workList(page).getByText('No test questions yet', { exact: true })).toBeVisible()
  await views(page).getByRole('link', { name: /^Runs/ }).click()
  await expect(workList(page).getByText('No runs yet', { exact: true })).toBeVisible()
})

test('an owner writes a test question from the overview, and it opens as a record', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?view=questions', { ...desktop, theme: 'light' })
  await expect(rows(page)).toHaveCount(9)
  await page
    .getByRole('group', { name: 'Test questions' })
    .getByRole('button', { name: 'Write a test question' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Write a test question' })
  await expect(dialog).toBeVisible()
  await settle(page)
  // Add the question with nothing filled: each missing field says what to do.
  await dialog.getByRole('button', { name: 'Add the question' }).click()
  await expect(dialog.getByText('Choose the domain the question tests.').last()).toBeVisible()
  await expect(dialog.getByText('Write the natural wording.').last()).toBeVisible()

  await dialog.getByRole('combobox', { name: 'Domain' }).click()
  await page.getByRole('option', { name: 'Sales' }).click()
  await dialog
    .getByRole('textbox', { name: 'As a person asks it' })
    .fill('Why did orders in the Netherlands fall last week?')
  await expect(dialog.getByRole('textbox', { name: 'Short name' })).toHaveValue(
    'why-did-orders-in-the-netherlands-fall-last-week',
  )
  await dialog
    .getByRole('textbox', { name: 'Precisely' })
    .fill('What explains orders in the Netherlands between 28 September and 4 October 2026?')
  await dialog.getByRole('textbox', { name: 'Where it comes from' }).fill('Sales, October 2026')
  await dialog.getByRole('button', { name: 'Add the question' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).toHaveURL(
    /open=question(%3A|:)why-did-orders-in-the-netherlands-fall-last-week/,
  )
  await expect(pane(page).getByRole('heading', { level: 2 })).toHaveText(
    'Why did orders in the Netherlands fall last week?',
  )
  // Its evidence ends with how it is asked, the page Quality's Question tab was.
  await expect(pane(page).getByRole('region', { name: 'How it is asked' })).toContainText(
    'What explains orders in the Netherlands between 28 September and 4 October 2026?',
  )
  await expect(rows(page)).toHaveCount(10)
})

test("a test question's evidence says how it is asked, what a good answer has and its details", async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?open=question:units-sold-source-lag', {
    ...desktop,
    theme: 'light',
  })
  await expect(pane(page).getByRole('region', { name: 'How it is asked' })).toContainText(
    'Precisely',
  )
  await expect(pane(page).getByRole('region', { name: 'What a good answer has' })).toContainText(
    'Must get',
  )
  await expect(pane(page).getByRole('region', { name: 'Details' })).toContainText(
    'units-sold-source-lag',
  )
})

test('an import is checked first and says which entry is wrong', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await page
    .getByRole('group', { name: 'Test questions' })
    .getByRole('button', { name: 'Import' })
    .click()
  const dialog = page.getByRole('dialog', { name: 'Import test questions' })
  await dialog.getByRole('textbox', { name: 'The questions' }).fill('- id: only-a-name\n')
  await dialog.getByRole('button', { name: 'Check' }).click()
  await expect(dialog.locator('[data-slot="import-report"]')).toContainText(
    '1 entry needs a fix first',
  )
  await expect(dialog.locator('[data-slot="import-report"]')).toContainText('Entry 1 (only-a-name)')
})

test('Export downloads the test questions of the domain in scope', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?area=area_sales', { ...desktop, theme: 'light' })
  const download = page.waitForEvent('download')
  await page
    .getByRole('group', { name: 'Test questions' })
    .getByRole('button', { name: 'Export' })
    .click()
  expect((await download).suggestedFilename()).toBe('test-questions-area_sales.yaml')
})

test('the Gaps view marks the gaps people reported, and links to the topic counts', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?view=gaps&origin=person', { ...desktop, theme: 'light' })
  // Return on ad spend has five reports from people, but Jon does not manage Paid media.
  await expect(rows(page)).toHaveText([/^Orders in Norway/, /^Returns in the United Kingdom/])
  await workList(page)
    .getByRole('link', { name: /^Returns in the United Kingdom/ })
    .click()
  await expect(pane(page).getByText('October 2026. A person reported it.')).toBeVisible()
  // Two reports, both from people: below five, so neither is printed.
  await expect(
    pane(page)
      .getByLabel('Details of the gap')
      .locator('[data-slot="field-row"]')
      .filter({ hasText: 'From people' }),
  ).toContainText('Fewer than 5')
  await workList(page).getByRole('link', { name: 'See what AI apps ask about, per week' }).click()
  await expect(page).toHaveURL(/\/gaps\?view=topics$/)
  await expect(page.getByRole('navigation', { name: 'Gap views' })).toBeVisible()
})

test('a record that is not there says so, without tabs or actions', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?open=question:no-such-question', { ...desktop, theme: 'light' })
  await expect(
    pane(page).getByRole('heading', { name: "This test question isn't available" }),
  ).toBeVisible()
  await expect(pane(page).getByRole('tab')).toHaveCount(0)
  await expect(actions(page)).toHaveCount(0)
})

test('at 1,024 the actions fold under the record, behind a hairline', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?open=domain:area_sales', { ...tablet, theme: 'light' })
  await expect(actions(page)).toBeVisible()
  // Both boxes at the same moment, once the record has finished growing as its parts load.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const record = document.querySelector('[data-slot="record-pane"]')!.getBoundingClientRect()
        const side = document.querySelector('[data-slot="record-actions"]')!.getBoundingClientRect()
        return {
          left: side.left - record.left,
          right: side.right - record.right,
          top: side.top - record.bottom,
        }
      }),
    )
    .toEqual({ left: 0, right: 0, top: 0 })
  expect(await actions(page).evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe(
    '1px',
  )
  // The record and its actions scroll together; the list keeps its place.
  expect((await box(page, '[data-slot="workbench-list"]')).right - 48).toBe(316)
  await noSideways(page)
})

test('on a phone the list comes first, and a record takes its place with a back arrow', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...phone, theme: 'light' })
  const list = page.getByRole('region', { name: 'Work list' })
  await expect(list).toBeVisible()
  expect((await box(page, '[data-slot="workbench-list"]')).bottom).toBeLessThanOrEqual(
    (await box(page, '[data-slot="workbench-overview"]')).top,
  )
  await noSideways(page)

  await grid(page).getByRole('link', { name: 'Sales, open' }).click()
  await expect(pane(page).getByRole('heading', { name: 'Sales', exact: true })).toBeVisible()
  await expect(list).toBeHidden()
  await expect(pane(page)).toBeFocused()
  // Its actions follow it, the full width.
  const record = await box(page, '[data-slot="record-pane"]')
  const side = await box(page, '[data-slot="record-actions"]')
  expect(side.top).toBe(record.bottom)
  expect(side.right - side.left).toBe(phone.width)
  await noSideways(page)

  const back = pane(page).getByRole('button', { name: 'Close' })
  expect((await back.boundingBox())!.height).toBe(44)
  await back.click()
  await expect(page).not.toHaveURL(/open=/)
  await expect(list).toBeVisible()
})

test('the work list ranks what needs the owner, grouped by why', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(rows(page).first()).toBeVisible()
  // The demo's regression first (Got worse, the comparison the strip counts), then the open
  // gaps, then upkeep: Fix next's order inside each group.
  await expect(workList(page).getByRole('heading', { level: 3 })).toHaveText([
    /^Got worse\s*1$/,
    /^Open gaps\s*4$/,
    /^Check date passed\s*\d+$/,
    /^No test question covers it\s*\d+$/,
  ])
  const first = workList(page).locator('[data-row-id]').first()
  await expect(first).toHaveAttribute('data-row-id', 'question:net-revenue-month-to-date')
  await expect(first).toContainText(REGRESSION)
  await expect(first.locator('[data-slot="work-status"]')).toHaveText('Got worse')
  await expect(first).toContainText('Failed: fact mentioned, expected facts given')
  // A gap shows its status and its counts through the privacy rule.
  const small = workList(page).locator('li', { hasText: 'Returns in the United Kingdom' })
  await expect(small).toContainText('fewer than 5 calls found nothing')
  for (const text of await rows(page).allTextContents())
    expect(text).not.toMatch(/(^|[^\d.,])[1-4] (calls?|reports?)\b/)
  await expect(workList(page)).toContainText(
    'We hide counts below 5, so nobody can tell who asked.',
  )
  // The totals count what the strip counts.
  await expect(page.locator('[data-slot="work-list-totals"]')).toContainText('1 got worse')
  await expect(page.locator('[data-slot="work-list-totals"]')).toContainText('4 open gaps')
  // Rows are at least 40 high, the views and the search 28.
  expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(40)
  expect((await views(page).getByRole('link', { name: /^All/ }).boundingBox())!.height).toBe(28)
  await noSideways(page)
})

test('the views, the Gaps filters and the search narrow the list', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(rows(page).first()).toBeVisible()
  await expect(views(page).getByRole('link')).toHaveText([
    /^All\s*\d+$/,
    /^Got worse\s*1$/,
    /^Gaps\s*6$/,
    /^Upkeep\s*\d+$/,
    /^Test questions\s*9$/,
    /^Runs\s*\d+$/,
  ])

  await views(page)
    .getByRole('link', { name: /^Got worse/ })
    .click()
  await expect(page).toHaveURL(/view=worse/)
  await expect(views(page).getByRole('link', { name: /^Got worse/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(rows(page)).toHaveCount(1)

  await views(page).getByRole('link', { name: /^Gaps/ }).click()
  await expect(workList(page).getByRole('heading', { level: 3 })).toHaveText([
    /^Open\s*3$/,
    /^Draft started\s*1$/,
    /^Closed\s*2$/,
  ])
  await workList(page).getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('tab', { name: 'Status' }).click()
  await page.getByRole('checkbox', { name: 'Draft started' }).click()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/status=proposal_made/)
  await expect(rows(page)).toHaveText([/Units sold in Spain/])
  // Leaving the Gaps view leaves its filters behind.
  await views(page)
    .getByRole('link', { name: /^Test questions/ })
    .click()
  await expect(page).not.toHaveURL(/status=/)
  await expect(rows(page)).toHaveCount(9)
  await expect(workList(page).getByRole('heading', { level: 3 })).toHaveCount(0)

  // `/` searches; every word must match, and the search is in the address.
  await page.locator('main').click({ position: { x: 900, y: 600 } })
  await page.keyboard.press('/')
  const field = workList(page).getByRole('textbox', { name: 'Search the work list' })
  await expect(field).toBeFocused()
  await field.fill('units sold yesterday')
  await expect(page).toHaveURL(/q=units\+sold/)
  await expect(rows(page)).toHaveText([/Is yesterday’s count of units sold complete\?/])
  await field.fill('nothing like this')
  await expect(workList(page)).toContainText('Nothing matches')
  await workList(page).getByRole('button', { name: 'Clear search and filters' }).click()
  await expect(page).not.toHaveURL(/q=/)
  await expect(rows(page)).toHaveCount(9)
})

test('j, k, Enter and Escape walk the list, and the list keeps its place', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...desktop, theme: 'light' })
  await expect(rows(page).first()).toBeVisible()
  const total = await rows(page).count()

  await page.keyboard.press('j')
  await expect(rows(page).first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/open=question(%3A|:)net-revenue-month-to-date/)
  await expect(meta(page)).toHaveText(`Test question · 1 of ${total}`)
  await expect(workList(page).locator('[data-open]')).toHaveAttribute(
    'data-row-id',
    'question:net-revenue-month-to-date',
  )
  // With a record open, j and k open the row they land on.
  await rows(page).first().focus()
  await page.keyboard.press('j')
  await expect(meta(page)).toHaveText(`Gap · 2 of ${total}`)
  await expect(pane(page).getByRole('heading', { name: 'Orders in Norway' })).toBeVisible()
  await pane(page).getByRole('button', { name: 'Next' }).click()
  await expect(meta(page)).toHaveText(`Gap · 3 of ${total}`)
  await page.keyboard.press('k')
  await expect(meta(page)).toHaveText(`Gap · 2 of ${total}`)
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/open=/)
  await expect(rows(page).nth(1)).toBeFocused()

  // Opening and closing a record leaves the list where it was.
  await listBody(page).evaluate((element) => element.scrollTo({ top: 400 }))
  const row = rows(page).nth(12)
  // A click first scrolls a row that is only partly in view; measure after that.
  await row.scrollIntoViewIfNeeded()
  const top = await listBody(page).evaluate((element) => element.scrollTop)
  expect(top).toBeGreaterThan(0)
  await row.click()
  await expect(pane(page)).toBeVisible()
  expect(await listBody(page).evaluate((element) => element.scrollTop)).toBe(top)
  await pane(page).getByRole('button', { name: 'Close' }).click()
  await expect(pane(page)).toHaveCount(0)
  await expect(row).toBeFocused()
  expect(await listBody(page).evaluate((element) => element.scrollTop)).toBe(top)
})

test('a record opened from the list keeps its tab while stepping through questions', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?view=questions&open=question:units-sold-norway-august&tab=result', {
    ...desktop,
    theme: 'light',
  })
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Test result')
  await pane(page).getByRole('button', { name: 'Next' }).click()
  await expect(page).toHaveURL(/tab=result/)
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('Test result')
})

test('on a phone the rows are 56 high, and the back arrow returns to the row', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health', { ...phone, theme: 'light' })
  const row = workList(page).locator('[data-row-id]').nth(1)
  await expect(row).toBeVisible()
  expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(56)
  expect((await views(page).getByRole('link', { name: /^All/ }).boundingBox())!.height).toBe(44)
  await noSideways(page)
  await row.getByRole('link').click()
  await expect(workList(page)).toBeHidden()
  await expect(meta(page)).toContainText('Gap · 2 of')
  await pane(page).getByRole('button', { name: 'Close' }).click()
  await expect(workList(page)).toBeVisible()
  await expect(row.getByRole('link')).toBeFocused()
})

test('on a phone a question record is full screen, its tries are 44 pixel targets', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, `${REGRESSED}&tab=result`, { ...phone, theme: 'light' })
  await expect(page.getByRole('region', { name: 'Work list' })).toBeHidden()
  const attempt = pane(page).locator('[data-slot="try"]').first()
  expect((await attempt.boundingBox())!.height).toBe(44)
  expect((await attempt.boundingBox())!.width).toBe(44)
  const record = await box(page, '[data-slot="record-pane"]')
  const side = await box(page, '[data-slot="record-actions"]')
  expect(side.top).toBe(record.bottom)
  await noSideways(page)
  await pane(page).getByRole('tab', { name: 'Checks' }).click()
  await expect(checks(page)).toBeVisible()
  await noSideways(page)
})

const gapPath = (n: number) =>
  `/health?open=gap:ca9a0000-0000-4000-8000-${String(n).padStart(12, '0')}`
const NORWAY = gapPath(1)
const notes = (page: Page) => pane(page).getByRole('list', { name: 'Notes' })

test('a gap opens from the Gaps view with its evidence, its history and its actions', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?view=gaps', { ...desktop, theme: 'light' })
  await workList(page)
    .getByRole('link', { name: /^Orders in Norway/ })
    .click()
  await expect(page).toHaveURL(/open=gap(%3A|:)ca9a0000-0000-4000-8000-000000000001/)
  await expect(pane(page).getByRole('heading', { name: 'Orders in Norway' })).toBeVisible()
  await expect(meta(page)).toHaveText(/^Gap · \d+ of \d+$/)
  await expect(
    pane(page).getByRole('tablist', { name: 'Gap sections' }).getByRole('tab'),
  ).toHaveText(['Overview', 'History'])
  await expect(
    pane(page).getByRole('list', { name: "The metrics, names and month it's about" }),
  ).toHaveText(/Orders\s*Market\s*Norway\s*October 2026/)
  await expect(notes(page).getByRole('listitem')).toHaveCount(2)
  await expect(actions(page).getByRole('heading', { level: 2 })).toHaveText([
    'Gap',
    'Checked by a test',
    'Test',
    'Correction',
  ])
  await expect(actions(page).getByRole('button')).toHaveText([
    'Mark resolved',
    "Won't fix",
    '',
    'Link the test',
    'Write a test from this gap',
    'Start a draft',
  ])

  // The weekly counts' table: a count below the minimum is never printed.
  await pane(page).getByRole('tab', { name: 'Table' }).click()
  await expect(
    pane(page).getByRole('table', { name: 'Weekly counts of the gap' }).getByRole('row'),
  ).toHaveText([
    /Week of\s*Reports\s*From people\s*Found nothing/,
    /14 Sept 2026\s*0\s*0\s*6/,
    /21 Sept 2026\s*Fewer than 5\s*0\s*9/,
    /28 Sept 2026\s*Fewer than 5\s*0\s*14/,
    /5 Oct 2026\s*Fewer than 5\s*Fewer than 5\s*11/,
  ])
  const texts = await pane(page).locator('td, dd, [data-slot="field-value"]').allInnerTexts()
  expect(texts.filter((text) => /^[1-4]$/.test(text.trim()))).toEqual([])

  await pane(page).getByRole('tab', { name: 'History' }).click()
  await expect(page).toHaveURL(/tab=history/)
  await expect(pane(page).getByRole('list', { name: 'History' }).getByRole('listitem')).toHaveText([
    /6 Oct 2026\s*Last seen/,
    /14 Sept 2026\s*First seen\. AI apps asked and found nothing\./,
  ])
  // The tab stays with the next gap, and a reload keeps both.
  await page.keyboard.press('j')
  await expect(page).toHaveURL(/tab=history/)
  await page.reload()
  await expect(pane(page).getByRole('tab', { selected: true })).toHaveText('History')
})

test('an owner resolves a gap with a reason and adds a note in Health', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, NORWAY, { ...desktop, theme: 'light' })
  await pane(page).getByRole('textbox', { name: 'Add a note' }).fill('Write to maria@example.com')
  await pane(page).getByRole('button', { name: 'Add note' }).click()
  await expect(pane(page).getByText(/It looks like it holds/)).toBeVisible()
  await pane(page).getByRole('textbox', { name: 'Add a note' }).fill('Maria writes the event item.')
  await pane(page).getByRole('button', { name: 'Add note' }).click()
  await expect(notes(page).getByRole('listitem').last()).toContainText(
    /Owner note.*Maria writes the event item\./s,
  )

  await actions(page).getByRole('button', { name: 'Mark resolved' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Mark this gap as resolved?' })
  await confirm.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(confirm.getByText('Give a reason.')).toBeVisible()
  await confirm
    .getByRole('textbox', { name: 'Why' })
    .fill('The event item covers the August pause.')
  await confirm.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(confirm).toBeHidden()
  await expect(actions(page).getByRole('button', { name: 'Reopen' })).toBeVisible()
  await expect(pane(page).locator('[data-slot="gap-status-badge"]').first()).toHaveText('Resolved')
  // The list moves it to Closed, and its history says when it closed.
  await expect(workList(page).getByRole('link', { name: /^Orders in Norway/ })).toContainText(
    'Resolved',
  )
  await pane(page).getByRole('tab', { name: 'History' }).click()
  await expect(
    pane(page).getByRole('list', { name: 'History' }).getByRole('listitem').first(),
  ).toContainText('Marked resolved')
})

test('Start a draft hands the gap to the Add a fact form, and the draft shows back here', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, gapPath(7), { ...desktop, theme: 'light' })
  await expect(
    pane(page).getByRole('heading', { name: 'Repeat purchase rate in iOS' }),
  ).toBeVisible()
  await expect(actions(page).getByText('No draft from this gap yet.')).toBeVisible()
  await actions(page).getByRole('button', { name: 'Start a draft' }).click()
  await expect(page).toHaveURL(/\/library\/new\?draft=[a-f0-9-]+/)
  await expect(page.getByRole('button', { name: 'Remove Repeat purchase rate' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Platform iOS' })).toBeVisible()

  // Back in Health (in-app, so the mock keeps its world) the draft is the gap's.
  await page.goBack()
  await expect(pane(page).locator('[data-slot="gap-status-badge"]').first()).toHaveText(
    'Draft started',
  )
  await expect(actions(page).getByRole('list', { name: 'Drafts' })).toContainText('Untitled draft')
  await pane(page).getByRole('tab', { name: 'History' }).click()
  await expect(
    pane(page)
      .getByRole('list', { name: 'History' })
      .getByRole('listitem')
      .filter({ hasText: /Draft started:\s*Untitled draft/ }),
  ).toHaveCount(1)
})

test('a topic that spans domains asks for the domain before the draft', async ({ page }) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, gapPath(5), { ...desktop, theme: 'light' })
  await expect(pane(page).getByText('2 domains: Customer value, Marketing')).toBeVisible()
  await actions(page).getByRole('button', { name: 'Start a draft' }).click()
  await expect(
    actions(page).getByText('Choose the domain that should review the draft.'),
  ).toBeVisible()
  await actions(page).getByRole('combobox', { name: 'Domain for the draft' }).click()
  await page.getByRole('option', { name: 'Marketing' }).click()
  await actions(page).getByRole('button', { name: 'Start a draft' }).click()
  await expect(page).toHaveURL(/\/library\/new\?draft=/)
})

test("another domain's gap reads the same, without its status changes and notes", async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, gapPath(7), { ...desktop, theme: 'light' })
  await expect(
    pane(page).getByRole('heading', { name: 'Repeat purchase rate in iOS' }),
  ).toBeVisible()
  await expect(
    actions(page).getByText('Only the owners of Customer value and admins change where it stands.'),
  ).toBeVisible()
  await expect(actions(page).getByRole('button')).toHaveText(['Start a draft'])
  await expect(
    pane(page).getByText('Notes are for the owners of this domain and admins.'),
  ).toBeVisible()
  await expect(pane(page).getByRole('textbox', { name: 'Add a note' })).toHaveCount(0)
})

test('a gap that is not there says so, without tabs or actions', async ({ page }) => {
  await signInAs(page, 'per_jon')
  await openPage(page, gapPath(4040), { ...desktop, theme: 'light' })
  await expect(pane(page).getByRole('heading', { name: "This gap isn't available" })).toBeVisible()
  await expect(pane(page).getByRole('tab')).toHaveCount(0)
  await expect(actions(page)).toHaveCount(0)
})

/** Net revenue in Spain: the regression's gap, linked in the demo to its failing test. */
const REGRESSION_GAP = '/health?open=gap:ca9a0000-0000-4000-8000-00000000000a'
const UNITED_KINGDOM = 'Why are orders low in the United Kingdom this week?'
const verification = (page: Page) => actions(page).locator('[data-slot="gap-verification"]')
const fact = (page: Page, name: string) =>
  verification(page).locator('dt', { hasText: name }).locator('xpath=following-sibling::dd')
const linkedTests = (page: Page) => pane(page).getByRole('list', { name: 'Linked tests' })

type GapWorld = {
  as: (personId: string) => {
    linkGapTest: (input: object) => unknown
    setGapStatus: (input: object) => unknown
    startEvalRun: (input: object) => unknown
  }
}

/** Jon links a passing test to Orders in Norway, resolves it, and runs Sales. */
async function verifyNorway(page: Page) {
  await page.waitForFunction(() => 'heedMock' in window)
  await page.evaluate(() => {
    const jon = (window as unknown as { heedMock: GapWorld }).heedMock.as('per_jon')
    const id = 'ca9a0000-0000-4000-8000-000000000001'
    jon.linkGapTest({ id, question: 'orders-united-kingdom-september' })
    jon.setGapStatus({ id, status: 'resolved', reason: 'The event item covers it.' })
    jon.startEvalRun({ id: 'area_sales' })
  })
}

test('an owner links a test to a gap, resolves it, and a passing run verifies it', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, NORWAY, { ...desktop, theme: 'light' })
  await expect(actions(page).getByRole('heading', { level: 2 })).toHaveText([
    'Gap',
    'Checked by a test',
    'Test',
    'Correction',
  ])
  await expect(fact(page, 'Resolved')).toHaveText(
    'Not yet. An owner of Sales marks it resolved once AI apps get the fix.',
  )
  await expect(fact(page, 'Checked by a test')).toHaveText(
    "Not yet. Once it's resolved, a passing run of its linked tests checks it.",
  )
  await expect(pane(page).getByText('No test is linked yet.')).toBeVisible()

  // Link a test question of Sales, found by its words.
  const picker = actions(page).getByRole('combobox', { name: 'Link a test question' })
  await picker.fill('United Kingdom this week')
  await page.getByRole('option', { name: UNITED_KINGDOM }).click()
  await actions(page).getByRole('button', { name: 'Link the test' }).click()
  await expect(linkedTests(page).getByRole('listitem')).toHaveCount(1)
  const row = linkedTests(page).getByRole('listitem').first()
  await expect(row.getByRole('link', { name: UNITED_KINGDOM })).toBeVisible()
  await expect(row.locator('[data-slot="verdict"]')).toHaveText('Passes')
  await expect(row).toContainText('In the weekly run of 5 Oct 2026')
  await expect(fact(page, 'Checked by a test')).toHaveText(
    "Not yet. Once it's resolved, it counts as checked when its linked test passes.",
  )

  // Resolved records the live edition; the check waits for a passing run on it.
  await actions(page).getByRole('button', { name: 'Mark resolved' }).click()
  const confirm = page.getByRole('alertdialog', { name: 'Mark this gap as resolved?' })
  await expect(confirm).toContainText(
    'It counts as checked once its linked test passes on what AI apps get from today.',
  )
  await confirm.getByRole('textbox', { name: 'Why' }).fill('The event item covers it.')
  await confirm.getByRole('button', { name: 'Mark resolved' }).click()
  await expect(confirm).toBeHidden()
  await expect(fact(page, 'Resolved')).toHaveText('Marked resolved 7 Oct 2026.')
  await expect(fact(page, 'Checked by a test')).toHaveText(
    'Not yet. It waits for a weekly or full run to pass on what AI apps get since it was resolved. 0 of 1 linked test has passed.',
  )
  await expect(pane(page).locator('[data-slot="verified-badge"]')).toHaveCount(0)

  // Run the domain now: the record stays, and the run verifies it.
  await verification(page).getByRole('button', { name: 'Run Sales now' }).click()
  const running = page.getByRole('dialog', { name: 'Run Sales now?' })
  await expect(running.locator('[data-slot="run-estimate"]')).toContainText('question')
  await running.getByRole('button', { name: 'Start the run' }).click()
  await expect(running).toBeHidden()
  await expect(page).toHaveURL(/open=gap(%3A|:)ca9a0000-0000-4000-8000-000000000001/)
  await expect(pane(page).locator('[data-slot="verified-badge"]')).toHaveText('Checked by a test')
  await expect(fact(page, 'Resolved')).toContainText('Marked resolved 7 Oct 2026')
  await expect(fact(page, 'Checked by a test')).toHaveText('Yes, by the full run of 7 Oct 2026.')
  await expect(row).toContainText('Passed 7 Oct 2026.')
  await expect(verification(page).getByRole('button', { name: 'Run Sales now' })).toHaveCount(0)

  // Its history tells the lifecycle, newest first.
  await pane(page).getByRole('tab', { name: 'History' }).click()
  await expect(
    pane(page).getByRole('list', { name: 'History' }).getByRole('listitem').first(),
  ).toContainText('Its tests passed, by the full run of 7 Oct 2026')
  await expect(pane(page).getByRole('list', { name: 'History' })).toContainText(
    /Marked resolved\s*Resolved\s*Why: The event item covers it\./,
  )
  await expect(pane(page).getByRole('list', { name: 'History' })).toContainText(
    `Test linked: ${UNITED_KINGDOM}`,
  )

  // Unlinking keeps the verification already recorded.
  await pane(page).getByRole('tab', { name: 'Overview' }).click()
  await row.getByRole('button', { name: `Unlink ${UNITED_KINGDOM}` }).click()
  await expect(pane(page).getByText('No test is linked yet.')).toBeVisible()
  await expect(pane(page).locator('[data-slot="verified-badge"]')).toBeVisible()

  // Reopening clears it, and says so first.
  await actions(page).getByRole('button', { name: 'Reopen' }).click()
  const reopen = page.getByRole('alertdialog', { name: 'Reopen this gap?' })
  await expect(reopen).toContainText('It no longer counts as checked')
  await reopen.getByRole('textbox', { name: 'Why' }).fill('Agents still find nothing.')
  await reopen.getByRole('button', { name: 'Reopen' }).click()
  await expect(reopen).toBeHidden()
  await expect(pane(page).locator('[data-slot="verified-badge"]')).toHaveCount(0)
  await pane(page).getByRole('tab', { name: 'History' }).click()
  const steps = pane(page).getByRole('list', { name: 'History' }).getByRole('listitem')
  await expect(steps.first()).toContainText('No longer checked')
  await expect(steps.nth(1)).toContainText(/Open again\s*Open\s*Why: Agents still find nothing\./)
})

test('a test written from the gap takes its scope, is linked, and its record lists the gap', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, NORWAY, { ...desktop, theme: 'light' })
  await actions(page).getByRole('button', { name: 'Write a test from this gap' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write a test question' })
  await expect(dialog.locator('[data-slot="from-gap"]')).toContainText(
    'Written from a gap: Orders in Norway, October 2026',
  )
  // The gap gives the domain, the scope and where it comes from; never the wording.
  await expect(dialog.getByRole('combobox', { name: 'Domain' })).toBeDisabled()
  await expect(dialog.getByRole('combobox', { name: 'Domain' })).toHaveText(/Sales/)
  await expect(dialog.getByRole('textbox', { name: 'As a person asks it' })).toHaveValue('')
  await expect(dialog.getByRole('textbox', { name: 'Where it comes from' })).toHaveValue(
    'A gap: Orders in Norway, October 2026',
  )
  await dialog
    .getByRole('textbox', { name: 'As a person asks it' })
    .fill('Are orders in Norway complete this month?')
  await dialog
    .getByRole('textbox', { name: 'Precisely' })
    .fill('Are all orders for market Norway in October 2026 counted?')
  await dialog.getByRole('button', { name: 'Add the question' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText('The test question is added and linked to the gap')).toBeVisible()
  // The gap stays open, with the new test linked.
  await expect(page).toHaveURL(/open=gap(%3A|:)ca9a0000-0000-4000-8000-000000000001/)
  const row = linkedTests(page).getByRole('listitem').first()
  await expect(row).toContainText('Are orders in Norway complete this month?')
  await expect(row).toContainText('Not tested by a weekly or full run yet.')
  // Its record keeps the gap's scope, and lists the gap it verifies.
  await row.getByRole('link', { name: 'Are orders in Norway complete this month?' }).click()
  await expect(page).toHaveURL(/open=question(%3A|:)are-orders-in-norway-complete-this-month/)
  await expect(pane(page).getByRole('list', { name: 'Gaps on this topic' })).toContainText(
    'Orders in Norway',
  )
  const linked = pane(page).getByRole('list', { name: 'Linked gaps' })
  await expect(linked.getByRole('listitem')).toHaveText([/Orders in Norway\s*Open/])
  await linked.getByRole('link', { name: 'Orders in Norway' }).click()
  await expect(pane(page).getByRole('heading', { name: 'Orders in Norway' })).toBeVisible()
})

test("the regression's gap carries its failing test, and its question lists the gap", async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, REGRESSION_GAP, { ...desktop, theme: 'light' })
  const row = linkedTests(page).getByRole('listitem').first()
  await expect(row).toContainText(REGRESSION)
  await expect(row.locator('[data-slot="verdict"]')).toHaveText('Fails')
  // The test is linked, but the gap is open: it is verified once it is resolved and passes.
  await expect(fact(page, 'Checked by a test')).toHaveText(
    "Not yet. Once it's resolved, it counts as checked when its linked test passes.",
  )
  // Only the same domain's questions not linked yet are offered, those on the scope first.
  await actions(page).getByRole('combobox', { name: 'Link a test question' }).click()
  await expect(page.getByRole('option', { name: REGRESSION })).toHaveCount(0)
  await expect(page.locator('[data-slot="combobox-label"]')).toHaveText(['Test questions of Sales'])
  await page.keyboard.press('Escape')

  await row.getByRole('link', { name: REGRESSION }).click()
  await expect(pane(page).getByRole('list', { name: 'Linked gaps' })).toHaveText(
    /Net revenue in Spain\s*Open/,
  )
})

test("a draft from the regression's gap carries its test, the form reports it, and Health attaches it again", async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, REGRESSION_GAP, { ...desktop, theme: 'light' })
  await actions(page).getByRole('button', { name: 'Start a draft' }).click()
  await expect(page).toHaveURL(/\/library\/new\?draft=[a-f0-9-]+/)

  // The Add a fact form lists the gap's test under its checks, report-only, with Detach.
  const attached = page.locator('[data-slot="attached-tests"]')
  await expect(attached).toContainText('We report them, and they never block a decision.')
  const test = attached.getByRole('listitem')
  await expect(test).toHaveCount(1)
  await expect(test).toContainText(REGRESSION)
  await expect(test).toContainText("We check whether it finds the fact once it's sent.")
  await test.getByRole('button', { name: `Detach ${REGRESSION}` }).click()
  await expect(attached).toHaveCount(0)

  // Back in Health, its question's Correction attaches it to the gap's draft again.
  await page.goBack()
  await linkedTests(page).getByRole('link', { name: REGRESSION }).click()
  await expect(pane(page).getByRole('heading', { name: REGRESSION })).toBeVisible()
  await expect(actions(page).getByRole('list', { name: 'Drafts' })).toContainText('Untitled draft')
  await actions(page).getByRole('button', { name: 'Attach to Untitled draft' }).click()
  await expect(
    actions(page).getByText(
      'Attached to Untitled draft. It shows with its checks, and never blocks it.',
    ),
  ).toBeVisible()
  await expect(actions(page).getByRole('button', { name: 'Attach to Untitled draft' })).toHaveCount(
    0,
  )
  await axe(page)
})

test('a change suggested to the regressed note is offered to its test, which attaches to it', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, REGRESSED, { ...desktop, theme: 'light' })
  await expect(actions(page).getByRole('list', { name: 'Open changes' })).toHaveCount(0)
  await actions(page).getByRole('link', { name: 'Suggest a change' }).click()
  await expect(page).toHaveURL(/\/library\/itm_q2upr28v\/suggest/)
  await page
    .getByRole('textbox', { name: 'What is wrong with the current version? (optional)' })
    .fill('It ended on 30 September, but net revenue still excludes test accounts.')
  await expect(page).toHaveURL(/draft=/)

  // Back on the question, its Correction lists the open change to the note and attaches the test.
  await page.goBack()
  const open = actions(page).getByRole('list', { name: 'Open changes' })
  await expect(open.getByRole('listitem')).toHaveText([/Net revenue excludes test accounts/])
  await actions(page)
    .getByRole('button', { name: 'Attach to Net revenue excludes test accounts' })
    .click()
  await expect(
    actions(page).getByText(
      'Attached to Net revenue excludes test accounts. It shows with its checks, and never blocks it.',
    ),
  ).toBeVisible()
  await axe(page)

  // The change lists it under its checks, report-only.
  await open.getByRole('link', { name: 'Net revenue excludes test accounts' }).click()
  await expect(page.locator('[data-slot="attached-tests"]')).toContainText(REGRESSION)
})

test("another domain's gap shows where it stands, without its tests or their actions", async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, gapPath(7), { ...desktop, theme: 'light' })
  await expect(
    pane(page).getByRole('heading', { name: 'Repeat purchase rate in iOS' }),
  ).toBeVisible()
  await expect(
    pane(page).getByText('Only the owners of this domain and admins see which tests check it.'),
  ).toBeVisible()
  await expect(fact(page, 'Checked by a test')).toHaveText(
    "Not yet. Once it's resolved, a passing run of its linked tests checks it.",
  )
  await expect(
    actions(page).getByText('Only the owners of Customer value and admins link tests to it.'),
  ).toBeVisible()
  await expect(actions(page).getByRole('combobox', { name: 'Link a test question' })).toHaveCount(0)
})

test('a topic that spans domains links the tests of its domains, and says when they have none', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, gapPath(5), { ...desktop, theme: 'light' })
  await expect(
    actions(page).getByText('None of its domains has a test question yet.', { exact: true }),
  ).toBeVisible()
  await expect(pane(page).getByRole('list', { name: 'Linked tests' })).toHaveCount(0)
})

for (const theme of themes)
  for (const size of widths)
    test(`a verified gap: axe and no sideways scroll at ${size.name}px, ${theme}`, async ({
      page,
    }) => {
      await signInAs(page, 'per_jon')
      await openPage(page, '/health?view=gaps', { ...size, theme })
      await verifyNorway(page)
      await page.getByRole('link', { name: /^Orders in Norway/ }).click()
      await expect(pane(page).locator('[data-slot="verified-badge"]')).toBeVisible()
      await expect(linkedTests(page).getByRole('listitem')).toHaveCount(1)
      await axe(page)
      await noSideways(page)
      if (size.name === '390')
        for (const target of await actions(page).getByRole('button').all())
          expect((await target.boundingBox())!.height).toBe(44)
      await page.screenshot({
        path: test.info().outputPath(`verified-gap-${size.name}-${theme}.png`),
        fullPage: true,
      })
      await pane(page).getByRole('tab', { name: 'History' }).click()
      await expect(pane(page).locator('[data-slot="history"]')).toContainText('Its tests passed')
      await axe(page)
      await noSideways(page)
    })

test('an item from Upkeep: why it is listed, what changed, its details, and a test for it', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?view=upkeep', { ...desktop, theme: 'light' })
  const row = rows(page).first()
  const title = (await row.locator('[data-slot="work-title"]').innerText()).trim()
  await row.click()
  await expect(page).toHaveURL(/open=item(%3A|:)itm_/)
  await expect(pane(page).getByRole('heading', { name: title, level: 2 })).toBeVisible()
  await expect(meta(page)).toHaveText(/^Fact · 1 of \d+$/)
  await expect(pane(page).getByRole('tab')).toHaveCount(0)
  await expect(pane(page).locator('[data-slot="why-listed"]')).toContainText('Check date passed')
  await expect(pane(page).getByRole('region', { name: 'What changed' })).toContainText(
    'Between what AI apps got before and what they get today.',
  )
  await expect(pane(page).getByRole('definition').first()).toBeVisible()
  await expect(pane(page).getByRole('region', { name: 'Details' })).toContainText(/applies/i)
  await expect(actions(page).getByRole('heading', { level: 2 })).toHaveText(['Fact', 'Test'])
  await expect(actions(page).getByRole('link', { name: 'Open the fact' })).toHaveAttribute(
    'href',
    /^\/library\/itm_/,
  )
  await actions(page).getByRole('button', { name: 'Write a test question' }).click()
  const dialog = page.getByRole('dialog', { name: 'Write a test question' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(title)
})

test("the regression's note: its end date is what changed between the runs' editions", async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/health?area=area_sales&open=item:itm_q2upr28v', {
    ...desktop,
    theme: 'light',
  })
  await expect(
    pane(page).getByRole('heading', { name: 'Net revenue excludes test accounts' }),
  ).toBeVisible()
  const changed = pane(page).getByRole('region', { name: 'What changed' })
  await expect(changed).toContainText(
    /Changed\s*Version 1 to 2\.\s*Between the two runs the strip above compares\./,
  )
  await expect(
    changed.getByRole('article', { name: 'What changed in Net revenue excludes test accounts' }),
  ).toContainText(/From 9 Nov 2025, no end date.*From 9 Nov 2025 to 30 Sept 2026/s)
  // Nothing asks for a look at an ended note, and Jon may write a test for it.
  await expect(pane(page).getByRole('region', { name: "Why it's listed" })).toContainText(
    "The work list doesn't name it now",
  )
})

test('on a phone a gap record is full screen, and its actions follow it as 44 pixel targets', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, NORWAY, { ...phone, theme: 'light' })
  await expect(page.getByRole('region', { name: 'Work list' })).toBeHidden()
  await expect(pane(page).getByRole('heading', { name: 'Orders in Norway' })).toBeVisible()
  // Measured once the record and its actions have read what they show.
  await expect(pane(page).getByText('No test is linked yet.')).toBeVisible()
  await expect(verification(page)).toBeVisible()
  await expect(notes(page).getByRole('listitem')).toHaveCount(2)
  await settle(page)
  const record = await box(page, '[data-slot="record-pane"]')
  const side = await box(page, '[data-slot="record-actions"]')
  expect(side.top).toBe(record.bottom)
  for (const target of await actions(page).getByRole('button').all())
    expect((await target.boundingBox())!.height).toBe(44)
  expect((await actions(page).locator('[data-slot="to-proposals"]').boundingBox())!.height).toBe(44)
  await noSideways(page)
})

/** The states axe checks: the overview with the list, the open records, and the Gaps view. */
const axeStates = [
  {
    name: 'overview and work list',
    path: '/health?area=area_sales',
    ready: (page: Page) => page.locator('[data-slot="quality-verdict"]'),
  },
  {
    name: 'the overview of every domain, with the AI apps',
    path: '/health',
    ready: (page: Page) => page.locator('[data-app-family="claude_code"]'),
  },
  {
    name: 'an open record',
    path: '/health?open=question:units-sold-source-lag&tab=result',
    ready: (page: Page) => pane(page).getByRole('heading', { level: 2 }).first(),
  },
  ...(
    [
      ['evidence', '[data-slot="checks"]'],
      ['result', '[data-slot="tries"]'],
      ['history', '[data-slot="history"]'],
    ] as const
  ).map(([tab, slot]) => ({
    name: `the regressed question, ${tab}`,
    path: `${REGRESSED}&tab=${tab}`,
    ready: (page: Page) => pane(page).locator(slot),
  })),
  {
    name: 'the regressed question compared side by side',
    path: `${REGRESSED}&mode=compare`,
    ready: (page: Page) => page.locator('[data-slot="compare-judge"]'),
  },
  {
    name: 'a run, its changes',
    path: `/health?open=run:${QUALITY_WEEKLY_RUN}&tab=changes`,
    ready: (page: Page) => pane(page).getByText('0 better, 1 worse.'),
  },
  {
    name: 'a gap, its evidence',
    path: gapPath(2),
    ready: (page: Page) => pane(page).getByRole('list', { name: 'Notes' }),
  },
  {
    name: 'a gap with a linked failing test',
    path: REGRESSION_GAP,
    ready: (page: Page) => pane(page).getByRole('list', { name: 'Linked tests' }),
  },
  {
    name: 'a gap, its history',
    path: `${gapPath(2)}&tab=history`,
    ready: (page: Page) => pane(page).locator('[data-slot="history"]'),
  },
  {
    name: 'an item, its change',
    path: '/health?area=area_sales&open=item:itm_q2upr28v',
    ready: (page: Page) => pane(page).getByRole('article'),
  },
  {
    name: 'the Gaps view, filtered',
    path: '/health?view=gaps&status=open',
    ready: (page: Page) => rows(page).first(),
  },
] as const

for (const theme of themes)
  for (const size of widths)
    for (const state of axeStates)
      test(`axe and no sideways scroll at ${size.name}px, ${theme}: ${state.name}`, async ({
        page,
      }) => {
        await signInAs(page, 'per_ravi')
        await openPage(page, state.path, { ...size, theme })
        await expect(state.ready(page)).toBeVisible()
        // The list has its rows, though on a phone an open record hides it.
        await expect(
          page.locator('[data-slot="workbench-list"] [data-row-link]').first(),
        ).toBeAttached()
        await axe(page)
        await noSideways(page)
      })
