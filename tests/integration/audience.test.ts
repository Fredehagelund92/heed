import { generateKeyPairSync } from 'node:crypto'
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { SignJWT } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import * as z from 'zod'
import { run } from '../../src/cli/commands.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createDevVerifier, devIssuer } from '../../src/server/mcp/auth.ts'
import { createAnonymousStore } from '../../src/server/mcp/store.ts'
import { deprecatedToolAliases, tools as mcpTools, toolNames } from '../../src/server/mcp/tools.ts'
import { Evidence } from '../../src/server/modules/assistant/citations.ts'
import {
  assistantTools,
  runTool,
  type AssistantToolName,
} from '../../src/server/modules/assistant/tools.ts'
import { principalFor, type Session } from '../../src/server/modules/auth/index.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { repositoryHelp } from '../../src/server/modules/help/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { accept, foundation, openEdition, people, servingEdition, version } from './fixtures.ts'
import {
  apiDatabase,
  contractOperations,
  servingPool,
  testDatabase,
  transaction,
  type Operation,
} from './support.ts'

/*
  The audience rule on every read path (FR-128, NFR-029, F4 of the gateway security check): an
  item for some groups only, and the accepted proposal that made it, reach nobody outside its
  audience. Groups are parked, so nobody is in the item's group: every person, whatever their
  roles, and every agent, whatever groups its token claims, is outside it. Only the review
  exception of row security stays: the proposal's author, its domain's owners and approvers and
  administrators read the proposal they decide. A visible item that mentions the hidden one, and
  conflicts with it, shows the mention as its words only.

  The sweep calls every read operation of the contract with every id it could take, as every
  person, then every MCP tool with tokens that claim the item's group, another group and none,
  every assistant tool as every person, and the CLI's export and audit, and looks for the hidden
  item's words and id in each answer. A positive control proves the words would be found.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const serving = servingPool(url)
const origin = 'http://localhost:5173'
const resource = 'http://127.0.0.1/mcp'
const { privateKey } = generateKeyPairSync('ed25519')
const clock = systemClock('2026-10-08')

/** The hidden item and the words of it that must reach nobody outside its audience. */
const hidden = {
  id: 'itm_vaultsun01',
  title: 'Vaultsunrise harbour closure',
  summary: 'Zephyrledger moves the harbour orders on holidays.',
  body: 'Quokkamarble keeps the harbour shut.',
}
const canaries = [hidden.id, 'Vaultsunrise', 'Zephyrledger', 'Quokkamarble']
const leaks = (text: string) => canaries.filter((canary) => text.includes(canary))

/** The visible item that mentions the hidden one, and conflicts with it. */
const linking = {
  id: 'itm_harbourlnk1',
  summaryMarkup: `Opening hours: see @[the harbour note](item:${hidden.id}) for holidays.`,
  summary: 'Opening hours: see the harbour note for holidays.',
}

const members = {
  ...people,
  auditor: '00000000-0000-4000-8000-0000000000a1',
  reader: '00000000-0000-4000-8000-0000000000b1',
}
/**
 * Who reads, and whether the review exception lets them read the hidden item's proposal: its
 * author, the owners and approvers of its domain, and administrators. Nobody reads the item.
 */
const readers = {
  author: { name: 'author', reviews: true },
  owner: { name: 'owner', reviews: true },
  approver: { name: 'approver', reviews: true },
  administrator: { name: 'admin', reviews: true },
  otherOwner: { name: 'stranger', reviews: false },
  auditor: { name: 'auditor', reviews: false },
  reader: { name: 'reader', reviews: false },
} as const
type Reader = keyof typeof readers

const app = buildApp({
  database,
  jobs: idleJobs(),
  clock,
  logger: createLogger({ level: 'silent' }),
  devPeople: Object.keys(members).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
  origins: [origin],
  mcp: {
    source: createEditionSource(serving),
    store: createAnonymousStore(serving),
    verifier: createDevVerifier(privateKey, resource, 'test'),
    resource,
  },
})

type Session$ = { cookie: string; csrf: string }
const sessions = new Map<Reader, Session$>()
let base = ''
let hiddenProposal = ''
let linkingProposal = ''
let liveLabel = ''
let secretVersion = ''

async function signIn(name: string): Promise<Session$> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/sign-in',
    headers: { origin, 'x-heed-csrf': 'dev-sign-in' },
    payload: { email: `${name}@example.test` },
  })
  expect(response.statusCode, response.body).toBe(200)
  const cookie = response.cookies[0]!
  return {
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: response.json<{ csrfToken: string }>().csrfToken,
  }
}

