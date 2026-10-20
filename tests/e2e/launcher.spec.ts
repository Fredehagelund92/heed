import { mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { ASK_MATCH, askAndWait } from './ask-support'
import { openPage, routes, settle, themes, TRY_IT_MATCH, widths } from './support'

/*
  One assistant in three states, never two at once (contract 9.8): closed, docked beside the page
  and expanded to its own page. The launcher, one round button in the bottom-right corner of every
  page signed in but the assistant's own, docks its panel on the right with three tabs, Ask, What
  an agent would get and Connect; the sidebar's Assistant and G then A expand it to its page; Dock
  and Command or Control backslash dock it again. One panel at a time: it covers a record's panel
  and closing it shows the record again with its focus. It never covers a bar stuck to the bottom
  of the page (a list's totals) or a toast, every page keeps room for it at its end, the review
  screen's decision bar holds it at its end so it covers none of the rail's controls, and on a
  phone a form's bar holds it in its More menu instead.
*/

/** Jon, the owner of Sales, decides the ready proposal (src/web/api/mock-demo-proposals.ts). */
const JON = 'per_jon'
const READY = '00000000-0000-4000-8000-00000000005a'

/** Set LAUNCHER_SHOTS to a folder to keep a screenshot of each layout check. */
const shots = process.env.LAUNCHER_SHOTS
if (shots) mkdirSync(shots, { recursive: true })

const launcher = (page: Page) => page.getByRole('button', { name: 'Assistant', exact: true })
const assistant = (page: Page) =>
  page.getByRole((page.viewportSize()?.width ?? 1440) < 768 ? 'dialog' : 'region', {
    name: 'Assistant',
  })
const shownPanels = (page: Page) => page.locator('[data-slot="dock-panel"]:not([hidden])')
/** The Ask composers on screen: one assistant has one. */
const composers = (page: Page) =>
  page.getByRole('textbox', { name: 'Your question' }).filter({ visible: true })
const sidebar = (page: Page) => page.locator('[data-slot="sidebar"]')
/** The assistant's pages, where it is already expanded. */
const assistantPages = new Set<string>(['/assistant', '/try-it'])

async function signInAs(page: Page, person: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), person)
}

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('not on screen')
  return found
}

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/**
 * What the launcher covers among the bars stuck to the bottom of the page and the controls named
 * by `also`: the launcher measures its lift once a frame, so a test polls this until it is empty.
 */
function covered(page: Page, also = '') {
  return page.evaluate((extra) => {
    const button = document.querySelector('[data-slot="assistant-launcher"]')
    const own = button?.getBoundingClientRect()
    if (!own?.width) return []
    const selector = ['[data-launcher-clear]', extra].filter(Boolean).join(', ')
    return [...document.querySelectorAll(selector)].flatMap((element) => {
      const rect = element.getBoundingClientRect()
      if (!rect.width || !rect.height) return []
      const hit =
        own.left < rect.right &&
        rect.left < own.right &&
        own.top < rect.bottom &&
        rect.top < own.bottom
      return hit ? [element.getAttribute('aria-label') ?? element.textContent?.slice(0, 40)] : []
    })
  }, also)
}

/**
 * The focusable controls a shown launcher (the corner's, or one a bar holds) covers: the geometry
 * test of contract 12.3, which fails when the launcher's box meets any control's box.
 */
function controlsUnderLauncher(page: Page) {
  return page.evaluate(() => {
    const launchers = [
      ...document.querySelectorAll<HTMLElement>(
        '[data-slot="assistant-launcher"], [data-slot="assistant-held"]',
      ),
    ].filter((button) => button.checkVisibility({ visibilityProperty: true }))
    const controls = [
      ...document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ].filter((control) => control.checkVisibility({ visibilityProperty: true }))
    return launchers.flatMap((button) => {
      const own = button.getBoundingClientRect()
      // A bar that holds the launcher is opaque: what scrolls behind it is covered by the bar,
      // so only the bar's own controls can sit under its launcher.
      const holder = button.closest('[data-launcher-clear]')
      return controls.flatMap((control) => {
        if (holder && !holder.contains(control)) return []
        if (control === button || button.contains(control) || control.contains(button)) return []
        const rect = control.getBoundingClientRect()
        if (!rect.width || !rect.height) return []
        const hit =
          own.left < rect.right &&
          rect.left < own.right &&
          own.top < rect.bottom &&
          rect.top < own.bottom
        return hit
          ? [control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 40)]
          : []
      })
    })
  })
}

