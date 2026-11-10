import { expect, go, mode, onServiceOnly, test } from './go.ts'
import type { Page } from '@playwright/test'

// J45: a click answers at once. Pointing at a link fetches its page's code first, the click's
// first frame shows where it went before the rows mount, and a first visit draws the rows the shell
// already holds. A quick view reads its own item, never the lists the shell holds again.

const nav = (page: Page, name: string) =>
  page.locator('[data-sidebar="menu-button"]').filter({ hasText: name })

test('pointing at a link or focusing it fetches the page before the click', async ({ page }) => {
  // The fetch of every lazy page once the browser is idle: without it, only the link can ask.
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0
  })
  await go(page, '/inbox')
  await expect(nav(page, 'Context')).toBeVisible()

  const context = page.waitForRequest(/\/assets\/context\.index\.lazy-[^/]+\.js$/)
  await nav(page, 'Context').hover()
  await context

  const definitions = page.waitForRequest(/\/assets\/definitions\.index\.lazy-[^/]+\.js$/)
  await nav(page, 'Definitions').focus()
  await definitions
})

test('the first frame after a click shows the page, and the rows follow', async ({ page }) => {
  await go(page, '/inbox')
  await expect(nav(page, 'Context')).toBeVisible()
  // Go once, so the code and the data are held and the mount is all that is left. Slowed down, the
  // rows can't mount within the frame, however fast the machine.
  await nav(page, 'Context').click()
  await expect(page.locator('main tbody tr').first()).toBeVisible()
  await nav(page, 'Inbox').click()
  await expect(nav(page, 'Inbox')).toHaveAttribute('data-active')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })

  await page.evaluate(() => {
    const seen: { at: number; rows: number }[] = []
    const watch = { clicked: 0, seen }
    Object.assign(window, { watch })
    document.addEventListener('click', (e) => (watch.clicked = e.timeStamp), { capture: true })
    const look = () => {
      if (document.querySelector('a[href="/context"][data-active]'))
        seen.push({
          at: performance.now(),
          rows: document.querySelectorAll('main tbody tr').length,
        })
      requestAnimationFrame(look)
    }
    requestAnimationFrame(look)
  })
  await nav(page, 'Context').click()
  await expect(page.locator('main tbody tr').first()).toBeVisible()

  const { first, wait } = await page.evaluate(() => {
    const { clicked, seen } = (
      window as unknown as { watch: { clicked: number; seen: { at: number; rows: number }[] } }
    ).watch
    return { first: seen[0]!, wait: seen[0]!.at - clicked }
  })
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
  expect(first.rows).toBe(0)
  // At six times slower: before the rows moved out of this frame it took several times as long.
  expect(wait).toBeLessThan(1500)
})

test('the sidebar says where the click went while the page is on its way', async ({ page }) => {
  await page.addInitScript(() => {
    window.requestIdleCallback = () => 0
  })
  await go(page, '/inbox')
  await expect(nav(page, 'Context')).toBeVisible()
  let arrive = () => {}
  const held = new Promise<void>((resolve) => (arrive = resolve))
  await page.route(/\/assets\/context\.index\.lazy-[^/]+\.js$/, async (route) => {
    await held
    await route.continue()
  })
  await nav(page, 'Context').click()
  await expect(nav(page, 'Context')).toHaveAttribute('data-active')
  await expect(nav(page, 'Inbox')).not.toHaveAttribute('data-active')
  arrive()
  await expect(page.locator('main tbody tr').first()).toBeVisible()
})

test('a first visit draws the rows the shell holds while the page reads them again', async ({
  page,
}) => {
  test.skip(mode !== 'http', 'The mock answers at once, or plays its load on purpose (below).')
  await go(page, '/inbox')
  await expect(nav(page, 'Context')).toBeVisible()
  // The shell has its read by now: the page's own never answers.
  await page.route('**/api/v1/library', () => {})
  await nav(page, 'Context').click()
  await expect(page.locator('main tbody tr').first()).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0)
})

test('the slow network flag still shows the list loading', async ({ page }) => {
  test.skip(mode === 'http', 'The http binding has no flags.')
  await go(page, '/context?slow=1')
  await expect(page.getByRole('status', { name: 'Loading' }).first()).toBeVisible()
  await expect(page.locator('main tbody tr').first()).toBeVisible()
})

test('opening a quick view reads its item, not the lists the shell holds', async ({ page }) => {
  await onServiceOnly('requests a quick view sends', async () => {
    await page.clock.install()
    await go(page, '/context')
    await expect(page.locator('main tbody tr').first()).toBeVisible()
    // Long enough that every list the shell read is older than staleTime.
    await page.clock.fastForward(31_000)
    const reads: string[] = []
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname
      if (path.startsWith('/api/v1/')) reads.push(path.slice('/api/v1'.length))
    })
    await page
      .getByRole('button', { name: 'Norway orders are card and cash payments only', exact: true })
      .click()
    const peek = page.getByRole('region', { name: 'Context' })
    await expect(peek.getByRole('button', { name: 'Compare and decide' })).toBeEnabled()
    await expect(peek.getByRole('button', { name: /^History: / })).toBeVisible()
    // The people and the domains come with the item's own read, beside it: they name its owners.
    const shared =
      /^\/(library|members|invites|workspace|setup|settings|comments|inbox\/feed|auth\/session|proposals|context\/changes|vocabulary|terms|catalogue)$/
    expect(reads.filter((path) => shared.test(path))).toEqual([])
    expect(reads.some((path) => /^\/items\/[^/]+\/page$/.test(path))).toBe(true)
  })
})
