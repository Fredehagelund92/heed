import { expect, go, inHttpOnly, test } from './go.ts'

// J33, threads on the source: a comment hangs on a line of the text or a row of the Fields table.
// C comments on the line or field in focus (N steps to a change, the arrows move between lines),
// and the + beside a line does the same on hover. A thread takes replies and reactions as any
// comment does, is resolved and reopened by anyone who reads the suggestion, saying who and when,
// and the rail counts the open and resolved ones as they change and steps to each open one. Open
// or resolved, a thread never holds Publish, and it is still on its line after a reload. On a
// phone, a tap on a line offers to comment on it (J17).

test('C comments on the line or field in focus, and the rail counts the threads as they change', async ({
  page,
}) => {
  await go(page, '/inbox/sug-ines/review')
  const source = page.getByRole('region', { name: 'The source' })
  const rail = page.getByRole('region', { name: 'Threads on lines and fields' })
  await expect(rail).toContainText('None yet')

  // N steps to the changed field; C opens a comment on it.
  await page.keyboard.press('n')
  await expect(source.getByRole('row', { name: 'Source, changed' })).toBeFocused()
  await page.keyboard.press('c')
  const onField = source.getByRole('textbox', { name: 'Comment on source' })
  await expect(onField).toBeFocused()
  await page.keyboard.type('Which of the two pages is right?')
  await page.keyboard.press('ControlOrMeta+Enter')
  const fieldThread = source.getByRole('region', { name: "Source: Jon Abara's thread, open" })
  await expect(fieldThread).toContainText('Which of the two pages is right?')
  await expect(rail).toContainText('1 open')
  // The composer closes, and the focus is back on the row, where C and the arrows go on.
  await expect(source.getByRole('row', { name: 'Source, changed' })).toBeFocused()

  // N steps into the text; Down moves to its first line, the one removed, then to the added one.
  await page.keyboard.press('n')
  await expect(source.getByRole('group', { name: 'Change 1 of 1 in the text' })).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('c')
  await expect(source.getByRole('textbox', { name: 'Comment on line 1' })).toBeFocused()
  await page.keyboard.type('Since when are there 340?')
  await page.keyboard.press('ControlOrMeta+Enter')
  const lineThread = source.getByRole('region', { name: "Line 1: Jon Abara's thread, open" })
  await expect(lineThread).toContainText('Since when are there 340?')
  await expect(rail).toContainText('2 open')

  // The rail lists each open thread in reading order, and goes to it.
  const listed = rail.getByRole('button')
  await expect(listed).toHaveText([/^Source, Jon Abara/, /^Line 1, Jon Abara/])
  await listed.last().click()
  await expect(lineThread).toBeFocused()

  // They hang on the source, not in the comments under the change.
  const comments = page.getByRole('region', { name: 'Comments', exact: true })
  await expect(comments.getByText('Since when are there 340?')).toHaveCount(0)

  // A reply and a reaction, with the comment box's own parts.
  await lineThread.getByRole('button', { name: 'Reply' }).click()
  await lineThread.getByRole('textbox', { name: 'Reply to Jon' }).fill('From 1 October.')
  await lineThread.getByRole('button', { name: 'Reply', exact: true }).last().click()
  await expect(lineThread).toContainText('From 1 October.')
  await lineThread.getByRole('article').first().hover()
  await lineThread.getByRole('button', { name: 'Add a reaction' }).first().click()
  await page.getByRole('button', { name: 'Agree' }).click()
  await expect(lineThread.getByRole('button', { name: /^Agree, 1/ })).toBeVisible()

  // Resolved, the thread folds to who and when, and the rail counts it so.
  await lineThread.getByRole('button', { name: 'Resolve' }).click()
  const resolved = source.getByRole('region', { name: "Line 1: Jon Abara's thread, resolved" })
  await expect(resolved).toContainText('Resolved by Jon Abara')
  await expect(resolved.getByText('From 1 October.')).toHaveCount(0)
  await expect(rail).toContainText('1 open, 1 resolved')
  await resolved.getByRole('button', { name: 'Show the 2 comments' }).click()
  await expect(resolved).toContainText('From 1 October.')

  // Publish never waits for a thread.
  await expect(page.getByRole('button', { name: 'Publish', exact: true }).first()).toBeEnabled()

  // Reopened, it says by whom.
  await resolved.getByRole('button', { name: 'Reopen' }).click()
  await expect(lineThread).toContainText('Open, reopened by Jon Abara')
  await expect(rail).toContainText('2 open')

  await inHttpOnly('the service keeps the threads where they hang', async () => {
    await page.reload()
    await expect(lineThread).toContainText('Since when are there 340?')
    await expect(fieldThread).toContainText('Which of the two pages is right?')
    await expect(rail).toContainText('2 open')
  })
})

test('the + beside a line comments on it, and Esc keeps what was written', async ({ page }) => {
  await go(page, '/inbox/sug-ines/review')
  const text = page.getByRole('region', { name: 'Text' })
  await text.getByText('Units sold in Norway leaves out the').last().hover()
  await text.getByRole('button', { name: 'Comment on line 1' }).click()
  const box = text.getByRole('textbox', { name: 'Comment on line 1' })
  await expect(box).toBeFocused()
  await page.keyboard.type('Half a thought')
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)
  // Esc closed the composer only; the review is still open.
  await expect(page).toHaveURL(/\/review/)
  await page.keyboard.press('c')
  await expect(text.getByRole('textbox', { name: 'Comment on line 1' })).toContainText(
    'Half a thought',
  )
})

test('a thread shown apart from the source is resolved and reopened there too', async ({
  page,
}) => {
  await go(page, '/inbox?card=sug-ines')
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page).toHaveURL(/\/review/)
  await page.keyboard.press('n')
  await page.keyboard.press('c')
  await page.keyboard.type('Which of the two pages is right?')
  await page.keyboard.press('ControlOrMeta+Enter')
  await expect(
    page.getByRole('region', { name: "Source: Jon Abara's thread, open" }),
  ).toContainText('Which of the two pages is right?')

  await page.goBack()
  const thread = page.getByRole('listitem').filter({ hasText: 'Which of the two pages is right?' })
  await expect(thread).toContainText('On source')
  await thread.getByRole('button', { name: 'Resolve' }).click()
  await expect(thread).toContainText('Resolved by Jon Abara')
  await thread.getByRole('button', { name: 'Reopen' }).click()
  await expect(thread).toContainText('Open, reopened by Jon Abara')
})
