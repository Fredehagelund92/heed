import type { Locator, Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

/** The six state words, as an answer's line says one. */
const STATE = /^(Checked|Partial|Not found|Conflict|Outdated|Not checked)$/

// J3, how an answer arrives: written over a second or two, stoppable, and at once with reduced motion.

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
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, route)
  await until(page, page.getByRole('textbox', { name: 'Ask a question' }))
}

async function until(page: Page, what: Locator) {
  while (!(await what.isVisible())) await page.clock.runFor(50)
}

test('Stop leaves an unfinished answer, said as such', async ({ page }) => {
  await held(page, '/ask?n=stop')
  await ask(page, 'Why did orders in Norway really drop in August?')
  await until(page, page.getByText(/Reading \d+ context items?…/))
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
  await until(page, page.getByText(/Reading \d+ context items?…/))
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

test('with reduced motion the answer is there at once, finished', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await go(page, '/ask?n=reduced')
  await ask(page, 'Why did orders in Norway really drop in August?')
  const log = page.getByRole('log')
  // The answer joins the chat once it is read (on the service, once the service answered).
  await expect(log.locator('[data-turn]')).toHaveCount(1)
  await expect(log.getByText(/^\d+ sources?$/)).toBeVisible({ timeout: 300 })
  await expect(log.getByText('Looking up context…')).toHaveCount(0)
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
