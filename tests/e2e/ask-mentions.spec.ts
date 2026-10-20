import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { chipEditor, questionWords } from './ask-support'
import { openPage, settle, themes, widths, type Theme } from './support'

/*
  @ in the assistant's question offers what item text can mention (FR-129, the shared picker):
  metrics, values, dimensions, accepted items and domains, grouped by type, by keyboard alone,
  and never a person. The chosen one becomes a chip in the question and goes with it as its
  scope. Checked where the question is asked: the assistant's page, the panel docked at 480 and
  full screen at 400, and the page on a phone; in light and dark, with reduced motion.
*/

type Place = {
  name: string
  open: (page: Page, theme: Theme) => Promise<void>
  /** The region the composer is in, which the list must stay inside. */
  region: (page: Page) => Locator
  /** The width the region has there, when it is the docked panel. */
  width?: number
}

const assistantRegion = (page: Page) => page.getByRole('region', { name: 'Assistant' })
const places: Place[] = [
  {
    name: 'the assistant page',
    open: (page, theme) => openPage(page, '/assistant', { ...widths[0], theme }),
    region: (page) => page.locator('[data-slot="page"]'),
  },
  {
    name: 'the docked panel at 480',
    width: 480,
    open: async (page, theme) => {
      await openPage(page, '/library', { ...widths[0], theme })
      await page.getByRole('button', { name: 'Assistant', exact: true }).click()
    },
    region: assistantRegion,
  },
  {
    // On a phone the panel is full screen: 400 wide on a 400 wide phone.
    name: 'the panel at 400',
    width: 400,
    open: async (page, theme) => {
      await openPage(page, '/library', { width: 400, height: 844, theme })
      await page.getByRole('button', { name: 'Assistant', exact: true }).click()
    },
    region: (page) => page.getByRole('dialog', { name: 'Assistant' }),
  },
  {
    name: 'a phone',
    open: (page, theme) => openPage(page, '/assistant', { ...widths[2], theme }),
    region: (page) => page.locator('[data-slot="page"]'),
  },
]

const box = (page: Page) =>
  page.getByRole('textbox', { name: 'Your question' }).filter({ visible: true })
const chips = (page: Page) => box(page).locator('[data-chip="ask"]')
const list = (page: Page) =>
  page.getByRole('listbox', { name: 'Mention a metric, value, dimension, fact or domain' })
const group = (page: Page, name: string) => list(page).getByRole('group', { name })
const answer = (page: Page) => page.getByRole('article', { name: 'Answer' }).last()
/** The docked panel the assistant is in: what axe checks, without the library behind it. */
const panelSlot = '[data-slot="dock-panel"]'
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Moves the active row with Down until it is the one wanted, as a keyboard user does: matched on
 * its words and on its id, which holds the target (`area_marketing`).
 */
async function arrowTo(page: Page, wanted: RegExp) {
  for (let step = 0; step < 10; step++) {
    const active = list(page).locator('[role="option"][aria-selected="true"]')
    const said = `${await active.getAttribute('id')} ${await active.textContent()}`
    if (wanted.test(said)) return
    await page.keyboard.press('ArrowDown')
  }
  throw new Error(`No row matched ${wanted}`)
}

for (const place of places)
  test.describe(`@ in the question on ${place.name}`, () => {
    test('lists domains and items with the terms, by keyboard, and makes a chip of each', async ({
      page,
    }) => {
      await place.open(page, 'light')
      await chipEditor(page)
      await box(page).click()
      await page.keyboard.type('what is @sal')
      await expect(group(page, 'Domains').getByRole('option', { name: /^Sales/ })).toBeVisible()
      // The list stays inside the composer's region and never scrolls the page sideways.
      const shown = (await list(page).boundingBox())!
      const region = (await place.region(page).boundingBox())!
      if (place.width) expect(region.width).toBe(place.width)
      expect(shown.x).toBeGreaterThanOrEqual(region.x - 1)
      expect(shown.x + shown.width).toBeLessThanOrEqual(region.x + region.width + 1)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await arrowTo(page, /area_sales/)
      await expect(box(page)).toHaveAttribute('aria-activedescendant', /area_sales/)
      await page.keyboard.press('Enter')
      await expect(list(page)).toBeHidden()
      await expect(chips(page)).toHaveCount(1)
      await expect(chips(page).first()).toHaveAttribute('data-kind', 'area')
      await expect(chips(page).first()).toHaveAttribute('data-tone', /.+/)

      // An accepted item, from its group, by its title.
      await page.keyboard.type('and @comparing units per')
      const items = group(page, 'Facts')
      await expect(items.getByRole('option').first()).toBeVisible()
      await arrowTo(page, /item-itm_\S* Comparing Units per order/)
      await page.keyboard.press('Tab')
      await expect(chips(page)).toHaveCount(2)
      await expect(chips(page).nth(1)).toHaveAttribute('data-kind', 'item')
      expect(await questionWords(page)).toMatch(/^what is Sales and Comparing Units per order/)
    })
  })

