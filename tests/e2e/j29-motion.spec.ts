/// <reference lib="dom" />
import { expect, test, type Locator, type Page } from '@playwright/test'
import { go, moveTo } from './go.ts'

// J29: motion and loading (docs/design/motion.md). Decisions do not wait, loading waits before it shows and
// takes the page's shape, and nothing moves that the person did not ask for.

test('an Inbox decision shows at once, Undo brings it back, and a failed save takes it back by itself', async ({
  page,
}) => {
  await go(page, '/inbox?demo=week&card=check-returns')
  const row = page.locator('[data-row="check-returns"]')
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: 'Still true', exact: true }).click()
  // The row goes before the save (600 ms) could have finished: no spinner, no wait.
  await expect(row).toHaveCount(0, { timeout: 450 })
  await expect(page.getByText('Checked: still true')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(row).toBeVisible()

  await go(page, '/inbox?demo=week&card=check-returns&decide=fail')
  await page.getByRole('button', { name: 'Still true', exact: true }).click()
  await expect(row).toHaveCount(0, { timeout: 450 })
  await expect(page.getByText("Couldn't save that decision")).toBeVisible()
  await expect(row).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(row).toHaveCount(0, { timeout: 450 })
})

/** Counts the frames in which the page's first row moved, over 700ms after `act`. */
async function framesMoved(page: Page, act: () => Promise<unknown>) {
  await page.evaluate(() => {
    const w = window as unknown as { __mv: { moved: number; done: boolean } }
    const probe = () =>
      document.querySelector('[data-slot="sidebar-inset"] tbody tr')?.getBoundingClientRect() ??
      null
    w.__mv = { moved: 0, done: false }
    let prev = probe()
    const t0 = performance.now()
    const tick = () => {
      const r = probe()
      if (r && prev && Math.abs(r.width - prev.width) + Math.abs(r.left - prev.left) > 0.5)
        w.__mv.moved++
      prev = r ?? prev
      if (performance.now() - t0 < 700) requestAnimationFrame(tick)
      else w.__mv.done = true
    }
    requestAnimationFrame(tick)
  })
  await act()
  await page.waitForFunction(() => (window as unknown as { __mv: { done: boolean } }).__mv.done)
  return page.evaluate(() => (window as unknown as { __mv: { moved: number } }).__mv.moved)
}

test('opening and closing a peek moves the page once, not frame after frame', async ({ page }) => {
  await go(page, '/context')
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await page.waitForTimeout(300)
  expect(
    await framesMoved(page, () => moveTo(page, '/context?dock=context.itm_ra39ow6c')),
  ).toBeLessThanOrEqual(2)
  await expect(page.getByRole('region', { name: /Context/ }).last()).toBeVisible()
  expect(await framesMoved(page, () => moveTo(page, '/context'))).toBeLessThanOrEqual(2)
})

test("a slow load waits, shows the page's shape, then the content, without the layout jumping", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shift: number }
    w.__shift = 0
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & {
        value: number
        hadRecentInput: boolean
      })[])
        if (!e.hadRecentInput) w.__shift += e.value
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await go(page, '/observability/usage?slow=1')
  // Nothing for 150ms, then the page's own skeleton, then the content.
  await expect(page.getByRole('status', { name: 'Loading' }).first()).toBeAttached()
  await expect(page.getByRole('heading', { name: 'Tools' })).toBeVisible()
  await page.waitForTimeout(400)
  expect(
    await page.evaluate(() => (window as unknown as { __shift: number }).__shift),
  ).toBeLessThanOrEqual(0.02)
})

test('a skeleton sits where its table will be', async ({ page }) => {
  await go(page, '/context?state=loading')
  const band = page.getByRole('status', { name: 'Loading' }).locator('> div').nth(1)
  await expect(band).toBeVisible()
  const sk = (await band.boundingBox())!
  await go(page, '/context')
  const head = (await page.locator('thead tr').boundingBox())!
  expect(Math.abs(sk.y - head.y)).toBeLessThanOrEqual(8)
  expect(Math.abs(sk.height - head.height)).toBeLessThanOrEqual(8)
})

