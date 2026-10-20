import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { ASK_DRAFT, chipEditor } from './ask-support'
import { openPage, settle, themes, widths, type Theme } from './support'

/*
  A draft the assistant writes, as the person confirms it (the captain's report: the card showed
  only the title, so the draft could not be reviewed before saving). The card shows every field
  read only, with where each came from, the dates flagged when the person was unsure of them and
  the evidence with its page; nothing is saved until Create draft, and then it links to the draft
  in the form. In the docked panel at its width (480) and narrower (400), light and dark, with
  motion reduced and not. The answers come from the mock binding's scripted assistant.
*/

const desktop = { ...widths[0], theme: 'light' } as const
const launcher = (page: Page) => page.getByRole('button', { name: 'Assistant', exact: true })
const panel = (page: Page) => page.getByRole('region', { name: 'Assistant' })
const card = (page: Page) => page.getByRole('region', { name: /^New draft: / })
const field = (page: Page, name: string) =>
  card(page).locator(`[data-slot="ask-draft-field"][data-field="${name}"]`)

/** A long text: the summary keeps whole sentences up to its limit, the rest is the detail. */
const LONG = `Draft this: Average order value in the United Kingdom was restated on 3 September 2026 after a late payment file. ${'The file carried a full week of card payments that the warehouse had not loaded, so every daily figure from 27 August to 2 September moved. '.repeat(3)}Finance signed the restatement off on 4 September 2026.`

async function openAsk(
  page: Page,
  { theme = 'light', dock }: { theme?: Theme; dock?: 400 | 480 } = {},
) {
  await openPage(page, '/', { ...desktop, theme })
  // The panel is 480 wide; a person can narrow it to 320, so 400 is checked too.
  if (dock === 400) await page.addStyleTag({ content: ':root { --dock-width: 25rem; }' })
  await launcher(page).click()
  await expect(panel(page).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 15_000 },
  )
  await chipEditor(page)
}

async function ask(page: Page, words: string) {
  const box = page.getByRole('textbox', { name: 'Your question' }).filter({ visible: true })
  await box.fill(words)
  await box.press('Enter')
  await expect(card(page)).toBeVisible({ timeout: 15_000 })
  await settle(page)
}

