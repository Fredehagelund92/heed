import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { run } from '../../src/cli/commands.ts'
import type { ItemImportReport } from '../../src/contract/index.ts'
import { DEFAULT_WEB_ORIGINS } from '../../src/contract/limits.ts'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import { canonicalJson } from '../../src/domain/canonical.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { type EditionExport, verifyEditionExport } from '../../src/domain/edition-export.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  S15 import and export over authenticated HTTP and through the `heed` command-line tool:
  a dry run changes nothing, an apply makes proposals only (all or none, in one batch), mentions
  are checked as on the write path, and an exported edition carries the digests it was sealed
  with, recomputes them from its content and reads back as an unchanged import.
*/

const { client, url } = testDatabase()
const app = buildApp({
  database: apiDatabase(url),
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
  // As configured by default: the command-line tool presents the first web origin.
  origins: ['http://localhost', ...DEFAULT_WEB_ORIGINS],
})

type Who = keyof typeof people
const headers: Partial<Record<Who, Record<string, string>>> = {}
const call = (
  method: 'GET' | 'POST',
  path: string,
  who: Who,
  payload?: object,
  key: string | null = randomUUID(),
) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], ...(key ? { 'idempotency-key': key } : {}) },
    ...(payload ? { payload } : {}),
  })
async function ok<T>(method: 'GET' | 'POST', path: string, who: Who, payload?: object) {
  const response = await call(method, path, who, payload)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<T>()
}
const importFile = (items: unknown, options: object = {}, who: Who = 'author') =>
  ok<ItemImportReport>('POST', '/imports', who, {
    content: typeof items === 'string' ? items : stringify(items),
    ...options,
  })
const count = async (table: string) =>
  Number((await client.query<{ n: string }>(`select count(*) as n from ${table}`)).rows[0]!.n)
/** One query at a time: a pg client runs its queries in order and warns about overlapping ones. */
async function counts(tables: string[]) {
  const result: number[] = []
  for (const table of tables) result.push(await count(table))
  return result
}
const liveSeq = async () =>
  (await client.query<{ seq: string }>('select seq from live_edition')).rows[0]!.seq

function item(extra: Draft & { id?: string } = {}): Draft & { id?: string } {
  return {
    title: 'Norway closure',
    summaryMarkup:
      'Online sales to @[Norway](val:market/norway) stopped; see @[Orders](metric:orders).',
    scope: {
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    },
    validity: { start: '2026-08-04', end: null },
    evidence: [
      { url: 'https://example.test/law', quote: 'Online sales stopped', date: '2026-08-04' },
    ],
    ...extra,
  }
}

/** The bootstrap vocabulary below has placeholder digests, which an export check names. */
const terms = ['dim:market', 'metric:orders', 'val:market/norway', 'val:market/spain']
let cliBase = ''
let folder = ''
async function heed(args: string[], who: Who | null = 'author') {
  const out: string[] = []
  const err: string[] = []
  const code = await run(args, {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: { HEED_URL: cliBase, ...(who ? { HEED_EMAIL: `${who}@example.test` } : {}) },
  })
  return { code, out: out.join(''), err: err.join('') }
}

