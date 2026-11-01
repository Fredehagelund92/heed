import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J3, the frame around a chat: answers with sources scroll the thread only, never the page around
// it, so the composer stays at the foot of the screen.

async function ask(page: Page, question: string) {
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

test('Three answers with sources leave the page frame where it was', async ({ page }) => {
  await go(page, `/ask?n=${Date.now()}`)
  const log = page.getByRole('log')
  const questions = [
    'Why did orders in Norway drop in August?',
    'Do Norway orders include gift-card money?',
    'What should I know about Orders in Germany?',
  ]
  for (const [i, question] of questions.entries()) {
    await ask(page, question)
    // Each answer is finished, with its sources, before the next question.
    await expect(log.getByText(/^\d+ sources?$/)).toHaveCount(i + 1)
  }
  // The page holds nothing below the screen, so nothing can scroll it, and nothing has.
  const main = page.locator('main')
  expect(await main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0)
  expect(await main.evaluate((el) => el.scrollTop)).toBe(0)
})
