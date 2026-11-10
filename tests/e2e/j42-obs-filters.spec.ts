import { domainId, expect, go, mode, signInAs, test } from './go.ts'
import type { Page } from '@playwright/test'

// J42: Overview's filters. Filters are chips in parts that read as sentences, added from one
// picker (F, or / to type): a field or a dimension first, then its values with what each counts,
// or a value found in any dimension by its words. A chip opens the picker on its own values, flips
// between is and is not, moves by keys or by a drag, and comes off with Backspace or its own
// button. The facets beside the topics count every value without its own chip, and a count looks
// at only that value. Every change is a step in the address, so a link opens the same view and
// Back undoes it.

const picker = (page: Page) =>
  page.getByRole('combobox', { name: /^(Filter by|Search the values|Find a dimension)/ })
const chipOrder = (page: Page) =>
  page.locator('[data-chip]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.chip))
const cell = (page: Page, label: string) =>
  page.locator('[data-slot=kpi]').filter({ has: page.getByText(label, { exact: true }) })

test('add chips from the picker, change one, move them, and take them off', async ({ page }) => {
  await go(page, '/observability?range=30')
  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible()
  const asked = await cell(page, 'Asked').innerText()

  // F opens the picker: the fields, then the dimensions agents asked about most.
  await page.keyboard.press('f')
  await expect(picker(page)).toBeFocused()
  await expect(page.getByRole('option', { name: /^Answer/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /^Market.*values/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /^All 5 dimensions/ })).toBeVisible()

  // Two letters find a value in any dimension, grouped by its dimension, with what it counts.
  await page.keyboard.type('nor')
  const norway = page.getByRole('option', { name: /^Norway/ })
  await expect(norway).toContainText(/\d/)
  await expect(page.getByRole('group', { name: /^Market/ })).toContainText('Norway')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/[?&]d\.market=norway(&|$)/)
  await expect(page.getByRole('button', { name: /^Market is Norway\./ })).toBeVisible()
  await expect(cell(page, 'Asked')).toContainText(/in \d+ topics/)
  expect(await cell(page, 'Asked').innerText()).not.toBe(asked)

  // A field first, then its value, by the arrows and Space; it applies at once.
  await page.keyboard.press('f')
  await expect(picker(page)).toBeFocused()
  await page.keyboard.type('answer')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('combobox', { name: 'Search the values of Answer' })).toBeFocused()
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('option', { name: /^Not found/ })).toHaveAttribute(
    'data-active',
    'true',
  )
  await page.keyboard.press(' ')
  await expect(page).toHaveURL(/answer=missing/)
  await expect(page).toHaveURL(/chips=d\.market%2Canswer/)
  // Escape goes back a step, then closes.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('option', { name: /^Answer/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker(page)).toHaveCount(0)

  // A chip opens the picker on its values: is not, and another value ticked, each with its count.
  await page.getByRole('button', { name: /^Market is Norway\./ }).click()
  const values = page.getByRole('listbox', { name: 'Search the values of Market' })
  await expect(values.getByRole('option', { name: /^Norway/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await page.getByRole('radio', { name: 'is not' }).click()
  await expect(page).toHaveURL(/d\.market=%21norway/)
  await page.getByRole('combobox', { name: 'Search the values of Market' }).fill('spa')
  await values.getByRole('option', { name: /^Spain/ }).click()
  await expect(page).toHaveURL(/d\.market=%21norway%2Cspain/)
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(
    page.getByRole('button', { name: /^Market is none of Norway, Spain\./ }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Market is none of Norway, Spain\./ }),
  ).toBeFocused()

  // The middle of a chip flips how it matches.
  await page
    .locator('li', { has: page.locator('[data-chip="dim:market"]') })
    .getByText('is none of')
    .click()
  await expect(page).toHaveURL(/d\.market=norway%2Cspain/)
  await expect(
    page.getByRole('button', { name: /^Market is any of Norway, Spain\./ }),
  ).toBeVisible()

  // Alt and the arrows move a chip at once; the address keeps the order.
  await page.getByRole('button', { name: /^Answer is Not found\./ }).focus()
  await page.keyboard.press('Alt+ArrowLeft')
  expect(await chipOrder(page)).toEqual(['answer', 'dim:market'])
  await expect(page).not.toHaveURL(/chips=/)
  await expect(page.getByRole('button', { name: /^Answer is Not found\./ })).toBeFocused()

  // A drag moves it back: the market chip dropped before the answer chip, once the last change's
  // view transition, which takes the pointer while it runs, has ended.
  await page.waitForFunction(() => !document.documentElement.dataset.vt)
  const market = page.locator('[data-chip="dim:market"]')
  const answer = page.locator('[data-chip=answer]')
  const from = (await market.boundingBox())!
  const to = (await answer.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(to.x + 8, to.y + to.height / 2, { steps: 8 })
  await page.mouse.move(to.x + 4, to.y + to.height / 2, { steps: 2 })
  await page.mouse.up()
  await expect(page).toHaveURL(/chips=d\.market%2Canswer/)
  expect(await chipOrder(page)).toEqual(['dim:market', 'answer'])
  // A drag only moves it; the picker stays shut.
  await expect(picker(page)).toHaveCount(0)

  // Backspace in the picker's empty first step takes the last chip off; Back puts it on again.
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(picker(page)).toBeFocused()
  await page.keyboard.press('Backspace')
  await expect(page).not.toHaveURL(/answer=/)
  await expect(page.getByText(/^Removed the filter Answer is Not found$/)).toBeAttached()
  await page.keyboard.press('Escape')
  await page.goBack()
  await expect(page).toHaveURL(/answer=missing/)
  await expect(page.getByRole('button', { name: /^Answer is Not found\./ })).toBeVisible()

  // Clear all, from two chips.
  await page.getByRole('button', { name: 'Clear all' }).click()
  await expect(page.locator('[data-chip]')).toHaveCount(0)
  await expect.poll(() => cell(page, 'Asked').innerText()).toBe(asked)
})

test('every dimension, any value, and a dimension no agent asked about', async ({ page }) => {
  await go(page, '/observability?range=30')
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('option', { name: /^All 5 dimensions/ }).click()
  await expect(page.getByRole('combobox', { name: 'Find a dimension' })).toBeFocused()
  // A to Z, then a dimension no agent asked about in the range: Any value alone.
  await page.getByRole('radio', { name: 'A to Z' }).click()
  await expect(page.getByRole('option').first()).toHaveText(/^Campaign/)
  await page.getByRole('option', { name: /^Platform/ }).click()
  await expect(page.getByText(/No agent asked about a value of Platform in 30 days/)).toBeVisible()
  await page.keyboard.press('Backspace')
  await expect(page.getByRole('combobox', { name: 'Find a dimension' })).toBeFocused()
  await page.getByRole('option', { name: /^Campaign/ }).click()
  await page.getByRole('option', { name: /^Any value/ }).click()
  await expect(page).toHaveURL(/d\.campaign=\*/)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: /^Campaign has any value\./ })).toBeVisible()
  for (const row of await page.locator('tbody [data-row-open]').allInnerTexts())
    expect(row).toContain('Black Friday')
})

