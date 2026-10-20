import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPage, themes, widths } from './support'

/*
  "Where it applies" with a dimension that holds thousands of values (FR-107, FR-126): the list
  stays empty until the person types, the service searches, each dimension shows a count, "Any
  value" picks the dimension on its own, a dimension is searched a page at a time, a paste
  is only text, and chips fold after eight. On the design preview, by keyboard, at
  1440 and 360 pixels, with axe.
*/

const phone = { name: '360', width: 360, height: 780 } as const
const path = '/design-preview/inputs'

const scopeField = (page: Page, index = 0) =>
  page.getByRole('combobox', { name: 'Where it applies' }).nth(index)
/** What the first scope field stores. */
const stored = (page: Page) => page.locator('[data-slot="stored"]').first()

/** Sends a paste to the field; true when the page took it over instead of leaving it to the field. */
async function paste(field: Locator, text: string) {
  return field.evaluate((element, words) => {
    const data = new DataTransfer()
    data.setData('text/plain', words)
    const event = new ClipboardEvent('paste', {
      clipboardData: data,
      bubbles: true,
      cancelable: true,
    })
    element.dispatchEvent(event)
    return event.defaultPrevented
  }, text)
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.help} (${violation.nodes.map((node) => node.target.join(' ')).join(' | ')})`,
  )
}

for (const size of [widths[0], phone]) {
  test.describe(`at ${size.name}px`, () => {
    test.beforeEach(async ({ page }) => {
      await openPage(page, path, { ...size, theme: 'light' })
      await expect(scopeField(page)).toBeVisible()
    })

    test('lists nothing until typed, then picks a dimension on its own by keyboard', async ({
      page,
    }) => {
      const field = scopeField(page)
      await field.focus()
      await expect(field).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.type('market')
      const group = page.getByRole('group', { name: 'Market, 12 values' })
      await expect(group).toBeVisible()
      const any = group.getByRole('option', { name: /^Any market/ })
      await expect(any).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Enter')
      await expect(stored(page)).toHaveText(
        '{"metrics":[],"dimensions":["dim:market"],"dimensionValues":[]}',
      )
      const chip = page.getByRole('list', { name: 'Chosen' }).first()
      await expect(chip).toContainText('Any market')
      await expect(page.getByRole('status').first()).toHaveText('Added any market.')
    })

    test('searches thousands of values, a few per dimension, and pages inside one', async ({
      page,
    }) => {
      const field = scopeField(page)
      await field.focus()
      await page.keyboard.type('spring')
      await expect(page.getByRole('group', { name: 'Campaign, 240 matches' })).toBeVisible()
      expect(await page.getByRole('option').count()).toBeLessThanOrEqual(14)
      // The last row searches all 240: the arrows wrap to it.
      await page.keyboard.press('ArrowUp')
      await expect(
        page.getByRole('option', { name: 'Search all 240 in Campaign' }),
      ).toHaveAttribute('aria-selected', 'true')
      await page.keyboard.press('Enter')
      const list = page.getByRole('listbox', { name: 'Values of Campaign' })
      await expect(list).toContainText('1 to 12 of 240 matches')
      await expect(field).toHaveValue('spring')
      await page.keyboard.press('ArrowUp')
      await expect(page.getByRole('option', { name: 'Next page' })).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await page.keyboard.press('Enter')
      await expect(list).toContainText('13 to 24 of 240 matches')
      await page.keyboard.type(' canada 2026 email')
      await expect(
        page.getByRole('option', { name: /^Canada Spring Sale 2026 Email/ }),
      ).toBeVisible()
      await page.keyboard.press('Enter')
      await expect(stored(page)).toHaveText(
        '{"metrics":[],"dimensions":[],"dimensionValues":[{"dimension":"dim:campaign","value":"val:campaign/canada_spring_sale_2026_email"}]}',
      )
      // The list stays for the next value; an empty field and Backspace leave the dimension.
      await expect(list).toBeVisible()
      await field.fill('')
      await page.keyboard.press('Backspace')
      await expect(page.getByRole('status').first()).toHaveText(
        'Left Campaign. Searching everything.',
      )
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBe(0)
    })

    test('folds the chips after eight', async ({ page }) => {
      const field = scopeField(page)
      for (const name of [
        'Norway',
        'Spain',
        'Poland',
        'France',
        'Germany',
        'United Kingdom',
        'Netherlands',
        'Italy',
        'Canada',
        'Sweden',
      ]) {
        await field.fill(name)
        await page
          .getByRole('option', { name: new RegExp(`^${name}`) })
          .first()
          .click()
      }
      const chips = page.getByRole('list', { name: 'Chosen' }).first()
      await expect(chips.getByRole('listitem')).toHaveCount(8)
      await page.getByRole('button', { name: '+2 more' }).click()
      await expect(chips.getByRole('listitem')).toHaveCount(10)
      await expect(page.getByRole('button', { name: 'Show fewer' })).toBeVisible()
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow).toBe(0)
    })

    test('leaves a pasted list to the field and adds no chips', async ({ page }) => {
      const field = scopeField(page)
      await field.focus()
      const before = (await stored(page).textContent()) ?? ''
      expect(await paste(field, 'Norway, Spain\nXland')).toBe(false)
      await expect(stored(page)).toHaveText(before)
    })
  })
}

for (const theme of themes)
  test(`passes axe with the list open across dimensions and inside one (${theme})`, async ({
    page,
  }) => {
    await openPage(page, path, { ...widths[0], theme })
    const field = scopeField(page)
    await field.focus()
    await page.keyboard.type('nor')
    await expect(page.getByRole('option').first()).toBeVisible()
    expect(await axe(page)).toEqual([])
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Enter')
    await expect(page.getByRole('listbox', { name: /^Values of/ })).toContainText('1 to 12 of')
    expect(await axe(page)).toEqual([])
  })

test('reads an any-value chip as the dimension and any value', async ({ page }) => {
  await openPage(page, path, { ...widths[0], theme: 'light' })
  const chips = page.getByRole('list', { name: 'Chosen' }).last()
  await expect(chips).toContainText('Any market')
  await expect(page.getByRole('button', { name: 'Remove any market' })).toBeVisible()
})
