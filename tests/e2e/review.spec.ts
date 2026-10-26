import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectDatePicker } from './context-support'
import { expectFlatRail, openPage, settle, themes, widths } from './support'

/*
  The To review queue and the review screen on the mock (slice W5), as Jon, the owner of
  Sales and Sandbox. The demo week (src/web/api/mock-demo-proposals.ts) holds a proposal in
  every state of his decision bar. Each test gets its own world, so the steps never meet.
*/

const desktop = { ...widths[0], theme: 'light' } as const

/** Jon's queue, by title. */
const titles = {
  ready: 'United Kingdom launch campaign ran from 21 February 2025 to 30 September 2026',
  highRisk: 'Regulator paused price promotions in the United States on 15 June 2026',
  claimed: 'Conversion rate counts sign-ups from 15 January 2024',
  proposer: 'Net revenue for September 2026 includes a one-off correction for August discounts.',
  sandbox: 'Compare Net revenue in Italy with markets that had the same tax change',
  overdue: 'How to investigate a drop in Churn rate in Spain',
  retire: 'Online share excludes test accounts',
  low: 'Data for Gross margin before 7 June 2026 is incomplete for Sweden: the clothing feed started that day.',
  resubmitted: 'Units sold leaves out gift cards in Germany from 1 October 2026.',
} as const

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

/** Opens a proposal's review page from the queue: its row opens the panel, expand the page. */
async function openReview(page: Page, title: string) {
  await page
    .getByRole('table', { name: 'Proposals to review' })
    .getByRole('link', { name: title })
    .click()
  await page.locator('[data-slot="dock-panel"]').getByRole('link', { name: 'Open page' }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your decision' })).toBeVisible()
}

const bar = (page: Page) => page.getByRole('region', { name: 'Your decision' })

test.beforeEach(async ({ page }) => {
  await signInAs(page, 'per_jon')
})

test('opens on To review, highest risk first, grouped by domain, and filters it', async ({
  page,
}) => {
  await openPage(page, '/proposals', desktop)
  const table = page.getByRole('table', { name: 'Proposals to review' })
  await expect(
    page
      .getByRole('navigation', { name: 'Proposal views' })
      .getByRole('link', { name: /To review/ }),
  ).toHaveAttribute('aria-current', 'page')
  await expect(table.getByRole('rowheader')).toHaveText([/Sales\s*9/, /Sandbox\s*2/])
  await expect(table.getByRole('link').first()).toHaveText(titles.highRisk)
  await expect(page.getByRole('group', { name: 'Totals' })).toContainText(/11\s*proposals/)
  await expect(page.getByRole('group', { name: 'Totals' })).toContainText(/3\s*high risk/)
  await expect(
    page.getByRole('navigation', { name: 'Main navigation' }).getByLabel('11 to review'),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('tab', { name: 'Claimed by' }).click()
  await page.getByRole('checkbox', { name: 'You', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(table.getByRole('link')).toHaveText([
    titles.highRisk,
    titles.ready,
    'Units sold lags by two days in Cube',
  ])
  await expect(page).toHaveURL(/claimed=me/)
  await page.getByRole('button', { name: 'Remove filter Claimed by: You' }).click()
  await page.getByRole('textbox', { name: 'Search proposals' }).fill('#6')
  await expect(table.getByRole('link')).toHaveText([titles.retire])
})

test('reads the diff and the checks, then accepts a high-risk change, which publishes it', async ({
  page,
}) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.ready)
  // Kofi's word on what is wrong with the current version leads, above the diff (heed-ux B5).
  await expect(page.locator('[data-slot="proposal-reason"]')).toHaveText(
    /“It has no end date, but the campaign closed on 30 September\.”\s*Kofi .* on what's wrong with the current version/,
  )
  const diff = page.getByRole('table', { name: 'What changed, field by field' })
  await expect(diff.getByRole('rowheader')).toHaveText([
    /What happened/,
    /When it applies/,
    /Where this comes from/,
    /Risk level/,
  ])
  await expect(diff.locator('ins').first()).toBeVisible()
  await expect(diff.locator('del').first()).toBeVisible()
  // Levels 1 to 3, whatever the risk; no answer tests (FR-513).
  await expect(page.getByRole('list', { name: 'Checks' }).getByRole('listitem')).toHaveCount(3)
  await page.getByRole('button', { name: 'Details of Finds the right questions' }).click()
  await expect(page.getByRole('list', { name: 'Test questions', exact: true })).toContainText(
    'Where it applies, on its first day',
  )
  await expect(page.locator('[data-slot="impact-delta"]')).toHaveCount(0)
  await expect(bar(page)).toContainText('Your decision, as owner of Sales')

  // Text mode is in the address.
  await page.getByRole('button', { name: 'Text', exact: true }).click()
  await expect(page).toHaveURL(/compare=text/)
  await expect(page.locator('[data-slot="text-diff"]')).toBeVisible()

  // A key opens the dialog; nothing is decided without a reason.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('a')
  const dialog = page.getByRole('alertdialog', { name: 'Accept this change?' })
  await expect(dialog).toContainText('Agents get it within a minute.')
  await dialog.getByRole('button', { name: 'Accept' }).click()
  await expect(dialog.getByText('Give a reason.')).toBeVisible()
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('The campaign end matches the marketing calendar.')
  await dialog.getByRole('button', { name: 'Accept' }).click()
  await expect(dialog).toBeHidden()
  // One accept publishes it, at high risk too: decided, it reads as a status page.
  await expect(page.getByText(/^(From then on, )?agents get it\.$/).first()).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your decision' })).toHaveCount(0)
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText('You accepted it')
})

test('reads a resubmission as what changed since the request, or whole', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.resubmitted)
  const note = page.locator('[data-slot="request-and-reply"]')
  await expect(note).toContainText('You asked for changes')
  await expect(note).toContainText('Which markets does this cover?')
  await expect(note).toContainText('Alex Moreau replied')
  await expect(note).toContainText('Only Germany.')

  // It opens on what changed since Jon asked: two fields, not the whole proposal.
  await expect(page.getByRole('heading', { name: 'What changed since your request' })).toBeVisible()
  const diff = page.getByRole('table', { name: 'What changed, field by field' })
  await expect(diff.getByRole('columnheader')).toHaveText(['Field', 'At the request', 'Sent again'])
  await expect(diff.getByRole('rowheader')).toHaveText([
    /What happened/,
    /Where it applies/,
    /Where this comes from/,
  ])
  await page.getByRole('button', { name: 'Whole proposal' }).click()
  await expect(page.getByRole('heading', { name: 'What changed', exact: true })).toBeVisible()
  await expect(diff.getByRole('columnheader')).toHaveText(['Field', 'Proposed'])
  await page.getByRole('button', { name: 'Since your request' }).click()
  await expect(diff.getByRole('rowheader')).toHaveCount(3)
})

