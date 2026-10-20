import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  The professional pass (contract 8.12), held by measurement: 40 pixel rows by default under a 36
  pixel header, chrome under 130 at 1440, under 15 percent bold characters on the library's first
  screen, row checkboxes and menus that show when they are needed (and always on touch), the
  ended issues note in the toolbar, and every other grid on the same header and rows.
*/

const desktop = { ...widths[0], theme: 'light' as const }

async function listReady(page: Page) {
  await expect(page.locator('[data-row-id]').nth(3)).toBeVisible({ timeout: 15_000 })
}

/**
 * The share of bold characters among the visible text on the screen: every text node in the
 * window, not hidden, not transparent and not covered, weighted by its length. The research
 * measured the library with the same walk (59 percent before this pass).
 */
function boldShare(page: Page) {
  return page.evaluate(() => {
    const shown = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || style.visibility === 'hidden') return false
        if (Number(style.opacity) === 0 || style.clipPath === 'inset(50%)') return false
      }
      return true
    }
    let all = 0
    let bold = 0
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').replace(/\s+/g, '')
      const parent = node.parentElement
      if (!text || !parent || !shown(parent)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const box = range.getBoundingClientRect()
      if (box.width === 0 || box.bottom <= 0 || box.top >= innerHeight || box.left >= innerWidth)
        continue
      all += text.length
      if (Number(getComputedStyle(parent).fontWeight) >= 600) bold += text.length
    }
    return bold / all
  })
}

/** From the top of the window to the first row, and how many rows show whole above the footer. */
function chrome(page: Page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[role="row"][data-row-id]')].map((row) =>
      row.getBoundingClientRect(),
    )
    rows.sort((a, b) => a.top - b.top)
    const footer = document.querySelector('[data-slot="list-footer"]')?.getBoundingClientRect()
    const limit = footer?.top ?? innerHeight
    const first = rows[0]
    return {
      top: first?.top ?? Number.NaN,
      height: first?.height ?? Number.NaN,
      whole: rows.filter((row) => row.top >= (first?.top ?? 0) && row.bottom <= limit).length,
    }
  })
}

