import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { expectFlatRail, openPage, settle, themes, widths } from './support'
import {
  bodyField,
  chooseKind,
  expectDatePicker,
  fillContext,
  storedDraft,
  summaryField,
  titleField,
  waitForSaved,
} from './context-support'

const submit = (page: Page) =>
  page.getByRole('button', { name: 'Send for review', exact: true }).filter({ visible: true })

for (const width of [1440, 360]) {
  test(`writes mentions, autosaves and submits an open issue at ${width}`, async ({ page }) => {
    await openPage(page, '/library/new', { width, height: 900, theme: 'light' })
    await fillContext(page, { issue: true, mention: true })
    await expect(page.getByRole('radio', { name: 'Still going on' })).toBeChecked()
    await expect(
      page.getByRole('button', { name: /^Started 4 Aug 2026, still going on/ }),
    ).toBeVisible()
    await waitForSaved(page)
    await submit(page).click()
    await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+$/)
    await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Waiting for review')
    await expect(page.getByRole('heading', { name: 'Reporting delay in Norway' })).toBeVisible()
  })
}

test('errors link to fields, and an ended issue needs a last day', async ({ page }) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  // The summary editor is its own chunk; its link in the error summary needs it loaded.
  await expect(summaryField(page)).toBeVisible()
  await submit(page).click()
  await expect(page.getByRole('alert')).toContainText('Write a short summary')
  await page.getByRole('link', { name: /Summary: Write a short summary/ }).click()
  await expect(summaryField(page)).toBeFocused()
  await fillContext(page, { issue: true })
  await page.getByRole('radio', { name: 'It ended' }).click()
  await submit(page).click()
  await expect(page.getByText('Choose the last day, or select Still going on.')).toBeVisible()
  await page.getByRole('textbox', { name: 'Last day', exact: true }).fill('4 Aug 2026')
  await page.getByRole('textbox', { name: 'Last day', exact: true }).press('Tab')
  await waitForSaved(page)
  await submit(page).click()
  await expect(page).toHaveURL(/\/proposals\//)
})

test('one editor for every kind: Markdown as you type, the / menu and the toolbar', async ({
  page,
}) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await chooseKind(page, 'Guide')
  await titleField(page).fill('How to explain a drop after a market closes')
  // Enter in the title goes on to the summary, Enter in the summary on to the body.
  await titleField(page).press('Enter')
  await expect(summaryField(page)).toBeFocused()
  await page.keyboard.type('Use this when a metric moves in a market and nobody has said why.')
  await page.keyboard.press('Enter')
  await expect(bodyField(page)).toBeFocused()

  // The guide's / menu offers its steps template first.
  await page.keyboard.type('/')
  const menu = page.getByRole('listbox', { name: 'Add a block' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('option').first()).toHaveText(/Steps for this guide/)
  await page.keyboard.press('Enter')
  await expect(bodyField(page).getByRole('heading', { name: 'Before you start' })).toBeVisible()
  await page.keyboard.type('Confirm the **period** in @Norw')
  await expect(
    page.getByRole('listbox', { name: 'Mention a metric, value, fact or domain' }),
  ).toBeVisible()
  await page.keyboard.press('Enter')
  await page.keyboard.type('you were asked about.')
  await expect(bodyField(page).locator('strong')).toHaveText('period')

  // Markdown typed at the start of a line becomes the block.
  await bodyField(page).locator('p').last().click()
  await page.keyboard.press('End')
  await page.keyboard.type('Say what the source says.')
  await page.keyboard.press('Enter')
  await page.keyboard.type('> A closure is not proof of a cause.')
  await expect(bodyField(page).locator('blockquote')).toHaveText(
    'A closure is not proof of a cause.',
  )

  // Select the words: the toolbar makes them italic, and Escape closes it.
  await bodyField(page).locator('blockquote p').selectText()
  const toolbar = page.getByRole('toolbar', { name: 'Format the selected words' })
  await expect(toolbar).toBeVisible()
  await toolbar.getByRole('button', { name: 'Italic' }).click()
  await expect(bodyField(page).locator('em')).toHaveText('A closure is not proof of a cause.')
  await page.keyboard.press('Escape')
  await expect(toolbar).toBeHidden()

  const draft = await storedDraft(page)
  expect(draft?.title).toBe('How to explain a drop after a market closes')
  expect(draft?.bodyMarkup).toBe(
    [
      '## Before you start',
      '- Confirm the **period** in @[Norway](val:market/norway) you were asked about.',
      '## Steps',
      '## What to tell the person',
      'Say what the source says.',
      '> *A closure is not proof of a cause.*',
    ].join('\n\n'),
  )
  await expect(page.getByText(/of 20,000 characters/)).toBeVisible()
})

