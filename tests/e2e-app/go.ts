import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test as base, type Page } from '@playwright/test'

export { expect } from '@playwright/test'

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

/**
 * How the queue ends in each mode once every suggestion is decided. The mock closes Lars's
 * withdrawn retirement; on the service, which keeps no withdrawal yet (P9), it is archived, and
 * the two suggestions a Google Drive read makes are not there yet (P11b).
 */
export const allHandled = () =>
  http ? '8 published, 1 returned, 1 archived.' : '10 published, 1 returned, 1 closed.'

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

/** The app's own origin, which the service takes changes from. */
const origin = process.env.GOLDEN_WEB_ORIGIN ?? ''

/**
 * A fresh copy of a workspace on its own service, with Jon signed in, as the mock starts. The
 * harness reads the app's demo week under the app's aliases (tsconfig.app.json), so it is loaded
 * by name, in http mode only.
 */
async function startService(page: Page, workspace: 'week' | 'empty') {
  const harness = './http/harness.ts'
  const { freshService } = (await import(harness)) as {
    freshService: (workspace: 'week' | 'empty') => Promise<{ close: () => Promise<void> }>
  }
  const service = await freshService(workspace)
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
  rows fail, `?demo=last` decides every suggestion but the one opened, through the service, and
  `?demo=setup` starts on an empty workspace.
*/
export async function go(page: Page, route: string) {
  const to = http ? await httpRoute(page, route) : { route }
  if (page.url().startsWith('http') && !to.load) await moveTo(page, to.route)
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

/** Sign in as one of the demo's people. */
export async function signInAs(page: Page, name: string) {
  await go(page, '/signin')
  await page.getByRole('button', { name: new RegExp(name) }).click()
}

async function httpRoute(
  page: Page,
  route: string,
): Promise<{ route: string; after?: () => Promise<void>; load?: boolean }> {
  const url = new URL(route, 'http://app')
  // A domain's page names it by the service's id, area_ and the mock's.
  const domainPage = /^\/settings\/domains\/([a-z_]+)$/.exec(url.pathname)
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
  query.delete('demo')
  query.delete('state')
  query.delete('bulk')
  if (demo === 'last') await decideAllBut(page, path.split('/')[2] ?? '')
  // A new install: the journey moves to a copy of an empty workspace, Jon signed in there.
  else if (demo === 'setup') await startService(page, 'empty')
  else if (demo && demo !== 'week') throw new Error(`?demo=${demo} has no http meaning yet`)
  if (state === 'failed') await failFirstTry(page)
  if (bulk === 'fail') await failLastRowOnce(page)
  else if (bulk) throw new Error(`?bulk=${bulk} has no http meaning yet`)
  const search = query.toString()
  return {
    route: `${path}${search ? `?${search}` : ''}`,
    // Another workspace on another service: the app loads again, as the mock starts afresh.
    ...(demo === 'setup' ? { load: true } : {}),
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
