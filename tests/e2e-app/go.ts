import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { expect, test as base, type Page } from '@playwright/test'

export { expect }

/*
  The journeys run in two modes (golden plan, section 8.2): on the mock binding, and in http mode
  on the real service with the mockup's demo week (playwright.golden-http.config.ts). One spec text
  serves both. The mock's card ids, the review queue and its counts, and the mock's address flags
  are read through the helpers below, which give each mode's own; a step that needs a later pull
  request's server work is skipped in http mode only, naming that pull request (decided 27 October
  2026).
*/

export const mode: 'mock' | 'http' = process.env.GOLDEN_MODE === 'http' ? 'http' : 'mock'
const http = mode === 'http'

/** The suggestions Jon reviews in the mock, in the order the review steps through them. */
const mockQueue = [
  'gap-spain',
  'sug-ines',
  'sug-ines-format',
  'sug-ines-link',
  'sug-ines-order',
  'sug-ines-long',
  'sug-ines-dates',
  'sug-agent',
  'sug-sofia-clash',
  'sug-lars-retire',
  'drive-marketplace',
  'drive-bundles',
]

type World = {
  ids: Record<string, string>
  queue: string[]
  /** The items a journey publishes on the way, by their mock id, with their titles. */
  published: Record<string, string>
  /** What the answer panel compares with: before the last publish. */
  before: string
}
let world: World | undefined
/** The http world: the service's ids for the mock's cards, from the global setup. */
const httpWorld = (): World =>
  (world ??= JSON.parse(readFileSync('test-results/golden-http/world.json', 'utf8')) as World)

/** A mock card's id in this mode. */
export const card = (id: string) => (http ? (httpWorld().ids[id] ?? id) : id)

/** A pattern for a card's id in the address, where a ":" may be written "%3A". */
export const cardIn = (id: string) =>
  card(id)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:/g, '(?::|%3A)')

/** A mock topic's id in this mode, as the answer panel's address names it (`dock=topic.<id>`). */
export const topicId = (id: string) => (http ? (httpWorld().ids[`topic.${id}`] ?? id) : id)

/** A mock domain's id in this mode: the service names its areas `area_` and the mock's id. */
export const domainId = (id: string) => (http ? `area_${id}` : id)

/** What the answer panel compares with: before the last publish, as each mode's library has it. */
export const beforeLastPublish = () => (http ? httpWorld().before : 'Before 20 Oct')

/** The review's queue in this mode. */
export const queue = () => (http ? httpWorld().queue : mockQueue)

/** Where a suggestion sits in the queue, as the review says it: "8 of 12". */
export const place = (id: string) => `${queue().indexOf(id) + 1} of ${queue().length}`

/**
 * Claims to check before publishing, as each mode counts them: the mock's fixture marks two, the
 * service's claim check finds four in the same sentence.
 */
export const claimsToCheck = (id: 'sug-agent') =>
  (http ? { 'sug-agent': 4 } : { 'sug-agent': 2 })[id]

/** How the queue ends once every suggestion is decided: Lars's withdrawn retirement is closed. */
export const allHandled = '10 published, 1 returned, 1 closed.'

/** A mock domain's id in this mode: the service names Sales `area_sales`. */
export const domain = (id: string) => (http ? `area_${id}` : id)

/** Skips the rest of a journey in http mode, until the pull request that builds what it needs. */
export const untilInHttp = (pr: string, what: string) =>
  base.skip(http, `Needs ${what} on the service (${pr})`)

/**
 * One step that needs a later pull request's work on the service: it runs on the mock, and in
 * http mode it is left out, said in the report, while the rest of the journey runs.
 */
export async function inMockUntil(pr: string, what: string, step: () => Promise<void>) {
  if (!http) return step()
  base.info().annotations.push({ type: 'skipped step', description: `Needs ${what} (${pr})` })
}

/**
 * One step the service needs and the mock has from the start (a domain on a new install): it runs
 * in http mode only.
 */
