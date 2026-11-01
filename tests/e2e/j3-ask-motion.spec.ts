import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

/** The six state words, as an answer's line says one. */
const STATE = /^(Checked|Partial|Not found|Conflict|Outdated|Not checked)$/

// J3, how an answer arrives: the question at once, the look-up's steps, the state and sources with
// the engine's answer, then the words a sentence at a time; stoppable, and without fades with
// reduced motion. On the mock the words come as a model would send them (src/web/api/mock/ask-live.ts).

const QUESTION = 'Why did orders in Norway really drop in August?'
/** The mock's answer to it, in two sentences: the first cites the item, the second does not. */
const FIRST = /A new customs rule stopped all online sales to Norway/
const SECOND = "The context doesn't say what caused it."

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

/**
 * Time stands still from the start and moves only in small steps until what the test waits for is
 * on screen, so an answer stops at "Reading" until the test moves on: on a loaded machine a real
 * clock carried it past that step before the check could see it.
 */
async function held(page: Page, route: string) {
  // On the service the look-up answers at once: the first is held, so its answer stays on its way.
  let looked = 0
  if (mode === 'http')
    await page.route('**/api/v1/ask/lookup', (r) => (looked++ ? r.continue() : undefined))
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, route)
  await until(page, page.getByRole('textbox', { name: 'Ask a question' }))
}

/** An answer on its way: on the mock, reading what it found; on the service, held while it looks up. */
const onTheWay = mode === 'http' ? 'Looking up context…' : /Reading \d+ context items?…/

async function until(page: Page, what: Locator) {
  while (!(await what.isVisible())) await page.clock.runFor(50)
}

test('Stop leaves an unfinished answer, said as such', async ({ page }) => {
  await held(page, '/ask?n=stop')
  await ask(page, 'Why did orders in Norway really drop in August?')
  await until(page, page.getByText(onTheWay))
  await page.getByRole('button', { name: 'Stop' }).click()
  const log = page.getByRole('log')
  await expect(log.getByText(/Stopped while/)).toBeVisible()
  // The notice and Ask again come into view; no source count is claimed.
  await expect(log.getByRole('button', { name: 'Ask again', exact: true })).toBeInViewport()
  await expect(log.getByText(STATE)).toHaveCount(0)
  await expect(log.getByText(/\d+ sources?$/)).toHaveCount(0)
  await log.getByRole('button', { name: 'Ask again', exact: true }).click()
  await until(page, log.getByText(STATE).first())
})

