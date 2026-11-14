import type { Page, Route } from '@playwright/test'
import { expect, go, mode, test, topicId } from './go.ts'

// J55, where a read stands, said in the place it fills (#198): a dock whose read fails keeps its
// frame, says so with Retry and closes with Close, never an empty strip; and the editor opened on
// an item that is not there says so, instead of a blank editor with Publish.

/** The dock: the page's own facets have an Answer region too, so it is the one that closes. */
const dock = (page: Page) =>
  page
    .getByRole('region', { name: 'Answer' })
    .filter({ has: page.getByRole('button', { name: 'Close the panel' }) })

/** Fails the first replay of `topic`: the mock by its ?replay=fail switch, the service by a 502. */
async function failFirstReplay(page: Page, topic: string) {
  if (mode === 'mock') return `/observability/questions?replay=fail&dock=topic.${topic}`
  let failed = false
  await page.route('**/api/v1/**', (route: Route) => {
    if (failed || !/replay/i.test(route.request().url())) return route.continue()
    failed = true
    return route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: '{"message":"Bad gateway"}',
    })
  })
  return `/observability/questions?dock=topic.${topic}`
}

test('a dock whose read fails keeps its frame, with Retry and Close', async ({ page }) => {
  const topic = topicId('units-sold-all')
  await go(page, '/observability/questions')
  await go(page, await failFirstReplay(page, topic))

  const panel = dock(page)
  await expect(panel).toBeVisible()
  const failed = panel.getByRole('alert').filter({ hasText: "Couldn't load this answer." })
  await expect(failed).toBeVisible()
  await expect(panel.getByRole('heading', { name: 'Answer', exact: true })).toBeVisible()

  // Retry reads it again, and the answer comes.
  await failed.getByRole('button', { name: 'Retry' }).click()
  await expect(failed).toHaveCount(0)
  await expect(panel.getByText('as agents get it now')).toBeVisible()

  // Close closes it, and the address with it.
  await panel.getByRole('button', { name: 'Close the panel' }).click()
  await expect(page).not.toHaveURL(/dock=/)
  await expect(page.getByRole('button', { name: 'Close the panel' })).toHaveCount(0)
  await expect(page.locator('[data-slot=resizable-panel]')).toHaveCount(1)
})

test('the editor on an item that is not there says so, with no Publish', async ({ page }) => {
  await go(page, '/context/itm_not_there/edit')
  await expect(page.getByText('No such context item')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveCount(0)
})
