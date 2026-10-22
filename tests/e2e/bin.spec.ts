import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, widths } from './support'

/*
  The Bin: an administrator moves items out of the library (several at once from the selection
  bar, one from a row's menu or the item's actions) with one reason, can take it back with Undo,
  and restores from the Bin page. Everyone else gets none of it. The Bin is no sidebar place: an
  administrator opens it as Deleted facts from the library's View menu, or the palette. The mock
  runs the same rules as the service (tests/conformance).
*/

const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }
const ADMIN = 'per_ravi'

async function as(page: Page, person: string | null, scenario?: string) {
  await page.addInitScript(
    ({ person, scenario }) => {
      if (person) window.localStorage.setItem('cl.mock-person', person)
      else window.localStorage.removeItem('cl.mock-person')
      if (scenario) window.localStorage.setItem('cl.mock-scenario', scenario)
      else window.localStorage.removeItem('cl.mock-scenario')
    },
    { person, scenario },
  )
}

async function listReady(page: Page) {
  await expect(page.locator('[data-row-id]').nth(3)).toBeVisible({ timeout: 15_000 })
}

const itemCount = (page: Page) => page.locator('#library-count')
const rowCheckbox = (page: Page, index: number) =>
  page.locator('[data-row-id]').nth(index).getByRole('checkbox')

/** Deleted facts, the way to the Bin: the library's View menu, from the library or any page. */
async function openDeletedItems(page: Page) {
  if (!new URL(page.url()).pathname.startsWith('/library'))
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Library' })
      .click()
  await page.getByRole('button', { name: /^View: / }).click()
  await page.getByRole('menuitem', { name: 'Deleted facts' }).click()
  await expect(page).toHaveURL(/\/library\/bin$/)
}

async function confirmMove(page: Page, reason: string) {
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('textbox').fill(reason)
  await dialog.getByRole('button', { name: 'Move to Bin' }).click()
  await expect(dialog).toBeHidden()
}

test('an administrator moves a range of rows to the Bin in one step and takes it back with Undo', async ({
  page,
}) => {
  await as(page, ADMIN)
  await openPage(page, '/library', desktop)
  await listReady(page)
  const before = await itemCount(page).textContent()
  const ids = await page
    .locator('[data-row-id]')
    .evaluateAll((rows) => rows.slice(0, 3).map((row) => row.getAttribute('data-row-id')))
  // One click, then Shift and a click: the three rows between are selected.
  await rowCheckbox(page, 0).click()
  await rowCheckbox(page, 2).click({ modifiers: ['Shift'] })
  const bar = page.getByRole('region', { name: 'Selected rows' })
  await expect(bar.getByText('3 selected')).toBeVisible()
  await bar.getByRole('button', { name: 'Move to Bin' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Move 3 facts to the Bin?' })).toBeVisible()
  await settle(page)
  await confirmMove(page, 'Duplicates of the pilot import')

  const toast = page.locator('[data-slot="toast"]')
  await expect(toast).toContainText('3 facts moved to the Bin')
  await expect(toast).toContainText('Agents no longer get them.')
  for (const id of ids) await expect(page.locator(`[data-row-id="${id}"]`)).toHaveCount(0)
  await expect(bar).toBeHidden()
  await expect(itemCount(page)).not.toHaveText(before!)

  await toast.getByRole('button', { name: 'Undo' }).click()
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: '3 facts restored' }),
  ).toBeVisible()
  // Undo is done once: its toast goes with it.
  await expect(
    page.locator('[data-slot="toast"]').filter({ hasText: 'moved to the Bin' }),
  ).toHaveCount(0)
  for (const id of ids) await expect(page.locator(`[data-row-id="${id}"]`)).toHaveCount(1)
  await expect(itemCount(page)).toHaveText(before!)
})

