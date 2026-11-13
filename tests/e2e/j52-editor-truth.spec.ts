import type { Page } from '@playwright/test'
import { expect, go, inHttpOnly, onMockOnly, test } from './go.ts'

// J52, the editor tells the truth: its status says Saved only when what is written is saved, and
// leaving with words that are not asks first (P15); a source that is not a link is marked at the
// Source field and the reasons the service gives are marked at theirs (P04); a new item asks for
// its start and "Always" is a choice that is kept as it was made (P05); and "Applies to" empties
// its box after a pick, opens on a list and never says "Nothing called" while it is still
// reading (P07).

const publish = (page: Page) => page.getByRole('button', { name: 'Publish', exact: true })
/** The editor's header status: the one line that says whether the words are saved. */
const status = (page: Page) => page.locator('header [aria-live=polite]')
const row = (page: Page, label: string) =>
  page.locator('dt', { hasText: label }).locator('xpath=following-sibling::dd[1]')
const NOT_A_LINK = 'That is not a web link. Paste an address that starts with https://.'

async function title(page: Page, words: string) {
  await page.getByRole('textbox', { name: 'Title' }).fill(words)
}

async function text(page: Page, words: string) {
  await page.getByRole('textbox', { name: 'What agents should know' }).click()
  await page.keyboard.insertText(words)
}

async function pick(page: Page, words: string, name: RegExp) {
  await page.getByRole('button', { name: /^Applies to/ }).click()
  await page.getByRole('combobox', { name: 'Search Applies to' }).fill(words)
  await page
    .getByRole('listbox', { name: 'Applies to' })
    .getByRole('option', { name })
    .first()
    .click()
  await page.keyboard.press('Escape')
}

/** Send with the button, answering "Unrelated" to every live item the service asks about first. */
async function sendAnswering(page: Page, button: 'Publish' | 'Save') {
  const send = page.getByRole('button', { name: button, exact: true })
  const before = page.getByRole('region', { name: 'Before it can be published' })
  const refused = before.getByRole('alert')
  const left = () => !/\/(new|edit)(\?|$)/.test(page.url())
  for (let round = 0; round < 3 && !left(); round++) {
    await send.click()
    await expect(async () => {
      expect(left() || (await refused.isVisible())).toBe(true)
    }).toPass()
    if (left()) break
    for (const group of await before.getByRole('radiogroup').all())
      await group.getByRole('radio', { name: 'Unrelated' }).click()
    await expect(refused).toHaveCount(0)
  }
}

test('the status says Saved only when it is, and leaving with unsaved words asks first', async ({
  page,
}) => {
  await go(page, '/context/itm_norway_stop/edit')
  await expect(status(page)).toHaveText('Saved')

  await text(page, ' A sentence that nobody has saved.')
  await expect(status(page)).toHaveText('Not saved yet')
  // It was "Saved" again 700 ms after a keystroke, whatever had happened to the words.
  await page.waitForTimeout(1500)
  await expect(status(page)).toHaveText('Not saved yet')

  // Back asks, and Keep editing keeps the words where they were.
  await page.getByRole('button', { name: 'Back to the context item' }).click()
  const ask = page.getByRole('dialog', { name: 'Leave without saving?' })
  await expect(ask).toBeVisible()
  await expect(ask.getByRole('button', { name: 'Keep editing' })).toBeFocused()
  await ask.getByRole('button', { name: 'Keep editing' }).click()
  await expect(ask).toHaveCount(0)
  await expect(page).toHaveURL(/\/edit$/)
  await expect(page.getByRole('textbox', { name: 'What agents should know' })).toContainText(
    'nobody has saved',
  )

  // A link in the sidebar asks the same, and Escape stays.
  await page.getByRole('link', { name: /^Inbox/ }).click()
  await expect(ask).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page).toHaveURL(/\/edit$/)

  // Opening Try it is the same page: nothing is asked.
  await page.getByRole('button', { name: 'Try it' }).click()
  await expect(ask).toHaveCount(0)

  // Closing the tab asks too: the page holds the unload back.
  const held = await page.evaluate(() => {
    const unload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(unload)
    return unload.defaultPrevented
  })
  expect(held).toBe(true)
})

