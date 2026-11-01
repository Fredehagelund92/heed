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
  return () => {
    open = true
  }
}

/** Time moves in small steps until what the test waits for is on screen. */
async function until(page: Page, what: Locator) {
  while (!(await what.isVisible())) await page.clock.runFor(50)
}

const box = (page: Page) => page.getByRole('textbox', { name: 'Ask a question' })

test('a question on its way asks nothing more: not a second click, Enter or Send', async ({
  page,
}) => {
  const release = await heldAnswers(page, '/ask?n=once')
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
  // On the service, while it is answered the questions on offer say they wait, and a click on one
  // asks nothing. The mock's answer is at once there, and the chat shows it being written.
  if (mode === 'http') {
    await expect(row).toHaveAttribute('aria-disabled', 'true')
    await row.click({ force: true })
  } else await until(page, page.getByRole('button', { name: 'Stop', exact: true }))
  // A typed question waits too: Enter and Send say so and send nothing.
  await box(page).click()
  await box(page).pressSequentially('Why did orders in Norway drop in August?')
  const ask = page.getByRole('button', { name: 'Ask', exact: true })
  if (mode === 'http') await expect(ask).toHaveAttribute('aria-disabled', 'true')
  await box(page).press('Enter')
  await expect(page.getByRole('status').filter({ hasText: 'Still answering' })).toBeVisible()
  if (mode === 'http') await ask.click({ force: true })

  release()
  const next = page.getByRole('group', { name: 'Ask next, and what you would get' })
  await until(page, next.getByRole('button').first())
  await expect(turns).toHaveCount(1)
  await expect(
    page.getByRole('log').getByText('What should I know about Net revenue in Norway?'),
  ).toHaveCount(1)
  // The history has the question once.
  await expect(asked).toHaveCount(1)
  // The typed question was kept, to send once the answer is in.
  await expect(box(page)).toContainText('Why did orders in Norway drop in August?')

  // Once the answer is written Ask is itself again, and a double click on what to ask next asks once.
  await expect(next.getByRole('button').first()).not.toHaveAttribute('aria-disabled')
  await next.getByRole('button').first().dblclick()
  await until(page, page.getByRole('button', { name: 'Stop', exact: true }))
  await expect(turns).toHaveCount(2)
  // While that one is written, Enter says so instead of asking.
  await box(page).press('Enter')
  await expect(page.getByText('Still answering. Stop it to ask now.')).toBeVisible()
  await until(page, ask)
  await expect(turns).toHaveCount(2)
  // Then the kept question goes, once.
  await box(page).press('Enter')
  await until(page, turns.nth(2))
  await expect(turns).toHaveCount(3)
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
