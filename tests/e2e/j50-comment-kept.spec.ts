import type { Page, Route } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J50, a comment keeps the person's words until the post is known. A post, a reply and an edit
// leave the box as it was while the service has not answered; when it refuses, the words are still
// there with a message, and Comment tries again. The mock cannot refuse a comment, so this runs on
// the service, with its requests held or failed in the browser.
test.skip(
  mode !== 'http',
  'it holds and fails real requests, which the mock cannot do for a comment',
)

const ITEM = '/context/itm_s90n5xps'
const WORDS = 'Three careful paragraphs about the Norway numbers.'

/** Every change to a comment (a post, a reply, an edit), as the app sends it to the service. */
const isCommentWrite = (route: Route) =>
  route.request().method() !== 'GET' && /\/api\/v1\/comments/.test(route.request().url())

const toasts = (page: Page) => page.locator('[data-sonner-toast]')

/** The comments written under the item, each named by its writer: the item's own page is an article too. */
const written = (page: Page) => page.getByRole('article', { name: /^Jon Abara, / })

async function startComment(page: Page) {
  await go(page, ITEM)
  await page.getByRole('button', { name: 'Add a comment' }).click()
  const box = page.getByRole('textbox', { name: 'Write a comment' })
  await box.click()
  await page.keyboard.type(WORDS)
  return box
}

test('a comment the service refuses keeps its words, says so, and posts on the next try', async ({
  page,
}) => {
  const box = await startComment(page)
  let refused = 0
  await page.route('**/api/v1/**', (route) => {
    if (!isCommentWrite(route)) return route.fallback()
    refused++
    return route.abort('failed')
  })
  await page.keyboard.press('ControlOrMeta+Enter')

  await expect(toasts(page).filter({ hasText: "Your comment wasn't saved" })).toBeVisible()
  expect(refused).toBe(1)
  // The words are where they were typed, and nothing was posted.
  await expect(box).toContainText(WORDS)
  await expect(written(page)).toHaveCount(0)

  await page.unroute('**/api/v1/**')
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(written(page).filter({ hasText: WORDS })).toHaveCount(1)
  await expect(box).toHaveText('')
})

test('the words stay in the box until the service has answered the post', async ({ page }) => {
  const box = await startComment(page)
  let answer!: () => void
  const held = new Promise<void>((resolve) => (answer = resolve))
  await page.route('**/api/v1/**', async (route) => {
    if (!isCommentWrite(route)) return route.fallback()
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  await page.getByRole('button', { name: 'Comment', exact: true }).click()

  // Sent, not answered: the words are still there, and a second Comment would post it twice.
  await expect(box).toContainText(WORDS)
  await expect(page.getByRole('button', { name: 'Comment', exact: true })).toBeDisabled()
  await expect(written(page)).toHaveCount(0)

  answer()
  await expect(written(page).filter({ hasText: WORDS })).toHaveCount(1)
  await expect(box).toHaveText('')
})

test('a reply and an edit the service refuses keep their words too', async ({ page }) => {
  await startComment(page)
  await page.getByRole('button', { name: 'Comment', exact: true }).click()
  const comment = written(page).filter({ hasText: WORDS })
  await expect(comment).toHaveCount(1)

  await page.route('**/api/v1/**', (route) =>
    isCommentWrite(route) ? route.abort('failed') : route.fallback(),
  )

  // A reply.
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  const reply = page.getByRole('textbox', { name: 'Reply to Jon' })
  await reply.fill('From 1 October.')
  await page.getByRole('button', { name: 'Reply', exact: true }).last().click()
  await expect(toasts(page).filter({ hasText: "Your reply wasn't saved" })).toBeVisible()
  await expect(reply).toContainText('From 1 October.')
  await page.getByRole('button', { name: 'Cancel' }).click()

  // An edit.
  await comment.hover()
  await page.getByRole('button', { name: "More for Jon Abara's comment" }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const edit = page.getByRole('textbox', { name: 'Edit your comment' })
  await edit.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' And the Spanish ones.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(toasts(page).filter({ hasText: "Your changes weren't saved" })).toBeVisible()
  await expect(edit).toContainText('And the Spanish ones.')

  // The service answers again: Save goes through, and the box closes on the new words.
  await page.unroute('**/api/v1/**')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(edit).toHaveCount(0)
  await expect(written(page).filter({ hasText: 'And the Spanish ones.' })).toHaveCount(1)
})