export async function inHttpOnly(what: string, step: () => Promise<void>) {
  if (http) return step()
  base.info().annotations.push({ type: 'skipped step', description: `The service's own ${what}` })
}

/**
 * One step of what the mock alone has, with no meaning on the service (a review flag such as
 * `?state=quiet`, too few questions to count): it runs on the mock, and in http mode it is left
 * out, said in the report, while the rest of the journey runs.
 */
export async function onMockOnly(what: string, step: () => Promise<void>) {
  if (!http) return step()
  base.info().annotations.push({ type: 'skipped step', description: `The mock's own ${what}` })
}

/**
 * One step only the service needs, where it finds what the mock's fixture leaves out (a live item
 * a suggestion overlaps, which its own clash check finds): it runs in http mode, said in the
 * report, and the mock skips it.
 */
export async function onServiceOnly(what: string, step: () => Promise<void>) {
  if (!http) return
  base.info().annotations.push({ type: 'service step', description: `The service's own ${what}` })
  await step()
}

/** The app's own origin, which the service takes changes from. */
const origin = process.env.GOLDEN_WEB_ORIGIN ?? ''

/** The workspace the service answers on now: the demo week, or a new install. */
let workspace: 'week' | 'empty' = 'week'

/**
 * A fresh copy of a workspace on its own service, with Jon signed in, as the mock starts. The
 * harness reads the app's demo week under the app's aliases (tsconfig.app.json), so it is loaded
 * by name, in http mode only.
 */
async function startService(page: Page, on: 'week' | 'empty') {
  const harness = './http/harness.ts'
  const { freshService } = (await import(harness)) as {
    freshService: (workspace: 'week' | 'empty') => Promise<{ close: () => Promise<void> }>
  }
  const service = await freshService(on)
  workspace = on
  const signedIn = await page.request.post('/api/v1/auth/sign-in', {
    headers: { 'x-heed-csrf': 'dev-sign-in', origin },
    data: { email: 'per_jon@example.test' },
  })
  if (!signedIn.ok()) throw new Error(`Jon could not sign in: ${await signedIn.text()}`)
  return service
}

/** The app's requests to the service still waiting for an answer, by page. */
const waiting = new WeakMap<Page, number>()

/**
 * Moves a paused clock on once the service has answered what the app asked: a toast and a closing
 * dialog wait for the clock, and on the service an answer takes longer than the mock's.
 */
export async function settle(page: Page, ms: number) {
  if (http)
    for (let quiet = 0; quiet < 3;) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      quiet = waiting.get(page) ? 0 : quiet + 1
    }
  await page.clock.runFor(ms)
}

/** In http mode each journey gets a fresh demo week on its own service, signed in as Jon. */
export const test = base.extend<{ demoWeek: void }>({
  demoWeek: [
    async ({ page }, use) => {
      if (!http) return use()
      const api = (url: string) => new URL(url).pathname.startsWith('/api/v1/')
      const count = (by: number) => (url: string) => {
        if (api(url)) waiting.set(page, (waiting.get(page) ?? 0) + by)
      }
      page.on('request', (r) => count(1)(r.url()))
      page.on('requestfinished', (r) => count(-1)(r.url()))
      page.on('requestfailed', (r) => count(-1)(r.url()))
      const service = await startService(page, 'week')
      try {
        await use()
      } finally {
        await service.close()
      }
    },
    { auto: true },
  ],
})

/* ---------- addresses ---------- */

