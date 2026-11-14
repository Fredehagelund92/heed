import type { Locator, Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J53, one colour per meaning (design contract 2.1): blue is for acting and for what is selected,
// green for what is checked and in force. A Checked answer is green wherever it shows: its chip,
// the chart's bars and their legend. A card not opened yet has a dot in the ink, and a domain's dot
// is never the accent blue. Both themes.

/** A token's colour as the page computes it, written the way an element's own colour is. */
const token = (page: Page, name: string) =>
  page.evaluate((name) => {
    const probe = document.createElement('span')
    probe.style.color = `var(${name})`
    document.body.append(probe)
    const colour = getComputedStyle(probe).color
    probe.remove()
    return colour
  }, name)

/** The hue of a colour, in degrees of oklch. */
const hueOf = (page: Page, colour: string) =>
  page.evaluate((colour) => {
    const probe = document.createElement('span')
    probe.style.color = `oklch(from ${colour} l c h)`
    document.body.append(probe)
    const [, , h] = getComputedStyle(probe)
      .color.match(/[\d.]+/g)!
      .map(Number)
    probe.remove()
    return h!
  }, colour)

const css = (el: Locator, property: string) =>
  el.evaluate((el, property) => getComputedStyle(el).getPropertyValue(property), property)

for (const theme of ['light', 'dark'] as const)
  test.describe(theme, () => {
    test.use({ colorScheme: theme })

    test('a Checked answer is green: its chip, the bars and the legend', async ({ page }) => {
      await go(page, '/ask')
      if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
      else await expect(page.locator('html')).not.toHaveClass(/dark/)
      const good = await token(page, '--good')
      expect(good).not.toBe(await token(page, '--primary'))

      // The chip of a topic that Ask answers from checked context.
      const week = page.getByRole('region', { name: 'Asked this week' })
      const chip = week.getByText('Checked', { exact: true }).first()
      await expect(chip).toBeVisible()
      expect(await css(chip.locator('xpath=..').locator('svg').first(), 'color')).toBe(good)

      // Observability's chart: every Checked part of a bar, and its square in the legend.
      await go(page, '/observability')
      const bars = page.locator('[data-part="grounded"]')
      await expect(bars.first()).toBeAttached()
      for (const bar of await bars.all()) expect(await css(bar, 'fill')).toBe(good)
      const legend = page.getByRole('listitem').filter({ hasText: /^Checked$/ })
      await expect(legend.first()).toBeVisible()
      for (const item of await legend.all())
        expect(await css(item.locator('rect'), 'fill')).toBe(good)
    })

    test('blue is for acting: the unread dot is the ink, and no domain dot is the accent', async ({
      page,
    }) => {
      await go(page, '/inbox')
      const unread = page.getByLabel('Not opened yet').first()
      await expect(unread).toBeVisible()
      expect(await css(unread, 'background-color')).toBe(await token(page, '--foreground'))

      // Sales, the domain of the card the quick view opens on, was the accent's own hue.
      const dots = page.locator('.bg-chip-dot')
      await expect(dots.first()).toBeVisible()
      const accent = await hueOf(page, 'var(--primary)')
      for (const dot of await dots.all()) {
        const hue = await hueOf(page, await css(dot, 'background-color'))
        const apart = Math.min(Math.abs(hue - accent), 360 - Math.abs(hue - accent))
        expect(apart, `a domain dot at hue ${hue}, the accent is ${accent}`).toBeGreaterThan(30)
      }
    })
  })
