import { card, claimsToCheck, expect, go, inHttpOnly, signInAs, test } from './go.ts'

// J16, saying what needs care before anyone publishes: the quick view and the Inbox row show the
// claims to check; an edit's Ready line says its numbers weren't checked; a withdrawn retirement
// shows the thread's outcome, and archiving always asks first, from the button or the key. Its
// sender takes it back, or lets it stand, with a comment of theirs.

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

test('its sender takes a suggestion to archive back in the comments, or lets it stand', async ({
  page,
}) => {
  // On the mock nobody who suggested archiving signs in; on the service Lars does.
  await inHttpOnly('sign-in for Lars Dahl, who suggested archiving', async () => {
    const title = 'Data for Orders before 19 January 2026 is not reliable'
    const answer = () =>
      page
        .getByRole('region', { name: /^Comments/ })
        .getByRole('article', { name: /^Lars Dahl/ })
        .first()
    const open = async () => {
      await go(page, '/inbox?tab=all')
      await page
        .getByRole('button', { name: new RegExp(`${title}.*Waiting for Jon Abara`) })
        .click()
    }
    await signInAs(page, 'Lars Dahl')
    await open()
    await expect(answer()).toContainText('Withdrew the suggestion')
    await answer().getByRole('button', { name: 'Keep the suggestion' }).click()
    await expect(page.getByText('The suggestion stands')).toBeVisible()
    await expect(answer()).not.toContainText('Withdrew the suggestion')
    // Its owner decides it as before.
    await signInAs(page, 'Jon Abara')
    await go(page, '/inbox/sug-lars-retire/review')
    const decide = page.getByRole('complementary', { name: 'Try it and decide' })
    await expect(decide.getByText('Ready to archive')).toBeVisible()
    await expect(page.getByRole('region', { name: 'What the thread decided' })).toHaveCount(0)
    // Taken back again: the owner closes it or archives anyway.
    await signInAs(page, 'Lars Dahl')
    await open()
    await answer().getByRole('button', { name: 'Withdraw the suggestion' }).click()
    await expect(page.getByText('Withdrawn in the comments')).toBeVisible()
    await expect(answer()).toContainText('Withdrew the suggestion')
    await signInAs(page, 'Jon Abara')
    await go(page, '/inbox/sug-lars-retire/review')
    await expect(decide.getByRole('button', { name: 'Close the suggestion' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'What the thread decided' })).toContainText(
      "I'll suggest new dates instead of archiving it.",
    )
  })
})
