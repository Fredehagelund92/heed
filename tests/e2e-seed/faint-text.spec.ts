import { expect, test } from '@playwright/test'
import { contrast } from '../lint/contrast.ts'
import { paint } from '../e2e/paint.ts'

// J53, the View as avatar: the highlighted row of the demo's switch forces its own text
// colour, and the initials in it keep their ink on their tint, in light and dark. Only the demo
// shows the switch, so this runs on the seeded install (playwright.seed.config.ts).

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme })

    test('the initials of the highlighted View as row keep 4.5 to 1 on their tint', async ({
      page,
    }) => {
      await page.goto('/')
      await expect(page).toHaveURL(/\/inbox$/)
      await page.getByRole('button', { name: /^View as:/ }).click()
      const row = page.getByRole('menuitemradio', { checked: true })
      await row.hover()
      const initials = row.locator('[data-slot=avatar-fallback]')
      await expect(initials).toHaveText(/^[A-Z]{2}$/)
      const avatar = await paint(initials)
      expect(contrast(avatar.color.rgb, avatar.background.rgb)).toBeGreaterThanOrEqual(4.5)
    })
  })
}
