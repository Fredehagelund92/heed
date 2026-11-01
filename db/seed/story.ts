import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { CLIENT_INFO_META_KEY } from '@modelcontextprotocol/server'
import Fastify from 'fastify'
import pg from 'pg'
import type { Draft } from '../../src/domain/draft.ts'
import { shiftDate } from '../../src/domain/validity.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { calendarDateTypes, databaseFromPool, type Database } from '../../src/server/db/database.ts'
import { localRoles } from '../../src/server/db/roles.ts'
import { createDevVerifier, mintDevToken } from '../../src/server/mcp/auth.ts'
import { registerMcpRoutes } from '../../src/server/mcp/gateway.ts'
import type { AnonymousRecord } from '../../src/server/mcp/records.ts'
import { writeRecords } from '../../src/server/mcp/store.ts'
import { readDevPeople } from '../../src/server/modules/auth/index.ts'
import { raiseAlerts } from '../../src/server/modules/alerts/index.ts'
import { createBundleCache, liveServingBundle } from '../../src/server/modules/answer/index.ts'
import { createGapsService } from '../../src/server/modules/gaps/index.ts'
import { loadServingPolicy } from '../../src/server/modules/editions/index.ts'
import type { JobRunner } from '../../src/server/modules/jobs/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { seedPersonId } from './bulk.ts'
import { gapFixtures } from './fixtures/gaps.ts'

/*
  The demo's present, on top of its library and quality history (demo.ts), so a new install looks
  as the README shows it (docs/design/demo-world.md, section 15): what happened today and in the
  weeks before, made through the service's own API and MCP server, as the people and the agents
  who do it would. Nothing is written into a table the service would fill itself, except what the
  gateway records about each agent call (which the seed dates over the past weeks) and the setup
  checklist's mark that someone used Ask.

  1. The Norway story: Maria Lindqvist suggests "Online sales to Norway stopped on 4 August 2026"
     and Jon Abara, owner of Sales, publishes it. The README's question about orders in Norway in
     October 2026 answers with it.
  2. A conflict in Sales: Jon says United Kingdom orders count store credit, Sofia Brandt says they
     are card and cash payments only, and her item says it disagrees with his. Agents get both with
     the Conflict line, and the conflict view compares them.
  3. Suggestions waiting for the owners of Sales: Ines Duarte's change to "Units sold excludes test
     accounts", Maria's new item about card payments in Spain, and Lars Dahl's suggestion to archive
     an item whose time has passed. Jon saves two questions from Ask.
  4. What agents asked: about 160 calls to the MCP server a week, over the eight whole weeks
     before this one and this week so far, from Claude Code, the Claude app, Cursor and ChatGPT,
     each answered by the server as it answers any agent on the live edition: Checked, Conflict,
     Outdated, and Not found for what nobody wrote down. The records keep no question and no
     person (FR-602); the seed only moves their hour to the hour they stand for, and the conflict
     alert is raised once, as the alert job would.

  It runs with the real clock, after the demo, on a database the demo was just loaded into, as the
  superuser: the API calls go through the service's own role.
*/

const peopleFile = fileURLToPath(new URL('./people.local.yml', import.meta.url))

/** The Norway story's item, as the mock world and the README tell it. */
export const norwayStop = {
  title: 'Online sales to Norway stopped on 4 August 2026',
  summary:
    'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.',
} as const

/** The conflicting pair's titles. */
export const conflictTitles = [
  'United Kingdom orders count store credit',
  'United Kingdom orders are card and cash payments only',
] as const

const market = (id: string) => ({ dimension: 'dim:market', value: `val:market/${id}` })

/** A draft of a Sales item, scoped to metrics and markets, with one source. */
function salesDraft(d: {
  kind: NonNullable<Draft['kind']>
  title: string
  summary: string
  metrics: string[]
  markets: string[]
  from: string
  source: string
  quote: string
  notToConclude: string
  body?: string
  conflicts?: string[]
}): Draft {
  return {
    areaId: 'area_sales',
    kind: d.kind,
    title: d.title,
    summary: d.summary,
    ...(d.body ? { body: d.body } : {}),
    scope: {
      metrics: d.metrics.map((m) => `metric:${m}`),
      dimensions: [],
      dimensionValues: d.markets.map(market),
    },
    validity: { start: d.from, end: null },
    reviewDate: '2027-03-01',
    evidence: [{ url: d.source, quote: d.quote, date: '2026-10-05' }],
    notToConclude: d.notToConclude,
    ...(d.conflicts ? { conflicts: d.conflicts } : {}),
  }
}