type ReviewWorld = {
  as: (personId: string) => {
    listReviewQueue: () => { id: string; title: string }[]
    attachProposalTest: (input: { id: string; question: string }) => unknown
  }
}

test('an attached test is reported in the checks rail, does not block, and is detached', async ({
  page,
}) => {
  await openPage(page, '/proposals', desktop)
  await page.waitForFunction(() => 'heedMock' in window)
  await page.evaluate((title) => {
    const jon = (window as unknown as { heedMock: ReviewWorld }).heedMock.as('per_jon')
    const proposal = jon.listReviewQueue().find((row) => row.title === title)
    jon.attachProposalTest({ id: proposal!.id, question: 'orders-united-kingdom-september' })
  }, titles.ready)
  await openReview(page, titles.ready)
  const rail = page.locator('[data-slot="review-companion"]')
  const attached = rail.locator('[data-slot="attached-tests"]')
  await expect(attached.getByRole('heading', { name: 'Attached tests' })).toBeVisible()
  await expect(attached).toContainText('We report them, and they never block a decision.')
  const test = attached.getByRole('listitem')
  await expect(test).toContainText('Why are orders low in the United Kingdom this week?')
  // Level 3 already asked every question of the domain; no answer test runs on a proposal.
  await expect(test).toContainText('It finds the fact, with and without this change.')
  await expect(test).toContainText('No answer tests run on a proposal.')

  // The checks run again with it, and the decision stays open.
  await rail.getByRole('button', { name: 'Run again' }).click()
  await expect(test).toContainText('It finds the fact, with and without this change.')
  await expect(bar(page).getByRole('button', { name: 'Accept' })).toBeEnabled()

  await test
    .getByRole('button', { name: 'Detach Why are orders low in the United Kingdom this week?' })
    .click()
  await expect(attached).toHaveCount(0)
})

test('accepts a low-risk proposal and publishes an edition', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.low)
  await bar(page).getByRole('button', { name: 'Accept' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Accept this proposal?' })
  await dialog
    .getByRole('textbox', { name: 'Why are you accepting it?' })
    .fill('The feed date matches the Sweden wiki.')
  await dialog.getByRole('button', { name: 'Accept' }).click()
  await expect(page.getByText(/^(From then on, )?agents get it\.$/).first()).toBeVisible()
  // Decided, it reads as a status page.
  await expect(page.getByRole('region', { name: 'Your decision' })).toHaveCount(0)
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText('You accepted it')
})