beforeAll(async () => {
  await transaction(client, async () => {
    await foundation(client)
    await client.query(`insert into vocab_terms(key,kind,parent_key) values
      ('val:market/spain','dimension_value','dim:market')`)
    // The first edition is a bootstrap: its vocabulary needs no decision (0006).
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['dim:market', 'Market', null, null],
      ['val:market/norway', 'Norway', null, null],
      ['val:market/spain', 'Spain', null, null],
    ]) {
      const term = await client.query<{ id: string }>(
        `with v as (insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values($1,1,$2,$3,sha256(convert_to($1,'UTF8'))) returning id), r as (insert into vocab_term_refs (version_id,definition_ref) select id,$4 from v where $4::text is not null) select id from v`,
        [key, name, area, ref],
      )
      await client.query(
        "insert into vocab_term_service(term_key,version_id,editions) values($1,$2,int8range($3,null,'[)'))",
        [key, term.rows[0]!.id, seq],
      )
    }
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
  })
  for (const name of Object.keys(people) as Who[]) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/sign-in',
      headers: { origin: 'http://localhost', 'x-heed-csrf': 'dev-sign-in' },
      payload: { email: `${name}@example.test` },
    })
    expect(response.statusCode, response.body).toBe(200)
    headers[name] = {
      origin: 'http://localhost',
      cookie: response.cookies.map((c) => `${c.name}=${c.value}`).join('; '),
      'x-heed-csrf': response.json<{ csrfToken: string }>().csrfToken,
    }
  }
  cliBase = await app.listen({ host: '127.0.0.1', port: 0 })
  folder = await mkdtemp(join(tmpdir(), 'heed-cli-'))
})
afterAll(async () => {
  await app.close()
  await rm(folder, { recursive: true, force: true })
})

describe('import', () => {
  it('checks every entry in a dry run, mentions included, and changes nothing', async () => {
    const before = await counts(['proposals', 'import_batches', 'audit_log'])
    const report = await importFile([
      item(),
      item({ summaryMarkup: 'About @[Gone](metric:gone).' }),
      item({ summaryMarkup: 'Broken @[group](group:payments) mention' }),
      { ...item(), mentions: [] },
      item({ id: 'itm_target0001', title: 'Change of an item that is not accepted' }),
      item({ title: 'Password: hunter2 in a title' }),
      'not an item',
    ])
    expect(report.applied).toBe(false)
    expect(report.batchId).toBeNull()
    expect(
      report.entries.map((e) => [
        e.action,
        e.findings.filter((f) => f.severity === 'error').map((f) => f.code),
      ]),
    ).toEqual([
      ['create', []],
      ['create', ['mention_target']],
      // As on the write path: the item format and the mention check both refuse it.
      ['create', ['format', 'mention_syntax']],
      ['create', ['mention_rows']],
      ['change', ['unknown_item']],
      ['create', ['password_or_token']],
      ['create', ['format']],
    ])
    expect(report.entries[0]).toMatchObject({
      title: 'Norway closure',
      proposalId: null,
      findings: [],
    })
    expect(report.counts).toEqual({ create: 6, change: 1, unchanged: 0, errors: 6 })
    expect(await counts(['proposals', 'import_batches', 'audit_log'])).toEqual(before)
  })

  it('reports a file that is not an item file', async () => {
    expect((await importFile('{ not: [yaml')).error).toBe('The file is neither YAML nor JSON')
    expect((await importFile({ questions: [] })).error).toContain('Expected a list of items')
  })

  it('applies nothing while any entry has an error, and needs a retry key to apply', async () => {
    const before = await count('proposals')
    const refused = await importFile([item(), item({ summaryMarkup: '@[Gone](metric:gone)' })], {
      dryRun: false,
    })
    expect(refused).toMatchObject({ applied: false, batchId: null })
    expect(await count('proposals')).toBe(before)
    const withoutKey = await call(
      'POST',
      '/imports',
      'author',
      { content: stringify([item()]), dryRun: false },
      null,
    )
    expect(withoutKey.statusCode).toBe(400)
  })

  it('makes submitted proposals in one batch, accepts nothing, and records the import', async () => {
    const live = await liveSeq()
    const report = await importFile(
      [
        item(),
        item({
          title: 'Spain note',
          summary: 'Plain text, no mentions',
          summaryMarkup: undefined,
          scope: {
            metrics: ['metric:orders'],
            dimensions: [],
            dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
          },
        }),
      ],
      { dryRun: false, sourceName: 'lessons.yaml' },
    )
    expect(report).toMatchObject({ applied: true, counts: { create: 2, errors: 0 } })
    const proposals = await client.query<{
      id: string
      state: string
      channel: string
      import_batch_id: string
      proposer_id: string
      item_id: string
    }>(
      'select id,state,channel,import_batch_id,proposer_id,item_id from proposals where import_batch_id=$1 order by number',
      [report.batchId],
    )
    expect(proposals.rows.map((p) => [p.id, p.state, p.channel, p.proposer_id, p.item_id])).toEqual(
      report.entries.map((e) => [e.proposalId, 'submitted', 'import', people.author, e.itemId]),
    )
    // Proposals only: the live edition and what it serves did not move.
    expect(await liveSeq()).toBe(live)
    const mentions = await client.query<{ term_key: string }>(
      `select m.term_key from item_version_mentions m join proposals p on p.item_version_id=m.version_id
       where p.id=$1 order by m.position`,
      [report.entries[0]!.proposalId],
    )
    expect(mentions.rows.map((r) => r.term_key)).toEqual(['val:market/norway', 'metric:orders'])
    const batch = await client.query(
      'select created_by,mode,source_name,summary from import_batches where id=$1',
      [report.batchId],
    )
    expect(batch.rows[0]).toEqual({
      created_by: people.author,
      mode: 'apply',
      source_name: 'lessons.yaml',
      summary: { create: 2, change: 0, unchanged: 0, errors: 0, submitted: true },
    })
    const audit = await client.query(
      "select actor_id,subject_id from audit_log where action='import.applied'",
    )
    expect(audit.rows).toEqual([{ actor_id: people.author, subject_id: report.batchId }])
  })

  // 501 entries checked and 500 proposals written in one transaction: generous on a busy machine.
  it(
    'makes at most 500 proposals in one import, and says so in the dry run',
    { timeout: 120_000 },
    async () => {
      const before = await count('proposals')
      const many = Array.from({ length: 501 }, (_, n) => item({ title: `Lesson ${n}` }))
      const dry = await importFile(many)
      expect(dry.error).toContain('at most 500 proposals; this file would make 501')
      expect(dry.counts).toMatchObject({ create: 501, errors: 0 })
      expect(await importFile(many, { dryRun: false })).toMatchObject({ applied: false })
      expect(await count('proposals')).toBe(before)
    },
  )

  it('keeps drafts when asked', async () => {
    const report = await importFile([item({ title: 'Kept as a draft' })], {
      dryRun: false,
      submit: false,
    })
    expect(report.entries[0]).toMatchObject({ action: 'create', itemId: null })
    const [proposal] = (
      await client.query<{ state: string }>('select state from proposals where id=$1', [
        report.entries[0]!.proposalId,
      ])
    ).rows
    expect(proposal!.state).toBe('draft')
  })
})

