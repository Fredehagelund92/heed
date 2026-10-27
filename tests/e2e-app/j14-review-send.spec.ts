import { expect, go, test } from './go.ts'

// J14, deciding when the connection is not there: offline nothing is published and the button
// says why; a failed try says "Couldn't publish", changes nothing, and Try again works. A returned
// note that fails stays in the editor. The quick view's own actions wait the same way.

test('offline, Publish waits and nothing says Published', async ({ page }) => {
  await go(page, '/inbox/sug-ines-link/review?state=offline')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await expect(decide.getByText("You're offline.")).toBeVisible()
  await expect(decide.getByText("Publish is off until you're back; nothing is lost.")).toBeVisible()
  await expect(decide.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled()
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByText('Agents now say')).toHaveCount(0)
  await expect(decide.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  await expect(decide.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
})

test('a failed publish changes nothing, and Try again publishes', async ({ page }) => {
  await go(page, '/inbox/sug-ines-link/review?state=failed')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await decide.getByRole('button', { name: 'Publish', exact: true }).click()
  await expect(decide.getByRole('alert')).toContainText("Couldn't publish. Nothing changed.")
  await expect(page.getByText('Agents now say')).toHaveCount(0)
  // One way forward: Try again, with Return beside it, and no second Publish.
  await expect(decide.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0)
  await expect(decide.getByRole('button', { name: 'Return with a note' })).toBeVisible()
  await decide.getByRole('button', { name: 'Try again' }).click()
  await expect(decide.getByText('Agents now say')).toBeVisible()
})

test('a failed return keeps the note', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review?state=failed')
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await decide.getByRole('button', { name: 'Return with a note' }).click()
  const note = page.getByRole('textbox', { name: 'A note for Ines Duarte' })
  await note.pressSequentially('Which page says 340?')
  await decide.getByRole('button', { name: 'Return to Ines' }).click()
  await expect(decide.getByRole('alert')).toContainText(
    "Couldn't return it. Nothing changed; your note is kept.",
  )
  await expect(note).toHaveText('Which page says 340?')
  await decide.getByRole('button', { name: 'Try again' }).click()
  await expect(decide.getByText('Returned to Ines Duarte')).toBeVisible()
})

test("offline, the quick view's actions wait too", async ({ page }) => {
  await go(page, '/inbox?state=offline&card=check-margin')
  await expect(page.getByText("Offline: changes wait until you're back.")).toBeVisible()
})
