import { expect, go, inHttpOnly, signInAs, test } from './go.ts'

// J58, the suggestion's round trip: a suggestion its owner returns with a note waits on its
// sender, under Returned to you, with the note; they edit it and send it again, and it waits on
// the owners once more. An owner who does not want an item archived closes the suggestion, with
// a reason, without its sender taking it back first.

test('a returned suggestion waits on its sender, who edits it and sends it again', async ({
  page,
}) => {
  // The mock starts over at each sign-in, so only the service carries Jon's return to Ines.
  await inHttpOnly('one person returns it and another signs in to see it', async () => {
    const title = 'Units sold excludes test accounts'
    await go(page, '/inbox/sug-ines/review')
    const decide = page.getByRole('complementary', { name: 'Try it and decide' })
    await decide.getByRole('button', { name: 'Return with a note' }).click()
    await page
      .getByRole('textbox', { name: 'A note for Ines Duarte' })
      .pressSequentially('Which page says 340?')
    await decide.getByRole('button', { name: 'Return to Ines' }).click()
    await expect(decide.getByText('Returned to Ines Duarte')).toBeVisible()

    await signInAs(page, 'Ines Duarte')
    await go(page, '/inbox')
    // It needs her now, with who returned it, not under All.
    const row = page.getByRole('button', { name: new RegExp(`${title}.*Returned by Jon Abara`) })
    await expect(row).toBeVisible()
    await row.click()
    const pane = page.getByRole('main')
    await expect(pane.getByText('Jon Abara returned it with a note')).toBeVisible()
    await expect(pane.getByText('Which page says 340?')).toBeVisible()
    await pane.getByRole('button', { name: 'Edit and send again' }).click()
    await expect(page).toHaveURL(/\/context\/[^/]+\/edit$/)
    const words = page.getByRole('textbox', { name: 'Title' })
    await expect(words).toHaveValue(title)
    await words.fill('Units sold excludes test accounts, as the sales page says')
    await page.getByRole('button', { name: /^Send/ }).click()

    // It waits on the owners again, and no longer needs her.
    await go(page, '/inbox?tab=all')
    await expect(
      page.getByRole('button', {
        name: /Units sold excludes test accounts, as the sales page says.*Waiting for Jon Abara/,
      }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Returned by Jon Abara/ })).toHaveCount(0)
  })
})

test('an owner closes a suggestion to archive that its sender did not take back, with a reason', async ({
  page,
}) => {
  // On the mock nobody who suggested archiving signs in to let it stand; on the service Lars does.
  await inHttpOnly('sign-in for Lars Dahl, who suggested archiving', async () => {
    await signInAs(page, 'Lars Dahl')
    await go(page, '/inbox?tab=all')
    await page
      .getByRole('button', {
        name: /Data for Orders before 19 January 2026 is not reliable.*Waiting for Jon Abara/,
      })
      .click()
    await page
      .getByRole('region', { name: /^Comments/ })
      .getByRole('article', { name: /^Lars Dahl/ })
      .first()
      .getByRole('button', { name: 'Keep the suggestion' })
      .click()
    await expect(page.getByText('The suggestion stands')).toBeVisible()

    await signInAs(page, 'Jon Abara')
    await go(page, '/inbox/sug-lars-retire/review')
    const decide = page.getByRole('complementary', { name: 'Try it and decide' })
    await decide.getByRole('button', { name: "Don't archive" }).click()
    const ask = page.getByRole('dialog', { name: 'Close the suggestion?' })
    const close = ask.getByRole('button', { name: 'Close the suggestion' })
    // No reason, nothing to send.
    await expect(close).toBeDisabled()
    await ask
      .getByRole('textbox', { name: 'Why you close it' })
      .fill('The January data is still being reloaded')
    await close.click()
    await expect(decide.getByText('Nothing changes for agents.', { exact: true })).toBeVisible()
  })
})
