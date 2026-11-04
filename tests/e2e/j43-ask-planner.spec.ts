import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J43: Ask's planner (FR-719). A question the rules cannot read is read by the model, which only
// chooses Ask's reads: "any interesting jumps that can be explained?" gets the guides and events
// that apply, with the state from them and a line that says how the model read it. A follow-up
// carries the last question ("what about Sweden?" after Orders in Norway) and says so. A question
// that could mean two things gets one short question back, in prose, and a question off topic
// its own sentence; neither looked anything up. Nothing in the chat suggests what to ask next.
// The mock binding plans with the scripted planner, as the service does on the mock.

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  // One question at a time: the last answer is written to its end first.
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled()
  await box.press('Enter')
}

/** The newest turn of the chat. */
const newest = (page: Page) => page.getByRole('log').locator('[data-turn]').last()

/** Nothing in the chat is a question to press: no chips, no suggestions. */
async function suggestsNothing(page: Page) {
  const log = page.getByRole('log')
  await expect(log.getByRole('button', { name: /^(?!Something wrong\?$).*\?$/ })).toHaveCount(0)
  await expect(page.getByRole('group', { name: /Ask next|Suggested questions/ })).toHaveCount(0)
}

test('a question that names nothing is read by the model and answered from the context', async ({
  page,
}) => {
  await go(page, '/ask?n=j43')
  await ask(page, 'any interesting jumps that can be explained?')
  const turn = newest(page)
  await expect(
    turn.getByText(/^Read by the model as guides with the words jumps and explained, and events/),
  ).toBeVisible()
  await expect(turn.getByText("The question doesn't name a metric or a market.")).toHaveCount(0)
  // The sources are what the reads found: the guide on what to rule out comes first.
  await expect(
    turn.getByRole('button', {
      name: /^Source \d+: What to rule out before explaining a jump in Orders$/,
    }),
  ).toBeVisible()
  await expect(turn.getByText(/^Looked up \d+ context items/)).toBeVisible()
  await suggestsNothing(page)
})

test('a follow-up carries the last question, and says what it carried', async ({ page }) => {
  await go(page, '/ask?n=j43')
  await ask(page, 'why did orders drop in Norway?')
  await expect(page.getByRole('status').filter({ hasText: 'Answer written.' })).toBeVisible()
  await ask(page, 'what about Sweden?')
  const turn = newest(page)
  await expect(
    turn.getByText(
      'Read by the model as Orders in Sweden, at any date, with Orders carried from your last question',
    ),
  ).toBeVisible()
  // Read at any date, the Sweden item from before 19 January 2026 is found: no dead end.
  await expect(
    turn.getByRole('button', {
      name: 'Source 1: Data for Orders before 19 January 2026 is not reliable',
    }),
  ).toBeVisible()
  await expect(turn.getByText('Checked', { exact: true })).toBeVisible()
  await suggestsNothing(page)
})

test('a question that could mean two things gets one question back, in prose', async ({ page }) => {
  await go(page, '/ask?n=j43')
  await ask(page, 'how is Sweden doing?')
  const turn = newest(page)
  await expect(turn.getByText('Do you mean Orders or Net revenue in Sweden?')).toBeVisible()
  await expect(turn.getByText('Nothing was looked up')).toBeVisible()
  // No state, no sources, and the question back is words, not choices to press.
  await expect(turn.getByText(/^(Checked|Partial|Not found|Conflict|Outdated)$/)).toHaveCount(0)
  await expect(turn.getByRole('button', { name: /Orders|Net revenue/ })).toHaveCount(0)
  await suggestsNothing(page)
  // The answer to it carries its market.
  await expect(page.getByRole('status').filter({ hasText: 'Answer written.' })).toBeVisible()
  await ask(page, 'orders')
  await expect(
    newest(page).getByText(/^Read by the model as Orders in Sweden, today/),
  ).toBeVisible()
})

test('a question off topic gets its own sentence, not the one about names', async ({ page }) => {
  await go(page, '/ask?n=j43')
  await ask(page, "what's the weather in Oslo?")
  const turn = newest(page)
  await expect(
    turn.getByText(/^Ask answers questions about the business, its numbers and what is written/),
  ).toBeVisible()
  await expect(turn.getByText("The question doesn't name a metric or a market.")).toHaveCount(0)
  await expect(turn.getByText(/^Ask answers three kinds of question/)).toHaveCount(0)
  await suggestsNothing(page)
})
