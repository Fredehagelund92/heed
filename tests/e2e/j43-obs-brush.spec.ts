import { expect, go, test } from './go.ts'
import type { Page } from '@playwright/test'

// J43: Overview's chart drills and chooses days. A part of a bar adds its answer as a chip, and
// the numbers, the chart and the topics follow it. A drag across the bars, or Shift and the arrows
// once B has put the keys on the chart, chooses a run of days: the address keeps it, the filter bar
// reads it as a sentence, and the numbers add up the bars chosen as they show. Escape clears it.

const chart = (page: Page) => page.getByRole('group', { name: /^Questions per day/ })
const cell = (page: Page, label: string) =>
  page.locator('[data-slot=kpi]').filter({ has: page.getByText(label, { exact: true }) })
const time = (page: Page) => page.getByRole('button', { name: /^Time is .+\. Enter to change/ })
const DAYS = /[?&]days=\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}(&|$)/

/** A drag across the chart's plot, from one share of its width to another. */
async function drag(page: Page, from: number, to: number) {
  const box = (await chart(page).locator('svg').first().boundingBox())!
  const y = box.y + box.height * 0.5
  await page.mouse.move(box.x + box.width * from, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * ((from + to) / 2), y, { steps: 4 })
  await page.mouse.move(box.x + box.width * to, y, { steps: 4 })
  await page.mouse.up()
}

test('a drag chooses days: the address keeps them, the bar reads them, the numbers add them up', async ({
  page,
}) => {
  await go(page, '/observability?range=30')
  await expect(chart(page)).toBeVisible()
  const asked = await cell(page, 'Asked').innerText()

  await drag(page, 0.55, 0.8)
  await expect(page).toHaveURL(DAYS)
  await expect(time(page)).toBeVisible()
  const words = (await time(page).innerText()).replace(/^Time is\s*/, '')
  // The numbers add up the bars chosen, and say which days.
  await expect(cell(page, 'Asked')).toContainText(words)
  expect(await cell(page, 'Asked').innerText()).not.toBe(asked)
  // The topics count the whole range, and say so.
  await expect(
    page.getByText(/counted over the last 30 days, not only the days selected/),
  ).toBeVisible()
  // A screen reader hears the bars chosen in the chart's table.
  await expect(chart(page).locator('th', { hasText: ', selected' }).first()).toBeAttached()

  // A drag on the run moves it, a drag on its edge resizes it; each is a step in the address.
  const before = new URL(page.url()).searchParams.get('days')
  await drag(page, 0.68, 0.5)
  await expect.poll(() => new URL(page.url()).searchParams.get('days')).not.toBe(before)
  await page.goBack()
  await expect.poll(() => new URL(page.url()).searchParams.get('days')).toBe(before)

  // The same link opens the same days.
  await page.reload()
  await expect(time(page)).toHaveText(new RegExp(words))

  // Escape clears them, from anywhere on the page, and the numbers are the range's again.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/days=/)
  await expect(time(page)).toHaveCount(0)
  await expect.poll(() => cell(page, 'Asked').innerText()).toBe(asked)

  // A press beside the run clears it too; another range clears it as well.
  await drag(page, 0.3, 0.45)
  await expect(page).toHaveURL(DAYS)
  await page.getByRole('radio', { name: '90 days' }).click()
  await expect(page).not.toHaveURL(/days=/)
  await expect(page.getByRole('heading', { name: 'Questions per week' })).toBeVisible()
})

test('from the keys: B goes to the chart, Shift and the arrows choose, Alt moves, Enter drills', async ({
  page,
}) => {
  await go(page, '/observability?range=30')
  await expect(chart(page)).toBeVisible()
  await page.keyboard.press('b')
  await expect(chart(page)).toBeFocused()

  // Shift and Left from the last day: a run of four days, kept as one step in the address.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowLeft')
  await expect(page).toHaveURL(DAYS)
  const four = new URL(page.url()).searchParams.get('days')!
  const [a, b] = four.split('..').map((d) => Date.parse(d))
  expect((b! - a!) / 86_400_000).toBe(3)
  await expect(time(page)).toBeVisible()
  // Alt and Left moves the run a day back, keeping its length.
  await page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => new URL(page.url()).searchParams.get('days')).not.toBe(four)
  // Shift and Right from its start makes it shorter.
  await page.keyboard.press('Shift+ArrowRight')
  await expect
    .poll(() => {
      const [x, y] = new URL(page.url()).searchParams.get('days')!.split('..').map(Date.parse)
      return (y! - x!) / 86_400_000
    })
    .toBe(2)
  // Back undoes the whole run of keys at once.
  await page.goBack()
  await expect(page).not.toHaveURL(/days=/)

  // Up puts the keys on a part of the bar, and Enter looks at only that answer.
  await chart(page).focus()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText(/^Enter to look at only /)).toBeVisible()
  const part = (await page.getByText(/^Enter to look at only /).innerText()).replace(
    /^Enter to look at only /,
    '',
  )
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/[?&]answer=/)
  await expect(
    page.getByRole('button', { name: new RegExp(`^Answer is ${part}\\.`) }),
  ).toBeVisible()

  // Enter on a bar chooses that one day; Escape on the chart clears it.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/[?&]days=\d{4}-\d{2}-\d{2}(&|$)/)
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/days=/)

  // The time chip: Backspace takes it off, as any other chip.
  await page.keyboard.press('Shift+ArrowLeft')
  await expect(time(page)).toBeVisible()
  await time(page).focus()
  await page.keyboard.press('Backspace')
  await expect(page).not.toHaveURL(/days=/)
  await expect(page.getByText(/^Removed the filter Time is /)).toBeAttached()
})

test('a part of a bar adds its answer as a chip, and the numbers and topics follow', async ({
  page,
}) => {
  await go(page, '/observability?range=30')
  const rows = page.locator('tbody [data-row-open]')
  await expect(rows.first()).toBeVisible()
  const all = await rows.count()
  const asked = await cell(page, 'Asked').innerText()

  await chart(page).locator('[data-part=missing]').first().click()
  await expect(page).toHaveURL(/[?&]answer=missing(&|$)/)
  await expect(page.getByRole('button', { name: /^Answer is Not found\./ })).toBeVisible()
  // The chart draws only that answer now, and the topics are those that found nothing.
  await expect(chart(page).locator('[data-part]:not([data-part=missing])')).toHaveCount(0)
  await expect.poll(() => rows.count()).toBeLessThan(all)
  await expect.poll(() => cell(page, 'Asked').innerText()).not.toBe(asked)

  // A part pressed inside days chosen keeps them: the numbers add up that answer in those days.
  await drag(page, 0.5, 0.95)
  await expect(page).toHaveURL(DAYS)
  await expect(cell(page, 'Checked answers')).toContainText('left out by the answer filter')
  // Clear all takes off the chips and the days together.
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page).not.toHaveURL(/days=|answer=/)
  await expect(time(page)).toHaveCount(0)
})

test('on a phone, a drag across the bars chooses days too', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, '/observability?range=30')
  await chart(page).scrollIntoViewIfNeeded()
  await drag(page, 0.6, 0.9)
  await expect(page).toHaveURL(DAYS)
  await expect(time(page)).toBeVisible()
  // No sideways scroll on a phone, with the time chip in the bar.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
