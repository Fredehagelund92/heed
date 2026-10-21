import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  A draft an agent wrote with the MCP draft tool (FR-121), on the mock: Priya opens the draft
  the app saved for her and sees which fields to check, and Tomas, the owner of Marketing,
  reviews the one she submitted. Nothing on either screen says who wrote a field: the stored
  provenance only decides which fields to check and which flags to show. The demo drafts are
  seeded by `seedDemoAgentDrafts` (src/web/api/mock-demo-proposals.ts).
*/

const DRAFT = '00000000-0000-4000-8000-00000000007c'
const REVIEW = '00000000-0000-4000-8000-00000000007e'
const sizes = widths.filter((size) => size.name === '1440' || size.name === '390')
const desktop = { ...widths[0], theme: 'light' } as const

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}
const row = (page: Page, id: string) => page.locator(`[data-slot="diff-row"][data-row="${id}"]`)
const NO_AUTHORSHIP =
  /agent wrote|Assistant wrote|Suggested by|drafted this|Drafted with|A line marks/

async function axe(page: Page) {
  await settle(page)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target).join(' | ')}`,
  )
}

test('the person is asked to check the fields, and a field they change drops off the list', async ({
  page,
}) => {
  await signInAs(page, 'per_priya')
  await openPage(page, `/library/new?draft=${DRAFT}`, desktop)
  const notice = page.locator('[data-slot="provenance-notice"]')
  await expect(notice).toContainText('Check this draft before you send it')
  await expect(notice).toContainText('Nobody else sees it until you send it.')
  await expect(notice).toContainText('Check the kind, title, summary and where it applies.')
  // Nothing says who wrote a field: no glyph beside a name, no line beside a value, no switch.
  await expect(notice).not.toContainText(NO_AUTHORSHIP)
  await expect(page.locator('[data-slot="provenance-mark"]')).toHaveCount(0)
  await expect(page.locator('.ai-mark')).toHaveCount(0)
  await expect(page.getByRole('switch')).toHaveCount(0)
  await expect(page.getByText(NO_AUTHORSHIP)).toHaveCount(0)

  // The person writes their own words: once saved, the field is theirs and leaves the list.
  await page.locator('#context-title').fill('Discount cost in France arrives late')
  await expect(page.getByText('Saved', { exact: false }).first()).toBeVisible()
  await expect(notice).toContainText('Check the kind, summary and where it applies.')
})

test('the owner reads the proposal with its flags, and nothing that says who wrote a field', async ({
  page,
}) => {
  await signInAs(page, 'per_tomas')
  await openPage(page, `/proposals/${REVIEW}`, desktop)
  await expect(page.locator('[data-slot="person-chip"][data-role="proposer"]')).toHaveText(
    'Proposed by Priya Nair, 7 Oct 2026',
  )
  await expect(page.locator('[data-slot="review-provenance"]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^How it was drafted/ })).toHaveCount(0)
  await expect(page.locator('[data-slot="provenance-mark"]')).toHaveCount(0)
  await expect(page.locator('.ai-mark')).toHaveCount(0)
  await expect(page.locator('[data-slot="agent-mark"]')).toHaveCount(0)
  await expect(page.getByText(NO_AUTHORSHIP)).toHaveCount(0)
  // A new item's diff leaves out what the proposer left empty, and names it under the rows (#219).
  // The stored default of what not to conclude is no line of the proposer's own (FR-104).
  await expect(row(page, 'replaces')).toHaveCount(0)
  await expect(row(page, 'notToConclude')).toHaveCount(0)
  await expect(
    page.getByText('Not filled in: what not to conclude, replaces, conflicts with'),
  ).toBeVisible()
  // A flag asks for a look, so it keeps its soft badge under the value.
  const risk = row(page, 'risk')
  await expect(risk.locator('[data-flag="may_be_high_risk"]')).toContainText('May be high risk')
  await expect(risk.locator('[data-flag="may_be_high_risk"]')).toContainText('"regulator"')
  await expect(risk).toContainText('Normal risk')
  // An open-ended validity fades out instead of drawing a solid bar.
  await expect(row(page, 'validity').locator('[data-slot="range-bar"]')).toHaveAttribute(
    'data-open',
    'true',
  )
})

test('the proposer sees the same on the status page, and the draft lists show no mark', async ({
  page,
}) => {
  await signInAs(page, 'per_priya')
  await openPage(page, `/proposals/${REVIEW}`, desktop)
  await expect(page.locator('[data-slot="person-chip"][data-role="proposer"]')).toHaveText(
    'Proposed by you, 7 Oct 2026',
  )
  await page.getByRole('tab', { name: 'Fields' }).click()
  await expect(
    page.locator('[data-slot="field-row"]', { hasText: 'Where it applies' }),
  ).toBeVisible()
  await expect(page.locator('[data-slot="provenance-mark"]')).toHaveCount(0)
  await expect(page.locator('.ai-mark')).toHaveCount(0)
  await expect(page.getByText(NO_AUTHORSHIP)).toHaveCount(0)

  await openPage(page, '/', desktop)
  await expect(
    page.locator('[data-slot="home-draft"]', { hasText: 'Discount cost in France' }),
  ).toBeVisible()
  await expect(page.locator('[data-slot="drafted-mark"]')).toHaveCount(0)
  await openPage(page, '/proposals?view=mine', desktop)
  await expect(page.locator('[data-row-id]', { hasText: 'Discount cost in France' })).toBeVisible()
  await expect(page.locator('[data-slot="drafted-mark"]')).toHaveCount(0)
})

test("the owner's queue shows the proposer as one plain avatar", async ({ page }) => {
  await signInAs(page, 'per_tomas')
  const queueRow = () =>
    page.locator('[data-row-id]', { hasText: 'The regulator paused price promotions in Norway' })
  await openPage(page, '/proposals', { width: 1920, height: 1080, theme: 'light' })
  const owner = queueRow().locator('[data-slot="owner"]')
  await expect(owner).toContainText('Priya Nair')
  await expect(owner.locator('[data-slot="avatar"]')).toHaveCount(1)
  await expect(owner.locator('[data-slot="agent-mark"]')).toHaveCount(0)
  await expect(queueRow().locator('[data-slot="drafted-mark"]')).toHaveCount(0)
})

for (const theme of themes)
  for (const { name, width, height } of sizes) {
    test(`the agent's draft passes axe at ${name}, ${theme}`, async ({ page }) => {
      await signInAs(page, 'per_priya')
      await openPage(page, `/library/new?draft=${DRAFT}`, { width, height, theme })
      await expect(page.locator('[data-slot="provenance-notice"]')).toBeVisible()
      expect(await axe(page)).toEqual([])
    })
    test(`its review passes axe at ${name}, ${theme}`, async ({ page }) => {
      await signInAs(page, 'per_tomas')
      await openPage(page, `/proposals/${REVIEW}`, { width, height, theme })
      await expect(row(page, 'risk').locator('[data-flag]')).toBeVisible()
      // Every flag has room under its value, at 1440 and at 390.
      const overflow = await page
        .locator('[data-slot="row-provenance"], [role="rowheader"]')
        .evaluateAll(
          (cells) =>
            cells.filter((cell) => cell.scrollWidth > cell.parentElement!.clientWidth).length,
        )
      expect(overflow).toBe(0)
      expect(await axe(page)).toEqual([])
    })
    test(`its status page passes axe at ${name}, ${theme}`, async ({ page }) => {
      await signInAs(page, 'per_priya')
      await openPage(page, `/proposals/${REVIEW}?tab=fields`, { width, height, theme })
      await expect(page.locator('[data-slot="field-row"]').first()).toBeVisible()
      expect(await axe(page)).toEqual([])
    })
  }