/** A job runner that runs nothing: the service's own jobs pick up once it starts. */
const noJobs: JobRunner = {
  start: () => Promise.resolve(),
  stop: () => Promise.resolve(),
  runNow: () => Promise.resolve({ outcome: 'not_running' }),
  overview: () => Promise.reject(new Error('The demo seed runs no jobs')),
}

type Call = (
  method: 'GET' | 'POST',
  path: string,
  who: string,
  payload?: object,
) => Promise<Record<string, unknown>>

/** The service's API on the database, signed in as the demo's people by their email's name. */
async function openApi(seedUrl: string) {
  const pool = new pg.Pool({
    connectionString: seedUrl,
    max: 2,
    options: `-c role=${localRoles.api}`,
    types: calendarDateTypes,
  })
  pool.on('error', () => undefined)
  const app = buildApp({
    database: databaseFromPool(pool),
    jobs: noJobs,
    logger: createLogger({ level: 'silent' }),
    clock: systemClock(),
    devPeople: await readDevPeople(peopleFile),
  })
  const sessions = new Map<string, Record<string, string>>()
  const signIn = async (who: string) => {
    const known = sessions.get(who)
    if (known) return known
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `per_${who}@example.test` },
    })
    if (response.statusCode !== 200) throw new Error(`${who} could not sign in: ${response.body}`)
    const headers = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
    sessions.set(who, headers)
    return headers
  }
  const call: Call = async (method, path, who, payload) => {
    const response = await app.inject({
      method,
      url: '/api/v1' + path,
      headers: { ...(await signIn(who)), 'idempotency-key': randomUUID() },
      ...(payload ? { payload } : {}),
    })
    if (response.statusCode !== 200)
      throw new StoryError(method, path, who, response.statusCode, response.body)
    return response.json<Record<string, unknown>>()
  }
  return { call, pool, close: () => app.close() }
}

class StoryError extends Error {
  override name = 'StoryError'
  readonly status: number
  readonly body: string
  constructor(method: string, path: string, who: string, status: number, body: string) {
    super(`${method} ${path} as ${who}: ${status} ${body}`)
    this.status = status
    this.body = body
  }
  /** The live items a publish waits on an answer for, when that is why it was refused. */
  get clashes(): string[] {
    if (this.status !== 422) return []
    try {
      const data = (JSON.parse(this.body) as { data?: { clashes?: { itemId: string }[] } }).data
      return (data?.clashes ?? []).map((c) => c.itemId)
    } catch {
      return []
    }
  }
}

/**
 * A publish that says how the item relates to each live item it clashes with: unrelated, unless
 * the item says it disagrees with it.
 */
async function withRelations<T>(
  publish: (relations: { itemId: string; relation: string }[]) => Promise<T>,
  disagrees: readonly string[] = [],
): Promise<T> {
  const relations: { itemId: string; relation: string }[] = []
  for (;;) {
    try {
      return await publish(relations)
    } catch (error) {
      const open = error instanceof StoryError ? error.clashes : []
      const fresh = open.filter((id) => !relations.some((r) => r.itemId === id))
      if (!fresh.length) throw error
      for (const itemId of fresh)
        relations.push({ itemId, relation: disagrees.includes(itemId) ? 'disagrees' : 'unrelated' })
    }
  }
}

/** A suggestion sent by `who`: a new item, or a change to `itemId` with its reason. */
async function suggest(
  call: Call,
  who: string,
  draft: Draft,
  change?: { itemId: string; reason: string },
): Promise<string> {
  const p = await call('POST', '/proposals', who, {
    draft,
    channel: 'form',
    ...(change ?? {}),
  })
  await call('POST', `/proposals/${p.id as string}/submit`, who, { revision: p.revision })
  return p.id as string
}

