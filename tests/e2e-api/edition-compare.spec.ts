import AxeBuilder from '@axe-core/playwright'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/*
  What changed between two editions (Editions design, slice S2) on the real service and the bulk
  seed: a year of editions netted into one windowed list, an item open in the docked panel,
  filters whose counts are the service's, edition by edition as the feed writes it, an unknown
  edition, and axe in both appearances at 1440 and 390. It only reads, and names its editions,
  so editions that other tests publish meanwhile do not move it.
*/

const admin = 'admin-compare@example.test'

/** A year of the bulk seed: the live edition of the seed against the one live on 11 October 2025. */
const YEAR = 'since=2025-10-11.4&until=2026-10-07.2'
/** The seed's last two days: the vocabulary edition and the two acceptances around it. */
const DAYS = 'since=2026-10-06.2&until=2026-10-07.2'

type Comparison = {
  sentence: string
  total: number
  facets: {
    change: Record<string, number>
    areas: { areaId: string; count: number }[]
  }
}

async function signIn(context: BrowserContext, baseURL: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email: admin },
  })
  expect(response.ok()).toBe(true)
}

const list = (page: Page) => page.locator('[data-slot="compare-list"]')
const rows = (page: Page) => list(page).locator('[role="row"][data-row-id]')
const summary = (page: Page) => page.locator('[data-slot="compare-summary"]')

test('nets a year of editions into one windowed list, as the service counts it', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!)
  const service = (await (
    await context.request.get('/api/v1/editions/compare?from=2025-10-11.4&to=2026-10-07.2&limit=1')
  ).json()) as Comparison
  expect(service.facets.change.added).toBeGreaterThan(400)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/editions/compare?${YEAR}`)
  await expect(summary(page)).toContainText(service.sentence, {
    timeout: 15_000,
  })
  await expect(list(page).getByRole('button', { name: /^Added, / })).toContainText(
    service.facets.change.added!.toLocaleString('en'),
  )
  expect((await rows(page).first().boundingBox())?.height).toBe(40)
  // Far fewer rows are in the page than the list holds: it is windowed.
  expect(await rows(page).count()).toBeLessThan(100)

  // Scrolling to the end reads every page of the groups on the way, and nothing waits to load.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(list(page).getByRole('button', { name: /^Archived, / })).toBeVisible()
  await expect(list(page).locator('[data-pending]')).toHaveCount(0, { timeout: 30_000 })
  await expect(
    list(page).getByRole('button', { name: /^Saved again, nothing different, / }),
  ).toHaveAttribute('aria-expanded', 'false')

  // An item opens in the docked panel, field by field, with each edition that changed it.
  // The first added item, by its id: back at the top the list renders its first rows again.
  const [added] = (
    (await (
      await context.request.get(
        '/api/v1/editions/compare?from=2025-10-11.4&to=2026-10-07.2&change=added&limit=2',
      )
    ).json()) as { items: { itemId: string; title: string }[] }
  ).items
  const { itemId, title } = added!
  await page.evaluate(() => window.scrollTo(0, 0))
  const first = list(page).locator(`[data-row-id="${itemId}"]`)
  await first.getByRole('link').click()
  const panel = page.locator('[data-slot="dock-panel"]')
  await expect(panel.getByRole('heading', { name: title })).toBeVisible()
  await expect(panel.getByRole('article', { name: `What changed in ${title}` })).toContainText(
    'Added. AI apps get this fact from this edition on.',
  )
  await expect(panel.getByRole('article')).toContainText(/Accepted by .+ as owner\./)
  await page.keyboard.press('v')
  await expect(first).toHaveAttribute('data-viewed', 'true')
  await page.keyboard.press('j')
  await expect(first).not.toHaveAttribute('data-open')
  await expect(list(page).locator('[data-open]')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
})

test('opens on the latest edition and writes both numbers into the address', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/editions')
  await page
    .locator('[data-slot="live-edition"]')
    .getByRole('link', { name: 'What changed', exact: true })
    .click()
  await expect(page).toHaveURL(/since=\d{4}-\d{2}-\d{2}\.\d+&until=\d{4}-\d{2}-\d{2}\.\d+/, {
    timeout: 15_000,
  })
  await expect(summary(page)).toContainText('Across 1 edition.')
})

test('filters by domain with the service’s counts', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!)
  const service = (await (
    await context.request.get('/api/v1/editions/compare?from=2025-10-11.4&to=2026-10-07.2&limit=1')
  ).json()) as Comparison
  const [area] = [...service.facets.areas].sort((a, b) => a.count - b.count)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/editions/compare?${YEAR}&area=${area!.areaId}`)
  await expect(
    page.getByText(
      `${area!.count.toLocaleString('en')} of ${service.total.toLocaleString('en')} facts`,
    ),
  ).toBeAttached({
    timeout: 15_000,
  })
  await expect(page.getByRole('group', { name: 'Filters on' })).toContainText('Domain:')
})

test('reads edition by edition, Until included, as the feed writes each one', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!)
  const feed = (await (
    await context.request.get('/api/v1/editions/feed?after=2026-10-06.2&through=2026-10-07.2')
  ).json()) as { entries: { edition: { label: string }; sentence: string }[] }
  expect(feed.entries.map((entry) => entry.edition.label)).toEqual(['2026-10-07.2', '2026-10-07.1'])

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(`/editions/compare?${DAYS}&view=steps`)
  const editions = page.getByRole('list', { name: 'Editions in this range, newest first' })
  await expect(editions.locator(':scope > li')).toHaveCount(2, { timeout: 15_000 })
  for (const [index, entry] of feed.entries.entries())
    await expect(editions.locator(':scope > li').nth(index)).toContainText(entry.sentence)
})

test('says when an edition does not exist', async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/editions/compare?since=2020-01-01.9&until=2026-10-07.2')
  await expect(page.getByText("One of these editions doesn't exist")).toBeVisible({
    timeout: 15_000,
  })
})

for (const size of [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
])
  for (const theme of ['light', 'dark'] as const)
    test(`passes axe at ${size.name}px, ${theme}, with an item open`, async ({
      page,
      context,
      baseURL,
    }) => {
      await signIn(context, baseURL!)
      await page.addInitScript((appearance) => {
        window.localStorage.setItem('cl.appearance', appearance)
      }, theme)
      await page.setViewportSize({ width: size.width, height: size.height })
      await page.goto(`/editions/compare?${DAYS}`)
      await expect(rows(page).first()).toBeVisible({ timeout: 15_000 })
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width)
      const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
      expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([])
      await rows(page).first().getByRole('link').click()
      await expect(page.locator('[data-slot="dock-panel"] article')).toBeVisible()
      await page.waitForFunction(() =>
        document.getAnimations().every((animation) => animation.playState !== 'running'),
      )
      expect((await new AxeBuilder({ page }).withTags(wcag).analyze()).violations).toEqual([])
    })
