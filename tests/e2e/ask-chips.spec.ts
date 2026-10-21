import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { chipEditor, questionWords } from './ask-support'
import { openPage, settle, themes, widths, type Theme } from './support'

/*
  The metric, the market and the dates as chips inside the question (Heed composer, stage 2), on
  the assistant's page with the mock binding: by keyboard only, read by a screen reader as words,
  pasted plain, through 100 real paste and undo cycles, typed with an input method, on a phone,
  and with the plain box of stage 1 when the editor's chunk cannot load. Today is 7 Oct 2026.
*/

const box = (page: Page) => page.getByRole('textbox', { name: 'Your question' })
const chips = (page: Page) => box(page).locator('[data-chip="ask"]')
const reads = (page: Page) => page.getByRole('list', { name: 'About', exact: true })
const offer = (page: Page) => page.locator('[data-slot="ask-offer"]')
const answer = (page: Page) => page.getByRole('article', { name: 'Answer' }).last()
const list = (page: Page) =>
  page.getByRole('listbox', { name: 'Mention a metric, value, dimension, fact or domain' })
const panel = (page: Page) => page.locator('[data-slot="ask-dates"]')
const captain = 'what was net revenue in the United Kingdom in 2026?'
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
/** The start and the end of the question: select all, then an arrow collapses to that end. */
async function toStart(page: Page) {
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ArrowLeft')
}
async function toEnd(page: Page) {
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ArrowRight')
}

async function openAssistant(
  page: Page,
  size: { width: number; height: number } = widths[0],
  theme: Theme = 'light',
) {
  await openPage(page, '/assistant', { ...size, theme })
  await chipEditor(page)
}

/** Types the captain's question and waits for Heed's reading of it: three offers. */
async function typeCaptain(page: Page) {
  await box(page).click()
  await page.keyboard.type(captain)
  await expect(offer(page)).toContainText('Make “net revenue” a chip?')
}

/** The name and value Chromium's accessibility tree gives a field: what a screen reader hears. */
async function accessible(page: Page, field: Locator) {
  await field.evaluate((element) => element.setAttribute('data-ax-probe', ''))
  const cdp = await page.context().newCDPSession(page)
  const { root } = await cdp.send('DOM.getDocument')
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '[data-ax-probe]',
  })
  const { nodes } = await cdp.send('Accessibility.getPartialAXTree', {
    nodeId,
    fetchRelatives: false,
  })
  await field.evaluate((element) => element.removeAttribute('data-ax-probe'))
  await cdp.detach()
  // A chip's parts are joined by no-break spaces, so it never breaks across lines.
  const text = (value: { value?: unknown } | undefined) =>
    typeof value?.value === 'string' ? value.value.replace(/\u00a0/g, ' ') : undefined
  return { name: text(nodes[0]?.name), value: text(nodes[0]?.value) }
}

