import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, widths } from './support'

/*
  Propose names (the pilot walk's B1, FR-125) on the mock, as an administrator. Dimensions merge
  strictly by name: one term links every view's member of its name, and a live dimension from
  before a term could name several views is offered again with the members it does not link yet.
*/

const desktop = { ...widths[0], theme: 'light' as const }

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}
async function scenario(page: Page, name: string) {
  await page.addInitScript((value) => window.localStorage.setItem('cl.mock-scenario', value), name)
}
const block = (page: Page, slot: string) => page.locator(`[data-slot="${slot}"]`)

test('a live dimension in one view of two links the other, as one change', async ({ page }) => {
  await scenario(page, 'term-in-one-view')
  await signInAs(page, 'per_ravi')
  await openPage(page, '/admin?section=sources&source=cube', desktop)
  const terms = block(page, 'source-terms')
  await expect(terms).toContainText("1 metric or dimension isn't one yet.")
  await terms.getByRole('link', { name: 'Propose names' }).click()
  await expect(page).toHaveURL(/terms=true/)

  const market = page.locator('[data-term="dim:market"]')
  await expect(market.getByRole('textbox')).toHaveValue('Market')
  await expect(market.locator('[data-slot="propose-terms-member-names"]')).toHaveText(
    'A name we know already. It also links 1 more Cube name: orders.market',
  )
  // Its views lie in Sales and in none: shared, so no domain, and an admin reviews it.
  await expect(market.getByRole('combobox', { name: 'Domain of Market' })).toHaveValue('')
  await expect(market.getByRole('checkbox', { name: 'Propose Market' })).toBeChecked()
  expect(
    (await new AxeBuilder({ page }).include('[data-slot="propose-terms"]').analyze()).violations,
  ).toEqual([])

  await page.getByRole('button', { name: 'Propose 1 name' }).click()
  const done = block(page, 'propose-terms-done')
  await expect(done).toContainText('1 name proposed')
  await expect(done).toContainText('needs an admin')
})

test('once every metric and dimension is a name, the page stays open for values', async ({
  page,
}) => {
  await signInAs(page, 'per_ravi')
  await openPage(page, '/admin?section=sources&source=cube', desktop)
  const terms = block(page, 'source-terms')
  await expect(terms).toContainText(
    'Every metric and dimension we read from Cube is a name we know',
  )
  await terms.getByRole('link', { name: 'Add values of a dimension' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Propose names' })).toBeVisible()
  await expect(block(page, 'propose-terms-members')).toContainText(
    'Every metric and dimension we read from Cube is a name we know, or waits for a decision in Proposals.',
  )
  await page.getByRole('button', { name: 'Add values of a dimension' }).click()
  await page.getByRole('combobox', { name: 'Dimension of values 1' }).selectOption('dim:platform')
  await page.getByRole('textbox', { name: 'Values 1, one per line' }).fill('Smart TV, TV')
  await page.getByRole('button', { name: 'Propose 1 name' }).click()
  await expect(block(page, 'propose-terms-done')).toContainText('1 name proposed')
})

test("a dimension's Values action adds its values, and only them", async ({ page }) => {
  await scenario(page, 'term-in-one-view')
  await signInAs(page, 'per_ravi')
  await openPage(page, '/catalogue?panel=dim:market', desktop)
  await page
    .locator('[data-slot="dock-panel"]')
    .getByRole('link', { name: 'Add values of Market' })
    .click()
  await expect(page).toHaveURL(/values=dim%3Amarket|values=dim:market/)
  await expect(page.getByRole('heading', { level: 1, name: 'Add values' })).toBeVisible()
  await expect(
    page.getByRole('banner').getByRole('navigation', { name: 'breadcrumb' }),
  ).toContainText('Add values')
  // The Cube name Market doesn't link yet waits on Propose names; it isn't proposed from here.
  await expect(block(page, 'propose-terms-members')).toHaveCount(0)
  const list = block(page, 'propose-terms-value-list')
  await expect(list.getByRole('combobox', { name: 'Dimension of values 1' })).toHaveValue(
    'dim:market',
  )
  await expect(list).toContainText('Values of Market')
  await list.getByRole('textbox', { name: 'Values 1, one per line' }).fill('Faroe Islands, FO')
  expect(
    (await new AxeBuilder({ page }).include('[data-slot="propose-terms"]').analyze()).violations,
  ).toEqual([])
  await page.getByRole('button', { name: 'Propose 1 name' }).click()
  await expect(block(page, 'propose-terms-done')).toContainText('1 name proposed')
})

test('only an administrator is offered Values', async ({ page }) => {
  await openPage(page, '/catalogue?panel=dim:market', desktop)
  const panel = page.locator('[data-slot="dock-panel"]')
  await expect(panel.getByRole('heading', { name: 'Market' })).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByRole('link', { name: 'Add values of Market' })).toHaveCount(0)
})
