import type { Locator, Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J49, the Ask chat session: a chat joins the history with its first answered turn, whichever
// button asked it; a chat this page started opens again, on Back, as the history opens it; and
// one stopped turn does not stop the rest of a chat being kept (the loop's, on the mock: ?loop=1).
// Time stands still, so a stop lands while the answer is on its way.

const STATE = /^(Checked|Partial|Not found|Conflict|Outdated|Not checked)$/
const QUESTION = 'Why did orders in Norway really drop in August?'
const FOLLOW_UP = 'And what about Sweden?'
const LAST = 'And what about Denmark?'

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}
async function until(page: Page, what: Locator) {
  while (!(await what.isVisible())) await page.clock.runFor(50)
}
/** Time moves until the answer is written and Ask can ask again. */
async function settle(page: Page) {
  for (let i = 0; i < 60; i++) await page.clock.runFor(100)
}
/**
 * Time stands still, so the mock's answer stays on its way; on the service each look-up is held
 * as well, until the test lets it come (`release`) or holds the next (`hold`).
 */
async function held(page: Page, route: string, start = true) {
  let open = start
  if (mode === 'http')
    await page.route('**/api/v1/ask/lookup', async (r) => {
      while (!open) await new Promise((resolve) => setTimeout(resolve, 50))
      await r.continue()
    })
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, route)
  await until(page, page.getByRole('textbox', { name: 'Ask a question' }))
  return {
    release: () => {
      open = true
    },
    hold: () => {
      open = false
    },
  }
}
const chats = (page: Page) => page.getByRole('navigation', { name: 'Chats' })
async function stopTurn(page: Page) {
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  await until(page, stop)
  await stop.click()
}
const chatParam = (page: Page) => new URL(page.url()).searchParams.get('chat')

test('a first question that is answered joins the history', async ({ page }) => {
  await held(page, '/ask?n=j49a')
  await ask(page, QUESTION)
  await until(page, page.getByRole('log').getByText(STATE).first())
  await expect(chats(page).getByText(QUESTION)).toHaveCount(1)
  expect(chatParam(page)).not.toBeNull()
})

test('a first question that was stopped joins once Ask again has answered it', async ({ page }) => {
  const answers = await held(page, '/ask?n=j49b', false)
  await ask(page, QUESTION)
  await stopTurn(page)
  // Stopped: nothing is answered, so nothing has joined.
  await settle(page)
  await expect(chats(page).getByText(QUESTION)).toHaveCount(0)
  expect(chatParam(page)).toBeNull()

  answers.release()
  const log = page.getByRole('log')
  await log.getByRole('button', { name: 'Ask again', exact: true }).click()
  await until(page, log.getByText(STATE).first())
  await settle(page)
  await expect(log.getByText(STATE)).toHaveCount(1)
  await expect(chats(page).getByText(QUESTION)).toHaveCount(1)
  expect(chatParam(page)).not.toBeNull()
})

test('a follow-up answered after a stopped first question starts the chat', async ({ page }) => {
  const answers = await held(page, '/ask?n=j49c', false)
  await ask(page, QUESTION)
  await stopTurn(page)
  await settle(page)
  answers.release()
  await ask(page, FOLLOW_UP)
  await until(page, page.getByRole('log').getByText(STATE).first())
  await settle(page)
  await expect(chats(page).getByText(FOLLOW_UP)).toHaveCount(1)
  expect(chatParam(page)).not.toBeNull()
})

test('the dock starts a chat the same way: a stopped first question joins once answered', async ({
  page,
}) => {
  const answers = await held(page, '/context?n=j49d&dock=ask', false)
  const dock = page.getByTestId(/^dock-/)
  await ask(page, QUESTION)
  await stopTurn(page)
  await settle(page)
  answers.release()
  const log = dock.getByRole('log')
  await log.getByRole('button', { name: 'Ask again', exact: true }).click()
  await until(page, log.getByText(STATE).first())
  await settle(page)
  await dock.getByRole('button', { name: 'History' }).click()
  await expect(page.getByRole('dialog', { name: 'History' }).getByText(QUESTION)).toHaveCount(1)
})

test('Back to a chat this page started opens it as the history does, with what was kept', async ({
  page,
}) => {
  test.skip(mode === 'http', "the loop's answers come from the mock flag")
  await held(page, '/ask?n=j49e&loop=1')
  const log = page.getByRole('log')
  await ask(page, QUESTION)
  await until(page, log.getByText(STATE).first())
  await settle(page)
  await ask(page, FOLLOW_UP)
  await until(page, log.getByText(STATE).nth(1))
  await settle(page)
  const started = page.url()

  // Open another chat from the history, then come Back.
  await chats(page).locator('[data-open]').filter({ hasNotText: QUESTION }).first().click()
  await expect(page).not.toHaveURL(started)
  await settle(page)
  await page.goBack()
  await expect(page).toHaveURL(started)
  await settle(page)
  // Both questions, as the history shows them: not the first alone.
  await expect(log.getByText(QUESTION)).toHaveCount(1)
  await expect(log.getByText(FOLLOW_UP)).toHaveCount(1)
})

test('one stopped turn does not stop the rest of a chat being kept', async ({ page }) => {
  test.skip(mode === 'http', "the loop's answers come from the mock flag")
  const answers = await held(page, '/ask?n=j49f&loop=1')
  const log = page.getByRole('log')
  await ask(page, QUESTION)
  await until(page, log.getByText(STATE).first())
  await settle(page)
  answers.hold()
  await ask(page, FOLLOW_UP)
  await stopTurn(page)
  await settle(page)
  answers.release()
  await ask(page, LAST)
  await until(page, log.getByText(STATE).nth(1))
  await settle(page)
  const started = page.url()

  await chats(page).locator('[data-open]').filter({ hasNotText: QUESTION }).first().click()
  await expect(page).not.toHaveURL(started)
  await settle(page)
  await page.goBack()
  await expect(page).toHaveURL(started)
  await settle(page)
  // The answered turns were kept; the stopped one was left out.
  await expect(log.getByText(QUESTION)).toHaveCount(1)
  await expect(log.getByText(LAST)).toHaveCount(1)
  await expect(log.getByText(FOLLOW_UP)).toHaveCount(0)
})