for (const size of [widths[0], widths[2]]) {
  test.describe(`chips in the question at ${size.name}px`, () => {
    test('by keyboard only: Tab takes each offer, @ picks, the arrows select a chip, and undo takes back one edit', async ({
      page,
    }) => {
      await openAssistant(page, size)
      await typeCaptain(page)
      // Recognised words are only offered: nothing becomes a chip by itself.
      await expect(chips(page)).toHaveCount(0)
      await expect(box(page).locator('[data-offer]')).toHaveText([
        'net revenue',
        'United Kingdom',
        '2026',
      ])
      await expect(reads(page).locator('[data-source="typed"]')).toHaveCount(3)
      for (const words of ['net revenue', 'United Kingdom', '2026']) {
        await expect(offer(page)).toContainText(`Make “${words}” a chip?`)
        await page.keyboard.press('Tab')
      }
      await expect(offer(page)).toHaveCount(0)
      await expect(box(page)).toBeFocused()
      await expect(chips(page)).toHaveText([
        /net revenue/,
        /United Kingdom/,
        /2026\s·\s1 Jan to 31 Dec 2026/,
      ])
      expect(await questionWords(page)).toBe(captain)
      // The line mirrors the chips, and Tab with nothing offered moves on, as Tab does.
      await expect(reads(page).locator('[data-source="tagged"]')).toHaveText([
        /Net revenue/,
        /Market\s*United Kingdom/,
        '1 Jan to 31 Dec 2026',
      ])

      // The arrows select a chip as one unit; Backspace removes it whole, undo brings it back.
      await toEnd(page)
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowLeft')
      await expect(chips(page).nth(2).locator('..')).toHaveAttribute('data-selected', 'true')
      await page.keyboard.press('Backspace')
      await expect(chips(page)).toHaveCount(2)
      expect(await questionWords(page)).toBe('what was net revenue in the United Kingdom in ?')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(chips(page)).toHaveCount(3)
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(chips(page)).toHaveCount(2)
      await page.keyboard.press('ControlOrMeta+z')
      await expect(chips(page)).toHaveCount(3)

      // Delete on a selected chip turns it back into its words, which Heed reads again.
      await toStart(page)
      for (let step = 0; step < 'what was '.length + 1; step++)
        await page.keyboard.press('ArrowRight')
      await expect(chips(page).first().locator('..')).toHaveAttribute('data-selected', 'true')
      await page.keyboard.press('Delete')
      await expect(chips(page)).toHaveCount(2)
      expect(await questionWords(page)).toBe(captain)
      await expect(reads(page).locator('[data-source="typed"]')).toContainText('Net revenue')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(chips(page)).toHaveCount(3)

      // @ by keyboard: the list moves with the arrows, Enter picks, Escape closes it.
      await toEnd(page)
      await page.keyboard.type(' and @Neth')
      await expect(
        list(page)
          .getByRole('option', { name: /^Netherlands/ })
          .first(),
      ).toBeVisible()
      await expect(box(page)).toHaveAttribute('aria-activedescendant', /netherlands/)
      await page.keyboard.press('Escape')
      await expect(list(page)).toBeHidden()
      // The words stay; a new @ opens the list again.
      for (let step = 0; step < '@Neth'.length; step++) await page.keyboard.press('Backspace')
      await page.keyboard.type('@Neth')
      await expect(list(page)).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(chips(page)).toHaveCount(4)
      expect(await questionWords(page)).toBe(`${captain} and Netherlands `)

      // Enter sends the words and the chips' scope; the box empties and keeps the focus.
      await page.keyboard.press('Enter')
      await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
      await expect(page.getByRole('list', { name: 'Asked about' }).last()).toContainText(
        'Net revenue',
      )
      expect(await questionWords(page)).toBe('')
      await expect(box(page)).toBeFocused()
      await expect(reads(page).locator('[data-source="carried"]').first()).toBeVisible()
    })

    test('@ names dates too, as a dates chip, and leaves no sideways scroll', async ({ page }) => {
      await openAssistant(page, size)
      await box(page).click()
      await page.keyboard.type('orders @last quarter')
      // The words after @ read as dates: that row is the one Enter picks.
      const row = list(page).getByRole('option', { name: 'Dates: 1 Jul to 30 Sept 2026' })
      await expect(row).toHaveAttribute('aria-selected', 'true')
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      await page.keyboard.press('Enter')
      await expect(chips(page)).toHaveText([/last quarter\s·\s1 Jul to 30 Sept 2026/])
      // The dates panel opens above the composer and stays on screen.
      await chips(page).click()
      await expect(panel(page)).toBeVisible()
      // Measured where it rests: it opens with a slide and a zoom.
      await settle(page)
      const shown = (await panel(page).boundingBox())!
      const field = (await box(page).boundingBox())!
      expect(shown.y + shown.height).toBeLessThanOrEqual(field.y + 1)
      expect(shown.x).toBeGreaterThanOrEqual(0)
      expect(shown.x + shown.width).toBeLessThanOrEqual(size.width)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
    })
  })
}

test('a screen reader hears each chip as what it is, its words and how to take it off', async ({
  page,
}) => {
  await openAssistant(page)
  await typeCaptain(page)
  for (let step = 0; step < 3; step++) await page.keyboard.press('Tab')
  await expect(chips(page)).toHaveCount(3)
  expect(await accessible(page, box(page))).toEqual({
    name: 'Your question',
    value:
      'what was metric net revenue, remove in the value United Kingdom, remove in dates 2026 · 1 Jan to 31 Dec 2026, remove?',
  })
  await expect(box(page).getByRole('button', { name: 'Remove metric Net revenue' })).toBeVisible()
  // A click on a chip's remove button takes it off.
  await box(page).getByRole('button', { name: 'Remove value United Kingdom' }).click()
  await expect(chips(page)).toHaveCount(2)
  await expect(box(page)).toBeFocused()
})

