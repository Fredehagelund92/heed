import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  ASK_MATCH,
  ASK_NO_MATCH,
  ASK_SHORT,
  ASK_TABLE,
  askAndWait,
  chipEditor,
  questionWords,
} from './ask-support'
import { openPage, settle, themes, widths, type Theme } from './support'

/*
  The assistant's Ask tab, as a person uses it: in the panel from any page, from the keyboard,
  on a phone and as its own page. The answers come from the mock binding's scripted assistant over
  its live edition, in the service's stream; spending limits, failures and refusals are mock
  scenarios.
*/

const desktop = { ...widths[0], theme: 'light' } as const
const phone = { ...widths[2], theme: 'light' } as const
const launcher = (page: Page) => page.getByRole('button', { name: 'Assistant', exact: true })
const assistant = (page: Page) =>
  page.getByRole((page.viewportSize()?.width ?? 1440) < 768 ? 'dialog' : 'region', {
    name: 'Assistant',
  })
const box = (page: Page) => page.getByRole('textbox', { name: 'Your question' })
const answer = (page: Page) => page.getByRole('article', { name: 'Answer' }).last()
const announcer = (page: Page) => page.locator('[data-slot="ask-announcer"]')
/** The composer's "About" line: what the question will be read for. */
const reads = (page: Page) => page.getByRole('list', { name: 'About', exact: true })
const address = (page: Page) => decodeURIComponent(page.url())
/** The chips in the question. */
const chips = (page: Page) => box(page).locator('[data-chip="ask"]')

async function openAsk(
  page: Page,
  size: { width: number; height: number; theme: Theme } = desktop,
  scenario?: string,
) {
  if (scenario)
    await page.addInitScript(
      (value) => window.localStorage.setItem('cl.mock-scenario', value),
      scenario,
    )
  await openPage(page, '/', size)
  await launcher(page).click()
  // The panel's chunk loads on the first open: on a busy machine that takes a few seconds.
  await expect(assistant(page).getByRole('tab', { name: 'Ask' })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 15_000 },
  )
  await chipEditor(page)
}