/**
  Open an address of the app. The mockup kept its addresses after the hash, so only a journey's
  first visit loaded the page and every later one moved inside the running app, keeping what the
  journey had done so far. go does the same. In http mode a mock card's id becomes the service's,
  and so does a context item's, in the path and in the quick view's `dock`, and the mock's flags
  become what they stand for: `?state=offline` takes the browser offline, `?state=failed` makes
  the first try of a decision fail, `?bulk=fail` makes the last row of the first change to many
  rows fail, `?quality=failed` makes the last check of the saved questions one that stopped
  after 8 of them, `?demo=last` decides every suggestion but the one opened, through the service,
  `?demo=setup` starts on an empty workspace, `?links=off` (or `on`) switches following links
  for agents in Agents and access, on the service, before the page loads, `?figures=on|off` switches
  Cube's figures, and Ask's `?example=` asks the example's question in the composer (`figconflict`
  after someone reported that its figure doesn't fit).
*/
export async function go(page: Page, route: string) {
  const was = workspace
  const to = http ? await httpRoute(page, route) : { route }
  // On another workspace the app reads everything again, as a fresh visit does.
  if (page.url().startsWith('http') && !to.load && was === workspace) await moveTo(page, to.route)
  else await page.goto(to.route)
  await to.after?.()
}

/** Move to another address inside the app, as a link on the page does, without loading it again. */
export const moveTo = (page: Page, route: string) =>
  page.evaluate((to) => {
    const link = Object.assign(document.createElement('a'), { href: to })
    document.body.append(link)
    link.click()
    link.remove()
  }, route)

/**
 * Sign in as one of the demo's people, as a person does: sign out in the user menu, pick them on
 * the sign-in page, and land in their Inbox. A journey starts signed in, as Jon.
 */
export async function signInAs(page: Page, name: string) {
  await go(page, '/inbox')
  await signOut(page)
  await page.getByRole('button', { name: new RegExp(name) }).click()
  await expect(page).toHaveURL(/\/inbox$/)
  await expect(userMenu(page)).toContainText(name)
}

/** The sidebar's user menu, which names who is signed in. */
export const userMenu = (page: Page) =>
  page.locator('[data-sidebar=sidebar] [data-sidebar=footer]').first().getByRole('button')

/** Sign out in the user menu, which leads to the sign-in page. */
export async function signOut(page: Page) {
  await userMenu(page).click()
  await page.getByRole('menuitem', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/signin$/)
}

async function httpRoute(
  page: Page,
  route: string,
): Promise<{ route: string; after?: () => Promise<void>; load?: boolean }> {
  const url = new URL(route, 'http://app')
  // A domain's page names it by the service's id, area_ and the mock's; a new one has no id yet.
  const domainPage = /^\/settings\/domains\/(?!new$)([a-z_]+)$/.exec(url.pathname)
  const path = domainPage
    ? `/settings/domains/area_${domainPage[1]}`
    : (
        await Promise.all(
          url.pathname.split('/').map(async (part) => (part ? publishedItem(page, part) : part)),
        )
      )
        .map((part) => (part ? card(part) : part))
        .join('/')
  const query = url.searchParams
  const at = query.get('card')
  if (at) query.set('card', card(at))
  // The quick view names what it shows by kind and id: `context.itm_...`.
  const dock = query.get('dock')?.match(/^([a-z]+)\.(.+)$/)
  if (dock) query.set('dock', `${dock[1]}.${card(dock[2]!)}`)
  const demo = query.get('demo')
  const state = query.get('state')
  const bulk = query.get('bulk')
  const connect = query.get('connect')
  const quality = query.get('quality')
  const links = query.get('links')
  query.delete('links')
  const figures = query.get('figures')
  const example = path === '/ask' ? query.get('example') : null
  query.delete('demo')
  query.delete('state')
  query.delete('bulk')
  query.delete('connect')
  query.delete('quality')
  query.delete('figures')
  if (example) {
    // An example is the mock's own answer: on the service the journey asks its question, in a
    // chat of its own.
    query.delete('example')
    query.set('n', example)
  }
  if (demo === 'last') await decideAllBut(page, path.split('/')[2] ?? '')
  // A new install: the journey moves to a copy of an empty workspace, Jon signed in there.
  else if (demo === 'setup') await startService(page, 'empty')
  // Observability with nothing asked yet is a new install too.
  else if (state === 'empty' && path.startsWith('/observability')) await startService(page, 'empty')
  // Back to the demo week from a new install.
  else if (demo === 'week' && workspace === 'empty') await startService(page, 'week')
  else if (demo && demo !== 'week') throw new Error(`?demo=${demo} has no http meaning yet`)
  if (state === 'failed') await failFirstTry(page)
  if (bulk === 'fail') await failLastRowOnce(page)
  else if (bulk) throw new Error(`?bulk=${bulk} has no http meaning yet`)
  if (quality === 'failed') await failedCheck(8)
  else if (quality) throw new Error(`?quality=${quality} has no http meaning yet`)
  if (links === 'on' || links === 'off') await followLinks(page, links === 'on')
  else if (links) throw new Error(`?links=${links} has no http meaning yet`)
  // Figures on or off for Cube, as an admin switches them; only the warehouse on leaves Cube off,
  // and the service has no warehouse integration.
  if (figures === 'on' || figures === 'off' || figures === 'warehouse')
    await figuresOn(page, figures === 'on')
  else if (figures) throw new Error(`?figures=${figures} has no http meaning yet`)
  if (example === 'figconflict') await figureDoesNotFit(page)
  const search = query.toString()
  return {
    route: `${path}${search ? `?${search}` : ''}`,
    // Another workspace on another service, or a switch the app has read: the app loads again.
    ...(demo === 'setup' || links ? { load: true } : {}),
    // The live line's states happen for real: a wait, an agent's sign-in, a no in the browser.
    ...(connect ? { after: () => connectState(page, connect) } : {}),
    ...(example ? { after: () => askExample(page, example) } : {}),
    ...(state === 'offline'
      ? {
          // Offline once the page and what it loads on demand are in, as the mock's flag is.
          after: async () => {
            await page.waitForLoadState('networkidle')
            await page.context().setOffline(true)
          },
        }
      : {}),
  }
}

