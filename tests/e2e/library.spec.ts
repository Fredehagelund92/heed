import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, widths } from './support'

/*
  The context library: navigation between items the way a Notion, Linear or Google Docs user
  expects it. The keyboard map (contract 9.2), the preserved list position, search, the quick
  switcher, the views in the sidebar, the action bar (View, Filter, Sort, Group, Display), the
  icon-only status column, the item page with previous and next, and the states of the list
  (contract 9.5).
*/

const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

const rowLinks = (page: Page) => page.locator('[data-row-link]')
const focusedRowId = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-row-id]')?.getAttribute('data-row-id'))

/** Waits until the list has rendered rows: the index loads after the page shell appears. */
async function listReady(page: Page) {
  await expect(page.locator('[data-row-id]').nth(3)).toBeVisible({ timeout: 15_000 })
}

async function scenario(page: Page, name: string) {
  await page.addInitScript((value) => window.localStorage.setItem('cl.mock-scenario', value), name)
}

test.describe('keyboard map', () => {
  test('j and k move a real focus through the rows, Enter opens the panel, Escape returns', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const first = await page.locator('[data-row-id]').nth(0).getAttribute('data-row-id')
    const second = await page.locator('[data-row-id]').nth(1).getAttribute('data-row-id')
    await page.keyboard.press('j')
    expect(await focusedRowId(page)).toBe(first)
    await page.keyboard.press('j')
    expect(await focusedRowId(page)).toBe(second)
    await page.keyboard.press('k')
    expect(await focusedRowId(page)).toBe(first)
    await page.keyboard.press('ArrowDown')
    expect(await focusedRowId(page)).toBe(second)

    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`/library\\?panel=${second}$`))
    await expect(page.locator('[data-slot="dock-meta"]')).toContainText('2 of ')

    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/library$/)
    await expect.poll(() => focusedRowId(page)).toBe(second)
  })

  test('x selects rows, Shift+J extends, the selection bar copies links, Escape clears', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    await page.keyboard.press('j')
    await page.keyboard.press('x')
    const bar = page.getByRole('region', { name: 'Selected rows' })
    await expect(bar).toContainText('1 selected')
    await page.keyboard.press('Shift+J')
    await page.keyboard.press('Shift+J')
    await expect(bar).toContainText('3 selected')
    await expect(page.locator('[data-row-id][aria-selected="true"]')).toHaveCount(3)
    await page.keyboard.press('Escape')
    await expect(bar).toBeHidden()
  })

  test('/ focuses the search, ArrowDown moves from the search into the list', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    await page.keyboard.press('/')
    await expect(page.getByRole('textbox', { name: 'Search the library' })).toBeFocused()
    await page.keyboard.press('ArrowDown')
    const first = await page.locator('[data-row-id]').nth(0).getAttribute('data-row-id')
    expect(await focusedRowId(page)).toBe(first)
  })

  test('? opens the shortcut sheet from the registry', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await page.keyboard.press('Shift+Slash')
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(sheet).toBeVisible()
    await expect(sheet).toContainText('Move down')
    await expect(sheet).toContainText('Next fact')
  })
})

