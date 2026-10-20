import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/*
  The Editions page as release notes (Editions design, slice S3) on the real service and the bulk
  seed: the feed reads the service's sentences, newest first; an edition opens in the docked
  panel with what it changed field by field; What changed is one click from the live card, an
  entry and the open edition; and axe in both appearances at 1440 and 390. It only reads, and it
  takes the editions it names from the service at the start, so editions other tests publish
  meanwhile do not move it.
*/

const admin = 'admin-feed@example.test'
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

type Entry = {
  edition: { label: string; live: boolean }
  sentence: string
  items: { itemId: string; title: string }[]
}

async function signIn(context: BrowserContext, baseURL: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: admin },
  })
  expect(response.ok()).toBe(true)
}

/** The newest editions as the service writes them, and the newest one that changed an item. */
async function newest(context: BrowserContext) {
  const { entries } = (await (
    await context.request.get('/api/v1/editions/feed?limit=20')
  ).json()) as { entries: Entry[] }
  const changed = entries.find((entry) => entry.items.length > 0)
  expect(changed, 'an edition in the first page changes an item').toBeDefined()
  return { entries, changed: changed! }
}

const entryOf = (page: Page, label: string) =>
  page
    .locator('[data-slot="edition-entry"]')
    .filter({ has: page.getByRole('link', { name: `Edition ${label}`, exact: true }) })
const panel = (page: Page) => page.locator('[data-slot="dock-panel"]')
const escaped = (label: string) => label.replace('.', '\\.')

test('reads the service’s release notes and opens an edition with what it changed', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!)
  const { entries, changed } = await newest(context)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/editions')
  const feed = page.locator('[data-slot="edition-entry"]')
  await expect(feed.first()).toContainText(entries[0]!.sentence, { timeout: 15_000 })
  await expect(entryOf(page, changed.edition.label)).toContainText(changed.sentence)

  await entryOf(page, changed.edition.label)
    .getByRole('link', { name: `Edition ${changed.edition.label}`, exact: true })
    .click()
  await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
    `Edition ${changed.edition.label}`,
  )
  const title = changed.items[0]!.title
  await expect(panel(page).getByRole('article', { name: title })).toBeVisible({ timeout: 15_000 })

  // From the open edition, What changed is the panel's one primary.
  await panel(page).getByRole('link', { name: 'What changed', exact: true }).click()
  await expect(page).toHaveURL(
    new RegExp(`/editions/compare\\?.*until=${escaped(changed.edition.label)}`),
  )
  await expect(page.locator('[data-slot="compare-summary"]')).toBeVisible({ timeout: 15_000 })
})

test('What changed is one click from an entry, and since it reaches the live edition', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!)
  const { entries, changed } = await newest(context)
  const live = entries.find((entry) => entry.edition.live)!
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/editions')
  await page
    .getByRole('link', { name: `What changed in edition ${changed.edition.label}` })
    .click({ timeout: 15_000 })
  await expect(page.getByRole('combobox', { name: 'Until edition' })).toHaveValue(
    changed.edition.label,
    { timeout: 15_000 },
  )
  if (changed.edition.label === live.edition.label) return
  await page.goBack()
  await page
    .getByRole('link', { name: `What changed since edition ${changed.edition.label}` })
    .click({ timeout: 15_000 })
  await expect(page.getByRole('combobox', { name: 'Since edition' })).toHaveValue(
    changed.edition.label,
    { timeout: 15_000 },
  )
  await expect(page.getByRole('combobox', { name: 'Until edition' })).toHaveValue(
    live.edition.label,
  )
})

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
])
  for (const theme of ['light', 'dark'] as const)
    test(`passes axe at ${size.name}px, ${theme}, with an edition open`, async ({
      page,
      context,
      baseURL,
    }) => {
      await signIn(context, baseURL!)
      const { changed } = await newest(context)
      await page.addInitScript((appearance) => {
        window.localStorage.setItem('cl.appearance', appearance)
      }, theme)
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto('/editions')
      await expect(page.locator('[data-slot="edition-entry"]').first()).toBeVisible({
        timeout: 15_000,
      })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width)
      expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([])
      await page.goto(`/editions?edition=${changed.edition.label}`)
      await expect(panel(page).locator('article').first()).toBeVisible({ timeout: 15_000 })
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== 'running'),
      )
      expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([])
    })
