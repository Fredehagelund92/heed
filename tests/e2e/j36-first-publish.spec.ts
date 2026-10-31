import AxeBuilder from '@axe-core/playwright'
import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J36, writing a first context item: the editor starts in a domain that exists and says by name
// everything the service needs before Publish works (where it applies, a source and a sentence
// from it). A publish the service refuses says why in its own words, with Retry only where trying
// again can help; the live items it clashes with are answered right there, and it publishes.

async function violations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (v) => `${v.impact}: ${v.id} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`,
  )
}

const publish = (page: Page) => page.getByRole('button', { name: 'Publish', exact: true })

async function write(page: Page, title: string) {
  await page.getByRole('textbox', { name: 'Title' }).fill(title)
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText(`${title}, as the weekly report shows it.`)
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://reports.example/weekly')
}

test('a new item starts in a real domain and names what it still needs', async ({ page }) => {
  await go(page, '/context/new')
  // The domain has its name, never a bare dot.
  const domain = page.getByRole('button', { name: /^Domain/ })
  await expect(domain).toHaveAccessibleName(/^Domain \S/)
  await expect(domain).not.toContainText('Choose a domain')
  await expect(publish(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(publish(page)).toHaveAccessibleDescription(
    'Add a title, what agents should know, where it applies, a source first.',
  )

  await write(page, 'Orders are counted when they ship')
  await page.keyboard.press('Escape')
  // A source needs a sentence copied from it, and the item a place it applies: the service
  // refuses one without either, so Publish says so before it is pressed.
  await expect(publish(page)).toHaveAccessibleDescription(
    'Add where it applies, a sentence copied from the source first.',
  )
  await expect(page.getByText('Not ready: add where it applies')).toBeVisible()
  // Pressed anyway, it goes to the first thing missing.
  await publish(page).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /^Applies to/ })).toBeFocused()
})

/** A whole item about Orders, which other live items about Orders clash with. */
async function writeComplete(page: Page) {
  await go(page, '/context/new')
  await write(page, 'Orders are counted when they ship')
  await page.locator('#fact-quote').fill('An order counts on the day it ships.')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^Applies to/ }).click()
  await page.getByRole('combobox', { name: 'Search Applies to' }).fill('Orders')
  await page
    .getByRole('listbox', { name: 'Applies to' })
    .getByRole('option', { name: /^Orders/ })
    .first()
    .click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
  await expect(publish(page)).not.toHaveAttribute('aria-disabled', 'true')
}

/** No axe finding in the light theme or the dark one. */
async function readsInBothThemes(page: Page) {
  for (const dark of [false, true]) {
    await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark)
    // Colours ease into the theme: axe reads them once they have arrived.
    await page.waitForFunction(() =>
      document
        .getAnimations()
        .every((a) => a.playState !== 'running' || a.timeline !== document.timeline),
    )
    expect(await violations(page)).toEqual([])
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
}

test('a refused publish says why, and its clash is answered in place', async ({ page }) => {
  await writeComplete(page)

  // Other live items about Orders reach the same questions: the service asks how this relates to
  // them first, in its own words, and Retry, which would send the same thing again, is not offered.
  await publish(page).click()
  const before = page.getByRole('region', { name: 'Before it can be published' })
  await expect(before.getByRole('alert')).toContainText("Couldn't publish. Say how this relates to")
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await expect(page.getByText('Not published')).toBeVisible()
  const groups = before.getByRole('radiogroup')
  await expect(groups.first()).toBeVisible()
  await expect(publish(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(publish(page)).toHaveAccessibleDescription(/^Say how this relates to “.+” first\.$/)
  // The text is kept, and the answers make it publishable.
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue(
    'Orders are counted when they ship',
  )
  await readsInBothThemes(page)
  for (const group of await groups.all())
    await group.getByRole('radio', { name: 'Unrelated' }).click()
  await expect(before.getByRole('alert')).toHaveCount(0)
  await publish(page).click()
  await expect(page).toHaveURL(/\/context\/(?!new)[^/?]+$/)
  await expect(
    page.getByRole('heading', { level: 1, name: 'Orders are counted when they ship' }),
  ).toBeVisible()
})

test('on a phone the refusal and its answers are under the title', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await writeComplete(page)
  await publish(page).click()
  const before = page.getByRole('region', { name: 'Before it can be published' })
  await expect(before.getByRole('alert')).toBeInViewport()
  await expect(before.getByRole('radiogroup').first()).toBeVisible()
  await readsInBothThemes(page)
})