test('once a page is still, nothing loops or moves', async ({ page }) => {
  for (const route of [
    '/inbox?demo=week',
    '/observability/overview',
    '/ask?example=grounded',
    '/context',
  ]) {
    await go(page, route)
    await page.waitForTimeout(2600)
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a.playState === 'running')
        .map((a) => ({
          name: (a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty,
          infinite: a.effect?.getTiming().iterations === Infinity,
        })),
    )
    expect(
      running.filter((a) => a.infinite),
      route,
    ).toEqual([])
  }
})

test('J and K move between cards without any animation', async ({ page }) => {
  await go(page, '/inbox?demo=week')
  await page.waitForTimeout(500)
  await page.locator('body').click({ position: { x: 5, y: 450 } })
  const started = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let n = 0
        const seen = new Set<Animation>()
        const t0 = performance.now()
        const tick = () => {
          for (const a of document.getAnimations()) {
            const el = (a.effect as KeyframeEffect | null)?.target as Element | null
            if (
              !seen.has(a) &&
              el?.closest('main, [data-slot=sidebar-inset]') &&
              !(a as CSSTransition).transitionProperty?.match(/color|background/)
            ) {
              seen.add(a)
              n++
            }
          }
          if (performance.now() - t0 < 400) requestAnimationFrame(tick)
          else resolve(n)
        }
        requestAnimationFrame(tick)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }))
      }),
  )
  expect(started).toBe(0)
})

test('the Slow network switch in Help makes a page wait on its first visit', async ({ page }) => {
  await go(page, '/help')
  const slow = page.getByRole('switch', { name: 'Slow network' })
  await expect(slow).toHaveAttribute('aria-checked', 'false')
  await slow.click()
  await expect(slow).toHaveAttribute('aria-checked', 'true')
  await go(page, '/definitions')
  await expect(page.getByRole('status', { name: 'Loading' }).first()).toBeAttached()
  await expect(page.locator('tbody tr').first()).toBeVisible()
  await go(page, '/help')
  await page.getByRole('switch', { name: 'Slow network' }).click()
})

/** Whether reduced motion is on for this run (the reduced-motion project runs this file again). */
const reduced = (page: Page) =>
  page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)

/** The first transition duration on `selector`, in ms. */
const transitionMs = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) * 1000)

/** The transitions `target` starts on `act`, with the duration each runs for, in ms. */
async function transitions(page: Page, target: Locator, act: () => Promise<unknown>) {
  await target.evaluate((el) => {
    const w = window as unknown as { __runs: string[] }
    w.__runs = []
    // One handler, replaced on each call.
    ;(el as HTMLElement).ontransitionrun = (e) => {
      if (e.target === el)
        w.__runs.push(
          `${e.propertyName} ${parseFloat(getComputedStyle(el).transitionDuration) * 1000}`,
        )
    }
  })
  await act()
  await page.waitForTimeout(400)
  return page.evaluate(() => (window as unknown as { __runs: string[] }).__runs)
}

test('a fold opens in 220ms and shuts in 150ms, and with reduced motion at once', async ({
  page,
}) => {
  // A peek's Details: its panel stays in the page while shut, so it can be watched both ways.
  await go(page, '/context?dock=context.itm_ra39ow6c')
  const fold = page.getByRole('button', { name: 'Details', exact: true })
  await expect(fold).toBeVisible()
  const panel = fold.locator('xpath=following-sibling::*[1]')
  const opening = await transitions(page, panel, () => fold.click())
  await expect(panel).toBeVisible()
  const shutting = await transitions(page, panel, () => fold.click())
  await expect(panel).toBeHidden()
  if (await reduced(page)) {
    expect(opening).toEqual([])
    expect(shutting).toEqual([])
  } else {
    expect(opening).toEqual(['height 220'])
    expect(shutting).toEqual(['height 150'])
  }
})

