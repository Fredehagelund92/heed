import { expect, test, type Page } from '@playwright/test'

/*
  What a person meets after `docker compose up`, on the demo's own data (playwright.seed.config.ts):
  the sign-in picker, the Inbox, Context with the demo library, an item, Definitions from the
  demo Cube model, Ask, Observability and Settings. Each screen draws with no failed load and no
  call the service refuses or fails.
*/

/** Every call to the service that failed or was refused from now on. */
function watchCalls(page: Page) {
  const failed: string[] = []
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/v1/') && response.status() >= 400)
      failed.push(`${response.request().method()} ${url.pathname} ${response.status()}`)
  })
  return failed
}

/** A screen is drawn: its title, and no frame that says a load failed. */
async function drawn(page: Page, title: string) {
  await expect(page.getByRole('heading', { name: title, exact: true }).first()).toBeVisible()
  await expect(page.getByText(/couldn't load|could not load|something went wrong/i)).toHaveCount(0)
}

test('a new install of the demo: sign in, and every main screen draws on its data', async ({
  page,
}) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/signin$/)
  await page.getByRole('button', { name: /Jon Abara/ }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  // Signed out, the sign-in page's reads are refused as they should be; from here none may be.
  const failed = watchCalls(page)
  await drawn(page, 'Inbox')

  await page.goto('/context')
  await drawn(page, 'Context')
  // The demo library: 1,500 items, some archived and hidden from the list at first.
  await expect(page.getByText(/of 1,\d{3} context items/)).toBeVisible()
  const first = page.getByRole('main').getByRole('row').nth(1)
  const title = (await first.getByRole('button').nth(0).textContent())!.trim()
  await first.getByRole('button', { name: title, exact: true }).click()
  // It opens in the panel beside the list, and from there on its own page.
  const panel = page.getByRole('region', { name: 'Context' })
  await expect(panel.getByRole('heading', { level: 2, name: title })).toBeVisible()
  await panel.getByRole('button', { name: 'Open the page' }).click()
  await expect(page).toHaveURL(/\/context\/itm_/)
  await expect(page.getByRole('main').getByRole('heading', { level: 1, name: title })).toBeVisible()

  await page.goto('/definitions')
  await drawn(page, 'Definitions')
  await expect(page.getByRole('main').getByText('Orders', { exact: true }).first()).toBeVisible()

  // Asked about the demo's own story, Ask answers from its library with one of the six lines.
  await page.goto('/ask')
  await drawn(page, 'Ask')
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('How did orders in Norway change in October 2026?')
  await box.press('Enter')
  await expect(
    page
      .getByRole('main')
      .getByText(/^(Checked|Partial|Not found|Conflict|Outdated|Not checked)$/)
      .first(),
  ).toBeVisible()

  // Jon owns Sales: what an owner reads of Observability and Settings.
  for (const [address, heading] of [
    ['/observability/overview', 'Overview'],
    ['/settings/domains', 'Domains and owners'],
  ] as const) {
    await page.goto(address)
    await drawn(page, heading)
  }
  expect(failed).toEqual([])
})
