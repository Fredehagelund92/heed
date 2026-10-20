import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  The Gaps page on the mock (slice W9): the fixture gaps of src/web/mocks/gaps.ts, as Maria (no
  role) sees them. Since Workbench slice W8 the page is for everyone Health (the Workbench then)
  is not for: an owner's, deputy's or administrator's address lands in Health's Gaps view, where
  their cases are (health.spec.ts), and only the topic counts stay here for them. Each test gets its
  own world, so the steps never meet.
*/

const desktop = { ...widths[0], theme: 'light' } as const

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

const grid = (page: Page) => page.getByRole('table', { name: 'Gaps' })
const panelOf = (page: Page) => page.locator('[data-slot="dock-panel"]')

async function openGap(page: Page, topic: string) {
  await grid(page)
    .getByRole('link', { name: new RegExp(`^${topic},`) })
    .click()
  await expect(panelOf(page).getByRole('heading', { name: topic })).toBeVisible()
  await settle(page)
}

test('lists the gaps Maria may see by where each stands, never with a count below five', async ({
  page,
}) => {
  await openPage(page, '/gaps', desktop)
  await expect(grid(page).getByRole('rowheader')).toHaveText([
    /Open\s*5/,
    /Draft started\s*1/,
    /Closed\s*2/,
  ])
  await expect(page.getByRole('group', { name: 'Totals' })).toContainText(/8\s*gaps/)
  // Neither the gap nobody asked about five times nor the one below the minimum shows.
  await expect(grid(page).getByRole('link', { name: /Cost per acquisition|Returns/ })).toHaveCount(
    0,
  )

  const orders = grid(page).getByRole('row').filter({ hasText: 'Orders in Norway' })
  await expect(orders.getByRole('cell')).toHaveText([
    /Orders in Norway\s*Oct 2026/,
    'Missing',
    'Open',
    'Sales',
    'Hidden',
    '40',
  ])
  // At 1440 the 192 Domain column leaves Last seen no room: it leaves first.
  await expect(grid(page).getByRole('columnheader', { name: 'Last seen' })).toHaveCount(0)
  // The demo's regression: its first week (three calls) is below the minimum, so Maria sees only
  // the second.
  const netRevenue = grid(page).getByRole('row').filter({ hasText: 'Net revenue in Spain' })
  await expect(netRevenue.getByRole('cell').nth(5)).toHaveText('12')
  // No cell of the page prints a number from one to four.
  const counts = await grid(page).locator('[role="cell"].tabular-nums').allInnerTexts()
  expect(counts.filter((text) => /^[1-4]$/.test(text.trim()))).toEqual([])

  await page.getByRole('textbox', { name: 'Search topics' }).fill('spain')
  await expect(grid(page).getByRole('link')).toHaveText([
    'Net revenue in Spain',
    'Units sold in Spain',
  ])
  await expect(page).toHaveURL(/q=spain/)
  await page.getByRole('textbox', { name: 'Search topics' }).fill('')

  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('tab', { name: 'Type' }).click()
  await page.getByRole('checkbox', { name: 'Missing' }).click()
  await page.keyboard.press('Escape')
  await expect(grid(page).getByRole('link')).toHaveText([
    'Repeat purchase rate in iOS',
    'Net revenue in Spain',
    'Orders in Norway',
  ])
  await expect(page.locator('#gaps-count')).toHaveText(/3\s*of 8 gaps/)
  await expect(page).toHaveURL(/type=missing/)
  await page.getByRole('button', { name: 'Remove filter Type: Missing' }).click()
  await expect(grid(page).getByRole('link')).toHaveCount(8)
})

