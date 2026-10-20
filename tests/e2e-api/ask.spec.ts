import { expect, test, type BrowserContext, type Page } from '@playwright/test'

/*
  The assistant's Ask tab on the real service, with its scripted model (MODELS=mock): a question
  asked with a scope streams from POST /api/v1/assistant/chat, and the facts the answer shows as
  applying are the ones get_context delivers for that scope, which Try it shows too. The chips
  are the ids the service's citation check let through; nothing in the panel comes from the
  model's words but the words.
*/

type Reply = { result: { status: string; items?: { id: string }[] } }

/** The question's box once it is the chip editor: a chunk of its own, after the plain box. */
async function questionBox(page: Page) {
  await expect(page.locator('[data-slot="ask-composer"]')).toHaveAttribute('data-box', 'chips', {
    timeout: 15_000,
  })
  return page.getByRole('textbox', { name: 'Your question' })
}

async function signIn(context: BrowserContext, baseURL: string, email: string) {
  const response = await context.request.post('/api/v1/auth/sign-in', {
    headers: { origin: baseURL, 'x-heed-csrf': 'dev-sign-in' },
    data: { email },
  })
  expect(response.ok()).toBe(true)
}

const scope = {
  metrics: ['metric:average_order_value'],
  dimension_filters: [{ dimension: 'dim:market', values: ['val:market/united_kingdom'] }],
  window: { from: '2026-09-08', to: '2026-10-07' },
}

test('an answer shows the facts get_context delivers for the scope, each cited and checked', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_maria@example.test')
  const session = await context.request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const asked = await context.request.post('/api/v1/try-it', {
    headers: { origin: baseURL!, 'x-heed-csrf': csrfToken },
    data: scope,
  })
  expect(asked.ok(), await asked.text()).toBe(true)
  const delivered = ((await asked.json()) as Reply).result.items?.map((item) => item.id) ?? []
  expect(delivered.length).toBeGreaterThan(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(
    '/assistant?about=metric:average_order_value,val:market/united_kingdom&from=2026-09-08&to=2026-10-07',
  )
  const box = await questionBox(page)
  await box.fill('Which facts apply to this scope?')
  await box.press('Enter')
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(page.locator('[data-slot="ask-announcer"]')).toHaveText(/^Answer ready\./)

  // The side column lists the facts read: those that apply are the delivered ones.
  const read = page.getByRole('complementary', { name: 'In this answer' })
  const applying = read.locator(
    '[data-slot="ask-fact"]:is([data-verdict="applies"], [data-verdict="partial"]) a',
  )
  const ids = (await applying.evaluateAll((links) => links.map((a) => a.getAttribute('href')))).map(
    (href) => href?.split('/').pop(),
  )
  expect(ids.sort()).toEqual([...delivered].sort())
  // Each chip in the answer links to a fact the answer read; the check's row says so.
  const chips = answer.locator('[data-slot="ask-answer-text"] a[href*="/library/itm_"]')
  await expect(chips.first()).toBeVisible()
  for (const href of await chips.evaluateAll((links) => links.map((a) => a.getAttribute('href'))))
    expect(delivered).toContain(href?.split('/').pop())
  await expect(answer.getByRole('note')).toContainText(
    `Checked before you saw it. All ${delivered.length} facts above come from the library.`,
  )
})

type ScopePart = { type: 'data-scope'; data: Record<string, unknown> }
type ChatBody = { messages: { role: string; parts: { type: string }[] }[] }

/** The scope part of the latest question in a chat request, as the browser sent it. */
function sentScope(body: string | null): Record<string, unknown> | undefined {
  const { messages } = JSON.parse(body ?? '{}') as ChatBody
  const question = messages.findLast((message) => message.role === 'user')
  return (question?.parts.find((part) => part.type === 'data-scope') as ScopePart | undefined)?.data
}

