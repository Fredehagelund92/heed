import type { Page } from '@playwright/test'
import { expect, go, mode, test } from './go.ts'

// J20, synonyms as tags: a comma or Enter makes a tag at once, a word that means something else
// says who has it and is never saved, Backspace selects then removes, Escape keeps what was made.
// The list folds synonyms into their definition's row; a term's editor has one optional
// Another name for, and clearing it brings the meaning back.

test('the term editor stops a taken word with who has it, and only warns of a look-alike', async ({
  page,
}) => {
  await go(page, '/definitions/new?sameAs=Gross%20sales')
  const word = page.getByRole('textbox', { name: 'The word' })
  const publish = page.getByRole('button', { name: 'Publish' })
  // Turnover already means Net revenue: an accent makes no other word of it.
  await word.fill('Túrnover')
  await expect(
    page.getByRole('note').filter({
      hasText:
        'This word is taken. “Turnover” is already another name for Net revenue, added by Sofia Brandt.',
    }),
  ).toBeVisible()
  await expect(page.getByText('Not ready: this word is taken')).toBeVisible()
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(0)
  await expect(publish).toHaveAttribute('aria-disabled', 'true')
  // A look-alike can be a real second thing: it warns, and Publish stays open.
  await word.fill('Turnovers')
  await expect(
    page.getByRole('note').filter({
      hasText:
        'A similar word is in use. “Turnovers” looks like “Turnover”, which means Net revenue.',
    }),
  ).toBeVisible()
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  await expect(publish).toHaveAttribute('aria-disabled', 'false')
  // A word nothing has says nothing.
  await word.fill('Bookings')
  await expect(page.getByRole('note')).toHaveCount(0)
})

