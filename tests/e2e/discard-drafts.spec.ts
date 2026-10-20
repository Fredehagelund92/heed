import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  Discarding drafts where the person looks for them (contract 8.13): a draft row's menu or
  Command or Control Backspace on Home's Your drafts and in Proposals > Mine, and many at once
  from Mine's selection bar. One confirmation names them; they leave every list and count at once
  and Undo holds the step for 8 seconds before the service discards them. Maria, the mock's
  default contributor, has one draft; the assistant's step saves more.
*/

// The browser here is Desktop Chrome on Windows, where Command or Control is Control.
const desktop = { ...widths[0], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

const drafts = [
  'Units sold in Italy lags a day behind the source tool.',
  'Churn excludes customers who only used a gift voucher.',
  'Order limits in Poland apply per calendar month.',
  'Marketplace payouts are reported a week late.',
]

async function returning(page: Page) {
  await page.addInitScript(() => window.localStorage.setItem('cl.home.seen', 'true'))
}

/** Saves drafts for Maria as the assistant's confirm card does (the mock's service step). */
async function saveDrafts(page: Page, summaries: readonly string[]) {
  await page.evaluate(async (summaries) => {
    const mock = (
      window as unknown as {
        heedMock: { as: (id: string) => { createProposal: (input: unknown) => Promise<unknown> } }
      }
    ).heedMock.as('per_maria')
    for (const summaryMarkup of summaries)
      await mock.createProposal({
        channel: 'assistant',
        draft: { kind: 'note', summaryMarkup, areaId: 'area_sales' },
      })
  }, summaries)
}

const homeRows = (page: Page) =>
  page.getByRole('list', { name: 'Your drafts, not sent yet' }).getByRole('listitem')
const sidebarDrafts = (page: Page) => page.locator('[data-slot="sidebar-drafts"]')
/** The toast showing now: one closed by Undo may still be fading out beside the next. */
const toast = (page: Page) => page.locator('[data-slot="toast"]:not([data-ending-style])')
const table = (page: Page) => page.getByRole('table', { name: 'Your proposals' })
const draftRows = (page: Page) => table(page).locator('[data-row-id][data-state="draft"]')

/** Opens Mine on the drafts, inside the app (a reload would start the mock world again). */
async function openDrafts(page: Page) {
  await sidebarDrafts(page).click()
  await expect(page).toHaveURL(/\/proposals\?view=mine&state=draft$/)
  await expect(draftRows(page).first()).toBeVisible({ timeout: 15_000 })
}

test.describe("Home's Your drafts", () => {
  test('discards a draft from its row menu, and Undo brings it back', async ({ page }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await expect(homeRows(page)).toHaveCount(1, { timeout: 15_000 })
    const row = homeRows(page).first()
    await row.hover()
    await row.getByRole('button', { name: /^Actions for / }).click()
    await expect(page.getByRole('menuitem', { name: 'Continue editing' })).toBeVisible()
    await page.getByRole('menuitem', { name: /^Discard draft/ }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Discard this draft?' })
    await expect(dialog).toContainText('Discount cost in Spain')
    await expect(dialog).toContainText('You can undo for a few seconds')
    await dialog.getByRole('button', { name: 'Discard draft' }).click()

    // Gone at once from Home and the sidebar, held behind Undo.
    await expect(page.getByRole('region', { name: /Your drafts/ })).toHaveCount(0)
    await expect(sidebarDrafts(page)).toHaveCount(0)
    await expect(toast(page)).toContainText('Draft discarded')
    await toast(page).getByRole('button', { name: 'Undo' }).click()
    await expect(homeRows(page)).toHaveCount(1)
    await expect(sidebarDrafts(page)).toHaveText(/Drafts\s*1/)
  })

  test('Command or Control Backspace discards the focused draft; the next one takes the focus', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await expect(homeRows(page)).toHaveCount(1, { timeout: 15_000 })
    await saveDrafts(page, drafts.slice(0, 2))
    await expect(homeRows(page)).toHaveCount(3)
    const first = homeRows(page).first().getByRole('link')
    await first.focus()
    await page.keyboard.press('Control+Backspace')
    const dialog = page.getByRole('alertdialog', { name: 'Discard this draft?' })
    await expect(dialog).toContainText(drafts[1]!)
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Enter')
    await expect(homeRows(page)).toHaveCount(2)
    await expect(homeRows(page).first().getByRole('link')).toBeFocused()
    await expect(homeRows(page).first()).toContainText(drafts[0]!)
    // Left alone, the toast closes and the service discards it: it stays gone.
    await expect(toast(page)).toHaveCount(0, { timeout: 15_000 })
    await expect(homeRows(page)).toHaveCount(2)
    await expect(sidebarDrafts(page)).toHaveText(/Drafts\s*2/)
  })
})

test.describe('Proposals > Mine', () => {
  test('selects drafts and discards them at once, with one confirmation and Undo', async ({
    page,
  }) => {
    await returning(page)
    await openPage(page, '/', desktop)
    await expect(homeRows(page)).toHaveCount(1, { timeout: 15_000 })
    await saveDrafts(page, drafts)
    await openDrafts(page)
    await expect(draftRows(page)).toHaveCount(5)

    // A contributor selects their own drafts: the header takes every one.
    await table(page).getByRole('checkbox', { name: 'Select every draft' }).click()
    const bar = page.getByRole('region', { name: 'Selected drafts' })
    await expect(bar).toContainText('5 selected')
    await bar.getByRole('button', { name: /^Discard/ }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Discard 5 drafts?' })
    const titles = dialog.getByRole('list', { name: 'Drafts to discard' }).getByRole('listitem')
    await expect(titles).toHaveCount(4)
    await expect(titles.last()).toHaveText('And 2 more')
    await dialog.getByRole('button', { name: 'Discard 5 drafts' }).click()

    // Gone at once from the list, the counts and the sidebar; with none left, the way back to
    // every proposal takes the focus.
    await expect(page.getByText('No drafts', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'All your proposals' })).toBeFocused()
    await expect(sidebarDrafts(page)).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Selected drafts' })).toHaveCount(0)
    await expect(toast(page)).toContainText('5 drafts discarded')

    // Undo: the drafts are back, still selected.
    await toast(page).getByRole('button', { name: 'Undo' }).click()
    await expect(draftRows(page)).toHaveCount(5)
    await expect(page.getByRole('region', { name: 'Selected drafts' })).toContainText('5 selected')

    // Back in the list, the key does the same for the selection; left alone, the service
    // discards them. (Keys pressed inside a toast stay with it, so the list is focused first.)
    await draftRows(page).first().getByRole('link').focus()
    await page.keyboard.press('Control+Backspace')
    await page
      .getByRole('alertdialog', { name: 'Discard 5 drafts?' })
      .getByRole('button', { name: 'Discard 5 drafts' })
      .click()
    await expect(toast(page)).toContainText('5 drafts discarded')
    await expect(toast(page)).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByText('No drafts', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'All your proposals' }).click()
    await expect(draftRows(page)).toHaveCount(0)
    await expect(table(page).locator('[data-row-id]')).toHaveCount(6)
  })

  test("a draft row's menu discards it; a sent proposal cannot be selected", async ({ page }) => {
    await returning(page)
    await openPage(page, '/proposals?view=mine', desktop)
    await expect(draftRows(page)).toHaveCount(1, { timeout: 15_000 })
    const sent = table(page).locator('[data-row-id][data-state="submitted"]').first()
    await sent.hover()
    await expect(sent.getByRole('checkbox')).toBeDisabled()
    await expect(sent.getByRole('checkbox')).toHaveAccessibleDescription(
      'Only a draft can be selected here. To take back a sent proposal, withdraw it from its page.',
    )
    await expect(sent.getByRole('button', { name: /^Actions for / })).toHaveCount(0)

    const row = draftRows(page).first()
    await row.hover()
    await row.getByRole('button', { name: /^Actions for / }).click()
    await page.getByRole('menuitem', { name: /^Discard draft/ }).click()
    await page
      .getByRole('alertdialog', { name: 'Discard this draft?' })
      .getByRole('button', { name: 'Discard draft' })
      .click()
    await expect(draftRows(page)).toHaveCount(0)
    await expect(page.locator('#proposals-count')).toHaveText('6 proposals')
  })

  test('on a touch phone the menu shows on each draft row', async ({ browser }) => {
    const context = await browser.newContext({ hasTouch: true, isMobile: true })
    const page = await context.newPage()
    await returning(page)
    await openPage(page, '/proposals?view=mine&state=draft', phone)
    const row = draftRows(page).first()
    await expect(row).toBeVisible({ timeout: 15_000 })
    const menu = row.getByRole('button', { name: /^Actions for / })
    await expect(menu).toBeVisible()
    const box = await menu.boundingBox()
    // A touch target, inside the gutter.
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(phone.width - 16)
    await menu.tap()
    await page.getByRole('menuitem', { name: /^Discard draft/ }).tap()
    await page
      .getByRole('alertdialog', { name: 'Discard this draft?' })
      .getByRole('button', { name: 'Discard draft' })
      .tap()
    await expect(page.getByText('No drafts', { exact: true })).toBeVisible()
    await context.close()
  })
})

