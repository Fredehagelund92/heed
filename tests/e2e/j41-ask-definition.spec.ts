import type { Locator, Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J41: a question about what a metric is or means is answered by its definition first (FR-703).
// The definitions source's own words lead, at the answer's size, with where they come from; a
// model never writes them. With no context written about the metric, the definition is the whole
// answer: a neutral Definition mark takes the badge's place, its card says that for context the
// answer is Not found, and one quiet line says nothing else is written. With context, the state's
// badge, the words and the sources follow the definition. A question about the data keeps its
// badge first, and one that names nothing is not looked up.

const definitions = {
  'Churn rate':
    'The share of customers active in the previous month who placed no order this month.',
  'Discount cost':
    'The value of the discounts and gift vouchers customers used, in euros, on the day they used them.',
  Orders:
    'The value of orders customers completed and paid for, in euros at the daily rate. Cancelled orders and failed payments are left out.',
  'Net revenue':
    'Gross sales after returns, discounts, VAT and payment fees, in euros. The figure finance reports each month.',
}

const head = /^(Definition|Checked|Partial|Not found|Conflict|Outdated|Not checked)$/

/** Asks, and waits until the answer is finished: Stop gone and its row of icons in. */
async function ask(page: Page, question: string) {
  const turns = page.locator('[data-turn]')
  const n = await turns.count()
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  const turn = turns.nth(n)
  await expect(turn.getByRole('group', { name: 'Answer actions' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  return turn
}

/** The definition at the head of an answer: the source's words, and the link to its entry. */
async function leads(turn: Locator, name: keyof typeof definitions) {
  const lead = turn.locator('[data-answer-definition]')
  await expect(lead.getByRole('blockquote')).toHaveText(definitions[name])
  const source = lead.getByRole('link', { name, exact: true })
  await expect(source).toHaveAttribute('href', `/definitions/${encodeURIComponent(name)}`)
  await expect(lead.getByRole('figure')).toContainText(`From Cube, ${name}`)
  // At the answer's size, inside the reading measure.
  const type = await lead.getByRole('blockquote').evaluate((el) => {
    const style = getComputedStyle(el)
    return { size: style.fontSize, line: style.lineHeight, width: el.clientWidth }
  })
  expect(type).toMatchObject({ size: '16px', line: '26px' })
  expect(type.width).toBeLessThanOrEqual(600)
  // Never the small card beside the words.
  await expect(turn.getByText(/, as Cube defines it$/)).toHaveCount(0)
  return lead
}

/**
 * A is above B on the screen. Polled: the answer's lookup (the data's figure) settles after the
 * answer is finished, and the two boxes are read one after the other, so a shift between the
 * reads must not count.
 */
async function above(a: Locator, b: Locator) {
  await expect
    .poll(async () => (await a.boundingBox())!.y + 1 < (await b.boundingBox())!.y)
    .toBe(true)
}

test('what does churn rate mean: the definition is the answer, under a Definition mark', async ({
  page,
}) => {
  await go(page, `/ask?n=j41-${Date.now()}`)
  const turn = await ask(page, 'what does churn rate mean')
  const lead = await leads(turn, 'Churn rate')
  const mark = turn.getByRole('button', { name: 'Definition', exact: true })
  await expect(mark).toBeVisible()
  await above(mark, lead)
  // The context's state is not drawn as a failure, and the engine's sentence is not repeated.
  await expect(turn.getByRole('button', { name: 'Not found', exact: true })).toHaveCount(0)
  await expect(turn.getByText(/^Nobody has written down anything/)).toHaveCount(0)
  // One quiet line, then what was looked up and Write context.
  const quiet = turn.getByText('Nothing else is written about Churn rate yet.', { exact: true })
  await expect(quiet).toBeVisible()
  expect(await quiet.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px')
  await above(lead, quiet)
  await expect(turn.getByRole('button', { name: /^Looked up/ })).toBeVisible()
  await expect(turn.getByRole('button', { name: 'Write context for Churn rate' })).toBeVisible()

  // Its card says where the words come from, and that for context the answer is Not found.
  await mark.hover()
  const card = page.getByRole('dialog', { name: 'What Definition means' })
  await expect(card).toContainText("Definition: Cube's own words.")
  await expect(card).toContainText('for context the answer is Not found')
  await expect(card.getByRole('link', { name: 'Open in Definitions' })).toHaveAttribute(
    'href',
    '/definitions/Churn%20rate',
  )
  const [c, l] = [(await card.boundingBox())!, (await lead.boundingBox())!]
  expect(c.y + c.height <= l.y || l.y + l.height <= c.y || c.x >= l.x + l.width).toBe(true)
  await page.mouse.move(0, 0)
  await expect(card).toBeHidden()

  // Copy copies what is on screen: the definition first.
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await turn
    .getByRole('group', { name: 'Answer actions' })
    .getByRole('button', { name: 'Copy', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(
      `Churn rate, from Cube: ${definitions['Churn rate']}\n\nNothing else is written about Churn rate yet.`,
    )
})

test('what is discount cost: the definition leads, whatever is written about it', async ({
  page,
}) => {
  await go(page, `/ask?n=j41-${Date.now()}`)
  const turn = await ask(page, 'what is discount cost?')
  const lead = await leads(turn, 'Discount cost')
  // With nothing written, a Definition mark above it; with context, the state's badge under it.
  const badge = turn.getByRole('button', { name: head })
  await expect(badge).toHaveCount(1)
  if ((await badge.textContent()) === 'Definition') await above(badge, lead)
  else await above(lead, badge)
})

test('what is Orders: a Checked answer starts with what Orders is, then what the context says', async ({
  page,
}) => {
  await go(page, `/ask?n=j41-${Date.now()}`)
  const turn = await ask(page, 'what is Orders')
  const lead = await leads(turn, 'Orders')
  const badge = turn.getByRole('button', { name: head })
  await expect(badge).not.toHaveText('Definition')
  await above(lead, badge)
  await above(badge, turn.locator('[data-answer-words]'))
  await expect(turn.getByRole('button', { name: /^Source \d+: / }).first()).toBeVisible()
  await expect(turn.getByText(/^Nothing else is written about/)).toHaveCount(0)
})

test('what is net revenue: the definition, then the context with its state and sources', async ({
  page,
}) => {
  await go(page, `/ask?n=j41-${Date.now()}`)
  const turn = await ask(page, 'what is net revenue')
  const lead = await leads(turn, 'Net revenue')
  const badge = turn.getByRole('button', { name: head })
  await expect(badge).not.toHaveText('Definition')
  await above(lead, badge)
  await expect(turn.getByRole('button', { name: /^Source \d+: / }).first()).toBeVisible()
})

test('a question about the data keeps its badge first, as before', async ({ page }) => {
  await go(page, `/ask?n=j41-${Date.now()}`)
  const orders = await ask(page, 'How are orders doing in Norway?')
  await expect(orders.locator('[data-answer-definition]')).toHaveCount(0)
  await expect(orders.getByRole('button', { name: head })).not.toHaveText('Definition')

  // "What is" with a market asks for the data: the definition stays a small card beside it.
  const norway = await ask(page, 'What is churn rate in Norway?')
  await expect(norway.locator('[data-answer-definition]')).toHaveCount(0)
  const badge = norway.getByRole('button', { name: head })
  await expect(badge).not.toHaveText('Definition')
  const card = norway.getByRole('figure')
  await expect(card).toContainText('Churn rate, as Cube defines it')
  await above(badge, card)
})

test('a question about something with no definition and no context is not looked up', async ({
  page,
}) => {
  await go(page, `/ask?n=j41-${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('what is the warehouse backlog?')
  await box.press('Enter')
  const log = page.getByRole('log')
  await expect(log.getByText('Nothing was looked up')).toBeVisible()
  await expect(log.locator('[data-answer-definition]')).toHaveCount(0)
  await expect(log.getByRole('button', { name: head })).toHaveCount(0)
})