/**
 * The live line in a state the mock's `?connect=` shows, reached on the service: the wait starts
 * with Copy prompt, the agent signs in or the person says no, or the wait runs out (a journey
 * with the clock installed).
 */
async function connectState(page: Page, flag: string) {
  if (flag === 'idle') return
  await page.getByRole('button', { name: 'Copy prompt' }).first().click()
  if (flag === 'waiting') return
  if (flag === 'connected' || flag === 'declined')
    return agentSignsIn(page, { allow: flag === 'connected' })
  if (flag === 'hint' || flag === 'timeout')
    return page.clock.runFor(flag === 'hint' ? 120_000 : 600_000)
  throw new Error(`?connect=${flag} has no http meaning yet`)
}

/**
 * The person's own agent signs in, as one does once its prompt is pasted (J12): it registers with
 * the service's login server, opens the sign-in, the person answers on the consent page (`allow`,
 * yes by default) and, on a yes, the agent collects its tokens. In mock mode the mock plays it.
 */
export async function agentSignsIn(
  page: Page,
  { allow = true, agent = 'Claude Code' }: { allow?: boolean; agent?: string } = {},
) {
  if (!http) return
  // The login server's address, the issuer: on the web app's host (http/harness.ts).
  const service = `http://localhost:${process.env.GOLDEN_API_PORT}`
  const redirect = 'http://127.0.0.1:43123/callback'
  const session = (await page.context().cookies()).find((c) => c.name === 'heed_session')
  if (!session) throw new Error('Nobody is signed in to answer the consent page')
  const registered = await fetch(`${service}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: agent,
      redirect_uris: [redirect],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
  if (registered.status !== 201)
    throw new Error(`The agent could not register: ${await registered.text()}`)
  const { client_id: clientId } = (await registered.json()) as { client_id: string }
  const verifier = randomBytes(32).toString('base64url')
  const authorize = new URL(`${service}/oauth/authorize`)
  for (const [key, value] of Object.entries({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirect,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: randomUUID(),
    scope: 'read feedback propose',
    resource: `${service}/mcp`,
  }))
    authorize.searchParams.set(key, value)
  const started = await fetch(authorize, { redirect: 'manual' })
  const consent = started.headers.get('location')
  if (started.status !== 302 || !consent)
    throw new Error('The sign-in did not reach the consent page')
  const browserCookie = started.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
  const cookie = `heed_session=${session.value}; ${browserCookie}`
  const { csrfToken } = (await (
    await fetch(`${service}/api/v1/auth/session`, { headers: { cookie } })
  ).json()) as { csrfToken: string }
  const decided = await fetch(`${service}/api/v1/connections/request/decision`, {
    method: 'POST',
    headers: { cookie, origin, 'x-heed-csrf': csrfToken, 'content-type': 'application/json' },
    body: JSON.stringify({ id: new URL(consent).searchParams.get('request'), allow }),
  })
  if (!decided.ok) throw new Error(`The consent answer was refused: ${await decided.text()}`)
  if (!allow) return
  const back = new URL(((await decided.json()) as { redirectTo: string }).redirectTo)
  const token = await fetch(`${service}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: back.searchParams.get('code') ?? '',
      redirect_uri: redirect,
      client_id: clientId,
      code_verifier: verifier,
      resource: `${service}/mcp`,
    }).toString(),
  })
  if (!token.ok) throw new Error(`The agent got no tokens: ${await token.text()}`)
}