for (const theme of themes)
  for (const [name, size] of [
    ['1440', { ...widths[0], theme }],
    ['390', { ...widths[2], theme }],
  ] as const)
    test(`discarding has no accessibility violations at ${name}px, ${theme}`, async ({ page }) => {
      const axe = async () => {
        await settle(page)
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(results.violations.map((violation) => violation.id)).toEqual([])
      }
      await returning(page)
      await openPage(page, '/proposals?view=mine&state=draft', size)
      await expect(draftRows(page).first()).toBeVisible({ timeout: 15_000 })
      await saveDrafts(page, drafts.slice(0, 2))
      await expect(draftRows(page)).toHaveCount(3)
      if (name === '1440') {
        await table(page).getByRole('checkbox', { name: 'Select every draft' }).click()
        await expect(page.getByRole('region', { name: 'Selected drafts' })).toBeVisible()
        await axe()
        await page
          .getByRole('region', { name: 'Selected drafts' })
          .getByRole('button', {
            name: /^Discard/,
          })
          .click()
      } else {
        await draftRows(page)
          .first()
          .getByRole('button', { name: /^Actions for / })
          .click()
        await axe()
        await page.getByRole('menuitem', { name: /^Discard draft/ }).click()
      }
      await expect(page.getByRole('alertdialog')).toBeVisible()
      await axe()
      // Nothing scrolls sideways.
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(0)
    })
