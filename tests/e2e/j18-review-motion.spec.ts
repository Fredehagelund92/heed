import type { Page } from '@playwright/test'
import { cardIn, expect, go, settle, test } from './go.ts'

// J18, after a decision: a key skips the short wait, the pointer on the outcome holds it, reduced
// motion waits for Next, the Ready line stays put, and toasts keep clear of the decision.

const decide = (page: Page) => page.getByRole('complementary', { name: 'Try it and decide' })

/** Open a suggestion with time stopped, so only runFor moves it. */
async function open(page: Page, id: string) {
  await page.clock.install()
  await go(page, `/inbox/${id}/review`)
  await decide(page)
    .getByRole('button', { name: /Publish|Return/ })
    .first()
    .waitFor()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 500))
}

async function publish(page: Page) {
  await decide(page).getByRole('button', { name: 'Publish', exact: true }).click()
  await settle(page, 700)
  await expect(decide(page).getByRole('button', { name: 'Undo' })).toBeVisible()
}

test('J skips the wait at once', async ({ page }) => {
  await open(page, 'sug-ines-link')
  await publish(page)
  await page.keyboard.press('j')
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
})

test('the pointer on the outcome holds the wait; leaving lets it go on', async ({ page }) => {
  await open(page, 'sug-ines-link')
  await publish(page)
  await decide(page).getByRole('button', { name: 'Undo' }).hover()
  await page.clock.runFor(5000)
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-link')}/review`))
  await page.mouse.move(10, 10)
  await page.clock.runFor(3000)
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
})

test('with reduced motion nothing moves on its own: Next does it', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, 'sug-ines-link')
  await publish(page)
  await page.mouse.move(10, 10)
  await page.clock.runFor(6000)
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-link')}/review`))
  await decide(page).getByRole('button', { name: 'Next suggestion' }).click()
  await expect(page).toHaveURL(new RegExp(`${cardIn('sug-ines-order')}/review`))
})

test('the Ready line stays put when the outcome replaces the buttons', async ({ page }) => {
  await open(page, 'sug-ines-link')
  const ready = decide(page).getByText('Ready.', { exact: false }).first()
  const before = (await ready.boundingBox())!.y
  await publish(page)
  expect(Math.abs((await ready.boundingBox())!.y - before)).toBeLessThanOrEqual(1)
  await expect(decide(page).getByText('Agents now say')).toBeVisible()
})

test("a toast never covers the decision's buttons", async ({ page }) => {
  await open(page, 'sug-ines-format')
  // Read to the end of the change, as a reader scrolls to it.
  await page.getByText(/Counts as read after about \d+ seconds here./).scrollIntoViewIfNeeded()
  await expect(page.locator('[style*="readfill"]')).toHaveCSS('animation-play-state', 'running')
  await page.clock.runFor(8000)
  await page.getByRole('button', { name: "Publish the 1 you've read" }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Publish 1' }).click()
  await settle(page, 700)
  const toast = page.locator('[data-sonner-toast]').first()
  await expect(toast).toBeVisible()
  const t = (await toast.boundingBox())!
  for (const b of await decide(page).getByRole('button').all()) {
    const r = await b.boundingBox()
    if (!r) continue
    const overlaps =
      t.x < r.x + r.width && r.x < t.x + t.width && t.y < r.y + r.height && r.y < t.y + t.height
    expect(overlaps, (await b.textContent()) ?? '').toBe(false)
  }
})