test('a question goes with the scope its "Heed reads" line showed, and the answer reads exactly that', async ({
  page,
  context,
  baseURL,
}) => {
  // The captain's ask: name the metric, the market and the dates in the question itself, see
  // what Heed will read before sending, and have the tool call read what was shown.
  await signIn(context, baseURL!, 'per_maria@example.test')
  const session = await context.request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const delivered = async (data: object) => {
    const asked = await context.request.post('/api/v1/try-it', {
      headers: { origin: baseURL!, 'x-heed-csrf': csrfToken },
      data,
    })
    expect(asked.ok(), await asked.text()).toBe(true)
    return ((await asked.json()) as Reply).result.items?.map((item) => item.id).sort() ?? []
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/assistant')
  const box = await questionBox(page)
  await box.fill(
    'What applies to average order value in the United Kingdom from 2026-09-08 to 2026-10-07?',
  )
  // The service reads the words as get_context reads them, once typing rests.
  const line = page.getByRole('list', { name: 'About', exact: true })
  await expect(line.locator('[data-source="typed"]')).toHaveText([
    /Average order value/,
    /Market\s*United Kingdom/,
    /8 Sept to 7 Oct 2026/,
  ])
  const first = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/assistant/chat'),
  )
  await box.press('Enter')
  expect(sentScope((await first).postData())).toEqual({
    metrics: ['metric:average_order_value'],
    dimension_filters: [{ dimension: 'dim:market', values: ['val:market/united_kingdom'] }],
    window: { from: '2026-09-08', to: '2026-10-07' },
    window_source: 'typed',
    carried: [],
    unresolved: [],
  })
  const answer = page.getByRole('article', { name: 'Answer' }).last()
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  // The answer read the scope shown: its side column says so, and the facts that apply are the
  // ones an agent gets for it.
  const read = page.getByRole('complementary', { name: 'In this answer' })
  await expect(
    read.getByRole('list', { name: 'What the answer is about' }).getByRole('listitem'),
  ).toHaveText([/Average order value/, /Market\s*United Kingdom/, '8 Sept to 7 Oct 2026'])
  const applying = async () =>
    (
      await read
        .locator('[data-slot="ask-fact"]:is([data-verdict="applies"], [data-verdict="partial"]) a')
        .evaluateAll((links) => links.map((a) => a.getAttribute('href')?.split('/').pop()))
    ).sort()
  expect(await applying()).toEqual(await delivered(scope))

  // The follow-up names another market: the metric and the dates are carried, shown as such.
  await box.fill('and in the Netherlands?')
  await expect(line.locator('[data-source="typed"]')).toHaveText(/Market\s*Netherlands/)
  await expect(line.locator('[data-source="carried"]')).toHaveText([
    /Average order value/,
    /8 Sept to 7 Oct 2026 · carried/,
  ])
  const second = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/assistant/chat'),
  )
  await box.press('Enter')
  expect(sentScope((await second).postData())).toMatchObject({
    metrics: ['metric:average_order_value'],
    dimension_filters: [{ dimension: 'dim:market', values: ['val:market/netherlands'] }],
    window: { from: '2026-09-08', to: '2026-10-07' },
    window_source: 'carried',
    carried: ['metric:average_order_value', 'window'],
  })
  await expect(page.getByRole('article', { name: 'Answer' })).toHaveCount(2)
  await expect(page.getByRole('article', { name: 'Answer' }).last()).toHaveAttribute(
    'data-state',
    'done',
    { timeout: 30_000 },
  )
  // The scripted model gets the words "and in the Netherlands?" and nothing else: the call still reads
  // the metric and the dates carried, because they were shown and sent.
  await expect(
    read.getByRole('list', { name: 'What the answer is about' }).getByRole('listitem'),
  ).toHaveText([/Average order value/, /Market\s*Netherlands/, '8 Sept to 7 Oct 2026'])
  expect(await applying()).toEqual(
    await delivered({
      ...scope,
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/netherlands'] }],
    }),
  )
})