test('asks for changes, and rejects with the source-tool reason', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.overdue)
  await page.keyboard.press('r')
  const ask = page.getByRole('alertdialog', { name: 'Ask Lars Dahl for changes?' })
  await ask
    .getByRole('textbox', { name: 'Why are you asking for changes?' })
    .fill('Please link the tracking outage notice.')
  await ask.getByRole('button', { name: 'Ask for changes' }).click()
  await expect(
    page.getByText("We've told Lars, who can change it and send it again."),
  ).toBeVisible()
  await expect(page.locator('[data-slot="decision-alert"]')).toContainText('You asked for changes')

  await page.goto('/proposals')
  await openReview(page, titles.sandbox)
  await page.getByRole('button', { name: 'Reject with this reason' }).click()
  const reject = page.getByRole('alertdialog', { name: 'Reject this proposal?' })
  await expect(reject.getByRole('textbox', { name: 'Why are you rejecting it?' })).toHaveValue(
    'This changes how a metric is defined, so it belongs in Cube.',
  )
  await expect(reject).toContainText('Filled in from “Reject with this reason”')
  await reject.getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByText("We've told Kofi. Agents won't get it.")).toBeVisible()
})

test('keeps blocked decisions visible and says why', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.claimed)
  await expect(bar(page)).toContainText('Sofia Brandt is reviewing this')
  const accept = bar(page).getByRole('button', { name: /Accept/ })
  await expect(accept).toHaveAttribute('aria-disabled', 'true')
  await accept.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toContainText('Ask Sofia to hand it over, or wait.')
  await page.keyboard.press('Escape')

  await page.goto('/proposals')
  // Jon's own: as Sales's owner he decides it (FR-206), but never changes its review
  // settings, which would lower the bar for his own proposal.
  await openReview(page, titles.proposer)
  await expect(bar(page)).toContainText('You can decide your own proposal.')
  await expect(
    page.locator('[data-slot="owner-edit"]').getByRole('button', { name: 'Change' }),
  ).toHaveAttribute('aria-disabled', 'true')
})

test('an approver reads a high-risk proposal and decides nothing', async ({ page }) => {
  await signInAs(page, 'per_lars')
  // An approver no longer decides, so nothing waits for Lars to review.
  await openPage(page, '/proposals', desktop)
  await expect(
    page
      .getByRole('table', { name: 'Proposals to review' })
      .getByRole('link', { name: titles.highRisk }),
  ).toHaveCount(0)
})

test('the owner raises the risk and the same checks run again', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, 'Units sold lags by two days in Cube')
  await expect(page.getByRole('list', { name: 'Checks' }).getByRole('listitem')).toHaveCount(3)
  await page.locator('[data-slot="owner-edit"]').getByRole('button', { name: 'Change' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Change the review settings' })
  await dialog.getByRole('radio', { name: /High risk/ }).click()
  await expect(dialog.getByRole('list', { name: 'What the change does' })).toContainText(
    'It needs the same three checks and one yes, whatever its risk.',
  )
  await dialog
    .getByRole('textbox', { name: 'Why are you changing them?' })
    .fill('A source lag changes every units sold answer.')
  await dialog.getByRole('button', { name: 'Save and check again' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('list', { name: 'Checks' }).getByRole('listitem')).toHaveCount(3)
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('High risk')
  await page.getByRole('button', { name: /History/ }).click()
  await expect(page.getByRole('list', { name: 'History' })).toContainText(
    'changed the review settings',
  )
  await expect(page.getByRole('list', { name: 'History' })).toContainText('Risk: low to high.')
})

test('the owner sets the day to check again with a date picker', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, 'Units sold lags by two days in Cube')
  await page.locator('[data-slot="owner-edit"]').getByRole('button', { name: 'Change' }).click()
  const dialog = page.getByRole('alertdialog', { name: 'Change the review settings' })
  await expectDatePicker(page, /^Check again by/)
  await expect(dialog).toBeVisible()
})

test('claims and hands over a proposal', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.overdue)
  await page.getByRole('button', { name: 'Claim' }).click()
  await expect(page.getByText('Claimed by you').first()).toBeVisible()
  await page.getByRole('button', { name: 'Hand over' }).click()
  await page.getByRole('menuitem', { name: /Sofia Brandt/ }).click()
  await expect(bar(page)).toContainText('Sofia Brandt is reviewing this')
})

