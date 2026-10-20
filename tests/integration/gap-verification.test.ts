import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Verdict } from '../../src/domain/golden-question.ts'
import type { Queryable } from '../../src/server/db/database.ts'
import { createGapsService, verifyGapsByRun } from '../../src/server/modules/gaps/index.ts'
import { finishRun, runColumns, type RunRow } from '../../src/server/modules/evals/runs.ts'
import { visibleEvent } from '../../src/server/modules/notifications/visibility.ts'
import { foundation, openEdition, people, servingEdition } from './fixtures.ts'
import { apiDatabase, testDatabase, transaction } from './support.ts'

/*
  Slice V3, FR-610: verify by test when a run finishes. Each run here is stored as the runner
  stores it and finished through `finishRun`, in a transaction without a person as a scheduled
  run's is, so the verification takes the real path: the owner-run functions of 0045, the domain
  rules, the history log and the owners' notification. The scripted model's weekly run that
  verifies a gap end to end is in evals.test.ts.
*/

const { client, url } = testDatabase()
const database = apiDatabase(url)
const clock = { now: () => new Date(), today: () => new Date().toISOString().slice(0, 10) }
const thisHour = () => new Date().toISOString().slice(0, 13) + ':00:00.000Z'

let first: string
let live: string

/** Publishes an empty edition and returns its sequence number: the live edition moves on. */
async function nextEdition() {
  return transaction(client, async () => {
    const seq = await openEdition(client)
    await client.query('select edition_seal($1)', [seq])
    await client.query('select edition_publish($1)', [seq])
    live = seq
    return seq
  })
}
const labelOf = async (seq: string) =>
  (await client.query<{ label: string }>('select label from editions where seq=$1', [seq])).rows[0]!
    .label

/** A gap of the area that every reader sees: its week reaches the minimum count. */
async function shownGap(area: string | null = 'finance', metrics = ['metric:orders']) {
  const topic = await client.query<{ id: string }>(
    'insert into topics (key,area_id,metric_keys,value_keys,month) values ($1,$2,$3,$4,$5) returning id',
    [
      `verify|${randomUUID()}`,
      area,
      metrics,
      ['val:market/norway'],
      new Date().toISOString().slice(0, 7) + '-01',
    ],
  )
  const id = topic.rows[0]!.id
  for (let i = 0; i < 5; i++)
    await client.query(
      `insert into deliveries (delivered_hour,client_label,caller,edition_seq,overlay_seq,tool_schema_digest,topic_id,scope,status,delivered)
       values (date_trunc('hour', now(), 'UTC'),'claude-code','agent',$1,0,'digest',$2,'{}','no_match','[]')`,
      [first, id],
    )
  return (
    await client.query<{ id: string }>(
      "select cl_gap_touch($1,'missing',2::smallint,now(),null,5)::text as id",
      [id],
    )
  ).rows[0]!.id
}

const as = <T>(person: string, work: (gaps: ReturnType<typeof createGapsService>) => Promise<T>) =>
  database.transaction(person, (tx) => work(createGapsService(tx, clock, person)))
const link = (gap: string, ...questions: string[]) =>
  as(people.owner, async (gaps) => {
    for (const question of questions) await gaps.linkTest(gap, question)
  })
const setStatus = (gap: string, status: 'open' | 'resolved' | 'wont_fix') =>
  as(people.owner, (gaps) => gaps.setStatus(gap, status, 'Checked'))

