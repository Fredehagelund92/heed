import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J57: a word is cut only when the room is gone. An Inbox title that fits in two lines is not cut
// to one, and a Context row's scope chips keep their words (a market or a domain is data) while
// the room allows: when the column is tight the metric chip gives way first.

/**
 * What is cut inside `scope` while room was left: a text that an ellipsis shortens on one line,
 * or one that a clamp stops short of two lines. A text that fills its two lines and still needs
 * a third is out of room, and is allowed to end there.
 */
async function cutWords(page: Page, scope: string) {
  return page.evaluate((selector) => {
    const cut: string[] = []
    for (const el of document.querySelectorAll<HTMLElement>(`${selector} *`)) {
      if (el.children.length || !el.textContent?.trim()) continue
      const line = parseFloat(getComputedStyle(el).lineHeight)
      const shortened = el.scrollWidth > el.clientWidth + 1
      const stopped = el.scrollHeight > el.clientHeight + 1 && el.clientHeight < line * 2 - 1
      if (shortened || stopped) cut.push(el.textContent.trim())
    }
    return cut
  }, scope)
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
]) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport })

    test('no Inbox title or sentence is cut while two lines would hold it', async ({ page }) => {
      await go(page, '/inbox')
      await expect(page.locator('[data-row-open]').first()).toBeVisible()
      expect(await cutWords(page, '[data-row-open]')).toEqual([])
    })

    test('no scope chip of a market, a domain or a dimension is cut', async ({ page }) => {
      await go(page, '/context')
      await expect(page.locator('[data-row-open]').first()).toBeVisible()
      // A metric chip (the sigma) may give way when the column is tight; nothing else may.
      const cut = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('td [title]')]
          .filter((chip) => !chip.querySelector('svg.lucide-sigma'))
          .map((chip) => chip.querySelector<HTMLElement>(':scope > span.truncate'))
          .filter((el) => el && el.scrollWidth > el.clientWidth + 1)
          .map((el) => el!.textContent),
      )
      expect(cut).toEqual([])
    })
  })
}
