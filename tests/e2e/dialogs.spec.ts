import { expect, test, type Locator, type Page } from '@playwright/test'
import { openPage, settle, themes, widths, type Theme } from './support'

/*
  Overlay widths (design contract, Containers): every dialog has a deliberate width that holds a
  16px gutter on each side on a phone. The palette and the shortcut sheet are `dialog-wide` (640),
  a dialog with a form or a question is `dialog` (480), a confirmation is `confirm` (420). This
  would have caught the palette stretching to the viewport, when the 16px gutter cap overrode the
  palette's own width and the dialog filled the screen.
*/

const GUTTER = 16
const PALETTE_TOP = 96

type Overlay = {
  name: string
  width: number
  /** Where it sits from the top, when it is not centred vertically. */
  top?: number
  open: (page: Page, view: View) => Promise<Locator>
}

type View = { width: number; height: number; theme: Theme }

const overlays: Overlay[] = [
  {
    name: 'command palette from the keyboard',
    width: 640,
    top: PALETTE_TOP,
    open: async (page, view) => {
      await openPage(page, '/', view)
      await page.keyboard.press('Control+k')
      return page.getByRole('dialog', { name: 'Command palette' })
    },
  },
  {
    name: 'command palette from the header',
    width: 640,
    top: PALETTE_TOP,
    open: async (page, view) => {
      await openPage(page, '/', view)
      await page.getByRole('button', { name: 'Search' }).click()
      return page.getByRole('dialog', { name: 'Command palette' })
    },
  },
  {
    name: 'keyboard shortcuts',
    width: 640,
    open: async (page, view) => {
      await openPage(page, '/library', view)
      await page.keyboard.press('Shift+Slash')
      return page.getByRole('dialog', { name: 'Keyboard shortcuts' })
    },
  },
  {
    name: 'leave with unsaved changes',
    width: 480,
    open: async (page, view) => {
      await openPage(page, '/library/new', view)
      await page
        .getByRole('textbox', { name: 'Summary', exact: true })
        .fill('An unsaved observation.')
      // On a phone the sidebar, and its Home link, is a sheet behind the menu button.
      const home = page.getByRole('link', { name: 'Home', exact: true })
      if (!(await home.isVisible()))
        await page.getByRole('button', { name: 'Open navigation' }).click()
      await home.click()
      return page.getByRole('dialog', { name: 'Leave with unsaved changes?' })
    },
  },
  {
    name: 'retire confirmation',
    width: 420,
    open: async (page, view) => {
      await page.addInitScript(() => window.localStorage.setItem('cl.mock-person', 'per_jon'))
      await openPage(page, '/library/itm_gjdvl50x', view)
      await page.getByRole('button', { name: 'More actions' }).click()
      await page.getByRole('menuitem', { name: 'Archive fact' }).click()
      return page.getByRole('alertdialog', { name: 'Archive this fact?' })
    },
  },
]

for (const size of widths) {
  for (const theme of themes) {
    for (const overlay of overlays) {
      test(`${overlay.name} is ${overlay.width} wide at ${size.name}px, ${theme}`, async ({
        page,
      }) => {
        const dialog = await overlay.open(page, { ...size, theme })
        await expect(dialog).toBeVisible()
        await settle(page)

        const box = await dialog.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { left: rect.left, right: rect.right, top: rect.top, width: rect.width }
        })
        const expected = Math.min(overlay.width, size.width - 2 * GUTTER)
        expect(box.width, 'the dialog has its contract width').toBeCloseTo(expected, 0)
        expect(
          Math.abs(box.left - (size.width - box.right)),
          'the dialog is centred',
        ).toBeLessThanOrEqual(1)
        expect(box.left, 'the dialog keeps the phone gutter').toBeGreaterThanOrEqual(GUTTER - 0.5)
        if (overlay.top !== undefined) expect(box.top, 'the palette sits high').toBe(overlay.top)
      })
    }
  }
}
