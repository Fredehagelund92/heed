import { expect, go, test } from './go.ts'
import type { Locator, Page } from '@playwright/test'

// J32: every list that sorts sorts both ways. A click on the sorted column's header flips it, with
// the arrow and the header's sort state saying which way; a click on another column starts that
// one its own way. The Sort menu offers both ways in words, and the keyboard works the same. Where
// a list keeps its filters in the address (Questions), the sort is kept there too.

const header = (page: Page, name: string) => page.getByRole('columnheader', { name, exact: true })
const by = (a: string, b: string) => a.localeCompare(b)

/** The rows' open buttons' texts (Context) or their names (Definitions), in the order shown. */
const texts = (rows: Locator) => rows.allInnerTexts()
const names = (rows: Locator) =>
  rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-row-open') ?? ''))

test('Context: a second click on a header flips it, and the keyboard does the same', async ({
  page,
}) => {
  await go(page, '/context')
  const rows = page.locator('tbody [data-row-open]')
  await expect(header(page, 'Checked')).toHaveAttribute('aria-sort', 'descending')

  await header(page, 'Context').getByRole('button').click()
  await expect(header(page, 'Context')).toHaveAttribute('aria-sort', 'ascending')
  await expect(header(page, 'Checked')).not.toHaveAttribute('aria-sort')
  await expect(page.getByRole('button', { name: 'Sort Title A to Z' })).toBeVisible()
  expect(await texts(rows)).toEqual((await texts(rows)).toSorted(by))

  await header(page, 'Context').getByRole('button').click()
  await expect(header(page, 'Context')).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByRole('button', { name: 'Sort Title Z to A' })).toBeVisible()
  expect(await texts(rows)).toEqual((await texts(rows)).toSorted(by).reverse())

  // From the keyboard: Enter on the focused header flips it back.
  await header(page, 'Context').getByRole('button').focus()
  await page.keyboard.press('Enter')
  await expect(header(page, 'Context')).toHaveAttribute('aria-sort', 'ascending')

  // Another column starts its own way: newest checked first.
  await header(page, 'Checked').getByRole('button').click()
  await expect(header(page, 'Checked')).toHaveAttribute('aria-sort', 'descending')
  await header(page, 'Checked').getByRole('button').click()
  await expect(header(page, 'Checked')).toHaveAttribute('aria-sort', 'ascending')
  await expect(page.getByRole('button', { name: 'Sort Last checked Oldest first' })).toBeVisible()
})

test('Context: the Sort menu offers both ways in words', async ({ page }) => {
  await go(page, '/context')
  await page.getByRole('button', { name: /^Sort/ }).click()
  await page.getByRole('menuitemradio', { name: /^Title/ }).click()
  await expect(page.getByRole('menuitemradio', { name: 'A to Z', exact: true })).toBeChecked()
  await page.getByRole('menuitemradio', { name: 'Z to A', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(header(page, 'Context')).toHaveAttribute('aria-sort', 'descending')

  // A ranking has one way only, so the menu offers no direction for it.
  await page.getByLabel('Search context').fill('orders')
  await page.getByRole('button', { name: /^Sort/ }).click()
  await page.getByRole('menuitemradio', { name: /^Best match/ }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Z to A', exact: true })).toHaveCount(0)
})

test('Definitions: Name and Context headers sort, and flip', async ({ page }) => {
  await go(page, '/definitions')
  // Grouped by domain at first: the group button names the grouping.
  await page.getByRole('button', { name: 'Domain', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'No grouping' }).click()
  await page.keyboard.press('Escape')
  const rows = page.locator('tbody [data-row-open]')
  await expect(rows.first()).toBeVisible()

  await header(page, 'Name').getByRole('button').click()
  await expect(header(page, 'Name')).toHaveAttribute('aria-sort', 'ascending')
  expect(await names(rows)).toEqual((await names(rows)).toSorted(by))
  await header(page, 'Name').getByRole('button').click()
  await expect(header(page, 'Name')).toHaveAttribute('aria-sort', 'descending')
  expect(await names(rows)).toEqual((await names(rows)).toSorted(by).reverse())

  await header(page, 'Context').getByRole('button').click()
  await expect(header(page, 'Context')).toHaveAttribute('aria-sort', 'descending')
  await expect(header(page, 'Name')).not.toHaveAttribute('aria-sort')
  await header(page, 'Context').getByRole('button').click()
  await expect(header(page, 'Context')).toHaveAttribute('aria-sort', 'ascending')
})

test('Questions: the sort and its direction are kept in the address', async ({ page }) => {
  await go(page, '/observability/questions')
  await expect(header(page, 'Asked')).toHaveAttribute('aria-sort', 'descending')

  await header(page, 'Asked').getByRole('button').click()
  await expect(header(page, 'Asked')).toHaveAttribute('aria-sort', 'ascending')
  await expect(page).toHaveURL(/[?&]dir=asc\b/)
  await expect(page.getByRole('button', { name: 'Sort Asked Fewest first' })).toBeVisible()

  await header(page, 'Topic').getByRole('button').click()
  await expect(header(page, 'Topic')).toHaveAttribute('aria-sort', 'ascending')
  await expect(page).toHaveURL(/[?&]sort=name\b/)
  await expect(page).not.toHaveURL(/dir=/)
  await header(page, 'Topic').getByRole('button').click()
  await expect(page).toHaveURL(/[?&]dir=desc\b/)

  // A reload, or the link shared, keeps it.
  await page.reload()
  await expect(header(page, 'Topic')).toHaveAttribute('aria-sort', 'descending')
  await expect(page.getByRole('button', { name: 'Sort Topic Z to A' })).toBeVisible()
})
