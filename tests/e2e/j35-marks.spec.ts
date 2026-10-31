import type { Locator, Page } from '@playwright/test'
import { card, expect, go, onMockOnly, test } from './go.ts'

// J35, marked text: colour that means something, and only that (components/heed/mark.tsx). The
// Inbox marks what a suggestion needs on its row, once; a review's clash says what to do; Ask marks
// the sentences from the items that disagree; Quality marks the words that changed; Related marks
// an item that disagrees; Integrations marks a failed read and a refused key, never a healthy tool.
// A mark is ink, weight and an underline, never a fill.

/** No mark is carried by a fill. */
async function noFills(marks: Locator) {
  for (const mark of await marks.all())
    await expect(mark).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
}

/** Asks in a new chat, by typing, as both modes answer it; waits for the answer's state line. */
async function ask(page: Page, question: string, state: string) {
  await go(page, `/ask?n=${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  await expect(page.getByText(state, { exact: true }).first()).toBeVisible()
}

test('the Inbox marks what a suggestion needs, once on its row, and only on the rows that need it', async ({
  page,
}) => {
  await go(page, '/inbox')
  const rows = page.locator('li[data-row]')
  await expect(rows.first()).toBeVisible()
  const clash = page.locator(`[data-row="${card('sug-sofia-clash')}"]`)
  await expect(clash.locator('mark[data-mark=needs]')).toHaveText('Overlaps live context')
  // The row's triangle is the mark's icon, so the words carry no second one.
  await expect(clash.locator('mark svg')).toHaveCount(0)
  const marked = rows.filter({ has: page.locator('mark') })
  expect(await marked.count()).toBeGreaterThan(0)
  expect(await marked.count()).toBeLessThan(await rows.count())
  for (const row of await marked.all()) await expect(row.locator('mark')).toHaveCount(1)
  await noFills(page.locator('mark'))
  // The quick view says it again, in its own card, with the live item it overlaps.
  await clash.getByRole('button').first().click()
  await expect(page.getByText(/^Overlaps live context: \S/)).toBeVisible()
  const overlaps = page.locator('mark[data-mark=needs]', { hasText: 'Overlaps live context' })
  const onRows = await rows.filter({ has: overlaps }).count()
  await expect(overlaps).toHaveCount(onRows + 1)
})

test("a review's clash says what to do, marked once", async ({ page }) => {
  await go(page, `/inbox/${card('sug-sofia-clash')}/review`)
  const clash = page.locator('mark[data-mark=needs]', { hasText: /^Overlaps live context/ })
  await expect(clash).toBeVisible()
  await expect(clash).toHaveCount(1)
})

test('Ask marks the sentences from the items that disagree, and says what the marks mean', async ({
  page,
}) => {
  await ask(page, 'Do Norway orders include gift-card money?', 'Conflict')
  const log = page.getByRole('log')
  const sentences = log.locator('[aria-pressed]')
  const differ = log.locator('[data-mark=differs]')
  await expect(differ.first()).toBeVisible()
  expect(await differ.count()).toBeLessThan(await sentences.count())
  await expect(differ.first()).toHaveCSS('text-decoration-style', 'solid')
  await expect(differ.first()).toHaveCSS('font-weight', '600')
  await expect(log.getByText(/^The sentences in bold say different things\./)).toBeVisible()
})

test('a grounded answer marks nothing', async ({ page }) => {
  // On the service the answer engine also gives the two items that disagree, so only the demo's
  // hand-written answer is grounded.
  await onMockOnly('a grounded answer of the demo', async () => {
    await go(page, '/ask?example=grounded')
    await expect(page.getByText('Checked', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('log').locator('[aria-pressed]').first()).toBeVisible()
    await expect(page.getByRole('log').locator('[data-mark]')).toHaveCount(0)
  })
})

test('Related marks an item that disagrees with this one', async ({ page }) => {
  await go(page, '/context?dock=context.itm_gift_store_credit')
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  const links = page.getByRole('list', { name: 'Links to' })
  await expect(links.locator('mark[data-mark=needs]')).toHaveText('disagrees with')
  await expect(links.locator('mark[data-mark=needs] svg')).toHaveCount(1)
})

test('Quality marks the words a changed answer has that the saved one did not', async ({
  page,
}) => {
  await go(page, '/observability/quality')
  await onMockOnly('the changed answer of the demo', async () => {
    const changed = page
      .getByRole('listitem')
      .filter({ hasText: 'Why did orders in Norway drop in August?' })
    await expect(changed.locator('mark[data-mark=differs]')).toHaveText([
      '[differs: all]',
      '[differs: so orders there fell to almost nothing]',
    ])
    // A worse answer that is a rewrite marks nothing: there is no clear word to point at.
    const rewritten = page
      .getByRole('listitem')
      .filter({ hasText: 'Why did support contacts in Norway rise in autumn 2025?' })
    await expect(rewritten.locator('mark')).toHaveCount(0)
  })
  await noFills(page.locator('mark'))
})

test('Integrations marks a failed read and a refused key, never a healthy tool', async ({
  page,
}) => {
  await go(page, '/settings/integrations')
  await expect(page.getByRole('heading', { name: 'Connected' })).toBeVisible()
  await expect(page.locator('mark')).toHaveCount(0)
  // A tool's state is read when the page loads, so each one is a fresh visit.
  await onMockOnly('the failed and refused reads of the demo', async () => {
    await page.goto('/settings/integrations?state=failed')
    const failed = page.locator('mark[data-mark=wrong]')
    await expect(failed).toHaveText('Failed')
    await expect(failed.locator('svg')).toHaveCount(1)
    await expect(page.locator('mark')).toHaveCount(1)
    await page.goto('/settings/integrations?state=reauth')
    await expect(page.locator('mark[data-mark=needs]')).toHaveText('Needs a new key')
    await expect(page.locator('mark')).toHaveCount(1)
  })
})
