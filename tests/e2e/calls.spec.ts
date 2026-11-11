import type { Page } from '@playwright/test'
import { expect, mode, test } from './go.ts'

/*
  How many calls one page load makes on the service. The service allows a person 600 calls a
  minute (src/server/http/rate-limit.ts), so a page that read each suggestion's review on its own,
  or the same list several times, ran out after a few loads of a busy Inbox. Every screen reads the
  shell's shared reads first; the Inbox then has its own. Each read happens once, and the reviews
  of every suggestion arrive together.
*/

test.skip(mode === 'mock', 'The mock makes no calls')

/** Every call to the service while a page loads, from the first request until the page is quiet. */
async function callsWhileLoading(page: Page, address: string) {
  const calls: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/v1/'))
      calls.push(`${request.method()} ${url.pathname}${url.search}`)
  })
  await page.goto(address)
  await page.waitForLoadState('networkidle')
  return calls
}

/** A read made twice with no change between: each stretch between two changes reads a thing once. */
function readTwice(calls: readonly string[]) {
  const twice: string[] = []
  let seen = new Set<string>()
  for (const call of calls) {
    if (!call.startsWith('GET ')) {
      // A change, as the Inbox makes when it opens a card: what is read after it is read again.
      if (call !== 'POST /api/v1/review/sheets') seen = new Set()
      continue
    }
    if (seen.has(call)) twice.push(call)
    seen.add(call)
  }
  return twice
}

test('the Inbox loads with each read once, and every review in one call', async ({ page }) => {
  const calls = await callsWhileLoading(page, '/inbox')
  await expect(page.getByRole('heading', { name: 'Inbox', level: 1 })).toBeVisible()
  expect(readTwice(calls), calls.join('\n')).toEqual([])
  expect(calls.filter((c) => /\/review\/[^/]+\/sheet/.test(c))).toEqual([])
  expect(calls.filter((c) => c === 'POST /api/v1/review/sheets')).toHaveLength(1)
  // The shell's shared reads, the reviews, the first card opened (read) and the Inbox read again
  // after it: 31 on the demo week, whatever the number of suggestions. A budget, so a new read is a
  // choice.
  expect(calls.length, calls.join('\n')).toBeLessThanOrEqual(31)
})

test('a question in Ask is one look-up: the chat does not read it again or look anything up for later', async ({
  page,
}) => {
  await callsWhileLoading(page, '/ask?n=calls')
  const lookups: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/ask/lookup')
      lookups.push(request.postData() ?? '')
  })
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially('What should I know about Orders in Germany?')
  await box.press('Enter')
  // Each look-up can call the model for the answer's words once (src/server/modules/answer/words.ts),
  // so one look-up is at most one model call.
  await expect(page).toHaveURL(/chat=/)
  await expect(page.getByRole('button', { name: 'Good answer' })).toBeVisible()
  // A read the chat's new address started, or one for a question shown under the answer, has gone
  // out by now.
  await page.waitForTimeout(1000)
  expect(lookups, lookups.join('\n')).toHaveLength(1)
})
