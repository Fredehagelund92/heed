import { expect, type Page } from '@playwright/test'
import { mode, test } from './go.ts'

// J48, a list while it loads on a slow network: Definitions opened cold shows the app's skeleton
// (the sidebar and the list's bars, header and rows) instead of a blank window, never says there
// is nothing while it waits, and the page lands where the skeleton stood.
// The mock answers the shared reads at once, so these run on the service (http mode), where the
// network can be slowed.

test.skip(mode === 'mock', 'The mock answers the shared reads at once: these slow the service')

/** Every answer from the service held back, as on a slow network. */
const slowNetwork = (page: Page, ms: number) =>
  page.route('**/api/v1/**', async (route) => {
    const answer = await route.fetch()
    await new Promise((resolve) => setTimeout(resolve, ms))
    await route.fulfill({ response: answer })
  })

type Frame = {
  at: number
  skeleton: boolean
  table: boolean
  skeletonRows: number
  rows: number
  /** Where the table's header starts: the skeleton's header band, then the table's own. */
  head: number | null
  /** The left edge of each header label once the table is drawn. */
  labels: number[]
  empty: boolean
}

/**
 * Notes, every frame from the first, what the page shows: the skeleton or the table, where the
 * table's header starts, where its labels are, and whether it says there is nothing.
 */
const recordFrames = (page: Page) =>
  page.addInitScript(() => {
    const frames: Frame[] = []
    ;(window as unknown as { frames_: Frame[] }).frames_ = frames
    const t0 = performance.now()
    const tick = () => {
      const band = document.querySelector('[data-skeleton-head]')
      const thead = document.querySelector('thead')
      const body = document.body?.innerText ?? ''
      frames.push({
        at: performance.now() - t0,
        skeleton: !!document.querySelector('[role=status][aria-label=Loading]'),
        table: !!thead,
        skeletonRows: document.querySelectorAll('tbody [data-skeleton-row]').length,
        rows: document.querySelectorAll('tbody tr:not([data-skeleton-row])').length,
        head: (thead ?? band)?.getBoundingClientRect().top ?? null,
        labels: thead
          ? [...thead.querySelectorAll('th')]
              .filter((th) => th.getBoundingClientRect().width > 0)
              .map((th) => Math.round(th.getBoundingClientRect().left))
          : [],
        empty: /No definitions (yet|match)/.test(body),
      })
      if (frames.length < 20_000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

const frames = (page: Page) =>
  page.evaluate(() => (window as unknown as { frames_: Frame[] }).frames_)

for (const [width, scheme] of [
  [1440, 'light'],
  [1440, 'dark'],
  [390, 'light'],
  [390, 'dark'],
] as const)
  test(`Definitions opened cold on a slow network shows its skeleton, then lands in place (${width}, ${scheme})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width > 400 ? 900 : 844 })
    await page.emulateMedia({ colorScheme: scheme })
    await recordFrames(page)
    await slowNetwork(page, 1500)
    await page.goto('/definitions')

    // Waiting: the app's skeleton, never a blank window and never an empty list.
    await expect(page.getByRole('status', { name: 'Loading' })).toBeVisible()
    await expect(page.locator('[data-skeleton-head]')).toBeVisible()
    await expect(page.getByText(/No definitions/)).toHaveCount(0)

    // Then the definitions, with every row drawn.
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible({ timeout: 60_000 })
    await expect(page.locator('tbody tr:not([data-skeleton-row])').nth(20)).toBeAttached({
      timeout: 30_000,
    })
    await expect(page.locator('tbody [data-skeleton-row]')).toHaveCount(0)
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)

    const seen = await frames(page)
    const shown = seen.filter((f) => f.skeleton || f.table)
    expect(shown.length, 'the page was drawn').toBeGreaterThan(0)
    // From the first thing drawn to the last, something was always on screen, and it never said
    // there were no definitions.
    const first = seen.findIndex((f) => f.skeleton || f.table)
    expect(seen.slice(first).every((f) => f.skeleton || f.table)).toBe(true)
    expect(seen.some((f) => f.empty)).toBe(false)
    expect(seen.some((f) => f.skeleton && !f.table)).toBe(true)
    // The table's header starts where the skeleton's did, in every frame.
    const heads = new Set(seen.filter((f) => f.head !== null).map((f) => Math.round(f.head!)))
    expect([...heads]).toHaveLength(1)
    // Its labels never move as the rows replace the skeleton's.
    const labels = new Set(seen.filter((f) => f.table).map((f) => f.labels.join(',')))
    expect([...labels]).toHaveLength(1)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
