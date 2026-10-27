import type { Locator, Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J26: emoji where people talk to each other. ':' and two letters opens the same list as '@' (one
// popover, one keyboard model), the five reactions and what was used lately first; Enter inserts the
// character; ':tada:' typed out turns into 🎉; Esc closes. Context and definitions take no list: an
// emoji pasted there gets a quiet note, because agents read that text.

const emojiList = (page: Page) => page.getByRole('listbox', { name: 'Emoji' })

/** A paste as the browser sends it, with text on the clipboard. */
async function paste(target: Locator, text: string) {
  await target.evaluate((el, t) => {
    // The tests run without the DOM's types: the page's own classes, named here.
    const w = globalThis as unknown as {
      DataTransfer: new () => { setData: (type: string, value: string) => void }
      ClipboardEvent: new (type: string, init: object) => unknown
    }
    const data = new w.DataTransfer()
    data.setData('text/plain', t)
    ;(el as unknown as { dispatchEvent: (e: unknown) => boolean }).dispatchEvent(
      new w.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    )
  }, text)
}

test("a comment: ':th' offers thumbs up first, Enter inserts it, ':tada:' converts", async ({
  page,
}) => {
  await go(page, '/context/itm_norway_stop')
  const box = page.getByRole('textbox', { name: 'Write a comment' })
  await box.click()
  await page.keyboard.type('Looks right :th')
  const list = emojiList(page)
  await expect(list).toBeVisible()
  // A screen reader hears the emoji's name.
  await expect(list.getByRole('option').first()).toHaveAccessibleName('thumbs up :thumbsup:')
  await expect(list.getByRole('group', { name: 'Frequently used' })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(list).toHaveCount(0)
  await expect(box).toHaveText('Looks right 👍')
  await page.keyboard.type(' shipped :tada:')
  await expect(box).toHaveText('Looks right 👍 shipped 🎉')
})

test('Esc closes the list and keeps the words; a time like 10:30 opens nothing', async ({
  page,
}) => {
  await go(page, '/context/itm_norway_stop')
  const box = page.getByRole('textbox', { name: 'Write a comment' })
  await box.click()
  await page.keyboard.type('Back at 10:30 :sm')
  await expect(emojiList(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(emojiList(page)).toHaveCount(0)
  await expect(box).toHaveText('Back at 10:30 :sm')
  await page.keyboard.press('End')
  await box.press('Control+a')
  await page.keyboard.type('At 10:30 we')
  await expect(emojiList(page)).toHaveCount(0)
})

test('the Return note takes emoji too', async ({ page }) => {
  await go(page, '/inbox/sug-ines-format/review')
  await page.getByRole('button', { name: 'Return with a note' }).first().click()
  const note = page.getByRole('textbox', { name: /^A note for / })
  await note.click()
  await page.keyboard.type('Nearly there :ey')
  await expect(emojiList(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(note).toHaveText('Nearly there 👀')
})

test('in Ask, Enter picks from an open list instead of sending', async ({ page }) => {
  await go(page, '/ask')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await page.keyboard.type('Thanks :ta')
  await expect(emojiList(page)).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(box).toHaveText('Thanks 🎉')
  await expect(page.getByRole('log')).toHaveCount(0)
})

test('context takes no emoji list, and a pasted emoji gets a quiet note', async ({ page }) => {
  await go(page, '/context/new')
  const body = page.getByRole('textbox', { name: /What agents should know/ })
  await body.click()
  await page.keyboard.type('Orders :sm')
  await expect(emojiList(page)).toHaveCount(0)
  await paste(page.getByRole('textbox', { name: 'Title' }), 'Orders fell 🎉')
  await expect(page.getByText('Emoji in context are read by agents too')).toBeVisible()
})

test('on a phone the list is a sheet across the width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, '/context/itm_norway_stop')
  const box = page.getByRole('textbox', { name: 'Write a comment' })
  await box.scrollIntoViewIfNeeded()
  await box.click()
  await page.keyboard.type('Nice :sm')
  const sheet = page.locator('[cmdk-root]').filter({ has: emojiList(page) })
  await expect(sheet).toBeVisible()
  expect(Math.round((await sheet.boundingBox())!.width)).toBe(390)
})

// Where people talk, the talk itself: a comment with a mention, its reaction, edit and deletion,
// each kept by the service in http mode; a mention waits in the Inbox until it is read; and a
// return's note is the suggestion's first comment.

test('a comment names a person, takes a reaction, and is edited and deleted', async ({ page }) => {
  await go(page, '/context/itm_norway_stop')
  const box = page.getByRole('textbox', { name: 'Write a comment' })
  await box.click()
  await page.keyboard.type('Does the returns form change this, @Sof')
  await page.getByRole('option', { name: /Sofia Brandt/ }).click()
  await page.keyboard.type('?')
  await page.keyboard.press('ControlOrMeta+Enter')
  const mine = page.getByRole('article', { name: 'Jon Abara, Just now' })
  await expect(mine).toContainText('Does the returns form change this, Sofia Brandt')
  await expect(box).toHaveText('')

  await mine.getByRole('button', { name: 'Add a reaction' }).click()
  await page.getByRole('button', { name: 'Thanks', exact: true }).click()
  await expect(mine.getByRole('button', { name: /^Thanks, 1: / })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  // Kept, not only drawn: away and back, the comment and its reaction are still there.
  await go(page, '/inbox')
  await go(page, '/context/itm_norway_stop')
  await expect(mine).toContainText('Sofia Brandt')
  await expect(mine.getByRole('button', { name: /^Thanks, 1: / })).toBeVisible()

  await mine.getByRole('button', { name: "More for Jon Abara's comment" }).click()
  await page.getByRole('menuitem', { name: 'Edit' }).click()
  const edit = page.getByRole('textbox', { name: 'Edit your comment' })
  await edit.press('ControlOrMeta+a')
  await page.keyboard.type('Does the returns form change this?')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(mine).toContainText('Does the returns form change this?')
  await expect(mine).not.toContainText('Sofia Brandt')
  await expect(mine).toContainText('edited')

  await mine.getByRole('button', { name: "More for Jon Abara's comment" }).click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
  // The toast, not the deleted reply the thread already shows.
  await expect(
    page.getByRole('region', { name: /^Notifications/ }).getByText('Comment deleted'),
  ).toBeVisible()
  await expect(mine).toHaveCount(0)
  await go(page, '/inbox')
  await go(page, '/context/itm_norway_stop')
  await expect(page.getByRole('textbox', { name: 'Write a comment' })).toBeVisible()
  await expect(mine).toHaveCount(0)
})

test('a mention of you waits in the Inbox until you read it', async ({ page }) => {
  await go(page, '/inbox')
  const title = 'Regulator paused price promotions in Norway on 9 May 2026'
  const row = page.locator('[data-row]').filter({ hasText: title })
  await expect(row).toContainText('Tomas Eriksen')
  await row.click()
  await expect(page.getByText(/^Tomas Eriksen mentioned you, /)).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(page.getByText('The comment stays in the thread.')).toBeVisible()
  await expect(row).toHaveCount(0)
  // Read for good: the Inbox read again from the start no longer has it.
  await go(page, '/ask')
  await go(page, '/inbox')
  await expect(page.locator('[data-row]').first()).toBeVisible()
  await expect(row).toHaveCount(0)
})

test("a return's note is the suggestion's first comment", async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await decide.getByRole('button', { name: 'Return with a note' }).click()
  await page
    .getByRole('textbox', { name: 'A note for Ines Duarte' })
    .pressSequentially('Which page says 340?')
  await decide.getByRole('button', { name: 'Return to Ines' }).click()
  await expect(decide.getByText('Returned to Ines Duarte')).toBeVisible()
  const comments = page.getByRole('region', { name: /^Comments/ })
  const first = comments.getByRole('article').first()
  await expect(first).toContainText('Returned with a note')
  await expect(first).toContainText('Owner')
  await expect(first).toContainText('Which page says 340?')
})
