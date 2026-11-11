import { expect, go, test } from './go.ts'

// J14 on a phone: below 768 px the decision is in two places, the panel under the change and the bar
// along the bottom edge, and they are one decision. A failure is one failure, and Try again from
// either place does the action that failed. It once published instead, which archived the item.

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

test('on a phone, Try again after a failed Close closes, from either place', async ({ page }) => {
  await go(page, '/inbox/sug-lars-retire/review?state=failed')
  const close = page.getByRole('button', { name: 'Close the suggestion' })
  await expect(close).toHaveCount(2)
  // The bar's Close fails.
  await close.last().click()
  // One failure line for one failed action, and a way to try again in each place.
  await expect(page.getByText("Couldn't close it.")).toHaveCount(1)
  const again = page.getByRole('button', { name: 'Try again' })
  await expect(again).toHaveCount(2)
  // The panel's Try again retries what the bar sent: it closes. It never publishes or archives.
  await again.first().click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /^Closed/ })
      .first(),
  ).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /^(Published|Archived)/ })).toHaveCount(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('Return with a note is not offered on a suggestion to archive', async ({ page }) => {
  await go(page, '/inbox/sug-lars-retire/review')
  await expect(page.getByRole('button', { name: 'Close the suggestion' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Archive anyway' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^Return/ })).toHaveCount(0)
})
