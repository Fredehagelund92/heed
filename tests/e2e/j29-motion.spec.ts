/// <reference lib="dom" />
import { expect, test, type Page } from '@playwright/test'
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
