import { expect, test, type Page } from '@playwright/test'
import { COMPARE_RANGE, contentLeft, openPage, widths } from './support'

/*
  What changed between two editions (Editions design, slice S2) on the mock: the way in from the
  Editions page, the overall result in groups, Filter, the Viewed boxes and the keys (j, k, v,
  Escape), the docked panel field by field, swapping the editions, the ranges, edition by
  edition, the pickers, a long range in the windowed list, the states (loading, failed, nothing
  different, an unknown edition) and the phone. Ravi Kapoor is the administrator.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

/** The mock's live edition once the demo proposals are in, and the one before it. */
const LIVE = '2026-10-07.2'
const BEFORE_LIVE = '2026-10-07.1'
const REGRESSION = 'Net revenue excludes test accounts'

async function asAdministrator(page: Page, scenario?: string) {
  await page.addInitScript(
    ({ scenario }) => {
      window.localStorage.setItem('cl.mock-person', 'per_ravi')
      if (scenario) window.localStorage.setItem('cl.mock-scenario', scenario)
    },
    { scenario },
  )
}

const list = (page: Page) => page.locator('[data-slot="compare-list"]')
const rows = (page: Page) => list(page).locator('[role="row"][data-row-id]')
const summary = (page: Page) => page.locator('[data-slot="compare-summary"]')
const panel = (page: Page) => page.locator('[data-slot="dock-panel"]')

