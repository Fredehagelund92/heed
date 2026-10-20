import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPage } from './support'

/*
  The bars that stick over a list stay over its rows (contract 6.10): scrolled under the shell
  header, the page's sticky block (toolbar and column header) and the floating selection bar, a
  row's checkbox, its menu and its other raised controls go underneath. Checked by what the
  browser hits at points across each bar: always the bar, never a row. On the mock, with long
  lists: Ravi's Mine after he proposes the model's members as terms (a checkbox on each),
  Jon's To review with a selection in a short window, and the library with a selection. At 1440
  by 900, in light and dark, and the library at 390. The library's rows were always safe: each is
  moved by a transform, which keeps its raised controls inside the row.
*/

const desktop = { width: 1440, height: 900 } as const
const phone = { width: 390, height: 844 } as const

async function signInAs(page: Page, personId: string) {
  await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), personId)
}

/** Ravi proposes the model's members as terms, as the pilot's administrator does: a long Mine. */
async function proposeTermsAsRavi(page: Page, theme: 'light' | 'dark') {
  await signInAs(page, 'per_ravi')
  await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'no-terms'))
  await openPage(page, '/admin?section=sources&source=cube&terms=true', { ...desktop, theme })
  await page
    .locator('[data-slot="propose-terms-no-domain"]')
    .getByRole('combobox', { name: 'Put every metric without a domain in' })
    .selectOption('area_sales')
  await page
    .locator('[data-slot="propose-terms-actions"]')
    .getByRole('button', { name: /^Propose \d+ names?$/ })
    .click()
  await expect(page.getByText(/proposed/i).first()).toBeVisible()
  // In the app, not a reload: the mock keeps what was proposed in memory.
  await page.getByRole('link', { name: 'Proposals', exact: true }).first().click()
  await page
    .getByRole('navigation', { name: 'Proposal views' })
    .getByRole('link', { name: /Mine/ })
    .click()
}

/**
 * Scrolls the window so the rows run under the bars, then checks a grid of points across each
 * bar: what the browser hits there must be the bar itself. Returns how many row controls were
 * under a bar, so a test can show it checked a real overlap.
 */
async function expectBarsOverRows(page: Page, bars: Locator[], scrollBy: number) {
  await page.evaluate((by) => window.scrollBy(0, by), scrollBy)
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
  let covered = 0
  for (const bar of bars) {
    await expect(bar).toBeVisible()
    const result = await bar.evaluate((element) => {
      const rect = element.getBoundingClientRect()
      const misses: string[] = []
      for (let y = rect.top + 2; y < rect.bottom - 1; y += 6)
        for (let x = rect.left + 2; x < rect.right - 1; x += 6) {
          const hit = document.elementFromPoint(x, y)
          if (hit && !element.contains(hit) && hit.closest('[role="row"], [data-row-id]'))
            misses.push(
              `${Math.round(x)},${Math.round(y)}: ${hit.tagName.toLowerCase()} ${hit.getAttribute('role') ?? ''} ${hit.getAttribute('aria-label') ?? ''}`,
            )
        }
      // The row controls the bar covers: proof the check met an overlap, not an empty bar.
      const controls = [
        ...document.querySelectorAll('[role="row"] [role="checkbox"], [data-row-id] button'),
      ].filter((control) => {
        if (element.contains(control)) return false
        const box = control.getBoundingClientRect()
        const x = box.left + box.width / 2
        const y = box.top + box.height / 2
        return x > rect.left && x < rect.right && y > rect.top && y < rect.bottom
      })
      return { misses: misses.slice(0, 5), covered: controls.length }
    })
    expect(result.misses, 'a row paints over the bar').toEqual([])
    covered += result.covered
  }
  return covered
}

const shellHeader = (page: Page) => page.locator('[data-layout="header"]')
const stickyBlock = (page: Page) => page.locator('[data-slot="page"] > .sticky').first()
const selectionBar = (page: Page, name: string) => page.getByRole('region', { name })

for (const theme of ['light', 'dark'] as const)
  test(`Ravi's own proposals scroll under the header and the toolbar in ${theme}`, async ({
    page,
  }) => {
    await proposeTermsAsRavi(page, theme)
    const mine = page.getByRole('table', { name: 'Your proposals' })
    await expect(mine.locator('[data-row-id]').nth(20)).toBeAttached()
    // Every row holds a checkbox; hovered, a row shows its own.
    await mine.locator('[data-row-id]').nth(12).hover()
    const covered = await expectBarsOverRows(page, [shellHeader(page), stickyBlock(page)], 400)
    expect(covered).toBeGreaterThan(0)
    await page.screenshot({ path: test.info().outputPath(`mine-${theme}.png`) })
  })

test('To review with a selection keeps the header, the toolbar and the selection bar over its rows', async ({
  page,
}) => {
  await signInAs(page, 'per_jon')
  await openPage(page, '/proposals', { width: 1440, height: 480, theme: 'light' })
  const queue = page.getByRole('table', { name: 'Proposals to review' })
  await expect(queue).toBeVisible()
  await queue.getByRole('checkbox', { name: 'Select every proposal you can decide' }).click()
  const bar = selectionBar(page, 'Selected proposals')
  await expect(bar).toBeVisible()
  const covered = await expectBarsOverRows(page, [shellHeader(page), stickyBlock(page), bar], 260)
  expect(covered).toBeGreaterThan(0)
  await page.screenshot({ path: test.info().outputPath('to-review-selected.png') })
})

for (const size of [desktop, phone])
  for (const theme of ['light', 'dark'] as const)
    test(`the library with a selection keeps its bars over the rows at ${size.width}px in ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/library', { ...size, theme })
      const rows = page.locator('[data-row-id]')
      await expect(rows.nth(15)).toBeAttached()
      if (size.width === desktop.width) {
        for (const index of [0, 1, 2, 3, 4, 5, 6, 7])
          await rows.nth(index).getByRole('checkbox').click()
      }
      const bars = [shellHeader(page), stickyBlock(page)]
      if (size.width === desktop.width) bars.push(selectionBar(page, 'Selected rows'))
      const covered = await expectBarsOverRows(page, bars, 240)
      if (size.width === desktop.width) expect(covered).toBeGreaterThan(0)
      await page.screenshot({ path: test.info().outputPath(`library-${size.width}-${theme}.png`) })
    })
