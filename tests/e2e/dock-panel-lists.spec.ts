import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  The docked panel on the Proposals page and the catalogue (design round 3, direction A, slice
  4). A queue row opens its proposal beside the queue with the decision bar in the panel's
  footer, so an owner triages without leaving it; one of the person's own proposals opens in
  status mode; a catalogue row opens its metric or dimension. Each is in the address
  (`?panel=`), so it is linkable and Back closes it; j and k step it, Escape closes it and focus
  returns to the row; expand opens the page. The demo week is src/web/api/mock-demo-proposals.ts.
*/

const desktop = { ...widths[0], theme: 'light' as const }
const tablet = { ...widths[1], theme: 'light' as const }
const phone = { ...widths[2], theme: 'light' as const }

/** Jon's queue, by title, in the queue's order where it matters. */
const titles = {
  highRisk: 'Regulator paused price promotions in the United States on 15 June 2026',
  ready: 'United Kingdom launch campaign ran from 21 February 2025 to 30 September 2026',
  overdue: 'How to investigate a drop in Churn rate in Spain',
  proposer: 'Net revenue for September 2026 includes a one-off correction for August discounts.',
  claimed: 'Conversion rate counts sign-ups from 15 January 2024',
  low: 'Data for Gross margin before 7 June 2026 is incomplete for Sweden: the clothing feed started that day.',
} as const
const READY = '00000000-0000-4000-8000-00000000005a'
const OVERDUE = '00000000-0000-4000-8000-000000000007'

/** Maria's own proposals (demoProposalIds). */
const mine = {
  changesRequested: '00000000-0000-4000-8000-000000000035',
  waiting: '00000000-0000-4000-8000-000000000051',
  draft: '00000000-0000-4000-8000-000000000058',
}

const panel = (page: Page) => page.locator('[data-slot="dock-panel"]')
const heading = (page: Page) => panel(page).getByRole('heading', { level: 2 })
const meta = (page: Page) => panel(page).locator('[data-slot="dock-meta"]')
const bar = (page: Page) => panel(page).getByRole('region', { name: 'Your decision' })
const queue = (page: Page) => page.getByRole('table', { name: 'Proposals to review' })
const focusedRowId = (page: Page) =>
  page.evaluate(() => document.activeElement?.closest('[data-row-id]')?.getAttribute('data-row-id'))
const width = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((element) => element.getBoundingClientRect().width)

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