test('a paste longer than the summary moves the rest into the body', async ({ page }) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await summaryField(page).focus()
  const sentence = 'The marketplace partner for Norway stopped sending reports on 2 September.'
  const text = `${sentence} ${sentence} ${sentence} ${sentence}\n\n## Steps\n\n1. Check the partner page.`
  await page.evaluate((value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    document
      .getElementById('context-summaryMarkup')
      ?.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      )
  }, text)
  await expect(page.getByText('The rest of the paste moved into the text below.')).toBeVisible()
  await expect(summaryField(page)).toHaveText(`${sentence} ${sentence} ${sentence}`)
  await expect(bodyField(page).getByRole('heading', { name: 'Steps' })).toBeVisible()
  expect((await storedDraft(page))?.bodyMarkup).toBe(
    `${sentence}\n\n## Steps\n\n1. Check the partner page.`,
  )
})

test('the text check marks an email in the summary, holds the save and blocks Submit', async ({
  page,
}) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await fillContext(page)
  await waitForSaved(page)
  await summaryField(page).press('End')
  await page.keyboard.type(' Ask anna.berg@example.com.')
  const note = page.locator('[data-slot="text-check"]').first()
  await expect(note).toContainText('Looks like an email address.')
  await expect(summaryField(page).locator('[data-text-check="email_address"]')).toHaveText(
    'anna.berg@example.com',
  )
  await expect(page.locator('[data-slot="save-status"]:visible')).toContainText(
    'Not saved. Fix the text first',
  )
  await expect(submit(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(
    page.locator('[data-slot="part-card"]', { hasText: 'Checks' }).getByText(/An email address/),
  ).toBeVisible()
  await note.getByRole('button', { name: 'Remove it' }).click()
  await expect(note).toBeHidden()
  await waitForSaved(page)
  await expect(submit(page)).not.toHaveAttribute('aria-disabled', 'true')
})

test('Command or Control Enter submits from inside the text', async ({ page }) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await fillContext(page)
  await waitForSaved(page)
  await bodyField(page).click()
  await page.keyboard.type('Check the partner page first.')
  // The browser reports a Windows desktop (devices['Desktop Chrome']), so the modifier is Control.
  await page.keyboard.press('Control+Enter')
  await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+$/)
  await expect(page.locator('[data-slot="proposal-badges"]')).toContainText('Waiting for review')
})

test('the agent view shows the body an agent receives, and condenses the overlaps', async ({
  page,
}) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await fillContext(page)
  await bodyField(page).click()
  await page.keyboard.type('## Steps')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Compare Norway with a market that was not affected.')
  await waitForSaved(page)
  await expectFlatRail(
    page.getByRole('complementary', { name: 'Details and what AI apps get' }),
    'left',
  )
  await page.getByRole('tab', { name: 'What AI apps get' }).click()
  const preview = page.locator('[data-slot="agent-preview"]').first()
  await expect(preview).toHaveAttribute('data-state', 'matched')
  const body = preview.locator('[data-slot="agent-preview-body"]').first()
  await body.locator('summary').click()
  await expect(body).toContainText('Compare Norway with a market that was not affected.')
  const overlaps = page.locator('[data-slot="overlap-list"]')
  await expect(overlaps).toBeVisible()
  const accepted = overlaps.getByRole('link')
  if ((await page.locator('[data-slot="overlap-count"]').count()) > 0)
    expect(await accepted.count()).toBeLessThanOrEqual(3)
})

