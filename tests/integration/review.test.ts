import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Edition, ReviewProposal } from '../../src/contract/review.ts'
import type { ItemPage } from '../../src/contract/context.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { workEvaluations } from '../../src/server/modules/evals/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createProposalsService } from '../../src/server/modules/proposals/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  S8 end to end over authenticated HTTP: a contributor proposes, an owner decides in the web app's
  review (publish or return), an edition is published and the serving pool (context_layer_serve)
  answers differently; rollback restores it.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const app = buildApp({
  database,
  logger: createLogger({ level: 'silent' }),
  jobs: idleJobs(),
  clock: systemClock('2026-10-08'),
  devPeople: Object.keys(people).map((name) => ({
    name,
    email: `${name}@example.test`,
    roles: [],
  })),
})
const servePool = new pg.Pool({
  connectionString: url,
  options: '-c role=context_layer_serve',
  types: {
    getTypeParser(oid, format): (value: string) => unknown {
      return oid === pg.types.builtins.DATE
        ? (value) => value
        : (pg.types.getTypeParser(oid, format) as (value: string) => unknown)
    },
  },
})
const refuse = (): Promise<never> => Promise.reject(new Error('not recorded in this test'))
const execute = createToolService(
  createEditionSource(servePool),
  { write: refuse, reportGap: refuse, feedback: refuse },
  () => new Date('2026-10-08T12:00:00Z'),
)
type Delivery = {
  status: string
  edition: string
  items: { id: string; links: { rel: string; target: { id: string; label: string } }[] }[]
}
const norway = {
  question: '',
  metrics: ['metric:orders'],
  dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
  window: { from: '2026-08-10', to: '2026-08-20' },
}
async function ask(input: object = norway) {
  const result = await execute(
    'get_facts',
    input,
    { client: 'claude-code', scopes: ['read'], caller: 'agent', canSelectEdition: false },
    100000,
    () => {},
  )
  return result.structuredContent as Delivery
}
const delivered = async (input?: object) => (await ask(input)).items.map((i) => i.id)

