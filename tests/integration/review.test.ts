import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ProposalRecord } from '../../src/contract/proposals.ts'
import type { Edition, Gate, ReviewProposal, TermCandidate } from '../../src/contract/review.ts'
import type { Draft } from '../../src/domain/draft.ts'
import { buildApp } from '../../src/server/app.ts'
import { systemClock } from '../../src/server/clock.ts'
import { readsIn } from '../../src/server/mcp/reads.ts'
import { createToolService } from '../../src/server/mcp/service.ts'
import { createEditionSource } from '../../src/server/modules/editions/index.ts'
import { workEvaluations } from '../../src/server/modules/evals/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { idleJobs } from '../server/idle-jobs.ts'
import { foundation, people } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  S8 end to end over authenticated HTTP: a contributor proposes, an owner decides, an edition is
  published and the serving pool (context_layer_serve) answers differently; rollback restores it.
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
  const question = await call('PUT', '/evals/questions/finance-revenue-spain', 'owner', {
    id: 'finance-revenue-spain',
    question: {
      id: 'finance-revenue-spain',
      area: 'finance',
      wordings: [
        { text: 'How did revenue develop in Spain in July 2026?', kind: 'natural' },
        { text: 'Revenue in Spain from 2026-07-01 to 2026-07-31', kind: 'precise' },
      ],
      scope: {
        metrics: ['metric:revenue'],
        dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
        window: { from: '2026-07-01', to: '2026-07-31' },
      },
      expected: { status: 'no_match' },
      source: 'Review tests',
    },
  })
  expect(question.statusCode, question.body).toBe(200)
})
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
type Review = {
  proposal: ReviewProposal
  diff: { field: string; before: unknown; after: unknown }[]
  mentions: { added: { target: string }[]; removed: { target: string }[] }
  warnings: { target: string }[]
  findings: { code: string; severity: string }[]
  gate: Gate | null
  decisions: { id: string; outcome: string; capacity: string; reason: string }[]
  sinceRequest: { decisionId: string; diff: { field: string }[] } | null
  termBatch: { id: string; open: number; total: number } | null
  vocabulary: { before: { name: string } | null; after: { name: string } } | null
  sourceToolQuestion: string
}
async function review(id: string, who: Who = 'owner') {
  const response = await call('GET', `/proposals/${id}/review`, who)
  expect(response.statusCode, response.body).toBe(200)
  return response.json<Review>()
}
type Decided = { proposal: ReviewProposal; edition: Edition | null }
async function decide(
  id: string,
  outcome: 'accept' | 'request_changes' | 'reject',
  who: Who = 'owner',
  extra: object = {},
) {
  const { proposal } = await review(id, who === 'author' ? 'author' : 'owner')
  return call('POST', `/proposals/${id}/decisions`, who, {
    revision: proposal.revision,
    outcome,
    reason: 'Reviewed against the evidence',
    ...extra,
  })
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
    const screen = await review(p.id)
    expect(screen.proposal).toMatchObject({ state: 'submitted', riskLevel: 'low', subject: 'item' })
    expect(screen.gate).toMatchObject({
      required: ['format', 'matching', 'delivery'],
      approvals: { owner: false, approver: null },
    })
    expect(screen.gate!.levels.map((l) => [l.level, l.outcome])).toEqual([
      ['format', 'passed'],
      ['matching', 'passed'],
      ['delivery', 'passed'],
    ])
    expect(screen.diff.map((d) => d.field)).toContain('title')
    expect(screen.diff.every((d) => d.before === null)).toBe(true)
    expect(screen.sourceToolQuestion).toMatch(/belongs in the source tool/)
    expect((await call('GET', `/proposals/${p.id}/review`, 'stranger')).statusCode).toBe(404)
    expect(
      (await call('GET', '/review/queue', 'owner')).json<ReviewProposal[]>().map((q) => q.id),
    ).toContain(p.id)
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
    const diff = await call('GET', `/editions/${result.edition!.label}/diff`, 'owner')
    expect(diff.json()).toMatchObject({
      from: before,
      items: [{ id: p.itemId, from: null, to: 1 }],
      vocabulary: [],
    })

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
    expect((await review(event.id)).gate!.required).toEqual(['format', 'matching', 'delivery'])
    const normal = await decide(event.id, 'accept')
    expect(normal.statusCode, normal.body).toBe(200)
    expect(normal.json<Decided>().edition).toMatchObject({ reason: 'proposal_accepted' })

    const high = await submitted({ title: 'Legal closure', riskLevel: 'high' })
    const gate = (await review(high.id)).gate!
    expect(gate.required).toEqual(['format', 'matching', 'delivery'])
    expect(gate.approvals).toEqual({ owner: false, approver: null })
    // No answer test is queued for it, now or by the job.
    await runAnswerTests()
    const runs = await client.query('select 1 from eval_runs where item_version_id=$1', [
      high.itemVersionId,
    ])
    expect(runs.rowCount).toBe(0)
    // An approver no longer decides, and their queue no longer lists it.
    expect((await decide(high.id, 'accept', 'approver')).statusCode).toBe(403)
    const queue = (await call('GET', '/review/queue', 'approver')).json<ReviewProposal[]>()
    expect(queue.map((q) => q.id)).not.toContain(high.id)
    const accepted = await decide(high.id, 'accept')
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<Decided>()).toMatchObject({
      proposal: { state: 'accepted' },
      edition: { reason: 'proposal_accepted' },
    })
    expect(await delivered()).toContain(high.itemId)
    expect((await review(high.id)).decisions.map((d) => d.capacity)).toEqual(['owner'])
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
    const read = await review(broad.id)
    expect(read.gate!.levels.find((l) => l.level === 'format')).toMatchObject({
      outcome: 'passed',
      details: { findings: [expect.objectContaining({ code: 'broad_scope' })] },
    })
    expect((await decide(broad.id, 'accept')).statusCode).toBe(200)

    // A dimension every view shares, such as device, belongs to no domain: the domain Cube gives
    // its member is no warning (B3). A metric Cube puts elsewhere warns, and never blocks either.
    await client.query(
      "insert into definitions(ref,connector_id,kind,name,change_mark,area_hint) values('demo:device','demo','dimension','Device','1','marketing')",
    )
    const term = await call('POST', '/vocabulary/proposals', 'author', {
      key: 'dim:device',
      kind: 'dimension',
      parentKey: null,
      name: 'Device',
      aliases: [],
      areaId: 'finance',
      definitionRefs: ['demo:device'],
    })
    expect(term.statusCode, term.body).toBe(200)
    expect((await review(term.json<ReviewProposal>().id)).findings).toEqual([])
    expect((await decide(term.json<ReviewProposal>().id, 'accept')).statusCode).toBe(200)
    await client.query("update definitions set area_hint='marketing' where ref='demo:orders'")
    try {
      const shared = await submitted({
        title: 'Orders on every device',
        scope: { metrics: ['metric:orders'], dimensions: ['dim:device'], dimensionValues: [] },
      })
      expect(shared.draft.references).toEqual(
        expect.arrayContaining(['demo:orders', 'demo:device']),
      )
      expect(shared.findings.map((f) => [f.code, f.severity, f.message])).toEqual([
        ['broad_scope', 'warning', expect.stringContaining('Device')],
        ['domain_mismatch', 'warning', 'Cube puts Orders in Marketing'],
      ])
      const accepted = await decide(shared.id, 'accept')
      expect(accepted.statusCode, accepted.body).toBe(200)
      expect(accepted.json<Decided>().proposal.state).toBe('accepted')
    } finally {
      await client.query("update definitions set area_hint=null where ref='demo:orders'")
    }
  })

  it('fails level 3 when a change stops delivering an item a test question expects', async () => {
    const item = await acceptedItem({ title: 'Norway orders note' })
    const question = await call('PUT', '/evals/questions/norway-level-three', 'owner', {
      id: 'norway-level-three',
      question: {
        id: 'norway-level-three',
        area: 'finance',
        wordings: [
          { text: 'What happened to orders in Norway in August 2026?', kind: 'natural' },
          { text: 'Orders in Norway from 2026-08-01 to 2026-08-31', kind: 'precise' },
        ],
        scope: {
          metrics: ['metric:orders'],
          dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
          window: { from: '2026-08-01', to: '2026-08-31' },
        },
        expected: { must_deliver: [item] },
        source: 'Review tests',
      },
    })
    expect(question.statusCode, question.body).toBe(200)
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
      const delivery = (await review(moved.id)).gate!.levels.find((l) => l.level === 'delivery')
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

    // An administrator with no role in Finance finds their own in the queue and accepts it there,
    // as administrator, and decides anyone else's too.
    const admins = await submitted({ kind: 'event', title: 'Administrator event' }, 'admin')
    const queue = (await call('GET', '/review/queue', 'admin')).json<ReviewProposal[]>()
    expect(queue.map((q) => q.id)).toContain(admins.id)
    const byAdmin = await decide(admins.id, 'accept', 'admin')
    expect(byAdmin.statusCode, byAdmin.body).toBe(200)
    expect((await review(admins.id)).decisions).toEqual([
      expect.objectContaining({ capacity: 'administrator', outcome: 'accept' }),
    ])
    const others = await submitted({ kind: 'guide', title: 'Guide for the administrator' })
    expect((await decide(others.id, 'request_changes', 'admin')).statusCode).toBe(200)

    // A contributor and an approver who is neither never decide, their own neither.
    const normal = await submitted({ kind: 'guide', title: 'Normal guide' })
    expect((await decide(normal.id, 'accept', 'approver')).statusCode).toBe(403)
    expect((await decide(normal.id, 'accept', 'author')).statusCode).toBe(403)
    expect((await decide(normal.id, 'accept', 'stranger')).statusCode).toBe(404)
    const stale = await call('POST', `/proposals/${normal.id}/decisions`, 'owner', {
      revision: 1,
      outcome: 'reject',
      reason: 'Old view',
    })
    expect(stale.statusCode).toBe(409)
    for (const reason of ['Ask @[Orders](metric:orders)', 'Mail jon@example.test'])
      expect(
        (
          await call('POST', `/proposals/${normal.id}/decisions`, 'owner', {
            revision: (await review(normal.id)).proposal.revision,
            outcome: 'reject',
            reason,
          })
        ).statusCode,
      ).toBe(422)
  })

  it('asks for changes, takes the resubmitted version and rejects it with the source-tool reason', async () => {
    const p = await submitted({ title: 'Needs work' })
    const changes = await decide(p.id, 'request_changes')
    expect(changes.statusCode, changes.body).toBe(200)
    expect(changes.json<Decided>()).toMatchObject({
      proposal: { state: 'changes_requested' },
      edition: null,
    })
    const record = (await call('GET', `/proposals/${p.id}`, 'author')).json<ProposalRecord>()
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/proposals/${p.id}/draft`,
      headers: headers.author,
      payload: { revision: record.revision, draft: { ...record.draft, title: 'Better' } },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    const resubmitted = await call('POST', `/proposals/${p.id}/submit`, 'author', {
      revision: saved.json<ProposalRecord>().revision,
    })
    expect(resubmitted.statusCode, resubmitted.body).toBe(200)
    const screen = await review(p.id)
    expect(screen.gate!.levels.every((l) => l.outcome === 'passed')).toBe(true)
    // What changed since the request: the title only, against the version it was asked on.
    expect(screen.sinceRequest).toEqual({
      decisionId: screen.decisions[0]!.id,
      diff: [{ field: 'title', before: 'Needs work', after: 'Better' }],
    })
    const rejected = await decide(p.id, 'reject', 'owner', { reason: screen.sourceToolQuestion })
    expect(rejected.statusCode, rejected.body).toBe(200)
    expect(rejected.json<Decided>().proposal).toMatchObject({ state: 'rejected' })
    const closed = await review(p.id)
    expect(closed.decisions.map((d) => d.outcome)).toEqual(['request_changes', 'reject'])
    expect(closed.sinceRequest).toBeNull()
    expect((await decide(p.id, 'accept')).statusCode).toBe(409)
  })

  it('shows mentions added and removed and warns, never blocking, about a narrower audience', async () => {
    const item = await acceptedItem({
      title: 'Mentions orders',
      summaryMarkup: 'Online sales stopped, see @[Orders](metric:orders)',
    })
    await client.query("update definitions set visible_groups='{finance}' where ref='demo:orders'")
    try {
      const change = await submitted(
        {
          title: 'Mentions orders',
          summaryMarkup:
            'Online sales stopped in @[Norway](val:market/norway) and @[Orders](metric:orders)',
        },
        'author',
        item,
      )
      const screen = await review(change.id)
      expect(screen.mentions.added.map((m) => m.target)).toEqual(['val:market/norway'])
      expect(screen.mentions.removed).toEqual([])
      expect(screen.diff.map((d) => d.field)).toEqual(['summary', 'summaryMarkup'])
      expect(screen.warnings.map((w) => w.target)).toEqual(['metric:orders'])
      const accepted = await decide(change.id, 'accept')
      expect(accepted.statusCode, accepted.body).toBe(200)
      const dropped = await submitted(
        { title: 'Mentions orders', summaryMarkup: 'Online sales stopped' },
        'author',
        item,
      )
      const after = await review(dropped.id)
      expect(after.mentions.removed.map((m) => m.target).sort()).toEqual([
        'metric:orders',
        'val:market/norway',
      ])
      expect(after.warnings).toEqual([])
    } finally {
      await client.query("update definitions set visible_groups=null where ref='demo:orders'")
    }
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
    expect((await review(retirement.id)).diff).toEqual([
      { field: 'status', before: 'accepted', after: 'retired' },
    ])
    const accepted = await decide(retirement.id, 'accept')
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<Decided>().edition).toMatchObject({ reason: 'item_retired' })
    expect(await delivered()).not.toContain(proposed)

    const direct = await acceptedItem({ title: 'To retire at once' })
    expect(
      (await call('POST', `/items/${direct}/retire`, 'author', { reason: 'No' })).statusCode,
    ).toBe(403)
    const retired = await call('POST', `/items/${direct}/retire`, 'admin', {
      reason: 'Withdrawn by the source',
    })
    expect(retired.statusCode, retired.body).toBe(200)
    expect(retired.json<Edition>()).toMatchObject({ reason: 'item_retired', live: true })
    expect(await delivered()).not.toContain(direct)

    const old = await acceptedItem({ title: 'Old caveat' })
    const pointer = await acceptedItem({
      title: 'Points at the old caveat',
      summaryMarkup: `Read @[the old caveat](item:${old}) first`,
    })
    const replacement = await submitted({ title: 'New caveat', replaces: [old] })
    const replaced = await decide(replacement.id, 'accept')
    expect(replaced.statusCode, replaced.body).toBe(200)
    const label = replaced.json<Decided>().edition!.label
    const diff = (await call('GET', `/editions/${label}/diff`, 'owner')).json<{
      items: { id: string; from: number | null; to: number | null }[]
    }>()
    expect(diff.items).toEqual(
      expect.arrayContaining([
        { id: old, from: 1, to: null },
        { id: replacement.itemId, from: null, to: 1 },
      ]),
    )
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
      const flagged = (await ask()).items.find((i) => i.id === item)
      expect(flagged).toMatchObject({ freshness: 'unverified', unverified_reason: 'needs_check' })
      expect(
        (await call('POST', `/items/${item}/recheck`, 'author', { reason: 'Fine' })).statusCode,
      ).toBe(403)
      const rechecked = await call('POST', `/items/${item}/recheck`, 'owner', {
        reason: 'The definition change does not affect this note',
      })
      expect(rechecked.statusCode, rechecked.body).toBe(200)
      expect(rechecked.json<Decided>()).toMatchObject({
        proposal: { state: 'accepted' },
        edition: { reason: 'source_rechecked', live: true },
      })
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
      expect(
        (await call('POST', `/items/${item}/recheck`, 'owner', { reason: 'Again' })).statusCode,
      ).toBe(409)
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
    const rechecked = await call('POST', `/items/${item}/recheck`, 'owner', {
      reason: 'Still true',
    })
    expect(rechecked.statusCode, rechecked.body).toBe(200)
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
    expect((await review(high.id)).decisions.map((d) => d.capacity)).toEqual(['administrator'])
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
    expect((await review(high.id)).decisions.map((d) => d.capacity)).toEqual(['owner'])
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
      const rechecked = await call('POST', `/items/${item}/recheck`, 'owner', {
        reason: 'Still right',
      })
      expect(rechecked.statusCode, rechecked.body).toBe(200)
      expect(rechecked.json<Decided>()).toMatchObject({
        proposal: { state: 'accepted' },
        edition: { reason: 'source_rechecked', live: true },
      })
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
      const response = await call('POST', `/items/${item}/recheck`, 'owner', {
        reason: 'Checked against the new definition',
      })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.json<Decided>().edition).toMatchObject({ reason: 'source_rechecked' })
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

  it('takes vocabulary changes through review, keeps mentions on rename and checks the Cube domain', async () => {
    const item = await acceptedItem({
      title: 'Mentions a metric',
      summaryMarkup: 'Closed, see @[orders](metric:orders)',
    })
    const alias = await call('POST', '/vocabulary/proposals', 'author', {
      key: 'val:market/norway',
      kind: 'dimension_value',
      parentKey: 'dim:market',
      name: 'Norway',
      aliases: ['Nordland'],
      areaId: null,
      definitionRefs: [],
    })
    expect(alias.statusCode, alias.body).toBe(200)
    const aliasProposal = alias.json<ReviewProposal>()
    expect(aliasProposal).toMatchObject({ subject: 'vocabulary', areaId: null, state: 'submitted' })
    const hidden = await call('POST', `/proposals/${aliasProposal.id}/decisions`, 'owner', {
      revision: aliasProposal.revision,
      outcome: 'accept',
      reason: 'Not my area',
    })
    expect(hidden.statusCode).toBe(404)
    const accepted = await call('POST', `/proposals/${aliasProposal.id}/decisions`, 'admin', {
      revision: aliasProposal.revision,
      outcome: 'accept',
      reason: 'Common spelling',
    })
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<Decided>().edition).toMatchObject({ reason: 'vocabulary_changed' })
    expect(
      await delivered({
        ...norway,
        dimension_filters: [{ dimension: 'Market', values: ['Nordland'] }],
      }),
    ).toContain(item)

    const rename = await call('POST', '/vocabulary/proposals', 'author', {
      key: 'metric:orders',
      kind: 'metric',
      parentKey: null,
      name: 'Total orders',
      aliases: [],
      areaId: 'finance',
      definitionRefs: ['demo:orders'],
    })
    expect(rename.statusCode, rename.body).toBe(200)
    const renamed = await decide(rename.json<ReviewProposal>().id, 'accept')
    expect(renamed.statusCode, renamed.body).toBe(200)
    const link = (await ask()).items
      .find((i) => i.id === item)!
      .links.find((l) => l.rel === 'mentions')
    expect(link?.target).toMatchObject({ id: 'metric:orders', label: 'Total orders' })

    await client.query(
      "insert into area_assignments(area_id,person_id,role) values('marketing',$1,'owner')",
      [people.approver],
    )
    const move = await call('POST', '/vocabulary/proposals', 'author', {
      key: 'metric:orders',
      kind: 'metric',
      parentKey: null,
      name: 'Total orders',
      aliases: [],
      areaId: 'marketing',
      definitionRefs: ['demo:orders'],
    })
    expect(move.statusCode, move.body).toBe(200)
    const moveId = move.json<ReviewProposal>().id
    const taken = await call('POST', `/proposals/${moveId}/decisions`, 'approver', {
      revision: move.json<ReviewProposal>().revision,
      outcome: 'accept',
      reason: 'Ours now',
    })
    expect(taken.statusCode, taken.body).toBe(403)
    expect(taken.json<{ message: string }>().message).toMatch(/an owner of Finance, or an admin/)
    const unmapped = await call('POST', '/vocabulary/proposals', 'author', {
      key: 'group:payments',
      kind: 'metric_group',
      parentKey: null,
      name: 'Payments',
      aliases: [],
      areaId: 'finance',
      definitionRefs: [],
    })
    expect((await decide(unmapped.json<ReviewProposal>().id, 'accept')).statusCode).toBe(403)
    const moved = await call('POST', `/proposals/${moveId}/decisions`, 'admin', {
      revision: move.json<ReviewProposal>().revision,
      outcome: 'accept',
      reason: 'Marketing owns orders from now on',
    })
    expect(moved.statusCode, moved.body).toBe(200)
    expect(moved.json<Decided>().edition).toMatchObject({ reason: 'area_map_changed' })

    expect(
      (
        await call('POST', '/vocabulary/proposals', 'author', {
          key: 'metric:units_sold',
          kind: 'metric',
          parentKey: null,
          name: 'Revenue',
          aliases: [],
          areaId: 'finance',
          definitionRefs: [],
        })
      ).statusCode,
    ).toBe(422)
    await client.query(
      "insert into definitions(ref,connector_id,kind,name,change_mark,area_hint) values('demo:returns','demo','metric','Returns','1','marketing')",
    )
    const mismatch = await call('POST', '/vocabulary/proposals', 'author', {
      key: 'metric:returns',
      kind: 'metric',
      parentKey: null,
      name: 'Returns',
      aliases: [],
      areaId: 'finance',
      definitionRefs: ['demo:returns'],
    })
    expect(mismatch.statusCode, mismatch.body).toBe(200)
    const id = mismatch.json<ReviewProposal>().id
    expect((await review(id)).findings).toEqual([
      expect.objectContaining({ code: 'domain_mismatch', severity: 'error' }),
    ])
    const refused = await decide(id, 'accept')
    expect(refused.statusCode).toBe(422)
    expect((await decide(id, 'reject')).statusCode).toBe(200)
  })

  it('lets any administrator decide a term without an area, the one who proposed it too', async () => {
    await client.query(
      "insert into global_role_grants (person_id,role) values ($1,'administrator')",
      [people.stranger],
    )
    try {
      const term = await call('POST', '/vocabulary/proposals', 'admin', {
        key: 'dim:browser',
        kind: 'dimension',
        parentKey: null,
        name: 'Browser',
        aliases: [],
        areaId: null,
        definitionRefs: [],
      })
      expect(term.statusCode, term.body).toBe(200)
      const proposal = term.json<ReviewProposal>()
      const decideAs = (who: Who) =>
        call('POST', `/proposals/${proposal.id}/decisions`, who, {
          revision: proposal.revision,
          outcome: 'accept',
          reason: 'Shared by every view',
        })
      // An owner of no area does not see it.
      expect((await decideAs('owner')).statusCode).toBe(404)
      const open = await review(proposal.id, 'stranger')
      expect(open.vocabulary).toMatchObject({ before: null, after: { name: 'Browser' } })
      const accepted = await decideAs('stranger')
      expect(accepted.statusCode, accepted.body).toBe(200)
      const decided = await review(proposal.id, 'stranger')
      expect(decided.decisions).toEqual([
        expect.objectContaining({ capacity: 'administrator', outcome: 'accept' }),
      ])
      // Once live, the new term still reads as new, not as the live term it became.
      expect(decided.vocabulary).toMatchObject({ before: null, after: { name: 'Browser' } })

      // The administrator who proposes a term decides it too (FR-206).
      const own = await call('POST', '/vocabulary/proposals', 'admin', {
        key: 'dim:device',
        kind: 'dimension',
        parentKey: null,
        name: 'Device',
        aliases: [],
        areaId: null,
        definitionRefs: [],
      })
      expect(own.statusCode, own.body).toBe(200)
      const mine = own.json<ReviewProposal>()
      const accepted2 = await call('POST', `/proposals/${mine.id}/decisions`, 'admin', {
        revision: mine.revision,
        outcome: 'accept',
        reason: 'Shared by every view',
      })
      expect(accepted2.statusCode, accepted2.body).toBe(200)
      expect((await review(mine.id, 'admin')).decisions).toEqual([
        expect.objectContaining({ capacity: 'administrator', outcome: 'accept' }),
      ])
    } finally {
      await client.query(
        "delete from global_role_grants where person_id=$1 and role='administrator'",
        [people.stranger],
      )
    }
  })

  it('proposes the source members as terms in one batch and accepts them as one edition', async () => {
    await client.query(`insert into definitions(ref,connector_id,kind,name,title,change_mark,area_hint,value_type,synonyms) values
      ('demo:ads.clicks','demo','metric','ads.clicks','Ads Clicks','1','finance','count','{"ad clicks","Clicks"}'),
      ('demo:ads.region','demo','dimension','ads.region','Ads Region','1','finance','string','{}'),
      ('demo:web.region','demo','dimension','web.region','Web Region','1','marketing','string','{}'),
      ('demo:web.day','demo','dimension','web.day','Web Day','1','marketing','time','{}')`)
    // Only an administrator reads the members no term links yet.
    expect((await call('GET', '/vocabulary/candidates', 'owner')).statusCode).toBe(403)
    const candidates = (await call('GET', '/vocabulary/candidates', 'admin')).json<
      TermCandidate[]
    >()
    expect(candidates.find((c) => c.definitionRefs.includes('demo:ads.clicks'))).toMatchObject({
      key: 'metric:clicks',
      kind: 'metric',
      name: 'Clicks',
      // The model's other names, without the term's own name (meta.synonyms).
      aliases: ['ad clicks'],
      areaId: 'finance',
      suggested: true,
    })
    // A dimension two views share is one term linking both, of no domain; a date is not suggested.
    expect(candidates.find((c) => c.key === 'dim:region')).toMatchObject({
      definitionRefs: ['demo:ads.region', 'demo:web.region'],
      areaId: null,
      views: ['ads', 'web'],
      suggested: true,
    })
    expect(candidates.find((c) => c.key === 'dim:day')).toMatchObject({ suggested: false })
    // Orders already has a term.
    expect(candidates.some((c) => c.definitionRefs.includes('demo:orders'))).toBe(false)
    // The assistant tells anyone what a domain's source has that is no term yet, and who
    // proposes it: never a date, an id or a dimension several domains share.
    const waitingAs = (who: string | null) =>
      database.transaction(who, (tx) => readsIn(tx, systemClock(), who).waiting())
    const asAdmin = await waitingAs(people.admin)
    expect(asAdmin.canPropose).toBe(true)
    // Served context names roles, never people (FR-326).
    expect(asAdmin).not.toHaveProperty('administrators')
    expect(asAdmin.members.find((m) => m.name === 'Clicks')).toMatchObject({
      areaId: 'finance',
      kind: 'metric',
      source: 'demo',
      proposed: false,
    })
    expect(asAdmin.members.some((m) => m.name === 'Region' || m.name === 'Day')).toBe(false)
    expect((await waitingAs(people.owner)).canPropose).toBe(false)
    // A member its source limits to some groups is never named, to anyone.
    await client.query(
      "update definitions set visible_groups='{finance_team}' where ref='demo:ads.clicks'",
    )
    for (const who of [people.admin, people.stranger, null])
      expect((await waitingAs(who)).members.some((m) => m.name === 'Clicks')).toBe(false)
    await client.query("update definitions set visible_groups=null where ref='demo:ads.clicks'")

    const term = (key: string, extra: object = {}) => ({
      key,
      kind: 'metric',
      parentKey: null,
      name: key,
      aliases: [],
      areaId: null,
      definitionRefs: [],
      ...extra,
    })
    const terms = [
      term('val:region/north', { kind: 'dimension_value', parentKey: 'dim:region', name: 'North' }),
      term('val:region/south', {
        kind: 'dimension_value',
        parentKey: 'dim:region',
        name: 'South',
        aliases: ['S'],
      }),
      term('metric:clicks', {
        name: 'Clicks',
        areaId: 'finance',
        definitionRefs: ['demo:ads.clicks'],
      }),
      term('dim:region', {
        kind: 'dimension',
        name: 'Region',
        definitionRefs: ['demo:ads.region', 'demo:web.region'],
      }),
    ]
    // All or none: a key twice, or a value of a dimension nobody proposes, changes nothing.
    const twice = await call('POST', '/vocabulary/batches', 'admin', {
      terms: [...terms, terms[0]],
    })
    expect(twice.statusCode).toBe(422)
    expect(
      twice.json<{ data: { findings: { code: string; field: string }[] } }>().data.findings,
    ).toContainEqual(expect.objectContaining({ code: 'duplicate_key', field: 'terms.4.key' }))
    const orphan = await call('POST', '/vocabulary/batches', 'admin', { terms: [terms[0]] })
    expect(orphan.statusCode).toBe(422)
    expect((await call('POST', '/vocabulary/batches', 'author', { terms })).statusCode).toBe(403)
    const proposed = await call('POST', '/vocabulary/batches', 'admin', {
      terms,
      sourceName: 'Cube members',
    })
    expect(proposed.statusCode, proposed.body).toBe(200)
    const batch = proposed.json<{ batchId: string; proposals: ReviewProposal[] }>()
    expect(batch.proposals.map((p) => [p.termKey, p.state, p.channel])).toEqual([
      ['metric:clicks', 'submitted', 'import'],
      ['dim:region', 'submitted', 'import'],
      ['val:region/north', 'submitted', 'import'],
      ['val:region/south', 'submitted', 'import'],
    ])
    // Proposed is not served: the candidates leave out what waits for a decision.
    const after = (await call('GET', '/vocabulary/candidates', 'admin')).json<TermCandidate[]>()
    expect(after.some((c) => c.key === 'metric:clicks' || c.key === 'dim:region')).toBe(false)
    // An administrator reads it as proposed. Someone who may not read the proposal, and an agent
    // reading as nobody, still read it as not in the vocabulary yet, with an administrator to ask.
    expect((await waitingAs(people.admin)).members.find((m) => m.name === 'Clicks')).toMatchObject({
      areaId: 'finance',
      proposed: true,
    })
    for (const who of [people.stranger, null])
      expect((await waitingAs(who)).members.find((m) => m.name === 'Clicks')).toMatchObject({
        areaId: 'finance',
        proposed: false,
      })
    // The owner of Finance sees the Finance term of the batch only.
    const clicks = batch.proposals[0]!
    expect((await review(clicks.id)).termBatch).toEqual({ id: batch.batchId, open: 1, total: 1 })

    await client.query(
      "insert into global_role_grants (person_id,role) values ($1,'administrator')",
      [people.stranger],
    )
    try {
      const path = `/vocabulary/batches/${batch.batchId}/decisions`
      const payload = { outcome: 'accept', reason: 'The terms the model defines' }
      // The proposer, an administrator, decides their own batch (FR-206).
      expect((await review(clicks.id, 'stranger')).termBatch).toMatchObject({ open: 4, total: 4 })
      const before = await liveLabel()
      const decided = await call('POST', path, 'admin', payload)
      expect(decided.statusCode, decided.body).toBe(200)
      const result = decided.json<{ proposals: ReviewProposal[]; edition: Edition }>()
      expect(result.proposals.map((p) => p.state)).toEqual([
        'accepted',
        'accepted',
        'accepted',
        'accepted',
      ])
      expect(result.edition).toMatchObject({ reason: 'vocabulary_changed', live: true })
      expect(await liveLabel()).not.toBe(before)
      const editions = await client.query(
        "select count(*)::int as n from editions where reason='vocabulary_changed' and label=$1",
        [result.edition.label],
      )
      expect(editions.rows[0]).toEqual({ n: 1 })
      const vocabulary = (await call('GET', '/vocabulary', 'author')).json<{
        metrics: { id: string }[]
        dimensions: { id: string; values: { id: string; aliases: string[] }[] }[]
      }>()
      expect(vocabulary.metrics.map((m) => m.id)).toContain('clicks')
      expect(vocabulary.dimensions.find((d) => d.id === 'region')?.values).toEqual([
        expect.objectContaining({ id: 'north' }),
        expect.objectContaining({ id: 'south', aliases: ['S'] }),
      ])
      expect((await call('POST', path, 'stranger', payload)).statusCode).toBe(404)
    } finally {
      await client.query(
        "delete from global_role_grants where person_id=$1 and role='administrator'",
        [people.stranger],
      )
    }
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
    const saved = await call('PUT', `/proposals/${early.id}/draft`, 'author', {
      revision: early.revision,
      draft: { ...early.draft, validity: { start: '2026-09-01', end: null } },
    })
    expect(saved.statusCode, saved.body).toBe(200)
    expect(saved.json<ProposalRecord>().draft.reviewDate).toBe('2026-09-15')

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
    const item = await call('GET', `/items/${ended.itemId}`, 'author')
    expect(item.json()).toMatchObject({
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

    const read = await call('GET', `/items/${open.itemId}`, 'author')
    expect(read.json()).toMatchObject({
      kind: 'issue',
      reviewDate: '2026-10-15',
      reviewQuestion: 'still_going_on',
    })
    const listed = await call('GET', '/items?kind=issue&limit=100', 'author')
    expect(listed.statusCode, listed.body).toBe(200)
    expect(
      listed
        .json<{ rows: { id: string; reviewQuestion: string }[] }>()
        .rows.find((row) => row.id === open.itemId),
    ).toMatchObject({ reviewQuestion: 'still_going_on' })

    // "Yes, still going on": the next review is the issue period from today, not 90 days.
    const rechecked = await call('POST', `/items/${open.itemId}/recheck`, 'owner', {
      reason: 'The partner feed is still down',
    })
    expect(rechecked.statusCode, rechecked.body).toBe(200)
    expect((await call('GET', `/items/${open.itemId}`, 'author')).json()).toMatchObject({
      version: 2,
      reviewDate: '2026-10-22',
      reviewQuestion: 'still_going_on',
    })
  })
})

describe('owner edits during review (FR-105, FR-106, FR-123, FR-324)', () => {
  const edit = (id: string, revision: number, change: object, who: Who = 'owner') =>
    call('POST', `/proposals/${id}/review-edits`, who, { revision, ...change })

  it('raises a low-risk note to high: a new version, the same checks again, then one accept', async () => {
    const p = await submitted({ title: 'Raised in review' })
    const before = await review(p.id)
    const response = await edit(p.id, before.proposal.revision, {
      riskLevel: 'high',
      reason: 'It changes how orders are reported',
    })
    expect(response.statusCode, response.body).toBe(200)
    const screen = response.json<Review>()
    expect(screen.proposal).toMatchObject({
      riskLevel: 'high',
      state: 'submitted',
      proposerId: people.author,
      revision: before.proposal.revision + 1,
    })
    const versions = await client.query(
      `select id::text,supersedes_version_id::text as supersedes,edited_by::text as editor,risk::text,
              proposer_id::text as proposer
         from item_versions where item_id=$1 order by version_no`,
      [p.itemId],
    )
    expect(versions.rows).toEqual([
      expect.objectContaining({ id: p.itemVersionId, editor: null, risk: 'low' }),
      expect.objectContaining({
        id: screen.proposal.itemVersionId,
        supersedes: p.itemVersionId,
        editor: people.owner,
        risk: 'high',
        proposer: people.author,
      }),
    ])

    // The details of every level are typed in the contract.
    const level = (name: string) => screen.gate!.levels.find((l) => l.level === name)!
    // A higher risk needs the same three levels (FR-513).
    expect(screen.gate!.required).toEqual(['format', 'matching', 'delivery'])
    expect(level('format')).toMatchObject({ outcome: 'passed', details: { findings: [] } })
    expect(level('matching')).toMatchObject({
      outcome: 'passed',
      details: {
        edition: await liveLabel(),
        probes: expect.arrayContaining([
          expect.objectContaining({ name: 'inside', expect: 'delivered', passed: true }),
        ]) as unknown,
      },
    })
    expect(level('delivery')).toMatchObject({
      outcome: 'passed',
      details: { delivered: true, cut: false, replacedShown: [], status: 'matched' },
    })

    const audit = await client.query<{ actor_id: string; details: object }>(
      "select actor_id::text,details from audit_log where action='proposal.edited' and subject_id=$1",
      [p.id],
    )
    expect(audit.rows).toEqual([
      {
        actor_id: people.owner,
        details: expect.objectContaining({
          revision: before.proposal.revision + 1,
          reason: 'It changes how orders are reported',
          versionId: screen.proposal.itemVersionId,
          replaces: p.itemVersionId,
          changes: { riskLevel: { before: 'low', after: 'high' } },
        }) as unknown,
      },
    ])
    expect((await client.query('select * from audit_verify()')).rows).toEqual([])

    // The owner's accept publishes the new version: no approver is next.
    const owner = await decide(p.id, 'accept')
    expect(owner.statusCode, owner.body).toBe(200)
    expect(owner.json<Decided>().edition).toMatchObject({ live: true })
    expect(await servedVersion(p.itemId!)).toBe(2)
    expect(await delivered()).toContain(p.itemId)
  })

  it('cancels the open answer tests of the version it replaces, and queues none (FR-513)', async () => {
    const p = await submitted({ title: 'High and edited', riskLevel: 'high' })
    const runs = async (version: string | null) =>
      (
        await client.query<{ state: string }>(
          'select state::text from eval_runs where item_version_id=$1 order by created_at',
          [version],
        )
      ).rows.map((r) => r.state)
    expect(await runs(p.itemVersionId)).toEqual([])
    // A run of the version queued before migration 0005 is still cancelled by an edit.
    await client.query(
      `insert into eval_runs (kind,state,area_id,proposal_id,item_version_id,baseline_edition_seq,
         tool_schema_digest,model_id,client_label,test_set_digest,tries,estimated_cost_micros)
       values ('full','queued','finance',$1,$2,(select seq from live_edition),'digest','mock-model',
         'eval','\\x00'::bytea,3,0)`,
      [p.id, p.itemVersionId],
    )
    const { proposal } = await review(p.id)
    const response = await edit(p.id, proposal.revision, { reviewDate: '2027-02-01' })
    expect(response.statusCode, response.body).toBe(200)
    const edited = response.json<Review>()
    expect(await runs(p.itemVersionId)).toEqual(['cancelled'])
    expect(await runs(edited.proposal.itemVersionId)).toEqual([])
    expect(edited.diff.find((d) => d.field === 'reviewDate')?.after).toBe('2027-02-01')
  })

  it('accepts an edited change against the live version it was written for', async () => {
    const item = await acceptedItem({ title: 'Changed, then edited' })
    const change = await submitted(
      { title: 'Changed, then edited', summary: 'Closed' },
      'author',
      item,
    )
    const { proposal } = await review(change.id)
    const response = await edit(change.id, proposal.revision, { reviewDate: '2027-03-01' })
    expect(response.statusCode, response.body).toBe(200)
    const edited = response.json<Review>()
    expect(edited.diff.map((d) => d.field)).toEqual(
      expect.arrayContaining(['summary', 'reviewDate']),
    )
    const accepted = await decide(change.id, 'accept')
    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json<Decided>().edition).toMatchObject({ live: true })
    expect(await servedVersion(item)).toBe(3)
    const read = await call('GET', `/items/${item}`, 'author')
    expect(read.json()).toMatchObject({ summary: 'Closed', reviewDate: '2027-03-01' })
  })

  it('refuses what a review edit may not do', async () => {
    const edits = async () =>
      (
        await client.query<{ n: number }>(
          "select count(*)::int as n from audit_log where action='proposal.edited'",
        )
      ).rows[0]!.n
    const before = await edits()
    const p = await submitted({ title: 'Kept as written' })
    const { proposal } = await review(p.id)
    // An area the owner has no role in, a claim without its authority, sensitive or marked-up text.
    const moved = await edit(p.id, proposal.revision, { areaId: 'marketing' })
    expect(moved.statusCode, moved.body).toBe(403)
    expect(moved.json<{ message: string }>().message).toMatch(/also needs an owner/)
    expect((await edit(p.id, proposal.revision, { areaId: 'nowhere' })).statusCode).toBe(422)
    expect(
      (await edit(p.id, proposal.revision, { claim: { level: 'effect_stated' } })).statusCode,
    ).toBe(400)
    expect(
      (
        await edit(p.id, proposal.revision, {
          claim: { level: 'effect_stated', authority: 'Regulator', quote: 'Call +1 555 123 4567' },
        })
      ).statusCode,
    ).toBe(422)
    expect(
      (await edit(p.id, proposal.revision, { riskLevel: 'normal', reason: 'See @[x](item:itm_a)' }))
        .statusCode,
    ).toBe(422)
    // An open-ended item keeps a review date (FR-127).
    const undated = await edit(p.id, proposal.revision, { reviewDate: null })
    expect(undated.statusCode, undated.body).toBe(422)
    expect(undated.json<{ data: { findings: { field: string }[] } }>().data.findings).toEqual([
      expect.objectContaining({ field: '' }),
    ])
    // Only a proposal under review, and never a retirement.
    expect((await decide(p.id, 'reject')).statusCode).toBe(200)
    const closed = await review(p.id)
    expect((await edit(p.id, closed.proposal.revision, { riskLevel: 'normal' })).statusCode).toBe(
      409,
    )
    const item = await acceptedItem({ title: 'To retire' })
    const retirement = await call('POST', `/items/${item}/retire-proposals`, 'author', {
      reason: 'No longer true',
    })
    const retire = retirement.json<ReviewProposal>()
    expect((await edit(retire.id, retire.revision, { riskLevel: 'high' })).statusCode).toBe(409)
    expect(await edits()).toBe(before)
  })
})

describe('tests attached to a proposal (FR-524)', () => {
  const saveQuestion = (id: string, window: { from: string; to: string }, expected: object) =>
    call('PUT', `/evals/questions/${id}`, 'owner', {
      id,
      question: {
        id,
        area: 'finance',
        wordings: [
          { text: 'What happened to orders in Spain?', kind: 'natural' },
          { text: `Orders in Spain from ${window.from} to ${window.to}`, kind: 'precise' },
        ],
        scope: {
          metrics: ['metric:orders'],
          dimension_filters: [{ dimension: 'dim:market', values: ['val:market/spain'] }],
          window,
        },
        expected,
        source: 'Review tests',
      },
    })
  const spain = {
    metrics: ['metric:orders'],
    dimensions: [],
    dimensionValues: [{ dimension: 'dim:market', value: 'val:market/spain' }],
  }
  const audited = async (proposal: string) =>
    (
      await client.query<{ action: string; actor: string | null; details: object }>(
        `select action,actor_id::text as actor,details from audit_log
          where subject_type='proposal' and subject_id=$1 and action like 'proposal.test_%' order by seq`,
        [proposal],
      )
    ).rows

  it('reports each attached test with the change at level 3, and accepts whatever they say', async () => {
    const item = await acceptedItem({ title: 'Orders note to move' })
    const other = await acceptedItem({ title: 'A Norway note that stays' })
    const fixed = 'attached-spain-august'
    const failing = 'attached-spain-other'
    // The change moves the item to Spain; the other item stays in Norway either way. A
    // test that named the moved item and failed with it would block, attached or not.
    for (const [id, expected] of [
      [fixed, item],
      [failing, other],
    ] as const) {
      const saved = await saveQuestion(
        id,
        { from: '2026-08-01', to: '2026-08-31' },
        { must_deliver: [expected] },
      )
      expect(saved.statusCode, saved.body).toBe(200)
    }
    try {
      const created = await call('POST', '/proposals', 'author', {
        draft: draft({ title: 'Orders note to move', scope: spain }),
        itemId: item,
      })
      const p = created.json<ProposalRecord>()
      for (const question of [fixed, failing]) {
        const attached = await call('POST', `/proposals/${p.id}/tests`, 'author', { question })
        expect(attached.statusCode, attached.body).toBe(200)
      }
      expect(await audited(p.id)).toEqual([
        { action: 'proposal.test_attached', actor: people.author, details: { question: fixed } },
        { action: 'proposal.test_attached', actor: people.author, details: { question: failing } },
      ])
      const sent = await call('POST', `/proposals/${p.id}/submit`, 'author', {
        revision: p.revision,
      })
      expect(sent.statusCode, sent.body).toBe(200)
      const { gate } = await review(p.id)
      const delivery = gate!.levels.find((l) => l.level === 'delivery')
      expect(delivery?.outcome).toBe('passed')
      expect(delivery!.details.questions).toEqual(
        expect.arrayContaining([
          { id: fixed, baseline: false, candidate: true, regression: false, attached: true },
          { id: failing, baseline: false, candidate: false, regression: false, attached: true },
        ]),
      )
      // Low risk has no answer tests (FR-513): only the retrieval result shows.
      expect(gate!.attached.map(({ attachedHour: _hour, ...test }) => test)).toEqual([
        {
          question: fixed,
          active: true,
          retrieval: { baseline: false, candidate: true },
          answer: null,
        },
        {
          question: failing,
          active: true,
          retrieval: { baseline: false, candidate: false },
          answer: null,
        },
      ])
      // The author sees them too; the gate is theirs to read.
      expect((await review(p.id, 'author')).gate!.attached).toHaveLength(2)
      const accepted = await decide(p.id, 'accept')
      expect(accepted.statusCode, accepted.body).toBe(200)
    } finally {
      await client.query("update golden_questions set status='retired' where id=any($1)", [
        [fixed, failing],
      ])
    }
  })

  it('detaches the tests of the area a proposal leaves, whoever moves it', async () => {
    const id = 'attached-left-behind'
    const saved = await saveQuestion(
      id,
      { from: '2026-08-01', to: '2026-08-31' },
      { status: 'no_match' },
    )
    expect(saved.statusCode, saved.body).toBe(200)
    await client.query(
      "insert into area_assignments(area_id,person_id,role) values('marketing',$1,'owner')",
      [people.owner],
    )
    try {
      const created = await call('POST', '/proposals', 'author', {
        draft: draft({ title: 'Moving to marketing' }),
      })
      const p = created.json<ProposalRecord>()
      await call('POST', `/proposals/${p.id}/tests`, 'author', { question: id })
      await call('POST', `/proposals/${p.id}/submit`, 'author', { revision: p.revision })
      const { proposal } = await review(p.id)
      // The author may no longer detach a sent proposal's tests, and a review edit moves it.
      const moved = await call('POST', `/proposals/${p.id}/review-edits`, 'owner', {
        revision: proposal.revision,
        areaId: 'marketing',
        reason: 'Marketing reports this',
      })
      expect(moved.statusCode, moved.body).toBe(200)
      expect((await call('GET', `/proposals/${p.id}/tests`, 'author')).json()).toEqual([])
      expect((await audited(p.id)).at(-1)).toEqual({
        action: 'proposal.test_detached',
        actor: people.owner,
        details: { question: id, reason: 'area_changed' },
      })
      expect((await client.query('select * from audit_verify()')).rows).toEqual([])
    } finally {
      await client.query(
        "delete from area_assignments where area_id='marketing' and person_id=$1 and role='owner'",
        [people.owner],
      )
      await client.query("update golden_questions set status='retired' where id=$1", [id])
    }
  })
})
