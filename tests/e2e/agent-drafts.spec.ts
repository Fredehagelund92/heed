import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  A draft an AI app wrote with the MCP draft tool (FR-121), on the mock: Priya opens the draft
  the app saved for her and sees which fields to check, and Tomas, the owner of Marketing,
  reviews the one she submitted with where each field came from: one attribution line, a muted
  glyph per field and a switch that highlights what the app wrote (contract 6.13). The demo drafts are seeded by
  `seedDemoAgentDrafts` (src/web/api/mock-demo-proposals.ts). Her AI app asked her about the
  dates and the source of both, so those fields are marked confirmed.
*/

const DRAFT = '00000000-0000-4000-8000-00000000007c'
const REVIEW = '00000000-0000-4000-8000-00000000007e'
const sizes = widths.filter((size) => size.name === '1440' || size.name === '390')
const desktop = { ...widths[0], theme: 'light' } as const

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}
const section = (page: Page, name: string) =>
  page.locator('[data-slot="rail-section"]').filter({ has: page.getByRole('heading', { name }) })
const row = (page: Page, id: string) => page.locator(`[data-slot="diff-row"][data-row="${id}"]`)

async function axe(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`,
  )
}

test('the person sees what the agent suggested, and a field they change loses its mark', async ({
  page,
}) => {
  await signInAs(page, 'per_priya')
  await openPage(page, `/library/new?draft=${DRAFT}`, desktop)
  const notice = page.locator('[data-slot="provenance-notice"]')
  await expect(notice).toContainText('An AI app drafted this for you')
  await expect(notice).toContainText('Nobody else sees it until you send it.')
  await expect(notice).toContainText(
    'Check the kind, title, summary and where it applies. The AI app suggested them.',
  )
  await expect(notice).toContainText(
    'You confirmed these in your AI app: when it applies and where it comes from.',
  )
  await expect(notice).toContainText('We worked out the domain, owner and check date.')
  // Each field carries a glyph, not a badge: its name and meaning are its accessible name.
  const suggested = section(page, 'Where it applies').locator('[data-mark="prefilled"]')
  await expect(suggested).toHaveAttribute(
    'aria-label',
    'Suggested: Suggested by an AI app. Check it before you send it.',
  )
  await expect(suggested).toHaveText('')
  // What she answered in her AI app is hers, and says so.
  for (const name of ['When it applies', 'Where this comes from'])
    await expect(section(page, name).locator('[data-mark="confirmed"]')).toHaveAttribute(
      'aria-label',
      'Confirmed: You answered this in your AI app, when it asked.',
    )
  await expect(section(page, 'Who reviews it').locator('[data-mark="derived"]')).toHaveAttribute(
    'aria-label',
    /^Derived: /,
  )
  const caveat = section(page, 'What not to conclude')
  await expect(caveat.locator('[data-mark="default"]')).toBeVisible()
  // What the app suggested carries the line, always; what she answered does not.
  await expect(notice).toContainText('A line marks each one until you change it.')
  await expect(section(page, 'Where it applies')).toHaveClass(/\bai-mark\b/)
  await expect(page.locator('#context-title').locator('xpath=..')).toHaveClass(/\bai-mark\b/)
  await expect(section(page, 'When it applies')).not.toHaveClass(/\bai-mark\b/)
  await expect(page.getByRole('switch')).toHaveCount(0)

  // Focus on a glyph shows where the value came from, as hover does.
  await suggested.focus()
  await expect(page.locator('[data-slot="tooltip-content"]')).toContainText(
    'Suggested. Suggested by an AI app. Check it before you send it.',
  )

  // The person writes their own words: once saved, the field is theirs and its mark goes.
  await page.locator('#context-notToConclude').fill('It does not mean discounts were lower.')
  await expect(page.getByText('Saved', { exact: false }).first()).toBeVisible()
  await expect(caveat.locator('[data-slot="provenance-mark"]')).toHaveCount(0)
  await expect(section(page, 'Where it applies').locator('[data-mark="prefilled"]')).toBeVisible()
})

test('the owner reads one attribution line and a glyph per field, and a flag that never changes the risk', async ({
  page,
}) => {
  await signInAs(page, 'per_tomas')
  await openPage(page, `/proposals/${REVIEW}`, desktop)
  // The proposer is the author; the AI app is how, in the header chip and in the summary line.
  await expect(page.locator('[data-slot="person-chip"][data-role="proposer"]')).toHaveText(
    'Proposed by Priya Nair with an AI app, 7 Oct 2026',
  )
  const summary = page.locator('[data-slot="review-provenance"]')
  await expect(summary).toContainText('Priya Nair drafted this with an AI app and sent it.')
  // How many fields each hand wrote is said once, in the step trail under the people.
  await expect(summary).not.toContainText('The AI app wrote')
  const trail = page.getByRole('button', { name: /^How it was drafted: Drafted with an AI app/ })
  await trail.click()
  await expect(page.getByRole('list', { name: 'How it was drafted' })).toContainText(
    'Priya confirmed 2 fields when the AI app asked',
  )
  await expect(summary.locator('[data-slot="ai-app-mark"]')).toBeVisible()
  // No badge per field: one muted glyph in the field's name cell.
  await expect(
    page.locator('[data-slot="field-diff"] [data-slot="badge"]', {
      hasText: /wrote|Confirmed|Derived|Default/,
    }),
  ).toHaveCount(0)
  const name = (id: string) => row(page, id).getByRole('rowheader')
  await expect(name('summary').locator('[data-mark="prefilled"]')).toHaveAttribute(
    'aria-label',
    'AI app wrote: Written by an AI app for the proposer, who sent it.',
  )
  await expect(name('domain').locator('[data-mark="derived"]')).toBeVisible()
  for (const id of ['validity', 'evidence'])
    await expect(name(id).locator('[data-mark="confirmed"]')).toHaveAttribute(
      'aria-label',
      'Confirmed: Confirmed by the proposer in their AI app, when it asked.',
    )
  await expect(name('owner').locator('[data-mark="derived"]')).toBeVisible()
  // A new item's diff leaves out what the proposer left empty, and names it under the rows (#219).
  // The stored default of what not to conclude is no line of the proposer's own (FR-104).
  await expect(row(page, 'replaces')).toHaveCount(0)
  await expect(row(page, 'notToConclude')).toHaveCount(0)
  await expect(
    page.getByText('Not filled in: what not to conclude, replaces, conflicts with'),
  ).toBeVisible()
  // A flag asks for a look, so it keeps its soft badge under the value.
  const risk = row(page, 'risk')
  await expect(name('risk').locator('[data-mark="default"]')).toBeVisible()
  await expect(risk.locator('[data-flag="may_be_high_risk"]')).toContainText('May be high risk')
  await expect(risk.locator('[data-flag="may_be_high_risk"]')).toContainText('"regulator"')
  await expect(risk).toContainText('Normal risk')
  // An open-ended validity fades out instead of drawing a solid bar.
  await expect(row(page, 'validity').locator('[data-slot="range-bar"]')).toHaveAttribute(
    'data-open',
    'true',
  )

  // A line marks what the AI app wrote, and only that: always shown, with no switch and no tint.
  await expect(page.getByRole('switch')).toHaveCount(0)
  await expect(page.locator('[data-slot="ai-mark-legend"]')).toHaveText(
    'A line marks what the app wrote',
  )
  await expect(page.locator('[data-slot="diff-row"][data-wrote]')).toHaveCount(3)
  const line = (id: string) =>
    row(page, id).evaluate((node) => getComputedStyle(node, '::before').borderInlineStartWidth)
  expect(await line('summary')).toBe('2px')
  expect(await line('domain')).not.toBe('2px')
  const fill = (id: string) =>
    row(page, id)
      .getByRole('cell')
      .last()
      .evaluate((cell) => getComputedStyle(cell).backgroundColor)
  expect(await fill('summary')).toBe(await fill('domain'))
})

test('the proposer sees the same attribution on the status page, and the draft lists mark the drafts', async ({
  page,
}) => {
  await signInAs(page, 'per_priya')
  await openPage(page, `/proposals/${REVIEW}`, desktop)
  await expect(page.locator('[data-slot="person-chip"][data-role="proposer"]')).toHaveText(
    'Proposed by you with an AI app, 7 Oct 2026',
  )
  await page.getByRole('tab', { name: 'Fields' }).click()
  await expect(page.locator('[data-slot="review-provenance"]')).toContainText(
    'You drafted this with an AI app and sent it. The AI app wrote 3 fields, you confirmed 2 when it asked and 3 were filled in automatically.',
  )
  await expect(
    page
      .locator('[data-slot="field-row"]', { hasText: 'Where it applies' })
      .locator('[data-mark="prefilled"]'),
  ).toHaveAttribute('aria-label', /^AI app wrote: /)
  await expect(page.locator('[data-slot="field-row"].ai-mark')).toHaveCount(3)
  await expect(page.locator('[data-slot="ai-mark-legend"]')).toHaveText(
    'A line marks what the app wrote',
  )

  await openPage(page, '/', desktop)
  await expect(
    page
      .locator('[data-slot="home-draft"]', { hasText: 'Discount cost in France' })
      .locator('[data-slot="drafted-mark"]'),
  ).toHaveAttribute('title', 'Drafted with an AI app')
  await openPage(page, '/proposals?view=mine', desktop)
  await expect(
    page
      .locator('[data-row-id]', { hasText: 'Discount cost in France' })
      .locator('[data-slot="drafted-mark"]'),
  ).toBeVisible()
})

test("the owner's queue marks the proposer's avatar, never an avatar of the app", async ({
  page,
}) => {
  await signInAs(page, 'per_tomas')
  const queueRow = () =>
    page.locator('[data-row-id]', { hasText: 'The regulator paused price promotions in Norway' })
  // Where the Proposed by column gives way, the row's status carries the quiet mark.
  await openPage(page, '/proposals', desktop)
  await expect(queueRow().locator('[data-slot="drafted-mark"]')).toHaveAttribute(
    'title',
    'Drafted with an AI app',
  )
  // Where it shows, the mark sits on the proposer's avatar instead, and only there.
  await openPage(page, '/proposals', { width: 1920, height: 1080, theme: 'light' })
  const owner = queueRow().locator('[data-slot="owner"]')
  await expect(owner).toHaveAttribute('data-drafted', 'agent')
  await expect(owner).toHaveAttribute('title', 'Priya Nair with an AI app')
  await expect(owner.locator('[data-slot="avatar"]')).toHaveCount(1)
  await expect(owner.locator('[data-slot="ai-app-mark"]')).toBeVisible()
  await expect(queueRow().locator('[data-slot="drafted-mark"]')).toHaveCount(0)
})

for (const theme of themes)
  for (const { name, width, height } of sizes) {
    test(`the agent's draft passes axe at ${name}, ${theme}`, async ({ page }) => {
      await signInAs(page, 'per_priya')
      await openPage(page, `/library/new?draft=${DRAFT}`, { width, height, theme })
      await expect(page.locator('[data-slot="provenance-notice"]')).toBeVisible()
      await expect(page.locator('[data-slot="provenance-mark"]').first()).toBeAttached()
      expect(await axe(page)).toEqual([])
    })
    test(`its review passes axe at ${name}, ${theme}, with its lines`, async ({ page }) => {
      await signInAs(page, 'per_tomas')
      await openPage(page, `/proposals/${REVIEW}`, { width, height, theme })
      await expect(page.locator('[data-slot="provenance-mark"]').first()).toBeVisible()
      // Every flag has room under its value, and every glyph beside its name, at 1440 and at 390.
      const overflow = await page
        .locator('[data-slot="row-provenance"], [role="rowheader"]')
        .evaluateAll(
          (cells) =>
            cells.filter((cell) => cell.scrollWidth > cell.parentElement!.clientWidth).length,
        )
      expect(overflow).toBe(0)
      await expect(page.locator('[data-slot="diff-row"].ai-mark').first()).toBeVisible()
      expect(await axe(page)).toEqual([])
    })
    test(`its status page passes axe at ${name}, ${theme}`, async ({ page }) => {
      await signInAs(page, 'per_priya')
      await openPage(page, `/proposals/${REVIEW}?tab=fields`, { width, height, theme })
      await expect(page.locator('[data-slot="review-provenance"]')).toBeVisible()
      expect(await axe(page)).toEqual([])
    })
  }