async function axe(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`,
  )
}

test.describe('the launcher is on every page signed in', () => {
  test('in the bottom-right corner of each place, and not on the signed-out page', async ({
    page,
  }) => {
    // Every place loaded in turn: a busy machine needs more than the default 30 s.
    test.setTimeout(90_000)
    for (const route of routes) {
      await openPage(page, route.path, { ...widths[0], theme: 'light' })
      // The assistant's own pages are the assistant expanded: no second one to dock.
      if (assistantPages.has(route.path)) {
        await expect(page.getByRole('heading', { level: 1 }), route.name).toBeAttached()
        await expect(launcher(page), route.name).toHaveCount(0)
        continue
      }
      await expect(launcher(page), route.name).toBeVisible()
      const button = await box(launcher(page))
      expect(button.x + button.width, route.name).toBeLessThanOrEqual(1440 - 16)
      expect(button.y + button.height, route.name).toBeLessThanOrEqual(900 - 16)
      expect(button.width, route.name).toBe(40)
    }
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'signed-out'))
    await page.goto('/library')
    await expect(page.getByRole('heading', { name: 'Sign in to Heed' })).toBeVisible()
    await expect(launcher(page)).toHaveCount(0)
  })

  test('is reached with the keyboard and shows the focus ring', async ({ page }) => {
    await openPage(page, '/', { ...widths[0], theme: 'light' })
    await page.keyboard.press('Shift')
    await launcher(page).focus()
    await expect(launcher(page)).toBeFocused()
    const ring = await launcher(page).evaluate((element) => {
      const style = getComputedStyle(element)
      return [element.matches(':focus-visible'), style.outlineStyle, style.outlineWidth]
    })
    expect(ring).toEqual([true, 'solid', '2px'])
    await page.keyboard.press('Enter')
    await expect(assistant(page)).toBeVisible()
  })

  test('the sidebar has the Assistant after Home, and the header has no assistant', async ({
    page,
  }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    const header = page.locator('[data-layout="header"]')
    await expect(header.getByRole('button', { name: 'Assistant' })).toHaveCount(0)
    await expect(header.getByRole('button', { name: 'Dock' })).toHaveCount(0)
    const main = sidebar(page).locator('[data-sidebar="group"]').first()
    await expect(main.getByRole('link').first()).toHaveText('Home')
    await expect(main.getByRole('link').nth(1)).toHaveText('Assistant')
    await expect(sidebar(page).getByText('Ask', { exact: true })).toHaveCount(0)
    await expect(sidebar(page).getByRole('link', { name: 'Try it' })).toHaveCount(0)
  })
})

test.describe('the assistant panel', () => {
  test('opens and closes, switches tabs and remembers the last one', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false')
    await launcher(page).click()
    await expect(assistant(page)).toBeVisible()
    await expect(assistant(page)).toBeFocused()
    await expect(launcher(page)).toHaveAttribute('aria-expanded', 'true')
    // Connecting your own AI is a setting of your own, not a tab of the assistant.
    await expect(assistant(page).getByRole('tab')).toHaveText(['Ask', 'Try a question'])
    await expect(assistant(page).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(assistant(page)).toContainText('Ask me about your numbers')
    // A record panel has previous and next; the assistant is not a list.
    await expect(assistant(page).getByRole('button', { name: 'Next' })).toHaveCount(0)
    // Docked, it keeps its width free: the page ends where the panel starts.
    await expect(assistant(page)).toHaveAttribute('data-mode', 'docked')
    const panel = await box(assistant(page))
    const content = await box(page.locator('[data-slot="page"]'))
    expect(content.x + content.width).toBe(panel.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)
    // The launcher moves left of the panel.
    const button = await box(launcher(page))
    expect(button.x + button.width).toBeLessThanOrEqual(panel.x - 16)

    await assistant(page).getByRole('tab', { name: 'Try a question' }).click()
    await expect(assistant(page).getByRole('tab', { name: 'Try a question' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(assistant(page)).toContainText('See what an AI app gets')
    await assistant(page).getByRole('tab', { name: 'Ask' }).click()
    await expect(assistant(page)).toContainText('Ask me about your numbers')
    await assistant(page).getByRole('tab', { name: 'Try a question' }).click()

    // It stays open from page to page.
    await page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Gaps' }).click()
    await expect(page).toHaveURL(/\/gaps$/)
    await expect(assistant(page)).toBeVisible()

    await assistant(page).getByRole('tab', { name: 'Try a question' }).focus()
    await page.keyboard.press('Escape')
    await expect(assistant(page)).toHaveCount(0)
    await expect(launcher(page)).toBeFocused()
    await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false')

    // It opens again on the tab last shown, and the launcher closes it too.
    await launcher(page).click()
    await expect(assistant(page).getByRole('tab', { name: 'Try a question' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await launcher(page).click()
    await expect(assistant(page)).toHaveCount(0)
  })

  test('Control backslash and g then i dock each tab, and are in the palette and the shortcuts', async ({
    page,
  }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // The same key closes it, and the focus goes back to the page.
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toHaveCount(0)
    await expect(page.locator('#main')).toBeFocused()
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeVisible()
    await page.keyboard.press('g')
    await page.keyboard.press('i')
    await expect(assistant(page).getByRole('tab', { name: 'Try a question' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press('g')
    await page.keyboard.press('i')
    await expect(assistant(page)).toHaveCount(0)

    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    const ask = palette.getByRole('group', { name: 'Ask' })
    await expect(ask.getByRole('option')).toHaveText([
      /^Ask the assistant\s*(⌘|Ctrl)\s*\\$/,
      /^Try a question\s*G\s*then\s*I$/,
    ])
    await expect(
      palette.getByRole('group', { name: 'Go to' }).getByRole('option').nth(1),
    ).toHaveText(/^Assistant\s*G\s*then\s*A$/)
    await ask.getByRole('option', { name: /^Try a question/ }).click()
    await expect(assistant(page).getByRole('tab', { name: 'Try a question' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press('Escape')
    await expect(assistant(page)).toHaveCount(0)

    await page.keyboard.press('Shift+Slash')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Ask the assistant' })).toHaveText(
      /(⌘|Ctrl)\s*\\/,
    )
    await expect(sheet.getByRole('listitem').filter({ hasText: /^Assistant/ })).toHaveText(
      /G\s*then\s*A/,
    )
    await expect(sheet.getByRole('listitem').filter({ hasText: 'Try a question' })).toHaveText(
      /G\s*then\s*I/,
    )
  })

  test('replaces a record panel, and closing it shows the record again with its focus', async ({
    page,
  }) => {
    await openPage(page, '/library?panel=itm_jyfuvl07', { ...widths[0], theme: 'light' })
    const record = page.getByRole('region', { name: /Comparing Units per order/ })
    await expect(record).toBeVisible()
    const source = record.getByRole('tab', { name: 'Source' })
    await source.click()
    await expect(source).toBeFocused()

    // From the keyboard, with focus in the record.
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeVisible()
    await expect(record).toBeHidden()
    await expect(shownPanels(page)).toHaveCount(1)
    // The record is still open: its address and its width stay.
    await expect(page).toHaveURL(/panel=itm_jyfuvl07/)
    await expect
      .poll(async () => (await box(page.locator('[data-slot="page"]'))).width)
      .toBe(1440 - 48 - 480)
    await page.keyboard.press('Escape')
    await expect(assistant(page)).toHaveCount(0)
    await expect(record).toBeVisible()
    await expect(source).toBeFocused()

    // From the launcher, closed with its close button.
    await launcher(page).click()
    await expect(record).toBeHidden()
    await assistant(page).getByRole('button', { name: 'Close' }).click()
    await expect(record).toBeVisible()
    await expect(source).toBeFocused()

    // Escape in the record still closes the record, not something under it.
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="dock-panel"]')).toHaveCount(0)
  })

  test('a record opened from the grid takes the place of the assistant', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await launcher(page).click()
    await expect(assistant(page)).toBeVisible()
    await page
      .getByRole('link', {
        name: 'Comparing Units per order between the Netherlands and other markets',
      })
      .click()
    await expect(page).toHaveURL(/panel=itm_jyfuvl07/)
    await expect(assistant(page)).toHaveCount(0)
    await expect(shownPanels(page)).toHaveCount(1)
  })

  test('fills the screen on a phone, and the launcher makes way', async ({ page }) => {
    await openPage(page, '/library', { ...widths[2], theme: 'light' })
    await launcher(page).click()
    await expect(assistant(page)).toHaveAttribute('data-mode', 'full')
    expect(await box(assistant(page))).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    await expect(launcher(page)).toBeHidden()
    await assistant(page).getByRole('button', { name: 'Close' }).click()
    await expect(assistant(page)).toHaveCount(0)
    await expect(launcher(page)).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  test('toasts stack above the launcher', async ({ page }) => {
    await openPage(page, '/library/itm_jyfuvl07', { ...widths[0], theme: 'light' })
    await page.keyboard.press('f')
    const toast = page.getByRole('dialog').filter({ hasText: 'Added to favourites' })
    await expect(toast).toBeVisible()
    await settle(page)
    const message = await box(toast)
    const button = await box(launcher(page))
    expect(overlaps(message, button)).toBe(false)
    expect(message.y + message.height).toBeLessThanOrEqual(button.y)
  })
})

/**
 * How the panel starts to move: its animation as computed, and its opacity and slide on the
 * animation's first frame (seeked to, then put back at its end).
 */
function motionOf(panel: Locator) {
  return panel.evaluate((element) => {
    const style = getComputedStyle(element)
    const motion = {
      name: style.animationName,
      duration: style.animationDuration,
      easing: style.animationTimingFunction,
    }
    const [animation] = element.getAnimations()
    if (!animation) return { ...motion, from: null }
    animation.pause()
    animation.currentTime = 0
    const first = getComputedStyle(element)
    const from = { opacity: first.opacity, translate: first.translate }
    animation.finish()
    return { ...motion, from }
  })
}

type Exit = {
  name: string
  duration: string
  from: { opacity: string; translate: string } | null
  inert: boolean
  focused: string
  recordShown: boolean
  gone: number | null
}

/**
 * Watches the assistant's panel leave: as it starts (its animation, whether it is inert, where the
 * focus is a frame later, whether the record under it shows) and how long it stays.
 */
async function watchExit(page: Page) {
  await page.evaluate(() => {
    const own = window as unknown as { exits: Exit[] }
    own.exits = []
    const isAssistant = (node: Node): node is HTMLElement =>
      node instanceof HTMLElement &&
      node.dataset.slot === 'dock-panel' &&
      node.querySelector('h2')?.textContent === 'Assistant'
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target
        if (
          record.type === 'attributes' &&
          isAssistant(target) &&
          target.hasAttribute('data-leaving') &&
          !own.exits.some((exit) => exit.gone === null)
        ) {
          const start = performance.now()
          const style = getComputedStyle(target)
          const [animation] = target.getAnimations()
          const exit: Exit = {
            name: style.animationName,
            duration: style.animationDuration,
            from: null,
            inert: target.inert,
            focused: '',
            recordShown: false,
            gone: null,
          }
          if (animation) {
            // The exit's last frame: faded and slid back.
            const time = animation.currentTime
            animation.currentTime = 100
            const last = getComputedStyle(target)
            exit.from = { opacity: last.opacity, translate: last.translate }
            animation.currentTime = time
          }
          own.exits.push(exit)
          requestAnimationFrame(() => {
            const active = document.activeElement
            exit.focused = active?.getAttribute('aria-label') ?? active?.textContent ?? ''
            if (active?.id === 'main') exit.focused = '#main'
            exit.recordShown = [...document.querySelectorAll('[data-slot="dock-panel"]')].some(
              (panel) => panel !== target && !panel.hasAttribute('hidden'),
            )
          })
          const gone = new MutationObserver(() => {
            if (target.isConnected) return
            exit.gone = performance.now() - start
            gone.disconnect()
          })
          gone.observe(document.body, { childList: true, subtree: true })
        }
      }
    }).observe(document.body, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-leaving'],
    })
  })
  return async () => {
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { exits: Exit[] }).exits.at(-1)?.gone ?? null),
      )
      .not.toBeNull()
    return page.evaluate(() => (window as unknown as { exits: Exit[] }).exits.at(-1) as Exit)
  }
}

test.describe('the assistant panel moves, then rests (contract 10)', () => {
  test.beforeEach(({ page }) => page.emulateMedia({ reducedMotion: 'no-preference' }))

  test('slides and fades in over 200 ms, from the launcher and from the keyboard alike', async ({
    page,
  }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    const opening = {
      name: 'dock-in',
      duration: '0.2s',
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      from: { opacity: '0', translate: '16px' },
    }
    await launcher(page).click()
    await expect(assistant(page)).toBeVisible()
    expect(await motionOf(assistant(page))).toEqual(opening)
    await launcher(page).click()
    await expect(assistant(page)).toHaveCount(0)

    // Command or Control backslash opens it the same way (contract 10, rule 5).
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeVisible()
    expect(await motionOf(assistant(page))).toEqual(opening)
    await settle(page)
    // At rest it sits flush with the window's right edge.
    const panel = await box(assistant(page))
    expect(panel.x + panel.width).toBe(1440)
  })

  test('leaves in 100 ms, inert, with the focus already back on the page', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeFocused()
    const exited = await watchExit(page)
    await page.keyboard.press('Control+Backslash')
    const exit = await exited()
    expect(exit).toMatchObject({
      name: 'dock-out',
      duration: '0.1s',
      from: { opacity: '0', translate: '8px' },
      inert: true,
      focused: '#main',
      recordShown: false,
    })
    expect(exit.gone).toBeGreaterThanOrEqual(90)
    expect(exit.gone).toBeLessThan(1000)
    await expect(page.locator('#main')).toBeFocused()
    // The page has its full width again.
    await expect
      .poll(async () => (await box(page.locator('[data-slot="page"]'))).width)
      .toBeGreaterThan(1440 - 48 - 480)
  })

  test('leaves over a record panel, which is there at once with its focus', async ({ page }) => {
    await openPage(page, '/library?panel=itm_jyfuvl07', { ...widths[0], theme: 'light' })
    const record = page.getByRole('region', { name: /Comparing Units per order/ })
    const source = record.getByRole('tab', { name: 'Source' })
    await source.click()
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeFocused()
    await expect(record).toBeHidden()

    const exited = await watchExit(page)
    await page.keyboard.press('Control+Backslash')
    expect(await exited()).toMatchObject({
      name: 'dock-out',
      inert: true,
      focused: 'Source',
      recordShown: true,
    })
    await expect(source).toBeFocused()
    // Revealed, the record does not open a second time.
    expect((await motionOf(record)).name).toBe('none')

    // Closed from inside with Escape, the same.
    await launcher(page).click()
    await expect(record).toBeHidden()
    await assistant(page).getByRole('tab', { name: 'Ask' }).focus()
    const escaped = await watchExit(page)
    await page.keyboard.press('Escape')
    expect(await escaped()).toMatchObject({ inert: true, focused: 'Source', recordShown: true })
    await expect(source).toBeFocused()
    await expect(page).toHaveURL(/panel=itm_jyfuvl07/)
  })

  test('opened again while it leaves, it stays and takes the focus', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeFocused()
    await page.keyboard.press('Control+Backslash')
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeFocused()
    await expect(assistant(page)).not.toHaveAttribute('inert')
    await page.waitForTimeout(300)
    await expect(assistant(page)).toBeVisible()
    await expect(page.locator('[data-slot="dock-panel"]')).toHaveCount(1)
  })

  test('comes up from the bottom on a phone, and leaves to the launcher', async ({ page }) => {
    await openPage(page, '/library', { ...widths[2], theme: 'light' })
    await launcher(page).click()
    await expect(assistant(page)).toBeVisible()
    expect(await motionOf(assistant(page))).toMatchObject({
      name: 'dock-in',
      duration: '0.2s',
      from: { opacity: '0', translate: '0px 16px' },
    })
    const exited = await watchExit(page)
    await assistant(page).getByRole('button', { name: 'Close' }).click()
    expect(await exited()).toMatchObject({ name: 'dock-out', inert: true, focused: 'Assistant' })
    await expect(launcher(page)).toBeFocused()
  })

  test('only fades, in 100 ms, when the person asks for less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const size of [widths[0], widths[2]]) {
      await openPage(page, '/library', { ...size, theme: 'light' })
      await launcher(page).click()
      await expect(assistant(page)).toBeVisible()
      expect(await motionOf(assistant(page)), size.name).toMatchObject({
        name: 'dock-in',
        duration: '0.1s',
        from: { opacity: '0', translate: '0px' },
      })
      const exited = await watchExit(page)
      await assistant(page).getByRole('button', { name: 'Close' }).click()
      expect(await exited(), size.name).toMatchObject({
        name: 'dock-out',
        duration: '0.1s',
        from: { opacity: '0', translate: '0px' },
      })
    }
  })
})

test.describe('the launcher covers no bar at the bottom of a page', () => {
  for (const theme of themes)
    for (const size of widths) {
      const view = { ...size, theme }

      test(`the review screen's decision bar holds it, covering no control at ${size.name}, ${theme}`, async ({
        page,
      }) => {
        await signInAs(page, JON)
        await openPage(page, `/proposals/${READY}`, view)
        const bar = page.getByRole('region', { name: 'Your decision' })
        await expect(bar).toBeVisible()
        await settle(page)
        // One launcher: the bar's, at its end; the corner's steps aside.
        await expect(launcher(page)).toHaveCount(1)
        await expect(bar.getByRole('button', { name: 'Assistant', exact: true })).toBeVisible()
        await expect(page.locator('[data-slot="assistant-launcher"]')).toBeHidden()
        const held = await box(launcher(page))
        expect(held.width).toBe(size.width < 768 ? 44 : 32)
        const decisions = await box(bar.locator('[data-outcome]').filter({ visible: true }).last())
        expect(held.x).toBeGreaterThan(decisions.x + decisions.width)
        // From the top of the page to its end, the rail's controls scroll by under no launcher.
        const end = await page.evaluate(() => document.documentElement.scrollHeight)
        for (let y = 0; y <= end; y += size.height / 3) {
          await page.evaluate((top) => window.scrollTo(0, top), y)
          await settle(page)
          expect(await controlsUnderLauncher(page), `scrolled to ${y}`).toEqual([])
        }
        // The bar stays stuck to the window's bottom edge, holding the launcher.
        const stuck = await box(bar)
        expect(stuck.y + stuck.height).toBe(size.height)
        // It docks the assistant as the corner's does, and the focus comes back to it.
        await launcher(page).click()
        await expect(assistant(page)).toBeVisible()
        // On a phone the panel fills the screen over the bar, which waits behind it.
        if (size.width >= 768) await expect(launcher(page)).toHaveAttribute('aria-expanded', 'true')
        await assistant(page).getByRole('button', { name: 'Close' }).click()
        await expect(launcher(page)).toBeFocused()
        await expect(launcher(page)).toHaveAttribute('aria-expanded', 'false')
        if (shots) await page.screenshot({ path: `${shots}/review-${size.name}-${theme}.png` })
      })

      test(`the review panel at ${size.name}, ${theme}`, async ({ page }) => {
        await signInAs(page, JON)
        await openPage(page, `/proposals?panel=${READY}`, view)
        const bar = page.locator('[data-slot="dock-panel"]').getByRole('region', {
          name: 'Your decision',
        })
        await expect(bar).toBeVisible()
        await settle(page)
        if (size.name === '390') await expect(launcher(page)).toBeHidden()
        else await expect.poll(() => covered(page, '[data-outcome]')).toEqual([])
        if (shots)
          await page.screenshot({ path: `${shots}/review-panel-${size.name}-${theme}.png` })
      })

      test(`the Add a fact page at ${size.name}, ${theme}`, async ({ page }) => {
        await openPage(page, '/library/new', view)
        await settle(page)
        // The form's actions: in the header from 768 wide, in a bar at the bottom on a phone.
        await expect(
          page.getByRole('button', { name: 'Send for review' }).filter({ visible: true }),
        ).toHaveCount(1)
        const actions = 'button[type="submit"], [aria-label="More form actions"]'
        await expect.poll(() => covered(page, actions)).toEqual([])
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await settle(page)
        await expect.poll(() => covered(page, actions)).toEqual([])
        if (size.width < 768) {
          // On a phone the form's bar holds the assistant in its More menu: the corner is free.
          await expect(launcher(page)).toBeHidden()
          await page.getByRole('button', { name: 'More form actions' }).click()
          await page.getByRole('menuitem', { name: 'Ask the assistant' }).click()
          await expect(assistant(page)).toHaveAttribute('data-mode', 'full')
          await assistant(page).getByRole('button', { name: 'Close' }).click()
          await expect(page.getByRole('button', { name: 'More form actions' })).toBeFocused()
        } else {
          const scrolled = await box(launcher(page))
          expect(scrolled.y + scrolled.height).toBeLessThanOrEqual(size.height - 16)
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
          size.width,
        )
        if (shots) await page.screenshot({ path: `${shots}/add-context-${size.name}-${theme}.png` })
      })

      test(`the end of a page scrolls clear of it at ${size.name}, ${theme}`, async ({ page }) => {
        await signInAs(page, 'per_ravi')
        await openPage(page, '/admin?section=audit', view)
        await settle(page)
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await settle(page)
        await expect
          .poll(() => covered(page, '[data-slot="settings-audit"] [role="row"]:last-child'))
          .toEqual([])
      })

      test(`the library's totals at ${size.name}, ${theme}`, async ({ page }) => {
        await openPage(page, '/library', view)
        await settle(page)
        await expect.poll(() => covered(page)).toEqual([])
        if (shots) await page.screenshot({ path: `${shots}/library-${size.name}-${theme}.png` })
      })

      test(`axe with the assistant open at ${size.name}, ${theme}`, async ({ page }) => {
        // Four passes of axe over the library's rows: a busy machine needs more than 30 s.
        test.setTimeout(120_000)
        await openPage(page, '/library', view)
        expect(await axe(page)).toEqual([])
        await launcher(page).click()
        await expect(assistant(page)).toBeVisible()
        expect(await axe(page)).toEqual([])
        await assistant(page).getByRole('tab', { name: 'Try a question' }).click()
        expect(await axe(page)).toEqual([])
        if (shots) await page.screenshot({ path: `${shots}/assistant-${size.name}-${theme}.png` })
      })
    }
})

