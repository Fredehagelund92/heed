import { expect, test, type Locator } from '@playwright/test'
import { contentLeft, openPage, previews, routes, settle, themes, widths } from './support'

/*
  The layout contract: the shell header, the page toolbar and the page content share one left
  edge, and that edge is the page gutter (24px from 768px wide, 16px below). If a region gets
  its own padding, this fails. It would have caught the "six different left edges" problem in
  the HTML prototypes.
*/

const gutterFor = (width: number) => (width >= 768 ? 24 : 16)

for (const size of widths) {
  test.describe(`left edges at ${size.name}px`, () => {
    for (const target of [...routes.map((route) => ({ ...route, template: null })), ...previews]) {
      test(`${target.name}: header, toolbar and content line up`, async ({ page }) => {
        await openPage(page, target.path, { ...size, theme: 'light' })
        // A page that folds the sidebar to its rail (Health) moves every edge while the
        // sidebar's transition runs: measure once it has ended.
        await settle(page)

        const main = await page
          .locator('[data-slot="sidebar-inset"]')
          .evaluate((element) => element.getBoundingClientRect().left)
        const gutter = gutterFor(size.width)

        const header = await contentLeft(page, '[data-layout="header"]')
        expect(header - main, 'header content starts at the gutter').toBe(gutter)

        const content = await contentLeft(page, '[data-layout="content"]')
        expect(content - main, 'content starts at the gutter').toBe(gutter)

        const toolbars = page.locator('[data-layout="toolbar"]')
        if ((await toolbars.count()) > 0) {
          const toolbar = await contentLeft(page, '[data-layout="toolbar"]')
          expect(toolbar - main, 'toolbar starts at the gutter').toBe(gutter)
          expect(toolbar).toBe(header)
        }
        expect(content).toBe(header)
      })
    }
  })
}

// The loading skeleton holds the same edge, so the page does not shift when the rows arrive.
for (const size of widths) {
  test(`library loading: the skeleton starts at the gutter at ${size.name}px`, async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('cl.mock-scenario', 'slow'))
    await openPage(page, '/library', { ...size, theme: 'light' })
    await expect(page.getByRole('status', { name: 'Loading the library' })).toBeVisible()
    const main = await page
      .locator('[data-slot="sidebar-inset"]')
      .evaluate((element) => element.getBoundingClientRect().left)
    expect((await contentLeft(page, '[data-layout="content"]')) - main).toBe(gutterFor(size.width))
  })
}

test('the gutter is a single variable', async ({ page }) => {
  await openPage(page, '/library', { ...widths[0], theme: 'light' })
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--page-gutter').trim(),
    ),
  ).toBe('1.5rem')
  await openPage(page, '/library', { ...widths[2], theme: 'light' })
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--page-gutter').trim(),
    ),
  ).toBe('1rem')
})

/*
  Command palette shortcut hints: every hint sits at the trailing edge of its row, inside the row
  padding, vertically centred with the label. Each hint is measured against its own row, so a hint
  that drifts (as when it followed the label instead of the edge) fails here.
*/
for (const size of widths) {
  for (const theme of themes) {
    test(`palette shortcut hints are right aligned at ${size.name}px, ${theme}`, async ({
      page,
    }) => {
      await openPage(page, '/', { ...size, theme })
      await page.keyboard.press('Control+k')
      await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()

      const hints = page.locator('[data-slot="command-item"] [data-slot="command-shortcut"]')
      if (size.width < 640) {
        // Phones have no keyboard: the hints are hidden.
        for (const hint of await hints.all()) await expect(hint).toBeHidden()
        return
      }

      const measured = await hints.evaluateAll((elements) =>
        elements.map((hint) => {
          hint.scrollIntoView({ block: 'nearest' })
          const row = hint.closest('[data-slot="command-item"]')
          const label = row?.querySelector('span')
          if (!row || !label) throw new Error('A shortcut hint is not inside a command item')
          const hintBox = hint.getBoundingClientRect()
          const rowBox = row.getBoundingClientRect()
          const labelBox = label.getBoundingClientRect()
          const padding = Number.parseFloat(getComputedStyle(row).paddingRight)
          return {
            rightGap: rowBox.right - padding - hintBox.right,
            centreOffset: hintBox.top + hintBox.height / 2 - (labelBox.top + labelBox.height / 2),
            right: hintBox.right,
          }
        }),
      )

      expect(measured.length).toBeGreaterThan(0)
      const rights = measured.map((entry) => entry.right)
      expect(
        Math.max(...rights) - Math.min(...rights),
        'all hints share one right edge',
      ).toBeLessThanOrEqual(1)
      for (const entry of measured) {
        expect(Math.abs(entry.rightGap), 'hint ends at the row padding').toBeLessThanOrEqual(1)
        expect(
          Math.abs(entry.centreOffset),
          'hint is vertically centred with the label',
        ).toBeLessThanOrEqual(1)
      }
    })
  }
}