type RunOptions = {
  kind?: 'scheduled' | 'full' | 'impact'
  area?: string
  edition?: string
  proposal?: string | null
}
/** A run as the runner stores it before its results: planned, running, on an edition. */
async function startedRun(questions: string[], options: RunOptions = {}) {
  const result = await client.query<{ id: string }>(
    `insert into eval_runs (kind,state,area_id,proposal_id,baseline_edition_seq,tool_schema_digest,model_id,
                            judge_model_id,client_label,test_set_digest,tries,estimated_cost_micros,started_at,summary)
     values ($1,'running',$2,$3,$4,'x','mock/scripted-answer','mock/scripted-judge','eval','\\x00',3,0,now(),$5)
     returning id::text`,
    [
      options.kind ?? 'scheduled',
      options.area ?? 'finance',
      options.proposal ?? null,
      options.edition ?? live,
      JSON.stringify({
        edition: await labelOf(options.edition ?? live),
        plan: {
          questions: questions.map((id) => ({ id, revision: 1, impact: false, keys: {} })),
          setAside: [],
        },
        estimate: { cells: 0, cached: 0, micros: 0 },
      }),
    ],
  )
  return result.rows[0]!.id
}
/** Finishes the run with these verdicts, as the worker does: in one transaction without a person. */
async function finish(id: string, verdicts: Record<string, Verdict>) {
  return database.transaction(null, async (tx) => {
    const [row] = await tx.query<RunRow>(
      `select ${runColumns} from eval_runs where id=$1 for update`,
      [id],
    )
    return finishRun(
      tx,
      row!,
      Object.entries(verdicts).map(([question, baseline]) => ({
        id: question,
        impact: false,
        baseline,
        candidate: null,
        flip: null,
      })),
    )
  })
}
const run = async (verdicts: Record<string, Verdict>, options: RunOptions = {}) =>
  finish(await startedRun(Object.keys(verdicts), options), verdicts)

const stored = async (gap: string) =>
  (
    await client.query<{ verified_at: Date | null; verified: string | null }>(
      `select g.verified_at, e.label as verified from gaps g left join editions e on e.seq=g.verified_edition_seq
        where g.id=$1`,
      [gap],
    )
  ).rows[0]!
const passes = async (gap: string) =>
  (
    await client.query<{
      question: string
      run: string | null
      edition: string | null
      revision: number | null
    }>(
      `select question_id as question, passed_run::text as run, passed_edition_seq::text as edition,
              passed_revision as revision
         from gap_tests where gap_id=$1 order by question_id`,
      [gap],
    )
  ).rows
const verifiedAudit = async (gap: string) =>
  (
    await client.query<{ actor_id: string | null; actor_kind: string; details: object }>(
      `select a.actor_id, a.actor_kind, a.details from audit_log a join gaps g on g.ref=a.subject_id
        where a.subject_type='gap' and a.action='gap.verified' and g.id=$1 order by a.seq`,
      [gap],
    )
  ).rows
const verifiedEvents = async (gap: string) =>
  (
    await client.query<{ area_id: string; payload: object }>(
      "select area_id, payload from outbox_events where topic='gap.verified' and aggregate_id=$1",
      [gap],
    )
  ).rows

beforeAll(async () => {
  await foundation(client)
  await transaction(client, async () => {
    first = (await servingEdition(client)).edition
    live = first
    await client.query(`insert into golden_questions (id,area_id,wordings,scope,expected,source,split,status) values
      ('v-one','finance','["a","b"]','{}','{}','test','development','active'),
      ('v-two','finance','["a","b"]','{}','{}','test','development','active'),
      ('v-held','finance','["a","b"]','{}','{}','test','held_out','active'),
      ('v-retired','finance','["a","b"]','{}','{}','test','development','retired'),
      ('v-marketing','marketing','["a","b"]','{}','{}','test','development','active')`)
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('marketing',$1,'owner')",
      [people.stranger],
    )
  })
})
afterAll(async () => {
  await database.close()
})