/** The Norway story, the conflict and the waiting suggestions. Returns the conflict's two items. */
async function tellStory(
  call: Call,
  database: Database,
): Promise<{ norway: string; conflict: [string, string] }> {
  // 1. Maria suggests the Norway item; Jon publishes it.
  const norwayDraft = salesDraft({
    kind: 'event',
    ...norwayStop,
    body: 'There are no stores in Norway, so the webshop was the only way to buy there.\n\n- Parcels already on their way still arrived.\n- Compare orders in Norway with itself before or after the stop, never across it.',
    metrics: ['orders', 'units_sold', 'gross_sales'],
    markets: ['norway'],
    from: '2026-08-04',
    source: 'https://customs.example/norway/notices/2026-08-04',
    quote:
      'Parcels from webshops outside Norway are held at the border from 4 August 2026 until further notice.',
    notToConclude: 'Fewer orders in Norway after 4 August do not mean fewer customers.',
  })
  const norwayProposal = await suggest(call, 'maria', norwayDraft)
  const published = await withRelations(async (relations) => {
    const p = await call('GET', `/proposals/${norwayProposal}`, 'jon')
    return call('POST', `/review/${norwayProposal}/publish`, 'jon', {
      revision: p.revision,
      ...(relations.length ? { relations } : {}),
    })
  })
  const norway = (published.proposal as { itemId: string }).itemId
  // It answers the gap agents raised about orders in Norway in October (db/seed/fixtures/gaps.ts),
  // which Jon resolves on the edition that carries it.
  const gap = gapFixtures.find(
    (g) => g.topic === 'area_sales|metric:orders|val:market/norway|2026-10',
  )
  if (!gap) throw new Error('The demo has no gap about orders in Norway')
  await database.transaction(seedPersonId('per_jon'), async (tx) => {
    await tx.query('insert into gap_proposals (gap_id, proposal_id) values ($1, $2)', [
      gap.id,
      norwayProposal,
    ])
    await createGapsService(tx).setStatus(gap.id, 'resolved', `Published "${norwayStop.title}".`)
  })

  // 2. Two Sales items that disagree, each published by an owner of Sales.
  const ukDraft = (title: string, summary: string, conflicts?: string[]) =>
    salesDraft({
      kind: 'note',
      title,
      summary,
      metrics: ['orders'],
      markets: ['united_kingdom'],
      from: '2026-01-01',
      source:
        conflicts === undefined
          ? 'https://wiki.example/finance/united-kingdom-orders'
          : 'https://wiki.example/payments/united-kingdom-settlement',
      quote:
        conflicts === undefined
          ? 'Store credit and gift card payments are booked as orders in the United Kingdom.'
          : 'United Kingdom settlement files carry card and cash payments only.',
      notToConclude:
        conflicts === undefined
          ? 'Higher orders in the United Kingdom after a gift card sale are not new customers.'
          : 'Orders in the United Kingdom are not the whole value customers spent there.',
      ...(conflicts ? { conflicts } : {}),
    })
  const publishItem = (who: string, draft: Draft, disagrees: string[] = []) =>
    withRelations(
      (relations) =>
        call('POST', '/items/publish', who, {
          draft,
          ...(relations.length ? { relations } : {}),
        }),
      disagrees,
    ).then((r) => {
      if (!r.published) throw new Error(`${who}'s item "${draft.title}" was not published`)
      return r.itemId as string
    })
  const credit = await publishItem(
    'jon',
    ukDraft(
      conflictTitles[0],
      'United Kingdom orders include orders paid with store credit and gift cards, on the day the customer pays.',
    ),
  )
  const cardOnly = await publishItem(
    'sofia',
    ukDraft(
      conflictTitles[1],
      'United Kingdom orders count only card and cash payments. Store credit and gift cards are left out.',
      [credit],
    ),
    [credit],
  )

  // 3. Suggestions that wait for the owners of Sales.
  // A change carries the fields it changes; the service takes the rest from the live version.
  const testAccounts = 'itm_s90n5xps'
  await suggest(
    call,
    'ines',
    {
      summary:
        'Units sold in Norway leaves out the 340 accounts our teams use to test the webshop. From 29 May 2026 the test accounts of the new app are left out too. From 1 October 2026 the 28 accounts the returns team uses to test refunds are left out as well.',
      evidence: [
        {
          url: 'https://wiki.example/data/definitions/units-sold-october',
          quote: 'Accounts with the internal flag are removed from all units sold figures.',
          date: '2026-10-05',
        },
      ],
    },
    {
      itemId: testAccounts,
      reason:
        'The returns team started its own test accounts in October. They were counted until last week.',
    },
  )
  await suggest(
    call,
    'maria',
    salesDraft({
      kind: 'event',
      title: 'Card payments in Spain failed from 14 to 16 October 2026',
      summary:
        'Card payments in Spain failed for most customers from 14 to 16 October 2026 while the payment provider moved to a new data centre. Orders in Spain for those three days are low.',
      metrics: ['orders'],
      markets: ['spain'],
      from: '2026-10-14',
      source: 'https://status.example/payments/spain/2026-10-14',
      quote:
        'Card authorisations in Spain were declined from 14 October 09:00 to 16 October 18:00 during the data centre move.',
      notToConclude:
        'Low orders in Spain from 14 to 16 October 2026 do not mean that customers stopped buying.',
    }),
  )
  await call('POST', `/items/${'itm_kh4llvi9'}/retire-proposals`, 'lars', {
    reason:
      'The provider change in Norway ended in December 2025, and nothing in it applies to the figures any more.',
  })
  // 4. Questions Jon saved from Ask, answered again after every change (FR-526).
  for (const question of [
    'How did orders in Norway change in October 2026?',
    "Why are Germany's orders low for yesterday?",
  ])
    await call('POST', '/saved-questions', 'jon', { areaId: 'area_sales', question, origin: 'ask' })
  return { norway, conflict: [credit, cardOnly] }
}

