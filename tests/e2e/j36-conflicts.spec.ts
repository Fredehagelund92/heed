import type { Page } from '@playwright/test'
import { card, expect, go, onMockOnly, signInAs, test } from './go.ts'

// J36, the conflict view (FR-220): two items an owner said disagree, side by side with where each
// comes from and what agents would say with only that one, and ways to settle it. Every choice asks
// why and shows what agents will then say; the outcome stays in place with Undo. Someone who owns
// one side sees which buttons cannot act and why. The same view is a page under Context and the
// conflict dock, and the Conflicts view of the Context list leads to it.

/** Opens the Norway pair from the Conflicts list, as a person finds it, in either mode. */
async function openNorway(page: Page) {
  await go(page, '/context/conflicts?whose=all')
  await page.getByRole('link', { name: 'Orders in Norway' }).click()
  await expect(page).toHaveURL(/dock=conflict\./)
  const dock = page.getByRole('region', { name: 'Conflict', exact: true })
  await expect(
    dock.getByRole('heading', { name: 'Two items say different things about Orders in Norway.' }),
  ).toBeVisible()
  return dock
}

test('the Conflicts view lists the pairs, most asked first, and opens one in the dock', async ({
  page,
}) => {
  await go(page, '/context')
  await page.getByRole('radio', { name: /^Conflicts/ }).click()
  await expect(page).toHaveURL(/\/context\/conflicts/)
  await expect(page.getByRole('cell', { name: 'Orders in Norway' })).toBeVisible()
  const dock = await openNorway(page)
  // Grey words come with a legend and, for a screen reader, the words in both.
  await expect(
    dock.getByText('are in both. The words in full ink are where they part.'),
  ).toBeVisible()
  await expect(dock.getByText(/^Words in both: Orders in Norway/).first()).toBeAttached()
  await expect(dock.getByText('If agents got only this one').first()).toBeVisible()
  // The dock expands to the pair's own page.
  await page.getByRole('button', { name: 'Open the page' }).click()
  await expect(page).toHaveURL(/\/context\/conflicts\/itm_/)
  await expect(
    page.getByRole('heading', { name: 'Two items say different things about Orders in Norway.' }),
  ).toBeVisible()
})

test('keep both: the reason box shows what agents will then say, the outcome stays in place, and Undo puts it back', async ({
  page,
}) => {
  const dock = await openNorway(page)
  await dock.getByRole('button', { name: 'Keep both' }).click()
  const box = page.getByRole('dialog', { name: 'Keep both' })
  await expect(box.getByText('Agents will then say')).toBeVisible()
  await expect(box.getByRole('button', { name: 'Keep both' })).toBeDisabled()
  await box.getByLabel('Why do both stay?').fill('Both hold until Finance rules on it.')
  // Esc closes the box and keeps what was written.
  await page.keyboard.press('Escape')
  await expect(box).toBeHidden()
  await dock.getByRole('button', { name: 'Keep both' }).click()
  await expect(box.getByLabel('Why do both stay?')).toHaveValue(
    'Both hold until Finance rules on it.',
  )
  await page.keyboard.press('ControlOrMeta+Enter')
  const outcome = page
    .getByRole('status')
    .filter({ hasText: 'Kept both. Agents keep saying Conflict' })
  await expect(outcome).toBeVisible()
  await expect(outcome).toContainText('Reason: Both hold until Finance rules on it.')
  // Off the list behind the dock until either item changes; Undo brings it back.
  const row = page.getByTestId('page').getByRole('cell', { name: 'Orders in Norway', exact: true })
  await expect(row).toHaveCount(0)
  await outcome.getByRole('button', { name: 'Undo' }).click()
  await expect(row).toBeVisible()
})

test('keep one: needs a reason, archives the other, says what agents now say, and Undo puts both back', async ({
  page,
}) => {
  const dock = await openNorway(page)
  await page.keyboard.press('2')
  const box = page.getByRole('dialog', { name: /^Keep “/ })
  await expect(box.getByText('Agents will then say')).toBeVisible()
  await box.getByLabel('Why does this one stay?').fill('The finance memo of 2 Oct replaced it.')
  await box.getByLabel('A line that settles it').fill('Order value is taken from settlements.')
  await box.getByRole('button', { name: 'Keep this one' }).click()
  const outcome = page.getByRole('status').filter({ hasText: /Archived “/ })
  await expect(outcome).toContainText('Agents now say')
  await outcome.getByRole('button', { name: 'Undo' }).click()
  await expect(
    dock.getByRole('heading', { name: 'Two items say different things about Orders in Norway.' }),
  ).toBeVisible()
})

test('a button that cannot act says why, and someone who owns neither side can ask or suggest', async ({
  page,
}) => {
  await onMockOnly('pair across Sales and Paid media', async () => {
    await signInAs(page, 'Tomas Eriksen')
    await go(page, '/context/conflicts/itm_spain_vat_in.itm_spain_vat_out')
    await expect(page.getByRole('button', { name: 'Keep this one' }).first()).toBeDisabled()
    await expect(
      page.getByText(/^Archives the Paid media item\. Only Priya Nair or an admin can do that\./),
    ).toBeVisible()
    await expect(page.getByText(/^You own neither item, so you can ask the owner\./)).toBeVisible()
    await page.getByRole('button', { name: 'Suggest archiving this one' }).first().click()
    const box = page.getByRole('dialog', { name: /^Suggest archiving/ })
    await box
      .getByLabel('Why should it be archived?')
      .fill('Marketing reads net revenue without VAT.')
    await box.getByRole('button', { name: 'Send the suggestion' }).click()
    await expect(page.getByText(/^Suggested archiving/)).toBeVisible()
  })
})

