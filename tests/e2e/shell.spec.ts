import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { MOCK_CONNECT_REQUEST } from '../../src/web/api/mock-connections'
import { itemPages, openPage, panelPages, routes, settle, themes, widths } from './support'

test.describe('shell metrics', () => {
  test('1440: expanded sidebar is 256px wide and the header is 48px tall', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    const sidebar = await page.locator('[data-slot="sidebar-container"]').boundingBox()
    expect(sidebar?.width).toBe(256)
    const header = await page.locator('[data-layout="header"]').boundingBox()
    expect(header?.height).toBe(48)
  })

  // One hairline runs across the top of the shell: the sidebar's header row ends on the same
  // line as the app header, in the same token, expanded, folded to the rail and in the phone sheet.
  for (const theme of themes) {
    test(`one line under both header rows, ${theme}`, async ({ page }) => {
      const line = (selector: string) =>
        page.locator(selector).evaluate((row) => {
          const style = getComputedStyle(row)
          return {
            bottom: row.getBoundingClientRect().bottom,
            width: style.borderBottomWidth,
            style: style.borderBottomStyle,
            color: style.borderBottomColor,
          }
        })
      const sidebarRow = '[data-slot="sidebar-header"]'
      const appRow = '[data-layout="header"]'
      await openPage(page, '/library', { ...widths[0], theme })
      expect(await line(appRow)).toMatchObject({ bottom: 48, width: '1px', style: 'solid' })
      expect(await line(sidebarRow)).toEqual(await line(appRow))
      await page.getByRole('button', { name: 'Collapse the sidebar' }).click()
      await expect(page.getByRole('button', { name: 'Expand the sidebar' })).toBeVisible()
      expect(await line(sidebarRow)).toEqual(await line(appRow))
      await page.setViewportSize({ width: widths[2].width, height: widths[2].height })
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await settle(page)
      expect(await line(`[data-mobile="true"] ${sidebarRow}`)).toEqual(await line(appRow))
    })
  }

  // A count beside a sidebar label sits on the label's line: the same centre and baseline, on the
  // 28 pixel rows of the desktop and on the 44 pixel rows of the phone sheet.
  for (const theme of themes) {
    test(`a count shares its label's line, ${theme}`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_jon'))
      const lines = (scope: string) =>
        page.locator(scope).evaluate((sidebar) => {
          const line = (text: Element) => {
            const range = document.createRange()
            range.selectNodeContents(text)
            const box = range.getBoundingClientRect()
            const style = getComputedStyle(text)
            const canvas = document.createElement('canvas').getContext('2d')
            if (!canvas) throw new Error('No canvas')
            canvas.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
            const ascent = canvas.measureText(text.textContent ?? '').fontBoundingBoxAscent
            return { centre: (box.top + box.bottom) / 2, baseline: box.top + ascent }
          }
          const counts = [
            ...sidebar.querySelectorAll('[data-sidebar="menu-badge"] [data-slot="count-badge"]'),
            ...sidebar.querySelectorAll('[data-sidebar="menu-sub-button"] span + span'),
          ]
          return counts.map((count) => {
            const label = count.closest('li')?.querySelector('a > span')
            if (!label) throw new Error('No label beside the count')
            return { label: label.textContent, labelLine: line(label), countLine: line(count) }
          })
        })
      const expectAligned = async (scope: string) => {
        const found = await lines(scope)
        // Jon has one draft he has not submitted, so Drafts carries its number too.
        expect(found.map((row) => row.label)).toEqual(['Proposals', 'Needs checking', 'Drafts'])
        for (const row of found) {
          expect(row.countLine.centre, row.label ?? '').toBeCloseTo(row.labelLine.centre, 0)
          expect(row.countLine.baseline, row.label ?? '').toBeCloseTo(row.labelLine.baseline, 0)
        }
      }
      await openPage(page, '/library', { ...widths[0], theme })
      await expect(page.locator('[data-sidebar="menu-badge"]')).toBeVisible()
      await expect(page.locator('[data-slot="sidebar-drafts"]').first()).toBeVisible()
      await expectAligned('[data-slot="sidebar-container"]')
      await page.setViewportSize({ width: widths[2].width, height: widths[2].height })
      await page.getByRole('button', { name: 'Open navigation' }).click()
      await settle(page)
      await expectAligned('[data-mobile="true"]')
    })
  }

  test('1024: the sidebar is a 48px rail', async ({ page }) => {
    await openPage(page, '/library', { ...widths[1], theme: 'light' })
    const sidebar = await page.locator('[data-slot="sidebar-container"]').boundingBox()
    expect(sidebar?.width).toBe(48)
    await expect(
      page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Library' }),
    ).toBeVisible()
  })

  test('390: the sidebar is a sheet that opens from the header', async ({ page }) => {
    await openPage(page, '/library', { ...widths[2], theme: 'light' })
    await expect(page.locator('[data-slot="sidebar-container"]')).toBeHidden()
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const sheet = page.locator('[data-mobile="true"]')
    await expect(sheet).toBeVisible()
    expect((await sheet.boundingBox())?.width).toBeCloseTo(256, 1)
    // A place opened from it takes the screen: the sheet closes.
    await sheet.getByRole('link', { name: 'Assistant', exact: true }).click()
    await expect(page).toHaveURL(/\/assistant$/)
    await expect(sheet).toBeHidden()
  })

  /*
    The user button in the rail: its 24 pixel avatar sits centred in the 32 pixel button, as the
    16 pixel icons above it do, and nothing of it is cut. As in every rail button, the button
    clips the words beside the icon, so a screen reader still reads the name.
  */
  async function expectRailUser(page: Page) {
    const button = page.locator('[data-slot="sidebar"]').getByRole('button', { name: /Jon Abara/ })
    await expect(button).toHaveAccessibleName(/^JA Jon Abara Owner of Sales/)
    const sides = () =>
      button.evaluate((element) => {
        const outer = element.getBoundingClientRect()
        const avatar = element.querySelector('[data-slot="avatar"]')?.getBoundingClientRect()
        const icon = document
          .querySelector('[data-slot="sidebar"] a[data-sidebar="menu-button"] svg')
          ?.getBoundingClientRect()
        return {
          width: outer.width,
          left: avatar ? avatar.left - outer.left : null,
          right: avatar ? outer.right - avatar.right : null,
          centred:
            avatar && icon ? avatar.left + avatar.width / 2 - (icon.left + icon.width / 2) : null,
        }
      })
    await expect.poll(sides).toEqual({ width: 32, left: 4, right: 4, centred: 0 })
  }

  for (const theme of themes) {
    test(`the rail centres the user's avatar, ${theme}`, async ({ page }) => {
      await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_jon'))
      await openPage(page, '/library', { ...widths[1], theme })
      await expectRailUser(page)
    })

    test(`a docked panel folds the sidebar to the rail with the avatar centred, ${theme}`, async ({
      page,
    }) => {
      await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_jon'))
      await openPage(page, '/catalogue?panel=metric:orders', { ...widths[0], theme })
      await expect(page.locator('[data-slot="dock-panel"]')).toBeVisible()
      await expect
        .poll(
          async () => (await page.locator('[data-slot="sidebar-container"]').boundingBox())?.width,
        )
        .toBe(48)
      await expectRailUser(page)
    })
  }

  test('the sidebar toggle switches between the rail and the full sidebar', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await page.getByRole('button', { name: 'Collapse the sidebar' }).click()
    await expect
      .poll(
        async () => (await page.locator('[data-slot="sidebar-container"]').boundingBox())?.width,
      )
      .toBe(48)
    await page.getByRole('button', { name: 'Expand the sidebar' }).click()
    await expect
      .poll(
        async () => (await page.locator('[data-slot="sidebar-container"]').boundingBox())?.width,
      )
      .toBe(256)
    await page.keyboard.press('Control+b')
    await expect
      .poll(
        async () => (await page.locator('[data-slot="sidebar-container"]').boundingBox())?.width,
      )
      .toBe(48)
    await page.keyboard.press('Control+b')
    await expect
      .poll(
        async () => (await page.locator('[data-slot="sidebar-container"]').boundingBox())?.width,
      )
      .toBe(256)
  })
})