/** What an agent asks: one tool call with its arguments, and how often in a week. */
type Ask = { tool: string; args: Record<string, unknown>; weekly: number }

const markets = (...names: string[]) => [{ dimension: 'Market', values: names }]
const october = { from: '2026-10-01', to: '2026-10-31' }

/**
 * The agents' questions: topics the README and the demo world tell, and some that find nothing.
 * None is about a gap the demo leaves open, whose card says nobody asked about it this week.
 */
function asks(norway: string): Ask[] {
  const get = (question: string, metrics: string[], where: string[], window?: object) => ({
    question,
    metrics,
    ...(where.length ? { dimension_filters: markets(...where) } : {}),
    ...(window ? { window } : {}),
  })
  return [
    {
      tool: 'get_context',
      args: get(
        'How did orders in Norway change in October 2026?',
        ['Orders'],
        ['Norway'],
        october,
      ),
      weekly: 30,
    },
    {
      tool: 'get_context',
      args: get('Why are orders in Germany low for yesterday?', ['Orders'], ['Germany']),
      weekly: 22,
    },
    {
      tool: 'get_context',
      args: get(
        'Do United Kingdom orders this month include gift card payments?',
        ['Orders'],
        ['United Kingdom'],
        october,
      ),
      weekly: 10,
    },
    {
      tool: 'get_context',
      args: get(
        'What happened to orders in Spain in October 2026?',
        ['Orders'],
        ['Spain'],
        october,
      ),
      weekly: 16,
    },
    {
      tool: 'get_context',
      args: get('Why did units sold in Norway drop in August 2026?', ['Units sold'], ['Norway'], {
        from: '2026-08-01',
        to: '2026-08-31',
      }),
      weekly: 8,
    },
    {
      tool: 'get_context',
      args: get('What should I know about returns in France?', ['Returns'], ['France'], october),
      weekly: 8,
    },
    {
      tool: 'get_context',
      args: get('Why is discount cost in Italy low in May 2026?', ['Discount cost'], ['Italy'], {
        from: '2026-05-01',
        to: '2026-05-31',
      }),
      weekly: 6,
    },
    {
      tool: 'get_context',
      args: get(
        'How is return on ad spend in Norway this summer?',
        ['Return on ad spend'],
        ['Norway'],
        { from: '2026-06-01', to: '2026-09-30' },
      ),
      weekly: 8,
    },
    {
      tool: 'get_context',
      args: get(
        'Who counts as an active customer in Mexico?',
        ['Active customers'],
        ['Mexico'],
        october,
      ),
      weekly: 8,
    },
    {
      tool: 'get_context',
      args: get(
        'How did gross sales in the Netherlands change after online sales started again?',
        ['Gross sales'],
        ['Netherlands'],
        { from: '2026-09-01', to: '2026-10-31' },
      ),
      weekly: 6,
    },
    // The library starts in 2024: what agents ask about earlier finds nothing written down.
    {
      tool: 'get_context',
      args: get('Why did returns in Sweden jump in March 2023?', ['Returns'], ['Sweden'], {
        from: '2023-03-01',
        to: '2023-03-31',
      }),
      weekly: 8,
    },
    {
      tool: 'get_context',
      args: get('How did orders in Poland change in late 2023?', ['Orders'], ['Poland'], {
        from: '2023-10-01',
        to: '2023-12-31',
      }),
      weekly: 7,
    },
    { tool: 'get_context', args: { question: 'Why is it down this week?' }, weekly: 6 },
    { tool: 'find_context', args: { query: 'test accounts' }, weekly: 6 },
    { tool: 'read_context', args: { id: norway }, weekly: 5 },
  ]
}