test.describe('Ask in the panel', () => {
  test('a suggested question is asked, and the answer cites checked facts', async ({ page }) => {
    await openAsk(page)
    await expect(
      assistant(page).getByRole('heading', { name: 'Ask me about your numbers' }),
    ).toBeVisible()
    const starters = assistant(page).getByRole('list', { name: 'Suggested questions' })
    await expect(starters.getByRole('button')).toHaveCount(5)
    await starters.getByRole('button', { name: /^See what applies/ }).click()
    // The question carries the scope it was asked with; the next one shows it as carried.
    await expect(assistant(page).getByRole('list', { name: 'Asked about' })).toBeVisible()
    await expect(reads(page).locator('[data-source="carried"]').first()).toBeVisible()
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(announcer(page)).toHaveText(/^Answer ready\./)
    await expect(answer(page).getByRole('note')).toContainText('Checked before you saw it.')
  })

  test('each turn says who wrote it: You on the right, the Assistant with its mark', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, ASK_MATCH)
    await askAndWait(page, ASK_NO_MATCH)
    const labels = assistant(page).locator('[data-slot="ask-turn-label"]')
    await expect(labels).toHaveCount(4)
    const roles = await labels.evaluateAll((all) => all.map((label) => label.dataset.role))
    expect(roles).toEqual(['user', 'assistant', 'user', 'assistant'])
    const you = labels.first()
    await expect(you).toHaveText(/^You/)
    await expect(you.locator('[data-slot="avatar"]')).toHaveText(/^[A-Z]{1,2}$/)
    await expect(labels.nth(1)).toContainText('Assistant')
    // The mark is an avatar, not an inline glyph: 24 across.
    const mark = await labels.nth(1).locator('[data-slot="assistant-mark"]').boundingBox()
    expect([mark?.width, mark?.height]).toEqual([24, 24])
    // The person's label and question share one right edge; the assistant's mark and answer one left edge.
    const question = assistant(page).locator('[data-slot="ask-question"]').first()
    const [label, bubble] = await Promise.all([
      you.boundingBox(),
      question.locator('p').first().boundingBox(),
    ])
    expect(label!.x + label!.width).toBeCloseTo(bubble!.x + bubble!.width, 0)
    const first = assistant(page).getByRole('article', { name: 'Answer' }).first()
    const [head, steps] = await Promise.all([
      labels.nth(1).boundingBox(),
      first.locator('[data-slot="step-trail"]').boundingBox(),
    ])
    expect(head!.x).toBeCloseTo(steps!.x, 0)
  })

  test('an answer shows its steps, chips that preview the fact, and how each fact stands', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, ASK_MATCH)
    // Focus stays in the box after sending.
    await expect(box(page)).toBeFocused()
    // The steps fold into one row once the answer is done, and open to each step in the past.
    const trail = answer(page).getByRole('button', { name: /^What the assistant did: / })
    await expect(trail).toHaveText(/^What the assistant did: \d+ steps · read 4 facts$/)
    await expect(trail).toHaveAttribute('aria-expanded', 'false')
    await trail.click()
    await expect(answer(page).getByRole('list', { name: 'What the assistant did' })).toContainText(
      'Looked up facts · 4 checked, 2 apply',
    )
    await expect(
      answer(page).getByText(
        "Two facts apply to Average order value, United Kingdom. Two others don't.",
      ),
    ).toBeVisible()
    await expect(announcer(page)).toHaveText('Answer ready. Two facts apply, 2 don’t.')

    // A chip is a link to the fact that previews it on hover.
    const chip = answer(page).locator('[data-slot="ask-answer-text"] a').first()
    await expect(chip).toHaveAttribute('href', /\/library\/itm_/)
    await chip.hover()
    await expect(page.locator('[data-slot="preview-card"]').first()).toBeVisible()

    const facts = answer(page).getByRole('list', { name: 'Facts read in this answer' })
    await expect(facts.getByRole('listitem')).toHaveCount(4)
    await expect(facts.locator('[data-verdict="applies"]')).toHaveCount(1)
    await expect(facts.locator('[data-verdict="partial"]')).toHaveCount(1)
    await expect(facts.locator('[data-verdict="not"]')).toHaveCount(2)
    // The facts that apply were served, and say who accepted them (FR-326, contract 9.8).
    for (const verdict of ['applies', 'partial'])
      await expect(
        facts.locator(`[data-verdict="${verdict}"] [data-slot="review-stamp"]`),
      ).toContainText(/^Accepted \d{1,2} \w+ \d{4} by Jon Abara, owner of Sales/)
    await expect(answer(page).getByRole('note')).toHaveText(
      'Checked before you saw it. All 4 facts above come from the library, and the quote matches its source word for word.',
    )
    // A thumb is stored as a count (FR-712): it stays pressed, and the answer takes no other.
    await page.mouse.move(0, 0)
    await expect(page.locator('[data-slot="preview-card"]')).toHaveCount(0)
    await answer(page).getByRole('button', { name: 'Good answer' }).press('Enter')
    await expect(
      answer(page).getByRole('button', { name: 'You rated this a good answer' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(answer(page).getByText('Thanks. We keep only the count.')).toBeVisible()
    await expect(answer(page).getByRole('button', { name: 'Something was wrong' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  test('a greeting, thanks or what it can do reads no scope, so offers no link to one', async ({
    page,
  }) => {
    await openAsk(page)
    for (const question of ['hello', 'thanks', 'what can you do']) {
      await askAndWait(page, question)
      await expect(answer(page).getByRole('button', { name: 'Copy answer' })).toBeVisible()
      await expect(
        answer(page).getByRole('button', { name: 'Copy a link to these metrics and dates' }),
      ).toHaveCount(0)
      await expect(
        answer(page).getByRole('button', { name: 'Open in Try a question' }),
      ).toHaveCount(0)
    }
    // A question that read a scope offers both.
    await askAndWait(page, ASK_MATCH)
    await expect(
      answer(page).getByRole('button', { name: 'Copy a link to these metrics and dates' }),
    ).toBeVisible()
    await expect(answer(page).getByRole('button', { name: 'Open in Try a question' })).toBeVisible()
  })

  test('the scope is shared with What an agent would get, and travels to both pages', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, ASK_MATCH)
    await answer(page).getByRole('button', { name: 'Open in Try a question' }).click()
    await expect(assistant(page).getByRole('tab', { name: 'Try a question' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    // The answer's scope is the bar's: Average order value in the United Kingdom, June 2026.
    await expect(assistant(page).getByRole('textbox', { name: 'From', exact: true })).toHaveValue(
      '1 Jun 2026',
    )
    await expect(assistant(page).getByRole('textbox', { name: 'To', exact: true })).toHaveValue(
      '30 Jun 2026',
    )
    await expect(assistant(page).locator('[data-slot="try-it-delivered"]')).toBeVisible()

    // Back on Ask, the composer holds the same scope, picked for the next question; expanded,
    // the page has it in its address and the conversation goes with it.
    await assistant(page).getByRole('tab', { name: 'Ask' }).click()
    await expect(reads(page).locator('[data-source="picked"]')).toContainText([
      'Average order value',
      'United Kingdom',
    ])
    await assistant(page).getByRole('link', { name: 'Open page' }).click()
    await expect
      .poll(() => address(page))
      .toMatch(
        /\/assistant\?about=metric:average_order_value,val:market\/united_kingdom&from=2026-06-01&to=2026-06-30$/,
      )
    // The panel leaves over 100 ms (contract 10); the page's conversation is the one left.
    await expect(page.locator('[data-slot="dock-panel"]')).toHaveCount(0)
    await expect(page.getByText(ASK_MATCH)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'In this answer' })).toBeVisible()
    await page.getByRole('button', { name: 'Open in Try a question' }).click()
    await expect
      .poll(() => address(page))
      .toMatch(
        /\/try-it\?about=metric:average_order_value,val:market\/united_kingdom&from=2026-06-01&to=2026-06-30$/,
      )
  })

  test('@ puts a chip in the question at the caret: Enter picks it, and the words go on', async ({
    page,
  }) => {
    await openAsk(page)
    await box(page).fill('what is ')
    // @ at the start of a word lists what to name, above the box.
    await page.keyboard.type('@Average order')
    const list = page.getByRole('listbox', {
      name: 'Mention a metric, value, dimension, fact or domain',
    })
    // The metric leads; items about it follow in their own group.
    await expect(list.getByRole('option', { name: /^Average order value/ }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(list).toBeHidden()
    await expect(box(page)).toBeFocused()
    await expect(chips(page)).toHaveText([/Average order value/])
    // Escape closes the list only, never the panel around it.
    await page.keyboard.type('@high')
    await expect(list).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(list).toBeHidden()
    await expect(assistant(page)).toBeVisible()
    for (let step = 0; step < '@high'.length; step++) await page.keyboard.press('Backspace')
    await page.keyboard.type('in the United Kingdom?')
    expect(await questionWords(page)).toBe('what is Average order value in the United Kingdom?')
    // The chip is the question's own; the line says so. Nothing was sent.
    await expect(reads(page).locator('[data-source="tagged"]')).toContainText('Average order value')
    await expect(answer(page)).toHaveCount(0)
  })

  test('the dates button puts the question’s dates in, and its chip opens them again', async ({
    page,
  }) => {
    await openAsk(page)
    await box(page).fill('orders in the United Kingdom ')
    await assistant(page).getByRole('button', { name: 'Dates of the question' }).click()
    const panel = page.locator('[data-slot="ask-dates"]')
    // A new one starts at today, which it says.
    await expect(panel.getByRole('button', { name: 'Today' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(panel.getByRole('button', { name: 'Today' })).toBeFocused()
    await expect(panel).toContainText('Today is 7 October 2026 (UTC).')
    // A quick period is used at once.
    await panel.getByRole('button', { name: 'Last quarter' }).click()
    await expect(panel).toBeHidden()
    await expect(box(page)).toBeFocused()
    expect(await questionWords(page)).toBe('orders in the United Kingdom last quarter ')
    await expect(chips(page)).toHaveText([/last quarter\s·\s1 Jul to 30 Sept 2026/])
    await expect(reads(page).locator('[data-source="tagged"]')).toHaveText([
      '1 Jul to 30 Sept 2026',
    ])
    // The chip opens its dates again; Enter uses the new ones.
    await chips(page).click()
    await expect(panel.getByRole('button', { name: 'Last quarter' })).toBeFocused()
    await expect(panel).toContainText('Asks about 1 Jul to 30 Sept 2026, both days included.')
    // Days typed in From and To go in with Use these dates.
    await panel.getByRole('textbox', { name: 'From', exact: true }).fill('4 Aug 2026')
    await panel.getByRole('textbox', { name: 'To', exact: true }).fill('20 Aug 2026')
    await page.keyboard.press('Tab')
    await expect(panel).toContainText('Asks about 4 to 20 Aug 2026, both days included.')
    await panel.getByRole('button', { name: 'Use these dates' }).click()
    await expect(panel).toBeHidden()
    // Days no quick period names read as the days: the chip's words say them.
    expect(await questionWords(page)).toBe('orders in the United Kingdom 4 to 20 Aug 2026 ')
    await expect(reads(page).locator('[data-source="tagged"]')).toHaveText(['4 to 20 Aug 2026'])
    // Remove dates takes the chip out of the question; today is assumed again.
    await chips(page).click()
    await panel.getByRole('button', { name: 'Remove dates' }).click()
    await expect(chips(page)).toHaveCount(0)
    await expect(reads(page).locator('[data-source="assumed"]')).toHaveText(
      'Today, 7 Oct 2026 · no dates given',
    )
    await expect(answer(page)).toHaveCount(0)
  })

  test('the line reads the words as typed, and the question goes with exactly what it shows', async ({
    page,
  }) => {
    await openAsk(page)
    await box(page).fill('what was revenue in the United Kingdom in 2026')
    // Once typing rests: the market and the whole year from the words, and "revenue" names two
    // metrics, so it asks which, with one click for each.
    await expect(reads(page).locator('[data-source="typed"]')).toHaveText([
      /Market\s*United Kingdom/,
      /^1 Jan to 31 Dec 2026 · the whole year/,
    ])
    await expect(reads(page)).toContainText('“revenue”: which one?')
    const live = page.locator('[data-slot="ask-reads"] [aria-live="polite"]')
    await expect(live).toHaveText(
      'About: Market United Kingdom and 1 Jan to 31 Dec 2026, the whole year, including the days after today. “revenue” could be Gross sales or Net revenue.',
    )
    // The box says it too, for whoever is in it.
    await expect(box(page)).toHaveAccessibleDescription(/^About: Market United Kingdom/)
    await reads(page).getByRole('button', { name: 'Use Net revenue for “revenue”' }).click()
    await expect(box(page)).toBeFocused()
    await expect(reads(page)).not.toContainText('which one?')
    // The choice makes the words a chip of it, in the question.
    await expect(chips(page)).toHaveText([/revenue/])
    await expect(reads(page).locator('[data-source="tagged"]')).toContainText('Net revenue')
    await box(page).press('Enter')
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    // The question was asked with what the line showed, and the answer read exactly that.
    const asked = page.getByRole('list', { name: 'Asked about' })
    await expect(asked.getByRole('listitem')).toHaveText([
      /Net revenue/,
      /Market\s*United Kingdom/,
      '1 Jan to 31 Dec 2026',
    ])
    await assistant(page).getByRole('link', { name: 'Open page' }).click()
    const used = page.getByRole('list', { name: 'What the answer is about' })
    await expect(used.getByRole('listitem')).toHaveText([
      /Net revenue/,
      /Market\s*United Kingdom/,
      '1 Jan to 31 Dec 2026',
    ])
  })

  test('the next question carries the last one’s scope, each part removable, and nothing picked sticks', async ({
    page,
  }) => {
    await openAsk(page)
    await box(page).fill('Which facts apply in the United Kingdom in June 2026 to ')
    await page.keyboard.type('@Average order')
    await expect(page.getByRole('option', { name: /^Average order/ }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(reads(page).locator('[data-source="tagged"]')).toContainText('Average order value')
    await box(page).press('Enter')
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(answer(page)).toContainText(
      'Two facts apply to Average order value, United Kingdom.',
    )
    // The chip went with that question only: the next shows the whole scope as carried.
    await expect(reads(page).locator('[data-source="tagged"]')).toHaveCount(0)
    await expect(reads(page).locator('[data-source="carried"]')).toHaveText([
      /Average order value/,
      /Market\s*United Kingdom/,
      /1 to 30 June? 2026 · carried/,
    ])
    // A market in the words replaces the market carried; the metric and the dates stay carried.
    await box(page).fill('and in the Netherlands?')
    await expect(reads(page).locator('[data-source="typed"]')).toHaveText([/Market\s*Netherlands/])
    await expect(reads(page).locator('[data-source="carried"]')).toHaveCount(2)
    // Dropping the carried dates leaves today, said as assumed.
    await reads(page)
      .getByRole('button', { name: /^Remove the dates .*carried from your last question$/ })
      .click()
    await expect(box(page)).toBeFocused()
    await expect(reads(page).locator('[data-source="assumed"]')).toHaveText(
      'Today, 7 Oct 2026 · no dates given',
    )
    await box(page).press('Enter')
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    const question = page.locator('[data-slot="ask-question"]').last()
    await expect(question).toContainText(
      'Also about Average order value, from your last question. No dates given, so I used today, 7 October 2026.',
    )
    // New chat starts over: nothing is carried into it.
    await assistant(page).getByRole('button', { name: 'New chat' }).click()
    await box(page).fill('anything new?')
    await expect(reads(page).locator('[data-source="carried"]')).toHaveCount(0)
  })

  test('a scope picked from the address stays for the next questions while it is pinned', async ({
    page,
  }) => {
    await openPage(page, '/assistant?about=metric:average_order_value', desktop)
    await chipEditor(page)
    await expect(reads(page).locator('[data-source="picked"]')).toContainText('Average order value')
    const pin = reads(page).getByRole('button', {
      name: 'Keep what you picked for the next questions',
    })
    await expect(pin).toHaveAttribute('aria-pressed', 'false')
    await pin.click()
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await box(page).fill('which facts apply to this?')
    await box(page).press('Enter')
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(reads(page).locator('[data-source="picked"]')).toContainText('Average order value')
    await expect(pin).toHaveAttribute('aria-pressed', 'true')
    await pin.click()
    await box(page).fill('and now?')
    await box(page).press('Enter')
    await expect(answer(page).last()).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(reads(page).locator('[data-source="picked"]')).toHaveCount(0)
  })

  test('words Heed cannot read as dates are named, with a way to pick dates', async ({ page }) => {
    await openAsk(page)
    await box(page).fill('orders in the United Kingdom since the launch')
    const problem = reads(page).locator('[data-source="unreadable"]')
    await expect(problem).toHaveText('“since the launch”: not dates that can be read')
    await reads(page).getByRole('button', { name: 'Pick dates' }).click()
    const panel = page.locator('[data-slot="ask-dates"]')
    await expect(panel).toBeVisible()
    await panel.getByRole('button', { name: 'Last month' }).click()
    // The dates go in the question as a chip, and stand over the words Heed cannot read.
    await expect(reads(page).locator('[data-source="tagged"]')).toHaveText(['1 to 30 Sept 2026'])
    await expect(reads(page).locator('[data-source="unreadable"]')).toHaveCount(0)
    expect(await questionWords(page)).toBe(
      'orders in the United Kingdom since the launch last month ',
    )
  })

  test('nothing applies: it says so, and Start a draft opens Add a fact with the scope', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, ASK_NO_MATCH)
    await expect(
      answer(page).getByText('Nothing is written down for Average order value, United Kingdom.'),
    ).toBeVisible()
    await expect(announcer(page)).toHaveText('Answer ready. Nothing is written down for this.')
    const missing = answer(page).locator('[data-slot="ask-not-found"]')
    await expect(missing).toContainText('Nothing is written down for this')
    await missing.getByRole('link', { name: 'Start a draft' }).click()
    await expect
      .poll(() => address(page))
      .toMatch(
        /\/library\/new\?about=metric:average_order_value,val:market\/united_kingdom&from=2019-01-01$/,
      )
  })

  test('a table reads as a table, scrolls in the panel, and its page link opens in the app', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, ASK_TABLE)
    const text = answer(page).locator('[data-slot="ask-answer-text"]')
    const table = text.getByRole('table')
    await expect(table.getByRole('columnheader')).toHaveText([
      'Domain',
      'What it is',
      'Facts',
      'Owners',
      'Issues',
    ])
    // Not one Markdown sign is left: the lines after the table are prose, not rows.
    await expect(text).not.toContainText('|')
    await expect(text.getByText(/has the most facts/)).toHaveCount(1)
    // It stays inside the panel: a wider one scrolls in its own frame (the phone test).
    const panel = (await assistant(page).boundingBox())!
    const frame = (await text.getByRole('group', { name: 'Table' }).boundingBox())!
    expect(frame.x + frame.width).toBeLessThanOrEqual(panel.x + panel.width)
    const unfold = answer(page).getByRole('button', { name: 'Show the rest of the answer' })
    if (await unfold.isVisible()) await unfold.click()
    await text.getByRole('link', { name: 'Needs a look' }).click()
    await expect(page).toHaveURL(/\/library\?view=attention$/)
    // The page opens beside the panel, which keeps the conversation.
    await expect(assistant(page)).toBeVisible()
    await expect(answer(page).getByRole('table')).toBeVisible()
  })

  test('while a table streams, its header never shows as a line of pipes', async ({ page }) => {
    await openAsk(page)
    // Every state of the answer's words the page draws, from the first sentence to the last.
    await page.evaluate(() => {
      const seen: string[] = []
      Object.assign(window, { seen })
      new MutationObserver(() => {
        const words = document.querySelector('[data-slot="ask-answer-text"]')?.textContent
        if (words && words !== seen.at(-1)) seen.push(words)
      }).observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await askAndWait(page, ASK_TABLE)
    const seen = await page.evaluate(() => (window as unknown as { seen: string[] }).seen)
    // The answer arrived in steps: its sentence, the table's header, its rows, the lines after.
    expect(seen.length).toBeGreaterThan(3)
    expect(seen.filter((words) => words.includes('|'))).toEqual([])
  })

  test('a short answer shows in full: no fade and no Show the rest, though each block rose in', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, ASK_SHORT)
    const text = answer(page).locator('[data-slot="ask-answer-text"]')
    // Its words are shorter than the fold, so nothing is hidden.
    const [content, frame] = await text.evaluate((node) => [
      (node.firstElementChild as HTMLElement).offsetHeight,
      node.clientHeight,
    ])
    expect(content).toBeLessThanOrEqual(frame)
    await expect(text).not.toHaveAttribute('data-folded')
    await expect(
      answer(page).getByRole('button', { name: 'Show the rest of the answer' }),
    ).toHaveCount(0)
  })

  test('an answer a few lines past the fold shows whole on a phone, not behind Show the rest', async ({
    page,
  }) => {
    await openAsk(page, phone)
    await askAndWait(page, ASK_NO_MATCH)
    const text = answer(page).locator('[data-slot="ask-answer-text"]')
    // Its words run past the fold (18rem), by less than half the fold again.
    const [content, frame] = await text.evaluate((node) => [
      (node.firstElementChild as HTMLElement).offsetHeight,
      node.clientHeight,
    ])
    expect(content).toBeGreaterThan(288)
    expect(content).toBeLessThanOrEqual(288 * 1.5)
    expect(frame).toBe(content)
    await expect(text).not.toHaveAttribute('data-folded')
    await expect(
      answer(page).getByRole('button', { name: 'Show the rest of the answer' }),
    ).toHaveCount(0)
  })

  test('a long answer folds and stops at its length limit, and Continue asks on', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, 'What does the Sales domain cover?')
    await expect(answer(page).locator('[data-slot="ask-answer-text"]')).toHaveAttribute(
      'data-folded',
    )
    await answer(page).getByRole('button', { name: 'Show the rest of the answer' }).click()
    await expect(answer(page).locator('[data-slot="ask-answer-text"]')).not.toHaveAttribute(
      'data-folded',
    )
    await expect(answer(page).getByText('The answer reached its length limit')).toBeVisible()
    await answer(page).getByRole('button', { name: 'Continue' }).click()
    await expect(page.locator('[data-slot="ask-question"]').last().locator('p').first()).toHaveText(
      'You asked: Continue.',
    )
  })
})

test.describe('Ask as the answer arrives', () => {
  /** Where the newest question sits: its gap under what covers the top of the view. */
  async function gapAboveQuestion(page: Page, cover: { y: number; height: number } | null) {
    const question = await page.locator('[data-slot="ask-question"]').last().boundingBox()
    return Math.round(question!.y - (cover ? cover.y + cover.height : 0))
  }
  const minHeights = (page: Page) =>
    page
      .getByRole('article', { name: 'Answer' })
      .evaluateAll((all) => all.map((article) => getComputedStyle(article).minHeight))

  for (const size of [desktop, phone])
    test(`at ${size.width}px, the next question comes to the top of the panel with room under it`, async ({
      page,
    }) => {
      await openAsk(page, size)
      await askAndWait(page, ASK_MATCH)
      // A short answer to a second question: before the room, the scroll stopped well short.
      await askAndWait(page, 'thanks')
      const tabs = await assistant(page).getByRole('tablist').boundingBox()
      expect(await gapAboveQuestion(page, tabs)).toBe(16)
      // The newest answer keeps the room; the one before gave it up.
      const [older, newest] = await minHeights(page)
      expect(older).toBe('auto')
      expect(Number.parseFloat(newest!)).toBeGreaterThan(0)
    })

  test('on the page, the next question comes to the top under the header', async ({ page }) => {
    await openPage(page, '/assistant', desktop)
    await askAndWait(page, ASK_MATCH)
    await askAndWait(page, 'thanks')
    const header = await page.locator('[data-layout="header"]').boundingBox()
    expect(await gapAboveQuestion(page, header)).toBe(16)
  })

  test('a Latest pill shows while the newest words are below the fold, and goes to them', async ({
    page,
  }) => {
    await openAsk(page)
    const latest = assistant(page).locator('[data-slot="ask-latest"]')
    await askAndWait(page, 'thanks')
    await expect(latest).toHaveAttribute('data-hidden')
    await expect(latest).toHaveAttribute('inert')
    await askAndWait(page, 'What does the Sales domain cover?')
    await expect(latest).not.toHaveAttribute('data-hidden')
    await latest.getByRole('button', { name: 'Latest' }).click()
    await expect(latest).toHaveAttribute('data-hidden')
    const scroller = assistant(page).locator('.overflow-y-auto').first()
    expect(
      await scroller.evaluate((node) => node.scrollHeight - node.clientHeight - node.scrollTop),
    ).toBeLessThan(2)
    await expect(answer(page).getByRole('note')).toBeInViewport()
  })

  test('only what arrives settles in: a conversation opened again holds still', async ({
    page,
  }) => {
    await openAsk(page)
    await askAndWait(page, ASK_MATCH)
    const settling = assistant(page).locator(
      '.animate-arrive, .animate-arrive-fast, .animate-settle',
    )
    expect(await settling.count()).toBeGreaterThan(0)
    await assistant(page).getByRole('button', { name: 'Close' }).click()
    // Opened again once it has left: during its 100 ms exit the same panel would come back.
    await expect(page.locator('[data-slot="dock-panel"]')).toHaveCount(0)
    await launcher(page).click()
    await expect(answer(page)).toHaveAttribute('data-state', 'done')
    await expect(settling).toHaveCount(0)
  })

  test('the answer reads at 15 on 24, as item prose does', async ({ page }) => {
    await openAsk(page)
    await askAndWait(page, ASK_MATCH)
    const prose = answer(page).locator('[data-slot="answer-markdown"] p').first()
    const type = await prose.evaluate((node) => {
      const style = getComputedStyle(node)
      return [style.fontSize, style.lineHeight]
    })
    expect(type).toEqual(['15px', '24px'])
  })
})

test.describe('Ask when it cannot answer', () => {
  test('a spending limit pauses asking, says which and when, and Try it still works', async ({
    page,
  }) => {
    await openAsk(page, desktop, 'assistant-limit')
    await askAndWait(page, ASK_MATCH)
    await expect(
      answer(page).getByText('You’ve reached today’s limit for the assistant'),
    ).toBeVisible()
    await expect(answer(page)).toContainText('It resets within 24 hours.')
    await expect(answer(page)).not.toContainText('$')
    await expect(box(page)).toHaveAttribute('aria-disabled', 'true')
    await expect(box(page)).toHaveAttribute('contenteditable', 'false')
    await expect(box(page)).toHaveAttribute(
      'aria-placeholder',
      'You can ask again once the limit resets',
    )
    await answer(page).getByRole('button', { name: 'Open Try a question' }).click()
    await expect(assistant(page).getByRole('tab', { name: 'Try a question' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
  })

  test('an answer that fails part way keeps what came and asks again', async ({ page }) => {
    await openAsk(page, desktop, 'assistant-fails')
    await askAndWait(page, ASK_MATCH)
    await expect(answer(page)).toHaveAttribute('data-state', 'failed')
    await expect(answer(page).getByText('The assistant couldn’t finish')).toBeVisible()
    await expect(
      answer(page).getByText('Two facts apply to Average order value, United Kingdom.'),
    ).toBeVisible()
    await expect(announcer(page)).toHaveText('The assistant couldn’t answer.')
    await page.evaluate(() => window.localStorage.removeItem('cl.mock-scenario'))
    await answer(page).getByRole('button', { name: 'Try again' }).click()
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
  })

  test('a refusal says the assistant can’t answer, without a checked row of facts', async ({
    page,
  }) => {
    await openAsk(page, desktop, 'assistant-refuses')
    await askAndWait(page, ASK_MATCH)
    await expect(answer(page).getByText('The assistant can’t answer this one')).toBeVisible()
    await expect(announcer(page)).toHaveText('The assistant can’t answer this one.')
    await expect(answer(page).getByRole('button', { name: 'Copy answer' })).toHaveCount(0)
  })

  test('while it works it says so once, and Stop ends the answer', async ({ page }) => {
    await openAsk(page, desktop, 'slow')
    await box(page).fill(ASK_MATCH)
    await box(page).press('Enter')
    await expect(announcer(page)).toHaveText('Working on it.')
    await expect(answer(page)).toHaveAttribute('data-state', 'working')
    await expect(answer(page)).toContainText(
      'Working on it. Each sentence shows once it’s checked.',
    )
    // The running step is in the present, and the trail stays open while the answer works.
    await expect(answer(page).locator('[data-slot="trail-step"][data-running]').first()).toHaveText(
      'Looking up facts',
      // The slow binding takes a few seconds before the first step comes in.
      { timeout: 15_000 },
    )
    await expect(
      answer(page).getByRole('button', { name: /^What the assistant did: / }),
    ).toHaveCount(0)
    await assistant(page).getByRole('button', { name: 'Stop' }).click()
    await expect(assistant(page).getByRole('button', { name: 'Send' })).toBeVisible()
  })

  test('New chat in the bar starts over, and asks first when a typed question would be lost', async ({
    page,
  }) => {
    await openAsk(page)
    const newChat = assistant(page).getByRole('button', { name: 'New chat' })
    await expect(newChat).toBeDisabled()
    await box(page).fill(ASK_MATCH)
    await box(page).press('Enter')
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await box(page).fill('And last month?')
    await newChat.click()
    const dialog = page.getByRole('alertdialog', { name: 'Start a new chat?' })
    await expect(dialog).toContainText("The question you typed hasn't been sent")
    await dialog.getByRole('button', { name: 'Start new chat' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(answer(page)).toHaveCount(0)
    expect(await questionWords(page)).toBe('')
    await expect(box(page)).toBeFocused()
    await expect(
      assistant(page).getByRole('heading', { name: 'Ask me about your numbers' }),
    ).toBeVisible()
  })
})

/** Asks the suggested scope question: the next one carries a metric, a market and dates. */
async function carryThree(page: Page) {
  await page
    .getByRole('list', { name: 'Suggested questions' })
    .getByRole('button', { name: /^See what applies/ })
    .click()
  await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
  await expect(reads(page).locator('[data-source="carried"]')).toHaveCount(3)
  await settle(page)
}
/** The line's box, each chip's box, and how far it scrolls. */
const measure = (page: Page) =>
  reads(page).evaluate((line: HTMLElement) => {
    const box = line.getBoundingClientRect()
    const items = [...line.children].map((item) => item.getBoundingClientRect())
    return {
      left: box.left,
      right: box.right,
      height: box.height,
      inside: items.every((item) => item.top >= box.top && item.bottom <= box.bottom),
      // Whole pixels: a chip's width has fractions.
      items: items.map((item) => ({ left: Math.round(item.left), right: Math.round(item.right) })),
      scroll: line.scrollLeft,
      scrollMax: line.scrollWidth - line.clientWidth,
    }
  })
const composer = (page: Page) =>
  page.locator('[data-slot="ask-composer"]').filter({ visible: true })
const note = (page: Page) => composer(page).locator(':scope > p')

test.describe('The About line', () => {
  const surfaces = [
    { name: 'the page at 1440', path: '/assistant', size: desktop, composer: 150 },
    { name: 'the panel at 480', size: desktop, composer: 150 },
    { name: 'the panel at 400', size: desktop, dock: 400, composer: 150 },
    { name: 'a phone at 320', size: { width: 320, height: 700, theme: 'dark' } as const },
  ]
  for (const surface of surfaces)
    test(`is one line, one chip high, on ${surface.name}`, async ({ page }) => {
      if (surface.path) {
        await openPage(page, surface.path, surface.size)
        await chipEditor(page)
      } else {
        if (surface.dock)
          await page.addInitScript((width) => {
            document.documentElement.style.setProperty('--dock-width', `${width}px`)
          }, surface.dock)
        await openAsk(page, surface.size)
      }
      await carryThree(page)
      const line = await measure(page)
      // The chips never wrap: one row, 24 high, whatever the width.
      expect(line.height).toBe(24)
      expect(line.inside).toBe(true)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
        surface.size.width,
      )
      // After an answer the note under the box stays one line, with no edition in it.
      await expect(note(page)).toHaveText('This chat isn’t saved.')
      if (surface.composer) {
        expect((await note(page).boundingBox())!.height).toBe(16)
        expect((await composer(page).boundingBox())!.height).toBe(surface.composer)
      }
    })

  test('fades at an edge that hides a chip, and the keys and focus bring every chip into view', async ({
    page,
  }) => {
    await page.addInitScript(() =>
      document.documentElement.style.setProperty('--dock-width', '400px'),
    )
    await openAsk(page)
    await carryThree(page)
    const dates = reads(page).locator('[data-source="carried"]').last()
    await expect(dates).toContainText('· carried')
    // The dates come last and are out of sight: the end fades, the start does not.
    let line = await measure(page)
    expect(line.scrollMax).toBeGreaterThan(0)
    expect(line.items.at(-1)!.right).toBeGreaterThan(line.right)
    await expect(reads(page)).toHaveAttribute('data-clip-end', 'true')
    await expect(reads(page)).not.toHaveAttribute('data-clip-start')
    expect(await reads(page).evaluate((node) => getComputedStyle(node).maskImage)).toContain(
      'calc(100% - 24px)',
    )

    // While some is hidden the line is a tab stop after the words, and the arrows scroll it.
    await box(page).click()
    await page.keyboard.press('Tab')
    await expect(reads(page)).toBeFocused()
    await expect
      .poll(async () => {
        await page.keyboard.press('ArrowRight')
        return (await measure(page)).scroll
      })
      .toBe(line.scrollMax)
    await expect(reads(page)).toHaveAttribute('data-clip-start', 'true')
    await expect(reads(page)).not.toHaveAttribute('data-clip-end')
    line = await measure(page)
    expect(line.items.at(-1)!.right).toBeLessThanOrEqual(line.right)

    // The first chip's remove button, now out of sight, scrolls its chip into view on focus.
    await page.keyboard.press('Tab')
    await expect(
      reads(page).getByRole('button', { name: /^Remove Average order value/ }),
    ).toBeFocused()
    await expect.poll(async () => (await measure(page)).scroll).toBe(0)
    await expect(reads(page)).not.toHaveAttribute('data-clip-start')

    // Each remove button in turn: its chip is in full view, clear of the fade.
    for (const name of [/^Remove Market Netherlands/, /^Remove the dates /]) {
      await page.keyboard.press('Tab')
      const focused = reads(page).getByRole('button', { name })
      await expect(focused).toBeFocused()
      const chip = focused.locator('xpath=ancestor::*[@data-slot="reads-chip"][1]')
      await expect
        .poll(async () => {
          const [within, shown] = [await measure(page), (await chip.boundingBox())!]
          return (
            Math.round(shown.x) >= within.left && Math.round(shown.x + shown.width) <= within.right
          )
        })
        .toBe(true)
    }
  })

  test('with nothing hidden it is no tab stop and has no fade', async ({ page }) => {
    await openAsk(page)
    await box(page).fill('orders')
    await expect(reads(page).locator('[data-source="assumed"]')).toBeVisible()
    await expect(reads(page)).not.toHaveAttribute('tabindex')
    await expect(reads(page)).not.toHaveAttribute('data-clip-start')
    await expect(reads(page)).not.toHaveAttribute('data-clip-end')
  })

  test('scrolls smoothly, and at once with less motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await openAsk(page)
    await box(page).fill('orders')
    const motion = () =>
      reads(page).evaluate((node) => {
        const style = getComputedStyle(node)
        return { scroll: style.scrollBehavior, fade: style.transitionDuration }
      })
    expect(await motion()).toEqual({ scroll: 'smooth', fade: '0.15s, 0.15s' })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await motion()).toEqual({ scroll: 'auto', fade: '0s' })
  })
})

test.describe('Ask from the keyboard', () => {
  test('Control backslash docks Ask, Enter asks, Up brings the question back, Escape closes', async ({
    page,
  }) => {
    await openPage(page, '/library', desktop)
    await page.keyboard.press('Control+Backslash')
    await expect(assistant(page)).toBeFocused()
    await page.keyboard.press('Tab')
    // The first stop in the tab is the first suggested question; the box is reached directly.
    await box(page).focus()
    await page.keyboard.type(ASK_MATCH)
    await page.keyboard.press('Enter')
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    await expect(box(page)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    expect(await questionWords(page)).toBe(ASK_MATCH)
    await page.keyboard.press('Escape')
    await expect(assistant(page)).toHaveCount(0)
  })
})

test.describe('Ask typed on a fresh page', () => {
  /*
    A question typed by hand on a page just opened, as the captain asked one: the chip editor is a
    chunk of its own, so the plain box takes the first words and the editor takes over mid
    question. Every key goes on into the question, and Enter or Send asks it at once.
  */
  for (const size of [desktop, phone])
    for (const by of ['Enter', 'Send'] as const)
      test(`at ${size.name}px, typed while the editor loads and sent with ${by}`, async ({
        page,
      }) => {
        let arrive!: () => void
        const held = new Promise<void>((resolve) => (arrive = resolve))
        await page.route(/ask-editor-[\w-]+\.js$/, async (route) => {
          await held
          await route.continue()
        })
        await openPage(page, '/assistant', size)
        const composer = page.locator('[data-slot="ask-composer"]')
        await expect(composer).toHaveAttribute('data-box', 'loading')
        await box(page).click()
        await page.keyboard.type('Which facts apply to ')
        arrive()
        await expect(composer).toHaveAttribute('data-box', 'chips', { timeout: 15_000 })
        // The editor took the focus with the words: the keys typed next go on into the question.
        await expect(box(page)).toBeFocused()
        await page.keyboard.type('Average order value in the United Kingdom in June 2026?')
        expect(await questionWords(page)).toBe(ASK_MATCH)
        if (by === 'Enter') await page.keyboard.press('Enter')
        else await page.getByRole('button', { name: 'Send' }).click()
        // The question is in the conversation at once, and its answer follows.
        await expect(page.locator('[data-slot="ask-question"]')).toContainText(ASK_MATCH)
        expect(await questionWords(page)).toBe('')
        await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
        await expect(box(page)).toBeFocused()
      })

  test('typed with a chip from @ and dates in its words, and sent with Send', async ({ page }) => {
    await openPage(page, '/assistant', desktop)
    await chipEditor(page)
    await box(page).click()
    await page.keyboard.type('Which facts apply to @Average order')
    const list = page.getByRole('listbox', {
      name: 'Mention a metric, value, dimension, fact or domain',
    })
    // The metric leads; items about it follow in their own group.
    await expect(list.getByRole('option', { name: /^Average order value/ }).first()).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(chips(page)).toHaveText([/Average order value/])
    await page.keyboard.type(' in the United Kingdom in June 2026?')
    // The line reads the typed market and dates before it goes.
    await expect(reads(page).locator('[data-source="typed"]')).toHaveText([
      /Market\s*United Kingdom/,
      /Jun 2026/,
    ])
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.locator('[data-slot="ask-question"]')).toContainText(
      'Which facts apply to Average order value in the United Kingdom in June 2026?',
    )
    await expect(answer(page)).toHaveAttribute('data-state', 'done', { timeout: 15_000 })
    // It went with what the line showed.
    await expect(page.getByRole('list', { name: 'Asked about' }).getByRole('listitem')).toHaveText([
      /Average order value/,
      /Market\s*United Kingdom/,
      /Jun 2026/,
    ])
  })
})

test.describe('Ask on a phone', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('fills the screen, and a tapped chip opens its fact in a sheet', async ({ page }) => {
    await openAsk(page, phone)
    await expect(assistant(page)).toHaveAttribute('data-mode', 'full')
    await askAndWait(page, ASK_MATCH)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    const chip = answer(page).locator('[data-slot="ask-answer-text"] a').first()
    await chip.tap()
    await expect(page.getByRole('dialog', { name: /Payment provider switched/ })).toBeVisible()
    await expect(page.getByRole('dialog', { name: /Payment provider switched/ })).toContainText(
      'Payment provider switched',
    )
    // The tap previews; the panel and its answer stay where they were.
    await expect(answer(page)).toBeVisible()
  })

  test('the About line scrolls sideways under a finger, and the page does not', async ({
    page,
  }) => {
    // The narrowest phone: the three chips of the market in the page (a short name) must not fit.
    await openAsk(page, { ...phone, width: 320 })
    await carryThree(page)
    const line = (await reads(page).boundingBox())!
    const cdp = await page.context().newCDPSession(page)
    // One finger dragged left along the line, as touch events: the synthesized scroll gesture
    // does not move a scroller in headless Chromium on Linux.
    const y = Math.round(line.y + line.height / 2)
    const from = Math.round(line.x + line.width - 40)
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: from, y }],
    })
    for (let step = 1; step <= 10; step++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: from - step * 20, y }],
      })
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
    await expect.poll(async () => (await measure(page)).scroll).toBeGreaterThan(0)
    await expect(reads(page)).toHaveAttribute('data-clip-start', 'true')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
  })

  test('a wide table scrolls sideways inside the answer, never the screen', async ({ page }) => {
    await openAsk(page, phone)
    await askAndWait(page, ASK_TABLE)
    const frame = answer(page).getByRole('group', { name: 'Table' })
    await expect(frame).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390)
    const bounds = (await frame.boundingBox())!
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(390)
    // The first column, each row's name, stays in view as the rest scrolls under it.
    await frame.evaluate((node) => node.scrollTo({ left: node.scrollWidth }))
    const name = frame.getByRole('rowheader').first()
    expect((await name.boundingBox())!.x).toBeGreaterThanOrEqual(bounds.x)
  })
})

