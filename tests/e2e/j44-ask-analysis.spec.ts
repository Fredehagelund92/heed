import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J44: Ask answers the question asked, or says it did not (FR-720). An analysis of the records has
// its sections, each count with its denominator, and says what it cannot see; a question beyond
// what is written gets a fixed sentence, then what is; one nothing can answer reads nothing.

async function ask(page: Page, question: string) {
  await go(page, `/ask?n=${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

test('what is missing is an analysis in sections, never a count of what is there', async ({
  page,
}) => {
  await ask(page, 'what definitions are missing?')
  await expect(page.getByText('Counted from the workspace')).toBeVisible()
  await expect(
    page.getByRole('heading', { name: /^No context written: \d+ of 22 metrics$/ }),
  ).toBeVisible()
  await expect(page.getByText(/^Not seen: /)).toBeVisible()
  await expect(page.getByText(/\d+ definitions: /)).toHaveCount(0)
  await expect(page.getByText('Agents did not read this answer.', { exact: false })).toBeVisible()
})

test('what has no context is no question about a person', async ({ page }) => {
  await ask(page, 'which metrics have no context written?')
  await expect(page.getByText(/^\d+ of 22 metrics have no context written/)).toBeVisible()
  await expect(page.getByText("one person's work")).toHaveCount(0)
})

test('the Inbox read names only what waits for the person', async ({ page }) => {
  await ask(page, 'what is waiting on me?')
  await expect(page.getByRole('link', { name: 'Open your Inbox' })).toBeVisible()
})

// The scripted plans run in the mock binding and on the service alike, on the demo's own world.
test('a question beyond what is written leads with the limit, and keeps its state', async ({
  page,
}) => {
  await ask(page, 'what should we do about Norway?')
  await expect(page.getByText('What to do is not written down. Here is what is.')).toBeVisible()
})

test('what Ask cannot do it says, with what it can show', async ({ page }) => {
  await ask(page, 'what would you change in the definition of churn rate?')
  await expect(
    page.getByText('Definitions live in your source tool, so Ask cannot change one.'),
  ).toBeVisible()
  await expect(page.getByText(/^Changes to context/)).toHaveCount(0)
  await ask(page, 'draft context for Orders in Spain')
  await expect(page.getByRole('link', { name: 'Write context' })).toBeVisible()
  await ask(page, 'which market is growing fastest?')
  await expect(
    page.getByText(/^Heed keeps no numbers, so Ask cannot work this out\. An agent/),
  ).toBeVisible()
})

test('a follow-up keeps the analysis and changes its domain', async ({ page }) => {
  test.skip(mode === 'http', 'The demo week of the http run has its own counts')
  await ask(page, 'which metrics have no context written?')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await expect(page.getByText(/^13 of 22 metrics/)).toBeVisible()
  await box.click()
  await box.pressSequentially('and in Sales?')
  await box.press('Enter')
  await expect(page.getByText(/^5 of 10 metrics in Sales/)).toBeVisible()
})
