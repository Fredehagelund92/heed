import type { Route } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J49, a page that is on screen when the service stops answering: the tab comes back after its reads
// went stale, the refresh fails, and the page stays as it was, with what was typed in it, and says
// the refresh failed. Try again reads the page again and the line goes. The mock answers a read it has answered
// once as it did, and can fail only a page's first load (?state=failed), so this runs on the
// service (http mode), where the reads can be refused.

test.skip(
  mode === 'mock',
  "The mock cannot refuse a read it has already answered: this refuses the service's",
)

test('a refresh that fails keeps the page and the half-written comment, and says so', async ({
  page,
}) => {
  await go(page, '/context/itm_s90n5xps')
  const heading = page.getByRole('heading', { level: 1 })
  await expect(heading).toBeVisible()
  const title = await heading.innerText()
  await page.getByRole('button', { name: 'Add a comment' }).click()
  const box = page.getByRole('textbox', { name: 'Write a comment' })
  await box.click()
  await page.keyboard.type('Half a comment, not posted yet')
  await expect(box).toContainText('Half a comment')

  // The reads go stale after 30 seconds; the clock jumps over them instead of waiting.
  await page.clock.install()
  // The service restarts: every read answers 502 until it is back.
  let down = true
  await page.route('**/api/v1/**', (route: Route) =>
    down && route.request().method() === 'GET'
      ? route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: '{"message":"Bad gateway"}',
        })
      : route.continue(),
  )
  await page.clock.fastForward(31_000)
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))

  const line = page.getByRole('status').filter({ hasText: "Couldn't refresh this context item." })
  await expect(line).toBeVisible()
  // The page is as it was: the same title, the box, and every word in it. No error replaced it.
  await expect(heading).toHaveText(title)
  await expect(box).toContainText('Half a comment, not posted yet')
  await expect(page.getByRole('alert').filter({ hasText: "Couldn't load" })).toHaveCount(0)

  // The service is back: Try again reads the page again, the line goes, and the words are still there.
  down = false
  await line.getByRole('button', { name: 'Try again' }).click()
  await expect(line).toHaveCount(0)
  await expect(heading).toHaveText(title)
  await expect(box).toContainText('Half a comment, not posted yet')
})
