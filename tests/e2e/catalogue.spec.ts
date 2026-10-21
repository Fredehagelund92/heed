import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  The catalogue (FR-136, design contract 5): the sidebar entry beside the Library, the
  grid grouped by domain, the view chips, the search, Filter and Display, the totals, the phone
  rows, the term links and the states of the list.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const rail = { ...widths[1], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

const termRow = (page: Page, key: string) => page.locator(`[data-term-key="${key}"]`)
const rows = (page: Page) => page.locator('[data-term-key]')
const groups = (page: Page) => page.locator('[data-group]')
const columnHeaders = (page: Page) => page.getByRole('columnheader')

/**
 * Every term and group row of the list, in order. Only the rows near the window are rendered (a
 * large model has thousands), so the list is walked from the top to the bottom.
 */
async function listed(page: Page) {
  return page.evaluate(async () => {
    const terms: string[] = []
    const groups: string[] = []
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    window.scrollTo(0, 0)
    for (;;) {
      await frame()
      for (const row of document.querySelectorAll('[data-term-key]')) {
        const key = row.getAttribute('data-term-key')!
        if (!terms.includes(key)) terms.push(key)
      }
      for (const row of document.querySelectorAll('[data-group]')) {
        const text = row.textContent ?? ''
        if (!groups.includes(text)) groups.push(text)
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) break
      window.scrollBy(0, window.innerHeight / 2)
    }
    window.scrollTo(0, 0)
    return { terms, groups }
  })
}
const listedTerms = async (page: Page) => (await listed(page)).terms.length

async function catalogueReady(page: Page) {
  // The first row of the first domain: further rows render as the window reaches them.
  await expect(termRow(page, 'metric:active_customers')).toBeVisible({ timeout: 15_000 })
}

async function scenario(page: Page, name: string) {
  await page.addInitScript((value) => window.localStorage.setItem('cl.mock-scenario', value), name)
}

const focusedTerm = (page: Page) =>
  page.evaluate(() =>
    document.activeElement?.closest('[data-term-key]')?.getAttribute('data-term-key'),
  )

test.describe('place and breadcrumbs', () => {
  test('the sidebar lists Catalogue after the Library and before Proposals', async ({ page }) => {
    await openPage(page, '/', desktop)
    const sidebar = page.locator('[data-slot="sidebar"]')
    const main = await sidebar
      .getByRole('link')
      // Proposals carries the count of what waits for the person, when there is one.
      .filter({ hasText: /^(Home|Library|Catalogue|Proposals)\d*$/ })
      .allTextContents()
    expect(main.map((name) => name.replace(/\d+$/, ''))).toEqual([
      'Home',
      'Library',
      'Catalogue',
      'Proposals',
    ])
    await sidebar.getByRole('link', { name: 'Catalogue' }).click()
    await expect(page).toHaveURL(/\/catalogue$/)
    await expect(sidebar.getByRole('link', { name: 'Catalogue' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(
      page.getByRole('banner').getByRole('navigation', { name: 'breadcrumb' }),
    ).toHaveText('Catalogue')
    await expect(page).toHaveTitle('Catalogue - Heed')
  })

  test('g then o opens the catalogue', async ({ page }) => {
    await openPage(page, '/', desktop)
    await page.keyboard.press('g')
    await page.keyboard.press('o')
    await expect(page).toHaveURL(/\/catalogue$/)
  })

  test('a metric and a dimension open their pages, under Catalogue', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    // A row opens the term in the docked panel; its expand opens the page.
    await termRow(page, 'metric:orders').getByRole('link', { name: 'Orders' }).click()
    await expect(page).toHaveURL(/\/catalogue\?panel=metric%3Aorders$/)
    await page.locator('[data-slot="dock-panel"]').getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/orders$/)
    const trail = page.getByRole('banner').getByRole('navigation', { name: 'breadcrumb' })
    // The trail ends with the kind; the page has the name (contract 8.6).
    await expect(trail).toHaveText(/^Catalogue\s*Metric$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Orders' })).toBeVisible()

    await openPage(page, '/catalogue/dimension/market', desktop)
    await expect(trail).toHaveText(/^Catalogue\s*Dimension$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Market' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Values of Market' })).toBeVisible()
    await openPage(page, '/catalogue/dimension/no_such_dimension', desktop)
    await expect(
      page.getByText('There is no dimension “no_such_dimension” in the catalogue'),
    ).toBeVisible()
    await openPage(page, '/catalogue/metric/no_such_metric', desktop)
    await expect(
      page.getByText('There is no metric “no_such_metric” in the catalogue'),
    ).toBeVisible()
  })

  test('Suggest a name leads to a page that says how terms are added', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    await page.locator('[data-slot="add-row"]').getByRole('link').click()
    await expect(page).toHaveURL(/\/catalogue\/suggest$/)
    await expect(page.getByText(/Names come from the definition source/)).toBeVisible()
  })
})

