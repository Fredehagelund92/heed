import { expect, go, onMockOnly, test } from './go.ts'
import type { Page } from '@playwright/test'

// J50: Search takes the first row on Enter. Type a name, press Enter, and you are where the first
// row says: a definition of that name ahead of the context items about it, and the example
// answers last, never taking Enter just because their words match.

const input = (page: Page) => page.getByPlaceholder('Search context, or type a place…')
const rows = (page: Page) => page.locator('[cmdk-item]')
const selected = (page: Page) => page.locator('[cmdk-item][aria-selected="true"]')
const heading = (page: Page, name: string) =>
  page.locator('[cmdk-group-heading]').filter({ hasText: new RegExp(`^${name}$`) })

/** The selected row is the first one shown, the one Enter takes. */
async function expectFirstRowSelected(page: Page) {
  await expect(selected(page)).toHaveCount(1)
  await expect
    .poll(() => selected(page).getAttribute('data-value'))
    .toBe(await rows(page).first().getAttribute('data-value'))
}

/** Two frames on: the first row takes the selection a frame after the rows are sorted, and a person only presses a key once they see it. */
const settled = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  )

async function openSearch(page: Page) {
  await go(page, '/inbox')
  await page.getByRole('button', { name: /^Search/ }).click()
  await expect(input(page)).toBeFocused()
}

test('Enter on a name opens the definition of that name, above the context about it', async ({
  page,
}) => {
  await openSearch(page)
  await input(page).fill('net revenue')
  await expect(heading(page, 'Context')).toBeVisible()
  const order = await page.locator('[cmdk-group-heading]').allInnerTexts()
  expect(order.indexOf('Definitions')).toBeGreaterThanOrEqual(0)
  expect(order.indexOf('Definitions')).toBeLessThan(order.indexOf('Context'))
  await expect(rows(page).first()).toHaveText(/^Net revenue/)
  await expect(selected(page)).toHaveCount(1)
  await expectFirstRowSelected(page)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/dock=def\.Net(%20|\+)revenue/)
  await expect(page).not.toHaveURL(/\/ask/)
})

test('the first row is taken again as the service answers while the words are typed', async ({
  page,
}) => {
  await openSearch(page)
  await input(page).pressSequentially('orders', { delay: 120 })
  await expect(heading(page, 'Context')).toBeVisible()
  await expect(selected(page)).toHaveCount(1)
  await expect(selected(page)).toHaveText(/^Orders/)
  await expect(rows(page).first()).toHaveText(/^Orders/)
  // The first row is the selected one, whatever the previous words had found.
  await input(page).pressSequentially(' lag', { delay: 120 })
  await expect(selected(page)).toHaveCount(1)
  await expectFirstRowSelected(page)
})

test('the arrow keys still move the selection, and Enter takes the row they stopped on', async ({
  page,
}) => {
  await openSearch(page)
  await input(page).fill('net revenue')
  await expect(heading(page, 'Context')).toBeVisible()
  await expectFirstRowSelected(page)
  await settled(page)
  await expectFirstRowSelected(page)
  await page.keyboard.press('ArrowDown')
  await expect(selected(page)).toHaveText(/^Net revenue in Spain/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/dock=context\./)
})

test('an arrow key pressed as new results draw is not undone', async ({ page }) => {
  await openSearch(page)
  await input(page).fill('net revenue')
  await expect(heading(page, 'Context')).toBeVisible()
  await expectFirstRowSelected(page)
  await settled(page)
  await input(page).pressSequentially(' in')
  await expectFirstRowSelected(page)
  const first = await rows(page).first().getAttribute('data-value')
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => selected(page).getAttribute('data-value')).not.toBe(first)
  const moved = await selected(page).getAttribute('data-value')
  await settled(page)
  await expect(selected(page)).toHaveAttribute('data-value', moved!)
})

test('an example answer never takes Enter, and still opens from the arrow keys', async ({
  page,
}) => {
  await onMockOnly('example answers, named by the state they show', async () => {
    await openSearch(page)
    await input(page).fill('not found')
    await expect(heading(page, 'Example answers')).toBeVisible()
    await expect(selected(page)).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(page).not.toHaveURL(/\/ask/)
    await expect(input(page)).toBeVisible()
    await page.keyboard.press('ArrowDown')
    await expect(selected(page)).toHaveText('Not found')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/ask\?example=/)
  })
})