test('select all in a filtered view moves only what the view shows', async ({ page }) => {
  await as(page, ADMIN)
  await openPage(page, '/library?kind=guide&area=area_sales', desktop)
  await expect(page.locator('[data-row-id]').first()).toBeVisible({ timeout: 15_000 })
  // The rows are virtualized: the toolbar's count says how many the view holds ("31 of 1,404").
  const shown = Number((await itemCount(page).textContent())!.match(/^[\d,]+/)![0].replace(',', ''))
  await page.getByRole('checkbox', { name: 'Select every fact in the list' }).click()
  const bar = page.getByRole('region', { name: 'Selected rows' })
  await expect(bar.getByText(`${shown} selected`)).toBeVisible()
  await bar.getByRole('button', { name: 'Move to Bin' }).click()
  const dialog = page.getByRole('alertdialog', { name: `Move ${shown} facts to the Bin?` })
  await expect(dialog).toBeVisible()
  // The first few titles, and a count of the rest.
  await expect(dialog.locator('[data-slot="bin-subjects"] li')).toHaveCount(6)
  await expect(dialog.getByText(`and ${shown - 5} more`)).toBeVisible()
})

test('a row menu moves one item; the Bin page shows who, when and why, and restores it', async ({
  page,
}) => {
  await as(page, ADMIN)
  await openPage(page, '/library', desktop)
  await listReady(page)
  const row = page.locator('[data-row-id]').first()
  const id = await row.getAttribute('data-row-id')
  const title = await row.locator('[data-row-link]').textContent()
  await row.hover()
  await row.getByRole('button', { name: /^Actions for / }).click()
  await page.getByRole('menuitem', { name: 'Move to Bin' }).click()
  await expect(page.getByRole('alertdialog', { name: 'Move this fact to the Bin?' })).toBeVisible()
  await confirmMove(page, 'Wrong domain, written again in Finance')
  await expect(page.locator(`[data-row-id="${id}"]`)).toHaveCount(0)

  // The Bin is not in the sidebar: Deleted facts in the library's View menu opens it.
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Bin' }),
  ).toHaveCount(0)
  await openDeletedItems(page)
  // The library is picked out there, as the page belongs to it.
  await expect(
    page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Library' }),
  ).toHaveAttribute('aria-current', 'page')
  const binned = page.locator(`[data-row-id="${id}"]`)
  await expect(binned).toContainText(title!.trim())
  await expect(binned).toContainText('Ravi Kapoor')
  await expect(binned).toContainText('Wrong domain, written again in Finance')
  await expect(page.locator('[data-slot="bin-count"]')).toHaveText('1 fact in the Bin')

  await binned.getByRole('button', { name: /^Restore / }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Restore this fact?' })
  await dialog.getByRole('button', { name: 'Restore' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('The Bin is empty')).toBeVisible()
  await page.getByRole('link', { name: 'Open the library' }).click()
  await listReady(page)
  await expect(page.locator(`[data-row-id="${id}"]`)).toHaveCount(1)
})

test('the dialog warns first when an item has an open proposal', async ({ page }) => {
  await as(page, ADMIN)
  // Alex's change to this definition note is under review (the demo's proposals).
  await openPage(page, '/library/itm_8mmwwc5n', desktop)
  await page.getByRole('button', { name: 'More actions' }).click()
  await page.getByRole('menuitem', { name: 'Move to Bin' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Move this fact to the Bin?' })
  await expect(dialog.locator('[data-slot="bin-open-proposals"]')).toContainText(
    'It has an open proposal. It stays open, but nobody can accept it while the fact is in the Bin.',
  )
  await confirmMove(page, 'Replaced by the Germany note')
  // The page leaves the item, which is gone, for the list.
  await expect(page).toHaveURL(/\/library$/)
  await listReady(page)
  await expect(page.locator('[data-row-id="itm_8mmwwc5n"]')).toHaveCount(0)
})

test('restores several items at once from the Bin', async ({ page }) => {
  await as(page, ADMIN, 'binned')
  await openPage(page, '/library/bin', desktop)
  const table = page.getByRole('table', { name: 'Bin' })
  await expect(table.getByRole('button', { name: /^Restore / })).toHaveCount(3, { timeout: 15_000 })
  await page.getByRole('checkbox', { name: 'Select every fact in the Bin' }).click()
  const bar = page.getByRole('region', { name: 'Selected rows' })
  await expect(bar.getByText('3 selected')).toBeVisible()
  await bar.getByRole('button', { name: 'Restore' }).click()
  await page
    .getByRole('alertdialog', { name: 'Restore 3 facts?' })
    .getByRole('button', { name: 'Restore' })
    .click()
  await expect(page.locator('[data-slot="toast"]')).toContainText('3 facts restored')
  await expect(page.getByText('The Bin is empty')).toBeVisible()
})

test('an item in the Bin opens to read before restoring it, and Restore brings it back', async ({
  page,
}) => {
  await as(page, ADMIN, 'binned')
  await openPage(page, '/library/bin', desktop)
  const row = page.locator('[data-row-id]').first()
  await expect(row).toBeVisible({ timeout: 15_000 })
  const id = await row.getAttribute('data-row-id')
  const title = (await row.getByRole('link').textContent())!.trim()
  await row.getByRole('link', { name: title }).click()
  await expect(page).toHaveURL(new RegExp(`/library/bin/${id}$`))

  const banner = page.locator('[data-slot="bin-item-banner"]')
  await expect(banner).toContainText("In the Bin. Agents don't get it.")
  await expect(banner).toContainText('Moved by Ravi Kapoor')
  await expect(banner).toContainText('Duplicates of the pilot import, kept the newer ones')
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Where it applies' })).toBeVisible()
  const breadcrumb = page.getByRole('navigation', { name: 'breadcrumb' })
  await expect(breadcrumb.getByRole('link', { name: 'Bin' })).toBeVisible()
  // Read only: nothing on it changes the item, and its links wait until it is back.
  await expect(page.getByRole('link', { name: 'Suggest a change' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'More actions' })).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Links' })).toHaveCount(0)
  await page.getByRole('tab', { name: /^Source/ }).click()
  await expect(page.getByRole('region', { name: 'Where this comes from' })).toBeVisible()
  await page.getByRole('tab', { name: /^History/ }).click()
  await expect(page.getByRole('region', { name: 'History' })).toBeVisible()

  await banner.getByRole('button', { name: 'Restore' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Restore this fact?' })
  await dialog.getByRole('button', { name: 'Restore' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-slot="toast"]')).toContainText('Fact restored')
  // Back in the library: its own page, with its actions.
  await expect(page).toHaveURL(new RegExp(`/library/${id}$`))
  await expect(page.getByRole('link', { name: 'Suggest a change' })).toBeVisible()
})

test("restores an item of a deleted domain into another domain, retired, for that domain's owners", async ({
  page,
}) => {
  await as(page, ADMIN)
  // Sales is deleted: its items move to the Bin.
  await openPage(page, '/admin?section=domains', desktop)
  await page.getByRole('button', { name: 'Delete Sales' }).click()
  const remove = page.getByRole('alertdialog', { name: 'Delete Sales?' })
  await remove
    .getByRole('textbox', { name: 'Type permanently delete to confirm' })
    .fill('permanently delete')
  await remove.getByRole('button', { name: 'Delete domain' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Close' }).click()
  await openDeletedItems(page)
  const row = page.locator('[data-row-id]').first()
  await expect(row).toContainText('Sales, deleted', { timeout: 15_000 })
  const id = await row.getAttribute('data-row-id')

  await row.getByRole('button', { name: /^Restore / }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Restore this fact into another domain?' })
  await expect(dialog).toHaveAccessibleDescription(
    /Its domain, Sales, is deleted\. It comes back archived, with a proposal in the domain you choose/,
  )
  // Nothing goes until a domain is chosen and what it changes is read.
  const restore = dialog.getByRole('button', { name: 'Restore' })
  await expect(restore).toBeDisabled()
  await dialog.getByRole('combobox', { name: 'Restore into' }).click()
  await page.getByRole('option', { name: 'Marketing' }).click()
  const changes = dialog.locator('[data-slot="rescue-changes"]')
  await expect(changes).toContainText('What changes in Marketing')
  await expect(changes).toContainText('Domain: Sales is deleted, so it moves to Marketing')
  await expect(changes).toContainText('Owner: Tomas Eriksen, an owner there, takes over from')
  await expect(changes).toContainText('Everything else stays as it was')
  await settle(page)
  const results = await new AxeBuilder({ page })
    .include('[role="alertdialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
  await restore.click()
  await expect(dialog).toBeHidden()
  const toast = page.locator('[data-slot="toast"]')
  await expect(toast).toContainText('Fact restored')
  await expect(toast).toContainText(
    /It's back, archived\. Proposal #\d+ waits for the owners of Marketing\./,
  )
  await expect(page.locator(`[data-row-id="${id}"]`)).toHaveCount(0)

  // The proposal opens with a note that it was restored from the Bin.
  await toast.getByRole('button', { name: 'Open proposal' }).click()
  await expect(page.locator('[data-slot="rescue-note"]')).toContainText(
    'Restored from the Bin into this domain',
  )
  await expect(page.locator('[data-slot="rescue-note"]')).toContainText(
    'because its domain, Sales, was deleted',
  )
  await expect(page.getByRole('columnheader', { name: 'Version 1, before the Bin' })).toBeVisible()
  await expect(page.getByText('Sales, deleted')).toBeVisible()
})

test('anyone but an administrator gets none of the Bin', async ({ page }) => {
  await as(page, null)
  await openPage(page, '/library', desktop)
  await listReady(page)
  const nav = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(nav.getByRole('link', { name: 'Needs checking' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Bin' })).toHaveCount(0)
  await page.getByRole('button', { name: /^View: / }).click()
  await expect(page.getByRole('menuitemradio', { name: 'Needs checking' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Deleted facts' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  const row = page.locator('[data-row-id]').first()
  await row.hover()
  await row.getByRole('button', { name: /^Actions for / }).click()
  await expect(page.getByRole('menuitem', { name: 'Copy link' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Move to Bin' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await rowCheckbox(page, 0).click()
  const bar = page.getByRole('region', { name: 'Selected rows' })
  await expect(bar.getByRole('button', { name: 'Copy links' })).toBeVisible()
  await expect(bar.getByRole('button', { name: 'Move to Bin' })).toHaveCount(0)

  const id = await row.getAttribute('data-row-id')
  await page.goto('/library/bin')
  await expect(page.getByText('The Bin is for admins')).toBeVisible({ timeout: 15_000 })
  // An item's Bin address reads nothing of it either.
  await page.goto(`/library/bin/${id}`)
  await expect(page.getByText('The Bin is for admins')).toBeVisible({ timeout: 15_000 })
})

for (const [name, size] of [
  ['1440', desktop],
  ['390', phone],
] as const)
  test(`the Bin page has no accessibility violations at ${name}px`, async ({ page }) => {
    await as(page, ADMIN, 'binned')
    await openPage(page, '/library/bin', size)
    await expect(page.locator('[data-row-id]')).toHaveCount(3, { timeout: 15_000 })
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    // On a phone every cell wraps under the title; nothing scrolls sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })

for (const [name, size] of [
  ['1440', desktop],
  ['390', phone],
] as const)
  test(`an item in the Bin has no accessibility violations at ${name}px`, async ({ page }) => {
    await as(page, ADMIN, 'binned')
    await openPage(page, '/library/bin', size)
    const id = await page.locator('[data-row-id]').first().getAttribute('data-row-id')
    await openPage(page, `/library/bin/${id}`, size)
    await expect(page.locator('[data-slot="bin-item-banner"]')).toBeVisible({ timeout: 15_000 })
    await settle(page)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