test.describe('the grid', () => {
  test('opens grouped by domain, dimensions last under All domains, without a Domain column', async ({
    page,
  }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    const expected = [
      /Customer value\s*6 metrics/,
      /Marketing\s*4 metrics/,
      /Paid media\s*1 metric/,
      /Sales\s*10 metrics/,
      /No domain\s*1 metric/,
      /All domains\s*5 dimensions/,
    ]
    const shown = (await listed(page)).groups
    expect(shown).toHaveLength(expected.length)
    shown.forEach((text, index) => expect(text).toMatch(expected[index]!))
    await expect(columnHeaders(page)).toHaveText([
      'Name',
      'Context',
      'Status',
      'Definition changed',
    ])
    const orders = termRow(page, 'metric:orders')
    await expect(orders).toContainText('The value of orders customers completed and paid for')
    await expect(orders).toContainText('93 facts')
    await expect(orders.locator('[data-slot="catalogue-status"]')).toHaveText('1 active issue')
    await expect(termRow(page, 'metric:repeat_purchase_rate')).toContainText('Definition changed')
    await expect(termRow(page, 'metric:repeat_purchase_rate')).toContainText('7 Oct 2026')
    // Only what asks for a look is tinted.
    await expect(
      termRow(page, 'metric:units_sold').locator('[data-slot="catalogue-status"]'),
    ).toHaveAttribute('data-status', 'in_sync')
    // The rows further down are rendered once the window reaches them.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await expect(termRow(page, 'metric:on_time_shipping_rate')).toContainText(
      'No description in Cube',
    )
    await expect(termRow(page, 'dim:channel')).toContainText('No context yet')
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(
      page.getByText(/Descriptions are copies from Cube, read 7 Oct 2026\./),
    ).toBeVisible()
  })

  test('the totals count terms, accepted items and active issues once each', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    const totals = page.getByRole('group', { name: 'Totals' })
    await expect(totals).toContainText('27 terms: 22 metrics, 5 dimensions')
    await expect(totals).toContainText('1,407 facts')
    await expect(totals).toContainText('3 active issues')
  })

  test('a group collapses and opens again', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    const sales = page.getByRole('button', { name: /Sales/ })
    await sales.click()
    await expect(sales).toHaveAttribute('aria-expanded', 'false')
    await expect(termRow(page, 'metric:orders')).toHaveCount(0)
    await sales.click()
    await expect(termRow(page, 'metric:orders')).toBeVisible()
  })

  test('Definition changed leaves on a rail page (1024)', async ({ page }) => {
    await openPage(page, '/catalogue', rail)
    await catalogueReady(page)
    await expect(columnHeaders(page)).toHaveText(['Name', 'Context', 'Status'])
  })
})