test.describe('list position', () => {
  test('going back from an item restores the scroll position and the row', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    await page.evaluate(() => window.scrollTo(0, 3000))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(3000)
    // A row in the middle of the screen, so opening it needs no scrolling. The virtualiser
    // renders the rows for the new offset a frame after the scroll, so wait for one.
    const middleRowId = () =>
      page.evaluate(() =>
        document
          .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
          ?.closest('[data-row-id]')
          ?.getAttribute('data-row-id'),
      )
    await expect.poll(middleRowId).toBeTruthy()
    const id = await middleRowId()
    const scrolled = await page.evaluate(() => window.scrollY)
    await page.locator(`[data-row-id="${id}"] [data-row-link]`).click()
    await expect(page).toHaveURL(new RegExp(`/library\\?panel=${id}$`))
    await page.getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(new RegExp(`/library/${id}`))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)

    await page.goBack()
    await expect(page).toHaveURL(new RegExp(`/library\\?panel=${id}$`))
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/library$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolled - 50)
    await expect.poll(() => focusedRowId(page)).toBe(id)
  })

  test('next and previous on an item keep the list, and the list follows to the last item', async ({
    page,
  }) => {
    await openPage(page, '/library?view=attention', desktop)
    await listReady(page)
    const ids = await page
      .locator('[data-row-id]')
      .evaluateAll((rows) => rows.slice(0, 4).map((row) => row.getAttribute('data-row-id')))
    await rowLinks(page).first().click()
    await page.getByRole('link', { name: 'Open page' }).click()
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }).getByText(/ · 1 of /),
    ).toBeVisible()
    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/library/${ids[1]}\\?view=attention`))
    await page.getByRole('button', { name: 'Next fact' }).click()
    await expect(page).toHaveURL(new RegExp(`/library/${ids[2]}`))
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }).getByText(/ · 3 of /),
    ).toBeVisible()
    await page.keyboard.press('k')
    await expect(page).toHaveURL(new RegExp(`/library/${ids[1]}`))

    // The breadcrumb goes back to the same view, with the cursor on the item last shown.
    await page
      .getByRole('navigation', { name: 'breadcrumb' })
      .getByRole('link', { name: 'Library' })
      .click()
    await expect(page).toHaveURL(/\/library\?view=attention$/)
    await expect.poll(() => focusedRowId(page)).toBe(ids[1])
  })

  test('next and previous step from the item being opened, not the one still on screen', async ({
    page,
  }) => {
    // Slow loading keeps the previous item on screen while the next one loads.
    await scenario(page, 'slow')
    await openPage(page, '/library?view=attention', desktop)
    await listReady(page)
    const ids = await page
      .locator('[data-row-id]')
      .evaluateAll((rows) => rows.slice(0, 4).map((row) => row.getAttribute('data-row-id')))
    await rowLinks(page).first().click()
    await page.getByRole('link', { name: 'Open page' }).click()
    const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' })
    await expect(breadcrumb.getByText(/ · 1 of /)).toBeVisible({ timeout: 15_000 })

    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/library/${ids[1]}\\?view=attention`))
    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`/library/${ids[2]}\\?view=attention`))
    await page.getByRole('button', { name: 'Next fact' }).click()
    await expect(page).toHaveURL(new RegExp(`/library/${ids[3]}\\?view=attention`))
    await expect(breadcrumb.getByText(/ · 4 of /)).toBeVisible({ timeout: 15_000 })

    await page.keyboard.press('k')
    await page.getByRole('button', { name: 'Previous fact' }).click()
    await expect(page).toHaveURL(new RegExp(`/library/${ids[1]}\\?view=attention`))
    await expect(breadcrumb.getByText(/ · 2 of /)).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('search and the action bar', () => {
  test('filters as you type, marks the match and says when nothing matches', async ({ page }) => {
    await openPage(page, '/library', desktop)
    const search = page.getByRole('textbox', { name: 'Search the library' })
    await search.fill('norway')
    await expect(page).toHaveURL(/q=norway/)
    const count = page.locator('#library-count')
    await expect(count).not.toHaveText('1,404 facts')
    await expect(page.locator('[data-row-link] mark').first()).toHaveText(/norway/i)
    await search.fill('zzzzqqq')
    await expect(page.getByText('No facts match')).toBeVisible()
    await expect(page.getByText('Nothing matches “zzzzqqq”')).toBeVisible()
    await page.getByRole('button', { name: 'Clear search and filters' }).click()
    await expect(count).toHaveText('1,404 facts')
  })

  test('the action bar filters, sorts, groups and changes density, each from its own button', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const bar = page.getByRole('search', { name: 'Library' })

    await bar.getByRole('button', { name: 'Filter' }).click()
    const filter = page.locator('[data-slot="popover-content"]')
    await filter.getByRole('tab', { name: 'Kind' }).click()
    await filter.getByRole('checkbox', { name: 'Guide' }).click()
    await expect(page).toHaveURL(/kind=guide/)
    await page.keyboard.press('Escape')
    await expect(bar.getByRole('button', { name: 'Filter, 1 on' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove filter Kind: Guide' })).toBeVisible()
    await expect(page.locator('#library-count')).toHaveText(/^[\d,]+ of 1,404 facts$/)

    await bar.getByRole('button', { name: 'Sort: Last checked, newest first' }).click()
    await page.getByRole('menuitemradio', { name: 'Title' }).click()
    await expect(page).toHaveURL(/sort=title/)
    await page.getByRole('menuitemradio', { name: 'Z to A' }).click()
    await expect(page).toHaveURL(/dir=desc/)
    await page.keyboard.press('Escape')
    await expect(bar.getByRole('button', { name: 'Sort: Title, z to a' })).toBeVisible()

    await bar.getByRole('button', { name: 'Group by' }).click()
    await page.getByRole('menuitemradio', { name: 'Kind' }).click()
    await expect(page).toHaveURL(/group=kind/)
    await page.keyboard.press('Escape')
    await expect(bar.getByRole('button', { name: 'Grouped by Kind' })).toBeVisible()

    await bar.getByRole('button', { name: 'Density and columns' }).click()
    await page.getByRole('button', { name: 'Compact' }).click()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-row-id]').first()).toHaveCSS('height', '40px')

    await page.getByRole('button', { name: 'Add filter' }).click()
    await expect(
      page.locator('[data-slot="popover-content"]').getByRole('tab', { name: /Kind/ }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Remove filter Kind: Guide' }).click()
    await expect(page).not.toHaveURL(/kind=/)
    await expect(bar.getByRole('button', { name: 'Filter', exact: true })).toBeVisible()

    await bar.getByRole('button', { name: 'View: All facts' }).click()
    await page.getByRole('menuitemradio', { name: 'Needs checking' }).click()
    await expect(page).toHaveURL(/view=attention/)
    await expect(bar.getByRole('button', { name: 'View: Needs checking' })).toBeVisible()
  })

  test('the Filter menu counts each value and shows it as the table reads it', async ({ page }) => {
    await openPage(page, '/library?area=area_sales', desktop)
    await listReady(page)
    await page.getByRole('button', { name: 'Filter, 1 on' }).click()
    const filter = page.locator('[data-slot="popover-content"]')
    // The field with a value opens first.
    await expect(filter.getByRole('tab', { name: /Domain/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(filter.getByRole('checkbox', { name: 'Sales' })).toBeChecked()
    await expect(filter.locator('[data-slot="domain-badge"]').first()).toBeVisible()
    // A ticked option counts what the list shows once it is unticked.
    const option = filter.locator('[data-slot="filter-option"]').filter({ hasText: 'Sales' })
    const promised = (await option.textContent())?.match(/([\d,]+)\s*$/)?.[1]
    expect(promised).toBeTruthy()
    await filter.getByRole('checkbox', { name: 'Sales' }).click()
    await expect(page).not.toHaveURL(/area=/)
    await expect(page.locator('#library-count')).toContainText(`${promised}`)
  })

  test('a Filter menu count is the list length after ticking that option', async ({ page }) => {
    await openPage(page, '/library?kind=event', desktop)
    await listReady(page)
    await page.getByRole('button', { name: 'Filter, 1 on' }).click()
    const filter = page.locator('[data-slot="popover-content"]')
    const noteOption = filter.locator('[data-slot="filter-option"]').filter({ hasText: 'Note' })
    const promised = (await noteOption.textContent())?.match(/([\d,]+)\s*$/)?.[1]
    await filter.getByRole('checkbox', { name: 'Note' }).click()
    await expect(page).toHaveURL(/kind=event%2Cnote|kind=event,note/)
    await expect(page.locator('#library-count')).toContainText(`${promised}`)
  })

  for (const size of [desktop, phone]) {
    test(`at ${size.width} the Filter menu fits its desktop or phone placement`, async ({
      page,
    }) => {
      await openPage(page, '/library', size)
      const trigger = page
        .getByRole('search', { name: 'Library' })
        .getByRole('button', { name: 'Filter', exact: true })
      await trigger.click()
      const panel = page.locator('[data-slot="popover-content"]')
      await expect(panel).toBeVisible()
      await settle(page)
      const button = await trigger.boundingBox()
      const box = await panel.boundingBox()
      if (!button || !box) throw new Error('no box')
      if (size.width < 768) {
        expect(box.x).toBe(0)
        expect(box.width).toBe(size.width)
        expect(box.y + box.height).toBe(size.height)
      } else {
        expect(box.y).toBeGreaterThanOrEqual(button.y + button.height)
        expect(box.x).toBeGreaterThanOrEqual(16)
        expect(box.x + box.width).toBeLessThanOrEqual(size.width - 16)
        expect(box.y + box.height).toBeLessThanOrEqual(size.height - 16)
        if (size.width > 1000) expect(Math.abs(box.x - button.x)).toBeLessThanOrEqual(1)
      }
      await expect(panel.getByRole('tablist', { name: 'Filter by' })).toBeVisible()
    })
  }

  test('on a phone Sort, Group and density fold into one menu, and search opens from a button', async ({
    page,
  }) => {
    await openPage(page, '/library', phone)
    await listReady(page)
    const bar = page.getByRole('search', { name: 'Library' })
    // Nothing leaves the bar sideways.
    const overflow = await bar.evaluate((element) => element.scrollWidth - element.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(bar.getByRole('button', { name: /^Sort:/ })).toBeHidden()
    await expect(bar.getByRole('button', { name: 'Group by' })).toBeHidden()
    await bar.getByRole('button', { name: 'Sort, group and density' }).click()
    await page.getByRole('menuitemradio', { name: 'Domain' }).first().click()
    await expect(page).toHaveURL(/sort=domain/)
    await page.keyboard.press('Escape')

    const field = page.getByRole('textbox', { name: 'Search the library' })
    await expect(field).toBeHidden()
    await bar.getByRole('button', { name: 'Search the library' }).click()
    await expect(field).toBeFocused()
    await field.fill('norway')
    await bar.getByRole('button', { name: 'Search the library' }).click()
    // A field that holds a query stays open.
    await expect(field).toBeVisible()
  })

  test('a header cell sorts, and says so to assistive technology', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await page.getByRole('columnheader', { name: 'Title' }).getByRole('button').click()
    await expect(page).toHaveURL(/sort=title/)
    await expect(page.getByRole('columnheader', { name: 'Title' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })
})

test.describe('sidebar', () => {
  test('views are one click away in the sidebar, domains are filtered inside the view', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    const sidebar = page.locator('[data-slot="sidebar"]')
    await expect(sidebar.getByText('Domains', { exact: true })).toHaveCount(0)
    await expect(sidebar.getByRole('link', { name: /^Sales/ })).toHaveCount(0)
    await sidebar.getByRole('link', { name: 'Needs checking' }).click()
    await expect(page).toHaveURL(/view=attention/)
    await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
      'Needs checking',
    )
    await page.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('tab', { name: 'Domain' }).click()
    await page.getByRole('checkbox', { name: 'Sales', exact: true }).click()
    await expect(page).toHaveURL(/view=attention&area=area_sales|area=area_sales&view=attention/)
    await expect(page.getByRole('button', { name: 'Remove filter Domain: Sales' })).toBeVisible()
  })

  test('f adds the open item to favourites in the sidebar', async ({ page }) => {
    await openPage(page, '/library', desktop)
    const title = await rowLinks(page).first().innerText()
    await rowLinks(page).first().click()
    await page.keyboard.press('f')
    // The sidebar is a rail while the panel is docked; its favourites show once it closes.
    await page.keyboard.press('Escape')
    const favourites = page.locator('[data-slot="sidebar"]').getByRole('link', { name: title })
    await expect(favourites).toBeVisible()
    await favourites.click()
    await expect(page.getByRole('button', { name: 'Remove from favourites' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

test.describe('quick switcher', () => {
  test('finds an item by name and opens it', async ({ page }) => {
    await openPage(page, '/', desktop)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await page.keyboard.type('norway closed')
    await expect(dialog.getByText('Facts')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/library\/itm_/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Norway')
  })

  test('shows the items opened last first', async ({ page }) => {
    await openPage(page, '/library', desktop)
    const title = await rowLinks(page).nth(2).innerText()
    await rowLinks(page).nth(2).click()
    await expect(
      page.locator('[data-slot="dock-panel"]').getByRole('heading', { level: 2 }),
    ).toHaveText(title)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await expect(dialog.getByText('Recent')).toBeVisible()
    await expect(dialog.getByRole('option').first()).toContainText(title)
  })

  test('offers to search the library when no item matches', async ({ page }) => {
    await openPage(page, '/', desktop)
    await page.keyboard.press('Control+k')
    await expect(
      page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox'),
    ).toBeFocused()
    await page.keyboard.type('zzzzqqq')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/library\?q=zzzzqqq/)
    await expect(page.getByText('No facts match')).toBeVisible()
  })
})

test.describe('states', () => {
  test('an empty library: the toolbar and one line, no start block', async ({ page }) => {
    await scenario(page, 'empty')
    await openPage(page, '/library', desktop)
    await expect(page.getByText('No facts yet')).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Search the library' })).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Start with something your team already knows' }),
    ).toHaveCount(0)
    await expect(page.getByText('Start from an example')).toHaveCount(0)
    await expect(page.getByText('How it works')).toHaveCount(0)
    // The header's Add a fact is still the one filled button.
    await page.getByRole('button', { name: 'Add a fact' }).click()
    await expect(page).toHaveURL(/\/library\/new$/)
  })

  test('a nearly empty library opens straight on its toolbar and table', async ({ page }) => {
    await scenario(page, 'few')
    await openPage(page, '/library', desktop)
    await expect(page.locator('[data-row-id]')).toHaveCount(6)
    await expect(page.getByRole('textbox', { name: 'Search the library' })).toBeVisible()
    await expect(page.getByText('Start from an example')).toHaveCount(0)
    // The toolbar sits right under the header: no block above the table.
    const header = await page.locator('[data-slot="page"]').boundingBox()
    const columns = await page.getByRole('columnheader', { name: /Title/ }).boundingBox()
    expect(columns!.y - header!.y).toBeLessThan(120)
  })

  test('error: an alert with Try again, nothing else broken', async ({ page }) => {
    await scenario(page, 'error')
    await openPage(page, '/library', desktop)
    await expect(page.getByText("We couldn't load the library")).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })
})

test.describe('item page', () => {
  for (const size of widths) {
    test(`at ${size.name}px the compact kind and domain badges follow the title`, async ({
      page,
    }) => {
      // A guide in Paid media, accepted: the row the captain reviewed.
      await openPage(page, '/library/itm_jyfuvl07', { ...size, theme: 'light' })
      const row = page.locator('[data-slot="item-badges"]')
      // Paid media is violet, not amber: amber means warning (contract 6.13).
      const domain = row.locator('[data-slot="domain-badge"]')
      await expect(domain).toHaveText('Paid media')
      await expect(domain).toHaveAttribute('data-tone', 'violet')
      const marks = await row
        .locator(':scope > [data-slot]')
        .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-slot')))
      expect(marks).toEqual(['kind-badge', 'domain-badge'])

      // The kind is a plain fact: an outline badge, no fill, the kind's muted icon. The
      // domain is the one tinted badge; a healthy item has no status badge, and its validity
      // chip is an outline badge of the same size.
      const style = (selector: string) =>
        row.locator(selector).evaluate((element) => {
          const css = getComputedStyle(element)
          return {
            background: css.backgroundColor,
            border: css.borderTopWidth,
            radius: css.borderTopLeftRadius,
            weight: css.fontWeight,
            height: element.getBoundingClientRect().height,
          }
        })
      const kind = await style('[data-slot="kind-badge"]')
      expect(kind.background).toBe('rgba(0, 0, 0, 0)')
      expect(kind.border).toBe('1px')
      expect(kind.radius).toBe('6px')
      expect(kind.weight).toBe('400')
      expect(kind.height).toBe(20)
      expect((await style('[data-slot="domain-badge"]')).background).not.toBe('rgba(0, 0, 0, 0)')
      await expect(page.locator('[data-slot="item-note"]')).toContainText('From ')
      const badge = row.locator('[data-slot="kind-badge"]')
      await expect(badge).toHaveAttribute('data-kind', 'guide')
      await expect(badge).toHaveAttribute('data-tone', 'neutral')
    })
  }
})

test.describe('phone', () => {
  test('narrow rows that open on tap, and previous and next on the item page', async ({ page }) => {
    await openPage(page, '/library', phone)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await expect(page.getByRole('columnheader')).toHaveCount(0)
    const firstRow = page.locator('[data-row-id]').first()
    expect((await firstRow.boundingBox())?.height).toBeGreaterThanOrEqual(56)
    // A regular 15 px title, then the small domain badge and a quiet status glyph.
    await expect(firstRow.locator('[data-row-link]')).toHaveCSS('font-weight', '400')
    await expect(firstRow.locator('[data-row-link]')).toHaveCSS('font-size', '15px')
    await expect(firstRow.locator('[data-slot="domain-badge"]')).toHaveAttribute('data-size', 'sm')
    // Healthy rows keep the accessible status name without repeating the word.
    await expect(firstRow.getByRole('img', { name: 'Accepted' })).toBeVisible()
    await rowLinks(page).first().click()
    await page.getByRole('link', { name: 'Open page' }).click()
    await expect(page.getByRole('button', { name: 'Next fact' })).toBeVisible()
    const next = await page.getByRole('button', { name: 'Next fact' }).boundingBox()
    expect(next?.height).toBe(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})

test.describe('geometry (contract 12.3, direction A)', () => {
  for (const size of widths) {
    test(`the table frame, the toolbar and the header share the left edge at ${size.name}px`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...size, theme: 'light' })
      await listReady(page)
      const main = await page
        .locator('[data-slot="sidebar-inset"]')
        .evaluate((element) => element.getBoundingClientRect().left)
      const gutter = size.width >= 768 ? 24 : 16
      // In the grid the checkbox cell is the frame's left edge, the kind icon sits centred in it
      // and the title cell starts 40 in; in the narrow row the icon is the edge.
      const edges = await page
        .locator('[data-row-id] [data-edge="start"]')
        .evaluateAll((elements) =>
          elements.slice(0, 10).map((element) => element.getBoundingClientRect().left),
        )
      expect(edges.length).toBeGreaterThan(0)
      for (const left of edges) expect(left - main).toBeCloseTo(gutter, 0)
      if (size.width >= 768) {
        const titleCells = await page
          .locator('[data-row-id] [data-row-link]')
          .evaluateAll((elements) =>
            elements
              .slice(0, 10)
              .map(
                (element) => element.closest('[role="cell"]')?.getBoundingClientRect().left ?? 0,
              ),
          )
        for (const left of titleCells) expect(left - main).toBeCloseTo(gutter + 40, 0)
        const kinds = await page
          .locator('[data-row-id] [data-slot="kind-icon"]')
          .evaluateAll((elements) =>
            elements.slice(0, 10).map((element) => {
              const box = element.getBoundingClientRect()
              return box.left + box.width / 2
            }),
          )
        for (const centre of kinds) expect(centre - main).toBeCloseTo(gutter + 20, 0)
      }
      // The action bar's first control, the View menu, starts at the gutter.
      const view = await page
        .getByRole('search', { name: 'Library' })
        .getByRole('button', { name: /^View:/ })
        .evaluate((element) => element.getBoundingClientRect().left)
      expect(view - main).toBeCloseTo(gutter, 0)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        size.width,
      )
    })
  }

  for (const size of widths.slice(0, 2)) {
    test(`at ${size.name} the status column is one 16 pixel glyph, its name in the tooltip`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...size, theme: 'light' })
      await listReady(page)
      const header = page.getByRole('columnheader', { name: 'Status' })
      expect((await header.boundingBox())?.width).toBe(128)
      const row = page.locator('[data-row-id]').first()
      const icon = row.locator('[data-slot="status-icon"]')
      await expect(icon).toHaveAttribute('role', 'img')
      const name = await icon.getAttribute('aria-label')
      expect(name).toBeTruthy()
      const glyph = await icon.locator('svg').boundingBox()
      expect([glyph?.width, glyph?.height]).toEqual([16, 16])
      // No words in the cell: the glyph is the whole status.
      expect(await icon.evaluate((element) => element.closest('[role="cell"]')?.textContent)).toBe(
        '',
      )
      await icon.hover()
      await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(name ?? 'missing')
    })
  }

  test('Title keeps at least 440 and the columns follow the width', async ({ page }) => {
    const expected: [number, string[]][] = [
      [1440, ['Title', 'Domain', 'Status', 'Ends', 'Owner']],
      [1280, ['Title', 'Domain', 'Status']],
      [1024, ['Title', 'Domain', 'Status']],
    ]
    for (const [width, columns] of expected) {
      await openPage(page, '/library', { width, height: 900, theme: 'light' })
      const headers = page.getByRole('columnheader')
      await expect(headers).toHaveText(['', ...columns, 'Actions'])
      const title = await headers.nth(1).boundingBox()
      expect(title?.width ?? 0).toBeGreaterThanOrEqual(440)
    }
  })

  test('rows are 40 high with a 36 header, data lines on both axes and a field icon per column', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    const header = page.locator('[role="row"][aria-rowindex="1"]')
    await expect(header).toHaveCSS('height', '36px')
    await expect(header).toHaveCSS('font-size', '12px')
    await expect(header).toHaveCSS('font-weight', '400')
    const row = page.locator('[data-row-id]').first()
    await expect(row).toHaveCSS('height', '40px')
    await expect(row).toHaveCSS('border-bottom-width', '1px')
    // The data line, one step lighter than the structure line of the header and toolbar.
    const colour = (selector: string, property: string) =>
      page
        .locator(selector)
        .first()
        .evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property)
    expect(await colour('[data-row-id]', 'border-bottom-color')).not.toBe(
      await colour('[data-layout="header"]', 'border-bottom-color'),
    )
    const lines = await row
      .locator('[role="cell"]')
      .evaluateAll((cells) =>
        cells.map((cell) => [
          getComputedStyle(cell).borderLeftWidth,
          cell.getBoundingClientRect().height,
        ]),
      )
    // The title follows the checkbox column without a line; every cell after it draws one on its
    // left, over the row's full height.
    expect(lines[1]?.[0]).toBe('0px')
    expect(lines.slice(2).every(([width, height]) => width === '1px' && height === 39)).toBe(true)
    const icons = await page
      .getByRole('columnheader')
      .evaluateAll((cells) => cells.map((cell) => cell.querySelectorAll('svg').length))
    // The checkbox, Title (its kinds sit in the checkbox column) and the actions column carry no
    // field icon; every other named column does.
    expect(icons[1]).toBe(0)
    expect(icons.slice(2, -1).every((count) => count >= 1)).toBe(true)
    await expect(row.locator('[data-row-link]')).toHaveCSS('font-weight', '400')
    await expect(row.locator('[data-row-link]')).toHaveCSS('font-size', '14px')
    await expect(row.locator('[data-slot="domain-badge"]')).toHaveCSS('height', '20px')
    await expect(row.locator('[data-slot="domain-badge"]')).toHaveCSS(
      'border-top-left-radius',
      '6px',
    )
  })

  test('the header checkbox selects every row and clears them again', async ({ page }) => {
    await openPage(page, '/library?kind=guide', desktop)
    const all = page.getByRole('checkbox', { name: 'Select every fact in the list' })
    await all.click()
    const bar = page.getByRole('region', { name: 'Selected rows' })
    await expect(bar).toBeVisible()
    const count = await page.locator('[data-slot="list-footer"]').textContent()
    const items = /([\d,]+)\s*facts?/.exec(count ?? '')?.[1]
    await expect(bar).toContainText(`${items} selected`)
    await page.getByRole('checkbox', { name: 'Clear the selection' }).click()
    await expect(bar).toBeHidden()
  })

  test('the add row sits under the rows, outside the table, and links to Add a fact', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const add = page.locator('[data-slot="add-row"]')
    await expect(add).toHaveCount(1)
    await expect(add).toHaveCSS('height', '40px')
    expect(await add.evaluate((el) => el.closest('[role="table"]'))).toBeNull()
    const link = add.getByRole('link', { name: 'Add a fact' })
    await expect(link).toHaveAttribute('href', '/library/new')
    await link.focus()
    await expect(link).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/library\/new$/)
  })

  test('the add row follows the density', async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem('cl.library.density', JSON.stringify('comfortable')),
    )
    await openPage(page, '/library', desktop)
    await expect(page.locator('[data-slot="add-row"]')).toHaveCSS('height', '48px')
  })

  test('the add row is one full-width link on the phone', async ({ page }) => {
    await openPage(page, '/library', phone)
    const add = page.getByRole('link', { name: 'Add a fact' })
    await expect(add).toBeVisible()
    const box = await add.boundingBox()
    expect(box?.width).toBeGreaterThanOrEqual(388)
    await add.focus()
    await expect(add).toBeFocused()
  })

  test('the footer totals follow the filter', async ({ page }) => {
    await openPage(page, '/library?view=attention', desktop)
    const footer = page.locator('[data-slot="list-footer"]')
    const text = (await footer.textContent()) ?? ''
    const items = /([\d,]+)\s*facts?/.exec(text)?.[1]
    const look = /([\d,]+)\s*needs? checking/.exec(text)?.[1]
    expect(items).toBeDefined()
    // The "Needs checking" view holds only facts that need checking.
    expect(look).toBe(items)
  })

  test('density: compact 40 by default with a 36 header, with scope 64 and the scope under the title', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await expect(page.locator('[data-row-id]').first()).toHaveCSS('height', '40px')
    await expect(page.locator('[role="row"][aria-rowindex="1"]')).toHaveCSS('height', '36px')
    await expect(
      page.locator('[data-row-id]').first().locator('[data-slot="domain-badge"]'),
    ).toHaveCSS('height', '20px')
    await page.getByRole('button', { name: 'Density and columns' }).click()
    await page.getByRole('button', { name: 'Where it applies' }).click()
    await page.keyboard.press('Escape')
    const row = page.locator('[data-row-id]').first()
    await expect(row).toHaveCSS('height', '64px')
    await expect(row.locator('[data-row-link] + span')).not.toBeEmpty()
  })

  test('cells in a row share one centre line', async ({ page }) => {
    await openPage(page, '/library', desktop)
    const offsets = await page
      .locator('[data-row-id]')
      .first()
      .locator('[role="cell"]')
      .evaluateAll((cells) => {
        const centre = (element: Element) => {
          const box = element.getBoundingClientRect()
          return box.top + box.height / 2
        }
        const first = centre(cells[1] ?? cells[0] ?? document.body)
        return cells.slice(1).map((cell) => Math.abs(centre(cell) - first))
      })
    for (const offset of offsets) expect(offset).toBeLessThanOrEqual(0.5)
  })
})

