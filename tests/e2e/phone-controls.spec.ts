import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { openPage, routes, settle, themes, widths } from './support'

for (const theme of themes) {
  test(`phone command and select choices have touch targets, ${theme}`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_ravi'))
    await openPage(page, '/health', { ...widths[2], theme })
    await page.getByRole('combobox', { name: 'Domain', exact: true }).click()
    const options = page.locator('[data-slot="select-item"]')
    await expect(options.first()).toBeVisible()
    await settle(page)
    for (const option of await options.all())
      expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Command palette' })
    await expect(dialog).toBeVisible()
    await settle(page)
    await expect(dialog.locator('[data-slot="command-input"]')).toHaveCSS('font-size', '16px')
    for (const option of await dialog.getByRole('option').all())
      expect((await option.boundingBox())?.height).toBeGreaterThanOrEqual(44)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
  })
}

for (const theme of themes) {
  test(`phone calendar keeps typing available and gives days separate touch targets, ${theme}`, async ({
    page,
  }) => {
    await openPage(page, '/library/new', { ...widths[2], theme })
    const field = page.getByRole('textbox', { name: 'From', exact: true })
    await field.click()
    await expect(field).toBeFocused()
    const calendar = page.getByRole('grid')
    await expect(calendar).toBeVisible()
    await settle(page)
    const days = calendar.getByRole('button')
    for (const day of await days.all()) {
      const box = await day.boundingBox()
      expect(box?.height).toBeGreaterThanOrEqual(44)
      expect(box?.width).toBeGreaterThanOrEqual(44)
    }
    const first = await days.nth(0).boundingBox()
    const second = await days.nth(1).boundingBox()
    expect(first!.x + first!.width).toBeLessThanOrEqual(second!.x)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    await field.fill('4 Aug 2026')
    await field.press('Enter')
    await expect(calendar).toBeHidden()
    await expect(field).toHaveValue('4 Aug 2026')
  })
}

for (const theme of themes) {
  test(`phone overflow menu is keyboard scrollable, ${theme}`, async ({ page }) => {
    await openPage(page, '/library', { ...widths[2], theme })
    await page.getByRole('button', { name: 'Sort, group and density' }).click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu).toHaveAttribute('tabindex', '0')
    expect((await menu.boundingBox())?.width).toBe(390)
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([])
    await menu.focus()
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  })
}

/**
 * The way up on a phone (contract 8.11): beside the menu, a sidebar place shows its title and
 * anything deeper exactly one "‹ parent", never the trail. As the administrator, who has every
 * place and Administration's sections; the deeper pages add a record, a sub-page and a section.
 */
const phoneHeaders: { path: string; up: string | null }[] = [
  ...routes.map(({ path }) => ({
    path,
    up: path.startsWith('/settings')
      ? 'Settings'
      : path === '/admin'
        ? 'Administration'
        : path.startsWith('/docs/')
          ? 'Docs'
          : null,
  })),
  { path: '/library/itm_jyfuvl07', up: 'Library' },
  { path: '/library/itm_jyfuvl07/suggest', up: 'Guide' },
  { path: '/library?view=mine', up: 'Library' },
  { path: '/catalogue/metric/orders', up: 'Catalogue' },
  { path: '/proposals/00000000-0000-4000-8000-000000000035', up: 'Proposals' },
  { path: '/editions/2026-10-07.1', up: 'Editions' },
  { path: '/editions/compare', up: 'Editions' },
  { path: '/admin?section=audit', up: 'Administration' },
]

test('phone header shows the title on a place and one way up anywhere deeper', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cl.mock-person', 'per_ravi'))
  for (const { path, up } of phoneHeaders) {
    await openPage(page, path, { ...widths[2], theme: 'light' })
    const header = page.getByRole('banner')
    await expect(header.getByRole('button', { name: 'Open navigation' }), path).toBeVisible()
    const ups = header.getByRole('link', { name: /^Back to / })
    if (up) {
      await expect(ups, path).toHaveCount(1)
      await expect(ups, path).toHaveAccessibleName(`Back to ${up}`)
      await expect(header.getByRole('navigation', { name: 'breadcrumb' }), path).toBeHidden()
    } else {
      await expect(ups, path).toHaveCount(0)
      await expect(header.locator('[data-slot="breadcrumb-page"]'), path).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth), path).toBe(390)
  }
})