type Headers = { cookie: string; origin: string; 'x-heed-csrf': string }
const headers: Record<string, Headers> = {}
type Who = keyof typeof people
const call = (method: 'GET' | 'POST' | 'PUT', path: string, who: Who, payload?: object) =>
  app.inject({
    method,
    url: '/api/v1' + path,
    headers: { ...headers[who], 'idempotency-key': randomUUID() },
    ...(payload ? { payload } : {}),
  })

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    await client.query(`insert into vocab_terms(key,kind,parent_key) values
      ('val:market/spain','dimension_value','dim:market'),('metric:revenue','metric',null)`)
    // The first edition is a bootstrap: its vocabulary needs no decision (0006).
    const [{ seq }] = (
      await client.query<{ seq: string }>("select edition_open('bootstrap',null) as seq")
    ).rows as [{ seq: string }]
    for (const [key, name, area, ref] of [
      ['metric:orders', 'Orders', 'finance', 'demo:orders'],
      ['metric:revenue', 'Revenue', 'finance', null],
      ['group:payments', 'Payments', null, null],
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
  for (const name of Object.keys(people)) {
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
  // A high-risk change needs the full test set of its area to pass (FR-513): one question that
  // no item in these tests touches.
  await testQuestion(
    'finance-revenue-spain',
    [
      { text: 'How did revenue develop in Spain in July 2026?', kind: 'natural' },
      { text: 'Revenue in Spain from 2026-07-01 to 2026-07-31', kind: 'precise' },
    ],
    {
      metrics: ['metric:revenue'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
      window: { from: '2026-07-01', to: '2026-07-31' },
    },
    { status: 'no_match' },
  )
})

/** A finance test question, as an owner keeps one, stored as the evaluation runner reads it. */
async function testQuestion(id: string, wordings: object[], scope: object, expected: object) {
  await client.query(
    `insert into golden_questions (id,area_id,wordings,scope,expected,source,split,status)
     values ($1,'finance',$2,$3,$4,'Review tests','development','active')`,
    [id, JSON.stringify(wordings), JSON.stringify(scope), JSON.stringify(expected)],
  )
}
afterAll(async () => {
  await app.close()
  await servePool.end()
})

function draft(extra: Draft = {}): Draft {
  return {
    areaId: 'finance',
    title: 'Norway closure',
    summary: 'Online sales to Norway stopped',
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
async function submitted(extra: Draft = {}, who: Who = 'author', itemId?: string) {
  const created = await call('POST', '/proposals', who, {
    draft: draft(extra),
    ...(itemId ? { itemId } : {}),
  })
  expect(created.statusCode, created.body).toBe(200)
  const p = created.json<ProposalRecord>()
  const response = await call('POST', `/proposals/${p.id}/submit`, who, { revision: p.revision })
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ProposalRecord>()
}
/** The review of a suggestion, as the web app reads it; 404 for anyone who may not read it. */
async function sheet(id: string, who: Who = 'owner') {
  const response = await call('GET', `/review/${id}/sheet`, who)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<{ proposal: ReviewProposal }>()
}
/** The newest outcome of each required check level of a version, as the gate reads them. */
async function levels(versionId: string) {
  return (
    await client.query<{ level: string; outcome: string; details: Record<string, unknown> }>(
      `select distinct on (c.level) c.level::text, c.outcome::text, c.details
         from check_results c where c.item_version_id = $1 order by c.level, c.ran_at desc, c.id desc`,
      [versionId],
    )
  ).rows.sort(
    (a, b) =>
      ['format', 'matching', 'delivery'].indexOf(a.level) -
      ['format', 'matching', 'delivery'].indexOf(b.level),
  )
}
/** The decisions on a proposal, oldest first. */
async function decisions(id: string) {
  return (
    await client.query<{ id: string; outcome: string; capacity: string; reason: string }>(
      `select id::text, outcome::text, capacity::text, reason from decisions
        where proposal_id = $1 order by decided_at, id`,
      [id],
    )
  ).rows
}
const revisionOf = async (id: string) =>
  (await client.query<{ revision: number }>('select revision from proposals where id=$1', [id]))
    .rows[0]!.revision
type Decided = { proposal: ReviewProposal; edition: Edition | null }
/**
 * Publish, or return with a note, as the review's buttons do. A publish says first that the
 * suggestion is unrelated to each live item it clashes with (FR-225), as the reviewer would.
 */
async function decide(id: string, outcome: 'accept' | 'request_changes', who: Who = 'owner') {
  const revision = await revisionOf(id)
  if (outcome === 'request_changes')
    return call('POST', `/review/${id}/return`, who, {
      revision,
      note: 'Reviewed against the evidence',
    })
  const read = await call('GET', `/review/${id}/sheet`, 'admin')
  const clashes =
    read.statusCode === 200
      ? read.json<{ clashes: { itemId: string; relation: string | null }[] }>().clashes
      : []
  const relations = clashes
    .filter((clash) => clash.relation === null)
    .map((clash) => ({ itemId: clash.itemId, relation: 'unrelated' }))
  return call('POST', `/review/${id}/publish`, who, {
    revision,
    ...(relations.length ? { relations } : {}),
  })
}
/**
 * Mark as checked, as the Context list does it, after opening the item (checking it means reading
 * it): whether it was done, and the live edition's reason.
 */
async function recheck(item: string, who: Who = 'owner') {
  await call('POST', `/items/${item}/read`, who, {})
  const response = await call('POST', '/items/bulk', who, { action: 'check', rows: [item] })
  expect(response.statusCode, response.body).toBe(200)
  const [live] = (
    await client.query<{ reason: string }>(
      'select e.reason::text from editions e join live_edition l on l.seq=e.seq',
    )
  ).rows
  return { done: response.json<{ done: string[] }>().done.includes(item), edition: live!.reason }
}
/** The live item as its page in Heed reads it. */
const page = async (item: string, who: Who = 'author') => {
  const response = await call('GET', `/items/${item}/page`, who)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<ItemPage>().item
}
/** A low-risk note, accepted and live. */
async function acceptedItem(extra: Draft = {}, who: Who = 'author') {
  const p = await submitted(extra, who)
  const response = await decide(p.id, 'accept')
  expect(response.statusCode, response.body).toBe(200)
  return p.itemId!
}
/** The evaluation runner's job, with the scripted mock model: records levels 4 and 5. */
async function runAnswerTests() {
  return workEvaluations(
    database,
    { port: createModelPort({ mode: 'mock' }), clock: systemClock('2026-10-08') },
    {
      deadline: Date.now() + 20_000,
      signal: new AbortController().signal,
      logger: createLogger({ level: 'silent' }),
    },
  )
}
const servedVersion = async (item: string) =>
  (
    await client.query<{ no: number }>(
      `select v.version_no as no from item_version_service s join item_versions v on v.id=s.version_id
        where v.item_id=$1 and s.editions @> (select seq from live_edition)`,
      [item],
    )
  ).rows[0]?.no
const flagged = async (item: string) =>
  (
    await client.query(
      "select 1 from v_overlay_on where item_id=$1 and kind='flag_on' and flag='needs_check'",
      [item],
    )
  ).rowCount === 1
const liveLabel = async () =>
  (
    await client.query<{ label: string }>(
      'select e.label from editions e join live_edition l on l.seq=e.seq',
    )
  ).rows[0]!.label

describe('review and release', () => {
  it('publishes an accepted proposal so the agent answer changes, and rollback restores it', async () => {
    const before = await liveLabel()
    expect(await delivered()).toEqual([])
    const p = await submitted()
    const screen = await sheet(p.id)
    expect(screen.proposal).toMatchObject({ state: 'submitted', riskLevel: 'low', subject: 'item' })
    expect((await levels(p.itemVersionId!)).map((l) => [l.level, l.outcome])).toEqual([
      ['format', 'passed'],
      ['matching', 'passed'],
      ['delivery', 'passed'],
    ])
    expect((await call('GET', `/review/${p.id}/sheet`, 'stranger')).statusCode).toBe(404)
    expect(await delivered()).toEqual([])

    const accepted = await decide(p.id, 'accept')
    expect(accepted.statusCode, accepted.body).toBe(200)
    const result = accepted.json<Decided>()
    expect(result.proposal).toMatchObject({ state: 'accepted' })
    expect(result.edition).toMatchObject({ reason: 'proposal_accepted', live: true })
    expect(result.edition!.digest).toMatch(/^[0-9a-f]{64}$/)
    const answer = await ask()
    expect(answer.items.map((i) => i.id)).toEqual([p.itemId])
    expect(answer.edition).toBe(result.edition!.label)

    const editions = (await call('GET', '/editions', 'owner')).json<Edition[]>()
    expect(editions[0]).toMatchObject({ label: result.edition!.label, live: true })

    expect(
      (await call('POST', `/editions/${before}/rollback`, 'owner', { note: 'Undo' })).statusCode,
    ).toBe(403)
    const rolled = await call('POST', `/editions/${before}/rollback`, 'admin', {
      note: 'Back to the bootstrap content',
    })
    expect(rolled.statusCode, rolled.body).toBe(200)
    const restored = rolled.json<Edition>()
    expect(restored).toMatchObject({ reason: 'rollback', restores: before, live: true })
    expect(restored.digest).toBe(editions.find((e) => e.label === before)!.digest)
    expect(await delivered()).toEqual([])
    const audit = await client.query<{ action: string }>(
      "select action from audit_log where action in ('decision.accept','edition.published','edition.rollback') order by seq",
    )
    expect(audit.rows.map((r) => r.action)).toEqual([
      'edition.published',
      'decision.accept',
      'edition.rollback',
    ])
    expect((await client.query('select * from audit_verify()')).rows).toEqual([])
  })

  it('publishes on one accept once levels 1 to 3 pass, at every risk, with no approver (FR-513)', async () => {
    const event = await submitted({ kind: 'event', title: 'Norway event' })
    expect((await levels(event.itemVersionId!)).map((l) => l.level)).toEqual([
      'format',
      'matching',
      'delivery',
    ])
    const normal = await decide(event.id, 'accept')
    expect(normal.statusCode, normal.body).toBe(200)
    expect(normal.json<Decided>().edition).toMatchObject({ reason: 'proposal_accepted' })

    const high = await submitted({ title: 'Legal closure', riskLevel: 'high' })
    expect((await levels(high.itemVersionId!)).map((l) => l.level)).toEqual([
      'format',
      'matching',
      'delivery',
    ])
    // No answer test is queued for it, now or by the job.
    await runAnswerTests()
    const runs = await client.query('select 1 from eval_runs where item_version_id=$1', [
      high.itemVersionId,
    ])
    expect(runs.rowCount).toBe(0)
    // An approver no longer decides.
    expect((await decide(high.id, 'accept', 'approver')).statusCode).toBe(403)
    const accepted = await decide(high.id, 'accept')
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<Decided>()).toMatchObject({
      proposal: { state: 'accepted' },
      edition: { reason: 'proposal_accepted' },
    })
    expect(await delivered()).toContain(high.itemId)
    expect((await decisions(high.id)).map((d) => d.capacity)).toEqual(['owner'])
  })

  it('accepts a version whose format check found warnings only (FR-505, FR-209)', async () => {
    // "Any value" of a dimension is broad: the reviewer is told, and it never blocks.
    const broad = await submitted({
      title: 'Orders in every market',
      scope: { metrics: ['metric:orders'], dimensions: ['dim:market'], dimensionValues: [] },
    })
    expect(broad.findings).toEqual([
      expect.objectContaining({ code: 'broad_scope', severity: 'warning' }),
    ])
    expect((await levels(broad.itemVersionId!)).find((l) => l.level === 'format')).toMatchObject({
      outcome: 'passed',
      details: { findings: [expect.objectContaining({ code: 'broad_scope' })] },
    })
    expect((await decide(broad.id, 'accept')).statusCode).toBe(200)

    // A metric Cube puts in another domain than its own warns, and never blocks either.
    await client.query("update definitions set area_hint='marketing' where ref='demo:orders'")
    try {
      const elsewhere = await submitted({ title: 'Orders counted by Marketing' })
      expect(elsewhere.findings.map((f) => [f.code, f.severity, f.message])).toEqual([
        ['domain_mismatch', 'warning', 'Cube puts Orders in Marketing'],
      ])
      const accepted = await decide(elsewhere.id, 'accept')
      expect(accepted.statusCode, accepted.body).toBe(200)
      expect(accepted.json<Decided>().proposal.state).toBe('accepted')
    } finally {
      await client.query("update definitions set area_hint=null where ref='demo:orders'")
    }
  })

  it('fails level 3 when a change stops delivering an item a test question expects', async () => {
    const item = await acceptedItem({ title: 'Norway orders note' })
    await testQuestion(
      'norway-level-three',
      [
        { text: 'What happened to orders in Norway in August 2026?', kind: 'natural' },
        { text: 'Orders in Norway from 2026-08-01 to 2026-08-31', kind: 'precise' },
      ],
      {
        metrics: ['metric:orders'],
        dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
        window: { from: '2026-08-01', to: '2026-08-31' },
      },
      { must_deliver: [item] },
    )
    try {
      const moved = await submitted(
        {
          title: 'Norway orders note',
          scope: {
            metrics: ['metric:orders'],
            dimensions: [],
            dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
          },
        },
        'author',
        item,
      )
      const delivery = (await levels(moved.itemVersionId!)).find((l) => l.level === 'delivery')
      expect(delivery).toMatchObject({ outcome: 'failed' })
      expect(delivery!.details.questions).toContainEqual({
        id: 'norway-level-three',
        baseline: true,
        candidate: false,
        regression: true,
      })
      expect((await decide(moved.id, 'accept')).statusCode).toBe(422)
    } finally {
      await client.query(
        "update golden_questions set status='retired' where id='norway-level-three'",
      )
    }
  })

  it('lets the owner and an administrator decide their own, and refuses everyone else (FR-206)', async () => {
    // The owner accepts their own normal-risk event; the timeline and the history log say so.
    const own = await submitted({ kind: 'event', title: 'Owner event' }, 'owner')
    const self = await decide(own.id, 'accept')
    expect(self.statusCode, self.body).toBe(200)
    expect(self.json<Decided>().edition).toMatchObject({ reason: 'proposal_accepted' })
    const marked = { capacity: 'owner', byProposer: true }
    const event = await client.query<{ data: object }>(
      "select data from proposal_events where proposal_id=$1 and kind='decided'",
      [own.id],
    )
    expect(event.rows[0]?.data).toMatchObject(marked)
    const logged = await client.query<{ details: object }>(
      "select details from audit_log where subject_id=$1 and action='decision.accept'",
      [own.id],
    )
    expect(logged.rows[0]?.details).toMatchObject(marked)

    // An administrator with no role in Finance accepts their own, as administrator, and decides
    // anyone else's too.
    const admins = await submitted({ kind: 'event', title: 'Administrator event' }, 'admin')
    const byAdmin = await decide(admins.id, 'accept', 'admin')
    expect(byAdmin.statusCode, byAdmin.body).toBe(200)
    expect(await decisions(admins.id)).toEqual([
      expect.objectContaining({ capacity: 'administrator', outcome: 'accept' }),
    ])
    const others = await submitted({ kind: 'guide', title: 'Guide for the administrator' })
    expect((await decide(others.id, 'request_changes', 'admin')).statusCode).toBe(200)

    // A contributor and an approver who is neither never decide, their own neither.
    const normal = await submitted({ kind: 'guide', title: 'Normal guide' })
    expect((await decide(normal.id, 'accept', 'approver')).statusCode).toBe(403)
    expect((await decide(normal.id, 'accept', 'author')).statusCode).toBe(403)
    expect((await decide(normal.id, 'accept', 'stranger')).statusCode).toBe(404)
    const stale = await call('POST', `/review/${normal.id}/publish`, 'owner', { revision: 1 })
    expect(stale.statusCode).toBe(409)
    for (const note of ['Ask @[Orders](metric:orders)', 'Mail jon@example.test'])
      expect(
        (
          await call('POST', `/review/${normal.id}/return`, 'owner', {
            revision: await revisionOf(normal.id),
            note,
          })
        ).statusCode,
      ).toBe(422)
  })

  it('asks for changes, takes the resubmitted version and publishes it', async () => {
    const p = await submitted({ title: 'Needs work' })
    const changes = await decide(p.id, 'request_changes')
    expect(changes.statusCode, changes.body).toBe(200)
    expect(changes.json<Decided>()).toMatchObject({ proposal: { state: 'changes_requested' } })
    // The author sends it again with the change, from the editor.
    const record = (await call('GET', `/proposals/${p.id}`, 'author')).json<ProposalRecord>()
    expect(record.state).toBe('changes_requested')
    const resent = await database.transaction(people.author, (tx) =>
      createProposalsService(tx, systemClock('2026-10-08'), people.author).save(
        p.id,
        record.revision,
        { ...record.draft, title: 'Better' },
      ),
    )
    const resubmitted = await call('POST', `/proposals/${p.id}/submit`, 'author', {
      revision: resent.revision,
    })
    expect(resubmitted.statusCode, resubmitted.body).toBe(200)
    const again = resubmitted.json<ProposalRecord>()
    expect((await levels(again.itemVersionId!)).every((l) => l.outcome === 'passed')).toBe(true)
    const published = await decide(p.id, 'accept')
    expect(published.statusCode, published.body).toBe(200)
    expect(published.json<Decided>().proposal).toMatchObject({ state: 'accepted' })
    expect((await decisions(p.id)).map((d) => d.outcome)).toEqual(['request_changes', 'accept'])
    expect((await decide(p.id, 'accept')).statusCode).toBe(409)
  })

  it('retires at once or by proposal, and closes replaced items in the same edition', async () => {
    const proposed = await acceptedItem({ title: 'To retire by proposal' })
    const asked = await call('POST', `/items/${proposed}/retire-proposals`, 'author', {
      reason: 'The closure ended',
    })
    expect(asked.statusCode, asked.body).toBe(200)
    const retirement = asked.json<ReviewProposal>()
    expect(retirement).toMatchObject({ action: 'retire', state: 'submitted' })
    expect(
      (
        await call('POST', `/items/${proposed}/retire-proposals`, 'stranger', {
          reason: 'Again',
        })
      ).statusCode,
    ).toBe(409)
    const accepted = await decide(retirement.id, 'accept')
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<Decided>().edition).toMatchObject({ reason: 'item_retired' })
    expect(await delivered()).not.toContain(proposed)

    // Archive, from the Context list: an owner or an admin, at once.
    const direct = await acceptedItem({ title: 'To retire at once' })
    const refused = await call('POST', '/items/bulk', 'author', {
      action: 'archive',
      rows: [direct],
    })
    expect(refused.json<{ done: string[]; skipped: { code: string }[] }>()).toMatchObject({
      done: [],
      skipped: [{ code: 'not_allowed' }],
    })
    const retired = await call('POST', '/items/bulk', 'admin', {
      action: 'archive',
      rows: [direct],
    })
    expect(retired.statusCode, retired.body).toBe(200)
    expect(retired.json<{ done: string[] }>().done).toEqual([direct])
    expect(await delivered()).not.toContain(direct)

    const old = await acceptedItem({ title: 'Old caveat' })
    const pointer = await acceptedItem({
      title: 'Points at the old caveat',
      summaryMarkup: `Read @[the old caveat](item:${old}) first`,
    })
    const replacement = await submitted({ title: 'New caveat', replaces: [old] })
    const replaced = await decide(replacement.id, 'accept')
    expect(replaced.statusCode, replaced.body).toBe(200)
    // One edition serves the new caveat and closes the old one.
    const edition = replaced.json<Decided>().edition!
    const served = await client.query<{ item_id: string; upper: string | null }>(
      `select v.item_id, upper(s.editions)::text as upper from item_version_service s
         join item_versions v on v.id = s.version_id where v.item_id = any($1)`,
      [[old, replacement.itemId]],
    )
    const seq = (
      await client.query<{ seq: string }>('select seq::text from editions where label=$1', [
        edition.label,
      ])
    ).rows[0]!.seq
    expect(served.rows.find((r) => r.item_id === old)?.upper).toBe(seq)
    expect(served.rows.find((r) => r.item_id === replacement.itemId)?.upper).toBeNull()
    const shown = await delivered()
    expect(shown).toContain(replacement.itemId)
    expect(shown).not.toContain(old)
    const link = (await ask()).items
      .find((i) => i.id === pointer)!
      .links.find((l) => l.rel === 'mentions')
    expect(link?.target).toMatchObject({
      id: old,
      label: 'the old caveat',
      status: 'replaced',
      replaced_by: replacement.itemId,
    })
  })

  it('records "checked, still correct" with the current change marks and clears the flag', async () => {
    const item = await acceptedItem({ title: 'Flagged note' })
    await client.query("update definitions set change_mark='2' where ref='demo:orders'")
    try {
      await client.query(
        "insert into overlay_events(kind,scope,item_id,flag,reason) values('flag_on','item',$1,'needs_check','Definition changed')",
        [item],
      )
      const flaggedItem = (await ask()).items.find((i) => i.id === item)
      expect(flaggedItem).toMatchObject({
        freshness: 'unverified',
        unverified_reason: 'needs_check',
      })
      expect((await recheck(item, 'author')).done).toBe(false)
      expect(await recheck(item)).toEqual({ done: true, edition: 'source_rechecked' })
      const versions = await client.query<{ is_recheck: boolean; marks: string[] }>(
        `select v.is_recheck,array(select change_mark from item_version_refs r where r.version_id=v.id) as marks
           from item_versions v where item_id=$1 order by version_no`,
        [item],
      )
      expect(versions.rows).toEqual([
        { is_recheck: false, marks: ['1'] },
        { is_recheck: true, marks: ['2'] },
      ])
      expect((await ask()).items.find((i) => i.id === item)).toMatchObject({
        freshness: 'verified',
        version: 2,
      })
      // Who checked it, and when, is what people read: a check with nothing new is recorded too.
      expect((await recheck(item)).done).toBe(true)
      expect(await servedVersion(item)).toBe(3)
    } finally {
      await client.query("update definitions set change_mark='1' where ref='demo:orders'")
    }
  })

  it('moves on the review date an item with an end date was given, so its check is no longer due', async () => {
    const item = await acceptedItem({
      title: 'Ended event with a check date',
      kind: 'event',
      validity: { start: '2026-04-18', end: '2026-05-31' },
      reviewDate: '2026-09-18',
    })
    const reviewDate = async () =>
      (
        await client.query<{ review_date: string | null }>(
          `select v.review_date::text from item_versions v where v.item_id=$1
            order by v.version_no desc limit 1`,
          [item],
        )
      ).rows[0]!.review_date
    expect(await reviewDate()).toBe('2026-09-18')
    expect((await recheck(item)).done).toBe(true)
    expect(await reviewDate()).toBe('2027-01-06')
  })

  it('lets an administrator publish their own high-risk proposal on one accept', async () => {
    const high = await submitted(
      { title: 'Administrator high-risk note', riskLevel: 'high' },
      'admin',
    )
    const accepted = await decide(high.id, 'accept', 'admin')
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<Decided>()).toMatchObject({
      proposal: { state: 'accepted' },
      edition: { reason: 'proposal_accepted' },
    })
    expect(await delivered()).toContain(high.itemId)
    expect((await decisions(high.id)).map((d) => d.capacity)).toEqual(['administrator'])
  })

  it('publishes an accept that waited for an approver before migration 0005 when its owner accepts again', async () => {
    const high = await submitted({ title: 'Waited for the approver', riskLevel: 'high' })
    // As a database before 0005 left it: the owner's accept given, the version still waiting.
    await client.query(
      `insert into decisions (proposal_id,item_version_id,area_id,decided_by,capacity,outcome,reason)
       values ($1,$2,'finance',$3,'owner','accept','Reviewed')`,
      [high.id, high.itemVersionId, people.owner],
    )
    expect(await delivered()).not.toContain(high.itemId)
    // The owner's own earlier accept publishes now, with no second decision.
    const again = await decide(high.id, 'accept')
    expect(again.statusCode, again.body).toBe(200)
    expect(again.json<Decided>()).toMatchObject({
      proposal: { state: 'accepted' },
      edition: { reason: 'proposal_accepted' },
    })
    expect(await delivered()).toContain(high.itemId)
    expect((await decisions(high.id)).map((d) => d.capacity)).toEqual(['owner'])
  })

  it('publishes a high-risk recheck at once, as at every risk', async () => {
    const high = await submitted({ title: 'High-risk note', riskLevel: 'high' })
    expect((await decide(high.id, 'accept')).statusCode).toBe(200)
    const item = high.itemId!
    await client.query("update definitions set change_mark='2' where ref='demo:orders'")
    try {
      await client.query(
        "insert into overlay_events(kind,scope,item_id,flag,reason) values('flag_on','item',$1,'needs_check','Definition changed')",
        [item],
      )
      expect(await recheck(item)).toEqual({ done: true, edition: 'source_rechecked' })
      expect(await servedVersion(item)).toBe(2)
      expect(await flagged(item)).toBe(false)
      const marks = await client.query<{ marks: string[] }>(
        `select array(select change_mark from item_version_refs r where r.version_id=v.id) as marks
           from item_versions v where item_id=$1 and version_no=2`,
        [item],
      )
      expect(marks.rows[0]!.marks).toEqual(['2'])
    } finally {
      await client.query("update definitions set change_mark='1' where ref='demo:orders'")
    }
  })

  it('keeps the proposer on a recheck version and lets that proposer record the recheck', async () => {
    const item = await acceptedItem({ title: 'Owners own note' }, 'owner')
    await client.query("update definitions set change_mark='2' where ref='demo:orders'")
    try {
      expect(await recheck(item)).toEqual({ done: true, edition: 'source_rechecked' })
      const versions = await client.query<{ proposer_id: string; is_recheck: boolean }>(
        'select proposer_id,is_recheck from item_versions where item_id=$1 order by version_no',
        [item],
      )
      expect(versions.rows).toEqual([
        { proposer_id: people.owner, is_recheck: false },
        { proposer_id: people.owner, is_recheck: true },
      ])
    } finally {
      await client.query("update definitions set change_mark='1' where ref='demo:orders'")
    }
  })

  it('switches delivery off and on for an item, an area and everything', async () => {
    const item = await acceptedItem({ title: 'Stoppable' })
    expect(await delivered()).toContain(item)
    const stop = (payload: object, who: Who = 'admin') =>
      call('POST', '/serving/stops', who, { reason: 'Wrong caveat reported', ...payload })
    expect((await stop({ scope: 'all', on: true }, 'owner')).statusCode).toBe(403)
    expect((await stop({ scope: 'item', on: true })).statusCode).toBe(400)
    for (const target of [
      { scope: 'item', itemId: item },
      { scope: 'area', areaId: 'finance' },
      { scope: 'all' },
    ]) {
      const on = await stop({ ...target, on: true })
      expect(on.statusCode, on.body).toBe(200)
      expect(on.json<unknown[]>()).toHaveLength(1)
      expect(await delivered()).not.toContain(item)
      const off = await stop({ ...target, on: false })
      expect(off.json<unknown[]>()).toEqual([])
      expect(await delivered()).toContain(item)
    }
    expect(
      (await client.query("select action from audit_log where action like 'stop.%'")).rows,
    ).toHaveLength(6)
  })

  it('shows every signed-in person what delivery is stopped, and only that', async () => {
    const on = await call('POST', '/serving/stops', 'admin', {
      scope: 'area',
      areaId: 'finance',
      on: true,
      reason: 'Wrong caveat reported',
    })
    expect(on.statusCode, on.body).toBe(200)
    try {
      const admin = await call('GET', '/serving/stops', 'admin')
      expect(admin.statusCode, admin.body).toBe(200)
      expect(admin.json()).toEqual([
        {
          seq: expect.any(Number) as number,
          at: expect.any(String) as string,
          scope: 'area',
          areaId: 'finance',
          itemId: null,
          reason: 'Wrong caveat reported',
        },
      ])
      for (const who of ['owner', 'author'] as const) {
        const response = await call('GET', '/serving/stops', who)
        expect(response.statusCode, response.body).toBe(200)
        // No event number for anyone but an administrator; the banner needs none.
        expect(response.json(), who).toEqual([
          {
            at: admin.json<{ at: string }[]>()[0]!.at,
            scope: 'area',
            areaId: 'finance',
            itemId: null,
            reason: 'Wrong caveat reported',
          },
        ])
      }
      const signedOut = await app.inject({ method: 'GET', url: '/api/v1/serving/stops' })
      expect(signedOut.statusCode).toBe(401)
      const owner = await call('POST', '/serving/stops', 'owner', {
        scope: 'area',
        areaId: 'finance',
        on: false,
        reason: 'Fixed',
      })
      expect(owner.statusCode).toBe(403)
    } finally {
      await call('POST', '/serving/stops', 'admin', {
        scope: 'area',
        areaId: 'finance',
        on: false,
        reason: 'Fixed',
      })
    }
  })

  it('has no start checks and no state to move: every domain is served (FR-320, FR-802)', async () => {
    for (const [method, path] of [
      ['GET', '/areas/finance/start-checks'],
      ['POST', '/areas/finance/state'],
    ] as const) {
      const gone = await call(method, path, 'admin', { state: 'paused', reason: 'Gone' })
      expect(gone.statusCode).toBe(404)
    }
    const answer = await ask()
    expect(answer.status).not.toBe('area_not_live')
    expect(JSON.stringify(answer)).not.toMatch(/not live|domains_not_live/)
  })

  it('serializes concurrent decisions: a second change to the same item must be rewritten', async () => {
    const item = await acceptedItem({ title: 'Contested' })
    const one = await submitted({ title: 'Contested one' }, 'author', item)
    const two = await submitted({ title: 'Contested two' }, 'stranger', item)
    const results = await Promise.all([decide(one.id, 'accept'), decide(two.id, 'accept')])
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409])
    const live = await client.query<{ n: string }>(
      "select count(*) as n from editions where reason='proposal_accepted'",
    )
    const parallel = await Promise.all([
      submitted({ title: 'Parallel one' }),
      submitted({ title: 'Parallel two' }),
    ])
    const accepted = await Promise.all(parallel.map((p) => decide(p.id, 'accept')))
    expect(accepted.map((r) => r.statusCode)).toEqual([200, 200])
    const labels = accepted.map((r) => r.json<Decided>().edition!.label)
    expect(new Set(labels).size).toBe(2)
    expect(
      Number(
        (
          await client.query<{ n: string }>(
            "select count(*) as n from editions where reason='proposal_accepted'",
          )
        ).rows[0]!.n,
      ),
    ).toBe(Number(live.rows[0]!.n) + 2)
  })

  it('refuses to serve an unaccepted version through any other code path', async () => {
    const p = await submitted({ title: 'Never accepted' })
    const direct = apiDatabase(url)
    try {
      await expect(
        direct.transaction(people.owner, async (tx) => {
          const [opened] = await tx.query<{ seq: string }>(
            "select edition_open('proposal_accepted',cl_person()) as seq",
          )
          await tx.query('select edition_serve_item_version($1,$2)', [opened!.seq, p.itemVersionId])
        }),
      ).rejects.toThrow(/cannot enter service: no accept decision/)
      await expect(
        direct.transaction(people.owner, (tx) =>
          tx.query(
            "insert into item_version_service(item_id,version_id,editions) values($1,$2,int8range(1,null,'[)'))",
            [p.itemId, p.itemVersionId],
          ),
        ),
      ).rejects.toThrow(/permission denied/)
      await expect(
        direct.transaction(people.owner, async (tx) => {
          await tx.query(
            `insert into decisions(proposal_id,item_version_id,area_id,decided_by,capacity,outcome,reason)
             values($1,$2,'finance',cl_person(),'owner','accept','Skipping checks')`,
            [p.id, p.itemVersionId],
          )
          await tx.query(
            "insert into check_results(item_version_id,level,outcome) values($1,'delivery','failed')",
            [p.itemVersionId],
          )
          const [opened] = await tx.query<{ seq: string }>(
            "select edition_open('proposal_accepted',cl_person()) as seq",
          )
          await tx.query('select edition_serve_item_version($1,$2)', [opened!.seq, p.itemVersionId])
        }),
      ).rejects.toThrow(/a required check has not passed/)
    } finally {
      await direct.close()
    }
    expect(await delivered()).not.toContain(p.itemId)
  })
})