describe('edition export', () => {
  let document: EditionExport
  let itemId = ''
  beforeAll(async () => {
    const [created] = (await importFile([item({ title: 'Exported note' })], { dryRun: false }))
      .entries
    itemId = created!.itemId!
    const review = await ok<{ proposal: { revision: number } }>(
      'GET',
      `/review/${created!.proposalId}/sheet`,
      'owner',
    )
    await ok('POST', `/review/${created!.proposalId}/publish`, 'owner', {
      revision: review.proposal.revision,
    })
    const editions = await ok<{ label: string; live: boolean }[]>('GET', '/editions', 'owner')
    document = await ok<EditionExport>(
      'GET',
      `/editions/${editions.find((e) => e.live)!.label}/export`,
      'owner',
    )
  })

  it('carries the sealed digest, mentions included, and every digest recomputes', async () => {
    const [stored] = (
      await client.query<{ digest: string }>(
        "select encode(digest,'hex') as digest from editions where seq=(select seq from live_edition)",
      )
    ).rows
    expect(document.digest).toBe(stored!.digest)
    expect(document.items.map((i) => i.id)).toEqual([itemId])
    expect(document.items[0]).toMatchObject({
      version: 1,
      title: 'Exported note',
      createdVia: 'import',
      summaryMarkup: item().summaryMarkup,
      mentions: [
        { field: 'summary', position: 0, target: 'val:market/norway', label: 'Norway' },
        { field: 'summary', position: 1, target: 'metric:orders', label: 'Orders' },
      ],
    })
    // Domains have no state any more; only editions sealed before that carry one.
    expect(document.areas).toEqual([])
    expect(document.withheld).toEqual([])
    // The test vocabulary's digests are placeholders; items are written by the real write path.
    expect(await verifyEditionExport(document)).toEqual({
      edition: true,
      items: [],
      vocabulary: terms,
    })
    expect(canonicalJson(JSON.parse(canonicalJson(document)))).toBe(canonicalJson(document))
  })

  it('reads back as an import: unchanged as exported, a change when edited', async () => {
    expect(
      (await importFile(document)).entries.map((e) => [e.itemId, e.action, e.findings]),
    ).toEqual([[itemId, 'unchanged', []]])
    const edited = structuredClone(document)
    edited.items[0]!.summaryMarkup =
      'Online sales to @[Norway](val:market/norway) stopped in August.'
    edited.items[0]!.summary = 'Online sales to Norway stopped in August.'
    edited.items[0]!.mentions = [edited.items[0]!.mentions[0]!]
    const report = await importFile(edited)
    expect(report.entries.map((e) => [e.action, e.findings])).toEqual([['change', []]])
    edited.items[0]!.mentions = []
    expect((await importFile(edited)).entries[0]!.findings.map((f) => f.code)).toEqual([
      'mention_rows',
    ])
  })

  it('answers an unknown edition with not found, and serves the item schema without sign-in', async () => {
    expect((await call('GET', '/editions/2001-01-01.1/export', 'owner')).statusCode).toBe(404)
    const schema = await app.inject({ method: 'GET', url: '/api/v1/schema/item' })
    expect(schema.statusCode).toBe(200)
    const body = schema.json<{ title: string; properties: Record<string, unknown> }>()
    expect(body.title).toBe('Heed item')
    expect(Object.keys(body.properties)).toEqual(
      expect.arrayContaining(['summaryMarkup', 'bodyMarkup', 'mentions', 'scope']),
    )
  })
})

