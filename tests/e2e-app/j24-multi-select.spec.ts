import { expect, test, type Page } from '@playwright/test'
import { go } from './go.ts'

// Picking several rows works the same in every list with checkboxes: Shift and a click ticks a
// range in the order on screen, across groups; Cmd or Ctrl and a click ticks one; Shift and an arrow
// extends from the keyboard; Cmd or Ctrl and A ticks every row shown; Esc clears. A title still opens.

const rowBoxes = (page: Page) => page.getByRole('checkbox', { name: /^Select (?!all)/ })
const ticked = (page: Page) => page.locator('[role=checkbox][aria-checked=true]')
const said = (page: Page, text: string) =>
  expect(page.locator('[role=status]', { hasText: text })).toHaveCount(1)
const highlighted = (page: Page) => page.evaluate<string>('String(getSelection() ?? "")')

/** Which of the row checkboxes are ticked, by position. */
async function tickedAt(page: Page) {
  const states = await rowBoxes(page).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-checked') === 'true'),
  )
  return states.flatMap((on, i) => (on ? [i] : []))
}

test('Context: a Shift-click ticks the range, with no text highlight, and says so', async ({
  page,
}) => {
  await go(page, '/context')
  await rowBoxes(page).nth(0).click()
  await rowBoxes(page)
    .nth(3)
    .click({ modifiers: ['Shift'] })
  expect(await tickedAt(page)).toEqual([0, 1, 2, 3])
  expect(await highlighted(page)).toBe('')
  await expect(page.locator('tbody tr[aria-selected=true]')).toHaveCount(4)
  await said(page, '4 selected')
  await expect(page.getByRole('region', { name: 'Selected context' })).toContainText('4 selected')

  // A second Shift-click re-draws the range from the same anchor.
  await rowBoxes(page)
    .nth(1)
    .click({ modifiers: ['Shift'] })
  expect(await tickedAt(page)).toEqual([0, 1])

  await page.keyboard.press('Escape')
  await expect(ticked(page)).toHaveCount(0)
  await said(page, 'Selection cleared')
})

test('Context: a range follows the sort, and runs across groups', async ({ page }) => {
  await go(page, '/context')
  await page.getByRole('button', { name: /Sort/ }).click()
  await page.getByRole('menuitemradio', { name: /^Title/ }).click()
  await page.keyboard.press('Escape')
  const titles = await page.locator('tbody [data-row-open]').allInnerTexts()
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)))
  await rowBoxes(page).nth(2).click()
  await rowBoxes(page)
    .nth(5)
    .click({ modifiers: ['Shift'] })
  expect(await tickedAt(page)).toEqual([2, 3, 4, 5])
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Group' }).click()
  await page.getByRole('menuitemradio', { name: 'Domain' }).click()
  await page.keyboard.press('Escape')
  const firstGroup = await page
    .locator('tbody tr')
    .filter({ has: page.locator('[data-row-open]') })
    .count()
  expect(firstGroup).toBeGreaterThan(8)
  await rowBoxes(page).nth(1).click()
  await rowBoxes(page)
    .nth(8)
    .click({ modifiers: ['Shift'] })
  expect(await tickedAt(page)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
})

test('Context: the anchor outlives a filter that hid it', async ({ page }) => {
  await go(page, '/context')
  await rowBoxes(page).nth(0).click()
  const search = page.getByPlaceholder('Search context')
  await search.fill('zzzz')
  await expect(rowBoxes(page)).toHaveCount(0)
  await search.fill('')
  await rowBoxes(page)
    .nth(2)
    .click({ modifiers: ['Shift'] })
  expect(await tickedAt(page)).toEqual([0, 1, 2])
})