/*
  The Heed lockup at the top of the sidebar (docs/design/logo.md): the symbol and the wordmark, a
  link home named Heed. Both are drawn in the sidebar's foreground, so they invert with the theme
  and never take the accent. The symbol keeps its place on the icon column when the sidebar folds
  to the rail, where it expands it again.
*/
test.describe('the Heed lockup', () => {
  const header = (page: Page) => page.locator('[data-slot="sidebar-header"]')
  const box = async (page: Page, slot: string) => {
    const found = await header(page).locator(`[data-slot="${slot}"]`).boundingBox()
    return found && { x: found.x, y: found.y, width: found.width, height: found.height }
  }

  for (const theme of themes) {
    test(`1440: the symbol and the wordmark link home, in the foreground ink, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...widths[0], theme })
      const home = header(page).getByRole('link', { name: 'Heed', exact: true })
      await expect(home).toBeVisible()
      // Outlines, not text: the name is the link's label.
      await expect(home).toHaveText('')
      const ink = await home.evaluate((link) => {
        const sidebar = link.closest('[data-slot="sidebar-inner"]') ?? document.body
        return {
          marks: [...link.querySelectorAll('svg')].map((svg) => getComputedStyle(svg).fill),
          ink: getComputedStyle(sidebar).color,
          hidden: [...link.querySelectorAll('svg')].map((svg) => svg.getAttribute('aria-hidden')),
        }
      })
      expect(ink.marks).toEqual([ink.ink, ink.ink])
      expect(ink.hidden).toEqual(['true', 'true'])
      // The symbol is 18 by 20, centred on the nav icons' column (24 from the edge) and on the
      // breadcrumb's line, above the row's bottom hairline; the wordmark is 20 high on the same
      // line and starts on the labels' edge.
      const symbol = await box(page, 'logo-symbol')
      expect([symbol?.width, symbol?.height]).toEqual([18, 20])
      expect((symbol?.x ?? 0) + (symbol?.width ?? 0) / 2).toBe(24)
      const crumbs = await page.getByRole('navigation', { name: 'breadcrumb' }).boundingBox()
      expect((symbol?.y ?? 0) + (symbol?.height ?? 0) / 2).toBe(
        (crumbs?.y ?? 0) + (crumbs?.height ?? 0) / 2,
      )
      const wordmark = await box(page, 'logo-wordmark')
      expect([wordmark?.y, wordmark?.height]).toEqual([symbol?.y, 20])
      const label = await page
        .locator('[data-slot="sidebar"]')
        .getByRole('link', { name: 'Home' })
        .locator('span')
        .boundingBox()
      expect(wordmark?.x).toBe(label?.x)
      expect((wordmark?.x ?? 0) - (symbol?.x ?? 0) - (symbol?.width ?? 0)).toBe(7)

      const results = await new AxeBuilder({ page })
        .include('[data-slot="sidebar-header"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])

      await home.click()
      await expect(page).toHaveURL(/\/$/)
      await expect(page).toHaveTitle('Home - Heed')
    })

    test(`1440: folded to the rail, the symbol alone stays in place and expands it, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...widths[0], theme })
      const expanded = await box(page, 'logo-symbol')
      const collapse = page.getByRole('button', { name: 'Collapse the sidebar' })
      const before = await collapse.boundingBox()
      // The collapse button keeps its place: 8 in from the inside of the sidebar's 1 pixel border.
      expect(before && before.x + before.width).toBe(247)
      await collapse.click()
      await expect
        .poll(
          async () => (await page.locator('[data-slot="sidebar-container"]').boundingBox())?.width,
        )
        .toBe(48)
      await expect(header(page).locator('[data-slot="logo-wordmark"]')).toHaveCount(0)
      const expand = header(page).getByRole('button', { name: 'Expand the sidebar' })
      await expect(expand).toBeVisible()
      expect(await box(page, 'logo-symbol')).toEqual(expanded)
      const results = await new AxeBuilder({ page })
        .include('[data-slot="sidebar-header"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
      await expand.click()
      await expect(header(page).getByRole('link', { name: 'Heed', exact: true })).toBeVisible()
    })

    test(`390: the phone's menu opens on the lockup, a 44 pixel target, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...widths[2], theme })
      await page.getByRole('button', { name: 'Open navigation' }).click()
      const home = page
        .locator('[data-mobile="true"]')
        .getByRole('link', { name: 'Heed', exact: true })
      await expect(home).toBeVisible()
      expect((await home.boundingBox())?.height).toBe(44)
      // The sheet's slide leaves a sub-pixel transform on the box, so compare whole pixels.
      const symbol = await home.locator('[data-slot="logo-symbol"]').boundingBox()
      expect([symbol?.width, symbol?.height].map((side) => Math.round(side ?? 0))).toEqual([18, 20])
      await settle(page)
      const results = await new AxeBuilder({ page })
        .include('[data-mobile="true"] [data-slot="sidebar-header"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    })

    test(`1440: the consent and sign-in pages open on the 32 pixel lockup, ${theme}`, async ({
      page,
    }) => {
      for (const { path, heading } of [
        {
          path: `/connect/approve?request=${MOCK_CONNECT_REQUEST}`,
          heading: 'Allow Claude Desktop to use Heed as you?',
        },
        { path: '/signed-out', heading: 'Sign in to Heed' },
      ]) {
        await openPage(page, path, { ...widths[0], theme })
        const lockup = page.locator('main').getByRole('img', { name: 'Heed', exact: true })
        // Measured once the page has its heading: while it loads, the centred column sits lower.
        const title = page.getByText(heading, { exact: true })
        await expect(title).toBeVisible()
        await expect(lockup).toBeVisible()
        const found = await lockup.boundingBox()
        expect(found?.height).toBe(32)
        expect(Math.round(found?.width ?? 0)).toBe(97)
        // 24 to the heading under it, more than the logo's clear space of half its height.
        const under = await title.boundingBox()
        expect((under?.y ?? 0) - ((found?.y ?? 0) + (found?.height ?? 0))).toBe(24)
        const ink = await lockup.evaluate((svg) => ({
          mark: getComputedStyle(svg).fill,
          ink: getComputedStyle(document.body).color,
        }))
        expect(ink.mark).toBe(ink.ink)
      }
    })
  }
})

test.describe('navigation', () => {
  test('the sidebar marks the current page and the breadcrumb names it', async ({ page }) => {
    await openPage(page, '/gaps', { ...widths[0], theme: 'light' })
    await expect(
      page.locator('[data-slot="sidebar"]').getByRole('link', { name: 'Gaps' }),
    ).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText('Gaps')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gaps')
  })

  test('the library shows the readable items from the mock API', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    // Retired items and the three ended issues are left out of the default view.
    await expect(page.locator('#library-count')).toHaveText('1,404 facts')
  })

  test('typed search params round trip through the URL', async ({ page }) => {
    await openPage(page, '/library?kind=event&sort=title&bogus=1', {
      ...widths[0],
      theme: 'light',
    })
    await expect(page.getByRole('button', { name: 'Remove filter Kind: Event' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Title' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
    await openPage(page, '/library?kind=poem', { ...widths[0], theme: 'light' })
    await expect(page.locator('#library-count')).toHaveText('1,404 facts')
    await expect(page.getByRole('group', { name: 'Filters on' })).toHaveCount(0)
  })

  test('an unknown address shows a not found page inside the shell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/no-such-page')
    await expect(page.getByText("This page doesn't exist")).toBeVisible()
    await expect(page).toHaveTitle('Page not found - Heed')
    await expect(page.locator('[data-layout="header"]')).toBeVisible()
  })

  test('an unknown item shows not found', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/library/itm_missing')
    await expect(page.getByText("This page doesn't exist")).toBeVisible()
  })
})

test.describe('command palette', () => {
  test('opens from the keyboard, searches the registry and navigates', async ({ page }) => {
    await openPage(page, '/', { ...widths[0], theme: 'light' })
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await expect(dialog).toBeVisible()
    await page.keyboard.type('gaps')
    // The list fills in as the library loads, so Enter waits until Gaps is the chosen option.
    await expect(dialog.getByRole('option', { name: /^Gaps/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/gaps$/)
    await expect(dialog).toBeHidden()
  })

  test('opens from the header button and lists every group', async ({ page }) => {
    await openPage(page, '/', { ...widths[0], theme: 'light' })
    await page.getByRole('button', { name: 'Search' }).click()
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    for (const heading of ['Go to', 'Ask', 'Create', 'Appearance', 'View']) {
      await expect(dialog.getByText(heading, { exact: true })).toBeVisible()
    }
  })

  test('finds a metric or dimension of the catalogue and opens its page', async ({ page }) => {
    await openPage(page, '/library', { ...widths[0], theme: 'light' })
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await expect(dialog).toBeVisible()
    await page.keyboard.type('units per order')
    // Named outright, the metric leads the items that mention it.
    const terms = dialog.getByRole('group', { name: 'Catalogue' })
    await expect(terms.getByRole('option', { name: /Units per order/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/catalogue\/metric\/units_per_order$/)
    await expect(dialog).toBeHidden()

    await page.keyboard.press('Control+k')
    await expect(dialog).toBeVisible()
    await page.keyboard.type('market')
    await terms.getByRole('option', { name: 'Dimension Market All domains' }).click()
    await expect(page).toHaveURL(/\/catalogue\/dimension\/market$/)
  })

  test('a sequence hotkey from the registry navigates', async ({ page }) => {
    await openPage(page, '/', { ...widths[0], theme: 'light' })
    await page.keyboard.press('g')
    await page.keyboard.press('l')
    await expect(page).toHaveURL(/\/library$/)
  })
})

/*
  Command or Control K opens the palette on every page, whatever has focus there: the shortcut is
  bound once, in the shell, and works in fields and docked panels too (contract 9.1). The fixture
  browser reports Windows, where it is Control K; a Mac browser uses Command K, and Control K is
  then left to the text fields (delete to the end of the line).
*/
const everyPage = [
  ...routes,
  itemPages[0],
  ...panelPages.filter((panel) => panel.path.startsWith('/catalogue')),
  { name: 'metric page', path: '/catalogue/metric/orders' },
  { name: 'dimension page', path: '/catalogue/dimension/market' },
]

async function expectPaletteOpens(page: Page, chord: string, path: string) {
  const dialog = page.getByRole('dialog', { name: 'Command palette' })
  await page.keyboard.press(chord)
  await expect(dialog, path).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog, path).toBeHidden()
}

test.describe('the palette shortcut on every page', () => {
  for (const { name, path } of everyPage) {
    test(`Control K opens the palette on ${name}`, async ({ page }) => {
      await openPage(page, path, { ...widths[0], theme: 'light' })
      await expectPaletteOpens(page, 'Control+k', path)
    })
  }

  test('Control K opens it from the catalogue search and from a row', async ({ page }) => {
    await openPage(page, '/catalogue', { ...widths[0], theme: 'light' })
    await page.getByRole('textbox', { name: 'Search metrics and dimensions' }).focus()
    await expectPaletteOpens(page, 'Control+k', 'catalogue search')
    await page.getByRole('link', { name: 'Orders' }).first().focus()
    await expectPaletteOpens(page, 'Control+k', 'catalogue row')
  })
})

test.describe('the palette shortcut on a Mac', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  })

  for (const { name, path } of everyPage) {
    test(`Command K opens the palette on ${name}`, async ({ page }) => {
      await openPage(page, path, { ...widths[0], theme: 'light' })
      await expectPaletteOpens(page, 'Meta+k', path)
    })
  }
})

test.describe('appearance', () => {
  test('the saved appearance is applied before the app renders (no flash)', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.appearance', 'dark'))
    // Hold the app bundle back until the checks are done, so only the inline bootstrap can have
    // run. A fixed delay is not enough on a loaded machine.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/assets/*.js', async (route) => {
      await held
      await route.continue()
    })
    await page.goto('/', { waitUntil: 'commit' })
    // The document element can be missing for a moment right after the commit.
    await page.waitForFunction(() => document.documentElement?.classList.contains('dark'))
    expect(await page.locator('#root').evaluate((element) => element.childElementCount)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe('dark')
    release()
  })

  test('the user menu changes and remembers the appearance', async ({ page }) => {
    await openPage(page, '/', { ...widths[0], theme: 'light' })
    await page.getByRole('button', { name: /Maria Lindqvist/ }).click()
    await page.getByRole('menuitemradio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)
    expect(await page.evaluate(() => window.localStorage.getItem('cl.appearance'))).toBe('dark')
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
  })

  test('system follows the operating system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.addInitScript(() => window.localStorage.setItem('cl.appearance', 'system'))
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/dark/)
  })
})

test.describe('design preview', () => {
  test('lists the templates', async ({ page }) => {
    await openPage(page, '/design-preview', { ...widths[0], theme: 'light' })
    await expect(page.getByRole('link', { name: 'List page' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tokens' })).toBeVisible()
  })

  test('an unknown template is not found', async ({ page }) => {
    await page.goto('/design-preview/nothing')
    await expect(page.getByText("This page doesn't exist")).toBeVisible()
  })
})

test.describe('header', () => {
  for (const size of widths) {
    for (const theme of themes) {
      test(`Add a fact is the same ink button on every page at ${size.name}px, ${theme}`, async ({
        page,
      }) => {
        const colours = new Set<string>()
        for (const path of ['/', '/library', '/library/itm_jyfuvl07', '/proposals']) {
          await openPage(page, path, { ...size, theme })
          const add = page
            .locator('[data-layout="header"]')
            .getByRole('button', { name: 'Add a fact' })
          await expect(add).toBeVisible()
          const [background, primary] = await add.evaluate((element) => {
            const probe = document.createElement('span')
            probe.style.color = 'var(--primary)'
            document.body.append(probe)
            const colour = getComputedStyle(probe).color
            probe.remove()
            return [getComputedStyle(element).backgroundColor, colour]
          })
          expect(background, path).toBe(primary)
          colours.add(background)
        }
        expect(colours.size).toBe(1)
      })
    }
  }
})

/*
  The menus by role (Quality design, section 0; navigation decision, 13 October 2026): everyone
  has the main places; a contributor, a high-risk approver or an auditor has Gaps among them;
  an owner or deputy has Editions and Health in the lower group behind a divider; Health holds their gaps,
  test questions and their domains' records; an administrator has the same, and Administration
  last in that group; an auditor has Administration for the history log. No one has a Settings row: a
  person's own Settings open from the user menu. The palette offers the same places, and a hidden
  address refuses. Everyone has the Assistant, which opens it full screen; Try it is not a place,
  and the launcher in the corner docks the assistant.
*/
const gone = ['Workbench', 'Quality', 'Areas', 'MCP and gateway']
const roleMenus = [
  {
    role: 'contributor',
    person: 'per_maria',
    entries: ['Assistant', 'Gaps', 'Docs'],
    hidden: [...gone, 'Health', 'Editions', 'Administration'],
  },
  {
    role: 'high-risk approver',
    person: 'per_lars',
    entries: ['Assistant', 'Gaps', 'Docs'],
    hidden: [...gone, 'Health', 'Editions', 'Administration'],
  },
  {
    role: 'auditor',
    person: 'per_ella',
    entries: ['Assistant', 'Gaps', 'Administration', 'Docs'],
    hidden: [...gone, 'Health', 'Editions'],
  },
  {
    role: 'owner',
    person: 'per_jon',
    entries: ['Assistant', 'Editions', 'Health', 'Docs'],
    hidden: [...gone, 'Gaps', 'Administration'],
  },
  {
    role: 'deputy',
    person: 'per_sofia',
    entries: ['Assistant', 'Editions', 'Health', 'Docs'],
    hidden: [...gone, 'Gaps', 'Administration'],
  },
  {
    role: 'administrator',
    person: 'per_ravi',
    entries: ['Assistant', 'Editions', 'Health', 'Administration', 'Docs'],
    hidden: [...gone, 'Gaps'],
  },
] as const

test.describe('menus by role', () => {
  for (const menu of roleMenus)
    test(`a ${menu.role} sees only the places that are theirs`, async ({ page }) => {
      await page.addInitScript(
        (id) => window.localStorage.setItem('cl.mock-person', id),
        menu.person,
      )
      await openPage(page, '/library', { ...widths[0], theme: 'light' })
      const sidebar = page.locator('[data-slot="sidebar"]')
      await expect(sidebar.getByRole('link', { name: 'Library' })).toBeVisible()
      // No labelled groups: the main places, then Editions, Health and Administration behind a
      // divider, and Docs, for everyone, behind one more.
      await expect(sidebar.getByText('Improve', { exact: true })).toHaveCount(0)
      // A group label, that is: the user's role line under their name may say Admin.
      await expect(
        sidebar
          .getByText('Admin', { exact: true })
          .and(page.locator(':not([data-testid="user-role"])')),
      ).toHaveCount(0)
      await expect(sidebar.getByRole('link', { name: 'Settings' })).toHaveCount(0)
      for (const entry of menu.entries)
        await expect(sidebar.getByRole('link', { name: entry, exact: true })).toBeVisible()
      await expect(sidebar.getByText('Ask', { exact: true })).toHaveCount(0)
      await expect(sidebar.getByRole('link', { name: 'Try it' })).toHaveCount(0)
      await expect(sidebar.getByRole('button', { name: 'Assistant' })).toHaveCount(0)
      for (const entry of menu.hidden)
        await expect(sidebar.getByRole('link', { name: entry, exact: true })).toHaveCount(0)
      await expect(sidebar.getByRole('link', { name: 'Evals and releases' })).toHaveCount(0)

      await page.keyboard.press('Control+k')
      const palette = page.getByRole('dialog', { name: 'Command palette' })
      const goTo = palette.getByRole('group', { name: 'Go to' })
      for (const entry of menu.entries)
        await expect(goTo.getByRole('option', { name: new RegExp(`^${entry}`) })).toHaveCount(1)
      for (const entry of menu.hidden)
        await expect(goTo.getByRole('option', { name: new RegExp(`^${entry}`) })).toHaveCount(0)
    })

  test('a contributor who follows an old Quality link is told whose page Health is', async ({
    page,
  }) => {
    await openPage(page, '/quality', { ...widths[0], theme: 'light' })
    await expect(page).toHaveURL(/\/health$/)
    await expect(page.getByText('Health is for owners and admins')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Domain health' })).toHaveCount(0)
  })

  test('the Try it address shows What an agent would get, and its old Connect tab moved', async ({
    page,
  }) => {
    await openPage(page, '/try-it', { ...widths[0], theme: 'light' })
    await expect(page.getByText('See what an AI app gets')).toBeVisible()
    await expect(page.getByRole('tab')).toHaveCount(0)
    await page.goto('/try-it?tab=connect')
    await expect(page).toHaveURL(/\/settings\?section=connect$/)
    await expect(
      page.getByRole('heading', { name: 'AI apps that can connect today' }),
    ).toBeVisible()
    // A contributor is not sent to the gateway; an administrator is.
    await expect(page.getByRole('link', { name: 'MCP and gateway' })).toHaveCount(0)
    await page.evaluate(() => window.localStorage.setItem('cl.mock-person', 'per_ravi'))
    await page.reload()
    await page.getByRole('main').getByRole('link', { name: 'MCP and gateway', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\?section=gateway$/)
  })
})