function send(who: Reader, method: string, path: string, payload?: object) {
  const session = sessions.get(who)!
  return app.inject({
    method: method as 'GET',
    url: path,
    headers: { cookie: session.cookie, 'x-heed-csrf': session.csrf, origin },
    ...(payload ? { payload } : {}),
  })
}

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await client.query(
      `insert into people (id,email,display_name) values
         ($1,'auditor@example.test','auditor'),($2,'reader@example.test','reader')`,
      [members.auditor, members.reader],
    )
    await client.query("insert into global_role_grants (person_id,role) values ($1,'auditor')", [
      members.auditor,
    ])
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      [people.stranger],
    )
    await servingEdition(client)
    // The hidden item: accepted and served for everyone, then limited to a group, which no product
    // path can do yet (groups are parked), as the security check did.
    const secret = await version(client, {
      item: hidden.id,
      title: hidden.title,
      summary: hidden.summary,
      body: hidden.body,
      owner: people.owner,
    })
    await accept(client, secret.id)
    // The visible item names it twice: a mention and a conflict.
    const link = await version(client, {
      item: linking.id,
      title: 'Harbour opening hours',
      summary: linking.summary,
      markup: linking.summaryMarkup,
      owner: people.owner,
    })
    await client.query(
      `insert into item_version_mentions (version_id,field,position,item_id,label)
       values ($1,'summary',0,$2,'the harbour note')`,
      [link.id, hidden.id],
    )
    await client.query(
      'insert into item_version_conflicts (version_id,other_item_id) values ($1,$2)',
      [link.id, hidden.id],
    )
    await accept(client, link.id)
    // Every version has evidence, as the item format asks, so the export can send each one.
    await client.query(
      `insert into item_version_evidence (version_id,position,url,quote,read_on)
       select id,0,'https://example.test/harbour','Opening hours','2026-08-05' from item_versions`,
    )
    const edition = await openEdition(client)
    await client.query('select edition_serve_item_version($1,$2)', [edition, secret.id])
    await client.query('select edition_serve_item_version($1,$2)', [edition, link.id])
    await client.query('select edition_seal($1)', [edition])
    await client.query('select edition_publish($1)', [edition])
    // Both proposals accepted, with the drafts they were written as.
    for (const [versionId, draft] of [
      [secret.id, { title: hidden.title, summary: hidden.summary, body: hidden.body }],
      [
        link.id,
        {
          title: 'Harbour opening hours',
          summaryMarkup: linking.summaryMarkup,
          conflicts: [hidden.id],
        },
      ],
    ] as const)
      await client.query(
        "update proposals set state='accepted',closed_at=now(),draft=$2 where item_version_id=$1",
        [versionId, JSON.stringify(draft)],
      )
    const ids = await client.query<{ id: string; version: string }>(
      'select id::text,item_version_id::text as version from proposals where item_version_id = any($1::uuid[])',
      [[secret.id, link.id]],
    )
    hiddenProposal = ids.rows.find((row) => row.version === secret.id)!.id
    linkingProposal = ids.rows.find((row) => row.version === link.id)!.id
    // The activity feed, the inbox and the live stream: the proposal's steps and an item event.
    await client.query(
      `insert into outbox_events (topic,area_id,aggregate_type,aggregate_id,payload,relay_seq,relayed_at)
       values ('proposal.submitted','finance','proposal',$1,'{"state":"submitted"}',1001,now()),
              ('proposal.decided','finance','proposal',$1,'{"state":"accepted"}',1002,now()),
              ('item.flagged','finance','item',$2,'{"state":"flagged"}',1003,now())`,
      [hiddenProposal, hidden.id],
    )
    liveLabel = (
      await client.query<{ label: string }>(
        'select e.label from editions e join live_edition l on l.seq = e.seq',
      )
    ).rows[0]!.label
    secretVersion = secret.id
    await client.query(
      `insert into settings_versions (key,version,value,reason)
       select key,max(version)+1,'{"person": 10000, "ip": 10000}','test' from settings_versions
        where key='limits.api_rate_per_minute' group by key`,
    )
  })
  // Versions are append-only, so the group goes on with their guards off, once they are written.
  await transaction(client, async () => {
    await client.query('alter table item_versions disable trigger user')
    await client.query(
      "update item_versions set audience_groups = '{finance_team}' where id = $1",
      [secretVersion],
    )
    await client.query('alter table item_versions enable trigger user')
  })
  for (const [reader, { name }] of Object.entries(readers))
    sessions.set(reader as Reader, await signIn(name))
  base = await app.listen({ host: '127.0.0.1', port: 0 })
}, 120_000)
afterAll(async () => {
  await app.close()
  await serving.end()
})

