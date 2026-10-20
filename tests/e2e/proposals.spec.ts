import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'
import { fillContext, waitForSaved } from './context-support'
import { openProposal, proposalTitles } from './proposals-support'

/*
  The Proposals page and a proposal's status page on the mock (slice W4): Maria's demo week has
  one proposal in every state. Each test gets its own world, so the steps never meet.
*/

const desktop = { ...widths[0], theme: 'light' } as const

const visibleButton = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true }).filter({ visible: true })

test('lists Maria’s proposals by where each stands, and searches and filters them', async ({
  page,
}) => {
  await openPage(page, '/proposals', desktop)
  const table = page.getByRole('table', { name: 'Your proposals' })
  // The draft she never sent comes first and apart, not mixed with what an owner has.
  await expect(table.getByRole('rowheader')).toHaveText([
    /Draft, not sent\s*1/,
    /Needs you\s*1/,
    /With the owner\s*2/,
    /Closed\s*3/,
  ])
  await expect(
    page.getByRole('navigation', { name: 'Proposal views' }).getByRole('link', { name: /Mine/ }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('group', { name: 'Totals' })).toContainText(/7\s*proposals/)
  await expect(page.getByRole('group', { name: 'Totals' })).toContainText(
    /1\s*draft\s*·\s*1\s*needs you/,
  )

  await page.getByRole('textbox', { name: 'Search proposals' }).fill('norway')
  await expect(table.getByRole('link')).toHaveText([proposalTitles.changesRequested])
  await expect(page).toHaveURL(/q=norway/)
  await page.getByRole('textbox', { name: 'Search proposals' }).fill('')

  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Rejected' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(table.getByRole('link')).toHaveText([proposalTitles.rejected])
  await expect(page.locator('#proposals-count')).toHaveText(/1\s*of 7 proposals/)
  await page.getByRole('button', { name: 'Remove filter Status: Rejected' }).click()
  await expect(table.getByRole('link')).toHaveCount(7)

  // The list's keys: / searches, j moves to the first row.
  await page.getByRole('button', { name: 'Filter', exact: true }).focus()
  await page.keyboard.press('/')
  await expect(page.getByRole('textbox', { name: 'Search proposals' })).toBeFocused()
  await page.getByRole('button', { name: 'Filter', exact: true }).focus()
  await page.keyboard.press('j')
  await expect(table.getByRole('link').first()).toBeFocused()
})

test('reads the reviewer’s reason, refuses a phone number and sends a reply', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openProposal(page, proposalTitles.changesRequested)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(proposalTitles.changesRequested)
  await expect(page.getByRole('list', { name: 'Where it stands' })).toContainText(
    'Claimed by Jon Abara',
  )
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText(
    'Jon Abara asked for changes',
  )
  await expect(page.getByText('run when you send it for review')).toHaveCount(0)
  const reply = page.getByRole('textbox', { name: 'Reply to Jon' })
  await reply.fill('Call me on 555-123-4567.')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(page.getByText('It looks like it holds a phone number.')).toBeVisible()
  await reply.fill('Added the link to the notice. Orders elsewhere look normal.')
  await page.getByRole('button', { name: 'Send reply' }).click()
  await expect(reply).toHaveValue('')
  // The reply is the newest comment of the discussion; the history keeps a line for it.
  await expect(
    page.getByRole('list', { name: 'Comments' }).locator('[data-slot="comment"]').last(),
  ).toContainText('Added the link to the notice. Orders elsewhere look normal.')
  await expect(
    page.getByRole('list', { name: 'History' }).locator('[data-slot="timeline-event"]').first(),
  ).toContainText('You replied')
})

test('edits and resubmits after the reviewer asked for changes', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openProposal(page, proposalTitles.changesRequested)
  await visibleButton(page, 'Edit and send again').first().click()
  await expect(page).toHaveURL(/\/library\/new\?draft=/)
  const summary = page.getByRole('textbox', { name: 'Summary', exact: true })
  await expect(summary).toContainText('Norway')
  await page
    .getByRole('textbox', { name: 'Link to the source', exact: true })
    .fill('https://regulator.example/notice-2026-08')
  await page.getByRole('textbox', { name: 'Link to the source', exact: true }).press('Tab')
  await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute(
    'data-status',
    'saved',
  )
  await visibleButton(page, 'Send for review').click()
  await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+$/)
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Waiting for review')
  const steps = page.getByRole('list', { name: 'Where it stands' })
  await expect(steps).toContainText('Sent again')
  await expect(steps).toContainText('Waiting for an owner')
  await expect(page.locator('[data-slot="timeline-event"]').nth(1)).toContainText(
    'You sent it back for review',
  )
})

