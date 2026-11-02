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

/** An answer's words on screen, not a screen reader's copy of the sentences being written. */
const words = (log: Locator, text: string | RegExp) =>
  log.locator('[data-answer-words]').getByText(text)

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
async function held(page: Page, route: string, holdLookUp = true) {
  // On the service the look-up answers at once: the first is held, so its answer stays on its way.
  let looked = 0
  if (mode === 'http' && holdLookUp)
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
  await expect(log.getByRole('button', { name: /^Source \d+: / })).toHaveCount(0)
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
  // No time has passed: the question is in the chat and Stop takes Ask's place.
  await expect(log.getByText(QUESTION)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  // A look-up that is not done within moments says so.
  await expect(log.getByText('Looking up context…')).toHaveCount(0)
  await until(page, log.getByText('Looking up context…'))
  await expect(
    page.getByRole('status').filter({ hasText: 'Looking up the answer.' }),
  ).toBeAttached()
  // The look-up's own steps, then the engine's answer: its state and sources before any words.
  await until(page, log.getByText(/Reading 1 context item…/))
  await until(page, log.getByText(STATE).first())
  await expect(log.getByRole('button', { name: /^Source \d+: / })).toHaveCount(1)
  await expect(words(log, FIRST)).toHaveCount(0)
  // The first sentence while the answer is still being written: the rest has not come yet.
  await until(page, words(log, FIRST))
  await expect(words(log, SECOND)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
  await expect(log.getByRole('button', { name: 'Good answer' })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Writing the answer.' })).toBeAttached()
  // Then the next, and the answer is done.
  await until(page, words(log, SECOND))
  await until(page, log.getByRole('button', { name: 'Good answer' }))
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'Answer written.' })).toBeAttached()
})

