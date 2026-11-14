import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J48, the views a definitions tool reads: an admin changes Cube from every view to only the views
// they choose, out of a model of hundreds (the mock's ?views=many), with a search and what each view
// holds; leaving a view out makes it a list; Continue waits for a view; the review names the views left out and the live items that
// rely on them, and Save waits until the admin says they have seen those. At 390 and 1440 wide,
// in light and dark, nothing is wider than the screen and axe finds nothing.

const widths = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const
const themes = ['light', 'dark'] as const

/** Whether the page is no wider than the screen. */
const fitsTheScreen = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)

async function violations(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.impact}: ${violation.id} (${violation.nodes.map((node) => node.target.join(' ')).join(', ')})`,
  )
}

for (const { name, width, height } of widths) {
  for (const theme of themes) {
    test.describe(`${name}, ${theme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: theme })

      test('chooses a few views of hundreds, sees what they leave out, and saves the list', async ({
        page,
      }) => {
        await go(page, `/settings/integrations/cube/connect?step=3&views=many&theme=${theme}`)
        const button = (label: string) => page.getByRole('button', { name: label, exact: true })
        const views = page.getByRole('list', { name: 'Views to read' })
        const counted = page.locator('p[aria-live=polite]')
        // Every view at first, as Cube reads now: each one the model has, ticked.
        const every = page.getByRole('radio', { name: /^Every view/ })
        const only = page.getByRole('radio', { name: /^Only the views you choose/ })
        await expect(every).toBeChecked()
        await expect(counted).toHaveText('455 of 455 views chosen')
        // Leaving one out makes it a list of the views chosen; Every view ticks them all again.
        await views.getByRole('checkbox', { name: 'segments 5 dimensions' }).uncheck()
        await expect(only).toBeChecked()
        await expect(counted).toHaveText('454 of 455 views chosen')
        await page.getByText('Every view', { exact: true }).click()
        await expect(every).toBeChecked()
        await expect(counted).toHaveText('455 of 455 views chosen')
        await page.getByText('Only the views you choose').click()
        await expect(only).toBeChecked()
        // A long list shows its first 50 and grows with Show more, so the page scrolls, not a box.
        await expect(views.getByRole('listitem')).toHaveCount(50)
        await page.getByRole('button', { name: /^Show 100 more/ }).click()
        await expect(views.getByRole('listitem')).toHaveCount(150)
        // Each view says what it holds.
        await expect(
          views.getByRole('checkbox', { name: 'orders 2 metrics, 1 dimension' }),
        ).toBeChecked()
        await button('Clear').click()
        await expect(counted).toHaveText('0 of 455 views chosen')
        await expect(button('Continue')).toBeDisabled()
        await expect(page.getByText('Choose at least one view.', { exact: false })).toBeVisible()
        // A search narrows the list; Choose ticks what it shows, and only that.
        const search = page.getByRole('searchbox', { name: 'Search views' })
        await search.fill('coast_orders')
        await expect(views.getByRole('listitem')).toHaveCount(7)
        await button('Choose 7 shown').click()
        await expect(counted).toHaveText('7 of 455 views chosen, 7 shown')
        await search.fill('nothing_like_it')
        await expect(page.getByText('No view matches “nothing_like_it”.')).toBeVisible()
        await search.fill('')
        await views.getByRole('checkbox', { name: 'orders 2 metrics, 1 dimension' }).check()
        await expect(counted).toHaveText('8 of 455 views chosen')
        expect(await fitsTheScreen(page)).toBe(true)
        expect(await violations(page)).toEqual([])

        await button('Continue').click()
        await button('Continue').click()
        // The review names the views it stops reading and the live items that rely on them.
        const left = page.getByRole('region', { name: 'It stops reading 6 views of Cube' })
        await expect(left).toBeVisible()
        await expect(left).toContainText('revenue, basket, customers, marketing, operations')
        await expect(left).toContainText('and 1 more')
        const items = left.getByRole('list', { name: 'Live items that rely on them' })
        await expect(items.getByRole('link').first()).toBeVisible()
        await page.getByLabel('Why are you changing it?').fill('Only the views the team uses')
        const save = button('Save changes')
        await expect(save).toBeDisabled()
        await left.getByRole('checkbox').check()
        await expect(save).toBeEnabled()
        expect(await fitsTheScreen(page)).toBe(true)
        expect(await violations(page)).toEqual([])
        await save.click()

        // Its page reads the views chosen, and only those.
        await expect(page).toHaveURL(/\/settings\/integrations\/cube$/)
        const read = page.getByRole('table').getByRole('row')
        await expect(read).toHaveCount(9)
        await expect(read.filter({ hasText: 'coast_orders_kiosk' })).toBeVisible()
        await expect(read.filter({ hasText: 'revenue' })).toHaveCount(0)
      })
    })
  }
}

test('stepping Back to the settings and on again keeps the views chosen', async ({ page }) => {
  await go(page, '/settings/integrations/cube/connect?step=3&views=many')
  const button = (label: string) => page.getByRole('button', { name: label, exact: true })
  const counted = page.locator('p[aria-live=polite]')
  await expect(counted).toHaveText('455 of 455 views chosen')
  await button('Clear').click()
  await page.getByRole('searchbox', { name: 'Search views' }).fill('coast_orders')
  await button('Choose 7 shown').click()
  await page.getByRole('searchbox', { name: 'Search views' }).fill('')
  await expect(counted).toHaveText('7 of 455 views chosen')
  // Back to the settings, then on again: nothing was changed, so nothing is chosen anew.
  await button('Back').click()
  await expect(page).toHaveURL(/step=2/)
  await button('Back').click()
  await expect(page).toHaveURL(/step=1/)
  await button('Continue').click()
  await button('Continue').click()
  await expect(page).toHaveURL(/step=3/)
  await expect(counted).toHaveText('7 of 455 views chosen')
  await expect(page.getByRole('radio', { name: /^Only the views you choose/ })).toBeChecked()
  // The browser's own Back and Forward do the same.
  await page.goBack()
  await expect(page).toHaveURL(/step=2/)
  await page.goForward()
  await expect(page).toHaveURL(/step=3/)
  await expect(counted).toHaveText('7 of 455 views chosen')
})