test('Context: Cmd or Ctrl ticks a row, a title opens, a row click ticks while picking', async ({
  page,
}) => {
  await go(page, '/context')
  const rows = page.locator('tbody tr').filter({ has: page.locator('[data-row-open]') })
  await rows
    .nth(4)
    .locator('td')
    .nth(5)
    .click({ modifiers: ['ControlOrMeta'] })
  expect(await tickedAt(page)).toEqual([4])
  await expect(page).not.toHaveURL(/dock=/)

  // While rows are ticked, a click on the row ticks it too.
  await rows.nth(6).locator('td').nth(5).click()
  expect(await tickedAt(page)).toEqual([4, 6])
  await expect(page).not.toHaveURL(/dock=/)

  // The title still opens the row.
  await rows.nth(1).locator('[data-row-open]').click()
  await expect(page).toHaveURL(/dock=context\./)
  expect(await tickedAt(page)).toEqual([4, 6])
})

test('Context: Shift and an arrow extend from the keyboard; Cmd or Ctrl and A ticks every row shown', async ({
  page,
}) => {
  await go(page, '/context')
  await page.locator('tbody [data-row-open]').nth(2).focus()
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  expect(await tickedAt(page)).toEqual([2, 3, 4])
  await page.keyboard.press('Shift+ArrowUp')
  expect(await tickedAt(page)).toEqual([2, 3])
  await page.keyboard.press('Escape')
  await expect(ticked(page)).toHaveCount(0)

  const shown = await rowBoxes(page).count()
  await page.locator('tbody [data-row-open]').first().focus()
  await page.keyboard.press('ControlOrMeta+a')
  await expect(ticked(page)).toHaveCount(shown + 1) // the header's box too
  await said(page, `${shown} selected`)
  expect(await highlighted(page)).toBe('')
})

test('Definitions: the same ranges and keys', async ({ page }) => {
  await go(page, '/definitions')
  await rowBoxes(page).nth(1).click()
  await rowBoxes(page)
    .nth(4)
    .click({ modifiers: ['Shift'] })
  expect(await tickedAt(page)).toEqual([1, 2, 3, 4])
  await expect(page.getByRole('region', { name: 'Selected definitions' })).toContainText(
    '4 selected',
  )
  await page.keyboard.press('Escape')
  await expect(ticked(page)).toHaveCount(0)
})

test('Inbox: a Shift-click ticks a range of cards, and Mark as read takes their dots away', async ({
  page,
}) => {
  await go(page, '/inbox?demo=week&tab=all')
  await rowBoxes(page).nth(0).click()
  await rowBoxes(page)
    .nth(3)
    .click({ modifiers: ['Shift'] })
  expect(await tickedAt(page)).toEqual([0, 1, 2, 3])
  expect(await highlighted(page)).toBe('')
  await said(page, '4 selected')

  // While cards are ticked, a click on a card ticks it instead of opening it.
  const before = page.url()
  await page.locator('[data-row-open]').nth(5).click()
  expect(await tickedAt(page)).toEqual([0, 1, 2, 3, 5])
  expect(page.url()).toBe(before)

  const unread = await page.locator("[data-row-open] [aria-label='Not opened yet']").count()
  await page.getByRole('button', { name: 'Mark as read' }).click()
  await expect(page.getByText(/Marked \d as read/)).toBeVisible()
  await expect(ticked(page)).toHaveCount(0)
  expect(await page.locator("[data-row-open] [aria-label='Not opened yet']").count()).toBeLessThan(
    unread,
  )
})

test("A source's folders: unticking one and Shift-clicking another unticks the run", async ({
  page,
}) => {
  await go(page, '/settings/integrations/cube/connect?step=3')
  const box = (name: string) => page.locator('li', { hasText: name }).getByRole('checkbox')
  await box('orders').click()
  await page
    .locator('li', { hasText: 'customers' })
    .locator('label')
    .click({ modifiers: ['Shift'] })
  for (const v of ['orders', 'revenue', 'basket', 'customers'])
    await expect(box(v)).toHaveAttribute('aria-checked', 'false')
  for (const v of ['marketing', 'operations', 'segments'])
    await expect(box(v)).toHaveAttribute('aria-checked', 'true')
  expect(await highlighted(page)).toBe('')
})