test.describe('shift-click selection', () => {
  const selected = (page: Page) => page.locator('[data-row-id][aria-selected="true"]')
  const checkbox = (page: Page, index: number) =>
    page.locator('[data-row-id]').nth(index).getByRole('checkbox')
  const count = (page: Page) => page.getByRole('region', { name: 'Selected rows' })

  for (const [name, first, last] of [
    ['forward', 0, 9],
    ['reverse', 9, 0],
  ] as const) {
    test(`${name} includes both endpoints and keeps the original anchor`, async ({ page }) => {
      await openPage(page, '/library', desktop)
      await listReady(page)
      await checkbox(page, first).click()
      await checkbox(page, last).click({ modifiers: ['Shift'] })
      await expect(selected(page)).toHaveCount(10)
      await expect(count(page)).toContainText('10 selected')
      await expect(checkbox(page, first)).toBeChecked()
      await expect(checkbox(page, last)).toBeChecked()
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('')
      // Repeating on an already selected endpoint must not toggle it off.
      await checkbox(page, last).click({ modifiers: ['Shift'] })
      await expect(selected(page)).toHaveCount(10)
      // Further extension preserves the previously selected range.
      await checkbox(page, 14).click({ modifiers: ['Shift'] })
      await expect(selected(page)).toHaveCount(15)
      await expect(count(page)).toContainText('15 selected')
      // Clearing via the bar preserves the anchor. This exposes any shift-click that moved it.
      await count(page).getByRole('button', { name: 'Clear' }).click()
      await checkbox(page, 4).click({ modifiers: ['Shift'] })
      await expect(selected(page)).toHaveCount(Math.abs(first - 4) + 1)
      await expect(checkbox(page, first)).toBeChecked()
    })
  }

  for (const modifier of ['Control', 'Meta'] as const) {
    test(`${modifier}-click keeps additive selection before shift-click`, async ({ page }) => {
      test.skip(
        modifier === 'Control' && process.platform === 'darwin',
        'Control-click opens the native macOS context menu',
      )
      await openPage(page, '/library', desktop)
      await listReady(page)
      await checkbox(page, 0).click()
      await checkbox(page, 4).click({ modifiers: [modifier] })
      await expect(selected(page)).toHaveCount(2)
      await checkbox(page, 9).click({ modifiers: ['Shift'] })
      await expect(selected(page)).toHaveCount(7)
      await expect(count(page)).toContainText('7 selected')
      await expect(checkbox(page, 0)).toBeChecked()
      await expect(checkbox(page, 3)).not.toBeChecked()
      await expect(checkbox(page, 9)).toBeChecked()
    })
  }

  test('shift-click extends keyboard selection', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    await page.keyboard.press('j')
    await page.keyboard.press('x')
    await checkbox(page, 9).click({ modifiers: ['Shift'] })
    await expect(selected(page)).toHaveCount(10)
    await expect(count(page)).toContainText('10 selected')
  })

  test('keeps the anchor when scrolling brings more rows into view', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    await checkbox(page, 0).click()
    await page.evaluate(() => window.scrollTo(0, 4000))
    const rows = page.locator('[data-row-id]')
    await expect
      .poll(async () => Number(await rows.first().getAttribute('aria-rowindex')))
      .toBeGreaterThan(50)
    const target = rows.nth(9)
    const id = await target.getAttribute('data-row-id')
    const position = Number(await target.getAttribute('aria-rowindex')) - 1
    const endpoint = page.locator(`[data-row-id="${id}"]`).getByRole('checkbox')
    await endpoint.click({ modifiers: ['Shift'] })
    await expect(endpoint).toBeChecked()
    await expect(count(page)).toContainText(`${position} selected`)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page.locator('[data-row-id][aria-rowindex="2"]')).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  for (const query of ['kind=guide', 'sort=title&dir=asc', 'group=kind']) {
    test(`uses displayed order with ${query}`, async ({ page }) => {
      await openPage(page, `/library?${query}`, desktop)
      await listReady(page)
      await checkbox(page, 0).click()
      await checkbox(page, 9).click({ modifiers: ['Shift'] })
      await expect(selected(page)).toHaveCount(10)
      await expect(count(page)).toContainText('10 selected')
      await expect(checkbox(page, 9)).toBeChecked()
    })
  }
})
