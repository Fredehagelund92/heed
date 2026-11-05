import type { Page } from '@playwright/test'
import { card, expect, go, mode, signInAs, test } from './go.ts'

// J28: the three Ask ideas to try first. An answer travels with its state and its sources; a
// sentence shows where it says that; the empty page shows what is asked this week.

/** Asks a question from an empty Ask, as typed. */
async function ask(page: Page, question: string) {
  await go(page, `/ask?n=${Date.now()}`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

const grounded = 'Why did orders in Norway drop in August?'

/*
  What each mode answers. The mock's answers are written by hand. On the service the answer engine
  decides from the demo week's items: Orders in Norway also gets the two items about gift cards,
  which disagree, so it is a Conflict there; and the regulator's pause is about Return on ad spend,
  not Orders. The words are the items' own first sentences.
*/
const world =
  mode === 'http'
    ? {
        share: 'What should I know about Orders in Germany?',
        shareState: 'Checked (1 item)',
        shareSource:
          '1 Orders lags by one day in the source tool - Sofia Brandt, checked 12 Sep 2026',
        firstSentence: /^A new customs rule stopped all online sales to Norway from 4 August 2026/,
        sentences: 4,
      }
    : {
        share: grounded,
        shareState: 'Checked (2 items)',
        shareSource:
          '1 Online sales to Norway stopped on 4 August 2026 - Jon Abara, checked 3 Oct 2026',
        firstSentence: /^Online sales to Norway stopped on 4 August 2026/,
        sentences: 3,
      }

/** The six state words, as a line says one. */
const STATE = /^(Checked|Partial|Not found|Conflict|Outdated|Not checked)$/

test('Share copies an answer for Slack with its state and sources, or as a card; a link is for later', async ({
  page,
}) => {
  await ask(page, world.share)
  await page.getByRole('button', { name: 'More' }).last().click()
  await page.getByRole('menuitem', { name: 'Share' }).click()
  // It opens beside the answer, in the right panel, so the answer stays in view.
  await expect(page).toHaveURL(/dock=share\./)
  const share = page.getByRole('region', { name: 'Share this answer' })
  const tabs = share.getByRole('tablist', { name: 'Share as' })
  await expect(tabs.getByRole('tab', { name: /Slack message/ })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(tabs.getByRole('tab', { name: /Link/ })).toHaveAttribute('aria-disabled', 'true')
  const message = share.getByRole('tabpanel', { name: 'Slack message' })
  await expect(message).toContainText(world.shareState)
  await expect(message).toContainText(world.shareSource)
  await expect(share.getByRole('button', { name: 'Copy for Slack' })).toBeFocused()
  await tabs.getByRole('tab', { name: /Card/ }).click()
  await expect(share.getByRole('tabpanel', { name: 'Card' })).toContainText(
    'Larchwood Outdoor - answered 23 Oct 2026',
  )
  await share.getByRole('button', { name: 'Copy card' }).click()
  await expect(page.getByText('Card copied')).toBeVisible()

  // Nothing written down travels as Not found, with no list of sources.
  await ask(page, 'How did orders in Spain change in October 2026?')
  await page.getByRole('button', { name: 'More' }).last().click()
  await page.getByRole('menuitem', { name: 'Share' }).click()
  const missing = page
    .getByRole('region', { name: 'Share this answer' })
    .getByRole('tabpanel', { name: 'Slack message' })
  await expect(missing).toContainText('Not found. Nothing is written about this yet.')
  await expect(missing.getByRole('listitem')).toHaveCount(0)
})

test('Show me where it says that: a sentence walks back to its item and the source line, exact phrases marked', async ({
  page,
}) => {
  await ask(page, grounded)
  const log = page.getByRole('log')
  await log.getByRole('button', { name: world.firstSentence }).click()
  await expect(page).toHaveURL(/dock=where\..*wn=1/)
  const panel = page.getByRole('region', { name: 'Where it says that' })
  await expect(panel.getByText(`Sentence 1 of ${world.sentences}`)).toBeVisible()
  const chain = panel.getByRole('region', {
    name: 'From Online sales to Norway stopped on 4 August 2026',
  })
  // The date is marked at all three steps; "new customs rule" is the owner's wording, not the source's.
  await expect(chain.locator('mark', { hasText: '4 August 2026' })).toHaveCount(3)
  await expect(chain.locator('blockquote mark', { hasText: /customs rule/ })).toHaveCount(0)
  await expect(
    chain.getByText('Fewer orders in Norway after 4 August do not mean fewer customers.'),
  ).toBeVisible()
  await expect(log.getByRole('button', { pressed: true })).toContainText(/online sales to Norway/i)

  // The number keys move between sentences; Ask's own sentence, the last, says it has no item.
  const last = world.sentences
  await page.keyboard.press(String(last))
  await expect(panel.getByText(`Sentence ${last} of ${last}`)).toBeVisible()
  await expect(panel.getByText(/It is Ask's own wording/)).toBeVisible()
  await panel.getByRole('button', { name: 'Previous sentence' }).click()
  await expect(panel.getByText(`Sentence ${last - 1} of ${last}`)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).not.toHaveURL(/dock=/)
})

test('Asked this week: topics with the state Ask gives now and a count; an owner gets the waiting draft', async ({
  page,
}) => {
  await go(page, '/ask')
  const week = page.getByRole('region', { name: 'Asked this week' })
  await expect(week).toContainText(
    'Agents asked 142 times. Counts only, never the words or who asked. Each state is what Ask gives today.',
  )
  const rows = week.getByRole('listitem')
  // The four most asked; the rest open in place.
  await expect(rows).toHaveCount(4)
  await expect(rows.first()).toContainText('Orders in Norway')
  await expect(rows.first()).toContainText('31 times')
  const more = week.getByRole('button', { name: 'More asked this week (9)' })
  await more.click()
  await expect(rows).toHaveCount(13)
  const spain = rows.filter({ hasText: 'Orders in Spain' })
  await expect(spain).toContainText('Not found')
  await expect(spain.getByRole('link', { name: 'Write it for Orders in Spain' })).toHaveAttribute(
    'href',
    `/context/new?gap=${card('gap-spain')}`,
  )
  await week.getByRole('button', { name: 'Show fewer' }).click()
  await expect(rows).toHaveCount(4)

  // Asking a row gets the state its row showed.
  const shown = (await rows.first().getByText(STATE).first().textContent())!
  await rows.first().getByRole('button').click()
  const log = page.getByRole('log')
  await expect(log.getByText(shown, { exact: true }).first()).toBeVisible()
})

/**
 * No question to ask is offered in the chat: no chip, button or list that sends one. A button named
 * as a question would send one; "Something wrong?" opens the report form.
 */
async function suggestsNothing(page: Page) {
  const log = page.getByRole('log')
  await expect(log.getByRole('button', { name: /^(?!Something wrong\?$).*\?$/ })).toHaveCount(0)
  await expect(
    page.getByRole('group', { name: /Ask next|Questions Ask can answer|Suggested questions/ }),
  ).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'Questions Ask can answer' })).toHaveCount(0)
}

test('once a message is sent, nothing in the chat suggests what to ask, whatever the answer', async ({
  page,
}) => {
  // Checked.
  await ask(page, world.share)
  const log = page.getByRole('log')
  await expect(log.getByText('Checked', { exact: true }).first()).toBeVisible()
  await expect(log.getByRole('button', { name: 'Good answer' })).toBeVisible()
  await suggestsNothing(page)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  const follow = async (question: string) => {
    await box.click()
    await box.pressSequentially(question)
    await box.press('Enter')
  }
  // Not found keeps its next step, and only that.
  await follow('How did orders in Spain change in October 2026?')
  await expect(log.getByText('Not found', { exact: true }).first()).toBeVisible()
  await expect(log.getByText(/Write context for/).first()).toBeVisible()
  await suggestsNothing(page)
  // A question that names nothing to look up says what Ask answers, in words.
  await follow('tell me a joke')
  await expect(log.getByText('Nothing was looked up').last()).toBeVisible()
  await expect(log.getByText(/^Ask answers three kinds of question/).last()).toBeVisible()
  await suggestsNothing(page)
  // A question about one person's work is refused, and says what Ask can tell instead, in words.
  await follow('what did Tomas Eriksen write this week?')
  await expect(
    log.getByText("Ask does not answer questions about one person's work."),
  ).toBeVisible()
  await suggestsNothing(page)
})

test('someone who does not own the domain gets no unfinished control under Not found', async ({
  page,
}) => {
  await signInAs(page, 'Tomas Eriksen')
  await ask(page, 'How did orders in Spain change in October 2026?')
  const log = page.getByRole('log')
  await expect(log.getByText('Not found', { exact: true }).first()).toBeVisible()
  await expect(log.getByRole('button', { name: /Tell the owner/ })).toHaveCount(0)
  await expect(page.getByText(/Coming soon|comes later/)).toHaveCount(0)
})

test('Asked this week shows no draft to someone who does not own the domain, and a new workspace gets starters', async ({
  page,
}) => {
  await signInAs(page, 'Ines Duarte')
  await go(page, '/ask')
  await expect(
    page.getByRole('region', { name: 'Asked this week' }).getByRole('link', { name: /^Write it/ }),
  ).toHaveCount(0)
  await go(page, '/inbox?demo=setup')
  await go(page, '/ask')
  await expect(page.getByRole('region', { name: 'Asked this week' })).toHaveCount(0)
  // The service makes its starters from what the workspace has written, and a new one has written
  // nothing yet: only the empty page's words (decided 27 October 2026). The mock's are its examples.
  const starters = page.getByRole('group', { name: 'Suggested questions' })
  if (mode === 'http') {
    await expect(page.getByText('What do you want to know about the numbers?')).toBeVisible()
    await expect(starters).toHaveCount(0)
  } else await expect(starters).toBeVisible()
})