/** The apps that call, by the name each gives itself, and their share of the calls. */
const apps = [
  ['claude-code', 6],
  ['claude-ai', 3],
  ['cursor', 2],
  ['chatgpt', 1],
] as const

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** The whole weeks before this one that the calls reach back: the last whole month is always in. */
const WEEKS = 8

/**
 * When a question's calls were made: `weekly` in each of the eight whole weeks before this one
 * (UTC, from Monday), spread over the days and working hours, and this week as many as the time
 * since Monday holds, at least half a week's, spread up to now.
 */
function hoursOf(weekly: number, now: Date, salt: number): Date[] {
  const today = now.toISOString().slice(0, 10)
  const monday = Date.parse(
    `${shiftDate(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7))}T00:00:00Z`,
  )
  const out: Date[] = []
  for (let w = WEEKS; w >= 1; w--)
    for (let i = 0; i < weekly; i++) {
      const day = Math.floor((i * 7) / weekly)
      const hour = 7 + ((i * 5 + salt * 3 + w) % 12)
      out.push(new Date(monday - w * 7 * DAY + day * DAY + hour * HOUR))
    }
  const elapsed = Math.max(HOUR, now.getTime() - monday)
  const thisWeek = Math.max(Math.ceil(weekly / 2), Math.round((weekly * elapsed) / (7 * DAY)))
  for (let i = 0; i < thisWeek; i++)
    out.push(new Date(monday + ((i + 0.5) / thisWeek) * elapsed - ((salt * 7 * 60_000) % HOUR)))
  return out.map((at) => new Date(Math.min(at.getTime(), now.getTime())))
}

/**
 * The agents' calls, through the MCP server on the live edition, from each app in turn, every
 * record dated to the hour of its call. Returns how many calls were made.
 */