/**
 * An item the journey published on the way has the service's id, not the mock's: it is found by
 * its title in the library. Anything else is left as it is.
 */
async function publishedItem(page: Page, part: string) {
  const title = httpWorld().published[part]
  if (!title) return part
  const library = await page.request.get('/api/v1/library')
  const { items } = (await library.json()) as { items: { id: string; title: string }[] }
  const item = items.find((i) => i.title === title)
  if (!item) throw new Error(`“${title}” is not in the library: was it published?`)
  return item.id
}

/** Following links for agents (get_related), switched in Agents and access as Jon, an admin. */
async function followLinks(page: Page, on: boolean) {
  const session = await page.request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const set = await page.request.post('/api/v1/tools/get_related', {
    headers: { 'x-heed-csrf': csrfToken, origin, 'idempotency-key': randomUUID() },
    data: { enabled: on, reason: 'Changed in Settings, Agents and access.' },
  })
  if (!set.ok()) throw new Error(`Following links could not be switched: ${await set.text()}`)
}

/** A change through the service's API as Jon, with his session's token. */
async function asJon(page: Page, method: 'POST' | 'PUT', path: string, data: object) {
  const session = await page.request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  const response = await page.request.fetch(`/api/v1${path}`, {
    method,
    headers: { 'x-heed-csrf': csrfToken, origin, 'idempotency-key': randomUUID() },
    data,
  })
  if (!response.ok()) throw new Error(`${method} ${path} was refused: ${await response.text()}`)
}

/** Show figures in Ask for Cube, on or off, as an admin switches it on Cube's page. */
const figuresOn = (page: Page, on: boolean) =>
  asJon(page, 'PUT', '/figures/cube', { enabled: on, reason: 'Show figures in Ask, in a journey.' })

/**
 * The questions of the mock's examples a journey asks on the service (src/app/api/mock/data/ask.ts),
 * as someone would type them. The service reads no dates in the mock's "after 9 May", and the
 * mock's answer to it is about 9 to 31 May, so that one asks for those days.
 */
const exampleQuestions: Record<string, string> = {
  grounded: 'Why did orders in Norway drop in August?',
  figconflict: 'Did discount cost in Norway fall from 9 to 31 May?',
}

/** Asks a mock example's question in Ask's composer, as someone types it. */
async function askExample(page: Page, id: string) {
  const question = exampleQuestions[id]
  if (!question) throw new Error(`?example=${id} has no http meaning yet`)
  const box = page.getByRole('textbox', { name: 'Ask a question' })
  await box.click()
  await box.pressSequentially(question)
  await box.press('Enter')
}

