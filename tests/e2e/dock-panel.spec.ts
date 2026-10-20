import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, widths } from './support'

/*
  The docked panel on the library (design round 3, direction A): a row opens its item beside the
  list, in the address as `?panel=`, so it is linkable and Back closes it. From 1,224 wide it
  docks and the sidebar folds to its rail; below that it lies over the grid; on a phone it fills
  the screen. j and k step it through the rows, Escape closes it and focus returns to the row.
  Fixture ids: see src/web/mocks (the same generator every test uses).
*/

const desktop = { ...widths[0], theme: 'light' as const }
const tablet = { ...widths[1], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

/** A high-risk note in Sales whose source is missing; Jon Abara is its owner. */
const SOURCE_MISSING = 'itm_gjdvl50x'

const panel = (page: Page) => page.locator('[data-slot="dock-panel"]')
const rowIds = (page: Page, count: number) =>
  page
    .locator('[data-row-id]')
    .evaluateAll((rows, n) => rows.slice(0, n).map((row) => row.getAttribute('data-row-id')), count)
const focusedRowId = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-row-id]')?.getAttribute('data-row-id'))
const rect = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const box = element.getBoundingClientRect()
      return { left: box.left, right: box.right, width: box.width }
    })

async function listReady(page: Page) {
  await expect(page.locator('[data-row-id]').nth(3)).toBeVisible({ timeout: 15_000 })
}

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

test.describe('opening and closing', () => {
  test('a row opens its item docked beside the list, and the sidebar folds to its rail', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    expect((await rect(page, '[data-slot="sidebar-gap"]')).width).toBe(256)
    const [, second] = await rowIds(page, 2)
    const title = await page.locator(`[data-row-id="${second}"] [data-row-link]`).innerText()
    await page.locator(`[data-row-id="${second}"] [data-row-link]`).click()

    await expect(page).toHaveURL(new RegExp(`/library\\?panel=${second}$`))
    await expect(panel(page)).toHaveAttribute('data-mode', 'docked')
    await expect(page.getByRole('region', { name: title })).toBeVisible()
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(title)
    // The bar names the kind and the place in the list, never the raw id (the professional pass).
    await expect(panel(page).locator('[data-slot="dock-meta"]')).toHaveText(
      /^(Note|Event|Guide|Example|Issue) ?· 2 of 1,404$/,
    )
    await expect(panel(page).locator('[data-slot="dock-meta"]')).not.toContainText(`${second}`)

    // Docked: flush to the right edge, 480 wide, the page keeps that width free beside it.
    const box = await rect(page, '[data-slot="dock-panel"]')
    expect(box).toEqual({ left: 960, right: 1440, width: 480 })
    // The sidebar folds with its usual width transition.
    await expect.poll(async () => (await rect(page, '[data-slot="sidebar-gap"]')).width).toBe(48)
    expect((await rect(page, '[data-slot="sidebar-inset"]')).right).toBe(1440)
    expect((await rect(page, '[data-slot="page"]')).right).toBe(960)
    // The grid stays a grid beside it, the open row marked, and nothing scrolls sideways.
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible()
    await expect(page.locator(`[data-row-id="${second}"]`)).toHaveAttribute('data-open', 'true')
    await expect(page.locator(`[data-row-id="${second}"] [data-row-link]`)).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)

    // Closing gives the sidebar back.
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/library$/)
    await expect.poll(async () => (await rect(page, '[data-slot="sidebar-gap"]')).width).toBe(256)
  })

  test('the checkbox selects the row and does not open it', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const [first] = await rowIds(page, 1)
    await page.locator(`[data-row-id="${first}"]`).getByRole('checkbox').click()
    await expect(page.getByRole('region', { name: 'Selected rows' })).toContainText('1 selected')
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/library$/)
  })

  test('Escape closes the panel and focus returns to its row', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const [, second] = await rowIds(page, 2)
    await page.keyboard.press('j')
    await page.keyboard.press('j')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(new RegExp(`panel=${second}`))
    await expect(panel(page)).toBeVisible()

    // Escape from inside the panel too: focus a tab first.
    await panel(page).getByRole('tab', { name: 'Source' }).focus()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/library$/)
    await expect.poll(() => focusedRowId(page)).toBe(second)
  })

  test('Back closes the panel, Forward opens it again', async ({ page }) => {
    await openPage(page, '/library?view=attention', desktop)
    await listReady(page)
    const [first, second] = await rowIds(page, 2)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await expect(page).toHaveURL(new RegExp(`view=attention&panel=${first}`))
    // A second row replaces the first: Back returns to the list, not through every item read.
    await page.locator(`[data-row-id="${second}"] [data-row-link]`).click()
    await expect(page).toHaveURL(new RegExp(`panel=${second}`))
    await page.goBack()
    await expect(page).toHaveURL(/\/library\?view=attention$/)
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(() => focusedRowId(page)).toBe(second)
    await page.goForward()
    await expect(panel(page)).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`panel=${second}`))
  })

  test('Escape after opening goes Back, so the history has no closed panel in it', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const [first] = await rowIds(page, 1)
    const entries = await page.evaluate(() => window.history.length)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await expect(panel(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/library$/)
    await page.goForward()
    // Forward is the panel the person closed, not a second copy of the list.
    await expect(page).toHaveURL(new RegExp(`panel=${first}`))
    expect(await page.evaluate(() => window.history.length)).toBe(entries + 1)
  })

  test('opening a row keeps the scroll position of the list', async ({ page }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    await page.evaluate(() => window.scrollTo(0, 2000))
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(2000)
    const middle = () =>
      page.evaluate(() =>
        document
          .elementFromPoint(300, window.innerHeight / 2)
          ?.closest('[data-row-id]')
          ?.getAttribute('data-row-id'),
      )
    await expect.poll(middle).toBeTruthy()
    const id = await middle()
    await page.locator(`[data-row-id="${id}"] [data-row-link]`).click()
    await expect(panel(page)).toBeVisible()
    expect(await page.evaluate(() => window.scrollY)).toBe(2000)
  })
})

