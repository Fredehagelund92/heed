import { expect, go, test } from './go.ts'

// J46, the card that makes a source's definitions usable (FR-141): the names a read made wait in
// one card at the top of the Inbox. Publish all takes what is ready; a name that would give a word
// a second meaning waits for a look and is never picked; a date stays out by itself. The whole way
// from a connected tool to a Checked answer, on the service, is the own-data journey (tests/e2e-own).

test('an owner accepts the ready names with one press, and looks at the rest', async ({ page }) => {
  await go(page, '/inbox?demo=names')
  const main = page.getByRole('main')
  await expect(main.getByText('5 names from dbt').first()).toBeVisible()
  await expect(main.getByText('2 ready to publish, 3 to look at first.')).toBeVisible()

  // It is the first card, and it opens on its own.
  const flagged = main.getByRole('region', { name: 'Look at these first' })
  await expect(flagged.getByRole('listitem')).toHaveCount(3)
  await expect(flagged.getByRole('listitem').first()).toContainText('orders.basket_value')
  await expect(flagged).toContainText('Another definition is called “Total”')
  await expect(flagged).toContainText('“Basket value” is already a name for Average order value.')

  // Publish all leaves what needs a look: it is never picked.
  await main.getByRole('button', { name: 'Publish all' }).click()
  await expect(page.getByText('2 names are live')).toBeVisible()
  await expect(flagged.getByRole('listitem')).toHaveCount(3)

  // A word with another meaning is refused until it is changed, and says who has it.
  const held = flagged.getByRole('listitem').filter({ hasText: 'Basket value' })
  await held.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(held.getByRole('alert')).toContainText('already a name for Average order value')
  await held.getByRole('textbox').fill('Order basket')
  await held.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(page.getByText('Order basket is live')).toBeVisible()
  await expect(flagged.getByRole('listitem')).toHaveCount(2)

  // Left out: a date stays out by itself, and what an owner leaves out joins it.
  await flagged
    .getByRole('listitem')
    .first()
    .getByRole('button', { name: 'Leave out', exact: true })
    .click()
  await expect(flagged).toBeHidden()
  await main.getByRole('button', { name: /Left out/ }).click()
  await expect(main.getByRole('textbox', { name: 'Name for orders.paid_at' })).toHaveValue(
    'Paid at',
  )
})

test('an owner leaves one ready name out, and can still edit and publish it from the fold', async ({
  page,
}) => {
  await go(page, '/inbox?demo=names')
  const main = page.getByRole('main')
  const ready = main.getByRole('region', { name: 'Ready to publish' })
  await expect(ready.getByRole('listitem')).toHaveCount(2)
  await ready
    .getByRole('listitem')
    .filter({ hasText: 'Completed orders' })
    .getByRole('button', { name: 'Leave out', exact: true })
    .click()
  await expect(page.getByText('Completed orders is left out')).toBeVisible()
  await expect(ready.getByRole('listitem')).toHaveCount(1)

  await main.getByRole('button', { name: /Left out/ }).click()
  const row = main.getByRole('textbox', { name: 'Name for orders.completed_orders' })
  await row.fill('Finished orders')
  await row.locator('xpath=ancestor::li').getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText('Finished orders is live')).toBeVisible()
})