/** The operations whose answers the review exception may fill with the hidden proposal. */
const reviewing = new Set([
  'proposals.list',
  'proposals.get',
  'proposals.events',
  'proposals.overlap',
  'proposals.tests',
  'proposals.preview',
  'review.queue',
  'review.get',
  'review.sheet',
  'activity.list',
  'inbox.list',
  'audit.search',
  'audit.export',
])

/** Every value each path parameter is tried with: the hidden item, its proposal, and the rest. */
function samples(): Record<string, string[]> {
  return {
    id: [hidden.id, linking.id, hiddenProposal, linkingProposal],
    areaId: ['finance'],
    label: [liveLabel],
    kind: ['metric'],
    key: ['privacy.min_count'],
    tool: ['get_facts'],
    job: ['retention.run'],
    question: ['00000000-0000-4000-8000-00000000abcd'],
    batchId: ['00000000-0000-4000-8000-00000000abcd'],
  }
}

function pathsOf(op: Operation): string[] {
  const names = [...op.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!)
  let paths = [op.path]
  for (const name of names)
    paths = paths.flatMap((path) =>
      (samples()[name] ?? ['x']).map((value) =>
        path.replace(`{${name}}`, encodeURIComponent(value)),
      ),
    )
  return paths
}

/** Lists and searches asked about the hidden item by its id and its words. */
const queries = () => [
  ['items.list', `/api/v1/items?q=Zephyrledger`],
  ['items.list', `/api/v1/items?mentions=item:${hidden.id}`],
  ['items.list', `/api/v1/items?limit=200`],
  ['proposals.list', `/api/v1/proposals?state=accepted`],
  ['proposals.list', `/api/v1/proposals?itemId=${hidden.id}`],
  ['proposals.list', `/api/v1/proposals?itemId=${linking.id}`],
  ['activity.list', `/api/v1/activity?areaId=finance`],
  ['editions.compare', `/api/v1/editions/compare?to=${liveLabel}`],
  ['editions.compareItem', `/api/v1/editions/compare/items/${linking.id}?to=${liveLabel}`],
  ['editions.compareItem', `/api/v1/editions/compare/items/${hidden.id}?to=${liveLabel}`],
  ['vocabulary.search', `/api/v1/vocabulary/search?q=harbour`],
  ['audit.search', `/api/v1/audit?subjectId=${hidden.id}`],
  ['audit.export', `/api/v1/audit/export?format=jsonl`],
]

/**
 * Reads that are POSTs: a preview, the review stamps, the Bin's previews, and the answer engine's
 * look-up, Try it and reach, asked about the hidden item's own scope.
 */
const posts = () =>
  [
    ['proposals.preview', `/api/v1/proposals/${hiddenProposal}/preview`, {}],
    ['proposals.preview', `/api/v1/proposals/${linkingProposal}/preview`, {}],
    ['ask.lookup', '/api/v1/ask/lookup', { question: 'Orders on holidays', metrics: ['Orders'] }],
    ['tryIt.run', '/api/v1/try-it', { metrics: ['Orders'] }],
    ['engine.reach', '/api/v1/engine/reach', { draft: linkingProposal }],
    ['library.reviews', '/api/v1/library/reviews', { ids: [hidden.id, linking.id] }],
    ['bin.preview', '/api/v1/bin/preview', { ids: [hidden.id] }],
    ['bin.rescuePreview', '/api/v1/bin/rescue-preview', { ids: [hidden.id], areaId: 'finance' }],
  ] as const

/** An answer without the review exception's operations' own proposal, and the export's digests. */
function scanned(name: string, body: string): string {
  if (name !== 'editions.export') return body
  // An export lists what it may not show by id and digest only, so its edition digest checks.
  const document = JSON.parse(body) as { withheld?: unknown }
  return JSON.stringify({ ...document, withheld: [] })
}