test.describe('the library at 1440 by 900', () => {
  test('rows are 40 by default under a 36 header, and the chrome is under 130', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const measured = await chrome(page)
    expect(measured.height).toBe(40)
    expect(measured.top).toBeLessThan(130)
    expect(measured.whole).toBeGreaterThanOrEqual(18)
    expect((await page.locator('[data-layout="header"]').boundingBox())?.height).toBe(48)
    const header = page
      .getByRole('row')
      .filter({ has: page.getByRole('columnheader') })
      .first()
    expect((await header.boundingBox())?.height).toBe(36)
    // Comfortable stays a choice in the density menu, at 48.
    await page.getByRole('button', { name: 'Density and columns' }).click()
    await page.getByRole('button', { name: 'Comfortable' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(async () => (await chrome(page)).height).toBe(48)
  })

  for (const theme of themes) {
    test(`under 15 percent of the first screen is bold, ${theme}`, async ({ page }) => {
      await openPage(page, '/library', { ...desktop, theme })
      await listReady(page)
      // Away from the rows, so no row shows its hover controls.
      await page.mouse.move(1439, 899)
      expect(await boldShare(page)).toBeLessThan(0.15)
    })
  }

  test('titles, column headers and cells are 400, the page title and buttons 700', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const weight = (selector: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((element) => getComputedStyle(element).fontWeight)
    expect(await weight('[data-row-link]')).toBe('400')
    expect(await weight('[role="columnheader"] button')).toBe('400')
    expect(await weight('[data-slot="breadcrumb-page"]')).toBe('700')
    expect(await weight('[data-layout="toolbar"] button')).toBe('700')
  })

  test('a row shows its kind until it is hovered, focused or selected, then its checkbox', async ({
    page,
  }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_jon'))
    await openPage(page, '/library', desktop)
    await listReady(page)
    await page.mouse.move(1439, 899)
    const row = page.locator('[role="row"][data-row-id]').nth(2)
    const opacity = (selector: string) =>
      row.locator(selector).evaluate((element) => getComputedStyle(element).opacity)
    const box = row.getByRole('checkbox')
    // At rest: the kind, and a checkbox that a screen reader still finds by its name.
    await expect(box).toHaveAccessibleName(/^Select /)
    await expect.poll(() => opacity('[role="checkbox"]')).toBe('0')
    await expect.poll(() => opacity('[data-slot="kind-icon"]')).toBe('1')
    // Hovered: the checkbox and the row menu.
    await row.hover()
    await expect.poll(() => opacity('[role="checkbox"]')).toBe('1')
    await expect.poll(() => opacity('[data-slot="kind-icon"]')).toBe('0')
    await expect.poll(() => opacity('button[aria-label^="Actions for"]')).toBe('1')
    // Selected, with the pointer gone: the checkbox stays.
    await box.click()
    await page.mouse.move(1439, 899)
    await expect.poll(() => opacity('[role="checkbox"]')).toBe('1')
    // From the keyboard: the cursor row shows its checkbox, and x selects it.
    const next = page.locator('[role="row"][data-row-id]').nth(0)
    await page.keyboard.press('j')
    await expect
      .poll(() =>
        next.locator('[role="checkbox"]').evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe('1')
  })

  test('the ended issues note sits in the toolbar, not in a band of its own', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const note = page.locator('[data-layout="toolbar"] [data-slot="hidden-ended-issues"]')
    await expect(note).toBeVisible()
    await expect(note).toHaveAccessibleName(/^\d+ ended issues? hidden Show$/)
    await expect(page.getByRole('group', { name: 'Hidden facts' })).toBeHidden()
    await note.click()
    await expect(page).toHaveURL(/ended=show/)
  })
})

test.describe('the shell', () => {
  test('sidebar items are 28 at 1440, and a phone keeps its 56 header', async ({ page }) => {
    await openPage(page, '/library', desktop)
    const home = page
      .locator('[data-slot="sidebar"]')
      .getByRole('link', { name: 'Home', exact: true })
    expect((await home.boundingBox())?.height).toBe(28)
    await openPage(page, '/library', { ...widths[2], theme: 'light' })
    expect((await page.locator('[data-layout="header"]').boundingBox())?.height).toBe(56)
  })

  /*
    Rule 4 and contract 8.10: on a list or overview page the header's Add a fact is the one
    filled button, so Health's Write a test question and the Editions live card's What changed
    are outline. Health and Editions are opened by the people they are for.
  */
  for (const { path, person, ready } of [
    { path: '/', ready: 'Home' },
    { path: '/library', ready: 'Filter' },
    { path: '/catalogue', ready: 'Filter' },
    { path: '/proposals', ready: 'Filter' },
    { path: '/health', person: 'per_jon', ready: 'Write a test question' },
    { path: '/editions', person: 'per_ravi', ready: 'What changed' },
    { path: '/admin', person: 'per_ravi', ready: 'Create a domain' },
    { path: '/settings', ready: 'Profile and appearance' },
  ]) {
    test(`${path}: Add a fact is the one filled button`, async ({ page }) => {
      if (person)
        await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), person)
      await openPage(page, path, desktop)
      await expect(page.getByText(ready, { exact: true }).first()).toBeVisible({ timeout: 15_000 })
      const filled = await page.evaluate(() => {
        const probe = document.createElement('div')
        probe.style.backgroundColor = 'var(--primary)'
        document.body.append(probe)
        const primary = getComputedStyle(probe).backgroundColor
        probe.remove()
        return [...document.querySelectorAll('button, a')]
          .filter((element) => {
            const box = element.getBoundingClientRect()
            return box.width > 0 && getComputedStyle(element).backgroundColor === primary
          })
          .map((element) => element.textContent?.trim() ?? '')
      })
      expect(filled).toEqual(['Add a fact'])
    })
  }
})

/**
 * One action bar on the list pages (the captain's request): the Library, the Catalogue, Proposals
 * and Gaps put their controls on one line, at the same top and height, from the gutter on the
 * left, with the search field ending at the gutter on the right, as the table under them does.
 */