async function askAgents(pool: pg.Pool, client: pg.Client, norway: string, now: Date) {
  const database = databaseFromPool(pool)
  const bundle = await database.transaction(null, (tx) =>
    liveServingBundle(tx, createBundleCache()),
  )
  const records: AnonymousRecord[] = []
  let stamp = now
  const { privateKey } = generateKeyPairSync('ed25519')
  const resource = 'http://localhost/mcp'
  const app = Fastify({ logger: false })
  registerMcpRoutes(app, {
    source: {
      bundle: () => Promise.resolve(bundle),
      // The seed's calls come one after the other in a moment; the client's request limit is for
      // real agents.
      policy: async (label) => {
        const policy = await loadServingPolicy(database, label)
        return {
          ...policy,
          rates: { ...policy.rates, client: 10_000, person: 10_000 },
          limits: {},
          client: policy.client && { ...policy.client, rate_per_minute: 10_000 },
        }
      },
    },
    store: {
      write: (batch) => {
        records.push(...batch)
        return Promise.resolve()
      },
      reportGap: () => Promise.resolve(''),
      feedback: () => Promise.resolve(),
    },
    verifier: createDevVerifier(privateKey, resource, 'development'),
    resource,
    now: () => stamp,
    wallClock: () => new Date(),
  })
  const base = await app.listen({ host: '127.0.0.1', port: 0 })
  const token = await mintDevToken(privateKey, resource, {
    client: 'claude-code',
    scopes: ['read'],
  })
  const deck = apps.flatMap(([name, share]) => Array.from({ length: share }, () => name))
  const connected = new Map<string, Client>()
  const agent = async (name: string) => {
    const known = connected.get(name)
    if (known) return known
    const c = new Client({ name, version: '1.0.0' })
    await c.connect(
      new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    )
    connected.set(name, c)
    return c
  }
  const calls = asks(norway).flatMap((ask, a) =>
    hoursOf(ask.weekly, now, a).map((at) => ({ ...ask, at })),
  )
  try {
    for (const [i, call] of calls.entries()) {
      stamp = call.at
      const name = deck[i % deck.length]!
      // Each call names its app, as clients on protocol 2026-07-28 do with every request.
      await (
        await agent(name)
      ).callTool({
        name: call.tool,
        arguments: call.args,
        _meta: { [CLIENT_INFO_META_KEY]: { name, version: '1.0.0' } },
      })
    }
  } finally {
    for (const c of connected.values()) await c.close().catch(() => undefined)
    // Closing writes what the gateway still holds.
    await app.close()
  }
  // A partition for every month the calls reach, as the nightly job makes them ahead.
  const months = [...new Set(calls.map((c) => c.at.toISOString().slice(0, 7)))]
  for (const month of months)
    for (const table of ['deliveries', 'mcp_requests']) {
      const start = `${month}-01`
      const next = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1))
        .toISOString()
        .slice(0, 10)
      const partition = `${table}_${month.replace('-', '_')}`
      await client.query(
        `create table if not exists ${partition} partition of ${table}
           for values from ('${start} 00:00Z') to ('${next} 00:00Z')`,
      )
      // Owned by the owner role, as the nightly job's are: the next start grants on every table
      // as that role, and a partition left to the superuser would stop it.
      await client.query(`alter table ${partition} owner to ${localRoles.owner}`)
    }
  await writeRecords(client, records)
  // The weekly counts the nightly job keeps, for every whole week the calls reach.
  await client.query('select count(*) from cl_obs_weekly_rollup_due($1::date)', [
    now.toISOString().slice(0, 10),
  ])
  return calls.length
}

/** What `loadStory` added. */
export type StoryCounts = { items: number; suggestions: number; calls: number }

/**
 * The demo's present on a database the demo was just loaded into (loadDemo), as a superuser at
 * `seedUrl`. Not idempotent: it publishes and suggests anew, so it runs once, right after the demo.
 */
export async function loadStory(seedUrl: string, now = new Date()): Promise<StoryCounts> {
  const api = await openApi(seedUrl)
  const client = new pg.Client({ connectionString: seedUrl })
  await client.connect()
  try {
    const { norway } = await tellStory(api.call, databaseFromPool(api.pool))
    await client.query('begin')
    const calls = await askAgents(api.pool, client, norway, now)
    // Someone used Ask: the setup checklist's one step that leaves no other record.
    await client.query(
      `insert into setup_marks (step) values ('ask') on conflict (step) do nothing`,
    )
    await client.query('commit')
    // The alert job's conflict rule, once, so the owners of Sales find the conflict in their Inbox
    // from the first start; the job raises the rest on its schedule.
    await raiseAlerts(databaseFromPool(api.pool), systemClock(), createBundleCache(), ['disagree'])
    return { items: 3, suggestions: 3, calls }
  } catch (error) {
    await client.query('rollback').catch(() => undefined)
    throw error
  } finally {
    await client.end()
    await api.close()
  }
}