describe('verify by test when a run finishes (FR-610)', () => {
  it('leaves a gap unverified while its test fails, and verifies it on the fixed edition', async () => {
    const gap = await shownGap()
    await link(gap, 'v-one')
    await setStatus(gap, 'resolved')
    await run({ 'v-one': 'fail' })
    expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
    expect(await passes(gap)).toEqual([
      { question: 'v-one', run: null, edition: null, revision: null },
    ])

    const passed = await run({ 'v-one': 'pass' })
    expect(await passes(gap)).toEqual([
      { question: 'v-one', run: passed.id, edition: live, revision: 1 },
    ])
    expect(await stored(gap)).toEqual({
      verified_at: new Date(thisHour()),
      verified: await labelOf(live),
    })
    // Audited as the service, never a person; neither the history nor the event names a test.
    expect(await verifiedAudit(gap)).toEqual([
      {
        actor_id: null,
        actor_kind: 'service',
        details: { edition: await labelOf(live), run: passed.id },
      },
    ])
    expect(await verifiedEvents(gap)).toEqual([
      { area_id: 'finance', payload: { edition: await labelOf(live) } },
    ])
    const detail = await as(people.owner, (gaps) => gaps.get(gap))
    expect(detail).toMatchObject({
      status: 'resolved',
      verifiedAt: thisHour().replace('.000', ''),
      verifiedEdition: await labelOf(live),
      tests: [{ question: 'v-one', passed: { run: passed.id, edition: await labelOf(live) } }],
    })
    expect(detail.history?.map((entry) => entry.action)).toContain('gap.verified')
  })

  it('counts neither an impact run, a proposal’s full run, nor a run on an older edition', async () => {
    const older = live
    await nextEdition()
    const gap = await shownGap()
    await link(gap, 'v-one')
    await setStatus(gap, 'resolved')
    await run({ 'v-one': 'pass' }, { kind: 'impact' })
    await run({ 'v-one': 'pass' }, { edition: older })
    const proposal = await client.query<{ id: string }>(
      "insert into proposals (action,area_id,proposer_id,channel) values ('create','finance',$1,'form') returning id",
      [people.author],
    )
    await run({ 'v-one': 'pass' }, { kind: 'full', proposal: proposal.rows[0]!.id })
    expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
    expect((await passes(gap))[0]!.run).toBeNull()

    // A full run of the area on the resolving edition counts, as a weekly one does.
    const full = await run({ 'v-one': 'pass' }, { kind: 'full' })
    expect((await passes(gap))[0]!.run).toBe(full.id)
    expect((await stored(gap)).verified).toBe(await labelOf(live))
  })

  it('needs every linked active test to pass, each recorded at its first pass', async () => {
    const gap = await shownGap()
    await link(gap, 'v-one', 'v-two', 'v-retired')
    await setStatus(gap, 'resolved')
    const firstPass = await run({ 'v-one': 'pass', 'v-two': 'fail' })
    expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
    await nextEdition()
    // The second run passes both; v-one keeps its first pass, and the retired test is set aside.
    const both = await run({ 'v-one': 'pass', 'v-two': 'pass' })
    expect(await passes(gap)).toEqual([
      {
        question: 'v-one',
        run: firstPass.id,
        edition: firstPass.baseline_edition_seq,
        revision: 1,
      },
      { question: 'v-retired', run: null, edition: null, revision: null },
      { question: 'v-two', run: both.id, edition: live, revision: 1 },
    ])
    // Verified on the edition of the last pass needed.
    expect(await stored(gap)).toEqual({
      verified_at: new Date(thisHour()),
      verified: await labelOf(live),
    })
  })

  it('verifies with a held-out test, named only to the gap’s managers', async () => {
    const gap = await shownGap()
    await link(gap, 'v-held')
    await setStatus(gap, 'resolved')
    await run({ 'v-held': 'pass' })
    const label = await labelOf(live)
    const reader = await as(people.author, (gaps) => gaps.get(gap))
    expect(reader).toMatchObject({
      verifiedAt: thisHour().replace('.000', ''),
      verifiedEdition: label,
    })
    expect(reader.tests).toBeNull()
    expect(reader.history).toBeNull()
    expect(JSON.stringify([await verifiedAudit(gap), await verifiedEvents(gap)])).not.toContain(
      'v-held',
    )
  })

  it('tells the area’s owners, and nobody else', async () => {
    const gap = await shownGap()
    await link(gap, 'v-two')
    await setStatus(gap, 'resolved')
    await client.query(
      "insert into area_assignments (area_id,person_id,role) values ('finance',$1,'owner')",
      [people.approver],
    )
    try {
      await run({ 'v-two': 'pass' })
      await client.query('select cl_outbox_relay(1000)')
      const inbox = await client.query<{ person_id: string; subject_type: string }>(
        "select person_id::text, subject_type from inbox_items where kind='gap.verified' and subject_id=$1 order by person_id",
        [gap],
      )
      expect(inbox.rows).toEqual(
        [
          { person_id: people.owner, subject_type: 'gap' },
          { person_id: people.approver, subject_type: 'gap' },
        ].sort((a, b) => a.person_id.localeCompare(b.person_id)),
      )
      // On the live stream, the event is for the gap's managers only.
      const sees = (person: string) =>
        database.transaction(
          person,
          async (tx) =>
            (
              await tx.query(
                `select 1 from outbox_events o where o.topic='gap.verified' and o.aggregate_id=$1 and ${visibleEvent}`,
                [gap],
              )
            ).length === 1,
        )
      expect(await sees(people.owner)).toBe(true)
      expect(await sees(people.admin)).toBe(true)
      expect(await sees(people.author)).toBe(false)
      expect(await sees(people.stranger)).toBe(false)
    } finally {
      await client.query(
        "delete from area_assignments where area_id='finance' and person_id=$1 and role='owner'",
        [people.approver],
      )
    }
  })

  it('keeps a verification when the test fails later or another is linked', async () => {
    const gap = await shownGap()
    await link(gap, 'v-one')
    await setStatus(gap, 'resolved')
    await run({ 'v-one': 'pass' })
    const verified = await stored(gap)
    expect(verified.verified).not.toBeNull()
    await run({ 'v-one': 'fail' })
    await link(gap, 'v-two')
    await run({ 'v-two': 'fail' })
    expect(await stored(gap)).toEqual(verified)
    expect(await verifiedAudit(gap)).toHaveLength(1)
  })

  it('starts afresh when the gap is reopened and resolved again', async () => {
    const gap = await shownGap()
    await link(gap, 'v-one')
    await setStatus(gap, 'resolved')
    await run({ 'v-one': 'pass' })
    await setStatus(gap, 'open')
    expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
    // Reopened, no run verifies it.
    await run({ 'v-one': 'pass' })
    expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
    expect((await passes(gap))[0]!.run).toBeNull()
    await nextEdition()
    await setStatus(gap, 'resolved')
    const again = await run({ 'v-one': 'pass' })
    expect((await passes(gap))[0]!.run).toBe(again.id)
    expect((await stored(gap)).verified).toBe(await labelOf(live))
    expect(await verifiedAudit(gap)).toHaveLength(2)
  })

  it("never verifies a won't-fix gap, nor one resolved before its edition was recorded", async () => {
    const wontFix = await shownGap()
    await link(wontFix, 'v-one')
    await setStatus(wontFix, 'wont_fix')
    const unknown = await shownGap()
    await link(unknown, 'v-one')
    // Resolved before 0043 recorded editions: unknown stays unknown.
    await client.query(
      "update gaps set status='resolved', status_since=date_trunc('hour', now(), 'UTC') where id=$1",
      [unknown],
    )
    await run({ 'v-one': 'pass' })
    for (const gap of [wontFix, unknown]) {
      expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
      expect((await passes(gap))[0]!.run).toBeNull()
    }
  })

  it("leaves another area's gaps alone", async () => {
    const gap = await shownGap('marketing')
    await as(people.admin, (gaps) => gaps.linkTest(gap, 'v-marketing'))
    await as(people.admin, (gaps) => gaps.setStatus(gap, 'resolved'))
    await run({ 'v-one': 'pass' })
    expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
    await run({ 'v-marketing': 'pass' }, { area: 'marketing' })
    expect((await stored(gap)).verified).toBe(await labelOf(live))
  })

  it('changes nothing for a failed or cancelled run, nor when a run is finished again', async () => {
    const gap = await shownGap()
    await link(gap, 'v-one')
    await setStatus(gap, 'resolved')
    for (const state of ['failed', 'cancelled']) {
      const id = await startedRun(['v-one'])
      const summary = { result: { questions: [{ id: 'v-one', baseline: 'pass' }] } }
      await client.query(
        'update eval_runs set state=$2, finished_at=now(), summary=summary||$3::jsonb where id=$1',
        [id, state, JSON.stringify(summary)],
      )
      const verified = await database.transaction(null, async (tx) => {
        const [row] = await tx.query<RunRow>(`select ${runColumns} from eval_runs where id=$1`, [
          id,
        ])
        return verifyGapsByRun(tx, row!)
      })
      expect(verified, state).toEqual([])
      expect(await stored(gap)).toEqual({ verified_at: null, verified: null })
    }
    const passed = await run({ 'v-one': 'pass' })
    const again = await database.transaction(null, async (tx) => {
      const [row] = await tx.query<RunRow>(`select ${runColumns} from eval_runs where id=$1`, [
        passed.id,
      ])
      return verifyGapsByRun(tx, row!)
    })
    expect(again).toEqual([])
    expect(await verifiedAudit(gap)).toHaveLength(1)
    expect(await verifiedEvents(gap)).toHaveLength(1)
  })
})