test('opens a gap in the docked panel with the weekly counts as a chart and as a table', async ({
  page,
}) => {
  await openPage(page, '/gaps', desktop)
  await openGap(page, 'Orders in Norway')
  await expect(page).toHaveURL(/gap=ca9a0000-0000-4000-8000-000000000001/)
  const panel = panelOf(page)
  await expect(
    panel.getByRole('list', { name: "The metrics, names and month it's about" }),
  ).toHaveText(/Orders\s*Market Norway\s*October 2026/)
  // Maria may start a draft, not triage the gap or read its notes.
  await expect(panel.getByRole('button', { name: 'Start a draft' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Mark resolved' })).toHaveCount(0)
  await expect(panel).toContainText('Notes are for the owners of this domain and admins.')

  const chart = panel.locator('[data-slot="weekly-chart"]')
  await expect(chart).toHaveAttribute('aria-hidden', 'true')
  // Every week's two labels; a hidden count has its "<5" and no bar. The order of the SVG
  // layers is Recharts' own, so the labels are compared as a set.
  await expect(chart.locator('.recharts-label-list text')).toHaveCount(8)
  expect((await chart.locator('.recharts-label-list text').allTextContents()).sort()).toEqual(
    ['0', '<5', '<5', '<5', '6', '9', '14', '11'].sort(),
  )
  await panel.getByRole('tab', { name: 'Table' }).click()
  const table = panel.getByRole('table', { name: 'Weekly counts of the gap' })
  await expect(table.getByRole('row')).toHaveText([
    /Week of\s*Reports\s*From people\s*Found nothing/,
    /14 Sept 2026\s*0\s*Hidden\s*6/,
    /21 Sept 2026\s*Fewer than 5\s*Hidden\s*9/,
    /28 Sept 2026\s*Fewer than 5\s*Hidden\s*14/,
    /5 Oct 2026\s*Fewer than 5\s*Hidden\s*11/,
  ])

  // Escape closes the panel, clears it from the address and puts focus back on its row.
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(page).not.toHaveURL(/gap=/)
  await expect(grid(page).getByRole('link', { name: /^Orders in Norway,/ })).toBeFocused()
})

type GapWorld = {
  as: (personId: string) => {
    linkGapTest: (input: object) => unknown
    setGapStatus: (input: object) => unknown
    startEvalRun: (input: object) => unknown
  }
}

for (const theme of themes)
  test(`shows Checked by a test beside the status, never which tests check it, ${theme}`, async ({
    page,
  }) => {
    await openPage(page, '/gaps', { ...widths[0], theme })
    // Jon, the owner, links a passing test, resolves the gap and runs Sales (Workbench V5).
    await page.waitForFunction(() => 'heedMock' in window)
    await page.evaluate(() => {
      const jon = (window as unknown as { heedMock: GapWorld }).heedMock.as('per_jon')
      const id = 'ca9a0000-0000-4000-8000-000000000001'
      jon.linkGapTest({ id, question: 'orders-united-kingdom-september' })
      jon.setGapStatus({ id, status: 'resolved', reason: 'The event item covers it.' })
      jon.startEvalRun({ id: 'area_sales' })
    })
    await openGap(page, 'Orders in Norway')
    const badges = panelOf(page).locator(
      '[data-slot="gap-status-badge"], [data-slot="verified-badge"]',
    )
    await expect(badges.first()).toHaveText('Resolved')
    await expect(badges.nth(1)).toHaveText('Checked by a test')
    await expect(badges.nth(1)).toHaveAttribute('title', 'Checked 7 October 2026')
    await expect(panelOf(page)).not.toContainText('orders low in the United Kingdom')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations.map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`,
      ),
    ).toEqual([])
  })

test('starts a draft from a gap and hands it to the Add a fact form', async ({ page }) => {
  await openPage(page, '/gaps', desktop)
  await openGap(page, 'Repeat purchase rate in iOS')
  await panelOf(page).getByRole('button', { name: 'Start a draft' }).click()
  await expect(page).toHaveURL(/\/library\/new\?draft=[a-f0-9-]+&asked=2026-10/)
  // Where it applies holds the topic's metric and value. The month is when people asked, not
  // when the fact applies: the dates stay empty, and the month is a hint beside them.
  await expect(page.getByRole('button', { name: 'Remove Repeat purchase rate' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Platform iOS' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'From', exact: true })).toHaveValue('')
  await expect(page.getByText('People asked about October 2026.', { exact: false })).toBeVisible()

  // The gap now has its draft (in-app, so the mock keeps its world).
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Gaps' })
    .click()
  await expect(
    grid(page).getByRole('row').filter({ hasText: 'Repeat purchase rate in iOS' }),
  ).toHaveAttribute('data-status', 'proposal_made')
  await openGap(page, 'Repeat purchase rate in iOS')
  await expect(panelOf(page).getByRole('list', { name: 'Drafts from this gap' })).toContainText(
    'Untitled draft',
  )
})

test('asks for the domain before a draft from a topic that spans domains', async ({ page }) => {
  await openPage(page, '/gaps', desktop)
  await openGap(page, 'Active customers and Marketing spend')
  const panel = panelOf(page)
  await panel.getByRole('button', { name: 'Start a draft' }).click()
  await expect(panel.getByText('Choose the domain that should review the draft.')).toBeVisible()
  await panel.getByRole('combobox', { name: 'Domain for the draft' }).click()
  await page.getByRole('option', { name: 'Marketing' }).click()
  await panel.getByRole('button', { name: 'Start a draft' }).click()
  await expect(page).toHaveURL(/\/library\/new\?draft=/)
})

test('counts topics per week and says how many weeks stay hidden', async ({ page }) => {
  await openPage(page, '/gaps?view=topics', desktop)
  const views = page.getByRole('navigation', { name: 'Gap views' })
  await expect(views.getByRole('link', { name: /^Topic counts/ })).toHaveAttribute(
    'aria-current',
    'page',
  )
  await expect(views.getByRole('link', { name: /^Gaps/ })).not.toHaveAttribute('aria-current')
  const table = page.getByRole('table', { name: 'Topic counts' })
  await expect(
    table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /^Week of/ }) }),
  ).toHaveCount(7)
  const footwear = table.getByRole('row').filter({ hasText: 'Gross sales in Footwear' })
  await expect(footwear.getByRole('cell')).toHaveText(['Sales', '26', 'Fewer than 5', 'Hidden'])
  await expect(page.getByRole('group', { name: 'Totals' })).toContainText(
    /21\s*topic weeks\s*·\s*5\s*below the minimum, not shown/,
  )
  await page
    .getByRole('navigation', { name: 'Gap views' })
    .getByRole('link', { name: /^Gaps/ })
    .click()
  await expect(grid(page)).toBeVisible()
})

test('a high-risk approver keeps the Gaps page and its entry, and is not offered Health', async ({
  page,
}) => {
  await signInAs(page, 'per_lars')
  await openPage(page, '/gaps', desktop)
  await expect(grid(page)).toBeVisible()
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(sidebar.getByRole('link', { name: 'Gaps' })).toHaveAttribute('aria-current', 'page')
  await expect(sidebar.getByRole('link', { name: 'Health' })).toHaveCount(0)
})

test('says so when the gaps cannot load', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'error'))
  await openPage(page, '/gaps', desktop)
  await expect(page.getByRole('alert')).toContainText("We couldn't load the gaps")
})

for (const theme of themes) {
  test(`has no axe violations with a gap open in the panel, ${theme}`, async ({ page }) => {
    await openPage(page, '/gaps?gap=ca9a0000-0000-4000-8000-000000000001', {
      ...widths[0],
      theme,
    })
    await expect(panelOf(page).getByRole('heading', { name: 'Orders in Norway' })).toBeVisible()
    await expect(panelOf(page).locator('[data-slot="weekly-chart"]')).toBeVisible()
    await settle(page)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(
      results.violations.map(
        (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`,
      ),
    ).toEqual([])
  })
}