test.describe('toolbar', () => {
  test('the view chips switch to metrics or dimensions, with counts, in the address', async ({
    page,
  }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    const views = page.getByRole('navigation', { name: 'Catalogue views' })
    await expect(views.getByRole('link')).toHaveText(['All27', 'Metrics22', 'Dimensions5'])
    await expect(views.getByRole('link', { name: /All/ })).toHaveAttribute('aria-current', 'page')
    await views.getByRole('link', { name: /Dimensions/ }).click()
    await expect(page).toHaveURL(/kind=dimension/)
    await expect(rows(page)).toHaveCount(5)
    await expect(groups(page)).toHaveText([/All domains/])
    await views.getByRole('link', { name: /All/ }).click()
    await expect.poll(() => listedTerms(page)).toBe(27)
  })

  test('/ focuses the search, which marks the words and narrows the chips', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    await page.keyboard.press('/')
    const search = page.getByRole('textbox', { name: 'Search metrics and dimensions' })
    await expect(search).toBeFocused()
    await search.fill('return')
    await expect(page).toHaveURL(/q=return/)
    // By name (Returns, Return on ad spend) and by description (Gross sales, Net revenue).
    await expect(rows(page)).toHaveCount(4)
    await expect(termRow(page, 'metric:return_on_ad_spend')).toBeVisible()
    await expect(termRow(page, 'metric:gross_sales')).toBeVisible()
    await expect(termRow(page, 'metric:returns').locator('mark')).toHaveText('Return')
    await expect(
      page.getByRole('navigation', { name: 'Catalogue views' }).getByRole('link'),
    ).toHaveText(['All4', 'Metrics4', 'Dimensions0'])
    await page.keyboard.press('ArrowDown')
    expect(await focusedTerm(page)).toBe(await rows(page).first().getAttribute('data-term-key'))
  })

  test('a search with no match says so, and Clear brings every term back', async ({ page }) => {
    await openPage(page, '/catalogue?q=zzzz&status=in_sync', desktop)
    await expect(page.getByText('No terms match')).toBeVisible()
    await expect(page.getByText('Nothing matches “zzzz” with Status: In sync.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search and filters' }).click()
    await catalogueReady(page)
    await expect.poll(() => listedTerms(page)).toBe(27)
  })

  test('Filter narrows by status and domain, shows the count, and the chips remove it', async ({
    page,
  }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    await page.getByRole('button', { name: 'Filter' }).click()
    const filter = page.getByRole('dialog')
    await filter.getByRole('button', { name: 'Active issues' }).click()
    await expect(page).toHaveURL(/status=active_issues/)
    await expect(rows(page)).toHaveCount(4)
    await filter
      .getByRole('group', { name: 'Domain' })
      .getByRole('button', { name: 'Sales' })
      .click()
    await expect(rows(page)).toHaveCount(1)
    // Sandbox has no terms, so it is not offered.
    await expect(filter.getByRole('button', { name: 'Sandbox' })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Filter, 2 on' })).toBeVisible()
    const applied = page.getByRole('group', { name: 'Filters on' })
    await applied.getByRole('button', { name: 'Remove filter Status: Active issues' }).click()
    await expect(rows(page)).toHaveCount(10)
    await applied.getByRole('button', { name: /Remove filter Domain/ }).click()
    await expect(applied).toHaveCount(0)
    await expect.poll(() => listedTerms(page)).toBe(27)
  })

  test('Display switches to A to Z with a Domain column, and to compact rows', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    await page.getByRole('button', { name: 'Display' }).click()
    const display = page.getByRole('dialog')
    await display.getByRole('button', { name: 'A to Z' }).click()
    await expect(page).toHaveURL(/order=az/)
    await expect(groups(page)).toHaveCount(0)
    // At 1440 the 192 Domain column leaves Definition changed no room: it leaves first.
    await expect(columnHeaders(page)).toHaveText(['Name', 'Domain', 'Context', 'Status'])
    await expect(rows(page).first()).toHaveAttribute('data-term-key', 'metric:active_customers')
    await expect(termRow(page, 'dim:market')).toContainText('All domains')
    await expect(termRow(page, 'metric:orders')).toContainText('Sales')
    await expect(page.getByRole('group', { name: 'Totals' })).toContainText('4 domains')

    expect((await termRow(page, 'metric:orders').boundingBox())?.height).toBe(64)
    await display.getByRole('button', { name: 'Compact' }).click()
    await expect
      .poll(async () => (await termRow(page, 'metric:orders').boundingBox())?.height)
      .toBe(40)
    await expect(termRow(page, 'metric:orders')).not.toContainText(
      'The value of orders customers completed',
    )
    // Density is personal: it is kept in this browser after a reload.
    await page.reload()
    await catalogueReady(page)
    expect((await termRow(page, 'metric:orders').boundingBox())?.height).toBe(40)
  })
})