test.describe('deep links and tabs', () => {
  test('a link opens the panel on its item and tab, with the row in view and marked', async ({
    page,
  }) => {
    await openPage(page, `/library?panel=${SOURCE_MISSING}&tab=source`, desktop)
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).getByRole('tab', { name: 'Source' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(panel(page).getByRole('region', { name: 'Who stands behind it' })).toBeVisible()
    await expect(page.locator(`[data-row-id="${SOURCE_MISSING}"]`)).toHaveAttribute(
      'data-open',
      'true',
    )
    await expect.poll(() => focusedRowId(page)).toBe(SOURCE_MISSING)
    await expect(page.locator(`[data-row-id="${SOURCE_MISSING}"]`)).toBeInViewport()
  })

  test('the tabs keep their place in the address, and the next item keeps the tab', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const [first, second] = await rowIds(page, 2)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await panel(page)
      .getByRole('tab', { name: /History/ })
      .click()
    await expect(page).toHaveURL(new RegExp(`panel=${first}&tab=history$`))
    await expect(panel(page).getByRole('region', { name: 'History' })).toBeVisible()
    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`panel=${second}&tab=history$`))
    await panel(page).getByRole('tab', { name: 'Read' }).click()
    await expect(page).toHaveURL(new RegExp(`panel=${second}$`))
  })

  test('the panel shows the item page parts: badges, note, the flat Source details', async ({
    page,
  }) => {
    await openPage(page, `/library?panel=${SOURCE_MISSING}&tab=source`, desktop)
    const badges = panel(page).locator('[data-slot="item-badges"]')
    // The kind is named in the bar, with its glyph, so the badges start at the domain.
    await expect(badges.locator('[data-slot="kind-badge"]')).toHaveCount(0)
    await expect(
      panel(page).locator('[data-slot="dock-meta"] [data-slot="kind-icon"]'),
    ).toBeVisible()
    await expect(badges.locator('[data-slot="status-badge"]').first()).toBeVisible()
    await expect(panel(page).locator('[data-slot="state-note"]')).toBeVisible()
    // The page rail's panel placement: no frame, and the property table is a flat list in it.
    const rail = panel(page).locator('[data-slot="page-rail"]')
    await expect(rail).toHaveAttribute('data-placement', 'panel')
    const frame = await rail.evaluate((element) => {
      const style = getComputedStyle(element)
      return [style.borderLeftWidth, style.borderTopWidth, style.paddingLeft]
    })
    expect(frame).toEqual(['0px', '0px', '0px'])
    await expect(rail.locator('[data-slot="field-table"]')).toHaveAttribute('data-flat', '')
  })

  test('an item that is not in the library says so, and the list stays', async ({ page }) => {
    await openPage(page, '/library?panel=itm_nothere1', desktop)
    await expect(panel(page).getByText("This fact isn't in the library")).toBeVisible()
    await panel(page).getByRole('button', { name: 'Close' }).first().click()
    await expect(page).toHaveURL(/\/library$/)
    await expect(page.locator('[data-row-id]').first()).toBeVisible()
  })

  test('expand opens the item page with the list, and its Escape returns to the panel', async ({
    page,
  }) => {
    await openPage(page, '/library?view=attention', desktop)
    await listReady(page)
    const [first] = await rowIds(page, 1)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await panel(page).getByRole('tab', { name: 'Source' }).click()
    await panel(page).getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(new RegExp(`/library/${first}\\?view=attention&tab=source$`))
    await expect(
      page.getByRole('navigation', { name: 'breadcrumb' }).getByText(/ · 1 of /),
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(new RegExp(`/library\\?view=attention&panel=${first}&tab=source$`))
    await expect(panel(page)).toBeVisible()
  })
})