/*
  An issue (FR-135, requirements section 4.4): a temporary problem such as a partner's reporting
  being down. It has the same validity and matching as any item. With no end date it gets a short
  default review from its start, and its re-check asks "Is this still going on?". These run last:
  the issues stay in the edition, and the questions above expect an empty Norway in August.
*/
describe('issues', () => {
  const issue = (extra: Draft = {}) =>
    draft({
      kind: 'issue',
      title: 'Partner reporting for Norway is down',
      summary: 'The partner sends no Norway data; these days are not reliable',
      validity: { start: '2026-08-04', end: null },
      ...extra,
    })
  const create = async (value: Draft) => {
    const response = await call('POST', '/proposals', 'author', { draft: value })
    expect(response.statusCode, response.body).toBe(200)
    return response.json<ProposalRecord>()
  }

  it('gives an open issue a review date of its start plus the setting, and leaves the other kinds alone', async () => {
    expect((await create(issue())).draft.reviewDate).toBe('2026-08-18')
    expect((await create(issue({ reviewDate: null }))).draft.reviewDate).toBe('2026-08-18')
    // A date the author gives is kept, and an issue that ends by itself needs none.
    expect((await create(issue({ reviewDate: '2026-12-01' }))).draft.reviewDate).toBe('2026-12-01')
    expect(
      (await create(issue({ validity: { start: '2026-08-04', end: '2026-08-16' } }))).draft
        .reviewDate,
    ).toBeNull()
    // Every other kind keeps its default: 90 days from today, with or without an end date.
    expect((await create(draft({ kind: 'event' }))).draft.reviewDate).toBe('2027-01-06')
    expect((await create(draft({ kind: 'note' }))).draft.reviewDate).toBe('2027-01-06')

    // A draft saved before its dates were known gets the default once the start is there.
    const early = await create(issue({ validity: undefined }))
    expect(early.draft.reviewDate).toBeNull()
    const saved = await database.transaction(people.author, (tx) =>
      createProposalsService(tx, systemClock('2026-10-08'), people.author).save(
        early.id,
        early.revision,
        { ...early.draft, validity: { start: '2026-09-01', end: null } },
      ),
    )
    expect(saved.draft.reviewDate).toBe('2026-09-15')

    // The period is an administrator's setting (FR-809).
    const changed = await call('PUT', '/settings/review.open_issue_days', 'admin', {
      version: 1,
      value: 7,
      reason: 'Partners usually recover within a week',
    })
    expect(changed.statusCode, changed.body).toBe(200)
    try {
      expect((await create(issue())).draft.reviewDate).toBe('2026-08-11')
    } finally {
      await call('PUT', '/settings/review.open_issue_days', 'admin', {
        version: 2,
        value: 14,
        reason: 'Back to the default',
      })
    }
  })

  it('delivers an ended issue only for questions about its own period', async () => {
    const ended = await submitted({
      ...issue({ validity: { start: '2026-08-04', end: '2026-08-16' } }),
      title: 'Partner reporting for Norway was down for twelve days',
    })
    expect(ended.draft.reviewDate).toBeNull()
    expect((await decide(ended.id, 'accept')).statusCode).toBe(200)
    const window = (from: string, to: string) => ({ ...norway, window: { from, to } })
    // Asked on 2026-10-08, long after the issue ended.
    expect(await delivered(window('2026-08-05', '2026-08-12'))).toContain(ended.itemId)
    expect(await delivered(window('2026-08-01', '2026-09-30'))).toContain(ended.itemId)
    expect(await delivered(window('2026-08-16', '2026-09-30'))).not.toContain(ended.itemId)
    expect(await delivered(window('2026-09-01', '2026-10-07'))).not.toContain(ended.itemId)
    expect(await page(ended.itemId!)).toMatchObject({
      kind: 'issue',
      reviewDate: null,
      reviewQuestion: 'still_correct',
    })
  })

  it('serves an open issue as a live warning and asks again whether it is still going on', async () => {
    const open = await submitted(issue({ validity: { start: '2026-10-01', end: null } }))
    expect(open.draft.reviewDate).toBe('2026-10-15')
    expect((await decide(open.id, 'accept')).statusCode).toBe(200)
    const window = { ...norway, window: { from: '2026-10-01', to: '2026-10-07' } }
    expect(await delivered(window)).toContain(open.itemId)
    expect(
      await delivered({ ...norway, window: { from: '2026-09-01', to: '2026-09-30' } }),
    ).not.toContain(open.itemId)

    expect(await page(open.itemId!)).toMatchObject({
      kind: 'issue',
      reviewDate: '2026-10-15',
      reviewQuestion: 'still_going_on',
    })

    // "Yes, still going on": the next review is the issue period from today, not 90 days.
    expect((await recheck(open.itemId!)).done).toBe(true)
    expect(await page(open.itemId!)).toMatchObject({
      version: 2,
      reviewDate: '2026-10-22',
      reviewQuestion: 'still_going_on',
    })
  })
})