/*
  Empty states are centred (components/ui/empty.tsx): the icon, the title, the words and any
  actions sit on the box's centre line. A page that overrides it to the left fails here.
*/
const emptyStates = [
  { name: 'Try it', path: '/try-it' },
  { name: 'Health, not an owner', path: '/health' },
  { name: 'Editions, not an owner', path: '/editions' },
  { name: 'unknown metric', path: '/catalogue/metric/no-such-metric' },
  { name: 'unknown dimension', path: '/catalogue/dimension/no-such-dimension' },
  { name: 'Administration, not an administrator', path: '/admin' },
] as const

for (const size of [widths[0], widths[2]])
  for (const target of emptyStates)
    test(`${target.name}: the empty state is centred at ${size.name}px`, async ({ page }) => {
      await openPage(page, target.path, { ...size, theme: 'light' })
      // The unknown metric names its empty state "term-not-found".
      const empty = page.locator('[data-slot="empty"], [data-slot="term-not-found"]').first()
      await expect(empty).toBeVisible()
      const geometry = await empty.evaluate((box) => {
        const centre = (element: Element) => {
          const rect = element.getBoundingClientRect()
          return rect.left + rect.width / 2
        }
        return {
          centre: centre(box),
          align: getComputedStyle(box).textAlign,
          parts: [...box.children].map((part) => ({
            slot: part.getAttribute('data-slot'),
            centre: centre(part),
          })),
          inner: [...box.querySelectorAll('[data-slot="empty-header"] > *')].map(centre),
        }
      })
      expect(geometry.align).toBe('center')
      for (const part of geometry.parts)
        expect(Math.abs(part.centre - geometry.centre), `${part.slot} is centred`).toBeLessThan(1)
      for (const inner of geometry.inner)
        expect(Math.abs(inner - geometry.centre), 'the icon and words are centred').toBeLessThan(1)
    })

/*
  The type scale (contract 6.5): a search in a page's toolbar reads in 13, as the toolbar's
  buttons and the table under it do; the palette and Home's own search field read in 14. A
  coarse pointer would get 16 (no iOS zoom), which the desktop project does not emulate.
*/
test.describe('search fields follow the type scale', () => {
  const toolbarSearches = [
    { path: '/library', name: 'Search the library' },
    { path: '/catalogue', name: 'Search metrics and dimensions' },
    { path: '/gaps', name: 'Search topics' },
    { path: '/proposals', name: 'Search proposals' },
  ]
  const fontSize = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).fontSize)

  for (const target of toolbarSearches) {
    test(`${target.path}: the search reads in the toolbar's size`, async ({ page }) => {
      await openPage(page, target.path, { ...widths[0], theme: 'light' })
      const search = page.getByRole('textbox', { name: target.name })
      expect(await fontSize(search)).toBe('13px')
      const button = page.locator('[data-layout="toolbar"] button').first()
      expect(await fontSize(button)).toBe('13px')
    })
  }

  test('the palette and Home search read in 14', async ({ page }) => {
    await openPage(page, '/', { ...widths[0], theme: 'light' })
    const home = page.getByRole('combobox', { name: 'Search the library, or ask a question' })
    expect(await fontSize(home)).toBe('14px')
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' }).getByRole('combobox')
    await expect(palette).toBeVisible()
    expect(await fontSize(palette)).toBe('14px')
  })
})