test.describe('keyboard', () => {
  test('j and k step the panel through the rows; Previous and Next do the same', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await listReady(page)
    const [first, second, third] = await rowIds(page, 3)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await expect(panel(page).getByRole('button', { name: 'Previous' })).toBeDisabled()
    await page.keyboard.press('j')
    await expect(page).toHaveURL(new RegExp(`panel=${second}$`))
    await expect.poll(() => focusedRowId(page)).toBe(second)
    await expect(panel(page).locator('[data-slot="dock-meta"]')).toContainText('2 of')
    await panel(page).getByRole('button', { name: 'Next' }).click()
    await expect(page).toHaveURL(new RegExp(`panel=${third}$`))
    await page.keyboard.press('k')
    await expect(page).toHaveURL(new RegExp(`panel=${second}$`))
    await panel(page).getByRole('button', { name: 'Previous' }).click()
    await expect(page).toHaveURL(new RegExp(`panel=${first}$`))
  })

  test('inside the panel the arrow keys scroll it and leave the list alone', async ({ page }) => {
    await openPage(page, `/library?panel=${SOURCE_MISSING}&tab=source`, desktop)
    await expect(panel(page)).toBeVisible()
    // The link puts focus on the item's row first; then the person moves into the panel.
    await expect.poll(() => focusedRowId(page)).toBe(SOURCE_MISSING)
    await panel(page).getByRole('tab', { name: 'Source' }).focus()
    await page.keyboard.press('ArrowDown')
    await expect(page).toHaveURL(new RegExp(`panel=${SOURCE_MISSING}`))
    expect(await focusedRowId(page)).toBeFalsy()
  })

  test('a dialog opened from the footer keeps Escape to itself', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, `/library?panel=${SOURCE_MISSING}`, desktop)
    const footer = panel(page).locator('[data-slot="dock-footer"]')
    await footer.getByRole('button', { name: 'Mark as checked' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Checked, still correct?' })
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(panel(page)).toBeVisible()
  })
})

test.describe('actions in the footer', () => {
  test('Suggest a change and More, as on the item page', async ({ page }) => {
    await openPage(page, `/library?panel=${SOURCE_MISSING}`, desktop)
    const footer = panel(page).locator('[data-slot="dock-footer"]')
    await expect(footer.getByRole('button', { name: 'Mark as checked' })).toHaveCount(0)
    await footer.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: /Suggest archiving/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeVisible()
    await footer.getByRole('link', { name: 'Suggest a change' }).click()
    await expect(page).toHaveURL(new RegExp(`/library/${SOURCE_MISSING}/suggest$`))
  })

  test('the owner sees Mark as checked first, and Archive fact in More', async ({ page }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, `/library?panel=${SOURCE_MISSING}`, desktop)
    const footer = panel(page).locator('[data-slot="dock-footer"]')
    await expect(footer.getByRole('button').first()).toHaveAccessibleName('Mark as checked')
    await footer.getByRole('button', { name: 'More actions' }).click()
    await expect(page.getByRole('menuitem', { name: /^Archive fact/ })).toBeVisible()
  })
})

