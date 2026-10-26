import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPage, settle, themes, widths } from './support'

/*
  The chip-aware inputs (contract 9.6) on the design preview, by keyboard only, at 1440 and at
  360 pixels (NFR-113): the @ list, chips that Backspace removes whole and Delete turns back into
  words, undo across chips, 100 paste and undo cycles that lose nothing, the scope input and
  mention tokens in the Markdown body. "Stored as" under each field prints what it stores.
*/

const phone = { name: '360', width: 360, height: 780 } as const

/**
 * The name and value Chromium's accessibility tree gives a field: what a screen reader is handed.
 * Read over the DevTools protocol, because a DOM text snapshot joins the parts of a chip with
 * spaces where the accessibility tree does not.
 */
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
  const [node] = nodes
  const text = (value: { value?: unknown } | undefined) =>
    typeof value?.value === 'string' ? value.value : undefined
  return { role: text(node?.role), name: text(node?.name), value: text(node?.value) }
}
const path = '/design-preview/inputs'

/** What the nth field on the sheet stores: 0, 1 scope; 2, 3, 4 summary. */
const stored = (page: Page, index: number) => page.locator('[data-slot="stored"]').nth(index)
const summary = (page: Page, index: number) =>
  page.getByRole('textbox', { name: 'What happened' }).nth(index)
/** The start and the end of a text field: Control+Home and Control+End, Command+Up and Down on a Mac. */
const mac = process.platform === 'darwin'
const toStart = (page: Page) => page.keyboard.press(mac ? 'Meta+ArrowUp' : 'Control+Home')
const toEnd = (page: Page) => page.keyboard.press(mac ? 'Meta+ArrowDown' : 'Control+End')

for (const size of [widths[0], phone]) {
  test.describe(`at ${size.name}px`, () => {
    test.beforeEach(async ({ page }) => {
      await openPage(page, path, { ...size, theme: 'light' })
      // The summary editor is its own chunk; wait for it before using the keyboard.
      await expect(summary(page, 2)).toBeVisible()
    })

    test('writes a mention by keyboard, removes it whole and undoes it', async ({ page }) => {
      // Keyboard only: from the second scope field, Tab reaches the first summary.
      await page.getByRole('combobox', { name: 'Where it applies' }).nth(1).focus()
      await page.keyboard.press('Tab')
      const field = summary(page, 0)
      await expect(field).toBeFocused()
      await page.keyboard.type('Sales stopped in @norw')
      const list = page.getByRole('listbox', { name: 'Mention a metric, value, fact or domain' })
      await expect(list).toBeVisible()
      await expect(field).toHaveAttribute('aria-activedescendant', /norway/)
      const box = await list.boundingBox()
      expect(box && box.x + box.width).toBeLessThanOrEqual(size.width)
      await page.keyboard.press('Enter')
      await expect(list).toBeHidden()
      await page.keyboard.type('on 4 August.')
      await expect(stored(page, 2)).toHaveText(
        'Sales stopped in @[Norway](val:market/norway) on 4 August.',
      )
      // A screen reader reads the chip as its name and type, inside one line of text.
      expect(await accessible(page, field)).toEqual({
        role: 'textbox',
        name: 'What happened',
        value: 'Sales stopped in Norway, value on 4 August.',
      })
      await expect(page.getByText('36 of 280 characters')).toBeVisible()

      for (let i = 0; i < ' on 4 August.'.length; i++) await page.keyboard.press('Backspace')
      await page.keyboard.press('Backspace')
      await expect(stored(page, 2)).toHaveText('Sales stopped in')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(stored(page, 2)).toHaveText('Sales stopped in @[Norway](val:market/norway)')
      await page.keyboard.press('ControlOrMeta+Shift+z')
      await expect(stored(page, 2)).toHaveText('Sales stopped in')
    })

    test('selects a chip with the arrows and turns it back into words with Delete', async ({
      page,
    }) => {
      const field = summary(page, 1)
      await field.focus()
      await toEnd(page)
      // "... Compare [Orders] before and after." Arrow left over the 18 characters after the chip,
      // then once more: that arrow selects the chip instead of jumping over it (a jump would
      // reach Norway).
      const selected = field.locator('[data-selected] [data-slot="mention-chip"]')
      // The editor reads its selection back from the page after each key, so let a frame pass
      // between presses; on a busy runner a fast press reads a caret that is one step behind.
      for (let i = 0; i < ' before and after.'.length + 1; i++) {
        await page.keyboard.press('ArrowLeft')
        await page.evaluate(
          () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
        )
      }
      await expect(selected).toHaveText(/^Orders/)
      await page.keyboard.press('Delete')
      await expect(stored(page, 3)).toHaveText(
        'Online sales to @[Norway](val:market/norway) stopped on 4 August 2026 after a new customs rule. Compare Orders before and after.',
      )
    })

    test('# lists values only, Escape closes the list and keeps the words', async ({ page }) => {
      await summary(page, 0).focus()
      await page.keyboard.type('Also in #spai')
      const list = page.getByRole('listbox', { name: 'Mention a value' })
      await expect(list.getByRole('option').first()).toContainText('Spain')
      await expect(list.getByRole('group', { name: 'Metrics' })).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(list).toBeHidden()
      await page.keyboard.type('nish')
      await expect(stored(page, 2)).toHaveText('Also in #spainish')
      await page.keyboard.type(' @Narnia')
      await expect(page.getByRole('option', { name: 'Ask an owner to add “Narnia”' })).toBeVisible()
    })

    test('adds scope by keyboard and removes a chip with two Backspaces', async ({ page }) => {
      const field = page.getByRole('combobox', { name: 'Where it applies' }).first()
      await field.focus()
      await page.keyboard.type('norge')
      await expect(page.getByRole('option', { name: /^Norway/ })).toContainText('also called Norge')
      await page.keyboard.press('Enter')
      await page.keyboard.type('units s')
      await expect(page.getByRole('option', { name: /^Units sold/ })).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(stored(page, 0)).toHaveText(
        '{"metrics":["metric:units_sold"],"dimensions":[],"dimensionValues":[{"dimension":"dim:market","value":"val:market/norway"}]}',
      )
      // The last chip is the value: metrics come first, then values.
      await page.keyboard.press('Backspace')
      await expect(page.getByRole('status').first()).toHaveText(
        'Market Norway selected. Press Backspace again to remove it.',
      )
      await page.keyboard.press('Backspace')
      await expect(stored(page, 0)).toHaveText(
        '{"metrics":["metric:units_sold"],"dimensions":[],"dimensionValues":[]}',
      )
    })

    test('leaves no horizontal scroll with a list open', async ({ page }) => {
      await page.getByRole('combobox', { name: 'Where it applies' }).first().focus()
      await page.keyboard.type('n')
      await summary(page, 1).focus()
      await toEnd(page)
      await page.keyboard.type(' @n')
      await expect(page.getByRole('listbox', { name: /Mention/ })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBe(0)
    })
  })
}

test.describe('the summary field', () => {
  test.beforeEach(async ({ page }) => {
    await openPage(page, path, { ...widths[0], theme: 'light' })
    await expect(summary(page, 2)).toBeVisible()
  })

  test('loses nothing over 100 paste and undo cycles', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const field = summary(page, 1)
    const before = await stored(page, 3).textContent()
    await field.focus()
    const clips = [
      'plain words',
      'two\nlines',
      '@[Orders](metric:orders) as text',
      'æøå 😀',
      ' ',
      'a',
      '\\ and @',
    ]
    for (let cycle = 0; cycle < 100; cycle++) {
      const clip = clips[cycle % clips.length]!
      await page.evaluate((text) => navigator.clipboard.writeText(text), clip)
      await (cycle % 2 ? toEnd(page) : toStart(page))
      for (let step = 0; step < cycle % 4; step++)
        await page.keyboard.press(cycle % 2 ? 'Shift+ArrowLeft' : 'Shift+ArrowRight')
      await page.keyboard.press('ControlOrMeta+v')
      await page.keyboard.press('ControlOrMeta+z')
      await expect(stored(page, 3)).toHaveText(before!)
    }
  })

  test('pastes plain text and keeps chips through a cut and paste inside the field', async ({
    page,
    context,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const field = summary(page, 1)
    const before = await stored(page, 3).textContent()
    await field.focus()
    await page.keyboard.press('ControlOrMeta+a')
    await page.keyboard.press('ControlOrMeta+x')
    await expect(stored(page, 3)).toHaveText('(nothing)')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      'Online sales to Norway stopped on 4 August 2026 after a new customs rule. Compare Orders before and after.',
    )
    await page.keyboard.press('ControlOrMeta+v')
    await expect(stored(page, 3)).toHaveText(before!)

    await page.evaluate(() => navigator.clipboard.writeText('In\n@[Units sold](metric:units_sold)'))
    await page.keyboard.press('ControlOrMeta+v')
    await expect(stored(page, 3)).toHaveText(`${before}In \\@[Units sold](metric:units_sold)`)
  })

  test('says how much to cut when the text is over 280 characters', async ({ page }) => {
    await expect(summary(page, 2)).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText(/Shorten it by \d+ characters?\./)).toBeVisible()
  })
})