test('the card shows the draft to review, saves nothing until Create draft, then links to it', async ({
  page,
}) => {
  await openAsk(page)
  await ask(page, ASK_DRAFT)
  await expect(card(page)).toHaveAttribute('data-state', 'asking')
  // A card about the item the draft would be: its kind, its title and where it stands.
  await expect(card(page)).toHaveAccessibleName(
    'New draft: A new rule gives Netherlands customers 14 days to send back online orders, so average order value in the Netherlands may fall',
  )
  const meta = card(page).locator('[data-slot="change-card-meta"]')
  await expect(meta.getByText('Draft', { exact: true })).toBeVisible()
  await expect(meta).toContainText('New fact · not saved yet')
  // What came from the person, what the assistant filled in, what it left: from the marks.
  await expect(card(page).locator('[data-slot="ask-draft-written"]')).toHaveText(
    'From your words: what happened and where it applies. The assistant filled in when, where it comes from and domain.',
  )
  // What happened, in the person's words, with its length against the limit.
  await expect(field(page, 'summary')).toContainText(
    'A new rule gives Netherlands customers 14 days to send back online orders, so average order value in the Netherlands may fall.',
  )
  await expect(field(page, 'summary')).toContainText('of 280 characters')
  await expect(field(page, 'summary').locator('[data-source="person"]')).toHaveText(/Your words/)
  // Where it applies, by name, never a key.
  await expect(field(page, 'scope')).toContainText('Average order value')
  await expect(field(page, 'scope')).toContainText('Market: Netherlands')
  await expect(card(page)).not.toContainText(/metric:|val:|dim:/)
  // The person was unsure of the date: drafted anyway, flagged, and the answer says what it took.
  await expect(field(page, 'validity').locator('[data-slot="ask-draft-uncertain"]')).toHaveText(
    'Uncertain',
  )
  await expect(field(page, 'validity').locator('[data-source="suggested"]')).toBeVisible()
  await expect(page.getByRole('article', { name: 'Answer' })).toContainText(
    'marked the dates as uncertain',
  )
  // The evidence: the page it read, the one sentence and the day.
  await expect(
    field(page, 'evidence').getByRole('link', { name: /consumer\.example/ }),
  ).toHaveAttribute('href', 'https://consumer.example/eu/right-of-withdrawal')
  await expect(field(page, 'evidence')).toContainText(
    'Consumers have 14 days to withdraw from an online purchase without giving any reason.',
  )
  await expect(field(page, 'evidence')).toContainText(/Read \d{1,2} \w{3} \d{4}/)
  await expect(field(page, 'evidence').locator('[data-source="page"]')).toHaveText(
    /From consumer\.example/,
  )
  await expect(card(page).locator('[data-slot="ask-draft-web"]')).toContainText(
    'The owner of its domain checks it before AI apps get it.',
  )
  await expect(field(page, 'areaId')).not.toContainText('Not given')
  // A line marks what the assistant wrote, never the person's own words: always, with no switch.
  await expect(card(page).getByRole('switch')).toHaveCount(0)
  await expect(card(page).locator('[data-slot="ai-mark-legend"]')).toHaveText(
    'A line marks what the assistant wrote',
  )
  await expect(field(page, 'validity')).toHaveAttribute('data-wrote')
  await expect(field(page, 'validity')).toHaveClass(/\bai-mark\b/)
  await expect(field(page, 'validity').locator('[data-source="suggested"]')).toHaveText(
    /Assistant wrote/,
  )
  await expect(field(page, 'summary')).not.toHaveAttribute('data-wrote')
  // What it does not mean folds under More.
  await card(page)
    .getByText(/^More:/)
    .click()
  await expect(field(page, 'notToConclude')).toContainText('every online order is sent back')
  // Nothing opened and nothing saved yet.
  await expect(page).toHaveURL(/\/$/)
  await expect(card(page).getByRole('link', { name: /Open draft/ })).toHaveCount(0)

  await card(page).getByRole('button', { name: 'Create draft' }).click()
  await expect(card(page)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 })
  await expect(card(page).getByRole('status')).toHaveText(/^Saved as your draft #\d+$/)
  await expect(card(page).locator('[data-slot="change-card-meta"]')).toContainText(
    'only you can see it',
  )
  // Nothing left to highlight once the fields fold away.
  await expect(card(page).getByRole('switch')).toHaveCount(0)
  await expect(card(page).getByRole('button', { name: 'Create draft' })).toHaveCount(0)
  // A short answer stays whole: the saved sentence does not fold it.
  await expect(page.getByRole('button', { name: 'Show the rest of the answer' })).toHaveCount(0)
  // The fields fold away once saved, and are still there to read.
  await expect(field(page, 'summary')).toBeHidden()
  await card(page).getByText('What was saved').click()
  await expect(field(page, 'summary')).toBeVisible()
  const open = card(page).getByRole('link', { name: /^Open draft #\d+$/ })
  await expect(open).toHaveAttribute('href', /^\/library\/new\?draft=/)
  await open.click()
  await expect(page).toHaveURL(/\/library\/new\?draft=/)
  await expect(page.getByRole('main')).toContainText(
    'A new rule gives Netherlands customers 14 days to send back online orders',
  )
})

test('Not now saves nothing, and the card goes', async ({ page }) => {
  await openAsk(page)
  await ask(page, ASK_DRAFT)
  await card(page).getByRole('button', { name: 'Not now' }).click()
  await expect(card(page)).toHaveCount(0)
  await expect(page.getByRole('article', { name: 'Answer' })).toContainText(
    "Okay, I didn't save it.",
  )
})

test('a long text keeps a short summary and puts the rest in the detail', async ({ page }) => {
  await openAsk(page)
  await ask(page, LONG)
  const count = await field(page, 'summary').locator('[data-slot="ask-draft-count"]').innerText()
  expect(Number(/^(\d+) of 280/.exec(count)?.[1])).toBeLessThanOrEqual(280)
  // A date the person gave is theirs, and not flagged.
  await expect(field(page, 'validity').locator('[data-slot="ask-draft-uncertain"]')).toHaveCount(0)
  await card(page)
    .getByText(/^More:/)
    .click()
  await expect(field(page, 'body')).toContainText('Finance signed the restatement off')
})

/** Where to keep a picture of each card to look at, when set; nothing is kept otherwise. */
const shots = process.env.DRAFT_CARD_SHOTS
for (const dock of [480, 400] as const)
  for (const theme of themes)
    test(`at a ${dock} panel in ${theme}, the card fits, reads and passes axe`, async ({
      page,
    }) => {
      await openAsk(page, { theme, dock })
      await ask(page, ASK_DRAFT)
      const box = await card(page).boundingBox()
      const frame = await panel(page).boundingBox()
      expect(box!.width).toBeLessThanOrEqual(frame!.width)
      // Nothing in the card is wider than it: no sideways scroll at the panel's width.
      expect(await card(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(
        true,
      )
      // The lines beside what the assistant wrote stay inside the card's padding.
      const lines = await card(page)
        .locator('[data-wrote]')
        .evaluateAll((fields) =>
          fields.map((field) => {
            const own = field.getBoundingClientRect()
            const start = parseFloat(getComputedStyle(field, '::before').insetInlineStart)
            return own.left + start
          }),
        )
      for (const left of lines) expect(left).toBeGreaterThan(box!.x)
      if (shots) await card(page).screenshot({ path: `${shots}/card-${dock}-${theme}.png` })
      const results = await new AxeBuilder({ page })
        .include('[data-slot="ask-confirm-draft"]')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((v) => v.id)).toEqual([])
    })

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' })
  test('the saved card settles in and holds still', async ({ page }) => {
    await openAsk(page)
    await ask(page, ASK_DRAFT)
    await card(page).getByRole('button', { name: 'Create draft' }).click()
    await expect(card(page)).toHaveAttribute('data-state', 'saved', { timeout: 15_000 })
    await settle(page)
    await expect(card(page).getByRole('link', { name: /^Open draft #\d+$/ })).toBeVisible()
  })
})