test('withdraws a sent proposal with a reason', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openProposal(page, proposalTitles.waiting)
  await expect(page.locator('[data-slot="issue-note"]')).toContainText(
    "Once it's accepted, we ask again in 14 days: “Is this still going on?”",
  )
  await visibleButton(page, 'Withdraw').click()
  const dialog = page.getByRole('alertdialog', { name: 'Withdraw this proposal?' })
  await dialog.getByRole('button', { name: 'Withdraw' }).click()
  await expect(dialog.getByText('Give a reason.')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Why' }).fill('The provider restored the feed.')
  await dialog.getByRole('button', { name: 'Withdraw' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Withdrawn')
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText(
    'The provider restored the feed.',
  )
  await expect(visibleButton(page, 'Withdraw')).toHaveCount(0)
})

test('discards a draft from its page, and it leaves the list', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openProposal(page, proposalTitles.draft)
  await expect(page.getByRole('list', { name: 'Where it stands' })).toContainText('Not sent yet')
  await visibleButton(page, 'Discard draft').click()
  const dialog = page.getByRole('alertdialog', { name: 'Discard this draft?' })
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Discard draft' }).click()
  await expect(page).toHaveURL(/\/proposals$/)
  await expect(page.getByRole('table', { name: 'Your proposals' }).getByRole('link')).toHaveCount(6)
  await expect(page.getByText(proposalTitles.draft)).toHaveCount(0)
})

test('discards a draft from the Add a fact form', async ({ page }) => {
  await openPage(page, '/library/new', desktop)
  await fillContext(page)
  await waitForSaved(page)
  await page.getByRole('button', { name: 'More draft actions' }).click()
  await page.getByRole('menuitem', { name: 'Discard draft' }).click()
  await page
    .getByRole('alertdialog', { name: 'Discard this draft?' })
    .getByRole('button', { name: 'Discard draft' })
    .click()
  await expect(page).toHaveURL(/\/proposals$/)
  await expect(page.getByText('A reporting delay affected Norway')).toHaveCount(0)
})

test('keeps the main action in the phone bar and the sections in a menu', async ({ page }) => {
  await openPage(page, '/proposals', { ...widths[2], theme: 'light' })
  await expect(page.getByRole('button', { name: 'View: Mine' })).toBeVisible()
  await openProposal(page, proposalTitles.changesRequested)
  const bar = visibleButton(page, 'Edit and send again').last()
  const box = await bar.boundingBox()
  expect(box!.y + box!.height).toBeLessThanOrEqual(844)
  await page.getByRole('button', { name: 'Section: Activity' }).click()
  await page.getByRole('menuitemradio', { name: 'Fields' }).click()
  await expect(page).toHaveURL(/tab=fields/)
  await expect(page.getByRole('definition').first()).toBeVisible()
  await page.getByRole('button', { name: 'More proposal actions' }).click()
  await expect(page.getByRole('menuitem', { name: 'Withdraw' })).toBeVisible()
})

test('shows what a change does to the accepted item, field by field', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openProposal(page, proposalTitles.inReview)
  await page.getByRole('tab', { name: 'Fields' }).click()
  const row = page.locator('[data-slot="field-row"]', { hasText: 'What happened' })
  await expect(row).toContainText('Changed')
  await expect(row).toContainText('since the reporting upgrade')
  await expect(row).toContainText('Before')
  await expect(row).toContainText('Cube gets Units sold a day late')
  await page.getByRole('tab', { name: 'What AI apps will get' }).click()
  await expect(page).toHaveURL(/tab=preview/)
  await expect(page.locator('[data-slot="agent-preview"]')).toBeVisible()
})

const pages = [
  { name: 'list', title: null },
  { name: 'changes requested', title: proposalTitles.changesRequested },
  { name: 'draft', title: proposalTitles.draft },
  { name: 'open issue', title: proposalTitles.waiting },
  { name: 'accepted', title: proposalTitles.accepted },
] as const

for (const size of widths)
  for (const theme of themes)
    for (const target of pages)
      test(`proposals ${target.name}: accessibility and geometry at ${size.name}, ${theme}`, async ({
        page,
      }) => {
        await openPage(page, '/proposals', { ...size, theme })
        await expect(page.getByRole('table', { name: 'Your proposals' })).toBeVisible()
        if (target.title) await openProposal(page, target.title)
        await settle(page)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )
        const violations = (await new AxeBuilder({ page }).analyze()).violations
        expect(violations).toEqual([])
      })
