import type { Locator, Page } from '@playwright/test'
import { expect, go, signInAs, test } from './go.ts'

// J37, what a first visit meets on every page: an address the app does not know says so, each
// page names itself in the tab and in one heading, the counts read the same way everywhere and
// stay inside the screen, a table wider than the page says it scrolls, and someone who is not an
// admin is pointed at the people who are, never at themselves.

/** Where an element's words end on the screen: a cell runs to the edge, its words should not. */
const right = (l: Locator) =>
  l.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect().right
  })
const width = (page: Page) => page.viewportSize()!.width

test('an unknown address says there is no page there, under that address', async ({ page }) => {
  await go(page, '/nowhere-at-all')
  await expect(page).toHaveURL(/\/nowhere-at-all$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found')
  await expect(page).toHaveTitle(/^Page not found - /)
  await expect(page.getByText('Nothing lives at /nowhere-at-all.')).toBeVisible()
  await page.getByRole('link', { name: 'Go to the Inbox' }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(page).toHaveTitle(/^Inbox - /)
})

test("each page's tab and heading say its name alone", async ({ page }) => {
  await go(page, '/context')
  await expect(page).toHaveTitle(/^Context - /)
  // A page under a trail of links: the heading is where it ends, never the trail run together.
  await go(page, '/observability/summary')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Summary')
  await expect(page).toHaveTitle(/^Summary - /)
  await go(page, '/settings/people')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('People')
  await expect(page).toHaveTitle(/^People - /)
  await go(page, '/context')
  // An item's page: its title is the heading.
  await go(page, '/context/itm_norway_stop')
  const title = 'Online sales to Norway stopped on 4 August 2026'
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title)
  await expect(page).toHaveTitle(`${title} - Heed`)
})

test('the counts read alike and stay inside the screen', async ({ page }) => {
  await go(page, '/context')
  const foot = page.locator('tfoot')
  // Every count as a number reads, grouped by thousands where it has them.
  for (const text of await foot.locator('td').allTextContents())
    expect(text.trim()).toMatch(/^(|\d{1,3}(,\d{3})* [a-z ]+)$/)
  const count = page.locator('[aria-live=polite]').filter({ hasText: /context items?$/ })
  await expect(count).toBeVisible()
  expect(await right(count)).toBeLessThanOrEqual(width(page))

  // Definitions: the total says what it counts, and nothing touches the right edge.
  await go(page, '/definitions')
  await expect(page.locator('tfoot')).toContainText(/, with [\d,]+ context items about them/)
  const look = page.locator('tfoot td').filter({ hasText: /to look at$/ })
  expect(await right(look)).toBeLessThanOrEqual(width(page) - 16)
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await right(look)).toBeLessThanOrEqual(width(page) - 16)
})

test('the Advanced table fits a wide screen and says when it scrolls', async ({ page }) => {
  await go(page, '/settings/advanced')
  const table = page.getByRole('table', { name: 'Tuning settings' })
  await expect(table.getByRole('columnheader', { name: 'What it does' })).toBeInViewport({
    ratio: 1,
  })
  await expect(
    page.getByText('Wider than the page: scroll sideways for every column.'),
  ).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(
    page.getByText('Wider than the page: scroll sideways for every column.').first(),
  ).toBeVisible()
})

test('someone who is not an admin is pointed at the admins, never at themselves', async ({
  page,
}) => {
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/settings/advanced')
  await expect(page.getByText('Settings are for admins')).toBeVisible()
  const ask = page.getByText(/^Ask .+ if something here needs changing\.$/)
  await expect(ask).toBeVisible()
  await expect(ask).not.toContainText('Tomas Eriksen')
  await expect(ask).toContainText('Jon Abara')
})
