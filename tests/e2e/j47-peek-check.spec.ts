import { card, expect, go, mode, moveTo, test } from './go.ts'
import type { Page } from '@playwright/test'

// J47: a context item's quick view never looks settled before it is. The list's row draws it at
// once. Until the item's own read answers, the conflict warning holds its place with its button
// waiting, nothing is settled from the quick view, and a read that fails or takes too long says so
// with Try again. The mock holds or fails the read by its address flags (?state=).

const holder = 'itm_gift_card_only'
const other = 'Norway orders count store credit'
const stale = 'itm_ra39ow6c'

const peek = (page: Page) => page.getByRole('region', { name: 'Context' })
const compare = (page: Page) => peek(page).getByRole('button', { name: /^Compare/ })

test('the warning is there at once, and its button waits for the item read', async ({ page }) => {
  await go(page, `/context?dock=context.${holder}&state=loading`)
  await expect(peek(page).getByText(`Disagrees with “${other}”.`)).toBeVisible()
  await expect(compare(page)).toBeDisabled()
  await expect(peek(page).getByText('Checking who can decide it.')).toBeAttached()
  // The read answers: the button says what this person can do, and nothing below it moved.
  const details = peek(page).getByRole('button', { name: /^Details/ })
  // Measured in the app's own font: the fallback's wider words would wrap the line differently.
  await page.evaluate(() => document.fonts.ready)
  const before = await details.boundingBox()
  await moveTo(page, `/context?dock=context.${holder}`)
  await expect(peek(page).getByRole('button', { name: 'Compare and decide' })).toBeEnabled()
  expect(await details.boundingBox()).toEqual(before)
})

test('a read that fails says so, and Try again checks again', async ({ page }) => {
  await go(page, `/context?dock=context.${holder}&state=failed`)
  await expect(peek(page).getByText(/Not checked who can decide it/)).toBeVisible()
  await expect(compare(page)).toHaveCount(0)
  await peek(page).getByRole('button', { name: 'Try again' }).click()
  await expect(peek(page).getByRole('button', { name: 'Compare and decide' })).toBeEnabled()
  await expect(peek(page).getByText(/Not checked/)).toHaveCount(0)
})

test('a read that takes too long says it is not checked', async ({ page }) => {
  await page.clock.install()
  await go(page, `/context?dock=context.${holder}&state=loading`)
  await expect(compare(page)).toBeDisabled()
  await page.clock.fastForward(8_000)
  await expect(peek(page).getByText(/Not checked who can decide it/)).toBeVisible()
  await expect(peek(page).getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('nothing is settled from the quick view while its read is out', async ({ page }) => {
  await go(page, `/context?dock=context.${stale}&state=loading`)
  await expect(
    peek(page).getByRole('heading', { name: /^Returns changed definition/ }),
  ).toBeVisible()
  await expect(peek(page).getByRole('button', { name: 'Still true', disabled: false })).toHaveCount(
    0,
  )
  await moveTo(page, `/context?dock=context.${stale}`)
  await expect(peek(page).getByRole('button', { name: 'Still true' })).toBeEnabled()
})

const flagged = 'itm_pfet8zj3'

test('a reported item whose read fails says it is not checked, and Try again checks again', async ({
  page,
}) => {
  test.skip(mode !== 'mock', 'Opens a mock item with the mock report beside it')
  await go(page, `/context?dock=context.${flagged}&flag=${card('flag-germany')}&state=failed`)
  await expect(peek(page).getByText(/Reported unclear/)).toBeVisible()
  await expect(peek(page).getByText(/Not checked whether another item disagrees/)).toBeVisible()
  await expect(peek(page).getByRole('button', { name: 'Not a problem' })).toBeDisabled()
  await peek(page).getByRole('button', { name: 'Try again' }).click()
  await expect(peek(page).getByRole('button', { name: 'Not a problem' })).toBeEnabled()
  await expect(peek(page).getByText(/Not checked/)).toHaveCount(0)
})

test('a reported item whose read takes too long says it is not checked', async ({ page }) => {
  test.skip(mode !== 'mock', 'Opens a mock item with the mock report beside it')
  await page.clock.install()
  await go(page, `/context?dock=context.${flagged}&flag=${card('flag-germany')}&state=loading`)
  await expect(peek(page).getByRole('button', { name: 'Not a problem' })).toBeDisabled()
  await page.clock.fastForward(8_000)
  await expect(peek(page).getByText(/Not checked whether another item disagrees/)).toBeVisible()
  await expect(peek(page).getByRole('button', { name: 'Not a problem' })).toBeDisabled()
  await expect(peek(page).getByRole('button', { name: 'Try again' })).toBeVisible()
})