test('a word taken after the page opened shows the refusal, and offers no Retry', async ({
  page,
}) => {
  test.skip(mode === 'mock', 'The refusal is the service answering 409 to a write.')
  await go(page, '/definitions/new?sameAs=Gross%20sales')
  await page.getByRole('textbox', { name: 'The word' }).fill('Bookings')
  await expect(page.getByText('Ready', { exact: true })).toBeVisible()
  // Someone else takes the word while this page is open.
  await page.evaluate(async () => {
    const session = (await (await fetch('/api/v1/auth/session')).json()) as { csrfToken: string }
    const made = await fetch('/api/v1/terms', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Heed-CSRF': session.csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({ name: 'Bookings', sameAs: 'metric:net_revenue' }),
    })
    if (!made.ok) throw new Error(`The word was not written: ${made.status}`)
  })
  await page.getByRole('button', { name: 'Publish' }).click()
  await expect(
    page
      .getByRole('note')
      .filter({ hasText: /“Bookings” is already another name for Net revenue/ }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0)
  await expect(page.getByText(/^Couldn't publish/)).toHaveCount(0)
  await expect(page.getByText('Ready', { exact: true })).toHaveCount(0)
})

test('typing words and commas makes tags; a taken word says who has it', async ({ page }) => {
  await go(page, '/definitions/Gross%20sales')
  const box = page.getByRole('textbox', { name: 'Add another name for Gross sales' })
  await box.fill('Sales Value,')
  const tags = page
    .getByRole('region', { name: 'Also called' })
    .or(page.locator('section').filter({ has: page.getByRole('heading', { name: 'Also called' }) }))
  await expect(tags.getByText('Sales Value', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Added synonym Sales Value.' }),
  ).toBeAttached()
  await box.fill('Gross takings, turnover,')
  await expect(tags.getByText('Gross takings', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('listitem').filter({
      hasText: '“turnover” is already another name for Net revenue, added by Sofia Brandt.',
    }),
  ).toBeVisible()
  // Backspace in the empty box selects the last tag, then removes it.
  await box.press('Backspace')
  await expect(
    page.getByRole('status').filter({ hasText: 'Gross takings selected.' }),
  ).toBeAttached()
  await box.press('Backspace')
  await expect(tags.getByText('Gross takings', { exact: true })).toHaveCount(0)
  // Escape lets go of what is half typed; the tags stay.
  await box.fill('half')
  await box.press('Escape')
  await expect(box).toHaveValue('')
  await expect(tags.getByText('Sales Value', { exact: true })).toBeVisible()
})

/**
 * Each synonym's save waits until `release`: on the service the request is held, and the mock's
 * ?slow=1 makes every send take 1.5s.
 */
async function holdSaves(page: Page) {
  let release = () => {}
  const released = new Promise<void>((resolve) => (release = resolve))
  if (mode === 'http')
    await page.route(/\/api\/v1\/terms(\/delete)?$/, async (route) => {
      if (route.request().method() === 'POST') await released
      await route.fallback()
    })
  return release
}

/**
 * The synonym box as the next frame after `act` paints it: its text, its tags, whether it kept the
 * focus, and what was announced. Read in the page, so no retry can wait for a save to land.
 */
async function nextFrame(page: Page, event: 'keydown' | 'click', act: () => Promise<void>) {
  await page.evaluate((event) => {
    const seen = window as unknown as { frame?: unknown }
    delete seen.frame
    document.addEventListener(
      event,
      () =>
        requestAnimationFrame(() => {
          const box = document.querySelector<HTMLInputElement>('input[aria-label^="Add another"]')!
          const section = box.closest('section')!
          seen.frame = {
            text: box.value,
            focused: document.activeElement === box,
            tags: [...section.querySelectorAll('button[aria-label^="Remove the synonym "]')].map(
              (b) => b.getAttribute('aria-label')!.slice('Remove the synonym '.length),
            ),
            said: section.querySelector('[role="status"]')!.textContent,
          }
        }),
      { capture: true, once: true },
    )
  }, event)
  await act()
  const frame = await page.waitForFunction(() => (window as unknown as { frame?: unknown }).frame)
  return (await frame.jsonValue()) as {
    text: string
    focused: boolean
    tags: string[]
    said: string
  }
}

test('a tag shows the moment its comma is typed, and goes the moment it is removed, while the save runs', async ({
  page,
}) => {
  const release = await holdSaves(page)
  await go(page, '/definitions/Gross%20sales?slow=1')
  const box = page.getByRole('textbox', { name: 'Add another name for Gross sales' })
  await box.pressSequentially('Sales Value')
  const typed = await nextFrame(page, 'keydown', () => box.press(','))
  expect(typed).toMatchObject({ text: '', focused: true, said: '' })
  expect(typed.tags).toContain('Sales Value')
  // A second comma before the save is in makes no second tag, and nothing is sent twice.
  await box.pressSequentially('sales value,')
  await expect(page.getByText('Sales Value', { exact: true })).toHaveCount(1)
  // Removed while the save still runs: it goes now, and comes off once it is in.
  const removed = await nextFrame(page, 'click', () =>
    page.getByRole('button', { name: 'Remove the synonym Sales Value' }).click(),
  )
  expect(removed.focused).toBe(true)
  expect(removed.tags).not.toContain('Sales Value')
  expect(removed.said).not.toContain('Removed')
  release()
  await expect(
    page.getByRole('status').filter({ hasText: 'Removed synonym Sales Value.' }),
  ).toBeAttached()
  await expect(page.getByText('Sales Value', { exact: true })).toHaveCount(0)
})

test('a save that fails takes its tag back and says so; Try again saves it', async ({ page }) => {
  await go(page, '/definitions/Gross%20sales?state=failed')
  // The mock fails the page's own first load too.
  if (mode === 'mock') await page.getByRole('button', { name: 'Retry' }).click()
  const box = page.getByRole('textbox', { name: 'Add another name for Gross sales' })
  const tag = page.getByRole('button', { name: 'Remove the synonym Sales Value' })
  await box.pressSequentially('Sales Value')
  expect((await nextFrame(page, 'keydown', () => box.press(','))).tags).toContain('Sales Value')
  const toast = page
    .locator('[data-sonner-toast]')
    .filter({ hasText: "Couldn't add “Sales Value”" })
  await expect(toast).toContainText('Nothing was saved.')
  await expect(tag).toHaveCount(0)
  await expect(box).toBeFocused()
  await toast.getByRole('button', { name: 'Try again' }).click()
  await expect(tag).toBeVisible()
  await expect(
    page.getByRole('status').filter({ hasText: 'Added synonym Sales Value.' }),
  ).toBeAttached()
  // A failed removal brings the tag back the same way.
  expect((await nextFrame(page, 'click', () => tag.click())).tags).not.toContain('Sales Value')
  await expect(
    page
      .locator('[data-sonner-toast]')
      .filter({ hasText: "Couldn't remove “Sales Value”" })
      .filter({ hasText: 'It is still another name for Gross sales.' }),
  ).toBeVisible()
  await expect(tag).toBeVisible()
})

test('the list folds synonyms into their row; Terms counts only real terms', async ({ page }) => {
  await go(page, '/definitions')
  const gross = page.locator('tr').filter({ hasText: /^Gross sales/ })
  await expect(gross).toContainText('Also called')
  await expect(gross).toContainText('GMV')
  await expect(page.locator('tr').filter({ hasText: /^GMV/ })).toHaveCount(0)
  await expect(page.getByRole('radio', { name: /Terms/ })).toContainText('5')
  await page.getByPlaceholder('Search definitions').fill('turnover')
  await expect(page.locator('tr').filter({ hasText: 'Net revenue' })).toContainText(
    'matches: Turnover',
  )
  await page.getByPlaceholder('Search definitions').fill('')
  await page.getByRole('button', { name: /^Filter/ }).click()
  await page.getByRole('menuitemcheckbox', { name: /Show synonyms as rows/ }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('tr').filter({ hasText: /^GMV/ })).toHaveCount(1)
})

test("a term's editor: Another name for folds the meaning; clearing it brings it back, with Undo", async ({
  page,
}) => {
  await go(page, '/definitions/Webshop/edit')
  await expect(page.getByRole('textbox', { name: 'What it means' })).toContainText(
    'Orders placed on larchwood.example',
  )
  await page.getByRole('button', { name: /^Another name for/ }).click()
  await page.getByRole('option', { name: 'Gross sales' }).click()
  await expect(page.getByText('Uses the meaning of')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'What it means' })).toHaveCount(0)
  await page.getByRole('button', { name: /^Another name for/ }).click()
  await page.getByRole('option', { name: 'Not another name: give it its own meaning' }).click()
  await expect(page.getByRole('textbox', { name: 'What it means' })).toContainText(
    'Orders placed on larchwood.example',
  )
  await page.locator('[data-sonner-toast]').getByRole('button', { name: 'Undo' }).click()
  await expect(page.getByText('Uses the meaning of')).toBeVisible()
})