test('a near copy is underlined where the two differ', async ({ page }) => {
  await onMockOnly('near copy in France', async () => {
    await go(page, '/context/conflicts/itm_france_switch_12.itm_france_switch_21')
    await expect(page.getByText('are where the two differ.')).toBeVisible()
    await expect(page.locator('mark[data-mark="differs"]').first()).toHaveText('[differs: 12]')
  })
})

test('the item page and its peek say what it disagrees with, and lead to the comparison', async ({
  page,
}) => {
  await go(page, '/context/conflicts?whose=all')
  const row = page.getByRole('link', { name: 'Orders in Norway' })
  const pairPath = await row.getAttribute('href')
  const holder = pairPath!.split('/').pop()!.split('.')[0]!
  await go(page, `/context/${holder}`)
  await expect(page.getByRole('heading', { name: 'Disagrees with' })).toBeVisible()
  await expect(
    page.getByText(/Agents say Conflict for \d+ questions this week\./).first(),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Compare and decide' }).first().click()
  await expect(page).toHaveURL(/dock=conflict\./)
  await go(page, `/context?dock=context.${holder}`)
  await expect(page.getByText(/^Disagrees with “/)).toBeVisible()
})

test('Ask groups the two that disagree and leads to the comparison', async ({ page }) => {
  await onMockOnly('example answer', async () => {
    await go(page, '/ask?example=conflict')
    await expect(page.getByText('These two disagree').first()).toBeVisible()
    await expect(page.getByRole('group', { name: 'The two items' })).toBeVisible()
    await page.getByRole('button', { name: 'Compare and decide' }).click()
    await expect(page).toHaveURL(/dock=conflict\./)
  })
})

test('the Conflict alert card shows the pair and leads to the comparison', async ({ page }) => {
  await onMockOnly('Conflict alert card', async () => {
    await go(page, `/inbox?card=${card('alert-orders-norway')}`)
    await expect(page.getByRole('group', { name: 'The two items' })).toBeVisible()
    await page.getByRole('button', { name: 'Compare and decide' }).click()
    await expect(page).toHaveURL(/dock=conflict\./)
  })
})

async function saveNarrowedFromFrance(page: Page, title: string) {
  await go(page, '/context/conflicts/itm_france_switch_12.itm_france_switch_21')
  await page.getByRole('button', { name: 'Edit this one' }).first().click()
  await expect(page).toHaveURL(/beside=itm_france_switch_21/)
  const beside = page.getByRole('complementary', { name: 'The item it disagrees with' })
  await expect(beside).toContainText('Payment provider switched in France on 21 May 2026.')
  await page.getByRole('textbox', { name: 'Title' }).fill(title)
  await page.getByRole('button', { name: /^Save/ }).first().click()
}

test('edit this one: saving returns to the conflict at Not a conflict, and it is settled only with a reason', async ({
  page,
}) => {
  await onMockOnly('editor publish', async () => {
    await saveNarrowedFromFrance(
      page,
      'Payment provider switched in France for cards on 12 May 2026',
    )
    const box = page.getByRole('dialog', { name: 'Not a conflict' })
    await expect(box.getByText('Agents will then say')).toBeVisible()
    await expect(box.getByRole('button', { name: 'Not a conflict' })).toBeDisabled()
    await box.getByLabel('Why is this not a conflict?').fill('Narrowed to cards.')
    await box.getByRole('button', { name: 'Not a conflict' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Narrowed to cards.' })).toBeVisible()
    await go(page, '/context/conflicts?whose=all')
    await expect(page.getByRole('link', { name: 'Orders in France' })).toHaveCount(0)
  })
})

test('a typo fix saved from a conflict settles nothing, and cancelling leaves it flagged', async ({
  page,
}) => {
  await onMockOnly('editor publish', async () => {
    await saveNarrowedFromFrance(page, 'Payment provider switched in France on 12 May 2026.')
    const box = page.getByRole('dialog', { name: 'Not a conflict' })
    await expect(box).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(box).toBeHidden()
    await go(page, '/context/conflicts?whose=all')
    await expect(page.getByRole('cell', { name: 'Orders in France', exact: true })).toBeVisible()
  })
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } })
  test('one pile per item, no sideways scroll, and Settle it opens the choices', async ({
    page,
  }) => {
    await go(page, '/context/conflicts?whose=all')
    await page.getByRole('link', { name: 'Orders in Norway' }).click()
    await page.getByRole('button', { name: 'Open the page' }).click()
    await expect(page.getByRole('region', { name: /^First item/ })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
    await page.getByRole('button', { name: 'Settle it' }).click()
    const sheet = page.getByRole('dialog', { name: 'Settle it' })
    for (const name of ['Edit one of them', 'Keep both', 'Not a conflict', 'Ask the owner'])
      await expect(sheet.getByRole('button', { name })).toBeVisible()
  })
})