test('opens the agent view from the phone menu', async ({ page }) => {
  await openPage(page, '/library/new', { ...widths[2], theme: 'dark' })
  await fillContext(page)
  await waitForSaved(page)
  await page.getByRole('button', { name: 'More form actions' }).click()
  await page.getByRole('menuitem', { name: 'What AI apps will get' }).click()
  await expect(page.getByRole('tab', { name: 'What AI apps get' })).toHaveAttribute(
    'aria-selected',
    'true',
  )
  await expect(page.getByRole('heading', { name: 'Try another question' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'The question is about' }).first()).toHaveText(
    /Orders\s*Norway\s*4 Aug 2026/,
  )
})

test('protects unsaved edits and opens the change form from an item', async ({ page }) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await summaryField(page).fill('An unsaved observation.')
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Leave with unsaved changes?' })).toBeVisible()
  await page.getByRole('button', { name: 'Keep writing' }).click()
  await expect(summaryField(page)).toHaveText('An unsaved observation.')
  await page.getByRole('link', { name: 'Home', exact: true }).click()
  await page.getByRole('button', { name: 'Leave this page' }).click()
  await page.goto('/library/itm_jyfuvl07')
  await page.getByRole('link', { name: 'Suggest a change', exact: true }).click()
  await expect(page).toHaveURL(/\/library\/itm_jyfuvl07\/suggest$/)
  await expect(page.getByRole('heading', { name: 'Suggest a change', exact: true })).toBeAttached()
  await expect(page.getByRole('combobox', { name: 'Kind', exact: true })).toBeDisabled()
  await expect(summaryField(page)).not.toBeEmpty()
  await expect(titleField(page)).not.toHaveValue('')
})

test('Suggest a change asks what is wrong, and keeps it with the draft', async ({ page }) => {
  await openPage(page, '/library/itm_jyfuvl07/suggest', { ...widths[0], theme: 'light' })
  const reason = page.getByRole('textbox', { name: /What is wrong with the current version/ })
  await expect(reason).toBeVisible()
  await reason.fill('The source moved to the new wiki.')
  await waitForSaved(page)
  // The service keeps it (tests/e2e-api/context.spec.ts); the reviewer reads it above the diff
  // (review.spec.ts).
  await submit(page).click()
  await expect(page).toHaveURL(/\/proposals\/[a-f0-9-]+$/)

  // Add a fact is a new item: there is no current version to be wrong.
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await expect(summaryField(page)).toBeVisible()
  await expect(
    page.getByRole('textbox', { name: /What is wrong with the current version/ }),
  ).toHaveCount(0)
})

for (const view of [
  { name: 'Add a fact', path: '/library/new' },
  { name: 'Suggest a change', path: '/library/itm_jyfuvl07/suggest' },
])
  for (const size of [widths[0], widths[2]])
    test(`${view.name}: every day is a date picker at ${size.name}`, async ({ page }) => {
      await openPage(page, view.path, { ...size, theme: 'light' })
      await expect(summaryField(page)).toBeVisible()
      for (const name of ['From', 'Until', 'Date you read it']) await expectDatePicker(page, name)

      // A click in the text, a day from the calendar, then typing over it.
      const from = page.getByRole('textbox', { name: 'From', exact: true })
      await from.click()
      await page.getByRole('grid').getByRole('button', { name: /15th/ }).click()
      await expect(page.getByRole('grid')).toBeHidden()
      await expect(from).toHaveValue(/^15 \w{3} \d{4}$/)
      await from.click()
      await from.fill('4 Aug 2026')
      await from.press('Enter')
      await expect(from).toHaveValue('4 Aug 2026')
      await expect(page.getByRole('grid')).toBeHidden()
    })

test('the agent view asks about a day with a date picker', async ({ page }) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  await fillContext(page)
  await waitForSaved(page)
  await page.getByRole('tab', { name: 'What AI apps get' }).click()
  await expectDatePicker(page, 'On which day')
})