test('leaving and losing the words is a choice, and Save leaves without asking', async ({
  page,
}) => {
  await go(page, '/context/itm_norway_stop/edit')
  await text(page, ' A sentence that nobody has saved.')
  await page.getByRole('button', { name: 'Back to the context item' }).click()
  await page
    .getByRole('dialog', { name: 'Leave without saving?' })
    .getByRole('button', { name: 'Leave and lose it' })
    .click()
  await expect(page).toHaveURL(/\/context\/[^/]+$/)
  await expect(page.getByText('nobody has saved')).toHaveCount(0)

  // Saved words are not lost, so there is nothing to ask.
  await page.getByRole('button', { name: 'Edit', exact: true }).click()
  await text(page, ' A sentence that is saved.')
  await expect(status(page)).toHaveText('Not saved yet')
  await sendAnswering(page, 'Save')
  await expect(page).toHaveURL(/\/context\/[^/]+$/)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('a new page that holds nothing has no status to give', async ({ page }) => {
  await go(page, '/context/new')
  await expect(status(page)).toHaveCount(0)
  await title(page, 'Orders are counted when they ship')
  await expect(status(page)).toHaveText('Not saved yet')
})

test('offline, the status says nothing is kept, not that it is saved on this device', async ({
  page,
}) => {
  await onMockOnly('offline flag (?state=offline)', async () => {
    await go(page, '/context/itm_norway_stop/edit?state=offline')
    await expect(page.getByText("You're offline.")).toBeVisible()
    await expect(status(page)).toHaveText('Saved')
    await text(page, ' Written offline.')
    await expect(status(page)).toHaveText('Offline, not saved yet')
    await expect(page.getByText('Saved on this device')).toHaveCount(0)
  })
})

test('a source that is words, not a link, is marked at the source and Publish waits', async ({
  page,
}) => {
  await go(page, '/context/new')
  await title(page, 'Store pickup orders in Sweden were counted twice in week 44')
  await text(page, 'Orders for store pickup in Sweden were counted twice in week 44 of 2026.')
  await pick(page, 'Orders', /^Orders/)
  await page.getByRole('button', { name: /^When/ }).click()
  await page.getByRole('radio', { name: 'Always' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('Told by the finance team in the weekly meeting')
  await page.locator('#fact-quote').fill('Pickup orders were counted twice in week 44.')
  await expect(page.locator('#fact-source')).toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Escape')

  // The reason is under the field, not behind a banner after the press.
  await expect(row(page, 'Source')).toContainText(NOT_A_LINK)
  await expect(publish(page)).toHaveAttribute('aria-disabled', 'true')
  await expect(publish(page)).toHaveAccessibleDescription('Fix the link in Source first.')
  await expect(page.getByText('Not ready: fix the link in Source')).toBeVisible()

  // A link takes the mark away, and nothing says Not ready any more.
  await page.getByRole('button', { name: /Source/ }).click()
  await page.locator('#fact-source').fill('https://wiki.example.com/finance/week-44-notes')
  await page.keyboard.press('Escape')
  await expect(row(page, 'Source')).not.toContainText(NOT_A_LINK)
  await expect(publish(page)).not.toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('Not ready: fix the link in Source')).toHaveCount(0)
})

test("the service's reason is marked at the field it is about, not in a sentence that points nowhere", async ({
  page,
}) => {
  await inHttpOnly('refusal of an email address in the text', async () => {
    await go(page, '/context/new')
    await title(page, 'Store pickup orders in Sweden were counted twice in week 44')
    await text(page, 'Pickup orders were counted twice in week 44. Ask ana.berg@example.com.')
    await pick(page, 'Gross margin', /^Gross margin/)
    await page.getByRole('button', { name: /^When/ }).click()
    await page.getByRole('radio', { name: 'Always' }).click()
    await page.getByRole('button', { name: 'Done' }).click()
    await page.getByRole('button', { name: /Add a source/ }).click()
    await page.locator('#fact-source').fill('https://wiki.example.com/finance/week-44-notes')
    await page.locator('#fact-quote').fill('Pickup orders were counted twice in week 44.')
    await page.keyboard.press('Escape')
    await publish(page).click()

    const banner = page.getByRole('region', { name: 'Before it can be published' })
    await expect(banner.getByRole('alert')).toContainText(
      "Couldn't publish. Fix what is marked below.",
    )
    await expect(banner).not.toContainText('Fix the problems shown')
    await expect(page.getByText(/This looks like a private detail/)).toBeVisible()
    await expect(page.getByText('Not published')).toBeVisible()
    await expect(status(page)).toHaveText('Not saved')
    // The title is not cut off by the banner coming into view.
    await expect(page.getByRole('textbox', { name: 'Title' })).toBeInViewport()

    // Taking the words out makes Publish work again.
    await page.getByRole('textbox', { name: 'What agents should know' }).click()
    await page.keyboard.press('Control+End')
    for (let i = 0; i < 28; i++) await page.keyboard.press('Backspace')
    await expect(page.getByText(/This looks like a private detail/)).toHaveCount(0)
  })
})

test('an event asks when it happened, and Always is a choice that stays Always', async ({
  page,
}) => {
  await go(page, '/context/new')
  // Nothing is picked for an Event: it is not "Always" until the writer says so.
  await expect(row(page, 'Kind')).toContainText('Event')
  await expect(row(page, 'When')).toContainText('When did it happen? Pick a date')
  await expect(publish(page)).toHaveAccessibleDescription(/when it happened/)
  await page.getByRole('button', { name: /^When/ }).click()
  const presets = page.getByRole('radiogroup', { name: 'When it applies' })
  await expect(presets.getByRole('radio', { checked: true })).toHaveCount(0)
  await presets.getByRole('radio', { name: 'A single day' }).click()
  await expect(row(page, 'When')).toContainText('A single day')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /^When/ }).click()
  await presets.getByRole('radio', { name: 'Always' }).click()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(row(page, 'When')).toContainText('Always')
  await expect(publish(page)).not.toHaveAccessibleDescription(/when it happened/)

  // What the service will add for the writer is shown before, not after.
  await expect(row(page, "Don't conclude").getByRole('textbox')).toHaveAttribute(
    'placeholder',
    'Left empty, agents are told: Cause not proven.',
  )
})

test('a rule does not ask, and what the writer picks is what the item says after it is published', async ({
  page,
}) => {
  await go(page, '/context/new')
  await page.getByRole('button', { name: /^Kind/ }).click()
  await page.getByRole('option', { name: /^Rule/ }).click()
  await expect(row(page, 'When')).toContainText('Always')
  await expect(publish(page)).not.toHaveAccessibleDescription(/when it happened/)

  await title(page, 'Pickup orders are counted when they are collected')
  await text(page, 'An order for store pickup counts on the day the customer collects it.')
  await pick(page, 'Gross margin', /^Gross margin/)
  await page.getByRole('button', { name: /Add a source/ }).click()
  await page.locator('#fact-source').fill('https://wiki.example.com/finance/pickup-rule')
  await page.locator('#fact-quote').fill('A pickup order counts when it is collected.')
  await page.keyboard.press('Escape')
  // Other live items about the same metric ask how this one relates; answered, it publishes.
  await sendAnswering(page, 'Publish')
  await expect(page).toHaveURL(/\/context\/(?!new)[^/?]+$/)
  // Always, not "From" the day it was published.
  await page.getByRole('button', { name: 'Details' }).click()
  await expect(page.getByText('Always', { exact: true }).first()).toBeVisible()
  await expect(page.getByText(/^From \d+ \w+ 20\d\d/)).toHaveCount(0)
})

test('the Applies to box empties after a pick and opens on what it can offer', async ({ page }) => {
  await go(page, '/context/new')
  await page.getByRole('button', { name: /^Applies to/ }).click()
  const search = page.getByRole('combobox', { name: 'Search Applies to' })
  const list = page.getByRole('listbox', { name: 'Applies to' })
  // Before anything is typed: the metrics, and the dimensions with how many values each has.
  await expect(list.getByRole('group', { name: 'Metrics' })).toBeVisible()
  await expect(list.getByRole('option', { name: /^Orders/ }).first()).toBeVisible()
  await expect(list.getByRole('option', { name: 'Market: any value' })).toBeVisible()
  await expect(list.getByText('Type to find a metric')).toHaveCount(0)

  // A pick is done with the letters that found it: "ord" then "swe" is not "ordswe".
  await search.fill('ord')
  await list
    .getByRole('option', { name: /^Orders/ })
    .first()
    .click()
  await expect(search).toHaveValue('')
  await search.pressSequentially('swe')
  await expect(search).toHaveValue('swe')
  await expect(list.getByRole('option', { name: 'Sweden', exact: true })).toBeVisible()
  await expect(list.getByText(/Nothing called/)).toHaveCount(0)
  await list.getByRole('option', { name: 'Sweden', exact: true }).click()
  await expect(search).toHaveValue('')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Remove Orders', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove Market: Sweden' })).toBeVisible()
})

test('the Applies to list does not say Nothing called while it is still reading', async ({
  page,
}) => {
  await inHttpOnly('read of the vocabulary, held here', async () => {
    await go(page, '/context/new')
    await page.getByRole('button', { name: /^Applies to/ }).click()
    const search = page.getByRole('combobox', { name: 'Search Applies to' })
    const list = page.getByRole('listbox', { name: 'Applies to' })
    await expect(list.getByRole('group', { name: 'Metrics' })).toBeVisible()
    // The answer for these letters is slow; before it comes, the list must not call them nothing.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    await page.route('**/api/v1/vocabulary/search?*', async (route) => {
      if (!route.request().url().includes('qqqq')) return route.continue()
      const response = await route.fetch()
      await held
      await route.fulfill({ response })
    })
    // Words that find nothing leave an empty list behind them: the next letters start from it.
    await search.fill('zzzz')
    await expect(list.getByText(/Nothing called/)).toBeVisible()
    await search.fill('qqqq')
    await expect(list.getByText('Searching…')).toBeVisible()
    await expect(list.getByText(/Nothing called/)).toHaveCount(0)
    release()
    await expect(list.getByText(/Nothing called/)).toBeVisible()
  })
})
