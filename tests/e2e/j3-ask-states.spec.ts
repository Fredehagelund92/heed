import type { Page } from '@playwright/test'
import { expect, go, test } from './go.ts'

// J3, an answer in each of its six states, as the chat draws it: the state as a badge alone at the
// head of the answer, its meaning in a card on the badge (on hover, on keyboard focus and on a
// tap), the words at 16/26 inside the reading measure, the sources as numbered chips with what was
// looked up beside them, and one row of icons with More. The composer is one surface with Send in
// one 32 px slot.

const states = [
  {
    label: 'Checked',
    sentence: 'This is written down and checked.',
    question: 'Why did orders in Norway drop in August?',
    sources: 2,
  },
  {
    label: 'Partial',
    sentence: 'Only part of this is written down.',
    question: 'How did orders do in Norway and Spain last quarter?',
    sources: 1,
  },
  {
    label: 'Not found',
    sentence: 'Nothing is written about this yet.',
    question: 'How did orders in Spain change in October 2026?',
    sources: 0,
  },
  {
    label: 'Conflict',
    sentence: 'Two items say different things.',
    question: 'Do Norway orders include gift-card money?',
    sources: 2,
  },
  {
    label: 'Outdated',
    sentence: 'Some of this may be old.',
    question: 'Why did Norway returns drop at the end of April?',
    sources: 1,
  },
  {
    label: 'Not checked',
    sentence: 'The check did not run.',
    question: 'What changed in returns in the United Kingdom this week?',
    sources: 0,
  },
] as const

const badgeName = new RegExp(`^(${states.map((s) => s.label).join('|')})$`)

/** Asks, and waits until the answer is finished: its badge in, Stop gone and the row settled. */
async function ask(page: Page, question: string) {
  const turns = page.locator('[data-turn]')
  const n = await turns.count()
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
  await expect(turns.nth(n).getByRole('button', { name: badgeName })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  await expect(
    turns
      .nth(n)
      .getByRole('button', { name: /^(More|Ask again)$/ })
      .last(),
  ).toBeVisible()
}

for (const s of states)
  test(`${s.label}: the badge alone, its meaning in its card, chips and one row of icons`, async ({
    page,
  }) => {
    await go(page, `/ask?n=${Date.now()}`)
    await ask(page, s.question)
    const log = page.getByRole('log')
    const badge = log.getByRole('button', { name: s.label, exact: true })
    await expect(badge).toBeVisible()
    await expect(badge).toHaveAttribute('aria-haspopup', 'dialog')
    // A 24 px badge, and nothing beside or under it says what it means: its card does.
    expect((await badge.boundingBox())!.height).toBe(24)
    await expect(log.getByText(s.sentence)).toHaveCount(0)
    await expect(log.getByText('These two disagree')).toHaveCount(0)

    // Hovered, the card opens above the badge, 8 px away, and says what it means.
    await badge.hover()
    const card = page.getByRole('dialog', { name: `What ${s.label} means` })
    await expect(card).toBeVisible()
    await expect(card).toContainText(s.sentence.charAt(0).toLowerCase() + s.sentence.slice(1))
    await expect(badge).toHaveAttribute('aria-expanded', 'true')
    const [b, c] = [(await badge.boundingBox())!, (await card.boundingBox())!]
    // Above when there is room, below when not; never over the badge.
    expect(c.y + c.height <= b.y - 7 || c.y >= b.y + b.height + 7).toBe(true)
    // Gone soon after the pointer leaves.
    await page.mouse.move(0, 0)
    await expect(card).toBeHidden()

    // The words at 16 px on 26 px lines, inside the 60ch measure.
    const words = log.locator('[data-answer-words]')
    if (s.label !== 'Not checked') {
      const type = await words.evaluate((el) => {
        const style = getComputedStyle(el)
        return { size: style.fontSize, line: style.lineHeight, width: el.clientWidth }
      })
      expect(type.size).toBe('16px')
      expect(type.line).toBe('26px')
      expect(type.width).toBeLessThanOrEqual(600)
    }

    // The sources as numbered chips, with what was looked up beside them; no helper lines.
    await expect(log.getByRole('button', { name: /^Source \d+: / })).toHaveCount(s.sources)
    await expect(log.getByRole('button', { name: /^(Looked up|The look-up)/ })).toBeVisible()
    await expect(log.getByText('Select a sentence to see where it says that.')).toHaveCount(0)
    await expect(log.getByText(/^\d+ sources?$/)).toHaveCount(0)

    // One row of icons, the last answer's always on show: Copy, Good, Bad, Ask again and More.
    const actions = log.getByRole('group', { name: 'Answer actions' })
    await expect(actions).toHaveCount(s.label === 'Not checked' ? 0 : 1)
    const names = await actions
      .getByRole('button')
      .evaluateAll((all) => all.map((b) => b.getAttribute('aria-label')))
    // A check that did not run has its own Ask again, and nothing to rate, copy or report.
    if (s.label === 'Not checked') {
      expect(names).toEqual([])
      await expect(log.getByRole('button', { name: 'Ask again', exact: true })).toHaveCount(1)
    } else {
      expect(names).toEqual(['Copy', 'Good answer', 'Bad answer', 'Ask again', 'More'])
      expect(await actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    }
  })

test('Conflict: the amber rule marks the two sentences, and the card names the two items', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'Do Norway orders include gift-card money?')
  const log = page.getByRole('log')
  // The sentences that differ sit behind one amber rule, their words plain.
  const rule = log.locator('[data-differ]')
  await expect(rule).toHaveCount(1)
  const marked = await rule.evaluate((el) => {
    const style = getComputedStyle(el)
    const words = getComputedStyle(el.querySelector('[role="button"]')!)
    return {
      rule: style.borderLeftWidth,
      ink: style.borderLeftColor,
      weight: words.fontWeight,
      line: words.textDecorationLine,
    }
  })
  expect(marked.rule).toBe('2px')
  expect(marked.ink).not.toBe('rgb(0, 0, 0)')
  expect(marked.weight).toBe('400')
  expect(marked.line).toBe('none')

  await log.getByRole('button', { name: 'Conflict', exact: true }).hover()
  const card = page.getByRole('dialog', { name: 'What Conflict means' })
  await expect(card).toContainText('These two disagree')
  const items = card.getByRole('button', { name: /^Source \d+: / })
  await expect(items).toHaveCount(2)
  await items.first().click()
  await expect(page).toHaveURL(/dock=context\./)
})