test.describe('what changed between editions', () => {
  test('opens from the Editions page on the latest edition, with both numbers in the address', async ({
    page,
  }) => {
    await asAdministrator(page)
    await openPage(page, '/editions', desktop)
    await page
      .locator('[data-slot="live-edition"]')
      .getByRole('link', { name: 'What changed', exact: true })
      .click()
    await expect(page).toHaveURL(new RegExp(`since=${BEFORE_LIVE}&until=${LIVE}`))
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('What changed')
    await expect(page.getByRole('button', { name: 'Latest edition', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(page.getByRole('combobox', { name: 'Since edition' })).toHaveValue(BEFORE_LIVE)
    await expect(page.getByRole('combobox', { name: 'Until edition' })).toHaveValue(LIVE)
    await expect(summary(page)).toContainText('Across 1 edition.')
  })

  test('groups the changes, real ones first, with the noise closed', async ({ page }) => {
    await asAdministrator(page)
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    await expect(summary(page)).toContainText('10 facts in')
    await expect(summary(page)).toContainText('Across 10 editions.')
    const groups = list(page).locator('[data-group]')
    await expect(groups).toHaveCount(3)
    await expect(groups.nth(0)).toHaveAttribute('data-group', 'changed')
    await expect(groups.nth(1)).toHaveAttribute('data-group', 'added')
    const resaved = list(page).getByRole('button', {
      name: /^Saved again, nothing different, 1 fact/,
    })
    await expect(resaved).toHaveAttribute('aria-expanded', 'false')
    await expect(rows(page)).toHaveCount(9)
    await expect(rows(page).first()).toContainText(REGRESSION)
    // Rows are 40 pixels, as on every grid.
    expect((await rows(page).first().boundingBox())?.height).toBe(40)
    await resaved.click()
    await expect(rows(page)).toHaveCount(10)
    await list(page)
      .getByRole('button', { name: /^Added, 8 facts/ })
      .click()
    await expect(rows(page)).toHaveCount(2)
    await expect(page.getByText('10 facts', { exact: true })).toBeAttached()
  })

  test('opens an item in the docked panel field by field, and the keys step, mark and close', async ({
    page,
  }) => {
    await asAdministrator(page)
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    await rows(page).first().getByRole('link', { name: REGRESSION }).click()
    await expect(page).toHaveURL(/item=itm_q2upr28v/)
    await expect(panel(page)).toHaveAttribute('data-mode', 'docked')
    await expect(panel(page).getByRole('heading', { name: REGRESSION })).toBeVisible()
    await expect(panel(page)).toContainText(/Changed\s*· 1 of 9/)
    const card = panel(page).getByRole('article', { name: `What changed in ${REGRESSION}` })
    await expect(card).toContainText('When it applies')
    await expect(card).toContainText('Accepted by')
    await panel(page)
      .getByRole('tab', { name: /Edition by edition/ })
      .click()
    await expect(
      panel(page).getByRole('list', { name: 'Editions that changed this fact' }),
    ).toContainText('2026-10-01')

    // v marks the open item viewed; j opens the next; Escape closes, back to the row.
    await page.keyboard.press('v')
    await expect(rows(page).first()).toHaveAttribute('data-viewed', 'true')
    await expect(page.getByText(/^1 of 10 viewed$/)).toBeVisible()
    await page.keyboard.press('j')
    await expect(panel(page)).toContainText(/Added\s*· 2 of 9/)
    await expect(rows(page).nth(1)).toHaveAttribute('data-open', 'true')
    await page.keyboard.press('k')
    await expect(panel(page)).toContainText(/Changed\s*· 1 of 9/)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page).not.toHaveURL(/item=/)
    await expect(rows(page).first().getByRole('link')).toBeFocused()

    // The mark stays in this browser: the same change reads as viewed after a reload.
    await page.reload()
    await expect(rows(page).first()).toHaveAttribute('data-viewed', 'true')
    await rows(page).first().getByRole('checkbox').click()
    await expect(rows(page).first()).not.toHaveAttribute('data-viewed')
  })

  test('filters by change, domain, kind and risk, with a chip that clears it', async ({ page }) => {
    await asAdministrator(page)
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    await page.getByRole('button', { name: 'Filter' }).click()
    await page.getByRole('tab', { name: 'Change' }).click()
    await page.getByRole('checkbox', { name: 'Added' }).click()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/change=added/)
    await expect(list(page).locator('[data-group]')).toHaveCount(1)
    await expect(rows(page)).toHaveCount(8)
    await expect(page.getByText('8 of 10 facts')).toBeAttached()
    await page.getByRole('button', { name: 'Remove filter Change: Added' }).click()
    await expect(page).not.toHaveURL(/change=/)
    await expect(rows(page)).toHaveCount(9)
  })

  test('swaps Since and Until to read what going back would change', async ({ page }) => {
    await asAdministrator(page)
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    await page.getByRole('button', { name: 'Swap Since and Until' }).click()
    await expect(page).toHaveURL(/since=2026-10-07\.1&until=2026-09-10\.2/)
    await expect(summary(page)).toContainText('what going back from 2026-10-07.1 to 2026-09-10.2')
    await expect(list(page).locator('[data-group]').first()).toHaveAttribute(
      'data-group',
      'changed',
    )
  })

  test('reads edition by edition, and opens one edition’s change of an item', async ({ page }) => {
    await asAdministrator(page)
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    await page.getByRole('link', { name: 'Edition by edition' }).click()
    await expect(page).toHaveURL(/view=steps/)
    const editions = page.getByRole('list', { name: 'Editions in this range, newest first' })
    // The ten editions after Since, Until included, newest first.
    await expect(editions.locator(':scope > li')).toHaveCount(10)
    await expect(editions.locator(':scope > li').first()).toContainText('2026-10-07.1')
    const step = page.locator('[data-row-id^="2026-10-01.1|"]')
    await step.getByRole('link').click()
    await expect(page).toHaveURL(/step=2026-10-01\.1/)
    await expect(panel(page).getByRole('heading', { name: REGRESSION })).toBeVisible()
    await expect(panel(page)).toContainText('Version 1 to 2')
    await page.getByRole('link', { name: 'Overall result' }).click()
    await expect(page).not.toHaveURL(/view=|step=|item=/)
  })

  test('picks an edition by its number, reading older pages for an older day', async ({ page }) => {
    await asAdministrator(page)
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    const since = page.getByRole('combobox', { name: 'Since edition' })
    await since.click()
    await since.fill('2026-08-2')
    await page.getByRole('option', { name: /^2026-08-25\.1/ }).click()
    await expect(page).toHaveURL(/since=2026-08-25\.1&until=2026-10-07\.1/)
    await expect(since).toHaveValue('2026-08-25.1')
    await expect(summary(page)).toContainText('Across 23 editions.')
  })

  test('keeps a long range one windowed list', async ({ page }) => {
    await asAdministrator(page)
    await openPage(page, '/editions/compare?since=2024-01-01.1&until=2026-10-07.1', desktop)
    await expect(summary(page)).toContainText('Across 60 editions.')
    await expect(summary(page)).toContainText('that only some groups see')
    await expect(rows(page).first()).toBeVisible()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(list(page).getByRole('button', { name: /^Archived, 5 facts/ })).toBeVisible()
    await expect(list(page).locator('[data-pending]')).toHaveCount(0)
  })

  test('shows the summary and the rows as skeletons while they load', async ({ page }) => {
    await asAdministrator(page, 'slow')
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    await expect(page.getByRole('status', { name: 'Loading what changed' })).toBeVisible()
    await expect(page.getByRole('status', { name: 'Loading the summary' })).toBeVisible()
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 })
  })

  test('says what failed and offers Try again when the read fails', async ({ page }) => {
    await asAdministrator(page, 'error')
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    // The read is tried once more before the page gives up.
    const alert = page.getByRole('alert')
    await expect(alert).toContainText("We couldn't load what changed", { timeout: 15_000 })
    await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('says when nothing differs, and when an edition does not exist', async ({ page }) => {
    await asAdministrator(page)
    await openPage(page, '/editions/compare?since=2026-10-07.1&until=2026-10-07.1', desktop)
    await expect(page.getByText('These are the same edition')).toBeVisible()
    await expect(summary(page)).toHaveCount(0)
    await page.getByRole('button', { name: "See the latest edition's changes" }).click()
    await expect(page).toHaveURL(new RegExp(`since=${BEFORE_LIVE}&until=${LIVE}`))
    // The demo week's accepted note changes no item of the library; this is the latest edition
    // already, so the page does not offer it again.
    await expect(page.getByText('No fact changed between these editions')).toBeVisible()
    await expect(
      page.getByRole('button', { name: "See the latest edition's changes" }),
    ).toHaveCount(0)

    await page.goto('/editions/compare?since=2020-01-01.9&until=2026-10-07.1')
    await expect(page.getByText("One of these editions doesn't exist")).toBeVisible()
  })

  test('fits a phone: narrow rows, the ranges and views as menus, the panel full screen', async ({
    page,
  }) => {
    await asAdministrator(page)
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, phone)
    await expect(rows(page).first()).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await expect(page.getByRole('button', { name: 'View: Overall result' })).toBeVisible()
    await page.getByRole('button', { name: /^Range: / }).click()
    await page.getByRole('menuitemradio', { name: 'Latest edition' }).click()
    await expect(page).toHaveURL(new RegExp(`since=${BEFORE_LIVE}&until=${LIVE}`))
    await expect(page.getByRole('button', { name: 'Range: Latest edition' })).toBeVisible()
    await page.goBack()
    await rows(page).first().getByRole('link').click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'full')
    await page.getByRole('button', { name: 'Close' }).click()
    await expect(panel(page)).toHaveCount(0)
  })

  test('is for administrators: a contributor is told whose page it is', async ({ page }) => {
    await openPage(page, `/editions/compare?${COMPARE_RANGE}`, desktop)
    await expect(page.getByText('Editions are for owners and admins')).toBeVisible()
  })

  for (const size of widths)
    test(`lines the header, both bars and the rows up on the gutter at ${size.name}px`, async ({
      page,
    }) => {
      await asAdministrator(page)
      await openPage(page, `/editions/compare?${COMPARE_RANGE}`, { ...size, theme: 'light' })
      await expect(rows(page).first()).toBeVisible()
      const main = await page
        .locator('[data-slot="sidebar-inset"]')
        .evaluate((element) => element.getBoundingClientRect().left)
      const gutter = size.width >= 768 ? 24 : 16
      const header = await contentLeft(page, '[data-layout="header"]')
      expect(header - main).toBe(gutter)
      for (const toolbar of await page.locator('[data-layout="toolbar"]').all()) {
        const box = await toolbar.evaluate(
          (element) =>
            element.getBoundingClientRect().left +
            Number.parseFloat(getComputedStyle(element).paddingLeft),
        )
        expect(box).toBe(header)
      }
      expect(await contentLeft(page, '[data-slot="compare-summary"]')).toBe(header)
      expect(await contentLeft(page, '[data-layout="content"]')).toBe(header)
    })
})
