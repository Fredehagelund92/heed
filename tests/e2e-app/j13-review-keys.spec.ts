import { expect, test } from '@playwright/test'
import { go } from './go.ts'

// J13, the review's keys: they never act while you type. Esc in a note closes the note and keeps
// it; only then does Esc leave. "?" lists the keys, and the Command-Enter hint shows only when the
// key acts. In the quick view, Esc clears the selection.

test('typing j and k in a note stays on the item, and Esc keeps the note', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  await page.getByRole('button', { name: 'Return with a note' }).first().click()
  const note = page.getByRole('textbox', { name: 'A note for Ines Duarte' })
  await note.pressSequentially('check the jk source')
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/inbox\/sug-ines\/review/)
  await expect(note).toBeHidden()
  await expect(page.getByText('Your note for Ines is kept.')).toBeVisible()
  await page.getByRole('button', { name: 'Return with a note' }).first().click()
  await expect(note).toHaveText('check the jk source')
  await expect(note).toBeFocused()
  // Command-Enter in the note posts the note; it never publishes another item.
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(page.getByText('Returned to Ines Duarte')).toBeVisible()
  await expect(page).toHaveURL(/sug-ines\/review/)
})

test('Esc with nothing open goes back to the Inbox; ? lists the keys', async ({ page }) => {
  await go(page, '/inbox/sug-ines-link/review')
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeVisible()
  await page.keyboard.press('?')
  const keys = page.getByRole('dialog', { name: 'Keyboard shortcuts' })
  await expect(keys).toContainText('Next, or previous suggestion')
  await expect(keys).toContainText('Close the note, keeping it')
  await page.keyboard.press('Escape')
  await expect(keys).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/inbox\?card=sug-ines-link/)
})

test('the Command-Enter hint shows only where the key acts', async ({ page }) => {
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  await go(page, '/inbox/sug-ines/review')
  await expect(decide.getByText('to publish')).toBeVisible()
  await go(page, '/inbox/sug-agent/review')
  await expect(decide.getByRole('button', { name: 'Return with a note' })).toBeVisible()
  await expect(decide.getByText('to publish')).toHaveCount(0)
  await go(page, '/inbox/sug-sofia-clash/review')
  await expect(decide.getByRole('button', { name: 'Return with a note' })).toBeVisible()
  await expect(decide.getByText('to publish')).toHaveCount(0)
})

test('Esc in the quick view clears the selection', async ({ page }) => {
  await go(page, '/inbox?card=sug-agent')
  await expect(page.getByRole('button', { name: 'Review', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByText('Nothing selected')).toBeVisible()
  await page.keyboard.press('j')
  await expect(page.getByText('Nothing selected')).toBeHidden()
})