/**
 * Someone said the figure for discount cost in Norway after 9 May doesn't fit the context item
 * about the regulator's pause, as the mock's `figconflict` example has it: a figure report through
 * the service, to the owners of Marketing and the data contact.
 */
const figureDoesNotFit = (page: Page) =>
  asJon(page, 'POST', '/reports', {
    question: 'Did discount cost in Norway fall from 9 to 31 May?',
    itemId: card('itm_za26xpzv'),
    part: 'figure',
    what: "The figure doesn't fit this context item.",
    figure: {
      source: 'cube',
      metric: 'metric:discount_cost',
      values: ['val:market/norway'],
      from: '2026-05-09',
      to: '2026-05-31',
      route: 'both',
    },
  })

/** The check job's last run over the saved questions stopped after `checked` of them. */
async function failedCheck(checked: number) {
  const harness = './http/harness.ts'
  const { failedCheck: fail } = (await import(harness)) as {
    failedCheck: (checked: number) => Promise<void>
  }
  await fail(checked)
}

/** The first try of each decision fails with the service's own failure; the next goes through. */
async function failFirstTry(page: Page) {
  const tried = new Set<string>()
  await page.route(/\/api\/v1\/review\/[^/]+\/(publish|return)$/, async (route) => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'POST' || tried.has(path)) return route.fallback()
    tried.add(path)
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      json: { code: 'SERVICE_UNAVAILABLE', status: 503, message: 'The service is busy.' },
    })
  })
}

/**
 * The first change to many rows fails on its last row, as the mock's `?bulk=fail` does: the
 * service makes the change without that row, and the answer names it as failed, left as it was.
 */
async function failLastRowOnce(page: Page) {
  let failed = false
  await page.route(/\/api\/v1\/items\/bulk$/, async (route) => {
    const request = route.request()
    const input = request.postDataJSON() as { rows: string[] }
    if (failed || request.method() !== 'POST' || input.rows.length < 2) return route.fallback()
    failed = true
    const last = input.rows.at(-1)!
    const response = await route.fetch({
      postData: JSON.stringify({ ...input, rows: input.rows.slice(0, -1) }),
    })
    const result = (await response.json()) as {
      failed: { id: string; title: string; message: string }[]
    }
    result.failed.push({ id: last, title: '', message: 'The service is busy.' })
    await route.fulfill({ response, json: result })
  })
}

/**
 * Every suggestion in Jon's queue decided but `keep`, through the service: Kofi's agent's
 * suggestion returned, Lars's retirement archived, a clash published as disagreeing, the rest
 * published.
 */
async function decideAllBut(page: Page, keep: string) {
  const session = await page.request.get('/api/v1/auth/session')
  const { csrfToken } = (await session.json()) as { csrfToken: string }
  for (const id of queue()) {
    const headers = { 'x-heed-csrf': csrfToken, origin, 'idempotency-key': randomUUID() }
    const cardId = card(id)
    if (cardId === keep) continue
    const proposal = cardId.replace(/^proposal:/, '')
    const sheet = (await (await page.request.get(`/api/v1/review/${proposal}/sheet`)).json()) as {
      proposal: { revision: number }
      clashes: { itemId: string }[]
    }
    const revision = sheet.proposal.revision
    const decided =
      id === 'sug-agent'
        ? await page.request.post(`/api/v1/review/${proposal}/return`, {
            headers,
            data: { revision, note: 'Which provider page says two days?' },
          })
        : id === 'sug-lars-retire'
          ? await page.request.post(`/api/v1/review/${proposal}/close`, {
              headers,
              data: { revision },
            })
          : await page.request.post(`/api/v1/review/${proposal}/publish`, {
              headers,
              data: {
                revision,
                ...(sheet.clashes.length
                  ? {
                      relations: sheet.clashes.map((c) => ({
                        itemId: c.itemId,
                        relation: 'disagrees',
                      })),
                    }
                  : {}),
              },
            })
    if (!decided.ok()) throw new Error(`Could not decide ${id}: ${await decided.text()}`)
  }
}
