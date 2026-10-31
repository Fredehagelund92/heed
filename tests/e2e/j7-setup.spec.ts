import { expect, go, inHttpOnly, inMockUntil, test } from './go.ts'

// J7: a new workspace reaches its first grounded answer: write first, connect later, about ten actions.
test('a new workspace gets its first grounded answer', async ({ page }) => {
  await go(page, '/inbox?demo=setup')
  // The checklist says where the first item goes, for this person: the service's new install has
  // no domain yet, the mock's keeps Jon's Sales.
  await inHttpOnly('new install with no domain yet', () =>
    expect(page.getByText(/Context goes to a domain, and there is none yet/)).toBeVisible(),
  )
  await page.getByRole('button', { name: 'Write', exact: true }).click()
  const about = page.getByRole('textbox', { name: 'About our business' })
  await about.click()
  // Typed as one input, as a paste would be: key by key, a loaded machine ran past the time limit.
  await page.keyboard.insertText('We are an outdoor-gear retailer with a webshop and stores.')
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  // Back on the checklist, What the business is about counts as written.
  await expect(page.getByText('1 of 5 done')).toBeVisible()
  // A new install on the service has no domain yet to write context in: Domains and owners in
  // Settings make the first one. The mock's new install keeps the demo's domains.
  await inHttpOnly('first domain, made in Settings, Domains and owners', async () => {
    await go(page, '/settings/domains/new')
    await page.getByRole('textbox', { name: 'Name' }).fill('Sales')
    await page.getByRole('button', { name: 'Add the domain' }).click()
    await expect(page).toHaveURL(/\/settings\/domains\/sales$/)
    await go(page, '/inbox')
    await expect(page.getByText('1 of 5 done')).toBeVisible()
  })
  await expect(page.getByText(/Context goes to the domain Sales, /)).toBeVisible()
  // The first context item, complete as the service needs it: where it applies, and a source with
  // a sentence copied from it. Where it applies is named from the definitions, which the service's
  // new install has none of until they are connected: the editor says so, and the item waits.
  await page.getByRole('button', { name: 'Write context', exact: true }).click()
  await inHttpOnly('new install with no definitions yet', async () => {
    await expect(
      page.getByRole('button', { name: 'Publish', exact: true }),
    ).toHaveAccessibleDescription(
      /Where it applies is named from your definitions: connect them in Settings, Integrations\.$/,
    )
  })
  await inMockUntil('a follow-up to this journey', 'the definitions connected first', async () => {
    await page
      .getByRole('textbox', { name: 'Title' })
      .fill('Orders in Norway fell after the customs stop')
    const text = page.getByRole('textbox', { name: 'What agents should know' })
    await text.click()
    await page.keyboard.insertText(
      'Orders in Norway fell to almost nothing after a customs rule stopped online sales on 4 August 2026.',
    )
    await page.getByRole('button', { name: /^Applies to/ }).click()
    await page.getByRole('combobox', { name: 'Search Applies to' }).fill('Orders')
    await page
      .getByRole('listbox', { name: 'Applies to' })
      .getByRole('option', { name: /^Orders/ })
      .first()
      .click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Add a source/ }).click()
    await page.locator('#fact-source').fill('https://customs.example/norway')
    await page.locator('#fact-quote').fill('Online sales to Norway stopped on 4 August 2026.')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    // Published in one step, the checklist counts the first context item written.
    await expect(page.getByText('2 of 5 done')).toBeVisible()
  })
  await inMockUntil('P10', 'Ask', async () => {
    await page.getByRole('button', { name: 'Ask', exact: true }).click()
    const box = page.getByRole('textbox', { name: 'Ask a question' })
    await box.click()
    await box.press('End')
    await box.press('Enter')
    await expect(page.getByRole('log').getByText('Checked', { exact: true })).toBeVisible()
  })
})