const wcag = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const states = [
  { name: 'empty' },
  { name: 'answer', question: ASK_MATCH },
  { name: 'not found', question: ASK_NO_MATCH },
  { name: 'limit', question: ASK_MATCH, scenario: 'assistant-limit' },
  { name: 'failed', question: ASK_MATCH, scenario: 'assistant-fails' },
  { name: 'refused', question: ASK_MATCH, scenario: 'assistant-refuses' },
  { name: 'long', question: 'What does the Sales domain cover?' },
  { name: 'table', question: ASK_TABLE },
  // The line with words to choose between and dates it cannot read, after an answer it carries.
  { name: 'reads', question: ASK_MATCH, typed: 'revenue in the Netherlands since the launch' },
] as const

for (const size of [widths[0], widths[2]]) {
  for (const theme of themes) {
    test.describe(`axe on Ask at ${size.name}px, ${theme}`, () => {
      for (const state of states) {
        test(state.name, async ({ page }) => {
          await openAsk(page, { ...size, theme }, 'scenario' in state ? state.scenario : undefined)
          if ('question' in state) await askAndWait(page, state.question)
          if ('typed' in state) {
            await box(page).fill(state.typed)
            await expect(reads(page)).toContainText('which one?')
          }
          await settle(page)
          const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
          expect(
            results.violations.map(
              (v) => `${v.id}: ${v.nodes.map((node) => node.target.join(' ')).join(' | ')}`,
            ),
          ).toEqual([])
        })
      }
      test('the page', async ({ page }) => {
        await openPage(page, '/assistant', { ...size, theme })
        await askAndWait(page, ASK_MATCH)
        const results = await new AxeBuilder({ page }).withTags(wcag).analyze()
        expect(results.violations.map((v) => v.id)).toEqual([])
      })
    })
  }
}
