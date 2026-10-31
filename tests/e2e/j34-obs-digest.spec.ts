import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, onMockOnly, signInAs, test } from './go.ts'

// J34: Summary's monthly snapshots and the digest. Each whole month's Summary is kept as it was on
// the day it was taken, for good, as counts and the sentences said over them. Summary lists them,
// the latest month first, and one opens as a digest: a page to pass on, printed or saved as a PDF
// with the browser's own dialog, on one A4 sheet without menus or controls, readable in black and
// white. The demo's job took August on 1 September and September on 1 October.

const snapshots = (page: Page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'Monthly snapshots' }) })

async function openSeptember(page: Page) {
  await go(page, '/observability/summary')
  await snapshots(page).getByRole('link', { name: 'September 2026' }).click()
  await expect(page).toHaveURL(/\/observability\/summary\/[\w-]+$/)
  await expect(page.getByRole('heading', { name: 'Summary, September 2026' })).toBeVisible()
}

test('Summary lists its monthly snapshots, the latest month first', async ({ page }) => {
  await go(page, '/observability/summary')
  const list = snapshots(page)
  await expect(list).toContainText('counts and sentences only')
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await expect(list.getByRole('listitem').nth(0)).toContainText('September 2026')
  await expect(list.getByRole('listitem').nth(0)).toContainText('Taken on 1 Oct 2026')
  await expect(list.getByRole('listitem').nth(1)).toContainText('August 2026')
  await expect(list.getByRole('listitem').nth(1)).toContainText('Taken on 1 Sep 2026')
  // September is kept already, so there is nothing to take.
  await expect(page.getByRole('button', { name: /^Take .* now$/ })).toHaveCount(0)
})

test('a snapshot opens as a digest: the month as it was, counts and sentences only', async ({
  page,
}) => {
  await openSeptember(page)
  const main = page.getByRole('main')
  await expect(
    page.getByText(/^All domains · 1 Sep 2026 to 30 Sep 2026\. A snapshot taken on 1 Oct 2026/),
  ).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toContainText(
    'September 2026 snapshot',
  )
  // The numbers as the Summary showed them, and the sentences said over them then.
  await expect(main).toContainText('Questions asked532')
  await expect(main).toContainText('335 of 532 questions')
  await expect(main).toContainText(
    'Agents asked 532 questions in September 2026, about the same as in August 2026 (483).',
  )
  await expect(main).toContainText('as they were said on 1 Oct 2026')
  const caught = page.locator('section', {
    has: page.getByRole('heading', { name: 'What we caught' }),
  })
  // The three lines as they were said: the saved questions' one change is under 5.
  await expect(caught).toContainText(
    'Fewer than 5 times, a saved question gave a different answer after a change.',
  )
  await expect(caught).toContainText('No alert asked an owner for a decision.')
  await expect(caught.getByText(/^Not measured yet\./)).toHaveCount(0)
  // What is open and what changed are kept as counts: no topic, no item, nobody who approved.
  const open = page.locator('section', { has: page.getByRole('heading', { name: 'Still open' }) })
  await expect(open).toContainText('A snapshot keeps the count, not the topics')
  await expect(open.getByRole('link')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'What changed', exact: true })).toBeVisible()
  await expect(main).toContainText(
    'A snapshot keeps the counts, not the items or who approved them.',
  )
  await expect(main).not.toContainText(/approved by (?!an owner)/)
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeVisible()
  // Not the live page: no period to pick, no domain to change.
  await expect(page.getByRole('radio', { name: 'Last month' })).toHaveCount(0)
})

test('the digest prints on one A4 sheet, in black and white, light in any theme', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Only Chromium saves a page as PDF')
  await page.emulateMedia({ colorScheme: 'dark' })
  await openSeptember(page)
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  // On paper: no menus, no header, no buttons; the sheet alone.
  await expect(page.locator('[data-sidebar=sidebar]').first()).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Print or save as PDF' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'What Checked answers counts' })).toBeHidden()
  // Dark ink on light paper, whatever the theme on screen.
  for (const text of [
    page.getByRole('heading', { name: 'Summary, September 2026' }),
    page.getByText(/^Agents asked 532 questions/),
  ]) {
    const ink = await text.evaluate((h) => getComputedStyle(h).color)
    const lightness = Number(/oklch\(([\d.]+)/.exec(ink)?.[1] ?? /rgb\((\d+)/.exec(ink)?.[1])
    expect(lightness < (ink.startsWith('oklch') ? 0.5 : 128), `ink ${ink}`).toBe(true)
  }
  // Each part of the sheet stays whole: a page break never cuts one in two.
  const breaks = await page
    .locator('[data-print=sheet] section')
    .evaluateAll((sections) => sections.map((s) => getComputedStyle(s).breakInside))
  expect(breaks.length).toBeGreaterThan(0)
  for (const b of breaks) expect(b).toBe('avoid')
  // Printed in shades of grey, it is the same one page.
  await page.addStyleTag({ content: 'html { filter: grayscale(1) }' })
  const pdf = (await page.pdf({ format: 'A4', preferCSSPageSize: true })).toString('latin1')
  expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1)
})

test("an owner sees their own domain's snapshots", async ({ page }) => {
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/observability/summary')
  const list = snapshots(page)
  await expect(list.getByRole('listitem')).toHaveCount(2)
  await list.getByRole('link', { name: 'September 2026, Marketing' }).click()
  await expect(page.getByText(/^Marketing · 1 Sep 2026 to 30 Sep 2026\./)).toBeVisible()
})

test('a snapshot that is not there says so', async ({ page }) => {
  await go(page, '/observability/summary/0b6e3c3e-5d8f-4f0c-9a51-7b0d7a3a9f10')
  await expect(page.getByText('No snapshot here')).toBeVisible()
})

test("an admin takes last month's snapshot when the job has not yet", async ({ page }) => {
  await onMockOnly('a review flag for a month the job has not taken', async () => {
    await go(page, '/observability/summary?snapshot=due')
    const list = snapshots(page)
    await expect(list.getByRole('listitem')).toHaveCount(1)
    await page.getByRole('button', { name: 'Take September 2026 now' }).click()
    await expect(page.getByText('Snapshot of September 2026 taken')).toBeVisible()
    await expect(list.getByRole('listitem')).toHaveCount(2)
    await expect(list.getByRole('listitem').first()).toContainText('September 2026')
    await expect(page.getByRole('button', { name: 'Take September 2026 now' })).toHaveCount(0)
  })
})

test('axe finds nothing on the digest, wide and narrow, light and dark', async ({ page }) => {
  await openSeptember(page)
  const digest = page.url()
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const)
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: theme })
      await go(page, `${new URL(digest).pathname}?theme=${theme}`)
      await expect(page.getByRole('heading', { name: 'Summary, September 2026' })).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await page.waitForFunction(() =>
        document.getAnimations().every((a) => a.playState !== 'running'),
      )
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(
        results.violations.map(
          (v) => `${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
        ),
        `${width}, ${theme}`,
      ).toEqual([])
    }
})
