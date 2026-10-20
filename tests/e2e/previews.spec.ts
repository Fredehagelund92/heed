import { mkdirSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPage, settle, themes, type Theme } from './support'

/*
  Chip previews and catalogue links (the editor design, section 6). Every chip that says where an
  item applies links to its catalogue page: a metric to its page, a value to its dimension's page
  with the value picked out. A hover card opens after a short delay on pointer and on keyboard
  focus, never blocks a click, never covers the assistant launcher or a bar stuck to the bottom
  of the page, and moves nothing on the page. On touch the same preview is a bottom sheet.
*/

const ITEM = '/library/itm_jyfuvl07'
const JON = 'per_jon'
const READY = '00000000-0000-4000-8000-00000000005a'
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const desktop = { width: 1440, height: 900 }
const phone = { width: 390, height: 844 }

/** Set PREVIEW_SHOTS to a folder to keep a screenshot of each preview. */
const shots = process.env.PREVIEW_SHOTS
if (shots) mkdirSync(shots, { recursive: true })

const card = (page: Page) => page.locator('[data-slot="preview-card"]')
const sheet = (page: Page) => page.getByRole('dialog')
const where = (page: Page) => page.getByRole('list', { name: 'Metrics, markets and other names' })

type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

async function box(locator: Locator) {
  const found = await locator.boundingBox()
  if (!found) throw new Error('not on screen')
  return found
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
  expect(
    results.violations.map(
      (violation) =>
        `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
    ),
  ).toEqual([])
}

async function keep(page: Page, name: string) {
  if (shots) await page.screenshot({ path: `${shots}/${name}.png` })
}

test.describe('catalogue links', () => {
  test('each chip in Where it applies opens its catalogue page', async ({ page }) => {
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    await expect(where(page).getByRole('link', { name: 'Units per order' })).toHaveAttribute(
      'href',
      '/catalogue/metric/units_per_order',
    )
    const value = where(page).getByRole('link', { name: 'Market Netherlands' })
    await expect(value).toHaveAttribute('href', '/catalogue/dimension/market?value=netherlands')
    await value.click()
    await expect(page).toHaveURL(/\/catalogue\/dimension\/market\?value=netherlands$/)
    const picked = page.getByRole('list', { name: 'Values of Market' }).locator('[aria-current]')
    await expect(picked).toHaveText(/Netherlands/)
    await expect(picked).toBeInViewport()
  })

  test('a mention links to its catalogue page, an item to its page', async ({ page }) => {
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    const text = page.locator('[data-slot="item-text"]')
    await expect(text.getByRole('link', { name: /^market/ })).toHaveAttribute(
      'href',
      '/catalogue/dimension/market',
    )
    await expect(text.getByRole('link', { name: /, fact/ })).toHaveAttribute(
      'href',
      /^\/library\/itm_/,
    )
  })

  test('the dimension page is a real page with its values', async ({ page }) => {
    await openPage(page, '/catalogue/dimension/market', { ...desktop, theme: 'light' })
    await expect(page.getByRole('heading', { level: 1, name: 'Market' })).toBeVisible()
    await expect(page.getByRole('tablist', { name: 'Dimension sections' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Values of Market' })).toBeVisible()
    await expect(
      page.getByRole('list', { name: 'Values of Market' }).locator('[aria-current]'),
    ).toHaveCount(0)
  })
})

for (const theme of themes) {
  test.describe(`hover card at 1440, ${theme}`, () => {
    test('opens after a short delay, says what the term is and moves nothing', async ({ page }) => {
      await openPage(page, ITEM, { ...desktop, theme })
      const chip = where(page).getByRole('link', { name: 'Units per order' })
      const before = await box(chip)
      const heading = await box(page.getByRole('heading', { name: 'Where it applies' }))
      await chip.hover()
      await page.waitForTimeout(120)
      await expect(card(page)).toHaveCount(0)
      await expect(card(page)).toBeVisible()
      await settle(page)
      await expect(card(page)).toHaveAttribute('aria-label', 'Preview of a metric')
      await expect(card(page)).toContainText('Units per order')
      await expect(card(page)).toContainText('Metric · group Basket')
      await expect(card(page)).toContainText('The mean number of units in a paid order')
      await expect(card(page).locator('[data-slot="catalogue-status"]')).toBeVisible()
      await expect(card(page).getByRole('link', { name: 'Open Units per order' })).toBeVisible()
      await expect(
        card(page).getByRole('button', { name: 'Copy a link to Units per order' }),
      ).toBeVisible()
      // Nothing on the page moved.
      expect(await box(chip)).toEqual(before)
      expect(await box(page.getByRole('heading', { name: 'Where it applies' }))).toEqual(heading)
      expect(overlaps(await box(card(page)), await box(chip))).toBe(false)
      expect(
        overlaps(
          await box(card(page)),
          await box(page.getByRole('button', { name: 'Assistant', exact: true })),
        ),
      ).toBe(false)
      await expectNoAxeViolations(page)
      await keep(page, `card-metric-1440-${theme}`)
    })

    test('previews a value, a dimension, an item and a person', async ({ page }) => {
      await openPage(page, ITEM, { ...desktop, theme })
      const away = page.getByRole('heading', { level: 1 })

      await where(page).getByRole('link', { name: 'Market Netherlands' }).hover()
      await expect(card(page).locator('[data-slot="preview-view"]')).toContainText('Market')
      await expect(card(page)).toContainText(/\d+ facts/)
      await settle(page)
      await keep(page, `card-value-1440-${theme}`)
      await away.hover()
      await expect(card(page)).toHaveCount(0)

      const text = page.locator('[data-slot="item-text"]')
      await text.getByRole('link', { name: /^market/ }).hover()
      await expect(card(page)).toContainText('Dimension · 12 values')
      await expect(card(page).getByRole('list', { name: 'Values of Market' })).toBeVisible()
      await settle(page)
      await keep(page, `card-dimension-1440-${theme}`)
      await away.hover()
      await expect(card(page)).toHaveCount(0)

      await text.getByRole('link', { name: /fact/i }).first().hover()
      await expect(card(page)).toHaveAttribute('aria-label', 'Preview of a fact')
      await expect(card(page).locator('[data-slot="status-badge"]')).toBeVisible()
      await settle(page)
      await expectNoAxeViolations(page)
      await keep(page, `card-item-1440-${theme}`)
      await away.hover()
      await expect(card(page)).toHaveCount(0)

      await page.getByRole('tab', { name: 'Source' }).click()
      await page.locator('[data-preview="person"]').first().hover()
      await expect(card(page)).toContainText(/Owner of/)
      await settle(page)
      await expectNoAxeViolations(page)
      await keep(page, `card-person-1440-${theme}`)
    })
  })
}

test.describe('hover card behaviour', () => {
  test('never blocks a click: the chip opens its page with the card open or not', async ({
    page,
  }) => {
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    await where(page).getByRole('link', { name: 'Units per order' }).click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/units_per_order$/)
    await page.goBack()
    const chip = where(page).getByRole('link', { name: 'Units per order' })
    await chip.hover()
    await expect(card(page)).toBeVisible()
    await chip.click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/units_per_order$/)
    await expect(card(page)).toHaveCount(0)
  })

  test('opens on keyboard focus and closes on Escape, with focus kept on the chip', async ({
    page,
  }) => {
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    const chip = where(page).getByRole('link', { name: 'Units per order' })
    // A key press first, so the focus that follows counts as keyboard focus.
    await page.keyboard.press('Shift')
    await chip.focus()
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('Units per order')
    await page.keyboard.press('Escape')
    await expect(card(page)).toHaveCount(0)
    await expect(chip).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/catalogue\/metric\/units_per_order$/)
  })

  test('a chip hovered before the card has loaded still gets its card', async ({ page }) => {
    // The card is a chunk of its own, fetched after the first load: hold it back a while.
    let released = false
    await page.route(/preview-host-[\w-]+\.js$/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4000))
      released = true
      await route.continue()
    })
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    const chip = where(page).getByRole('link', { name: 'Units per order' })
    await chip.hover()
    expect(released).toBe(false)
    await expect(card(page)).toBeVisible({ timeout: 15_000 })
    await expect(card(page)).toContainText('Units per order')
  })

  test('a chip focused by keyboard before the card has loaded still gets its card', async ({
    page,
  }) => {
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route(/\/assets\/preview-host-[^/]+\.js$/, async (route) => {
      await held
      await route.continue()
    })
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    const chip = where(page).getByRole('link', { name: 'Units per order' })
    // A key press first, so the focus that follows counts as keyboard focus.
    await page.keyboard.press('Shift')
    await chip.focus()
    release()
    await expect(card(page)).toBeVisible()
    await expect(card(page)).toContainText('Units per order')
    await expect(chip).toBeFocused()
  })

  test('Open goes to the page and Show the facts to the library list it went to before', async ({
    page,
  }) => {
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    await where(page).getByRole('link', { name: 'Units per order' }).hover()
    await card(page)
      .getByRole('link', { name: /\d+ facts/ })
      .click()
    await expect(page).toHaveURL(/\/library\?about=units_per_order&ended=show$/)
    await openPage(page, ITEM, { ...desktop, theme: 'light' })
    await where(page).getByRole('link', { name: 'Units per order' }).hover()
    await card(page).getByRole('link', { name: 'Open Units per order' }).click()
    await expect(page).toHaveURL(/\/catalogue\/metric\/units_per_order$/)
  })

  test('stays clear of the decision bar and the assistant launcher', async ({ page }) => {
    await page.addInitScript((id) => window.localStorage.setItem('cl.mock-person', id), JON)
    await openPage(page, `/proposals/${READY}`, { ...desktop, theme: 'light' })
    const bar = page.locator('[data-slot="decision-bar"]')
    await expect(bar).toBeVisible()
    const chip = page.locator('[data-preview="person"]', { hasText: 'Proposed by' })
    // Make the window just tall enough that the chip sits right above the decision bar, where a
    // card opening below it would cover the bar.
    const chipBottom = (await box(chip)).y + (await box(chip)).height
    await page.setViewportSize({
      width: desktop.width,
      height: Math.round(chipBottom + (await box(bar)).height + 12),
    })
    await expect
      .poll(async () => (await box(bar)).y - ((await box(chip)).y + (await box(chip)).height))
      .toBeLessThan(40)
    await chip.hover()
    await expect(card(page)).toBeVisible()
    await settle(page)
    const shown = await box(card(page))
    expect(overlaps(shown, await box(bar))).toBe(false)
    expect(
      overlaps(shown, await box(page.getByRole('button', { name: 'Assistant', exact: true }))),
    ).toBe(false)
    expect(overlaps(shown, await box(chip))).toBe(false)
    await keep(page, 'card-above-decision-bar-1440-light')
  })

  test('library rows preview what each item applies to', async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem('cl.library.density', JSON.stringify('scope')),
    )
    await openPage(page, '/library', { ...desktop, theme: 'light' })
    const name = page.getByRole('link', { name: 'Units per order', exact: true }).first()
    await expect(name).toHaveAttribute('href', '/catalogue/metric/units_per_order')
    await name.hover()
    await expect(card(page)).toContainText('Units per order')
    await settle(page)
    await keep(page, 'card-library-row-1440-light')
  })
})

test.describe('the @ list peek', () => {
  async function mention(page: Page, theme: Theme, size: { width: number; height: number }) {
    await openPage(page, '/library/new', { ...size, theme })
    const summary = page.getByRole('textbox', { name: 'Summary' })
    await summary.click()
    await page.keyboard.type('Orders fell in @Returns')
    await expect(page.getByRole('listbox')).toBeVisible()
  }

  for (const theme of themes) {
    test(`shows the highlighted row beside the list at 1440, ${theme}`, async ({ page }) => {
      await mention(page, theme, desktop)
      const peek = page.locator('[data-slot="mention-peek"]')
      await expect(peek).toContainText('Returns')
      await expect(peek).toContainText('Metric · group Payments')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      // The second item row: its kind, domain and status badges, as on the item's card.
      await expect(peek.locator('[data-slot="status-badge"]')).toBeVisible()
      await settle(page)
      expect(overlaps(await box(peek), await box(page.locator('[data-slot="mention-list"]')))).toBe(
        false,
      )
      // Focus stays in the field; the peek is for the eye only.
      await expect(page.getByRole('textbox', { name: 'Summary' })).toBeFocused()
      await expectNoAxeViolations(page)
      await keep(page, `peek-1440-${theme}`)
    })

    test(`shows the highlighted row inside the list at 390, ${theme}`, async ({ page }) => {
      await mention(page, theme, phone)
      const list = page.locator('[data-slot="mention-list"]')
      await expect(list.locator('[data-slot="mention-peek"]')).toContainText('Returns')
      const width = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(width).toBeLessThanOrEqual(phone.width)
      await settle(page)
      await keep(page, `peek-390-${theme}`)
    })
  }

  test('a chip in the editor previews on hover and a click keeps editing', async ({ page }) => {
    await mention(page, 'light', desktop)
    await page.keyboard.press('Enter')
    const chip = page.locator('[data-slot="summary-input"] [data-preview="metric"]')
    await expect(chip).toBeVisible()
    await chip.hover()
    await expect(card(page)).toContainText('Returns')
    await chip.click()
    await expect(page).toHaveURL(/\/library\/new/)
  })
})

for (const theme of themes) {
  test.describe(`bottom sheet on touch at 390, ${theme}`, () => {
    test.use({ hasTouch: true, isMobile: true })

    test('a tap opens the sheet instead of the page, and Open follows the link', async ({
      page,
    }) => {
      await openPage(page, ITEM, { ...phone, theme })
      await where(page).getByRole('link', { name: 'Units per order' }).tap()
      await expect(sheet(page)).toBeVisible()
      await expect(page).toHaveURL(new RegExp(`${ITEM}$`))
      await expect(sheet(page).getByRole('heading', { name: 'Units per order' })).toBeVisible()
      await expect(sheet(page)).toContainText('Quick look · Metric')
      await expect(sheet(page).getByRole('link', { name: /Show the \d+ facts/ })).toBeVisible()
      await expect(card(page)).toHaveCount(0)
      await settle(page)
      await expectNoAxeViolations(page)
      await keep(page, `sheet-metric-390-${theme}`)
      await sheet(page).getByRole('link', { name: 'Open Units per order' }).tap()
      await expect(page).toHaveURL(/\/catalogue\/metric\/units_per_order$/)
      await expect(sheet(page)).toHaveCount(0)
    })

    // A tap leaves the chip focused and :hover on a touch screen; when it comes before the
    // preview chunk has loaded, the chunk must open the sheet alone, not the card over it too.
    test('a tap before the previews have loaded opens only the sheet', async ({ page }) => {
      let release!: () => void
      const held = new Promise<void>((resolve) => (release = resolve))
      await page.route(/\/assets\/preview-host-[^/]+\.js$/, async (route) => {
        await held
        await route.continue()
      })
      await openPage(page, ITEM, { ...phone, theme })
      await where(page).getByRole('link', { name: 'Units per order' }).tap()
      release()
      await expect(sheet(page).getByRole('heading', { name: 'Units per order' })).toBeVisible()
      // Well past the card's open delay (300 ms), which is when it would have opened.
      await page.waitForTimeout(1000)
      await expect(card(page)).toHaveCount(0)
    })

    test('the sheet closes with its button and keeps the page', async ({ page }) => {
      await openPage(page, ITEM, { ...phone, theme })
      await page
        .locator('[data-slot="item-text"]')
        .getByRole('link', { name: /, fact/ })
        .tap()
      await expect(sheet(page)).toBeVisible()
      await expect(sheet(page)).toContainText('Quick look · Fact')
      await settle(page)
      await keep(page, `sheet-item-390-${theme}`)
      await sheet(page).getByRole('button', { name: 'Close' }).tap()
      await expect(sheet(page)).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`${ITEM}$`))
    })
  })
}
