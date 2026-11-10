import { expect, go, mode, test } from './go.ts'
import type { Locator, Page } from '@playwright/test'

// J48: Overview's filter picker holds still. A dimension's values appear once, in the places its
// step kept for them from its first frame (the count bar, a row for each value asked about), and
// nothing in it moves, grows or fades after that: not the step, not the page around it. A tick in
// the picker or the facets is on the screen in the frame after the press, before the page follows
// the address, and the page's transition moves only the rows and chips in sight.
// On the mock, Slow network (?slow=1) makes each dimension's first read of its values wait, as a
// busy service does.

type Frame = {
  t: number
  box: number[] | null
  head: string | null
  rows: { text: string; top: number }[]
  vt: boolean
  /** Whether the row or box marked to watch (data-watch) is ticked. */
  ticked: boolean
}

/**
 * Notes, at every animation frame from now on, the picker's box, its step and each row's place,
 * on the page's own clock. Called again, it starts a new list.
 */
const watch = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { frames: Frame[]; transitions: number; watching?: boolean }
    w.frames = []
    w.transitions = 0
    if (w.watching) return
    w.watching = true
    // React's <ViewTransition> and the filters' own both start here: one is a picture of the page.
    const start = document.startViewTransition?.bind(document)
    if (start)
      document.startViewTransition = ((...a: Parameters<typeof start>) => {
        w.transitions++
        return start(...a)
      }) as typeof document.startViewTransition
    const note = () => {
      const popup = document.querySelector('[role=dialog]:has([role=combobox])')
      const b = popup?.getBoundingClientRect()
      w.frames.push({
        t: performance.now(),
        box: b ? [b.x, b.y, b.width, b.height].map(Math.round) : null,
        head: popup?.querySelector('[role=combobox]')?.getAttribute('aria-label') ?? null,
        rows: [...(popup?.querySelectorAll('[role=option]') ?? [])].map((o) => ({
          text: o.textContent ?? '',
          top: Math.round(o.getBoundingClientRect().top),
        })),
        vt: !!document.documentElement.dataset.vt,
        ticked: ['aria-selected', 'aria-checked'].some(
          (a) => document.querySelector('[data-watch]')?.getAttribute(a) === 'true',
        ),
      })
      requestAnimationFrame(note)
    }
    requestAnimationFrame(note)
  })
const frames = (page: Page) =>
  page.evaluate(() => (window as unknown as { frames: Frame[] }).frames)
const transitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { transitions: number }).transitions)

const open = async (page: Page) => {
  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await expect(page.getByRole('combobox', { name: /^Filter by/ })).toBeFocused()
}

for (const [width, scheme] of [
  [1440, 'light'],
  [1440, 'dark'],
  [390, 'light'],
  [390, 'dark'],
] as const)
  test(`a dimension's values appear once, in the places kept for them (${width}, ${scheme})`, async ({
    page,
  }) => {
    const phone = width < 600
    await page.emulateMedia({ colorScheme: scheme })
    await page.setViewportSize({ width, height: phone ? 844 : 900 })
    await go(page, '/observability?range=30&slow=1')
    await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible()
    await open(page)
    // On the mock, Campaign: no facet has read its values yet, so its step waits for them. The
    // service's demo week asks about Market alone in 30 days.
    const name = mode === 'mock' ? 'Campaign' : 'Market'
    await watch(page)
    await page.getByRole('option', { name: new RegExp(`^${name}`) }).click()
    const listed = page.getByRole('listbox', { name: `Search the values of ${name}` })
    await expect
      .poll(() => listed.getByRole('option').count(), { timeout: 15_000 })
      .toBeGreaterThan(1)
    await page.waitForTimeout(700)

    const seen = (await frames(page)).filter((f) => f.head === `Search the values of ${name}`)
    expect(seen.length).toBeGreaterThan(10)
    const first = seen[0]!
    const arrived = seen.findIndex((f) => f.rows.length > 1)
    // On the mock its values come after the step's first frame (Slow network); the service's
    // facets may have read them already.
    if (mode === 'mock') expect(arrived).toBeGreaterThan(0)
    else expect(arrived).toBeGreaterThanOrEqual(0)
    for (const f of seen) {
      // One box from the step's first frame: it never shrinks to its head, nor grows when the
      // values come.
      expect(f.box, `the step's box at ${Math.round(f.t - first.t)} ms`).toEqual(first.box)
      // Any value stays where it was drawn: no bar arrives above it.
      expect(f.rows[0]!.top, `Any value at ${Math.round(f.t - first.t)} ms`).toBe(
        first.rows[0]!.top,
      )
    }
    // Once the values are there, they stay as they came, in their places.
    const values = seen[arrived]!.rows.map((r) => `${r.top} ${r.text.replace(/\d[\d,+]*/g, '#')}`)
    for (const f of seen.slice(arrived))
      expect(f.rows.map((r) => `${r.top} ${r.text.replace(/\d[\d,+]*/g, '#')}`)).toEqual(values)
    // Nothing took a picture of the page to fade it while the picker was open.
    expect(await transitions(page)).toBe(0)
  })