test('The badge card by keyboard: it opens on focus, Tab goes into it, Escape closes it', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'How did orders in Spain change in October 2026?')
  const badge = page.getByRole('log').getByRole('button', { name: 'Not found', exact: true })
  const card = page.getByRole('dialog', { name: 'What Not found means' })
  // Reached from the answer's first sentence above it, backwards.
  await badge.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(badge).toBeFocused()
  await expect(card).toBeVisible()
  // Focus stays on the badge until Tab takes it into the card.
  await page.keyboard.press('Tab')
  await expect(card.getByRole('link', { name: 'All answer lines' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(card).toBeHidden()
  await expect(badge).toBeFocused()
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('A tap on the badge opens its card inside the screen, and a tap outside closes it', async ({
    page,
  }) => {
    await go(page, `/ask?n=${Date.now()}`)
    await ask(page, 'Do Norway orders include gift-card money?')
    const badge = page.getByRole('log').getByRole('button', { name: 'Conflict', exact: true })
    await badge.tap()
    const card = page.getByRole('dialog', { name: 'What Conflict means' })
    await expect(card).toBeVisible()
    const box = (await card.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
    await page.getByRole('textbox', { name: 'Ask a question' }).tap()
    await expect(card).toBeHidden()
  })
})

test('More holds Something wrong?, Save question and Share; an earlier answer shows its row on hover', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  await ask(page, 'Why did orders in Norway drop in August?')
  await ask(page, 'Why did Norway returns drop at the end of April?')
  const rows = page.getByRole('group', { name: 'Answer actions' })
  // Ask again is the last answer's only.
  await expect(rows.first().getByRole('button', { name: 'Ask again' })).toHaveCount(0)
  expect(await rows.first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
  await page.locator('[data-turn="0"] [data-answer-words]').hover()
  await expect.poll(() => rows.first().evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

  const last = rows.last()
  const more = last.getByRole('button', { name: 'More' })
  await more.click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Something wrong?',
    'Save question',
    'Share',
  ])
  await menu.getByRole('menuitem', { name: 'Save question' }).click()
  const save = page.getByRole('dialog').filter({ hasText: 'Should answer from' })
  await expect(save).toBeVisible()
  await save.getByRole('button', { name: 'Cancel' }).click()
  await expect(save).toBeHidden()
  await expect(more).toBeFocused()

  await more.click()
  await page.getByRole('menuitem', { name: 'Something wrong?' }).click()
  await expect(page.getByText('Which part?')).toBeVisible()
})

test('The composer is one surface: no hairline or keys inside, a 32 px Send, corners of 14 px', async ({
  page,
}) => {
  await go(page, `/ask?n=${Date.now()}`)
  const form = page.locator('form.ask-composer')
  await expect(form).toBeVisible()
  await expect(form.locator('kbd')).toHaveCount(0)
  await expect(form.getByText('to send')).toHaveCount(0)
  expect(await form.evaluate((el) => getComputedStyle(el).borderTopLeftRadius)).toBe('14px')
  // Nothing inside draws a rule across the box.
  const rules = await form.evaluate(
    (el) =>
      [...el.querySelectorAll('*')].filter((c) => {
        const s = getComputedStyle(c)
        return (
          c.getBoundingClientRect().width > el.clientWidth / 2 &&
          s.borderTopWidth !== '0px' &&
          s.borderTopStyle !== 'none' &&
          s.borderTopColor !== 'rgba(0, 0, 0, 0)'
        )
      }).length,
  )
  expect(rules).toBe(0)
  const send = form.getByRole('button', { name: 'Ask', exact: true })
  const size = (await send.boundingBox())!
  expect([size.width, size.height]).toEqual([32, 32])
  // Its keys are in its tooltip.
  await page.getByRole('textbox', { name: 'Ask a question' }).pressSequentially('Orders')
  await send.hover()
  await expect(page.locator('[data-slot=tooltip-content]')).toContainText('Enter')
})