describe('the owner-run functions of 0045', () => {
  const asApi = <T>(work: (tx: Queryable) => Promise<T>) => database.transaction(null, work)

  it('read a run’s gap tests only for a finished weekly or full run of an area', async () => {
    const gap = await shownGap()
    await link(gap, 'v-two')
    await setStatus(gap, 'resolved')
    const running = await startedRun(['v-two'])
    const impact = await startedRun(['v-two'], { kind: 'impact' })
    await client.query("update eval_runs set state='finished', finished_at=now() where id=$1", [
      impact,
    ])
    for (const id of [running, impact])
      expect(await asApi((tx) => tx.query('select * from cl_gap_run_tests($1)', [id])), id).toEqual(
        [],
      )
    await client.query("update eval_runs set state='finished', finished_at=now() where id=$1", [
      running,
    ])
    const rows = await asApi((tx) =>
      tx.query<{ gap: string; question: string }>(
        'select gap::text, question from cl_gap_run_tests($1) where gap=$2',
        [running, gap],
      ),
    )
    expect(rows).toEqual([{ gap, question: 'v-two' }])
  })

  it('record a pass only for a question that passed in the run, once', async () => {
    const gap = await shownGap()
    await link(gap, 'v-one', 'v-two')
    await setStatus(gap, 'resolved')
    const id = await startedRun(['v-one', 'v-two'])
    await client.query(
      "update eval_runs set state='finished', finished_at=now(), summary=summary||$2::jsonb where id=$1",
      [
        id,
        JSON.stringify({
          result: {
            questions: [
              { id: 'v-one', baseline: 'pass' },
              { id: 'v-two', baseline: 'fail' },
            ],
          },
        }),
      ],
    )
    const record = (question: string) =>
      asApi(async (tx) => {
        const [row] = await tx.query<{ hour: Date | null }>(
          'select cl_gap_record_pass($1,$2,$3) as hour',
          [id, gap, question],
        )
        return row!.hour
      })
    expect(await record('v-two')).toBeNull()
    expect(await record('v-one')).toEqual(new Date(thisHour()))
    expect(await record('v-one')).toBeNull()
    expect((await passes(gap)).map((pass) => pass.run)).toEqual([id, null])
  })
})