test('moves to the next proposal with j and k', async ({ page }) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.highRisk)
  const heading = page.getByRole('heading', { level: 1 })
  // The keys bind once the screen has registered its scope; pressing again past either end of
  // the queue does nothing, so a retry is safe.
  await expect(async () => {
    await page.keyboard.press('j')
    await expect(heading).toHaveText(titles.ready, { timeout: 1000 })
  }).toPass()
  await expect(async () => {
    await page.keyboard.press('k')
    await expect(heading).toHaveText(titles.highRisk, { timeout: 1000 })
  }).toPass()
})

test('stacks the flat rail under the diff below 1280 wide', async ({ page }) => {
  for (const [width, side] of [
    [1440, true],
    [1280, true],
    [1279, false],
    [1024, false],
  ] as const) {
    await openPage(page, '/proposals', { width, height: 900, theme: 'light' })
    await openReview(page, titles.ready)
    const paper = await page.locator('[data-slot="paper"]').boundingBox()
    const companion = await page.locator('[data-slot="review-companion"]').boundingBox()
    expect(paper && companion, `${width}`).toBeTruthy()
    if (side) expect(companion!.x, `${width}: beside`).toBeGreaterThan(paper!.x + paper!.width)
    else expect(companion!.y, `${width}: below`).toBeGreaterThan(paper!.y + paper!.height)
    await expectFlatRail(page.locator('[data-slot="review-companion"]'), side ? 'left' : 'top')
  }
})

test('on a phone the queue is cards and the review page has one decision button', async ({
  page,
}) => {
  await openPage(page, '/proposals', { ...widths[2], theme: 'light' })
  await expect(page.getByRole('button', { name: /View: To review/ })).toBeVisible()
  await page.getByRole('link', { name: titles.ready }).click()
  await page.locator('[data-slot="dock-panel"]').getByRole('link', { name: 'Open page' }).click()
  await expect(page.getByRole('heading', { level: 1, name: titles.ready })).toBeVisible()
  await expect(page.locator('[data-slot="gate-result"][data-variant="folded"]')).toBeVisible()
  await expect(bar(page).getByRole('button', { name: 'Accept' })).toBeVisible()
  await bar(page).getByRole('button', { name: 'More decisions' }).click()
  await expect(page.getByRole('menuitem')).toHaveText([/Close menu/, /Reject/, /Ask for changes/])
})

for (const theme of themes)
  for (const { name, width, height } of widths)
    test(`the queue and the review screen pass axe at ${name}, ${theme}`, async ({ page }) => {
      for (const path of [
        '/proposals',
        '/proposals/00000000-0000-4000-8000-00000000005a',
        '/proposals/00000000-0000-4000-8000-00000000006a',
      ]) {
        await openPage(page, path, { width, height, theme })
        await page.waitForSelector('[data-slot="review-queue"], [data-slot="decision-bar"]')
        await settle(page)
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(
          results.violations.map(
            (violation) =>
              `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`,
          ),
          path,
        ).toEqual([])
      }
    })

test('discusses a proposal, and asks for changes with a comment for the discussion', async ({
  page,
}) => {
  await openPage(page, '/proposals', desktop)
  await openReview(page, titles.low)
  const discussion = page.getByRole('region', { name: /^Discussion/ })
  await expect(discussion).toContainText('and admins can read this.')
  await discussion.getByRole('textbox', { name: /^Comment for/ }).fill('Which **feed** is it?')
  await discussion.getByRole('button', { name: 'Send comment' }).click()
  const comments = page.getByRole('list', { name: 'Comments' })
  await expect(comments).toContainText('Which feed is it?')
  await expect(comments.locator('strong')).toHaveText('feed')

  await bar(page).getByRole('button', { name: 'Ask for changes' }).click()
  const dialog = page.getByRole('alertdialog', { name: /^Ask .+ for changes\?$/ })
  await dialog
    .getByRole('textbox', { name: 'Why are you asking for changes?' })
    .fill('Name the feed')
  await dialog
    .getByRole('textbox', { name: /Comment for the discussion/ })
    .fill('The clothing feed is called **Oak** in the source tool.')
  await dialog.getByRole('button', { name: 'Ask for changes' }).click()
  await expect(dialog).toBeHidden()
  await expect(comments).toContainText('The clothing feed is called Oak in the source tool.')
  await expect(page.getByText('With the request for changes')).toBeVisible()
})