test('the Markdown body inserts a mention as a token that undo takes back', async ({ page }) => {
  await openPage(page, path, { ...widths[0], theme: 'light' })
  const body = page.getByRole('textbox', { name: 'A longer explanation' })
  const before = await body.inputValue()
  await body.focus()
  await toEnd(page)
  await page.keyboard.type('\n3. Watch @first')
  await expect(page.getByRole('option').first()).toContainText('First-time buyers')
  await page.keyboard.press('Enter')
  await expect(body).toHaveValue(
    `${before}\n3. Watch @[First-time buyers](metric:first_time_buyers) `,
  )
  await expect(
    page.locator('[data-slot="mention-chip"]', { hasText: 'First-time buyers' }),
  ).toBeVisible()
  await page.keyboard.press('ControlOrMeta+z')
  await expect(body).toHaveValue(`${before}\n3. Watch @first`)
})

for (const theme of themes) {
  test(`axe with the lists open, ${theme}`, async ({ page }) => {
    await openPage(page, path, { ...widths[0], theme })
    await expect(summary(page, 2)).toBeVisible()
    const axe = async () => {
      await settle(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      return results.violations.map(
        (violation) =>
          `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
      )
    }
    await page.getByRole('combobox', { name: 'Where it applies' }).first().focus()
    await page.keyboard.type('nor')
    await expect(
      page.getByRole('listbox', { name: 'Metrics, markets and other names' }),
    ).toBeVisible()
    await expect(page.getByRole('option').first()).toBeVisible()
    expect(await axe()).toEqual([])
    await summary(page, 0).focus()
    await page.keyboard.type('Net revenue fell in @n')
    await expect(page.getByRole('listbox', { name: /Mention/ })).toBeVisible()
    expect(await axe()).toEqual([])
    await page.keyboard.press('Escape')
    await expect(page.getByText('a mention?').first()).toBeVisible()
    expect(await axe()).toEqual([])
  })
}