test.describe('the action bar lines up across the list pages', () => {
  const lists = [
    { name: 'Library', path: '/library' },
    { name: 'Catalogue', path: '/catalogue' },
    { name: 'Proposals', path: '/proposals?view=mine' },
    { name: 'Gaps', path: '/gaps' },
  ]
  for (const size of widths) {
    test(`at ${size.name} every control shares one top and height, on the gutters`, async ({
      page,
    }) => {
      // A high-risk approver reviews proposals and keeps the Gaps page, which sends an owner to
      // Health (slice W8), so every one of these list pages is his.
      await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_lars'))
      const rows: {
        name: string
        top: number
        height: number
        left: number
        right: number
        search: number
      }[] = []
      for (const list of lists) {
        await openPage(page, list.path, { ...size, theme: 'light' })
        const toolbar = page.locator('[data-layout="toolbar"]')
        await expect(toolbar.locator('button:visible').first()).toBeVisible({ timeout: 15_000 })
        // The first line of the bar: what a phone moves to a second row (the search) is left out.
        const boxes = await toolbar.evaluate((bar) => {
          const controls = [...bar.querySelectorAll('button, a, [data-slot="input-group"]')].filter(
            (element) => element.getBoundingClientRect().width > 0,
          )
          const first = Math.min(...controls.map((element) => element.getBoundingClientRect().top))
          return controls
            .map((element) => element.getBoundingClientRect())
            .filter((box) => box.top < first + 1)
            .map((box) => ({ top: box.top, height: box.height, left: box.left, right: box.right }))
        })
        const tops = new Set(boxes.map((box) => box.top))
        const heights = new Set(boxes.map((box) => box.height))
        expect([...tops], list.name).toHaveLength(1)
        expect([...heights], list.name).toHaveLength(1)
        rows.push({
          name: list.name,
          top: boxes[0]?.top ?? Number.NaN,
          height: boxes[0]?.height ?? Number.NaN,
          left: Math.min(...boxes.map((box) => box.left)),
          right: Math.max(...boxes.map((box) => box.right)),
          // Where the search field ends: the count after it has one fixed slot on every page.
          search: await toolbar
            .locator('[data-slot="input-group"]')
            .evaluate((element) => element.getBoundingClientRect().right),
        })
      }
      const [library, ...others] = rows
      for (const other of others) {
        expect(other.top, other.name).toBe(library?.top)
        expect(other.height, other.name).toBe(library?.height)
        expect(other.left, other.name).toBe(library?.left)
        if (size.width >= 768) expect(other.search, other.name).toBe(library?.search)
      }
      expect(library?.height).toBe(size.width < 768 ? 44 : 28)
    })
  }
})

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 1440, height: 900 } })

  test('the row menu always shows, and the rows keep the comfortable 48', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const row = page.locator('[role="row"][data-row-id]').nth(1)
    await expect
      .poll(() =>
        row
          .locator('button[aria-label^="Actions for"]')
          .evaluate((element) => getComputedStyle(element).opacity),
      )
      .toBe('1')
    expect((await row.boundingBox())?.height).toBe(48)
  })
})

/**
 * Every grid page: its column header is 36 with 400 labels, its rows 40 with a 400 title. A grid
 * whose rows hold two lines (a rate and its change, in Health's domain health) grows from 40.
 */
const grids: {
  name: string
  path: string
  person?: string
  preferences?: Record<string, string>
  row: string
  title: string
  twoLines?: boolean
}[] = [
  { name: 'Home', path: '/', row: '[data-slot="home-grid"] [role="row"][data-row-id]', title: 'a' },
  {
    name: 'Proposals',
    path: '/proposals?view=mine',
    row: '[role="row"][data-row-id]',
    title: '[data-row-link]',
  },
  {
    name: 'the review queue',
    path: '/proposals?view=review',
    person: 'per_jon',
    row: '[role="row"][data-row-id]',
    title: '[data-row-link]',
  },
  {
    name: 'Gaps',
    path: '/gaps',
    row: '[role="row"][data-row-id]',
    title: '[data-row-link]',
  },
  {
    name: 'the catalogue in compact rows',
    path: '/catalogue',
    preferences: { 'cl.catalogue.density': 'compact' },
    row: '[role="row"][data-term-key]',
    title: '[data-term-link]',
  },
  {
    name: "Health's domain health",
    path: '/health',
    person: 'per_jon',
    row: '[data-slot="quality-grid"] [role="row"][data-row-id]',
    title: '[data-row-link]',
    twoLines: true,
  },
  {
    name: 'MCP clients',
    path: '/admin?section=gateway',
    person: 'per_ravi',
    row: '[data-slot="clients-grid"] [role="row"][data-client]',
    title: '[role="cell"] span span',
  },
]

