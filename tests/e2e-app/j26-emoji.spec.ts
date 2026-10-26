import { expect, test, type Locator, type Page } from '@playwright/test'
import { go } from './go.ts'

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
