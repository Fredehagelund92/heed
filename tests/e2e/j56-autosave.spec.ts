import type { Page, Route } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J56, a page that saves itself says Saved only when what is stored is what is shown (#193). About
// our business keeps the newest words when an older save answers late, never sends two saves at
// once (the service refuses the second), and says Not saved with Try again when a save fails; a
// domain's page says Not saved beside its failure, not Saved. The mock's writes are instant and
// never fail, so this runs on the service, with its requests held or failed in the browser.
test.skip(mode !== 'http', 'it holds and fails real requests, which the mock cannot do')

const ABOUT = '**/api/v1/settings/business.about'
const about = (page: Page) => page.getByRole('textbox', { name: 'About our business' })
/** The header's status: the one line that says whether the words are saved. */
const status = (page: Page) => page.locator('header [aria-live=polite]')
const isWrite = (route: Route) => route.request().method() !== 'GET'

/** About our business as the service stores it. */
async function storedAbout(page: Page) {
  const res = await page.request.get('/api/v1/settings')
  const all = (await res.json()) as { key: string; value: unknown }[]
  const value = all.find((s) => s.key === 'business.about')?.value
  return typeof value === 'string' ? value : ''
}

async function typeAtEnd(page: Page, words: string) {
  // The end of the last paragraph, wherever the text was clicked.
  await about(page).locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type(words)
}

const firstWrite = (page: Page) =>
  page.waitForRequest((r) => r.method() !== 'GET' && r.url().includes('business.about'))

test('words typed while a save is on its way are saved after it, even when she leaves', async ({
  page,
}) => {
  await go(page, '/settings/general')
  await expect(about(page)).toBeVisible()
  let answer!: () => void
  const held = new Promise<void>((resolve) => (answer = resolve))
  let writes = 0
  await page.route(ABOUT, async (route) => {
    if (!isWrite(route)) return route.fallback()
    if (++writes > 1) return route.fallback()
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })

  const first = firstWrite(page)
  await typeAtEnd(page, ' Alpha.')
  await first
  await page.keyboard.type(' Beta.')
  // The words are not saved while the first save is still on its way, and nothing else is sent.
  await expect(status(page)).not.toHaveText('Saved')
  await page.waitForTimeout(1200)
  expect(writes).toBe(1)

  answer()
  // The older answer is not the newest words: they are still waiting, and leaving sends them.
  await expect(status(page)).not.toHaveText('Saved')
  await page.getByRole('link', { name: 'People', exact: true }).click()
  await expect(page).toHaveURL(/settings\/people/)
  await expect.poll(() => storedAbout(page)).toContain('Alpha. Beta.')
  expect(writes).toBe(2)
})

test('two saves never overlap, so the service never refuses the second', async ({ page }) => {
  await go(page, '/settings/general')
  await expect(about(page)).toBeVisible()
  // A slow way up: each save reaches the service a moment late.
  const answers: number[] = []
  await page.route(ABOUT, async (route) => {
    if (!isWrite(route)) return route.fallback()
    await new Promise((r) => setTimeout(r, 1500))
    const response = await route.fetch()
    answers.push(response.status())
    await route.fulfill({ response })
  })

  const first = firstWrite(page)
  await typeAtEnd(page, ' Delta.')
  await first
  await page.keyboard.type(' Epsilon.')

  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 })
  expect(answers).toEqual([200, 200])
  expect(await storedAbout(page)).toContain('Delta. Epsilon.')
})

test('a save that fails says Not saved, keeps the words and saves them on Try again', async ({
  page,
}) => {
  await go(page, '/settings/general')
  await expect(about(page)).toBeVisible()
  await page.route(ABOUT, (route) => (isWrite(route) ? route.abort('failed') : route.fallback()))

  await typeAtEnd(page, ' Gamma.')
  await expect(status(page)).toHaveText('Not savedTry again')
  await expect(about(page)).toContainText('Gamma.')
  expect(await storedAbout(page)).not.toContain('Gamma.')

  await page.unroute(ABOUT)
  await status(page).getByRole('button', { name: 'Try again' }).click()
  await expect(status(page)).toHaveText('Saved')
  expect(await storedAbout(page)).toContain('Gamma.')
})

test("a domain's page says Not saved beside a failed save, not Saved", async ({ page }) => {
  await go(page, '/settings/domains/sales')
  const text = page.getByRole('textbox', { name: 'What the domain covers and its house rules' })
  await expect(text).toBeVisible()
  await page.route('**/api/v1/areas/**', (route) =>
    isWrite(route) ? route.abort('failed') : route.fallback(),
  )

  await text.click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Zeta.')
  await expect(page.locator('[data-sonner-toast]', { hasText: "Couldn't save" })).toBeVisible()
  await expect(status(page)).toHaveText('Not savedTry again')

  await page.unroute('**/api/v1/areas/**')
  await status(page).getByRole('button', { name: 'Try again' }).click()
  await expect(status(page)).toHaveText('Saved')
})
