import type { Locator, Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J39, one question at a time, as in any chat: while a question is answered, a second click, Enter
// or Send asks nothing, and Ask is ready again once the answer is in or has failed.

/**
 * Answers stay on their way until the test lets them come: time stands still, so the mock's answer
 * stays being written, and on the service each request is held as well.
 */
async function heldAnswers(page: Page, route: string) {
  let open = false
  if (mode === 'http')
    await page.route('**/api/v1/ask/lookup', async (r) => {
      while (!open) await new Promise((resolve) => setTimeout(resolve, 50))
      await r.continue()
    })
  await page.clock.install()
  await page.clock.pauseAt(Date.now() + 1000)
  await go(page, route)
  await until(page, box(page))
  return {
    release: () => {
      open = true
    },
    hold: () => {
      open = false
    },
  }
}

/** Time moves in small steps until what the test waits for is on screen. */
async function until(page: Page, what: Locator) {
  while (!(await what.isVisible())) await page.clock.runFor(50)
}

/** Time moves until the answer is written and Ask can ask again. */
async function ready(page: Page) {
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  const ask = page.getByRole('button', { name: 'Ask', exact: true })
  while ((await stop.isVisible()) || (await ask.getAttribute('aria-disabled')) === 'true')
    await page.clock.runFor(50)
  // The answer settles in on screen: its last label held, its words shown.
  await page.clock.runFor(1000)
}

const box = (page: Page) => page.getByRole('textbox', { name: 'Ask a question' })

test('a question on its way asks nothing more: not a second click, Enter or Send', async ({
  page,
}) => {
  const answers = await heldAnswers(page, '/ask?n=once')
  const asked = page
    .getByRole('navigation', { name: 'Chats' })
    .locator('[data-open]')
    .filter({ hasText: 'Net revenue in Norway' })
  const turns = page.locator('[data-turn]')

  // A double click on a question on offer asks it once.
  const row = page
    .getByRole('region', { name: 'Asked this week' })
    .getByRole('button', { name: /^Net revenue in Norway/ })
  await row.dblclick()
  // The question is in the chat at once, on its way, and the second click asked nothing.
  await until(page, page.getByRole('button', { name: 'Stop', exact: true }))
  await expect(turns).toHaveCount(1)
  // A typed question waits too: Stop has Ask's place, and Enter says so and sends nothing.
  await box(page).click()
  await box(page).pressSequentially('Why did orders in Norway drop in August?')
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).toHaveCount(0)
  await box(page).press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Still answering' })).toBeVisible()

  answers.release()
  await ready(page)
  await expect(turns).toHaveCount(1)
  await expect(
    page.getByRole('log').getByText('What should I know about Net revenue in Norway?'),
  ).toHaveCount(1)
  // The history has the question once.
  await expect(asked).toHaveCount(1)
  // The typed question was kept, to send once the answer is in.
  await expect(box(page)).toContainText('Why did orders in Norway drop in August?')

  // Once the answer is written Ask is itself again: the kept question goes, once.
  answers.hold()
  await box(page).press('Enter')
  await until(page, page.getByRole('button', { name: 'Stop', exact: true }))
  await expect(turns).toHaveCount(2)
  // While that one is written, Enter says so instead of asking.
  await box(page).pressSequentially('tell me a joke')
  await box(page).press('Enter')
  await expect(page.getByText('Still answering. Stop it to ask now.')).toBeVisible()
  answers.release()
  await ready(page)
  await expect(turns).toHaveCount(2)
  // Then it goes, once: a dead end, with questions to try instead.
  await box(page).press('Enter')
  await until(page, turns.nth(2))
  await ready(page)
  await expect(turns).toHaveCount(3)

  // A double click on a question to try instead asks it once.
  const instead = page.getByRole('log').getByRole('list', { name: 'Questions Ask can answer' })
  await expect(instead.getByRole('button').first()).not.toHaveAttribute('aria-disabled')
  await instead.getByRole('button').first().dblclick()
  await until(page, turns.nth(3))
  await ready(page)
  await expect(turns).toHaveCount(4)
})

test('a question that fails leaves Ask ready to ask, the question back in the box', async ({
  page,
}) => {
  // The mock answers every question; a refusal is the service's.
  test.skip(mode === 'mock', 'the mock never refuses a question')
  await page.route('**/api/v1/ask/lookup', (r) =>
    r.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'FORBIDDEN', status: 403, message: 'Not allowed.' }),
    }),
  )
  await go(page, '/ask?n=fails')
  const question = 'Why did orders in Norway drop in August?'
  await box(page).click()
  await box(page).pressSequentially(question)
  await box(page).press('Enter')
  await expect(page.getByText("Couldn't ask that")).toBeVisible()
  await expect(page.locator('[data-turn]')).toHaveCount(0)
  // Nothing waits on it: the question is back, Ask and the questions on offer can be used.
  await expect(box(page)).toContainText(question)
  await expect(page.getByRole('button', { name: 'Ask', exact: true })).not.toHaveAttribute(
    'aria-disabled',
  )
  await expect(
    page
      .getByRole('region', { name: 'Asked this week' })
      .getByRole('button', { name: /^Net revenue in Norway/ }),
  ).not.toHaveAttribute('aria-disabled')
  // Asked again, it is tried again rather than held.
  await page.getByRole('button', { name: 'Ask', exact: true }).click()
  await expect(page.getByText("Couldn't ask that")).toHaveCount(2)
})

test('offline, a chat in the history still opens, in Ask and in the assistant panel', async ({
  page,
}) => {
  if (mode === 'http') {
    // The service starts without chats: one is asked while online, so the history has it.
    await go(page, '/ask?n=offline')
    await box(page).click()
    await box(page).pressSequentially('Why did orders in Norway drop in August?')
    await box(page).press('Enter')
    // The chat joins the history once its answer is in.
    await expect(page.getByRole('button', { name: 'Good answer' })).toBeVisible()
  }
  await go(page, '/ask?n=offline&state=offline')
  const rows = page.getByRole('navigation', { name: 'Chats' }).locator('[data-open]')
  await rows.first().click()
  await expect(page.locator('[data-turn]')).toHaveCount(1)

  await go(page, '/context?n=offline&state=offline&dock=ask')
  await page.getByRole('button', { name: 'History' }).click()
  const history = page.getByRole('dialog', { name: 'History' })
  await history.locator('[data-open]').first().click()
  await expect(history).toHaveCount(0)
  await expect(page.locator('[data-turn]')).toHaveCount(1)
})
