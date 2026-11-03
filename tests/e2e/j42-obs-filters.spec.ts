import { domainId, expect, go, test } from './go.ts'
import type { Page } from '@playwright/test'

// J42: Overview's filter bar. Filters are chips that read as sentences, added from a type-ahead (F,
// or / to type), edited in place (is or is not, and the values with what each counts), moved by
// keys or by a drag, and taken off with Backspace or their own button. The facets beside the
// topics count every value without its own chip, and a count looks at only that value. Every
// change is a step in the address, so a link opens the same view and Back undoes it.

const box = (page: Page) =>
  page.getByRole('combobox', { name: 'Filter by a field, a value or a topic' })
const chipOrder = (page: Page) =>
  page.locator('[data-chip]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.chip))
const cell = (page: Page, label: string) =>
  page.locator('[data-slot=kpi]').filter({ has: page.getByText(label, { exact: true }) })

test('add chips from the keys, change one, move them, and take them off', async ({ page }) => {
  await go(page, '/observability?range=30')
  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible()
  const asked = await cell(page, 'Asked').innerText()

  // F opens the fields; typing finds a value in any of them, with what it counts.
  await page.keyboard.press('f')
  await expect(box(page)).toBeFocused()
  await expect(page.getByRole('option', { name: /^Market/ })).toBeVisible()
  await page.keyboard.type('nor')
  await expect(page.getByRole('option', { name: /^Market is Norway/ })).toContainText(/\d/)
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/[?&]market=Norway(&|$)/)
  await expect(page.getByRole('button', { name: /^Market is Norway\./ })).toBeVisible()
  await expect(cell(page, 'Asked')).toContainText(/in \d+ topics/)
  expect(await cell(page, 'Asked').innerText()).not.toBe(asked)

  // A field first, then its value, by the arrows and Enter.
  await page.keyboard.type('answer')
  await page.keyboard.press('Enter')
  await expect(page.getByText('Answer is…')).toBeVisible()
  await expect(page.getByRole('option', { name: /^Not found/ })).toBeVisible()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/answer=missing/)
  await expect(page).toHaveURL(/chips=market%2Canswer/)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(box(page)).not.toBeFocused()

  // A chip opens its editor: is not, and another value ticked, each with its count.
  await page.getByRole('button', { name: /^Market is Norway\./ }).click()
  const editor = page.getByRole('dialog', { name: 'Market filter' })
  await expect(editor.getByRole('option', { name: /^Norway/ })).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await editor.getByRole('radio', { name: 'is not' }).click()
  await expect(page).toHaveURL(/market=%21Norway/)
  await editor.getByRole('combobox', { name: 'Find a market' }).fill('spa')
  await editor.getByRole('option', { name: /^Spain/ }).click()
  await expect(page).toHaveURL(/market=%21Norway%2CSpain/)
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: /^Market is none of Norway, Spain\./ }),
  ).toBeVisible()

  // Alt and the arrows move a chip at once; the address keeps the order.
  await page.getByRole('button', { name: /^Answer is Not found\./ }).focus()
  await page.keyboard.press('Alt+ArrowLeft')
  expect(await chipOrder(page)).toEqual(['answer', 'market'])
  await expect(page).not.toHaveURL(/chips=/)
  await expect(page.getByRole('button', { name: /^Answer is Not found\./ })).toBeFocused()

  // A drag moves it back: the market chip dropped before the answer chip.
  const market = page.locator('[data-chip=market]')
  const answer = page.locator('[data-chip=answer]')
  const from = (await market.boundingBox())!
  const to = (await answer.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 8, to.y + to.height / 2, { steps: 8 })
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 2 })
  await page.mouse.up()
  await expect(page).toHaveURL(/chips=market%2Canswer/)
  expect(await chipOrder(page)).toEqual(['market', 'answer'])
  // A drag only moves it; the editor stays shut.
  await expect(page.getByRole('dialog', { name: 'Market filter' })).toHaveCount(0)

  // Backspace in the empty box takes the last chip off; Back puts it on again.
  await box(page).click()
  await page.keyboard.press('Backspace')
  await expect(page).not.toHaveURL(/answer=/)
  await expect(page.getByText(/^Removed the filter Answer is Not found$/)).toBeAttached()
  await page.goBack()
  await expect(page).toHaveURL(/answer=missing/)
  await expect(page.getByRole('button', { name: /^Answer is Not found\./ })).toBeVisible()

  // Clear all, from two chips.
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.locator('[data-chip]')).toHaveCount(0)
  await expect.poll(() => cell(page, 'Asked').innerText()).toBe(asked)
})

