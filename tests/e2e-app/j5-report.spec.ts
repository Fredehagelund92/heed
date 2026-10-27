import { expect, go, mode, test } from './go.ts'

// J5: an owner answers a report, and the card is done.
test('an owner answers a report', async ({ page }) => {
  await go(page, '/inbox?demo=week&card=flag-germany')
  // A named report keeps who sent it. On the service a person sends one from Ask: an agent's
  // report keeps nobody (docs/product.md, section 9). The mock's came through an agent.
  await expect(
    page.getByText(
      mode === 'http'
        ? /By Maria Lindqvist, from Ask\./
        : /By Maria Lindqvist, from a chat with an agent/,
    ),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Not a problem' }).click()
  await expect(page.getByText('Report closed')).toBeVisible()
  await go(page, '/inbox?tab=all')
  await expect(
    page.getByRole('button', { name: /Orders lags by one day in the source tool.*Not a problem/ }),
  ).toBeVisible()
})