/** Ticks, and returns the first frame drawn after the click. */
async function firstFrameAfter(page: Page, tick: Locator) {
  await tick.evaluate((el) => {
    el.dataset.watch = ''
    const w = window as unknown as { pressed: number }
    document.addEventListener('click', () => (w.pressed = performance.now()), {
      capture: true,
      once: true,
    })
  })
  await watch(page)
  await tick.click()
  await expect.poll(() => frames(page).then((f) => f.at(-1)?.ticked)).toBe(true)
  return page.evaluate(() => {
    const w = window as unknown as { frames: Frame[]; pressed: number }
    return w.frames.find((f) => f.t > w.pressed) ?? null
  })
}

test('a tick is on the screen in the frame after the press, and the rows follow', async ({
  page,
}) => {
  await go(page, '/observability?range=30&slow=1')
  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible()
  await open(page)
  await page.getByRole('option', { name: /^Metric/ }).click()
  const values = page.getByRole('listbox', { name: 'Search the values of Metric' })
  // The frame after the press draws the tick, with no transition holding the page still; then
  // the address and the rows follow.
  const picked = await firstFrameAfter(page, values.locator('[role=option][data-row=tick]').nth(1))
  expect(picked).toMatchObject({ ticked: true, vt: false })
  await expect(page).toHaveURL(/metric=/)

  // The facets beside the topics, the same.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  const partial = page
    .getByRole('complementary', { name: 'Facets' })
    .getByRole('region', { name: 'Answer' })
    .getByRole('checkbox', { name: 'Partial' })
  expect(await firstFrameAfter(page, partial)).toMatchObject({ ticked: true, vt: false })
  await expect(page).toHaveURL(/answer=partial/)
})

test("the rows' move takes pictures of what is on the screen only", async ({ page }) => {
  await go(page, '/observability?range=30')
  await expect(page.getByRole('heading', { name: 'Topics' })).toBeVisible()
  // Rows out of sight, below the screen: the transition must leave them be.
  const below = await page
    .locator('tbody tr[data-vt-move]')
    .evaluateAll((rows) => rows.filter((r) => r.getBoundingClientRect().top >= innerHeight).length)
  expect(below).toBeGreaterThan(0)
  await page.evaluate(() => {
    const w = window as unknown as { named: { inSight: number; out: number }[] }
    w.named = []
    const look = () => {
      if (document.documentElement.dataset.vt === 'filters') {
        let inSight = 0
        let out = 0
        for (const el of document.querySelectorAll('[data-vt-move]')) {
          if (getComputedStyle(el).viewTransitionName === 'none') continue
          const b = el.getBoundingClientRect()
          if (b.bottom > 0 && b.top < window.innerHeight) inSight++
          else out++
        }
        w.named.push({ inSight, out })
      }
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await page
    .getByRole('complementary', { name: 'Facets' })
    .getByRole('region', { name: 'Answer' })
    .getByRole('checkbox', { name: 'Partial' })
    .click()
  await expect(page).toHaveURL(/answer=partial/)
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { named: unknown[] }).named.length))
    .toBeGreaterThan(0)
  const named = await page.evaluate(
    () => (window as unknown as { named: { inSight: number; out: number }[] }).named,
  )
  for (const n of named) {
    expect(n.out).toBe(0)
    expect(n.inSight).toBeGreaterThan(0)
  }
})