describe('heed, the command-line tool', () => {
  it('validates and prints the schema with no service', async () => {
    const good = join(folder, 'good.yaml')
    await writeFile(good, stringify([item()]))
    const bad = join(folder, 'bad.json')
    await writeFile(
      bad,
      JSON.stringify({ items: [item({ summaryMarkup: 'Broken @[x](group:y)' })] }),
    )
    expect(await heed(['validate', good], null)).toMatchObject({
      code: 0,
      out: expect.stringContaining('1 items, 0 with errors') as string,
    })
    const failed = await heed(['validate', bad, '--json'], null)
    expect(failed.code).toBe(1)
    expect(JSON.parse(failed.out)).toMatchObject({ failed: 1 })
    const schema = await heed(['schema'], null)
    expect(JSON.parse(schema.out)).toHaveProperty('properties.mentions')
    expect((await heed(['nonsense'], null)).code).toBe(2)
    const missing = await heed(['validate', join(folder, 'missing.yaml')], null)
    expect(missing).toMatchObject({ code: 2, err: expect.stringContaining('ENOENT') as string })
    expect((await heed([], null)).code).toBe(2)
    expect((await heed(['--help'], null)).out).toContain('Usage: heed')
  })

  it('imports with a dry run first, then applies, as the signed-in person', async () => {
    const file = join(folder, 'items.yaml')
    await writeFile(file, stringify({ items: [item({ title: 'From the command line' })] }))
    expect((await heed(['import', file], null)).code).toBe(2)
    const before = await count('proposals')
    const dry = await heed(['import', file])
    expect(dry).toMatchObject({ code: 0, out: expect.stringContaining('Dry run: 1 new') as string })
    expect(await count('proposals')).toBe(before)
    const applied = await heed(['import', file, '--apply', '--drafts', '--json'])
    expect(applied.code, applied.err).toBe(0)
    const report = JSON.parse(applied.out) as ItemImportReport
    expect(report).toMatchObject({ applied: true, counts: { create: 1 } })
    const [row] = (
      await client.query<{ state: string; channel: string; source_name: string }>(
        'select p.state,p.channel,b.source_name from proposals p join import_batches b on b.id=p.import_batch_id where p.id=$1',
        [report.entries[0]!.proposalId],
      )
    ).rows
    expect(row).toEqual({ state: 'draft', channel: 'import', source_name: 'items.yaml' })
    const refused = await heed(['import', join(folder, 'bad.json')])
    expect(refused.code).toBe(1)
    expect(refused.out).toContain('mention_syntax')
  })

  it('saves one draft through the command-line channel and submits it on request', async () => {
    const file = join(folder, 'draft.json')
    await writeFile(file, JSON.stringify(item({ title: 'Drafted by an agent' })))
    // A bare item, not a list, is not a file of items.
    expect((await heed(['draft', file])).code).toBe(2)
    await writeFile(file, JSON.stringify([item({ title: 'Drafted by an agent' })]))
    const drafted = await heed(['draft', file, '--submit', '--json'])
    expect(drafted.code, drafted.err).toBe(0)
    const proposal = JSON.parse(drafted.out) as ProposalRecord
    expect(proposal).toMatchObject({ channel: 'command_line', state: 'submitted' })
  })

  it('exports the live edition, verifies it offline, and exports the history log', async () => {
    const out = join(folder, 'edition.json')
    // Editions are for owners, deputies and administrators (Quality design G13).
    const contributor = await heed(['export', '--out', out])
    expect(contributor.code).toBe(1)
    expect(contributor.err).toContain('Editions are for owners, deputies and administrators.')
    const exported = await heed(['export', '--out', out], 'owner')
    expect(exported.code, exported.err).toBe(0)
    const text = await readFile(out, 'utf8')
    const document = JSON.parse(text) as EditionExport
    expect(text).toBe(canonicalJson(document) + '\n')
    expect(document.items).toHaveLength(1)
    // The test vocabulary's digests are placeholders, so verify reports exactly those.
    const verified = await heed(['verify', out, '--json'], null)
    expect(verified.code).toBe(1)
    expect(JSON.parse(verified.out)).toEqual({ edition: true, items: [], vocabulary: terms })

    const refused = await heed(['audit'])
    expect(refused.code).toBe(1)
    expect(refused.err).toContain('administrators and auditors')
    const audit = await heed(['audit', '--format', 'csv', '--action', 'import'], 'admin')
    expect(audit.code, audit.err).toBe(0)
    const lines = audit.out.trimEnd().split('\r\n')
    expect(lines[0]).toMatch(/^seq,at,actorId/)
    expect(lines.slice(1).every((line) => line.includes('"import.applied"'))).toBe(true)
    expect(lines.length).toBeGreaterThan(2)
  })

  it('says who may sign in, and refuses a change from an origin the service does not allow', async () => {
    expect((await heed(['export'], null)).code).toBe(2)
    const unknown: string[] = []
    const code = await run(['export', '--as', 'nobody@example.test'], {
      stdout: () => {},
      stderr: (text) => unknown.push(text),
      env: { HEED_URL: cliBase },
    })
    expect(code).toBe(1)
    expect(unknown.join('')).toContain('dev people file')
    const file = join(folder, 'origin.yaml')
    await writeFile(file, stringify([item()]))
    const elsewhere = await heed(['import', file, '--origin', 'https://elsewhere.example'])
    expect(elsewhere.code).toBe(1)
    expect(elsewhere.err).toContain("We can't take changes from this address.")
  })

  it('says when the service cannot be reached', async () => {
    const result = await run(['export'], {
      stdout: () => {},
      stderr: (text) => expect(text).toContain('Cannot reach the service'),
      env: { HEED_URL: 'http://127.0.0.1:9', HEED_EMAIL: 'author@example.test' },
    })
    expect(result).toBe(1)
  })
})
