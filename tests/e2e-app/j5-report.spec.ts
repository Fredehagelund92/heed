import { expect, go, inMockUntil, test } from './go.ts'

// J5: an owner answers a report, and the card is done.
test('an owner answers a report', async ({ page }) => {
  await go(page, '/inbox?demo=week&card=flag-germany')
  await inMockUntil('P10', 'named reports, which keep who sent them', () =>
    expect(page.getByText(/By Maria Lindqvist, from a chat with an agent/)).toBeVisible(),
  )
  await page.getByRole('button', { name: 'Not a problem' }).click()
  await expect(page.getByText('Report closed')).toBeVisible()
  await go(page, '/inbox?tab=all')
  await expect(
    page.getByRole('button', { name: /Orders lags by one day in the source tool.*Not a problem/ }),
  ).toBeVisible()
})
