import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  What a domain is (FR-813): its summary line and description, on the Overview tab of its record
  in Health, where its owner, its deputy or an administrator edits them, and in Administration >
  Domains, where an administrator edits them with the rest of the domain. Domains have no state:
  every domain is served, so nothing on the record starts, takes live or pauses one. The old
  Areas address lands on the first domain the person reads.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const record = (domain: string) => `/health?open=domain:${domain}`
const about = (page: Page) => page.getByRole('region', { name: 'About this domain' })

test('an owner describes their domain on its record, and it shows at once', async ({ page }) => {
  // Jon Abara is the owner of Sales and Sandbox.
  await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_jon'))
  await openPage(page, record('area_sales'), desktop)
  await expect(about(page)).toContainText('Orders, revenue and the basket')
  await expect(about(page).locator('strong').first()).toHaveText('gross sales')
  // No state, no readiness and no go-live anywhere on the record.
  await expect(page.getByRole('tab', { name: 'Readiness' })).toHaveCount(0)
  await expect(page.getByRole('main')).not.toContainText(/Go live|Not started|Start domain/)
  await about(page).getByRole('button', { name: 'Edit' }).click()
  const dialog = page.getByRole('dialog', { name: 'Describe Sales' })
  const summary = dialog.getByRole('textbox', { name: /Summary/ })
  await summary.fill('x'.repeat(161))
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toContainText('Keep the summary to 160 characters.')
  await expect(summary).toBeFocused()
  await summary.fill('Orders and returns: what customers buy and send back.')
  // The description is written in the editor item text uses: Markdown shows as it is typed.
  const description = dialog.getByRole('textbox', { name: /Description/ })
  await expect(description.locator('strong').first()).toHaveText('gross sales')
  await description.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('Sales covers **net revenue** and payments.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- Ask the owner first.')
  await expect(description.locator('strong')).toHaveText('net revenue')
  await expect(description.getByRole('listitem')).toHaveText('Ask the owner first.')
  // Mod Enter, which the keys under the field show, saves from the text.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(dialog).toBeHidden()
  await expect(about(page)).toContainText('Orders and returns: what customers buy and send back.')
  await expect(about(page).getByRole('listitem')).toHaveText('Ask the owner first.')
  // The domain picker of the toolbar shows the summary under the name.
  await page.getByRole('combobox', { name: 'Domain' }).click()
  await expect(page.getByRole('option', { name: /Sales/ })).toContainText(
    'Orders and returns: what customers buy and send back.',
  )
})

test('the description editor has no mentions, counts past its limit, and leaves an untouched text as it was', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_jon'))
  await openPage(page, record('area_sales'), desktop)
  const shown = about(page).locator('[data-slot="markdown"]')
  const before = await shown.innerHTML()
  await about(page).getByRole('button', { name: 'Edit' }).click()
  const dialog = page.getByRole('dialog', { name: 'Describe Sales' })
  const description = dialog.getByRole('textbox', { name: /Description/ })
  await expect(description).toHaveAccessibleDescription(/of 1,500 characters/)

  // The label focuses the text; @ is a plain character and the / menu offers no mention.
  await dialog.locator('#area-description-label').click()
  await expect(description).toBeFocused()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Ask @')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await page.keyboard.press('Enter')
  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: 'Add a block' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('option', { name: /Mention/ })).toHaveCount(0)
  // Escape closes the menu, not the dialog around the field.
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(dialog).toBeVisible()

  // Past the limit the counter says by how much, and Save refuses it with focus on the text.
  await page.keyboard.insertText('x'.repeat(1500))
  const counter = dialog.locator('[data-slot="body-counter"]')
  await expect(counter).toHaveText(/of 1,500 characters, [\d,]+ too many$/)
  await expect(counter).toHaveAttribute('data-over')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toContainText('Keep the description to 1,500 characters.')
  await expect(description).toBeFocused()
  await expect(description).toHaveAttribute('aria-invalid', 'true')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  // Changing only the summary saves the description exactly as it was.
  await about(page).getByRole('button', { name: 'Edit' }).click()
  await dialog.getByRole('textbox', { name: /Summary/ }).fill('Orders, revenue and the basket.')
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()
  await expect(about(page)).toContainText('Orders, revenue and the basket.')
  expect(await shown.innerHTML()).toBe(before)
})

test('a deputy may describe their domain; another domain is not theirs to open', async ({
  page,
}) => {
  // Sofia Brandt is the deputy of Sales.
  await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_sofia'))
  await openPage(page, record('area_sales'), desktop)
  await expect(about(page).getByRole('button', { name: 'Edit' })).toBeVisible()
  await openPage(page, record('area_marketing'), desktop)
  await expect(page.getByText("This domain isn't available")).toBeVisible()
})

test('an administrator edits what a domain is in Administration, and the table shows it', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_ravi'))
  await openPage(page, '/admin?section=domains', desktop)
  const table = page.getByRole('table', { name: 'Domains' })
  const row = table.getByRole('row').filter({ hasText: 'Paid media' })
  await expect(row).toContainText('Buying ads: return on ad spend')
  await expect(table).not.toContainText(/Not started|Starting|Live/)
  await row.getByRole('button', { name: 'Edit Paid media' }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Paid media' })
  await dialog.getByRole('textbox', { name: /Summary/ }).fill('Ad buying and what it brings back.')
  await dialog.getByRole('textbox', { name: /Why/ }).fill('A clearer line for the pickers.')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  await expect(dialog).toBeHidden()
  await expect(row).toContainText('Ad buying and what it brings back.')
})

test('the old Areas address opens the record of the first domain the person reads', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_jon'))
  await openPage(page, '/areas', desktop)
  await expect(page).toHaveURL(/\/health\?open=domain%3Aarea_sales$/)
  await expect(about(page)).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Health' }),
  ).toHaveAttribute('aria-current', 'page')
})

test('a contributor following an old Areas link is told whose page Health is', async ({ page }) => {
  // Maria Lindqvist, the mock's default person, holds no area role.
  await openPage(page, '/areas', desktop)
  await expect(page).toHaveURL(/\/health$/)
  await expect(page.getByText('Health is for owners and admins')).toBeVisible()
  const sidebar = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(sidebar.getByRole('link', { name: 'Health' })).toHaveCount(0)
  await expect(sidebar.getByRole('link', { name: 'Areas' })).toHaveCount(0)
})

for (const width of widths)
  for (const theme of themes)
    test(`domain description layout and accessibility, ${width.name} ${theme}`, async ({
      page,
    }, info) => {
      await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_jon'))
      await openPage(page, record('area_sales'), { ...width, theme })
      await expect(about(page)).toContainText('Orders, revenue and the basket')
      await settle(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width.width,
      )
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.screenshot({
        path: info.outputPath(`domain-about-${width.name}-${theme}.png`),
        fullPage: true,
      })
      await about(page).getByRole('button', { name: 'Edit' }).click()
      await expect(page.getByRole('dialog', { name: 'Describe Sales' })).toBeVisible()
      await settle(page)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      await page.screenshot({
        path: info.outputPath(`domain-describe-${width.name}-${theme}.png`),
        fullPage: true,
      })
    })
