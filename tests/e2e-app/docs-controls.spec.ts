import { docControls } from './docs-controls.ts'
import { expect, go, test } from './go.ts'

// The docs name controls in bold, in the words of the screen (docs/help/README.md). Each one named
// there is drawn on its screen, as a control or as the words of a row, found by its accessible name
// or its visible text; a failure names the page that promises it.

for (const { phrase, page: doc, at, drawn, open } of docControls)
  test(`${doc}.md: **${phrase}** is on ${at}`, async ({ page }) => {
    await go(page, at)
    if (open) await page.getByRole('button', { name: new RegExp(`^${open}\\b`) }).click()
    const scope = page.locator('body')
    const exact = { name: phrase, exact: true }
    const found =
      drawn === 'button'
        ? scope.getByRole('button', exact)
        : drawn === 'link'
          ? scope.getByRole('link', exact)
          : drawn === 'option'
            ? scope.getByRole('option', { name: new RegExp(`^${phrase}\\b`) })
            : scope.getByText(phrase, { exact: true })
    await expect(found.first(), `${doc}.md names **${phrase}**`).toBeVisible()
  })