async function axe(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`,
  )
}

test.describe('the review queue', () => {
  test.beforeEach(async ({ page }) => {
    await signInAs(page, 'per_jon')
  })

  test('a row opens its proposal docked beside the queue, with the decision bar in its footer', async ({
    page,
  }) => {
    await openPage(page, '/proposals', desktop)
    await queue(page).getByRole('link', { name: titles.ready }).click()

    await expect(page).toHaveURL(new RegExp(`/proposals\\?panel=${READY}$`))
    await expect(panel(page)).toHaveAttribute('data-mode', 'docked')
    await expect(page.getByRole('region', { name: titles.ready })).toBeVisible()
    await expect(heading(page)).toHaveText(titles.ready)
    await expect(meta(page)).toHaveText(/Proposal #14\s*·\s*2 of 11/)
    await expect(panel(page).locator('[data-slot="proposal-badges"]')).toContainText(
      /Event\s*Sales\s*Change to a fact\s*In review\s*High risk/,
    )
    // The sidebar folds to its rail, and the queue keeps its grid beside the panel.
    await expect.poll(() => width(page, '[data-slot="sidebar-gap"]')).toBe(48)
    await expect(queue(page).getByRole('columnheader', { name: 'Title' })).toBeVisible()
    const row = queue(page).locator(`[data-row-id="${READY}"]`)
    await expect(row).toHaveAttribute('data-open', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)

    // The tabs: Changes, Checks, Overlaps and Discussion (with the history under it).
    await expect(panel(page).getByRole('tab')).toHaveText([
      /Changes/,
      /Checks/,
      /Overlaps/,
      /Discussion/,
    ])
    await expect(
      panel(page).getByRole('table', { name: 'What changed, field by field' }),
    ).toBeVisible()
    await panel(page)
      .getByRole('tab', { name: /Checks/ })
      .click()
    await expect(page).toHaveURL(/tab=checks/)
    await expect(
      panel(page).getByRole('list', { name: 'Checks' }).getByRole('listitem'),
    ).toHaveCount(3)
    await expect(panel(page).locator('[data-slot="approvals-card"]')).toBeVisible()
    await panel(page)
      .getByRole('tab', { name: /Discussion/ })
      .click()
    await expect(panel(page).getByRole('region', { name: /Discussion/ })).toBeVisible()
    await expect(panel(page).getByRole('list', { name: 'History' })).toBeVisible()

    // The footer: who decides and the three decisions, Accept last.
    await expect(bar(page)).toContainText('Your decision, as owner of Sales')
    await expect(bar(page).getByRole('button')).toHaveText(['Reject', 'Ask for changes', 'Accept'])
    await expect(panel(page).getByText('Claimed by you')).toBeVisible()
    await expect(panel(page).getByRole('button', { name: 'Hand over' })).toBeVisible()

    // Close: the panel leaves the address and the sidebar comes back.
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/proposals$/)
    await expect.poll(() => width(page, '[data-slot="sidebar-gap"]')).toBe(256)
    await expect.poll(() => focusedRowId(page)).toBe(READY)
  })

  test('a link opens the panel on its proposal and tab, with the row marked', async ({ page }) => {
    await openPage(page, `/proposals?panel=${OVERDUE}&tab=overlaps`, desktop)
    await expect(heading(page)).toHaveText(titles.overdue)
    await expect(panel(page).getByRole('tab', { name: /Overlaps/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(queue(page).locator(`[data-row-id="${OVERDUE}"]`)).toHaveAttribute(
      'data-open',
      'true',
    )
    await expect.poll(() => focusedRowId(page)).toBe(OVERDUE)
    // A tab the proposal does not have opens Changes.
    await openPage(page, `/proposals?panel=${OVERDUE}&tab=fields`, desktop)
    await expect(panel(page).getByRole('tab', { name: /Changes/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('j and k step the panel through the queue; Escape closes it; Back too', async ({ page }) => {
    await openPage(page, '/proposals', desktop)
    await queue(page).getByRole('link', { name: titles.highRisk }).click()
    await expect(meta(page)).toHaveText(/1 of 11/)
    await page.keyboard.press('j')
    await expect(heading(page)).toHaveText(titles.ready)
    await expect(meta(page)).toHaveText(/2 of 11/)
    await panel(page).getByRole('button', { name: 'Next' }).click()
    await expect(heading(page)).toHaveText(titles.overdue)
    await page.keyboard.press('k')
    await expect(heading(page)).toHaveText(titles.ready)
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/proposals$/)
    await expect.poll(() => focusedRowId(page)).toBe(READY)

    // The next row replaces the address, so Back closes the panel, Forward opens it again.
    await page.keyboard.press('Enter')
    await expect(heading(page)).toHaveText(titles.ready)
    await page.keyboard.press('j')
    await expect(heading(page)).toHaveText(titles.overdue)
    await page.goBack()
    await expect(panel(page)).toHaveCount(0)
    await page.goForward()
    await expect(heading(page)).toHaveText(titles.overdue)
  })

  test('asks for changes in the panel, and the panel moves on to the next proposal', async ({
    page,
  }) => {
    await openPage(page, `/proposals?panel=${READY}`, desktop)
    await expect(heading(page)).toHaveText(titles.ready)
    // r opens the dialog, as on the review page; nothing is decided without a reason.
    await expect(async () => {
      await page.keyboard.press('r')
      await expect(page.getByRole('alertdialog')).toBeVisible({ timeout: 1000 })
    }).toPass()
    const ask = page.getByRole('alertdialog', { name: 'Ask Kofi Mensah for changes?' })
    // Escape closes the dialog only, never the panel behind it.
    await page.keyboard.press('Escape')
    await expect(ask).toBeHidden()
    await expect(panel(page)).toBeVisible()
    await bar(page).getByRole('button', { name: 'Ask for changes' }).click()
    await ask
      .getByRole('textbox', { name: 'Why are you asking for changes?' })
      .fill('Please link the campaign brief.')
    await ask.getByRole('button', { name: 'Ask for changes' }).click()
    await expect(
      page.getByText("We've told Kofi, who can change it and send it again."),
    ).toBeVisible()
    // It left the queue; the panel reads the one after it.
    await expect(heading(page)).toHaveText(titles.overdue)
    await expect(meta(page)).toHaveText(/2 of 10/)
    await expect(queue(page).getByRole('link', { name: titles.ready })).toHaveCount(0)
  })

  test('accepts the last proposal of the queue and the panel shows it decided', async ({
    page,
  }) => {
    await openPage(page, '/proposals', desktop)
    await queue(page).getByRole('link', { name: titles.low }).click()
    await expect(meta(page)).toHaveText(/11 of 11/)
    await bar(page).getByRole('button', { name: 'Accept' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Accept this proposal?' })
    await dialog
      .getByRole('textbox', { name: 'Why are you accepting it?' })
      .fill('The feed date matches the wiki.')
    await dialog.getByRole('button', { name: 'Accept' }).click()
    await expect(page.getByText(/^(From then on, )?agents get it\.$/).first()).toBeVisible()
    // Nothing after it: the panel stays on it, now in status mode.
    await expect(heading(page)).toHaveText(titles.low)
    await expect(panel(page).locator('[data-slot="decision-alert"]')).toContainText(
      'You accepted it',
    )
    await expect(bar(page)).toHaveCount(0)
  })

  test('keeps blocked decisions visible in the footer and says why', async ({ page }) => {
    await openPage(page, '/proposals', desktop)
    await queue(page).getByRole('link', { name: titles.claimed }).click()
    await expect(bar(page)).toContainText('Sofia Brandt is reviewing this')
    const accept = bar(page).getByRole('button', { name: /Accept/ })
    await expect(accept).toHaveAttribute('aria-disabled', 'true')
    await accept.focus()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog')).toContainText('Ask Sofia to hand it over, or wait.')
    // The popover owns Escape: the panel stays.
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(panel(page)).toBeVisible()

    // The proposer's own: as its domain's owner, Jon decides it, and the bar says it is his.
    await queue(page).getByRole('link', { name: titles.proposer }).click()
    await expect(heading(page)).toHaveText(titles.proposer)
    await expect(bar(page)).toContainText('You can decide your own proposal.')
    await expect(
      bar(page).getByRole('button', { name: 'Accept', exact: true }),
    ).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('claims and hands over in the panel', async ({ page }) => {
    await openPage(page, `/proposals?panel=${OVERDUE}`, desktop)
    await panel(page).getByRole('button', { name: 'Claim' }).click()
    await expect(panel(page).getByText('Claimed by you')).toBeVisible()
    await panel(page).getByRole('button', { name: 'Hand over' }).click()
    await page.getByRole('menuitem', { name: /Sofia Brandt/ }).click()
    await expect(bar(page)).toContainText('Sofia Brandt is reviewing this')
    await expect(queue(page).locator(`[data-row-id="${OVERDUE}"]`)).toContainText('Sofia')
  })

  test('expand opens the review page for the proposal', async ({ page }) => {
    await openPage(page, `/proposals?panel=${READY}`, desktop)
    await panel(page).getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(new RegExp(`/proposals/${READY}$`))
    await expect(page.getByRole('heading', { level: 1, name: titles.ready })).toBeVisible()
    await expect(page.locator('[data-slot="review-companion"]')).toBeVisible()
    await expect(panel(page)).toHaveCount(0)
  })

  test('at 1,024 the panel lies over the queue, which keeps its width', async ({ page }) => {
    await openPage(page, `/proposals?panel=${READY}`, tablet)
    await expect(panel(page)).toHaveAttribute('data-mode', 'overlay')
    await expect(heading(page)).toHaveText(titles.ready)
    expect(await width(page, '[data-slot="dock-panel"]')).toBe(480)
    expect(await width(page, '[data-slot="sidebar-gap"]')).toBe(48)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1024)
    await expect(bar(page).getByRole('button')).toHaveText(['Reject', 'Ask for changes', 'Accept'])
  })

  test('on a phone the panel fills the screen with one decision button', async ({ page }) => {
    await openPage(page, '/proposals', phone)
    await page.getByRole('link', { name: titles.ready }).click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'full')
    expect(await width(page, '[data-slot="dock-panel"]')).toBe(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await expect(bar(page).getByRole('button', { name: 'Accept' })).toBeVisible()
    await bar(page).getByRole('button', { name: 'More decisions' }).click()
    await expect(page.getByRole('menuitem')).toHaveText([/Close menu/, /Reject/, /Ask for changes/])
    await page.keyboard.press('Escape')
    // The back arrow returns to the row.
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(() => focusedRowId(page)).toBe(READY)
  })

  test('on a phone the tab row scrolls, and the tab shown stays in view', async ({ page }) => {
    await openPage(page, `/proposals?panel=${READY}&tab=activity`, phone)
    const activity = panel(page).getByRole('tab', { name: /Discussion/ })
    await expect(activity).toHaveAttribute('aria-selected', 'true')
    await expect(activity).toBeInViewport({ ratio: 1 })
    await panel(page)
      .getByRole('tab', { name: /Changes/ })
      .click()
    await expect(panel(page).getByRole('tab', { name: /Changes/ })).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
  })

  for (const theme of themes)
    for (const { name, width: w, height } of widths)
      test(`the review panel passes axe at ${name}, ${theme}`, async ({ page }) => {
        await openPage(page, `/proposals?panel=${READY}`, { width: w, height, theme })
        await expect(bar(page)).toBeVisible()
        expect(await axe(page)).toEqual([])
      })
})

test.describe('my proposals', () => {
  test('one of mine opens in status mode: the reviewer’s word, the tabs and the actions', async ({
    page,
  }) => {
    await openPage(page, '/proposals?view=mine', desktop)
    await page
      .getByRole('table', { name: 'Your proposals' })
      .getByRole('link', { name: /Online sales to Norway/ })
      .click()
    await expect(page).toHaveURL(new RegExp(`view=mine&panel=${mine.changesRequested}`))
    await expect(panel(page)).toHaveAttribute('data-mode', 'docked')
    await expect(panel(page).locator('[data-slot="decision-alert"]')).toContainText(
      'Jon Abara asked for changes',
    )
    await expect(panel(page).getByRole('tab')).toHaveText([
      'Activity',
      'Fields',
      'What agents get',
      'Checks',
    ])
    await expect(panel(page).getByRole('list', { name: 'History' })).toBeVisible()
    await expect(panel(page).getByRole('textbox', { name: /Reply/ })).toBeVisible()
    await panel(page).getByRole('tab', { name: 'Checks' }).click()
    await expect(panel(page).locator('[data-slot="gate-result"]')).toBeVisible()
    await expect(panel(page).getByRole('heading', { name: 'Details' })).toBeVisible()
    await panel(page).getByRole('tab', { name: 'Fields' }).click()
    await expect(page).toHaveURL(/tab=fields/)

    // The footer has the page's actions; editing happens on the page editor.
    const footer = panel(page).locator('[data-slot="dock-footer"]')
    await expect(footer.getByRole('button')).toHaveText(['Withdraw', 'Edit and send again'])
    await footer.getByRole('button', { name: 'Edit and send again' }).click()
    await expect(page).toHaveURL(/\/library\/new\?draft=/)
  })

  test('withdraws a sent proposal from the panel', async ({ page }) => {
    await openPage(page, `/proposals?view=mine&panel=${mine.waiting}`, desktop)
    await panel(page).getByRole('button', { name: 'Withdraw' }).click()
    const dialog = page.getByRole('alertdialog', { name: 'Withdraw this proposal?' })
    await dialog.getByRole('textbox', { name: 'Why' }).fill('The provider fixed it today.')
    await dialog.getByRole('button', { name: 'Withdraw' }).click()
    await expect(page.getByText('Agents never got it.')).toBeVisible()
    await expect(panel(page).locator('[data-slot="proposal-badges"]')).toContainText('Withdrawn')
  })

  test('discards a draft from the panel, and the panel closes', async ({ page }) => {
    await openPage(page, `/proposals?view=mine&panel=${mine.draft}`, desktop)
    await panel(page).getByRole('button', { name: 'Discard draft' }).click()
    await page
      .getByRole('alertdialog', { name: 'Discard this draft?' })
      .getByRole('button', { name: 'Discard draft' })
      .click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Your proposals' }).getByRole('link')).toHaveCount(
      6,
    )
  })

  test('a proposal that is not there says so, and the list stays', async ({ page }) => {
    await openPage(page, '/proposals?view=mine&panel=00000000-0000-4000-8000-0000000000ff', desktop)
    await expect(heading(page)).toHaveText('Proposal not found')
    await panel(page).getByRole('button', { name: 'Close' }).first().click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByRole('table', { name: 'Your proposals' })).toBeVisible()
  })
})

test.describe('the catalogue', () => {
  const row = (page: Page, key: string) => page.locator(`[data-term-key="${key}"]`)

  test('a row opens its metric docked, with the shelf, the tabs and the actions', async ({
    page,
  }) => {
    await openPage(page, '/catalogue', desktop)
    await row(page, 'metric:net_revenue').getByRole('link', { name: 'Net revenue' }).click()
    await expect(page).toHaveURL(/\/catalogue\?panel=metric%3Anet_revenue$/)
    await expect(panel(page)).toHaveAttribute('data-mode', 'docked')
    await expect(heading(page)).toHaveText('Net revenue')
    await expect(meta(page)).toHaveText(/Metric\s*·\s*\d+ of 27/)
    await expect(panel(page).locator('[data-slot="term-badges"]')).toContainText(
      /Metric\s*Sales\s*Copy read 7 Oct 2026/,
    )
    await expect(panel(page).locator('[data-slot="term-description"]')).toContainText(
      'Gross sales after returns, discounts, VAT and payment fees',
    )
    await expect(panel(page).locator('[data-slot="shelf-card"]')).toContainText('90')
    await expect(panel(page).getByRole('tab')).toHaveText(['Overview', /Context\s*90/, 'Source'])
    await expect(row(page, 'metric:net_revenue')).toHaveAttribute('data-open', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440)

    await panel(page).getByRole('tab', { name: 'Source' }).click()
    await expect(page).toHaveURL(/tab=source/)
    await expect(
      panel(page).locator('[data-slot="field-table"][aria-label="Where it comes from"]'),
    ).toContainText('In sync')
    const footer = panel(page).locator('[data-slot="dock-footer"]')
    // The title names the term just above, so the primary reads Add a fact and keeps the
    // term in its accessible name.
    await expect(footer.getByRole('link')).toHaveText(['Add a fact', 'Show all 90 facts'])
    await expect(footer.getByRole('link', { name: 'Add a fact about Net revenue' })).toBeVisible()

    // Expand opens the metric page on the same tab.
    await panel(page).getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/net_revenue\?tab=source$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Net revenue' })).toBeVisible()
  })

  test('j and k step the panel through the terms; Escape closes it, back to the row', async ({
    page,
  }) => {
    await openPage(page, '/catalogue?panel=metric:active_customers', desktop)
    await expect(heading(page)).toHaveText('Active customers')
    await expect(meta(page)).toHaveText(/1 of 27/)
    await expect(panel(page).locator('[data-slot="term-badges"]')).toContainText('1 active issue')
    await page.keyboard.press('j')
    await expect(heading(page)).toHaveText('Churn rate')
    await page.keyboard.press('j')
    await expect(heading(page)).toHaveText('Customer lifetime value')
    await page.keyboard.press('k')
    await expect(heading(page)).toHaveText('Churn rate')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(page).toHaveURL(/\/catalogue$/)
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.activeElement?.closest('[data-term-key]')?.getAttribute('data-term-key'),
        ),
      )
      .toBe('metric:churn_rate')
  })

  test('a dimension opens with its values, and expand opens its page', async ({ page }) => {
    await openPage(page, '/catalogue?panel=dim:market', desktop)
    await expect(heading(page)).toHaveText('Market')
    await expect(meta(page)).toHaveText(/Dimension/)
    await expect(panel(page).getByRole('list', { name: 'Values of Market' })).toContainText(
      'Norway',
    )
    // A dimension has no one library list, so no footer of actions.
    await expect(panel(page).locator('[data-slot="dock-footer"]')).toHaveCount(0)
    await panel(page).getByRole('link', { name: 'Open page' }).click()
    await expect(page).toHaveURL(/\/catalogue\/dimension\/market$/)
  })

  test('a term that is not there says so', async ({ page }) => {
    await openPage(page, '/catalogue?panel=metric:no_such_metric', desktop)
    await expect(heading(page)).toHaveText('Term not found')
    await expect(page.getByRole('table', { name: 'Catalogue' })).toBeVisible()
  })

  test('on a phone the term fills the screen; the back arrow returns to the row', async ({
    page,
  }) => {
    await openPage(page, '/catalogue', phone)
    await row(page, 'metric:active_customers')
      .getByRole('link', { name: 'Active customers' })
      .click()
    await expect(panel(page)).toHaveAttribute('data-mode', 'full')
    await expect(heading(page)).toHaveText('Active customers')
    await settle(page)
    expect(await width(page, '[data-slot="dock-panel"]')).toBe(390)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await panel(page).getByRole('button', { name: 'Close' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(row(page, 'metric:active_customers').getByRole('link')).toBeFocused()
  })

  for (const theme of themes)
    test(`the term panel passes axe at 1,024, ${theme}`, async ({ page }) => {
      await openPage(page, '/catalogue?panel=metric:orders&tab=context', {
        ...widths[1],
        theme,
      })
      await expect(panel(page).getByRole('tab', { name: /Context/ })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      expect(await axe(page)).toEqual([])
    })
})