describe('a gap whose topic spans domains (one domain rule, FR-610)', () => {
  const asApi = <T>(work: (tx: Queryable) => Promise<T>) => database.transaction(null, work)

  /** A marketing metric the live edition serves, so a topic of it and Orders spans two domains. */
  async function serveSpend() {
    await transaction(client, async () => {
      await client.query(
        "insert into vocab_terms (key,kind,parent_key) values ('metric:spend','metric',null)",
      )
      const term = await client.query<{ id: string }>(
        "insert into vocab_term_versions (term_key,version_no,name,area_id,content_digest) values ('metric:spend',1,'Spend','marketing',sha256('spend')) returning id",
      )
      const proposal = await client.query<{ id: string }>(
        "insert into proposals (subject,action,state,area_id,vocab_version_id,proposer_id,channel) values ('vocabulary','create','submitted','marketing',$1,$2,'form') returning id",
        [term.rows[0]!.id, people.author],
      )
      await client.query(
        "insert into decisions (proposal_id,vocab_version_id,area_id,decided_by,capacity,outcome,reason) values ($1,$2,'marketing',$3,'owner','accept','Reviewed vocabulary')",
        [proposal.rows[0]!.id, term.rows[0]!.id, people.stranger],
      )
      const seq = await openEdition(client)
      await client.query('select edition_serve_vocab_version($1,$2)', [seq, term.rows[0]!.id])
      await client.query('select edition_seal($1)', [seq])
      await client.query('select edition_publish($1)', [seq])
      live = seq
    })
  }

  it('links the tests of its domains, runs them with each domain’s run, and verifies it once all pass', async () => {
    await serveSpend()
    const gap = await shownGap(null, ['metric:orders', 'metric:spend'])
    const domains = await asApi((tx) =>
      tx.query<{ domains: string[] }>(
        "select cl_topic_domains(null, '{metric:orders,metric:spend}') as domains",
      ),
    )
    expect(domains[0]!.domains).toEqual(['finance', 'marketing'])

    await client.query(
      "insert into areas (id,name) values ('sales','Sales'); insert into golden_questions (id,area_id,wordings,scope,expected,source,split,status) values ('v-sales','sales','[\"a\",\"b\"]','{}','{}','test','development','active')",
    )
    await expect(as(people.admin, (gaps) => gaps.linkTest(gap, 'v-sales'))).rejects.toThrow(
      'another domain than the gap',
    )
    await as(people.admin, async (gaps) => {
      await gaps.linkTest(gap, 'v-one')
      await gaps.linkTest(gap, 'v-marketing')
    })
    await as(people.owner, (gaps) => gaps.setStatus(gap, 'resolved', 'Checked'))

    // A run of either domain reads both of the gap's tests.
    for (const area of ['finance', 'marketing']) {
      const id = await startedRun(['v-one', 'v-marketing'], { area })
      await client.query("update eval_runs set state='finished', finished_at=now() where id=$1", [
        id,
      ])
      const rows = await asApi((tx) =>
        tx.query<{ question: string }>(
          'select question from cl_gap_run_tests($1) where gap=$2 order by question',
          [id, gap],
        ),
      )
      expect(
        rows.map((row) => row.question),
        area,
      ).toEqual(['v-marketing', 'v-one'])
    }

    // Marketing's run passes its test: recorded, but the finance test still waits.
    const marketing = await run({ 'v-marketing': 'pass' }, { area: 'marketing' })
    expect(await passes(gap)).toEqual([
      { question: 'v-marketing', run: marketing.id, edition: live, revision: 1 },
      { question: 'v-one', run: null, edition: null, revision: null },
    ])
    expect(await stored(gap)).toEqual({ verified_at: null, verified: null })

    const finance = await run({ 'v-one': 'pass' }, { area: 'finance' })
    expect((await passes(gap)).map((pass) => pass.run)).toEqual([marketing.id, finance.id])
    expect((await stored(gap)).verified).toBe(await labelOf(live))
    expect(await verifiedEvents(gap)).toEqual([
      { area_id: 'finance', payload: { edition: await labelOf(live) } },
    ])
  })
})
