import { card, cardIn, expect, go, mode, onMockOnly, test } from './go.ts'
import type { Locator, Page } from '@playwright/test'

// J40: the Inbox pane opens on the consequence. A suggestion says what agents answer today and
// what they will answer after the decision, in Heed's own answer states, with the evidence folded
// below; its one button is named for the decision, with Enter beside it and the words that say
// what follows. A card with no answers to compare (a check date, an alert, a report) keeps the
// folded layout: its point, its folds and its decision.

const pane = (page: Page) =>
  page.getByRole('region', { name: /./ }).filter({
    has: page.getByRole('button', { name: 'Previous' }),
  })
const answers = (page: Page) => page.getByRole('region', { name: 'What agents will say' })
/** Where a label sits, read again while the pane lays itself out after a resize. */
const top = async (l: Locator) => (await l.boundingBox())?.y ?? Number.NaN

test('a suggestion opens on what agents say today and after you publish', async ({ page }) => {
  await go(page, `/inbox?card=${card('sug-ines')}`)
  const p = pane(page)
  await expect(
    p.getByRole('heading', { level: 2, name: 'Units sold excludes test accounts' }),
  ).toBeVisible()
  await expect(p.getByText('Suggestion', { exact: true })).toBeVisible()
  const a = answers(page)
  await expect(a.getByText('Agents say today')).toBeVisible()
  await expect(a.getByText('After you publish')).toBeVisible()
  await expect(a.getByText('Checked', { exact: true })).toHaveCount(2)
  await onMockOnly('the demo’s own Try it question and its changed words', async () => {
    await expect(
      a.getByText('How many test accounts does units sold leave out in Norway?'),
    ).toBeVisible()
    // The words that change carry the Differs mark, on the after side only.
    await expect(a.locator('mark[data-mark="differs"]').first()).toContainText('340')
  })
  // The evidence is folded until it is wanted.
  const changes = p.getByRole('button', { name: 'What changes' })
  await expect(changes).toHaveAttribute('aria-expanded', 'false')
  await changes.click()
  await expect(changes).toHaveAttribute('aria-expanded', 'true')
  await expect(p.getByText('What agents should know').first()).toBeVisible()
  // The decision says what follows, and never with a zero count. On the service the change gives
  // agents the same words, and the pane says so.
  await expect(
    p.getByText(
      /^(\d+ questions? a week would get the new answer|Agents would get the new answer|Agents keep the same answer)$/,
    ),
  ).toBeVisible()
  await expect(p.getByText(/\b0 (questions?|times)\b/)).toHaveCount(0)
})

test('a suggestion that clashes says what agents would hear if it went out as it is', async ({
  page,
}) => {
  await go(page, `/inbox?card=${card('sug-sofia-clash')}`)
  const p = pane(page)
  await expect(p.getByText('Conflict', { exact: true }).first()).toBeVisible()
  const a = answers(page)
  await expect(a.getByText('If you publish as it is')).toBeVisible()
  // The after side's line; on the service the live items already disagree today too.
  await expect(a.getByText('Conflict', { exact: true }).last()).toBeVisible()
  await expect(p.getByText('Publishing waits until you say how they relate')).toBeVisible()
  await p.getByRole('button', { name: 'Decide how they relate' }).click()
  await expect(page).toHaveURL(new RegExp(`/inbox/${cardIn('sug-sofia-clash')}/review`))
})

test('a Not found card shows what agents asked about, and the answer its draft would give', async ({
  page,
}) => {
  await go(page, `/inbox?card=${card('gap-spain')}`)
  const p = pane(page)
  await expect(
    p.getByRole('heading', { level: 2, name: 'Orders in Spain, October 2026' }),
  ).toBeVisible()
  await expect(p.getByText('Not found', { exact: true }).first()).toBeVisible()
  const a = answers(page)
  // What agents asked about, never their words, which are not kept.
  await expect(a.getByText('Agents asked about')).toBeVisible()
  await expect(
    a.getByText(mode === 'http' ? /Spain/ : 'Spain', { exact: mode !== 'http' }).first(),
  ).toBeVisible()
  await expect(a.getByText(/\b0 times\b/)).toHaveCount(0)
  await expect(a.getByText('Not found', { exact: true })).toBeVisible()
  await expect(a.getByText('After you publish')).toBeVisible()
  await expect(p.getByRole('button', { name: 'Not something we write down' })).toBeVisible()
  await expect(p.getByRole('button', { name: 'Check the draft' })).toBeVisible()
})