const phone = (page: Page) => (page.viewportSize()?.width ?? 1440) < 768
const address = (page: Page) =>
  decodeURIComponent(new URL(page.url()).pathname + new URL(page.url()).search)

/** Opens the assistant's page from the sidebar, from the phone's sheet below 768. */
async function openFromSidebar(page: Page) {
  if (phone(page)) await page.getByRole('button', { name: 'Open navigation' }).click()
  await sidebar(page).getByRole('link', { name: 'Assistant', exact: true }).click()
}

test.describe('one assistant, never two at once', () => {
  for (const size of [widths[0], widths[2]]) {
    test(`docked, expanded and docked again with the same conversation at ${size.name}`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...size, theme: 'light' })
      await launcher(page).click()
      await expect(assistant(page)).toBeVisible()
      await askAndWait(page, ASK_MATCH)

      // Expanded from the sidebar (on a phone, where the panel fills the screen, with its arrow):
      // the panel closes, and the corner has nothing to dock.
      if (phone(page)) await assistant(page).getByRole('link', { name: 'Open page' }).click()
      else await openFromSidebar(page)
      await expect(page).toHaveURL(/\/assistant$/)
      await expect(shownPanels(page)).toHaveCount(0)
      await expect(launcher(page)).toHaveCount(0)
      await expect(composers(page)).toHaveCount(1)
      await expect(page.getByText(ASK_MATCH)).toBeVisible()
      // The sidebar's entry is the place shown (in a closed sheet on a phone).
      if (!phone(page))
        await expect(
          sidebar(page).getByRole('link', { name: 'Assistant', exact: true }),
        ).toHaveAttribute('aria-current', 'page')
      // G then A on the page puts the focus in its composer.
      await page.locator('#main').focus()
      await page.keyboard.press('g')
      await page.keyboard.press('a')
      await expect(composers(page)).toBeFocused()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      )

      // Dock: back to the library, beside it, with the same conversation.
      await page.getByRole('button', { name: 'Dock', exact: true }).click()
      await expect(page).toHaveURL(/\/library$/)
      await expect(assistant(page)).toBeVisible()
      await expect(shownPanels(page)).toHaveCount(1)
      await expect(composers(page)).toHaveCount(1)
      await expect(assistant(page).getByText(ASK_MATCH)).toBeVisible()

      // Expanded with the panel's own arrow, then docked from the composer with the key.
      await assistant(page).getByRole('link', { name: 'Open page' }).click()
      await expect(page).toHaveURL(/\/assistant$/)
      await expect(shownPanels(page)).toHaveCount(0)
      await composers(page).focus()
      await page.keyboard.press('Control+Backslash')
      await expect(page).toHaveURL(/\/library$/)
      await expect(assistant(page).getByText(ASK_MATCH)).toBeVisible()
      await expect(composers(page)).toHaveCount(1)
    })

    test(`Try it is the assistant expanded too, and docks with its scope at ${size.name}`, async ({
      page,
    }) => {
      await openPage(page, TRY_IT_MATCH, { ...size, theme: 'light' })
      await expect(page.locator('[data-slot="try-it-delivered"]')).toBeVisible()
      await expect(launcher(page)).toHaveCount(0)
      await expect(shownPanels(page)).toHaveCount(0)
      // Nothing to come back to after a load of the page itself: docking goes Home.
      await page.getByRole('button', { name: 'Dock', exact: true }).click()
      await expect(page).toHaveURL(/\/$/)
      await expect(assistant(page).getByRole('tab', { name: 'Try a question' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await expect(assistant(page).locator('[data-slot="try-it-delivered"]')).toBeVisible()
      await expect(shownPanels(page)).toHaveCount(1)
      // Expanded from the sidebar, the assistant's page takes the same scope into its address.
      if (size.name === '390') await assistant(page).getByRole('button', { name: 'Close' }).click()
      await openFromSidebar(page)
      await expect
        .poll(() => address(page))
        .toBe(
          '/assistant?about=metric:average_order_value,val:market/united_kingdom&from=2026-09-08&to=2026-10-07',
        )
      await expect(shownPanels(page)).toHaveCount(0)
    })
  }

  test('the Assistant is in the sidebar for each role', async ({ page }) => {
    for (const person of ['per_ravi', 'per_jon', 'per_maria']) {
      await signInAs(page, person)
      await openPage(page, '/', { ...widths[0], theme: 'light' })
      await expect(
        sidebar(page).getByRole('link', { name: 'Assistant', exact: true }),
        person,
      ).toBeVisible()
    }
  })
})