describe('the audience rule on every read path', () => {
  it('finds the words where the review exception allows them (the positive control)', async () => {
    for (const reader of Object.keys(readers) as Reader[]) {
      const response = await send(reader, 'GET', `/api/v1/proposals/${hiddenProposal}`)
      if (readers[reader].reviews) {
        expect(response.statusCode, reader).toBe(200)
        expect(leaks(response.body), reader).toContain('Vaultsunrise')
      } else expect(response.statusCode, reader).toBe(404)
    }
    const activity = await send('owner', 'GET', '/api/v1/activity')
    expect(leaks(activity.body)).toContain('Vaultsunrise')
  })

  it(
    'shows nobody the hidden item through any web API read, and its proposal only to those who decide it',
    { timeout: 300_000 },
    async () => {
      const found: string[] = []
      const failed: string[] = []
      const reads = contractOperations()
        .filter((op) => op.method === 'GET' && op.name !== 'events.stream')
        .flatMap((op) => pathsOf(op).map((path) => [op.name, path] as const))
      for (const reader of Object.keys(readers) as Reader[]) {
        const check = (name: string, path: string, status: number, body: string) => {
          if (status === 500) failed.push(`${reader} ${path}: ${status} ${body.slice(0, 160)}`)
          if (readers[reader].reviews && reviewing.has(name)) return
          // An answer that repeats the id the caller sent tells them nothing new.
          const words = leaks(scanned(name, body)).filter((word) => !path.includes(word))
          if (words.length) found.push(`${reader} ${path}: ${words.join(', ')}`)
        }
        for (const [name, path] of [...reads, ...queries()]) {
          const response = await send(reader, 'GET', path)
          check(name, path, response.statusCode, response.body)
        }
        for (const [name, path, payload] of posts()) {
          const response = await send(reader, 'POST', path, payload)
          check(name, path, response.statusCode, response.body)
        }
      }
      expect(failed).toEqual([])
      expect(found).toEqual([])
    },
  )

  it('shows the mention of the hidden item as its words, in the library and in drafts', async () => {
    for (const reader of Object.keys(readers) as Reader[]) {
      const item = await send(reader, 'GET', `/api/v1/items/${linking.id}`)
      expect(item.statusCode).toBe(200)
      expect(item.json()).toMatchObject({
        summary: linking.summary,
        summaryMarkup: 'Opening hours: see the harbour note for holidays.',
      })
      const proposal = await send(reader, 'GET', `/api/v1/proposals/${linkingProposal}`)
      expect(proposal.statusCode).toBe(200)
      expect(proposal.json()).toMatchObject({
        draft: {
          summaryMarkup: 'Opening hours: see the harbour note for holidays.',
          conflicts: [],
        },
      })
    }
  })

  it('withholds from an edition export the hidden version and the version that names it, by digest', async () => {
    const response = await send('administrator', 'GET', `/api/v1/editions/${liveLabel}/export`)
    expect(response.statusCode).toBe(200)
    const document = response.json<{ items: { id: string }[]; withheld: { id: string }[] }>()
    expect(document.withheld.map((row) => row.id).sort()).toEqual([linking.id, hidden.id].sort())
    expect(document.items.map((row) => row.id)).not.toContain(linking.id)
  })

  it('gives agents nothing of the hidden item, whatever groups their token claims', async () => {
    const found: string[] = []
    const claims: (readonly string[] | undefined)[] = [undefined, ['finance_team'], ['sales']]
    const calls: [string, Record<string, unknown>][] = [
      ['get_context', { question: 'Orders on holidays', metrics: ['Orders'] }],
      [
        'get_context',
        { question: 'Orders on holidays', metrics: ['Orders'], response_format: 'full' },
      ],
      ['find_context', { query: 'Vaultsunrise harbour Zephyrledger' }],
      ['find_context', { query: 'harbour holidays' }],
      ['read_context', { id: hidden.id }],
      ['read_context', { id: linking.id }],
      ['get_related', { id: linking.id }],
      ['get_related', { id: `item:${hidden.id}` }],
      // The deprecated ids answer with their old code, so they are swept too.
      ['get_facts', { question: 'Orders on holidays', metrics: ['Orders'] }],
      ['find_facts', { query: 'Vaultsunrise harbour Zephyrledger' }],
      ['search_facts', { query: 'Zephyrledger' }],
      ['search_facts', { query: '', mentions: `item:${hidden.id}` }],
      ['search_context', { query: 'Zephyrledger' }],
      ['read_item', { id: hidden.id }],
      ['read_item', { id: linking.id }],
    ]
    // Every tool and every old id that reads is swept.
    const reads = [
      ...toolNames.filter((name) => mcpTools[name].scope === 'read'),
      ...Object.keys(deprecatedToolAliases).filter(
        (old) =>
          mcpTools[deprecatedToolAliases[old as keyof typeof deprecatedToolAliases]].scope ===
          'read',
      ),
    ]
    expect(new Set(calls.map(([name]) => name))).toEqual(new Set(reads))
    for (const groups of claims) {
      const token = await new SignJWT({
        client_id: 'claude-code',
        scope: 'read feedback',
        ...(groups ? { groups } : {}),
      })
        .setProtectedHeader({ alg: 'EdDSA', typ: 'at+jwt' })
        .setIssuer(devIssuer)
        .setAudience(resource)
        .setIssuedAt()
        .setExpirationTime('1h')
        .sign(privateKey)
      const wire = new Client(
        { name: 'audience-sweep', version: '1.0.0' },
        { versionNegotiation: { mode: 'auto' } },
      )
      await wire.connect(
        new StreamableHTTPClientTransport(new URL(base + '/mcp'), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      )
      try {
        // Every tool this client may call; the others are refused before they read anything.
        const enabled = new Set((await wire.listTools()).tools.map((tool) => tool.name))
        expect(enabled.has('read_context')).toBe(true)
        for (const [name, args] of calls) {
          if (!enabled.has(name)) continue
          const reply = await wire.callTool({ name, arguments: args })
          const words = leaks(JSON.stringify(reply))
          if (words.length)
            found.push(`${groups?.join(',') ?? 'no groups'} ${name}: ${words.join(', ')}`)
        }
      } finally {
        await wire.close()
      }
    }
    expect(found).toEqual([])
  })

  it(
    'gives the assistant nothing of the hidden item, whoever asks',
    { timeout: 120_000 },
    async () => {
      const found: string[] = []
      const models = createModelPort({ mode: 'mock' })
      const inputs: [AssistantToolName, Record<string, unknown>][] = [
        ['get_facts', { question: 'Orders on holidays', metrics: ['Orders'] }],
        ['find_facts', { query: 'Vaultsunrise harbour Zephyrledger' }],
        ['read_item', { id: hidden.id }],
        ['read_item', { id: linking.id }],
        ['explain_item', { id: hidden.id, question: 'Orders on holidays', metrics: ['Orders'] }],
        ['improve_question', { question: 'harbour closure on holidays' }],
        ['check_draft', { draft_number: hiddenProposal }],
        ['find_overlaps', { draft_number: hiddenProposal }],
        ['estimate_impact', { question: 'Orders on holidays', draft_number: hiddenProposal }],
        ['domain_overview', { domain: 'Finance' }],
        ['what_changed', {}],
      ]
      for (const [reader, { name, reviews }] of Object.entries(readers)) {
        const id = members[name]
        const session: Session = {
          csrfToken: 'x',
          person: (await database.transaction(null, (tx) => principalFor(tx, id)))!,
        }
        for (const [tool, input] of inputs) {
          expect(tool in assistantTools).toBe(true)
          const parsed = z.parse(assistantTools[tool].inputSchema, input)
          const output = await runTool(tool, parsed, `call-${tool}`, {
            database,
            clock,
            models,
            session: () => Promise.resolve(session),
            evidence: new Evidence(),
            produced: new Map(),
            web: {
              read: () => Promise.reject(new Error('offline')),
              links: new Map(),
              pages: new Map(),
              searchesPerDay: 0,
              provider: null,
              calls: { reads: 0, searches: 0 },
            },
            help: repositoryHelp(),
          })
          // The tools that read a proposal by its id follow its row security, review exception
          // included: what the person may read anyway.
          if (reviews && 'draft_number' in input) continue
          const words = leaks(JSON.stringify(output))
          if (words.length) found.push(`${reader} ${tool}: ${words.join(', ')}`)
        }
      }
      expect(found).toEqual([])
    },
  )

  it('writes nothing of the hidden item from the command line', async () => {
    const heed = async (args: string[], who: string) => {
      const out: string[] = []
      const err: string[] = []
      const code = await run(args, {
        stdout: (text) => out.push(text),
        stderr: (text) => err.push(text),
        env: { HEED_URL: base, HEED_EMAIL: `${who}@example.test`, HEED_ORIGIN: origin },
      })
      return { code, text: out.join('') + err.join('') }
    }
    const exported = await heed(['export', liveLabel, '--json'], 'owner')
    expect(exported.code, exported.text).toBe(0)
    expect(leaks(scanned('editions.export', exported.text))).toEqual([])
    for (const who of ['auditor', 'admin']) {
      const audit = await heed(['audit', '--format', 'jsonl'], who)
      expect(audit.code, audit.text).toBe(0)
      expect(leaks(audit.text), who).toEqual([])
    }
  })
})