test('a domain chip is the question’s scope: the answer is about that domain', async ({ page }) => {
  await openPage(page, '/assistant', { ...widths[0], theme: 'light' })
  await chipEditor(page)
  await box(page).click()
  await page.keyboard.type('what is in @marketing')
  await arrowTo(page, /area_marketing/)
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
  await expect(answer(page)).toContainText(/Marketing has \d+ facts/)
  // Sent: the box is empty again, and a chip is not carried to the next question.
  expect(await questionWords(page)).toBe('')
})

test('an item chip is the question’s scope: the answer reads that item', async ({ page }) => {
  await openPage(page, '/assistant', { ...widths[0], theme: 'light' })
  await chipEditor(page)
  await box(page).click()
  await page.keyboard.type('what does @comparing units per')
  await arrowTo(page, /item-itm_\S* Comparing Units per order/)
  await page.keyboard.press('Enter')
  await page.keyboard.type('say?')
  await page.keyboard.press('Enter')
  await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
  await expect(answer(page)).toContainText("It doesn't say it caused any change")
})

test('a person is never offered, and a screen reader hears what each chip is', async ({ page }) => {
  await openPage(page, '/assistant', { ...widths[0], theme: 'light' })
  await chipEditor(page)
  await box(page).click()
  // Maria Lindqvist is a person in the mock: chat does not tag people.
  await page.keyboard.type('@maria')
  await expect(list(page)).toBeVisible()
  await expect(list(page).getByRole('option', { name: /Maria/ })).toHaveCount(0)
  await expect(list(page).getByRole('group')).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'No match.' })).toHaveCount(1)
  for (let step = 0; step < '@maria'.length; step++) await page.keyboard.press('Backspace')
  await page.keyboard.type('@sales')
  await arrowTo(page, /area_sales/)
  await page.keyboard.press('Enter')
  await expect(box(page).getByRole('button', { name: 'Remove domain Sales' })).toBeVisible()
  await expect(chips(page).first()).toHaveAttribute('title', 'Domain: Sales')
  await expect(chips(page).first().locator('.sr-inline').first()).toHaveText(/^domain/)
})

for (const theme of themes)
  test(`axe with the @ list of domains and items open, and no motion, ${theme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openPage(page, '/library', { ...widths[0], theme })
    await page.getByRole('button', { name: 'Assistant', exact: true }).click()
    await chipEditor(page)
    await box(page).click()
    await page.keyboard.type('@sal')
    await expect(group(page, 'Domains')).toBeVisible()
    // The list appears at once: nothing on it moves.
    expect(
      await list(page).evaluate(
        (element) =>
          element
            .closest('[data-slot="mention-list"]')!
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === 'running').length,
      ),
    ).toBe(0)
    await settle(page)
    const results = await new AxeBuilder({ page }).include(panelSlot).withTags(wcag).analyze()
    expect(
      results.violations.map(
        (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
      ),
    ).toEqual([])
    await arrowTo(page, /area_sales/)
    await page.keyboard.press('Enter')
    await page.keyboard.type('and @comparing units per')
    await arrowTo(page, /item-itm_\S* Comparing Units per order/)
    await page.keyboard.press('Enter')
    await settle(page)
    const chipped = await new AxeBuilder({ page }).include(panelSlot).withTags(wcag).analyze()
    expect(chipped.violations.map((v) => v.id)).toEqual([])
  })