for (const grid of grids) {
  test(`${grid.name}: a 36 header of 400 labels over 40 rows with a 400 title`, async ({
    page,
  }) => {
    await page.addInitScript(
      ({ person, preferences }) => {
        if (person) window.localStorage.setItem('cl.mock-person', person)
        for (const [key, value] of Object.entries(preferences))
          window.localStorage.setItem(key, JSON.stringify(value))
      },
      { person: grid.person, preferences: grid.preferences ?? {} },
    )
    await openPage(page, grid.path, desktop)
    const row = page.locator(grid.row).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    if (grid.twoLines) await expect(row).toHaveCSS('min-height', '40px')
    else expect((await row.boundingBox())?.height).toBe(40)
    expect(
      await row
        .locator(grid.title)
        .first()
        .evaluate((element) => getComputedStyle(element).fontWeight),
    ).toBe('400')
    const header = page.locator('[role="columnheader"]').first()
    expect(await header.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('400')
    expect(await header.evaluate((element) => getComputedStyle(element).fontSize)).toBe('12px')
    expect(
      await header.evaluate((element) => element.closest('[role="row"]')?.clientHeight),
    ).toBeLessThanOrEqual(36)
  })
}

/*
  The second pass (C2, contract 8.12): the docked panel puts the title first and names the kind
  and the place in its bar instead of the id, its footer is quiet (ghost actions beside the one
  primary), the Filter menu opens on a search field, and a loading list keeps its column header.
*/

/** The buttons in a region drawn with a box: a visible border or a fill. */
function boxedButtons(page: Page, selector: string) {
  return page.locator(selector).evaluate((region) =>
    [...region.querySelectorAll('button, a[data-slot="button"]')]
      .filter((button) => {
        const style = getComputedStyle(button)
        const border =
          parseFloat(style.borderTopWidth) > 0 &&
          style.borderTopColor !== 'rgba(0, 0, 0, 0)' &&
          style.borderTopColor !== 'transparent'
        const fill = style.backgroundColor !== 'rgba(0, 0, 0, 0)'
        return border || fill
      })
      .map((button) => button.textContent?.trim() ?? ''),
  )
}

test.describe('the panel, the menus and the states', () => {
  test('the library panel: the kind and the place in the bar, then the title, then the badges', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const row = page.locator('[data-row-id]').first()
    const id = await row.getAttribute('data-row-id')
    await row.locator('[data-row-link]').click()
    const panel = page.locator('[data-slot="dock-panel"]')
    const meta = panel.locator('[data-slot="dock-meta"]')
    await expect(meta).toHaveText(/^(Note|Event|Guide|Example|Issue) ?· 1 of 1,404$/)
    await expect(meta).not.toContainText(id ?? 'itm_')
    expect(await meta.evaluate((element) => getComputedStyle(element).fontFamily)).not.toMatch(
      /mono/i,
    )
    const order = await panel.evaluate((element) => {
      const heading = element.querySelector('h2')
      const badges = element.querySelector('[data-slot="item-badges"]')
      return heading && badges
        ? Boolean(heading.compareDocumentPosition(badges) & Node.DOCUMENT_POSITION_FOLLOWING)
        : null
    })
    expect(order).toBe(true)
    // Suggest a change and the More menu are ghost: no box in the footer without a primary.
    expect(await boxedButtons(page, '[data-slot="dock-footer"]')).toEqual([])
  })

  test('a proposal panel: ghost actions beside the one primary', async ({ page }) => {
    await openPage(page, '/proposals?view=mine', desktop)
    // The first match is the group's heading row, which has no link.
    await page
      .getByRole('row')
      .filter({ hasText: 'Draft', has: page.getByRole('link') })
      .first()
      .getByRole('link')
      .click()
    const footer = page.locator('[data-slot="dock-footer"]')
    await expect(footer.getByText('Continue editing')).toBeVisible()
    expect(await boxedButtons(page, '[data-slot="dock-footer"]')).toEqual(['Continue editing'])
  })

  test('the Filter menu opens on a search that finds a value in any field', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    const search = page.getByRole('searchbox', { name: 'Find a filter' })
    await expect(search).toBeFocused()
    await settle(page)
    // Fields and values are 28 high, at 400.
    const kind = page.getByRole('tab', { name: 'Kind' })
    expect((await kind.boundingBox())?.height).toBe(28)
    expect(await kind.evaluate((element) => getComputedStyle(element).fontWeight)).toBe('400')
    expect((await page.locator('[data-slot="filter-option"]').first().boundingBox())?.height).toBe(
      28,
    )
    await search.fill('sal')
    const domain = page.getByRole('region', { name: 'Domain' })
    await domain.getByRole('checkbox', { name: /^Sales/ }).click()
    await expect(page).toHaveURL(/area=/)
    await search.fill('zzz')
    await expect(page.getByText('No filter matches “zzz”.')).toBeVisible()
  })

  test('a loading list keeps its column header over pulsing rows', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'slow'))
    // The pulse is motion; the suite reduces motion by default, where the skeleton holds still.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openPage(page, '/library', desktop)
    const loading = page.getByRole('status', { name: 'Loading the library' })
    await expect(loading).toBeVisible()
    const header = loading.locator('[data-slot="loading-header"]')
    await expect(header).toContainText('Domain')
    // A placeholder hidden from assistive technology, so it is found by its role attribute.
    expect((await header.locator('[role="row"]').boundingBox())?.height).toBe(36)
    const pulse = await loading
      .locator('[data-slot="skeleton"]')
      .first()
      .evaluate((element) => getComputedStyle(element).animationDuration)
    expect(pulse).toBe('1.6s')
  })
})
