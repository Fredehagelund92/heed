import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// axe on every place of the app, at 390 and 1440 wide, in light and dark (docs/design/
// accessibility.md, "The gates"): WCAG 2.2 AA, and no finding of any weight. The overlays an
// address opens (the palette, the keys, Report a problem, Connect an agent) and a peek in the dock
// are checked too, and the Help menu once per width and theme.

const places = [
  '/signin',
  '/inbox',
  '/inbox?card=sug-ines',
  '/inbox?demo=setup',
  '/inbox/sug-ines/review',
  '/inbox/sug-sofia-clash/review',
  '/inbox/gap-spain/review',
  '/context',
  '/context?dock=context.itm_norway_stop',
  '/context/itm_norway_stop',
  '/context/itm_norway_stop/edit',
  '/context/itm_norway_stop/suggest',
  '/context/new',
  '/definitions',
  '/definitions?dock=def.Orders',
  '/definitions/Orders',
  '/definitions/Webshop/edit',
  '/definitions/new',
  '/ask',
  '/ask?example=grounded',
  '/ask?example=missing',
  '/observability/overview',
  '/observability/questions',
  '/observability/quality',
  '/observability/feedback',
  '/observability/usage',
  '/observability/alerts',
  '/settings/general',
  '/settings/people',
  '/settings/domains',
  '/settings/domains/sales',
  '/settings/domains/new',
  '/settings/agents',
  '/settings/integrations',
  '/settings/integrations/cube',
  '/settings/integrations/cube/connect',
  '/settings/advanced',
  '/help',
  '/docs',
  '/docs/connect-an-agent',
  '/inbox?open=palette',
  '/inbox?open=shortcuts',
  '/inbox?open=report',
  '/settings/agents?open=connect',
]

const widths = [
  { name: '390', width: 390, height: 844 },
  { name: '1440', width: 1440, height: 900 },
] as const
const themes = ['light', 'dark'] as const

const withTheme = (place: string, theme: string) =>
  `${place}${place.includes('?') ? '&' : '?'}theme=${theme}`

/**
  Wait until the fonts are in and nothing moves, so axe reads the colours a person sees. An
  animation tied to scrolling (the editor toolbar's edge fade) runs as long as the page is open and
  only moves when someone scrolls, so it does not count.
*/
async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' || animation.timeline !== document.timeline,
      ),
  )
}

async function violations(page: Page) {
  await settle(page)
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

      for (const place of places) {
        test(place, async ({ page }) => {
          await page.goto(withTheme(place, theme))
          await expect(page.locator('main, [role=main], h1').first()).toBeVisible()
          expect(await violations(page)).toEqual([])
        })
      }

      test('the Help menu, open', async ({ page }) => {
        await page.goto(withTheme('/inbox', theme))
        if (width < 768) await page.getByRole('button', { name: /menu/i }).first().click()
        await page
          .locator('[data-sidebar=sidebar]')
          .last()
          .getByRole('button', { name: 'Help' })
          .click()
        await expect(page.getByRole('menu')).toBeVisible()
        expect(await violations(page)).toEqual([])
      })
    })
  }
}
