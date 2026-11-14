import { contrast } from '../lint/contrast.ts'
import { expect, go, test } from './go.ts'
import { pageSurface, paint } from './paint.ts'

// J53, the text a reader needs stays readable: the title hint of the editor and a switched-off
// button keep 4.5 to 1 against the page, in light and dark, and a switched-off control keeps its
// text at full strength instead of fading. The View as avatar, which only the demo shows, is
// checked in tests/e2e-seed/faint-text.spec.ts.

const AA_TEXT = 4.5

test.describe('faint text keeps 4.5 to 1 in both themes', () => {
  for (const colorScheme of ['light', 'dark'] as const) {
    test.describe(colorScheme, () => {
      test.use({ colorScheme })

      test('the title hint is the muted grey, not a faded one', async ({ page }) => {
        await go(page, '/context/itm_norway_stop/edit')
        const title = page.getByRole('textbox', { name: 'Title' })
        await expect(title).toHaveAttribute('placeholder', 'What should agents know?')
        const hint = await paint(title, '::placeholder')
        expect(hint.opacity).toBe('1')
        expect(contrast(hint.color.rgb, await pageSurface(page))).toBeGreaterThanOrEqual(AA_TEXT)
      })

      test('a switched-off button keeps its text at full strength', async ({ page }) => {
        await go(page, '/observability')
        const save = page.getByRole('button', { name: 'Save this view' })
        await expect(save).toHaveAttribute('aria-disabled', 'true')
        const off = await paint(save)
        expect(off.opacity).toBe('1')
        expect(contrast(off.color.rgb, await pageSurface(page))).toBeGreaterThanOrEqual(AA_TEXT)
      })
    })
  }
})