test('on a phone, the gaps are narrow rows and the panel takes the whole screen', async ({
  page,
}) => {
  await openPage(page, '/gaps', { ...widths[2], theme: 'light' })
  await expect(grid(page).getByRole('columnheader')).toHaveCount(0)
  await openGap(page, 'Orders in Norway')
  await expect(panelOf(page)).toHaveAttribute('data-mode', 'full')
  const box = await panelOf(page).boundingBox()
  expect(box?.width).toBe(390)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  // The back arrow closes it, and the list is in reach again.
  await panelOf(page).getByRole('button', { name: 'Close' }).click()
  await expect(panelOf(page)).toHaveCount(0)
  await expect(grid(page).getByRole('link', { name: /^Orders in Norway,/ })).toBeFocused()
})

test('the panel docks beside the list, and j and k step it through the gaps', async ({ page }) => {
  await openPage(page, '/gaps', desktop)
  await openGap(page, 'Orders in Norway')
  await expect(panelOf(page)).toHaveAttribute('data-mode', 'docked')
  // Docked: the list keeps its grid beside it, the open row marked.
  await expect(grid(page).getByRole('columnheader').first()).toBeVisible()
  const row = grid(page).getByRole('row').filter({ hasText: 'Orders in Norway' })
  await expect(row).toHaveAttribute('data-open', 'true')
  const meta = panelOf(page).locator('[data-slot="dock-meta"]')
  await expect(meta).toHaveText(/Gap\s*·\s*4 of 8/)
  await page.keyboard.press('j')
  await expect(meta).toHaveText(/5 of 8/)
  await expect(panelOf(page).getByRole('heading', { level: 2 })).toHaveText(
    'Return on ad spend in Paid search',
  )
  await page.keyboard.press('k')
  await expect(panelOf(page).getByRole('heading', { level: 2 })).toHaveText('Orders in Norway')
  // Back closes it: the row replaced the address, so the history has one entry for the panel.
  await page.goBack()
  await expect(panelOf(page)).toHaveCount(0)
  await expect(page).toHaveURL(/\/gaps$/)
})