test('a card with no answers to compare keeps its point, its folds and its decision', async ({
  page,
}) => {
  await go(page, `/inbox?demo=week&card=${card('check-returns')}`)
  const p = pane(page)
  const title = 'Returns changed definition on 28 April 2026'
  await expect(p.getByRole('heading', { level: 2, name: title })).toBeVisible()
  await expect(p.getByText('Due for a check', { exact: true })).toBeVisible()
  await expect(answers(page)).toHaveCount(0)
  // The context item folds to the Context list's row: its title, and what it is in words.
  const item = p.getByRole('button', { name: `The context item: ${title}`, exact: true })
  await expect(item).toHaveAttribute('aria-expanded', 'false')
  await expect(item).toHaveAccessibleDescription(/^Context item - Rule - Sales - owned by /)
  await item.click()
  await expect(item).toHaveAttribute('aria-expanded', 'true')
  // Opened, it leads to the item's page, as the card's own decisions don't.
  await expect(p.getByRole('link', { name: 'Open the context item' })).toHaveAttribute(
    'href',
    /^\/context\/[^/]+$/,
  )
  // Secondary decisions are labelled buttons beside the primary, not icons beside the arrows.
  await expect(p.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
  await expect(p.getByRole('button', { name: 'Archive', exact: true })).toBeVisible()
  await expect(p.getByText('It counts as checked today, by you')).toBeVisible()
  // Deciding: the outcome says so with Undo, and the next card that needs you opens.
  await p.getByRole('button', { name: 'Still true' }).click()
  await expect(page.getByText('Checked: still true')).toBeVisible()
  await expect(pane(page).getByRole('heading', { level: 2, name: title })).toHaveCount(0)
})

test("a reported item's fold leaves out the way to its page: the card's decision is that way", async ({
  page,
}) => {
  await go(page, `/inbox?demo=week&card=${card('flag-germany')}`)
  const p = pane(page)
  const item = p.getByRole('button', { name: /^The context item: / })
  await item.click()
  await expect(item).toHaveAttribute('aria-expanded', 'true')
  await expect(p.getByRole('link', { name: 'Open the context item' })).toHaveCount(0)
  await expect(p.getByRole('button', { name: 'Open the context item' })).toBeVisible()
})

test('the answers stand side by side from 560 px of pane, one above the other below it', async ({
  page,
}) => {
  await go(page, `/inbox?card=${card('sug-ines')}`)
  const a = answers(page)
  const today = a.getByText('Agents say today')
  const after = a.getByText('After you publish')
  // At 1440 the pane is about 650 px wide: two columns, their labels on one line.
  await expect(today).toBeVisible()
  await expect.poll(async () => (await top(after)) - (await top(today))).toBe(0)
  // A narrower window gives the pane under 560 px: the after side goes under today's.
  await page.setViewportSize({ width: 1100, height: 900 })
  await expect.poll(async () => (await top(after)) - (await top(today))).toBeGreaterThan(60)
  // On a phone the pane is the screen, and the answers stack too.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await top(after)) - (await top(today))).toBeGreaterThan(60)
})

test('the primary shows its key, and the keyboard reaches the folds before the decisions', async ({
  page,
}) => {
  await go(page, `/inbox?card=${card('gap-spain')}`)
  const p = pane(page)
  const primary = p.getByRole('button', { name: 'Check the draft', exact: true })
  // The key is in sight without a hover, and said as the button's shortcut, not as its name.
  await expect(primary.getByText('Enter')).toBeVisible()
  await expect(primary).toHaveAttribute('aria-keyshortcuts', 'Enter')
  // From Next, Tab goes through the folds, then the secondary decision, then the primary.
  await p.getByRole('button', { name: 'Next' }).focus()
  const order: string[] = []
  for (let i = 0; i < 12 && !order.includes('Check the draft'); i++) {
    await page.keyboard.press('Tab')
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      return el?.getAttribute('aria-label') ?? el?.innerText.split('\n')[0]?.trim() ?? ''
    })
    order.push(name)
  }
  const at = (name: string) => order.indexOf(name)
  expect(at('What changes'), order.join(' > ')).toBeGreaterThan(-1)
  expect(at('What changes')).toBeLessThan(at('Not something we write down'))
  expect(at('Not something we write down')).toBeLessThan(at('Check the draft'))
  // Enter, with nothing in focus, takes the primary decision.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(new RegExp(`/inbox/${cardIn('gap-spain')}/review`))
})

test('the review quick view in the dock has the same head, answers and decision', async ({
  page,
}) => {
  test.skip(mode === 'http', 'the dock reads the same review; the Inbox journeys cover http')
  await go(page, '/inbox?dock=review.sug-sofia-clash')
  const dock = page.getByRole('region', { name: 'Review' })
  await expect(
    dock.getByRole('heading', { level: 2, name: /Norway orders leave out store credit/ }),
  ).toBeVisible()
  await expect(dock.getByText('If you publish as it is')).toBeVisible()
  await dock.getByRole('button', { name: 'Decide how they relate' }).click()
  await expect(page).toHaveURL(/\/inbox\/sug-sofia-clash\/review/)
})