test('the facets count each value without its own chip, and a count looks at only it', async ({
  page,
}) => {
  await go(page, '/observability?range=30')
  const facets = page.getByRole('complementary', { name: 'Facets' })
  const domain = facets.getByRole('region', { name: 'Domain' })
  await domain.getByRole('button', { name: /^Marketing: \d+ topics?, asked/ }).click()
  await expect(page).toHaveURL(new RegExp(`domain=${domainId('marketing')}`))
  await expect(page.getByRole('button', { name: /^Domain is Marketing\./ })).toBeVisible()
  // The other domains stay, with their counts, and a tick adds one.
  await expect(domain.getByRole('checkbox', { name: 'Marketing' })).toBeChecked()
  await expect(domain.getByRole('checkbox', { name: 'Sales' })).not.toBeChecked()
  await domain.getByRole('checkbox', { name: 'Sales' }).click()
  await expect(page.getByRole('button', { name: /^Domain is any of / })).toBeVisible()
  // Two domains narrow the topics alone: the chart counts every question and says so.
  await expect(page.getByText(/as the chart counts questions, not topics/)).toBeVisible()

  // A kind of agent is counted by the service for every topic: narrowed by a market, it is not
  // shown rather than worked out here.
  const agents = facets.getByRole('region', { name: 'Agent kind' })
  await expect(agents.getByText('Not shown').first()).toBeVisible()
  await domain.getByRole('button', { name: 'Clear Domain' }).click()
  await expect(agents.getByText('Not shown')).toHaveCount(0)
  await expect(agents.getByRole('button', { name: /^Claude Code: / })).toBeVisible()

  // Ticks in quick succession, while the rows still move, are each kept.
  const markets = facets.getByRole('region', { name: 'Market' })
  const ticks = markets.getByRole('checkbox')
  await ticks.nth(0).click()
  await ticks.nth(1).click()
  await expect(page.getByRole('button', { name: /^Market is any of / })).toBeVisible()
  await markets.getByRole('button', { name: 'Clear Market' }).click()

  // Hidden counts say so in the disclosure rules' words, never a number worked out from others.
  const answers = await facets.getByRole('region', { name: 'Answer' }).innerText()
  expect(answers).toMatch(/Checked\s*\d/)

  // The facets fold away, and the device remembers.
  await page.getByRole('button', { name: 'Facets' }).click()
  await expect(page.getByRole('button', { name: 'Facets' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expect(facets).toHaveAttribute('inert')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Facets' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await page.getByRole('button', { name: 'Facets' }).click()
  await expect(facets).not.toHaveAttribute('inert')
})

test('a topic in words, a link that opens the same view, and the facets in a sheet on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, '/observability?q=orders&month=2026-10&answer=!grounded')
  await expect(page.getByRole('button', { name: /^Topic has “orders”\./ })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Month asked about is October 2026\./ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Answer is not Checked\./ })).toBeVisible()
  for (const row of await page.locator('tbody [data-row-open]').allInnerTexts())
    expect(row.toLowerCase()).toContain('orders')
  await page.getByRole('button', { name: 'Facets' }).click()
  const sheet = page.getByRole('dialog', { name: 'Facets' })
  await expect(sheet).toBeVisible()
  await sheet
    .getByRole('region', { name: 'Answer' })
    .getByRole('checkbox', { name: 'Partial' })
    .click()
  await expect(page).toHaveURL(/answer=%21grounded%2Cpartial/)
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: /^Answer is none of Checked, Partial\./ }),
  ).toBeVisible()
})