test('the first question of a new chat arrives as a follow-up does, one that is already a chat too', async ({
  page,
}) => {
  test.skip(mode === 'http', 'the service in the journeys has no model to write words')
  // Ask as it opens, with no chat: the question at once, then the answer as it is written, in the
  // same thread, which only moves to the chat once it has its answer.
  await held(page, '/ask')
  const rows = page.getByRole('navigation', { name: 'Chats' }).locator('[data-open]')
  const log = page.getByRole('log')
  const firstAsk = async () => {
    await ask(page, QUESTION)
    // No time has passed: the question is in the thread, Stop in Ask's place.
    const question = log.getByText(QUESTION)
    await expect(question).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    const shown = await question.elementHandle()
    // The look-up's steps, the state and sources, then the words before the answer is done.
    await until(page, log.getByText(/Reading 1 context item…/))
    await until(page, log.getByText(STATE).first())
    await expect(log.getByRole('button', { name: /^Source \d+: / })).toHaveCount(1)
    await until(page, words(log, FIRST))
    await expect(words(log, SECOND)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await until(page, log.getByRole('button', { name: 'Good answer' }))
    await expect(words(log, SECOND)).toBeVisible()
    // The thread was never started again: the question shown at first is the one still there.
    expect(await shown.evaluate((el) => el.isConnected)).toBe(true)
    await expect(page).toHaveURL(/[?&]chat=chat-/)
  }
  await firstAsk()
  const chat = new URL(page.url()).searchParams.get('chat')!
  const count = await rows.count()
  // A new chat with the same question, now a chat in the history: answered as it is written too,
  // and it is that chat, not a second one.
  await page.getByRole('button', { name: 'New chat' }).first().click()
  await until(
    page,
    page.getByRole('heading', { name: 'What do you want to know about the numbers?' }),
  )
  await firstAsk()
  expect(new URL(page.url()).searchParams.get('chat')).toBe(chat)
  await expect(rows).toHaveCount(count)
})

test('Stop while the words are written finishes the sentence on screen, keeps the state and sources, and ends there', async ({
  page,
}) => {
  test.skip(mode === 'http', 'the service in the journeys has no model to write words')
  await held(page, '/ask?n=stop-writing')
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  // Stopped part way through the first sentence, which was checked before any of it showed.
  await until(page, words(log, 'customs'))
  await expect(words(log, FIRST)).toHaveCount(0)
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(log.getByText('Stopped. This is not a finished answer.')).toBeVisible()
  await until(page, words(log, FIRST))
  // Focus stays in the box, where the next question goes (the editor focuses on its next frame).
  await page.clock.runFor(50)
  await expect(page.getByRole('textbox', { name: 'Ask a question' })).toBeFocused()
  await expect(page.getByRole('status').filter({ hasText: 'Stopped.' })).toBeAttached()
  // The state and the sources are the engine's, in before the words: they stay.
  await expect(log.getByText(STATE).first()).toBeVisible()
  await expect(log.getByRole('button', { name: /^Source \d+: / })).toHaveCount(1)
  // Nothing more comes, however long it waits, and Ask is ready.
  await page.clock.runFor(5000)
  await expect(words(log, FIRST)).toBeVisible()
  await expect(words(log, SECOND)).toHaveCount(0)
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

test('Stop and Escape stay until the last word shows, after the answer is in', async ({ page }) => {
  test.skip(mode === 'http', 'the service in the journeys has no model to write words')
  await held(page, '/ask?n=stop-reveal')
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  // The answer is in, and its last sentence is still on its way to the screen: Stop stays.
  await until(page, page.getByRole('status').filter({ hasText: 'Answer written.' }))
  await expect(words(log, SECOND)).toHaveCount(0)
  await expect(stop).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toHaveCount(0)
  // It goes with the last word, as the answer's actions come.
  await until(page, words(log, SECOND))
  await until(page, log.getByRole('button', { name: 'Good answer' }))
  await expect(stop).toHaveCount(0)

  // Escape in that moment stops it too: the sentence on screen ends, and it says it was stopped.
  await ask(page, QUESTION)
  const next = page.locator('[data-turn="1"]')
  await until(page, words(next, FIRST))
  await until(page, page.getByRole('status').filter({ hasText: 'Answer written.' }))
  await expect(words(next, SECOND)).toHaveCount(0)
  await expect(stop).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(next.getByText('Stopped. This is not a finished answer.')).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'Stopped.' })).toBeAttached()
  await page.clock.runFor(1000)
  await expect(stop).toHaveCount(0)
  await expect(next.getByRole('button', { name: 'Good answer' })).toHaveCount(0)
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

test('with reduced motion each sentence comes in whole, with no fade, and the answer is whole', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await held(page, '/ask?n=reduced', false)
  await ask(page, QUESTION)
  const log = page.getByRole('log')
  // On the mock a model's words come a sentence at a time: each is there whole as it comes, and
  // nothing fades in.
  if (mode === 'mock') {
    await until(page, log.getByText('customs', { exact: true }))
    await expect(words(log, FIRST)).toBeVisible()
    await expect(words(log, SECOND)).toHaveCount(0)
    const fade = await log
      .getByText('customs', { exact: true })
      .evaluate((el) => getComputedStyle(el).animationDuration)
    expect(fade).toBe('0s')
  }
  await until(page, log.getByRole('button', { name: 'Good answer' }))
  await expect(log.getByRole('button', { name: /^Source \d+: / }).first()).toBeVisible()
  if (mode === 'mock') await expect(words(log, SECOND)).toBeVisible()
})

test('a new question goes to the top of the view, and the view stays put as its answer ends', async ({
  page,
}) => {
  await go(page, '/ask?n=view')
  const view = page
    .locator('[role=log]')
    .locator('xpath=ancestor::*[contains(@class,"overflow-y-auto")][1]')
  for (const q of [
    'Why did orders in Norway really drop in August?',
    'Do Norway orders include gift-card money?',
  ]) {
    await ask(page, q)
    const turn = page.getByRole('log').locator('[data-turn]').last()
    await expect(turn.getByRole('button', { name: 'Good answer' })).toBeVisible({ timeout: 6000 })
    // Its question is at the top of the view, with the answer under it.
    const offset = async () => (await turn.boundingBox())!.y - (await view.boundingBox())!.y
    await expect.poll(offset).toBeGreaterThanOrEqual(0)
    await expect.poll(offset).toBeLessThan(40)
    // Once the scroll to it has come to rest, the answer stays where it is: nothing scrolls it.
    const top = () => view.evaluate((el) => el.scrollTop)
    let at = await top()
    for (let was = -1; was !== at; at = await top()) {
      was = at
      await page.waitForTimeout(150)
    }
    await page.waitForTimeout(500)
    expect(await view.evaluate((el) => el.scrollTop)).toBe(at)
  }
})