test("an old link's market by name is read as the one value it names", async ({ page }) => {
  await go(page, '/observability?range=30&market=Norway')
  await expect(page).toHaveURL(/d\.market=norway/)
  await expect(page).not.toHaveURL(/[?&]market=/)
  await expect(page.getByRole('button', { name: /^Market is Norway\./ })).toBeVisible()
  // A name no topic asked about stays as it was, and says why.
  await go(page, '/observability?range=30&market=Narnia')
  await expect(page.getByRole('button', { name: /^Value is Narnia\./ })).toBeVisible()
  await expect(page.getByText('No topic in this range asked about Narnia.')).toBeAttached()
})

test('a By facet switches between dimensions, and an admin pins one for everyone', async ({
  page,
}) => {
  await go(page, '/observability?range=30')
  const facets = page.getByRole('complementary', { name: 'Facets' })
  // By starts on the dimension agents asked about most; a tick adds its value. The demo asks
  // about markets, and on the mock also a campaign (Black Friday); the service's demo week keeps
  // Black Friday as an event with no value.
  const by = facets.getByRole('region', { name: 'By Market' })
  await expect(by.getByRole('checkbox', { name: 'Norway' })).toBeVisible()
  const dims = mode === 'mock' ? '2 dimensions were' : '1 dimension was'
  await expect(
    facets.getByText(`${dims} asked about in 30 days. Pin one`, { exact: false }),
  ).toBeVisible()
  await by.getByRole('checkbox', { name: 'Norway' }).click()
  await expect(page).toHaveURL(/d\.market=norway/)
  // Counted without Market's own chip, the other dimensions follow it: no campaign in Norway.
  await expect(facets.getByText(/1 dimension was asked about in 30 days/)).toBeVisible()
  await by.getByRole('button', { name: 'Clear Market' }).click()
  await expect(page).not.toHaveURL(/d\.market/)
  if (mode === 'mock') {
    await facets.getByRole('combobox', { name: 'Break the facets down by a dimension' }).click()
    await page.getByRole('option', { name: /^Campaign/ }).click()
    await expect(facets.getByRole('region', { name: 'By Campaign' })).toContainText('Black Friday')
    await facets.getByRole('combobox', { name: 'Break the facets down by a dimension' }).click()
    await page.getByRole('option', { name: /^Market/ }).click()
  }

  // Pinned for everyone: a facet of its own, first in the filter, and a setting with a reason.
  await facets
    .getByRole('region', { name: 'By Market' })
    .getByRole('button', { name: 'Pin Market for everyone' })
    .click()
  await expect(page.getByText('Pinned Market for everyone')).toBeVisible()
  const pinned = facets.getByRole('region', { name: 'Market', exact: true })
  await expect(pinned.getByRole('checkbox', { name: 'Norway' })).toBeVisible()
  await expect(facets.getByRole('region', { name: 'By Market' })).toHaveCount(0)
  await page.keyboard.press('f')
  await expect(page.getByRole('group', { name: 'Pinned' }).getByRole('option')).toHaveText([
    /^Market/,
  ])
  await page.keyboard.press('Escape')
  await go(page, '/settings/advanced')
  await expect(page.getByText('Dimensions pinned on Observability’s Overview')).toBeVisible()
  await go(page, '/observability?range=30')
  await pinned.getByRole('button', { name: 'Unpin Market for everyone' }).click()
  await expect(pinned).toHaveCount(0)
  await expect(facets.getByRole('region', { name: 'By Market' })).toBeVisible()

  // An owner reads the pins and picks in By, and pins nothing.
  await facets
    .getByRole('region', { name: 'By Market' })
    .getByRole('button', { name: 'Pin Market for everyone' })
    .click()
  await expect(page.getByText('Pinned Market for everyone').last()).toBeVisible()
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/observability?range=30')
  await expect(page.getByRole('button', { name: /^Pin .* for everyone$/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Unpin .* for everyone$/ })).toHaveCount(0)
  await expect(facets.getByText(/An admin can pin one here for everyone/)).toBeVisible()
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
  await domain.getByRole('button', { name: 'Clear Domain' }).click()

  // A kind of agent is counted by the service for every topic: narrowed by a dimension, it is
  // not shown rather than worked out here.
  const agents = facets.getByRole('region', { name: 'Agent kind' })
  await expect(agents.getByRole('button', { name: /^Claude Code: / })).toBeVisible()
  await go(page, '/observability?range=30&d.market=norway')
  await expect(agents.getByText('Not shown').first()).toBeVisible()

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

test('a topic in words, a link that opens the same view, the picker and the facets in sheets on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, '/observability?range=30&q=orders&month=2026-10&answer=!grounded')
  await expect(page.getByRole('button', { name: /^Topic has “orders”\./ })).toBeVisible()
  await expect(
    page.getByRole('button', { name: /^Month asked about is October 2026\./ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Answer is not Checked\./ })).toBeVisible()
  for (const row of await page.locator('tbody [data-row-open]').allInnerTexts())
    expect(row.toLowerCase()).toContain('orders')
  // What the picker's counts cannot follow, it says.
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Filter' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('Counts leave out Topic has “orders”.')).toBeVisible()
  // Its values follow the other filters: only Germany was asked about so in October.
  await sheet.getByRole('option', { name: /^Market/ }).click()
  const germany = sheet.getByRole('option', { name: /^Germany/ })
  expect((await germany.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await expect(sheet.getByRole('option', { name: /^Norway/ })).toHaveCount(0)
  await germany.click()
  await sheet.getByRole('button', { name: 'Done' }).click()
  await expect(page).toHaveURL(/d\.market=germany/)

  await page.getByRole('button', { name: 'Facets' }).click()
  const facets = page.getByRole('dialog', { name: 'Facets' })
  await expect(facets).toBeVisible()
  await facets
    .getByRole('region', { name: 'Answer' })
    .getByRole('checkbox', { name: 'Partial' })
    .click()
  await expect(page).toHaveURL(/answer=%21grounded%2Cpartial/)
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: /^Answer is none of Checked, Partial\./ }),
  ).toBeVisible()
})
