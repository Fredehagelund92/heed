import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J31: an owner says where an item applies down to one value of a dimension too large to list
// (FR-107, FR-126): the picker searches on the server, groups what it finds by dimension with a
// count, opens one dimension as a list it reads a page at a time, and keeps a dimension's "any
// value" and its values apart. What was chosen comes back first the next time. The text's @ list
// finds the same values.

/** axe on the page with the picker open, as the suite checks every place (accessibility.md). */
async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (v) => `${v.impact}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  )
}

test('an owner scopes an item to one campaign, searched on the server', async ({ page }) => {
  await go(page, '/context/itm_norway_stop/edit')
  const field = page.getByRole('button', { name: /^Applies to/ })
  const chip = (words: string) => page.getByRole('button', { name: `Remove ${words}`, exact: true })
  await expect(chip('Orders')).toBeVisible()
  await expect(chip('Market: Norway')).toBeVisible()

  // Until something is typed, only what the person chose lately (Jon's drafts on the service; none
  // yet in the mock): a dimension can hold thousands of values.
  await field.click()
  const search = page.getByRole('combobox', { name: 'Search Applies to' })
  await expect(search).toBeFocused()
  const list = page.getByRole('listbox', { name: 'Applies to' })
  await expect(
    list
      .getByRole('group', { name: 'Recent', exact: true })
      .or(list.getByText('Type to find a metric, a dimension or one of its values.')),
  ).toBeVisible()
  expect(await list.getByRole('group').count()).toBeLessThanOrEqual(1)
  expect(await list.getByRole('option').count()).toBeLessThanOrEqual(6)

  // Words find a few values per dimension, with how many match, never the whole dimension.
  await search.fill('spring sale 2026')
  const campaigns = list.getByRole('group', { name: 'Campaign 60 matches' })
  await expect(campaigns.getByRole('option', { name: 'Campaign: any value' })).toBeVisible()
  expect(await list.getByRole('option').count()).toBeLessThan(12)
  expect(await violations(page)).toEqual([])

  // Inside the dimension: its matching values, a page at a time, searched as you type.
  await campaigns.getByRole('option', { name: 'All 60 matches in Campaign' }).click()
  const values = page.getByRole('listbox', { name: 'Values of Campaign' })
  await expect(values.getByRole('option').first()).toHaveAttribute('aria-setsize', '60')
  expect(await values.getByRole('option').count()).toBeLessThan(30)
  expect(await violations(page)).toEqual([])
  const inside = page.getByRole('combobox', { name: 'Search the values of Campaign' })
  await inside.fill('norway spring sale 2026 email')
  await values.getByRole('option', { name: 'Norway Spring Sale 2026 Email' }).click()
  await expect(
    values.getByRole('option', { name: 'Norway Spring Sale 2026 Email' }),
  ).toHaveAttribute('aria-selected', 'true')
  // Backspace in the empty box leaves the dimension.
  await inside.fill('')
  await inside.press('Backspace')
  await expect(search).toBeFocused()

  // "Any value" of a dimension replaces its values, and a value its "any value" (FR-126).
  await search.fill('market')
  await list.getByRole('option', { name: 'Market: any value' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'It replaces 1 value of Market.' }),
  ).toBeAttached()
  await expect(chip('Market: Norway')).toHaveCount(0)
  await expect(chip('Market: any value')).toBeVisible()
  await search.fill('norge')
  // Another name finds the value and says so.
  await list.getByRole('option', { name: 'Norway also Norge' }).click()
  await expect(
    page.getByRole('status').filter({ hasText: 'It replaces Market: any value.' }),
  ).toBeAttached()
  await search.press('Escape')
  await expect(chip('Market: any value')).toHaveCount(0)
  await expect(chip('Market: Norway')).toBeVisible()
  await expect(chip('Campaign: Norway Spring Sale 2026 Email')).toBeVisible()

  // The text's @ list finds the same values, each named with its dimension.
  const text = page.getByRole('textbox', { name: 'What agents should know' })
  await text.click()
  await text.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End')
  await text.pressSequentially(' Its last campaign was @norway spring sale 2026 em')
  await expect(
    page.getByRole('option', { name: /Norway Spring Sale 2026 Email\s*Campaign/ }),
  ).toBeVisible()
  await text.press('Enter')

  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page).toHaveURL(/\/context\/itm_[a-z0-9_]+$/)
  // The item says what it applies to, the campaign as a value of its dimension, and its text
  // mentions the campaign.
  await expect(
    page.getByRole('main').getByText('Its last campaign was Norway Spring Sale 2026 Email'),
  ).toBeVisible()
  await page.getByRole('button', { name: /^Details/ }).click()
  await expect(page.getByTitle('Campaign: Norway Spring Sale 2026 Email')).toBeVisible()
  await expect(page.getByTitle('Market: Norway', { exact: true })).toBeVisible()

  // Opened again, it keeps them, and what was just chosen comes first in the picker.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await expect(chip('Campaign: Norway Spring Sale 2026 Email')).toBeVisible()
  await page.getByRole('button', { name: /^Applies to/ }).click()
  const recent = page.getByRole('group', { name: 'Recent', exact: true })
  await expect(recent.getByRole('option', { name: 'Norway Spring Sale 2026 Email' })).toBeVisible()
  await expect(
    recent.getByRole('option', { name: 'Norway Spring Sale 2026 Email' }),
  ).toHaveAttribute('aria-selected', 'true')
})

for (const { name, width, height } of [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`the picker passes axe at ${name}, ${theme}: grouped, and inside a dimension`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme: theme })
      await go(page, `/context/itm_norway_stop/edit?theme=${theme}`)
      await page.getByRole('button', { name: /^Applies to/ }).click()
      await page.getByRole('combobox', { name: 'Search Applies to' }).fill('norway spring')
      const all = page.getByRole('option', { name: /^All \d+ matches in Campaign$/ })
      await expect(all).toBeVisible()
      expect(await violations(page)).toEqual([])
      await all.click()
      await expect(
        page.getByRole('listbox', { name: 'Values of Campaign' }).getByRole('option').first(),
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
    })
  }
}