test('a question built from chips goes with exactly their scope, and the answer reads it', async ({
  page,
  context,
  baseURL,
}) => {
  // The captain's ask, stage 2: the metric, the market and the dates tagged inside the question.
  await signIn(context, baseURL!, 'per_maria@example.test')
  const session = await context.request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const asked = await context.request.post('/api/v1/try-it', {
    headers: { origin: baseURL!, 'x-heed-csrf': csrfToken },
    data: scope,
  })
  expect(asked.ok(), await asked.text()).toBe(true)
  const delivered = ((await asked.json()) as Reply).result.items?.map((item) => item.id) ?? []
  expect(delivered.length).toBeGreaterThan(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/assistant')
  const box = await questionBox(page)
  await box.click()
  // Words the service reads as a name are offered as a chip, which Tab takes.
  await page.keyboard.type('What applies to average order value in ')
  const offer = page.locator('[data-slot="ask-offer"]')
  await expect(offer).toContainText('Make “average order value” a chip?', { timeout: 15_000 })
  await page.keyboard.press('Tab')
  // @ picks a market at the caret.
  await page.keyboard.type('@Great')
  await expect(page.getByRole('option', { name: /^United Kingdom/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  // The dates panel puts the dates in; the service's today is 7 Oct 2026.
  await page.getByRole('button', { name: 'Dates of the question' }).click()
  await page
    .locator('[data-slot="ask-dates"]')
    .getByRole('button', { name: 'Last 30 days' })
    .click()
  const chips = box.locator('[data-chip="ask"]')
  await expect(chips).toHaveCount(3)
  const line = page.getByRole('list', { name: 'About', exact: true })
  await expect(line.locator('[data-source="tagged"]')).toHaveText([
    /Average order value/,
    /Market\s*United Kingdom/,
    '8 Sept to 7 Oct 2026',
  ])

  const sent = page.waitForRequest(
    (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/assistant/chat'),
  )
  await box.press('Enter')
  const body = (await sent).postData()
  // The words read as a sentence, each chip as its words, and the scope part is the chips'.
  const { messages } = JSON.parse(body ?? '{}') as {
    messages: { role: string; parts: { type: string; text?: string }[] }[]
  }
  expect(messages.findLast((message) => message.role === 'user')?.parts[0]).toMatchObject({
    type: 'text',
    text: 'What applies to average order value in United Kingdom the last 30 days',
  })
  expect(sentScope(body)).toEqual({
    metrics: ['metric:average_order_value'],
    dimension_filters: [{ dimension: 'dim:market', values: ['val:market/united_kingdom'] }],
    window: { from: '2026-09-08', to: '2026-10-07' },
    window_source: 'typed',
    carried: [],
    unresolved: [],
  })
  const answer = page.getByRole('article', { name: 'Answer' }).last()
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(chips).toHaveCount(0)
  // The answer read the chips' scope: its side column says so, and the facts that apply are the
  // ones an agent gets for it.
  const read = page.getByRole('complementary', { name: 'In this answer' })
  await expect(
    read.getByRole('list', { name: 'What the answer is about' }).getByRole('listitem'),
  ).toHaveText([/Average order value/, /Market\s*United Kingdom/, '8 Sept to 7 Oct 2026'])
  const applying = (
    await read
      .locator('[data-slot="ask-fact"]:is([data-verdict="applies"], [data-verdict="partial"]) a')
      .evaluateAll((links) => links.map((a) => a.getAttribute('href')?.split('/').pop()))
  ).sort()
  expect(applying).toEqual([...delivered].sort())
})

for (const [name, words, expected] of [
  [
    'dates only',
    'What applies from 2026-09-08 to 2026-10-07?',
    { window: { from: '2026-09-08', to: '2026-10-07' }, window_source: 'typed' },
  ],
  ['dates Heed cannot read', 'What applies since the launch?', { window_source: 'unreadable' }],
] as const)
  test(`a question with ${name} sends its scope part and the answer completes`, async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL!, 'per_maria@example.test')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/assistant')
    const box = await questionBox(page)
    await box.fill(words)
    await expect(page.getByRole('list', { name: 'About', exact: true })).toBeVisible()
    const sent = page.waitForRequest(
      (request) => request.method() === 'POST' && request.url().endsWith('/api/v1/assistant/chat'),
    )
    await box.press('Enter')
    const part = sentScope((await sent).postData())
    expect(part).toMatchObject({
      metrics: [],
      dimension_filters: [],
      carried: [],
      unresolved: [],
      ...expected,
    })
    if (!('window' in expected)) expect(part).not.toHaveProperty('window')
    await expect(page.getByRole('article', { name: 'Answer' }).last()).toHaveAttribute(
      'data-state',
      'done',
      { timeout: 30_000 },
    )
  })

type Proposals = {
  rows: {
    id: string
    proposerId: string
    number: number
    channel: string
    state: string
    draft: { title?: string; areaId?: string }
  }[]
}

test('Create draft saves the draft the assistant proposed, as the person’s own, and says so', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_jon@example.test')
  const session = (await (await context.request.get('/api/v1/auth/session')).json()) as {
    person: { id: string }
  }
  const marker = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  const words = `Sandbox sign-ups were counted twice on 3 October 2026 (tracking bug ${marker}).`

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/assistant')
  const box = await questionBox(page)
  await box.fill(`Please draft this: ${words}`)
  await box.press('Enter')
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer.getByText('Wrote a draft for you to check')).toBeVisible({
    timeout: 30_000,
  })
  await answer.getByRole('button', { name: 'Create draft' }).click()

  // The confirmation goes back signed: the call runs, and the step says saved only once it is.
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(answer.getByText('Saved a draft', { exact: true })).toBeVisible()
  await expect(page.getByText('The assistant couldn’t finish')).toHaveCount(0)
  await expect(answer.getByRole('button', { name: 'Create draft' })).toHaveCount(0)

  // The draft is there, the person's own, in the domain its words name.
  const mine = (await (
    await context.request.get('/api/v1/proposals?own=true&state=draft&limit=100')
  ).json()) as Proposals
  const saved = mine.rows.filter((row) => row.draft.title?.includes(marker))
  expect(saved).toHaveLength(1)
  expect(saved[0]).toMatchObject({
    proposerId: session.person.id,
    channel: 'assistant',
    state: 'draft',
    draft: { areaId: 'area_sandbox' },
  })

  // The saved step links to the draft, which opens in the form to check and submit.
  const open = answer.getByRole('link', { name: `Open draft #${saved[0]!.number}` })
  await expect(open).toHaveAttribute('href', `/library/new?draft=${saved[0]!.id}`)
  await open.click()
  await expect(page).toHaveURL(new RegExp(`/library/new\\?draft=${saved[0]!.id}$`))
  await expect(page.getByRole('heading', { name: 'Add a fact' })).toBeVisible()
  await expect(page.getByRole('main')).toContainText(marker)
})

test('a draft Heed cannot place is not saved, and the answer says why in plain words', async ({
  page,
  context,
  baseURL,
}) => {
  await signIn(context, baseURL!, 'per_jon@example.test')
  const marker = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/assistant')
  const box = await questionBox(page)
  await box.fill(`Please draft this: the kiosk door sensor failed for a day (${marker}).`)
  await box.press('Enter')
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(answer).toContainText("I couldn't draft it yet, so nothing is saved.")
  await expect(answer).toContainText('Which domain is it about')
  // The SDK's error, the tool's field names and words meant for the model stay out of it.
  await expect(answer).not.toContainText(/AI_|Invalid input|areaId|create_draft|the person/)
  await expect(answer.getByRole('button', { name: 'Create draft' })).toHaveCount(0)
  await expect(answer.getByRole('link', { name: /Open draft/ })).toHaveCount(0)
})

test('"What is this" with Product attached answers about Product, and New chat starts over', async ({
  page,
  context,
  baseURL,
}) => {
  // The captain's report: Product attached with any value, then "What is this", answered with
  // "Which metric, market and dates do you mean?" as if nothing was attached.
  await signIn(context, baseURL!, 'per_jon@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/assistant?about=dim:product')
  const composer = page.getByRole('form', { name: 'Ask the assistant' })
  await expect(composer.getByRole('button', { name: 'Remove Any product' })).toBeVisible({
    timeout: 15_000,
  })
  const newChat = page.getByRole('button', { name: 'New chat' })
  await expect(newChat).toBeDisabled()
  const box = page.getByRole('textbox', { name: 'Your question' })
  await box.fill('What is this')
  await box.press('Enter')
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(answer).not.toContainText(/which metric/i)
  await expect(answer).toContainText('Product: every Product, not one in particular.')
  // Its definition, as the definition source gives it, quoted and kept by the citation check.
  await expect(answer).toContainText('The product group the sale belongs to')
  await expect(answer.getByRole('note')).toContainText('Checked before you saw it.')

  // New chat, in the header: nothing typed, so the chat goes at once and the composer has focus.
  await newChat.click()
  await expect(page.getByRole('log', { name: 'Conversation with the assistant' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Ask me about your numbers' })).toBeVisible()
  await expect(box).toBeFocused()
  await expect(newChat).toBeDisabled()
})

test('the assistant counts the facts about Product as the catalogue does, and says how many AI apps get', async ({
  page,
  context,
  baseURL,
}) => {
  // The captain's report: with Product attached, "What is this" gave 187 items from the
  // assistant's search while the scope picker and the catalogue showed 370 for the same thing.
  await signIn(context, baseURL!, 'per_maria@example.test')
  const catalogue = await context.request.get('/api/v1/catalogue')
  expect(catalogue.ok(), await catalogue.text()).toBe(true)
  const { terms } = (await catalogue.json()) as {
    terms: { key: string; shelf: { items: number } }[]
  }
  const shelf = terms.find((term) => term.key === 'dim:product')!.shelf.items
  expect(shelf).toBeGreaterThan(0)
  // "AI apps get 366 of them. The other 4 wait for now.": both numbers, and what each one counts.
  // The demo seed holds high-risk items about Product that wait for a check, so some are held back;
  // on the bulk seed alone AI apps get all of them.
  const agentsGet = (text: string) => {
    const some = /AI apps get ([\d,]+) of them\. The other ([\d,]+) wait for now\./.exec(text)
    if (!some) return /AI apps get all of them\./.test(text) ? shelf : Number.NaN
    return Number(some[1]!.replace(/,/g, '')) + Number(some[2]!.replace(/,/g, ''))
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  const box = page.getByRole('textbox', { name: 'Your question' })
  const answer = page.getByRole('article', { name: 'Answer' })

  // Attached: the count the model reads is the catalogue's, beside what AI apps get.
  await page.goto('/assistant?about=dim:product')
  await expect(page.getByRole('button', { name: 'Remove Any product' })).toBeVisible({
    timeout: 15_000,
  })
  await box.fill('What is this')
  await box.press('Enter')
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  const attached = `${shelf.toLocaleString('en')} facts are about it, and AI apps get`
  await expect(answer).toContainText(attached)
  expect(agentsGet((await answer.textContent())!)).toBe(shelf)

  // Searched: find_context's definition counts by the same rule and says the same.
  await page.goto('/assistant')
  await box.fill('What does Product mean?')
  await box.press('Enter')
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(answer).toContainText(
    `${shelf.toLocaleString('en')} facts are about Product, and AI apps get`,
  )
  const searched = (await answer.textContent())!
  expect(agentsGet(searched)).toBe(shelf)
})

test('a domain asked for by another spelling is read as that domain, and the answer says so once', async ({
  page,
  context,
  baseURL,
}) => {
  // The captain's pilot, 15 October 2026: "Stores & Suppliers" for a domain stored as "Stores &
  // Suplliers". Here a typo of Customer value, on the real service with its scripted model.
  await signIn(context, baseURL!, 'per_maria@example.test')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/assistant')
  const box = await questionBox(page)
  await box.fill('show me Customer valeu metrics and dimensions')
  await box.press('Enter')
  const answer = page.getByRole('article', { name: 'Answer' })
  await expect(answer).toHaveAttribute('data-state', 'done', { timeout: 30_000 })
  await expect(answer.locator('[data-slot="ask-answer-text"]')).toContainText(
    'I read that as Customer value.',
  )
  // Said once: the answer never argues with the words or repeats the domain's name as a fix.
  const text = (await answer.locator('[data-slot="ask-answer-text"]').innerText()).toLowerCase()
  expect(text.split('i read that as').length).toBe(2)
  expect(text).not.toContain('invented')
})
