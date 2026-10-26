import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, widths } from './support'

/*
  Triage in the To review queue (FR-223), Linear's way, on the mock as Jon, the owner of
  Sales and Sandbox: x selects the focused row, Shift with j extends, Shift-click selects a
  range, the floating bar and Command K act on the selection, the dialog says what happens to
  each proposal before the reason, and the step is held for Undo before it is sent.
*/

const desktop = { ...widths[0], theme: 'light' } as const

const titles = {
  ready: 'United Kingdom launch campaign ran from 21 February 2025 to 30 September 2026',
  overdue: 'How to investigate a drop in Churn rate in Spain',
  issue: 'Reporting from the payment provider is down for the United Kingdom.',
  proposer: 'Net revenue for September 2026 includes a one-off correction for August discounts.',
  claimed: 'Conversion rate counts sign-ups from 15 January 2024',
  low: 'Data for Gross margin before 7 June 2026 is incomplete for Sweden: the clothing feed started that day.',
} as const

const queue = (page: Page) => page.getByRole('table', { name: 'Proposals to review' })
const row = (page: Page, title: string) =>
  queue(page)
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name: title }) })
const selectionBar = (page: Page) => page.getByRole('region', { name: 'Selected proposals' })
const toast = (page: Page) => page.locator('[data-slot="toast"]')

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_jon'))
  await openPage(page, '/proposals', desktop)
  await expect(queue(page)).toBeVisible()
})

test('selects with x, Shift j and Shift-click, a proposal Jon made himself too', async ({
  page,
}) => {
  // Jon proposed one in his own domain: as its owner he decides it, so it selects like any other
  // and no line says someone else must (FR-206).
  const own = row(page, titles.proposer).getByRole('checkbox', {
    name: `Select ${titles.proposer}`,
  })
  await expect(own).not.toHaveAttribute('aria-disabled', 'true')
  await expect(page.locator('[data-slot="decide-note"]')).toHaveCount(0)

  await queue(page).getByRole('link', { name: titles.ready }).focus()
  await page.keyboard.press('x')
  await page.keyboard.press('Shift+J')
  await expect(row(page, titles.ready)).toHaveAttribute('aria-selected', 'true')
  await expect(row(page, titles.overdue)).toHaveAttribute('aria-selected', 'true')
  // Shift-click selects from the anchor to the row clicked.
  await queue(page)
    .getByRole('link', { name: titles.proposer })
    .click({ modifiers: ['Shift'] })
  await expect(page).not.toHaveURL(/panel=/)
  await expect(row(page, titles.issue)).toHaveAttribute('aria-selected', 'true')
  await expect(row(page, titles.proposer)).toHaveAttribute('aria-selected', 'true')
  await expect(selectionBar(page)).toContainText('4 selected')
  // The bar never covers a row: on this short list it sits below the last one.
  const lastRow = await queue(page).locator('[data-row-id]').last().boundingBox()
  const barBox = await selectionBar(page).boundingBox()
  expect(barBox!.y).toBeGreaterThanOrEqual(lastRow!.y + lastRow!.height)

  await selectionBar(page).getByRole('button', { name: 'Accept' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept 4 selected proposals?' })
  await expect(dialog.getByRole('region', { name: 'Decided' })).toContainText(titles.overdue)
  await expect(dialog.getByRole('region', { name: 'Decided' })).toContainText(titles.proposer)
  await expect(dialog.getByRole('button', { name: 'Accept 4' })).toBeVisible()
  const axe = await new AxeBuilder({ page }).include('[role="alertdialog"]').analyze()
  expect(axe.violations.map((violation) => violation.id)).toEqual([])
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting them?' })
    .fill('Checked the source')
  await dialog.getByRole('button', { name: 'Accept 4' }).click()

  // Held: the rows leave at once, and Undo puts them back as they were.
  await expect(toast(page)).toContainText('4 proposals accepted')
  await expect(row(page, titles.overdue)).toHaveCount(0)
  await expect(selectionBar(page)).toHaveCount(0)
  await toast(page).getByRole('button', { name: 'Undo' }).click()
  await expect(row(page, titles.overdue)).toHaveAttribute('aria-selected', 'true')
  await expect(selectionBar(page)).toContainText('4 selected')

  // Escape clears the selection.
  await queue(page).getByRole('link', { name: titles.overdue }).focus()
  await page.keyboard.press('Escape')
  await expect(selectionBar(page)).toHaveCount(0)
})

test('leaves out what another owner reviews, and sends after the Undo window', async ({ page }) => {
  test.setTimeout(60_000)
  // Sofia claimed one: Jon's bulk step leaves it out, and says why.
  for (const title of [titles.claimed, titles.low]) {
    await queue(page).getByRole('link', { name: title }).focus()
    await page.keyboard.press('x')
  }
  await expect(selectionBar(page)).toContainText('2 selected')

  // Command K offers the bulk actions on the selection.
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  await page.keyboard.type('Accept the')
  await palette.getByRole('option', { name: 'Accept the 2 selected' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept 2 selected proposals?' })
  await expect(dialog.getByRole('region', { name: 'Left out' })).toContainText(
    'Another owner is reviewing it.',
  )
  await expect(dialog).toContainText('Agents get it within a minute.')
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting them?' })
    .fill('Markets and dates are right')
  await dialog.getByRole('button', { name: 'Accept 1' }).click()

  // Command or Control Z takes it back too.
  await expect(row(page, titles.low)).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(row(page, titles.low)).toBeVisible()

  // Again, and this time let it go: the toast after says that agents get it.
  await selectionBar(page).getByRole('button', { name: 'Accept' }).click()
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting them?' })
    .fill('Markets and dates are right')
  await dialog.getByRole('button', { name: 'Accept 1' }).click()
  await expect(toast(page)).toContainText('1 proposal left out stays selected')
  // The answer comes as soon as the service gives it, while the Undo toast may still be leaving.
  await expect(toast(page).filter({ hasText: 'Agents get it within a minute.' })).toBeVisible({
    timeout: 20_000,
  })
  await expect(row(page, titles.low)).toHaveCount(0)
  await expect(row(page, titles.claimed)).toBeVisible()
})