test.describe('keyboard', () => {
  test('j and k move through the terms, skipping group rows; Enter opens the panel; Escape clears', async ({
    page,
  }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    await page.keyboard.press('j')
    expect(await focusedTerm(page)).toBe('metric:active_customers')
    await page.keyboard.press('j')
    expect(await focusedTerm(page)).toBe('metric:churn_rate')
    await page.keyboard.press('k')
    expect(await focusedTerm(page)).toBe('metric:active_customers')
    await page.keyboard.press('End')
    expect(await focusedTerm(page)).toBe('dim:product')
    await page.keyboard.press('Escape')
    expect(await focusedTerm(page)).toBeUndefined()
    await page.keyboard.press('Home')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/catalogue\?panel=metric%3Aactive_customers$/)
  })

  test('the list is one tab stop', async ({ page }) => {
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    await expect(page.locator('[data-term-link][tabindex="0"]')).toHaveCount(1)
  })
})

test.describe('phone', () => {
  test('rows show the name, two lines of description and one line of facts', async ({ page }) => {
    await openPage(page, '/catalogue', phone)
    await catalogueReady(page)
    await expect(columnHeaders(page)).toHaveCount(0)
    await expect(page.getByRole('group', { name: 'Totals' })).toHaveCount(0)
    const active = termRow(page, 'metric:active_customers')
    await expect(active).toContainText(/\d+ facts/)
    await expect(active).toContainText('1 active issue')
    const description = active.locator('p')
    const lines = await description.evaluate(
      (element) =>
        element.getBoundingClientRect().height / parseFloat(getComputedStyle(element).lineHeight),
    )
    expect(Math.round(lines)).toBeLessThanOrEqual(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })

  test('Filter and Display share one button', async ({ page }) => {
    await openPage(page, '/catalogue', phone)
    await catalogueReady(page)
    await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeHidden()
    await page.getByRole('button', { name: 'Filter and display' }).click()
    const menu = page.getByRole('dialog')
    await expect(menu.getByRole('heading', { name: 'Filter' })).toBeVisible()
    await menu.getByRole('button', { name: 'A to Z' }).click()
    await expect(groups(page)).toHaveCount(0)
    // A to Z on a phone: the domain moves into the line of facts.
    await expect(termRow(page, 'metric:average_order_value')).toContainText('Sales')
  })
})

test.describe('states (contract 9.5)', () => {
  test('loading shows skeleton rows with the column header', async ({ page }) => {
    await scenario(page, 'slow')
    await openPage(page, '/catalogue', desktop)
    await expect(page.getByRole('status', { name: 'Loading the catalogue' })).toBeVisible()
    // The header over the skeleton is not yet a table header, so it must not claim table roles.
    const results = await new AxeBuilder({ page }).include('main').analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    await catalogueReady(page)
    await expect(page.getByRole('status', { name: 'Loading the catalogue' })).toHaveCount(0)
  })

  test('a failed load says so and retries', async ({ page }) => {
    await scenario(page, 'error')
    await openPage(page, '/catalogue', desktop)
    await expect(page.getByRole('alert')).toContainText("We couldn't load the catalogue")
    await page.evaluate(() => window.localStorage.removeItem('cl.mock-scenario'))
    await page.getByRole('button', { name: 'Try again' }).click()
    await catalogueReady(page)
  })

  test('an empty vocabulary says what fills the catalogue', async ({ page }) => {
    await scenario(page, 'no-terms')
    await openPage(page, '/catalogue', desktop)
    await expect(page.getByText('No metrics or dimensions yet')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Suggest a name' })).toBeVisible()
  })

  test('while Cube cannot be read, the descriptions are the last copies', async ({ page }) => {
    await scenario(page, 'source-down')
    await openPage(page, '/catalogue', desktop)
    await catalogueReady(page)
    await expect(page.locator('[data-slot="source-line"]')).toHaveText(
      "We couldn't read Cube lately. The descriptions are the copies read on 7 Oct 2026.",
    )
  })
})

for (const size of widths) {
  for (const theme of themes) {
    test(`axe with rows and an open menu at ${size.name}px, ${theme}`, async ({ page }) => {
      await openPage(page, '/catalogue?order=az', { ...size, theme })
      await catalogueReady(page)
      const analyze = async () => {
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
        return results.violations.map(
          (violation) =>
            `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
        )
      }
      expect(await analyze()).toEqual([])
      await page
        .getByRole('button', { name: size.width < 768 ? 'Filter and display' : 'Filter' })
        .click()
      await settle(page)
      expect(await analyze()).toEqual([])
    })
  }
}
