import { expect, go, test } from './go.ts'
import type { Locator, Page } from '@playwright/test'

// J41: the review's Preview is the item's page. Pressed, it shows the suggested version through
// the same view the context item's page draws (the title, the text with its links, who owns it and
// where it comes from, Details), so what the reviewer previews is what people read once it is
// published. Only what publishing sets says so.

const preview = (page: Page) => page.getByRole('region', { name: 'Preview' })
const doc = (within: Locator) => within.locator('[data-slot="item-document"]')

/** The view's elements and their classes, without the words: the same layout and type on both. */
const skeleton = (el: Locator) =>
  el.evaluate((root) => {
    const walk = (e: Element): unknown => ({
      // The title's level follows the page around it; its look does not.
      tag: /^H[1-6]$/.test(e.tagName) ? 'heading' : e.tagName,
      cls: e.getAttribute('class') ?? '',
      kids: [...e.children].map(walk),
    })
    return walk(root)
  })

async function openPreview(page: Page, id: string) {
  await go(page, `/inbox/${id}/review`)
  const button = page.getByRole('button', { name: 'Show the preview' })
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  await expect(doc(preview(page))).toBeVisible()
}

test('Preview draws the suggested version the way its item page does', async ({ page }) => {
  // A change of dates only, to a live item: the same text, so the same view, element by element.
  await openPreview(page, 'sug-ines-dates')
  const suggested = await skeleton(doc(preview(page)))
  await go(page, '/context/itm_spe2w9kh')
  const published = doc(page.getByRole('main'))
  await expect(published).toBeVisible()
  expect(suggested).toEqual(await skeleton(published))
})

test('Preview shows the new text, its link and its fields as the item page will', async ({
  page,
}) => {
  await go(page, '/context/itm_s90n5xps')
  const item = doc(page.getByRole('main'))
  const title = await item.getByRole('heading', { level: 1 }).textContent()
  const owned = await item.getByText(/^Sales - owned by/).textContent()
  const details = await item.getByRole('button', { name: /Details/ }).textContent()

  await openPreview(page, 'sug-ines')
  const draft = doc(preview(page))
  await expect(draft.getByRole('heading', { level: 3 })).toHaveText(title!)
  // The suggested text, with its new link drawn as the page draws a link.
  await expect(draft.getByText(/leaves out the 340 accounts/)).toBeVisible()
  await expect(draft.getByRole('button', { name: /accounts/ })).toBeVisible()
  await expect(draft.getByRole('link', { name: /units-sold-october/ })).toBeVisible()
  // Who owns it is as on the page; when it was checked is what publishing sets.
  await expect(draft.getByText(/^Sales - owned by/)).toHaveText(
    owned!.replace(/checked .*$/, 'checked when you publish it'),
  )
  await expect(draft.getByRole('button', { name: /Details/ })).toHaveText(details!)
  // The suggestion's comments are the review's; the item's own history is not drawn.
  await expect(preview(page).getByText('History')).toHaveCount(0)
})

test('Preview of a new item, and of an archive, which has no page', async ({ page }) => {
  await openPreview(page, 'gap-spain')
  await expect(doc(preview(page)).getByRole('heading', { level: 3 })).toHaveText(
    'Card payments in Spain failed from 14 to 16 October 2026',
  )
  // The preview stays on through the queue.
  await go(page, '/inbox/sug-lars-retire/review')
  await expect(page.getByRole('button', { name: 'Show the preview' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(preview(page)).toContainText('Archived, it has no page agents read.')
  await expect(doc(preview(page))).toHaveCount(0)
})
