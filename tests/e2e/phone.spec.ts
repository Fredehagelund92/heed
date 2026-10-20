import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPage, routes, settle, themes, widths } from './support'

const sizes = [widths[0], widths[2]]
const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Checked once the sheet, menu or panel has faded in: mid fade, its text reads as low contrast. */
async function violations(page: Page) {
  await settle(page)
  return (await new AxeBuilder({ page }).withTags(wcag).analyze()).violations
}

async function touchTargets(targets: Locator) {
  for (const target of await targets.all()) {
    if (!(await target.isVisible())) continue
    const box = await target.boundingBox()
    expect(box?.height, (await target.textContent()) ?? 'Touch target').toBeGreaterThanOrEqual(44)
  }
}

for (const size of sizes) {
  for (const theme of themes) {
    for (const route of routes) {
      test(`${route.name}: shared phone layout stays within ${size.width}, ${theme}`, async ({
        page,
      }) => {
        await openPage(page, route.path, { ...size, theme })
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width)
        const header = page.locator('[data-layout="header"]')
        expect((await header.boundingBox())?.height).toBe(size.width === 390 ? 56 : 48)
        if (size.width === 390) await touchTargets(header.getByRole('button'))
      })
    }

    test(`filter sheet and menu at ${size.width}, ${theme}`, async ({ page }) => {
      await openPage(page, '/library', { ...size, theme })
      const filter = page.getByRole('button', { name: 'Filter', exact: true })
      await filter.click()
      const popup = page.locator('[data-slot="popover-content"]')
      await expect(popup).toBeVisible()
      if (size.width === 390) {
        const box = await popup.boundingBox()
        expect(box?.x).toBe(0)
        expect(box?.width).toBe(390)
        await expect(popup).toHaveCSS('padding-bottom', '12px')
        expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(size.height)
        await touchTargets(popup.locator('[data-slot="filter-option"], [role="tab"], button'))
      }
      await popup.getByRole('searchbox', { name: 'Find a filter' }).fill('source missing')
      await expect(
        popup.getByRole('checkbox', { name: 'Source missing', exact: true }),
      ).toBeVisible()
      expect(await violations(page)).toEqual([])
      await page.keyboard.press('Escape')
      await expect(popup).toBeHidden()
      await expect(filter).toBeFocused()
      await page.getByRole('button', { name: /^View:/ }).click()
      const menu = page.getByRole('menu').first()
      await expect(menu).toBeVisible()
      if (size.width === 390) {
        expect((await menu.boundingBox())?.width).toBe(390)
        await touchTargets(menu.locator('[role^="menuitem"]'))
      }
      expect(await violations(page)).toEqual([])
      await page.keyboard.press('Escape')
      await expect(menu).toBeHidden()
    })
  }
}

for (const theme of themes) {
  test(`phone navigation and panel contain focus and return it, ${theme}`, async ({ page }) => {
    await openPage(page, '/library', { ...widths[2], theme })
    await page.getByRole('button', { name: 'Open navigation' }).click()
    const navigation = page.getByRole('dialog', { name: 'Sidebar' })
    // The sheet is a chunk of its own: Escape before it arrives closes nothing, and the sheet
    // then opens over the list.
    await expect(navigation).toBeVisible()
    await touchTargets(navigation.getByRole('link'))
    await page.keyboard.press('Escape')
    await expect(navigation).toBeHidden()
    const row = page.locator('[data-row-id] a').first()
    await expect(row).toHaveCSS('font-size', '15px')
    await expect(row).toHaveCSS('font-weight', '400')
    await expect(
      page.locator('[data-row-id]').first().getByRole('img', { name: 'Accepted' }),
    ).toBeVisible()
    await expect(
      page.locator('[data-row-id]').first().getByText('Accepted', { exact: true }),
    ).toHaveCount(0)
    await row.click()
    const panel = page.locator('[data-slot="dock-panel"]')
    await expect(panel).toHaveAttribute('role', 'dialog')
    await expect(panel.getByRole('heading', { level: 2 })).toBeVisible()
    expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 })
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press('Tab')
      await expect
        .poll(() => panel.evaluate((element) => element.contains(document.activeElement)))
        .toBe(true)
    }
    expect(await violations(page)).toEqual([])
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
    await expect(row).toBeFocused()
  })
}

for (const theme of themes) {
  for (const path of ['/library', '/library/itm_hp8rnz8i']) {
    test(`phone content scrolls clear of the Assistant at ${path}, ${theme}`, async ({ page }) => {
      await openPage(page, path, { ...widths[2], theme })
      const content = page.locator('[data-slot="page"]')
      await expect(content).toHaveCSS('padding-bottom', '76px')
      const target =
        path === '/library'
          ? page.locator('[data-row-id]').last()
          : page.getByRole('complementary', { name: 'Fact details' }).getByRole('definition').last()
      await expect(target).toBeVisible()
      const launcher = page.getByRole('button', { name: 'Assistant', exact: true })
      await expect
        .poll(async () => {
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
          // The list renders the rows in view only: the row found can be swapped out before it
          // is measured, so the poll measures again.
          const row = await target.boundingBox()
          const button = await launcher.boundingBox()
          return Boolean(row && button && row.y >= 0 && row.y + row.height <= button.y)
        })
        .toBe(true)
    })
  }
}
