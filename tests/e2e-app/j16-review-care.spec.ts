import { card, claimsToCheck, expect, go, test, untilInHttp } from './go.ts'

// J16, saying what needs care before anyone publishes: the quick view and the Inbox row show the
// claims to check; an edit's Ready line says its numbers weren't checked; a withdrawn retirement
// shows the thread's outcome, and archiving always asks first, from the button or the key.

test('the quick view and the row show the claims to check before Review', async ({ page }) => {
  const claims = `${claimsToCheck('sug-agent')} claims to check`
  await go(page, '/inbox?card=sug-agent')
  await expect(page.getByText(`${claims}before publishing`)).toBeVisible()
  await expect(page.locator(`[data-row="${card('sug-agent')}"]`).getByLabel(claims)).toBeVisible()
})

test("a new date with no source says it isn't checked; one with a new source page doesn't", async ({
  page,
}) => {
  await go(page, '/inbox/sug-ines-dates/review')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await expect(decide.getByText('Ready, not checked against a source.')).toBeVisible()
  await go(page, '/inbox/sug-ines/review')
  await expect(decide.getByText('not checked')).toHaveCount(0)
  await expect(decide.getByText(/Complete/)).toHaveCount(0)
})

test('a withdrawn retirement closes; archiving asks first, from the key too', async ({ page }) => {
  untilInHttp('P9', 'the comments in which Lars withdraws his suggestion')
  await go(page, '/inbox/sug-lars-retire/review')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await expect(page.getByRole('region', { name: 'What the thread decided' })).toContainText(
    "I'll suggest new dates instead of archiving it.",
  )
  await expect(decide.getByRole('button', { name: 'Close the suggestion' })).toBeVisible()
  await decide.getByRole('button', { name: 'Archive anyway' }).click()
  const ask = page.getByRole('dialog', { name: 'Archive the context item?' })
  await expect(ask).toContainText('Lars withdrew this suggestion in the comments.')
  await ask.getByRole('button', { name: 'Cancel' }).click()
  await expect(ask).toBeHidden()
  await expect(decide.getByText('Archived')).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(decide.getByText('Nothing changes: the context item stays live.')).toBeVisible()
})
