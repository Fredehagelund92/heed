import { expect, type Page } from '@playwright/test'
import { settle } from './support'

/** A question the mock's live edition has facts for: Average order value in the United Kingdom, June 2026. */
export const ASK_MATCH =
  'Which facts apply to Average order value in the United Kingdom in June 2026?'

/** The same scope long before any fact about it: nothing applies. */
export const ASK_NO_MATCH =
  'Which facts apply to Average order value in the United Kingdom in January 2019?'

/**
 * The web lookup example as a draft request: a link to read, and a date the person is unsure of.
 * The scripted assistant offers the draft to confirm, with its dates flagged uncertain.
 */
export const ASK_DRAFT =
  'Draft this: A new rule gives Netherlands customers 14 days to send back online orders, so average order value may fall. I am not sure of the date. Source: https://consumer.example/eu/right-of-withdrawal, which says "Consumers have 14 days to withdraw from an online purchase without giving any reason." Do not conclude that every online order is sent back.'

/**
 * A question the scripted assistant answers in three short lines, which fit under the fold: a
 * short answer shows in full, with no fade and no "Show the rest of the answer".
 */
export const ASK_SHORT = 'Make this clearer: why did average order value drop in the Netherlands?'

/** Every domain side by side: the scripted assistant answers with a table, as a model writes one. */
export const ASK_TABLE = 'Compare the domains side by side'

/**
 * Waits until the composer on screen is the chip editor: it is a chunk of its own, and the plain
 * box stands in until it has loaded.
 */
export async function chipEditor(page: Page) {
  await expect(
    page.locator('[data-slot="ask-composer"][data-box="chips"]').filter({ visible: true }),
  ).toHaveCount(1, { timeout: 15_000 })
}

/**
 * The question in the composer as it is sent: its words, each chip as the words it stands for
 * (without what a screen reader hears of a chip, or the days a dates chip shows after them).
 */
export async function questionWords(page: Page): Promise<string> {
  return page
    .getByRole('textbox', { name: 'Your question' })
    .filter({ visible: true })
    .evaluate((box) => {
      const copy = box.cloneNode(true) as HTMLElement
      for (const hidden of copy.querySelectorAll(
        '.sr-inline, button, [data-slot="ask-chip-days"], .ProseMirror-trailingBreak',
      ))
        hidden.remove()
      for (const line of copy.querySelectorAll('br')) line.replaceWith('\n')
      return copy.textContent ?? ''
    })
}

/** Asks a question from the Ask composer on screen and waits until its answer has finished. */
export async function askAndWait(page: Page, question: string) {
  await chipEditor(page)
  const box = page.getByRole('textbox', { name: 'Your question' }).filter({ visible: true })
  await box.fill(question)
  await box.press('Enter')
  await expect(page.locator('[data-slot="ask-answer"]').last()).toHaveAttribute(
    'data-state',
    /done|failed/,
    { timeout: 15_000 },
  )
  await settle(page)
}
