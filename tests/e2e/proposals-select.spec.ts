import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, widths } from './support'

/*
  Which proposals a person can select for a bulk step, and why not (FR-223), on the mock. To
  review as Jon, the owner of Sales and Sandbox: a select column with a select-all, as the
  library's, that takes the one he proposed too, as its domain's owner (FR-206). As Ravi, the
  administrator who proposed terms himself: To review lists them, ready to decide, and Mine lets
  him select them; no line says someone else must, and no Switch person. At 1440 and 390.
*/

const desktop = { ...widths[0], theme: 'light' } as const
const phone = { ...widths[2], theme: 'light' } as const

const OWN = 'Net revenue for September 2026 includes a one-off correction for August discounts.'

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

const queue = (page: Page) => page.getByRole('table', { name: 'Proposals to review' })
const mine = (page: Page) => page.getByRole('table', { name: 'Your proposals' })
const note = (page: Page) => page.locator('[data-slot="decide-note"]')
const selectionBar = (page: Page) => page.getByRole('region', { name: 'Selected proposals' })

/** Ravi proposes the model's members as terms, as the pilot's administrator does. */
async function proposeTermsAsRavi(page: Page, size: typeof desktop | typeof phone) {
  await signInAs(page, 'per_ravi')
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'no-terms'))
  await openPage(page, '/admin?section=sources&source=cube&terms=true', size)
  await page
    .locator('[data-slot="propose-terms-no-domain"]')
    .getByRole('combobox', { name: 'Put every metric without a domain in' })
    .selectOption('area_sales')
  await page
    .locator('[data-slot="propose-terms-actions"]')
    .getByRole('button', { name: /^Propose \d+ names?$/ })
    .click()
  await expect(page.getByText(/proposed/i).first()).toBeVisible()
}

test('To review shows a select column as the library does, and Select all takes what Jon may decide, his own too', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/proposals', desktop)
  await expect(queue(page)).toBeVisible()
  const rows = queue(page).locator('[data-row-id]')
  const total = await rows.count()

  // At rest a row shows its kind; hovered, its checkbox, in the column the header's select-all heads.
  const first = rows.first()
  const box = first.getByRole('checkbox')
  await expect(box).toHaveCSS('opacity', '0')
  await first.hover()
  await expect(box).toHaveCSS('opacity', '1')
  const all = queue(page).getByRole('checkbox', { name: 'Select every proposal you can decide' })
  await all.click()
  await expect(selectionBar(page)).toContainText(`${total} selected`)
  await expect(
    queue(page)
      .getByRole('row')
      .filter({ has: page.getByRole('link', { name: OWN }) }),
  ).toHaveAttribute('aria-selected', 'true')
  await expect(note(page)).toHaveCount(0)
  const axe = await new AxeBuilder({ page }).include('[data-slot="review-queue"]').analyze()
  expect(axe.violations.map((violation) => violation.id)).toEqual([])
  await page.screenshot({ path: test.info().outputPath('to-review-1440.png') })
})

test('To review on a phone opens a proposal per card, with no line now Jon decides his own', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/proposals', phone)
  await expect(queue(page)).toBeVisible()
  await expect(queue(page).getByRole('checkbox')).toHaveCount(0)
  await expect(queue(page).getByRole('link', { name: OWN })).toBeVisible()
  await expect(note(page)).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(phone.width)
  await page.screenshot({ path: test.info().outputPath('to-review-390.png') })
})

for (const size of [desktop, phone])
  test(`an administrator finds the terms he proposed in To review, ready to decide, at ${size.width}px`, async ({
    page,
  }) => {
    await proposeTermsAsRavi(page, size)
    // In the app, not a reload: the mock keeps what was proposed in memory.
    if (size.width === phone.width)
      await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('link', { name: 'Proposals', exact: true }).first().click()
    await expect(queue(page)).toBeVisible()
    await expect(queue(page).locator('[data-row-id]').first()).toBeVisible()
    await expect(page.getByText('Nothing for you to review')).toHaveCount(0)
    await expect(note(page)).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width)
    await page.screenshot({ path: test.info().outputPath(`own-review-${size.width}.png`) })
    if (size.width === desktop.width) {
      const rows = queue(page).locator('[data-row-id]')
      const total = await rows.count()
      await queue(page)
        .getByRole('checkbox', { name: 'Select every proposal you can decide' })
        .click()
      await expect(selectionBar(page)).toContainText(`${total} selected`)
      await page.keyboard.press('Escape')
      const axe = await new AxeBuilder({ page }).include('[data-slot="review-queue"]').analyze()
      expect(axe.violations.map((violation) => violation.id)).toEqual([])
    }

    // Mine: the same proposals, each with a checkbox he may tick, and no line over them.
    // A phone keeps the views in a menu.
    if (size.width === phone.width) {
      await page.getByRole('button', { name: 'View: To review' }).click()
      await page.getByRole('menuitemradio', { name: /Mine/ }).click()
    } else
      await page
        .getByRole('navigation', { name: 'Proposal views' })
        .getByRole('link', { name: /Mine/ })
        .click()
    await expect(mine(page)).toBeVisible()
    await expect(note(page)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Switch person' })).toHaveCount(0)
    if (size.width === desktop.width) {
      const first = mine(page).locator('[data-row-id][data-state="submitted"]').first()
      const box = first.getByRole('checkbox')
      await expect(box).not.toHaveAttribute('aria-disabled', 'true')
      await first.getByRole('link').focus()
      await page.keyboard.press('x')
      await expect(selectionBar(page)).toContainText('1 selected')
      const axe = await new AxeBuilder({ page }).include('[data-slot="proposal-list"]').analyze()
      expect(axe.violations.map((violation) => violation.id)).toEqual([])
    }
    await page.screenshot({ path: test.info().outputPath(`mine-${size.width}.png`) })
  })