test('a copy turns its icon into a tick for a moment, and two toasts both arrive on the tokens', async ({
  page,
}) => {
  await go(page, '/ask?example=grounded')
  const copies = page.getByRole('button', { name: 'Copy', exact: true })
  await expect(copies).toHaveCount(2)
  await copies.last().click({ force: true })
  const tick = copies.last().locator('[data-slot=copied-icon]')
  await expect(tick).toHaveAttribute('data-done')
  expect(
    await tick
      .locator('svg')
      .last()
      .evaluate((el) => parseFloat(getComputedStyle(el).opacity)),
  ).toBeGreaterThan(0)
  // The question's copy too: two toasts at once, each on the toast tokens.
  await copies.first().click({ force: true })
  const toasts = page.locator('[data-sonner-toast]')
  await expect(toasts).toHaveCount(2)
  for (const t of await toasts.all())
    expect(await t.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe(
      (await reduced(page)) ? '0s' : '0.22s',
    )
  // The tick goes back to the copy icon by itself.
  await expect(tick).not.toHaveAttribute('data-done', { timeout: 2500 })
})

test('a sheet comes in from its edge on the panel curve', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await go(page, '/inbox')
  await page.getByRole('button', { name: 'Open the menu' }).click()
  // The phone's sidebar is a sheet from the left.
  const sheet = '[data-mobile=true][data-side=left]'
  await expect(page.locator(sheet)).toBeVisible()
  expect(
    await page.locator(sheet).evaluate((el) => getComputedStyle(el).transitionTimingFunction),
  ).toBe('cubic-bezier(0.32, 0.72, 0, 1)')
  // It settles where it sits: nothing left of the 16px it came in by.
  await expect
    .poll(() => page.locator(sheet).evaluate((el) => getComputedStyle(el).translate))
    .toBe('none')
  expect(await transitionMs(page, sheet)).toBe((await reduced(page)) ? 0 : 220)
})

test('a deleted row fades out before it goes, and does not come back on its way', async ({
  page,
}) => {
  await go(page, '/definitions')
  const row = page.locator('tbody tr').filter({ hasText: /^\s*Test account/ })
  await expect(row).toBeVisible()
  await row.getByRole('checkbox').click()
  await page
    .getByRole('region', { name: 'Selected definitions' })
    .getByRole('button', { name: /^Delete/ })
    .click()
  // Watch the row from the press: once it has started to leave, it must not come back. (That it
  // stays gone while a slow save is on its way is held in tests/web/lib/presence.test.ts.)
  await page.evaluate(() => {
    const w = window as unknown as { __row: { left: boolean; back: boolean } }
    w.__row = { left: false, back: false }
    const find = () =>
      [...document.querySelectorAll('tbody tr')].find((tr) =>
        tr.textContent?.trim().startsWith('Test account'),
      )
    const tick = () => {
      const tr = find()
      if (tr?.hasAttribute('data-leaving')) w.__row.left = true
      else if (tr && w.__row.left) w.__row.back = true
      if (tr) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await page
    .getByRole('dialog', { name: /^Delete 1 term/ })
    .getByRole('button', { name: /^Delete 1 term/ })
    .click()
  await expect(page.getByText('1 term deleted')).toBeVisible()
  await expect(row).toHaveCount(0)
  const seen = await page.evaluate(
    () => (window as unknown as { __row: { left: boolean; back: boolean } }).__row,
  )
  expect(seen.back).toBe(false)
  expect(seen.left).toBe(!(await reduced(page)))
})

test('moving between places never blanks the page on the way', async ({ page }) => {
  await go(page, '/inbox')
  await expect(page.locator('main').getByRole('heading').first()).toBeVisible()
  // The other places' code arrives while the browser is idle after the first page.
  await page.waitForLoadState('networkidle')
  for (const to of ['/context', '/definitions', '/observability', '/ask', '/inbox']) {
    const blank = await page.evaluate(async (path) => {
      const link = [...document.querySelectorAll('a')].find((a) => a.getAttribute('href') === path)
      link?.click()
      let frames = 0
      const t0 = performance.now()
      await new Promise<void>((done) => {
        const tick = () => {
          const inset = document.querySelector<HTMLElement>('[data-slot=sidebar-inset]')
          if (!inset?.innerText.trim()) frames++
          if (performance.now() - t0 < 600) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      return frames
    }, to)
    expect(blank, to).toBe(0)
  }
})

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('the dock and overlays are there at once, and content still fades in', async ({ page }) => {
    await go(page, '/context')
    await expect(page.locator('tbody tr').first()).toBeVisible()
    await moveTo(page, '/context?dock=context.itm_ra39ow6c')
    const dock = page.locator('.dock-enter').first()
    await expect(dock).toBeVisible()
    expect(await dock.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--dur-fade').trim(),
      ),
    ).toBe('90ms')
    await page
      .getByRole('button', { name: /Jon Abara/ })
      .last()
      .click()
    const menu = page.locator('[data-slot=dropdown-menu-content]')
    await expect(menu).toBeVisible()
    expect(await menu.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s')
  })
})
