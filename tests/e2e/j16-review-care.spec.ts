import { card, claimsToCheck, expect, go, inHttpOnly, signInAs, test } from './go.ts'

// J16, saying what needs care before anyone publishes: the quick view and the Inbox row show the
// claims to check; an edit's Ready line says its numbers weren't checked; a withdrawn retirement
// shows the thread's outcome, and archiving always asks first, from the button or the key. Its
// sender takes it back, or lets it stand, with a comment of theirs. A suggestion that overlaps
// several live items asks how it relates to each, and Publish acts on each answer alone.

test('the quick view and the row show the claims to check before Review', async ({ page }) => {
  const claims = `${claimsToCheck('sug-agent')} claims to check`
  await go(page, '/inbox?card=sug-agent')
  await expect(page.getByText(`${claims} before publishing`)).toBeVisible()
  await expect(page.locator(`[data-row="${card('sug-agent')}"]`).getByLabel(claims)).toBeVisible()
  // An overlap names the live item after a colon, with no space before it.
  await go(page, '/inbox?card=sug-sofia-clash')
  await expect(page.getByText(/^Overlaps live context: \S/)).toBeVisible()
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

test('an overlap with several live items asks about each, and archives only the one it replaces', async ({
  page,
}) => {
  const stop = 'Online sales to Norway stopped on 4 August 2026'
  const cardOnly = 'Norway orders are card and cash payments only'
  const credit = 'Norway orders count store credit'
  const decide = page.getByRole('complementary', { name: 'Try it and decide' })
  const relate = (title: string, answer: string) =>
    page
      .getByRole('radiogroup', { name: `How this relates to ${title}` })
      .getByRole('radio', { name: answer })
      .click()
  await go(page, '/inbox/sug-sofia-clash/review')
  // The two that say something about the same thing side by side; the stop, which shares no
  // words with it, folded into one line with one answer.
  await expect(
    page.getByText('2 of 3 say something about the same thing. Answer for each.'),
  ).toBeVisible()
  for (const title of [stop, cardOnly, credit])
    await expect(page.getByText(title, { exact: false }).first()).toBeVisible()
  await expect(page.getByText('1 more overlaps only by where it applies')).toBeVisible()
  // One answer is not an answer for the others: Publish waits until each has its own.
  await relate(credit, 'This replaces it')
  await page.getByRole('button', { name: 'Mark it unrelated' }).click()
  await expect(page.getByText('Marked unrelated')).toBeVisible()
  await expect(decide.getByText('Not ready: choose how they relate.')).toBeVisible()
  await expect(decide.getByRole('button', { name: 'Publish' })).toBeDisabled()
  await relate(cardOnly, 'These disagree')
  await expect(
    decide.getByText('When you publish, 1 live item is archived and 2 stay.'),
  ).toBeVisible()
  await decide.getByRole('button', { name: 'Publish' }).click()
  await expect(page.getByText(`Archived: ${credit}.`)).toBeVisible()
  // The one it replaces is archived; the unrelated stop and the one it disagrees with stay live.
  await go(page, '/context/itm_gift_store_credit')
  await expect(page.getByRole('heading', { name: credit })).toBeVisible()
  await expect(page.getByText('Archived', { exact: true }).first()).toBeVisible()
  for (const [id, title] of [
    ['itm_norway_stop', stop],
    ['itm_gift_card_only', cardOnly],
  ] as const) {
    await go(page, `/context/${id}`)
    await expect(page.getByRole('heading', { name: title })).toBeVisible()
    await expect(page.getByText('Archived', { exact: true })).toHaveCount(0)
  }
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
