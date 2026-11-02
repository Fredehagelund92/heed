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
    await expect(log.getByRole('button', { name: 'Good answer' })).toHaveCount(i + 1)
  }
  // The page holds nothing below the screen, so nothing can scroll it, and nothing has.
  const main = page.locator('main')
  expect(await main.evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0)
  expect(await main.evaluate((el) => el.scrollTop)).toBe(0)
})

test('A turn is the question in its bubble and the answer under it, with no avatars, set apart from the next', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  const log = page.getByRole('log')
  for (const [i, question] of [
    'Why did orders in Norway drop in August?',
    'Do Norway orders include gift-card money?',
  ].entries()) {
    await ask(page, question)
    await expect(log.getByRole('button', { name: 'Good answer' })).toHaveCount(i + 1)
  }
  // No avatar beside the question or the answer: the answer starts at the thread's edge.
  await expect(log.locator('[data-slot=avatar]')).toHaveCount(0)
  const box = async (selector: string) => (await log.locator(selector).first().boundingBox())!
  const [thread, bubble, answer] = await Promise.all([
    box('[data-turn="0"]'),
    box('[data-turn="0"] .bg-muted.rounded-surface'),
    box('[data-turn="0"] .group\\/msg'),
  ])
  expect(answer.x).toBe(thread.x)
  // 38 px from the question to its own answer, 48 px from the answer's actions to the next question.
  expect(Math.round(answer.y - (bubble.y + bubble.height))).toBe(38)
  const next = await box('[data-turn="1"]')
  expect(Math.round(next.y - (thread.y + thread.height))).toBe(48)
})
