import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const storybook = `http://localhost:${process.env.PW_STORYBOOK_PORT ?? 4183}`

for (const theme of ['light', 'dark']) {
  for (const width of [1440, 390]) {
    test(`edition diff kit at ${width}, ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto(
        `${storybook}/iframe.html?id=release-edition-diff-kit--all-states&viewMode=story&globals=theme:${theme}`,
      )
      await expect(page.getByRole('article')).toHaveCount(6)
      await page.evaluate(() => document.fonts.ready)
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      const first = page.getByRole('article').nth(1)
      await expect(first.locator('del').first()).toContainText('one day')
      await expect(first.locator('ins').first()).toContainText('two days')
      const trigger = first.getByRole('button', { name: '3 fields the system fills in' })
      await trigger.focus()
      await page.keyboard.press('Enter')
      await expect(trigger).toHaveAttribute('aria-expanded', 'true')
      await expect(first.getByText('Source marks')).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true)
      const axe = await new AxeBuilder({ page })
        .include('#storybook-root')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(axe.violations).toEqual([])
      const screenshot = testInfo.outputPath(`edition-diff-${width}-${theme}.png`)
      await page.screenshot({ path: screenshot, fullPage: true })
      await testInfo.attach(`edition-diff-${width}-${theme}`, {
        path: screenshot,
        contentType: 'image/png',
      })
      await page.keyboard.press('Enter')
      await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    })
  }
}
