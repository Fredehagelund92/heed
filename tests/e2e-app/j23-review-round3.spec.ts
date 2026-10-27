import type { Page } from '@playwright/test'
import { allHandled, cardIn, expect, go, place, queue, settle, test } from './go.ts'

// J23, review round 3: focus moves to the change after J, K or a decision, and the new suggestion
// is announced; after the last decision the review says everything is handled, with Undo; the
// bulk toast never covers the change.

const decide = (page: Page) => page.getByRole('complementary', { name: 'Try it and decide' })

test('after J, focus is on the change and the suggestion is announced', async ({ page }) => {
  await go(page, '/inbox/sug-ines-link/review')
  await expect(decide(page).getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
  await page.keyboard.press('j')
  await expect(page).toHaveURL(new RegExp(cardIn('sug-ines-order')))
  await expect(page.locator('#change-heading')).toBeFocused()
  await expect(
    page.getByRole('status').filter({ hasText: `Suggestion ${place('sug-ines-order')}: ` }),
  ).toBeAttached()
})

test('after the last decision: all handled, with Undo for the last one', async ({ page }) => {
  await page.clock.install()
  await go(page, '/inbox/sug-ines-link/review?demo=last')
  await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
  await settle(page, 700)
  await expect(decide(page).getByRole('button', { name: 'Undo' })).toBeVisible()
  await page.keyboard.press('j')
  await expect(page.getByRole('heading', { name: `All ${queue().length} handled` })).toBeVisible()
  await expect(page.getByText(allHandled(), { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Undo the last one' }).click()
  await expect(decide(page).getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
})

test('the bulk toast sits at the bottom right, clear of the change', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await go(page, '/inbox/sug-ines-format/review')
  await page.getByRole('button', { name: 'Mark as read' }).click()
  await page.getByRole('button', { name: "Publish the 1 you've read" }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Publish 1' }).click()
  const toast = page.locator('[data-sonner-toast]').first()
  await expect(toast).toBeVisible()
  const t = (await toast.boundingBox())!
  const change = (await page
    .locator('#change-heading')
    .locator("xpath=ancestor::div[contains(@class, 'max-w-3xl')][1]")
    .boundingBox())!
  expect(t.x).toBeGreaterThanOrEqual(change.x + change.width - 1)
  expect(t.x + t.width).toBeLessThanOrEqual(1440)
})
