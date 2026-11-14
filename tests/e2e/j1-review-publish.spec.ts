import { cardIn, expect, go, test } from './go.ts'

// J1: an owner reviews a suggestion and publishes it. Three steps from the Inbox: select, Review, Publish.
test('an owner reviews and publishes a suggestion', async ({ page }) => {
  await go(page, '/inbox?demo=week&card=sug-ines')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/inbox/${cardIn('sug-ines')}/review`))
  const decision = page.locator('#decision')
  await expect(decision.getByText('Ready.', { exact: true })).toBeVisible()
  await decision.getByRole('button', { name: 'Publish', exact: true }).click()
  // The hold before the next suggestion pauses while the pointer rests on the decision, so move it away.
  await page.mouse.move(0, 0)
  // What it did, in place, then the next suggestion opens.
  await expect(
    page.getByRole('complementary', { name: 'Try it and decide' }).getByText('Agents now say'),
  ).toBeVisible()
  // The outcome appears under the still pointer, and a pointer on it holds the wait (so Undo is never a race).
  // Leave it, as someone moving on would, so the wait runs out.
  await page.mouse.move(0, 0)
  await expect(page).not.toHaveURL(new RegExp(`${cardIn('sug-ines')}/review`), { timeout: 6000 })
})
