import { expect, type Page } from '@playwright/test'

/** The page editor's text fields: the title, the summary zone and the body. */
export const titleField = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true })
export const summaryField = (page: Page) =>
  page.getByRole('textbox', { name: 'Summary', exact: true })
export const bodyField = (page: Page) => page.getByRole('textbox', { name: 'Body', exact: true })

/** Picks a kind from the kind chip above the title. */
export async function chooseKind(page: Page, kind: string) {
  await page.getByRole('combobox', { name: 'Kind', exact: true }).click()
  await page.getByRole('option', { name: new RegExp(`^${kind}`) }).click()
}

export async function fillContext(
  page: Page,
  { issue = false, mention = false, title = true } = {},
) {
  if (issue) await chooseKind(page, 'Issue')
  if (title) await titleField(page).fill('Reporting delay in Norway')
  const summary = summaryField(page)
  await summary.fill('A reporting delay affected ')
  if (mention) {
    await summary.pressSequentially('@North')
    await expect(
      page.getByRole('listbox', { name: 'Mention a metric, value, fact or domain' }),
    ).toBeVisible()
    await summary.press('Enter')
    await summary.pressSequentially('during the source update.')
  } else await summary.fill('A reporting delay affected Norway during the source update.')
  const scope = page.getByRole('combobox', { name: 'Where it applies', exact: true })
  await scope.fill('Orders')
  await expect(page.getByRole('option', { name: /^Orders/ }).first()).toBeVisible()
  await scope.press('Enter')
  await scope.fill('Norway')
  await expect(page.getByRole('option', { name: /^Norway/ }).first()).toBeVisible()
  await scope.press('Enter')
  await page
    .getByRole('textbox', { name: issue ? 'Started' : 'From', exact: true })
    .fill('4 Aug 2026')
  await page.getByRole('textbox', { name: issue ? 'Started' : 'From', exact: true }).press('Tab')
  await page
    .getByRole('textbox', { name: 'Link to the source', exact: true })
    .fill('https://regulator.example/notice')
  await page
    .getByRole('textbox', { name: 'A sentence copied from the source', exact: true })
    .fill('Reporting was delayed while the source was updated.')
  await page.getByRole('textbox', { name: 'Date you read it', exact: true }).fill('5 Aug 2026')
  await page.getByRole('textbox', { name: 'Date you read it', exact: true }).press('Tab')
  await page.getByRole('combobox', { name: /^Domain/ }).click()
  await page.getByRole('option', { name: 'Sales', exact: true }).click()
}

export async function waitForSaved(page: Page) {
  await expect(page).toHaveURL(/draft=/)
  await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute(
    'data-status',
    'saved',
  )
}

/** The draft as the form last kept it on this device: the local copy autosave writes. */
export async function storedDraft(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((name) => name.startsWith('heed.context.'))
    return key
      ? (JSON.parse(localStorage.getItem(key) ?? '{}') as {
          title: string
          summaryMarkup: string
          bodyMarkup: string
        })
      : null
  })
}

/**
 * A day field is a date picker (DateField): its calendar button shows, a click in the text opens
 * the calendar and leaves the focus in the text, and Escape closes it again.
 */
export async function expectDatePicker(page: Page, name: string | RegExp) {
  const input = page.getByRole('textbox', { name, exact: typeof name === 'string' })
  const field = page.locator('[data-slot="date-field"]').filter({ has: input })
  await expect(field.getByRole('button', { name: /^Choose/ })).toBeVisible()
  await input.click()
  await expect(page.getByRole('grid')).toBeVisible()
  await expect(input).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('grid')).toBeHidden()
  await expect(input).toBeFocused()
}