test('Escape stops an answer being written', async ({ page }) => {
  await held(page, '/ask?n=escape')
  await ask(page, 'Why did orders in Norway really drop in August?')
  await until(page, page.getByText(onTheWay))
  await page.keyboard.press('Escape')
  await expect(
    page
      .getByRole('log')
      .getByText(/Stopped/)
      .first(),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
})

test('a question that is already a chat opens that chat, typed or picked', async ({ page }) => {
  await go(page, '/ask?n=dedupe')
  const rows = page.getByRole('navigation', { name: 'Chats' }).locator('[data-open]')
  const question = 'Why did orders in Norway drop in August?'
  // The mock's history already has this question as a chat; a new history gets it now.
  await ask(page, question)
  await expect(page).toHaveURL(/[?&](example|chat)=/)
  const chat = new RegExp(`[?&]${/[?&]((?:example|chat)=[^&]+)/.exec(page.url())![1]}(&|$)`)
  const count = await rows.count()
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await expect(page).not.toHaveURL(chat)
  await ask(page, question)
  await expect(page).toHaveURL(chat)
  await expect(rows).toHaveCount(count)
})

test('the question shows the moment it is sent, and the words before the answer is done', async ({
  page,
}) => {
  test.skip(mode === 'http', 'the service in the journeys has no model to write words')
  await held(page, '/ask?n=stream')
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  // No time has passed: the question is in the chat, looking up, and Stop takes Ask's place.
  await expect(log.getByText(QUESTION)).toBeVisible()
  await expect(log.getByText('Looking up context…')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Looking up the answer.' }),
  ).toBeAttached()
  // The look-up's own steps, then the engine's answer: its state and sources before any words.
  await until(page, log.getByText(/Reading 1 context item…/))
  await until(page, log.getByText(STATE).first())
  await expect(log.getByText(/^1 source$/)).toBeVisible()
  await expect(log.getByText(FIRST)).toHaveCount(0)
  // The first sentence while the answer is still being written: the rest has not come yet.
  await until(page, log.getByText(FIRST))
  await expect(log.getByText(SECOND)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect(log.getByRole('button', { name: 'Good answer' })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Writing the answer.' })).toBeAttached()
  // Then the next, and the answer is done.
  await until(page, log.getByText(SECOND))
  await until(page, log.getByRole('button', { name: 'Good answer' }))
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Answer written.' })).toBeAttached()
})

test('Stop while the words are written keeps them, with the state and sources, and ends there', async ({
  page,
}) => {
  test.skip(mode === 'http', 'the service in the journeys has no model to write words')
  await held(page, '/ask?n=stop-writing')
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  await until(page, log.getByText(FIRST))
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(log.getByText('Stopped. This is not a finished answer.')).toBeVisible()
  // Focus stays in the box, where the next question goes (the editor focuses on its next frame).
  await page.clock.runFor(50)
  await expect(page.getByRole('textbox', { name: 'Ask a question' })).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: 'Stopped.' })).toBeAttached()
  // The state and the sources are the engine's, in before the words: they stay.
  await expect(log.getByText(STATE).first()).toBeVisible()
  await expect(log.getByText(/^1 source$/)).toBeVisible()
  // Nothing more comes, however long it waits, and Ask is ready.
  await page.clock.runFor(5000)
  await expect(log.getByText(FIRST)).toBeVisible()
  await expect(log.getByText(SECOND)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeVisible()
  // Stopped part way, the chat passes axe (which needs the page's clock running).
  await page.clock.resume()
  const found = await new AxeBuilder({ page })
    .include('[role=log]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(
    found.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`),
  ).toEqual([])
})

test('scrolled up to read, the view stays put while an answer is written', async ({ page }) => {
  test.skip(mode === 'http', 'the service in the journeys has no model to write words')
  await page.setViewportSize({ width: 1440, height: 520 })
  await held(page, '/ask?n=scroll')
  const view = page
    .locator('[role=log]')
    .locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]')
  // Two answers, so there is something above to read.
  for (const [i, q] of [QUESTION, 'Do Norway orders include gift-card money?'].entries()) {
    await ask(page, q)
    await until(
      page,
      page.locator(`[data-turn="${i}"]`).getByRole('button', { name: 'Good answer' }),
    )
  }
  await ask(page, QUESTION)
  await until(page, page.locator('[data-turn="2"]').getByText(STATE).first())
  // The reader scrolls up to the first answer while the third is written.
  await view.hover()
  await page.mouse.wheel(0, -5000)
  await expect.poll(() => view.evaluate((el) => el.scrollTop)).toBe(0)
  await until(page, page.locator('[data-turn="2"]').getByRole('button', { name: 'Good answer' }))
  await page.clock.runFor(1000)
  expect(await view.evaluate((el) => el.scrollTop)).toBe(0)
})

test('with reduced motion the sentences come in without a fade, and the answer is whole', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await go(page, '/ask?n=reduced')
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  await expect(log.locator('[data-turn]')).toHaveCount(1)
  await expect(log.getByText(/^\d+ sources?$/)).toBeVisible()
  await expect(log.getByRole('button', { name: 'Good answer' })).toBeVisible()
  // On the mock a model's words come a sentence at a time: each is there at once, with no fade.
  if (mode === 'mock') {
    const fade = await log
      .getByText(FIRST)
      .evaluate(
        (el) => getComputedStyle(el.closest('[class*="animate-in"]') ?? el).animationDuration,
      )
    expect(fade).toBe('0s')
    await expect(log.getByText(SECOND)).toBeVisible()
  }
})

test('the newest answer is fully in view, down to its actions', async ({ page }) => {
  await go(page, '/ask?n=view')
  for (const q of [
    'Why did orders in Norway really drop in August?',
    'Do Norway orders include gift-card money?',
  ]) {
    await ask(page, q)
    await expect(
      page
        .getByRole('log')
        .locator('[data-turn]')
        .last()
        .getByRole('button', { name: 'Good answer' }),
    ).toBeInViewport({ ratio: 1, timeout: 6000 })
  }
})
