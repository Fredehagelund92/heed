import AxeBuilder from '@axe-core/playwright'
import { expect, go, onMockOnly, signInAs, test } from './go.ts'

// J32: Observability's Summary, the page to pass on. It comes first in Observability's menu and
// sums up the last whole calendar month or quarter, not a rolling range: four numbers, each with
// what it counts a click away; plain sentences from fixed templates; what was caught, as separate
// lines; the weekly trend of checked answers; what is still open; and what changed, with who
// approved it. It prints on one A4 sheet. The demo's today is 23 October 2026, so last month is
// September and last quarter July to September.

test('Summary comes first in Observability and sums up last month', async ({ page }) => {
  await go(page, '/observability')
  const sidebar = page.locator('[data-sidebar=sidebar]').first()
  // The first page after the way back to the app.
  await expect(sidebar.locator('[data-slot=sidebar-menu-button]').nth(1)).toHaveText('Summary')
  await expect(sidebar.getByRole('link', { name: 'Summary' })).toHaveAttribute('data-active')
  await expect(page.getByRole('heading', { name: 'Summary, September 2026' })).toBeVisible()
  await expect(page.getByText('All domains · 1 Sep 2026 to 30 Sep 2026.')).toBeVisible()

  // The demo's September: 532 asked, 335 of them checked (63%), 115 found nothing written down.
  const main = page.getByRole('main')
  await expect(main).toContainText('Questions asked532')
  await expect(main).toContainText('63%')
  await expect(main).toContainText('335 of 532 questions')
  await expect(main).toContainText('Not found115')
  // 532 against 483 in August is a move chance would make: no arrow, no per cent.
  await expect(main).toContainText('483 in August 2026')
  await expect(page.locator('[data-slot=kpi-change]').first()).toHaveText('About the same')

  // Each number says exactly what it counts, one click away.
  await page.getByRole('button', { name: 'What Checked answers counts' }).click()
  await expect(page.getByRole('dialog')).toContainText(
    'Answers with a warning are not counted here.',
  )
  await page.keyboard.press('Escape')

  // Sentences from fixed templates over the numbers above.
  await expect(main).toContainText(
    'Agents asked 532 questions in September 2026, about the same as in August 2026 (483).',
  )
  await expect(main).toContainText('335 (63%) had an answer fully based on checked context.')

  // What was caught: what went out with a warning, and two lines not measured yet.
  const caught = page.locator('section', {
    has: page.getByRole('heading', { name: 'What we caught' }),
  })
  await expect(caught).toContainText('answers went out with a warning')
  await expect(caught.getByText(/^Not measured yet\./)).toHaveCount(2)

  // The trend: 13 weeks of checked answers, up to the last week September ends by.
  await expect(page.getByRole('table', { name: /Checked answers each week/ })).toBeAttached()
  await expect(
    page.getByRole('table', { name: /Checked answers each week/ }).locator('tbody tr'),
  ).toHaveCount(13)

  // What is still open, with what waits for it in the Inbox.
  const open = page.locator('section', { has: page.getByRole('heading', { name: 'Still open' }) })
  await expect(open).toContainText('Orders in Spain')
  await expect(open.getByRole('link').first()).toHaveAttribute('href', /\/inbox/)
  await expect(
    page.getByRole('heading', { name: 'What changed and who approved it' }),
  ).toBeVisible()
  await expect(
    page.getByText(/Counts only: never the words of a question or who asked\./).last(),
  ).toBeVisible()
})

test('last quarter compares only from when agents first asked', async ({ page }) => {
  await go(page, '/observability/summary')
  await page.getByRole('radio', { name: 'Last quarter' }).click()
  await expect(page).toHaveURL(/period=quarter/)
  await expect(page.getByRole('heading', { name: 'Summary, July to September 2026' })).toBeVisible()
  await expect(
    page.getByText('No comparison with April to June 2026: agents first asked on 17 Apr 2026.'),
  ).toBeVisible()
  await expect(page.locator('[data-slot=kpi-change]')).toHaveCount(0)
})

test('an owner sees their own domain; a quiet or empty workspace says why', async ({ page }) => {
  await signInAs(page, 'Tomas Eriksen')
  await go(page, '/observability')
  await expect(page.getByRole('heading', { name: 'Summary, September 2026' })).toBeVisible()
  await expect(page.getByText(/^Marketing · 1 Sep 2026 to 30 Sep 2026\./)).toBeVisible()
  await expect(page.getByRole('button', { name: /^Domain:/ })).toHaveCount(0)

  await onMockOnly('review flags for a quiet and an empty workspace', async () => {
    await go(page, '/observability/summary?state=quiet')
    await expect(page.getByText('Too few questions to show')).toBeVisible()
    await go(page, '/observability/summary?state=empty')
    await expect(page.getByText('No agent has asked anything yet')).toBeVisible()
  })
})

test('it prints cleanly on one A4 sheet, light in any theme', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Only Chromium saves a page as PDF')
  await page.emulateMedia({ colorScheme: 'dark' })
  await go(page, '/observability/summary?theme=dark')
  await expect(page.getByRole('heading', { name: 'Summary, September 2026' })).toBeVisible()
  await page.emulateMedia({ media: 'print', colorScheme: 'dark' })
  // On paper: no menus, no header, no controls, and dark text on light.
  await expect(page.locator('[data-sidebar=sidebar]').first()).toBeHidden()
  await expect(page.getByRole('navigation', { name: 'breadcrumb' })).toBeHidden()
  await expect(page.getByRole('radio', { name: 'Last month' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'What Checked answers counts' })).toBeHidden()
  const ink = await page
    .getByRole('heading', { name: 'Summary, September 2026' })
    .evaluate((h) => getComputedStyle(h).color)
  const lightness = Number(/oklch\(([\d.]+)/.exec(ink)?.[1] ?? /rgb\((\d+)/.exec(ink)?.[1])
  expect(lightness < (ink.startsWith('oklch') ? 0.5 : 128), `ink ${ink}`).toBe(true)
  const pdf = (await page.pdf({ format: 'A4', preferCSSPageSize: true })).toString('latin1')
  expect(pdf.match(/\/Type\s*\/Page[^s]/g)).toHaveLength(1)
})

test('axe finds nothing on Summary, wide and narrow, light and dark', async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ] as const)
    for (const theme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: theme })
      await go(page, `/observability/summary?theme=${theme}`)
      await expect(page.getByRole('heading', { name: 'Summary, September 2026' })).toBeVisible()
      // Fonts in and nothing moving, so axe reads the colours a person sees.
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