test.describe('an upkeep run', () => {
  test('Y opens the check, Command Enter records it and opens the next item, with the reason kept', async ({
    page,
  }) => {
    await signInAs(page, 'per_jon')
    await openPage(page, '/library?view=attention', desktop)
    await listReady(page)
    const [, , third, fourth] = await rowIds(page, 4)
    await page.locator(`[data-row-id="${third}"] [data-row-link]`).click()
    await expect(page).toHaveURL(new RegExp(`panel=${third}$`))
    const footer = panel(page).locator('[data-slot="dock-footer"]')
    await expect(footer.getByRole('button', { name: 'Mark as checked' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Y',
    )

    await page.keyboard.press('y')
    const dialog = page.getByRole('alertdialog', { name: 'Checked, still correct?' })
    const reason = dialog.getByRole('textbox', { name: 'What you checked' })
    // The key only opens the dialog: nothing is recorded without a reason (contract 9.4).
    await expect(reason).toBeFocused()
    await expect(reason).toHaveValue('')
    await reason.fill('Compared it with the source.')
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`panel=${fourth}$`))

    await page.keyboard.press('y')
    await expect(reason).toHaveValue('Compared it with the source.')
    await expect(dialog.getByText('From your last check.')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page).toHaveURL(new RegExp(`panel=${fourth}$`))
  })
})

test.describe('narrow widths', () => {
  test('at 1,024 the panel lies over the grid, which keeps its width and the rail', async ({
    page,
  }) => {
    await openPage(page, '/library', tablet)
    await listReady(page)
    const before = await rect(page, '[data-slot="page"]')
    const [first] = await rowIds(page, 1)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'overlay')
    expect(await rect(page, '[data-slot="dock-panel"]')).toEqual({
      left: 544,
      right: 1024,
      width: 480,
    })
    expect(await rect(page, '[data-slot="page"]')).toEqual(before)
    expect((await rect(page, '[data-slot="sidebar-gap"]')).width).toBe(48)
    // It starts under the shell header, so Search and Add a fact stay in reach.
    const top = await panel(page).evaluate((element) => element.getBoundingClientRect().top)
    expect(top).toBe(48)
    await expect(page.getByRole('banner').getByRole('button', { name: 'Add a fact' })).toBeVisible()
    await page
      .getByRole('banner')
      .getByRole('button', { name: 'Add a fact' })
      .click({ trial: true })
    const shadow = await panel(page).evaluate((element) => getComputedStyle(element).boxShadow)
    expect(shadow).not.toBe('none')
    // A row left of the panel still opens.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024)
  })

  test('at 1,280 it docks, and a table with checkboxes stays beside it', async ({ page }) => {
    await openPage(page, '/library', { width: 1280, height: 800, theme: 'light' })
    await listReady(page)
    const [first] = await rowIds(page, 1)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'docked')
    await expect(page.getByRole('columnheader', { name: 'Title' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Status' })).toBeVisible()
    await expect(page.locator(`[data-row-id="${first}"]`).getByRole('checkbox')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1280)
  })

  test('on a phone the panel fills the screen; the back arrow returns to the row', async ({
    page,
  }) => {
    await openPage(page, '/library', phone)
    await listReady(page)
    const [first, second] = await rowIds(page, 2)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'full')
    expect(await rect(page, '[data-slot="dock-panel"]')).toEqual({
      left: 0,
      right: 390,
      width: 390,
    })
    // Focus moves into the panel; the list under it is out of reach.
    await expect
      .poll(() => panel(page).evaluate((element) => element.contains(document.activeElement)))
      .toBe(true)
    await expect(
      page.locator('[data-row-id]').first().locator('xpath=ancestor::*[@inert]'),
    ).toHaveCount(1)
    const next = panel(page).getByRole('button', { name: 'Next' })
    expect((await next.boundingBox())?.height).toBe(44)
    await next.click()
    await expect(page).toHaveURL(new RegExp(`panel=${second}`))
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(() => focusedRowId(page)).toBe(second)
  })

  test('on a phone Back closes the full-screen panel', async ({ page }) => {
    await openPage(page, '/library', phone)
    await listReady(page)
    const [first] = await rowIds(page, 1)
    await page.locator(`[data-row-id="${first}"] [data-row-link]`).click()
    await expect(panel(page)).toBeVisible()
    await settle(page)
    await page.goBack()
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/library$/)
  })
})