for (const size of widths)
  for (const theme of themes) {
    test(`Add a fact accessibility and geometry at ${size.name}, ${theme}`, async ({ page }) => {
      await openPage(page, '/library/new', { ...size, theme })
      await expect(summaryField(page)).toBeVisible()
      await expect(bodyField(page)).toBeVisible()
      await settle(page)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      const violations = (await new AxeBuilder({ page }).analyze()).violations
      expect(violations).toEqual([])
      if (size.width < 768) {
        const box = await submit(page).boundingBox()
        expect(box!.y + box!.height).toBeLessThanOrEqual(size.height)
      }
    })

    test(`the editor's menus pass axe at ${size.name}, ${theme}`, async ({ page }) => {
      await openPage(page, '/library/new', { ...size, theme })
      await chooseKind(page, 'Guide')
      await bodyField(page).click()
      await page.keyboard.type('/')
      await expect(page.getByRole('listbox', { name: 'Add a block' })).toBeVisible()
      await settle(page)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      )
      await page.keyboard.press('Escape')
      await page.keyboard.type('Check the period first.')
      await bodyField(page).getByText('period').selectText()
      await expect(page.getByRole('toolbar', { name: 'Format the selected words' })).toBeVisible()
      await settle(page)
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  }

test('where it comes from and what not to conclude explain themselves, and follow the kind', async ({
  page,
}) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  const rail = page.getByRole('complementary', { name: 'Details and what AI apps get' })
  const source = rail.getByRole('region', { name: 'Where this comes from' })
  const caveat = rail.getByRole('region', { name: 'What not to conclude' })
  await expect(source.getByText('Needed')).toBeVisible()
  const quote = source.getByRole('textbox', { name: 'A sentence copied from the source' })
  await expect(quote).toHaveAttribute('placeholder', /^For example: "Online sales to Norway stop/)
  await expect(quote).toHaveAccessibleDescription(/Copy it word for word/)
  await expect(source.getByText('0 of 500 characters')).toBeVisible()
  // Optional and empty, with what happens to the line in plain sight: no popover.
  const line = caveat.getByRole('textbox', { name: 'What not to conclude' })
  await expect(line).toHaveValue('')
  await expect(line).toHaveAccessibleDescription(
    'Say what someone might wrongly conclude from this.',
  )
  await expect(caveat.getByText('Optional')).toBeVisible()
  await expect(caveat.getByText('Needed')).toHaveCount(0)
  await expect(
    caveat.getByText(
      'AI apps get this line with the fact and are told not to draw that conclusion.',
    ),
  ).toBeVisible()
  await expect(caveat.getByRole('button', { name: /Why we ask/ })).toHaveCount(0)
  const card = caveat.getByRole('figure', { name: 'What AI apps get' })
  await expect(card).toContainText(
    "Nothing added. AI apps already know this fact doesn't prove a cause",
  )
  // The example follows the kind chosen in the header.
  await expect(caveat.locator('[data-slot="caveat-example"]')).toContainText(
    "Lower orders in Norway after 4 August don't mean fewer customers.",
  )
  await chooseKind(page, 'Issue')
  await expect(quote).toHaveAttribute('placeholder', /^For example: "Order data/)
  await expect(caveat.locator('[data-slot="caveat-example"]')).toContainText(
    "Low orders on these days don't mean customers ordered less.",
  )
  // A starter puts the opening words in the box; the card follows without a save.
  await caveat.getByRole('button', { name: "Don't use for …" }).click()
  await expect(line).toBeFocused()
  await page.keyboard.type('comparing Poland with other markets.')
  await expect(card).toContainText(
    "What not to conclude: Don't use this for comparing Poland with other markets.",
  )
  await card.getByRole('button', { name: 'Show exactly what AI apps get' }).click()
  await expect(card.locator('pre')).toHaveText(
    '"not_to_conclude": "Don\'t use this for comparing Poland with other markets."',
  )
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
  // Emptied, the box needs nothing and the form has no finding for it.
  await line.fill('')
  await line.blur()
  await expect(caveat.locator('[data-slot="field-error"]')).toHaveCount(0)
  await caveat.getByRole('button', { name: 'Use this example' }).click()
  await expect(line).toHaveValue("Low orders on these days don't mean customers ordered less.")
})

test('a metric without a domain says why we cannot choose the domain, and what to do', async ({
  page,
}) => {
  await openPage(page, '/library/new', { ...widths[0], theme: 'light' })
  const scope = page.getByRole('combobox', { name: 'Where it applies' })
  await scope.fill('On-time shipping')
  await page.getByRole('option', { name: /On-time shipping rate/ }).click()
  await expect(page.locator('[data-slot="no-domain-hint"]')).toContainText(
    "On-time shipping rate has no domain yet, so we can't choose this fact's domain from it.",
  )
})
