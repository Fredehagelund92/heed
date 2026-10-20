import { expect, test } from '@playwright/test'

/*
  A smoke test of the library on the real service: the same 1,500 demo items as the mock, read
  from PostgreSQL through /api/v1. The mock and http bindings pass the same conformance suite
  (tests/conformance); this proves the browser wiring: the binding, the proxy and cookie sign-in.
*/

test.beforeEach(async ({ context, baseURL }) => {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL!, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: 'per_maria@example.test' },
  })
  expect(response.ok()).toBe(true)
})

test('the library lists, searches and opens items from the service', async ({ page }) => {
  const api: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/')) api.push(url.pathname)
  })

  await page.goto('/library')
  // The same counts as the mock shows (tests/e2e): both hold the same generated items.
  await expect(page.locator('#library-count')).toHaveText('1,404 facts', { timeout: 15_000 })
  await expect(page.getByText('Maria Lindqvist')).toBeVisible()
  expect(api).toEqual(expect.arrayContaining(['/api/v1/library', '/api/v1/auth/session']))

  await page.getByRole('textbox', { name: 'Search the library' }).fill('online sales norway')
  await expect(page.locator('#library-count')).toHaveText(/^\d+ of 1,404 facts$/)
  const first = page.locator('[data-row-link]').first()
  const title = (await first.textContent())?.trim() ?? ''
  expect(title).toContain('Online sales to Norway stopped')

  // A row opens the item in the docked panel beside the list (design round 3).
  await first.click()
  const panel = page.locator('[data-slot="dock-panel"]')
  await expect(panel.getByRole('heading', { level: 2 })).toHaveText(title)
  await panel.getByRole('tab', { name: 'History' }).click()
  await expect(panel.getByRole('table', { name: 'Versions' })).toBeVisible()
  expect(api.some((path) => /^\/api\/v1\/items\/itm_[a-z0-9]+(\/history)?$/.test(path))).toBe(true)
})

test('an unknown item is not found', async ({ page }) => {
  await page.goto('/library/itm_missing0')
  await expect(page.getByText("This page doesn't exist")).toBeVisible({ timeout: 15_000 })
})