test('paste is plain, a cut and paste inside the question keeps its chips, and copy reads as a sentence', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openAssistant(page)
  await typeCaptain(page)
  for (let step = 0; step < 3; step++) await page.keyboard.press('Tab')
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('ControlOrMeta+x')
  await expect(chips(page)).toHaveCount(0)
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(captain)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(chips(page)).toHaveCount(3)
  expect(await questionWords(page)).toBe(captain)

  // Text from elsewhere arrives as words, with its line breaks and without its formatting.
  await page.evaluate(() => navigator.clipboard.writeText(' and\n<b>orders</b>'))
  await page.keyboard.press('ControlOrMeta+v')
  expect(await questionWords(page)).toBe(`${captain} and\n<b>orders</b>`)
  await expect(chips(page)).toHaveCount(3)
})

test('loses nothing over 100 paste and undo cycles', async ({ page, context }) => {
  test.setTimeout(120_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await openAssistant(page)
  await typeCaptain(page)
  for (let step = 0; step < 3; step++) await page.keyboard.press('Tab')
  const before = await questionWords(page)
  const clips = ['plain words', 'two\nlines', '@[Orders](metric:orders) as text', 'æøå 😀', 'a']
  for (let cycle = 0; cycle < 100; cycle++) {
    await page.evaluate((text) => navigator.clipboard.writeText(text), clips[cycle % clips.length]!)
    await (cycle % 2 ? toEnd(page) : toStart(page))
    for (let step = 0; step < cycle % 4; step++)
      await page.keyboard.press(cycle % 2 ? 'Shift+ArrowLeft' : 'Shift+ArrowRight')
    await page.keyboard.press('ControlOrMeta+v')
    await page.keyboard.press('ControlOrMeta+z')
    expect(await questionWords(page)).toBe(before)
    await expect(chips(page)).toHaveCount(3)
  }
})

test('words typed with an input method arrive whole, and composing never sends', async ({
  page,
}) => {
  await openAssistant(page)
  await box(page).click()
  await page.keyboard.type('orders ')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.imeSetComposition', { text: 'ね', selectionStart: 1, selectionEnd: 1 })
  await cdp.send('Input.imeSetComposition', { text: 'ねこ', selectionStart: 2, selectionEnd: 2 })
  await cdp.send('Input.insertText', { text: '猫' })
  await cdp.detach()
  expect(await questionWords(page)).toBe('orders 猫')
  await expect(answer(page)).toHaveCount(0)
})

test('without the chip editor the plain box asks as before, with its scope picker', async ({
  page,
}) => {
  // The editor's chunk cannot load: the composer keeps the plain box of stage 1.
  await page.route(/ask-editor-[\w-]+\.js$/, (route) => route.abort())
  await openPage(page, '/assistant', { ...widths[0], theme: 'light' })
  await expect(page.locator('[data-slot="ask-composer"]')).toHaveAttribute('data-box', 'plain', {
    timeout: 15_000,
  })
  const plain = page.locator('textarea[aria-label="Your question"]')
  await plain.fill('what is ')
  await page.keyboard.type('@')
  const picker = page.locator('[data-slot="ask-scope-popover"]')
  const scope = picker.getByRole('combobox', { name: 'What it is about' })
  await expect(scope).toBeFocused()
  await scope.fill('Average order')
  await expect(page.getByRole('option', { name: /^Average order/ }).first()).toBeVisible()
  await scope.press('Enter')
  await expect(picker).toBeHidden()
  await expect(plain).toBeFocused()
  await expect(plain).toHaveValue('what is ')
  await expect(reads(page).locator('[data-source="picked"]')).toContainText('Average order value')
  await plain.press('Enter')
  await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
})

for (const size of [widths[0], widths[2]])
  for (const theme of themes)
    test(`axe with chips, an offer, the @ list and the dates panel at ${size.name}px, ${theme}`, async ({
      page,
    }) => {
      await openAssistant(page, size, theme)
      const axe = async () => {
        await settle(page)
        const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
        return results.violations.map(
          (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
        )
      }
      await typeCaptain(page)
      await page.keyboard.press('Tab')
      expect(await axe()).toEqual([])
      await toEnd(page)
      await page.keyboard.type(' @high')
      await expect(list(page)).toBeVisible()
      expect(await axe()).toEqual([])
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Dates of the question' }).click()
      await expect(panel(page)).toBeVisible()
      expect(await axe()).toEqual([])
    })
