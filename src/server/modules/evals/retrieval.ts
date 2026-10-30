import { createHash } from 'node:crypto'
import { canonicalJson } from '../../../domain/canonical.ts'
import {
  retrievalChecks,
  type GoldenQuestion,
  type RetrievalChecks,
} from '../../../domain/golden-question.ts'
import type { Clock } from '../../clock.ts'
import type { Database, Queryable } from '../../db/database.ts'
import { asDelivered, loadServingBundle, type ServingBundle } from '../editions/index.ts'
import { previewDelivery } from '../proposals/index.ts'
import { loadActiveQuestions, questionClock, testSetDigest } from './plan.ts'
import { headAt, liveHead, type Head } from './runs.ts'

/**
 * The retrieval pass: the level 3 delivery check of FR-507, run on every edition over the
 * whole active test set as a score, with no model. Each question's wordings go through
 * get_facts's own code; a question passes when every wording is served, delivers the expected
 * items, leaves the forbidden ones out and gives the expected check-report status. It is checked
 * as delivered once nothing stops its area, like the review gate's level 3.
 * Only ids and booleans are stored, never a wording's text.
 */

type Reply = {
  status?: string
  items?: { id: string; version?: number; freshness?: string }[]
  check_report?: { cut_ids?: string[] }
}

/** get_facts's reply for one input on one edition held in memory, recording nothing. */
export async function deliver(bundle: ServingBundle, clock: Clock, input: object): Promise<Reply> {
  return (await previewDelivery(bundle, clock, input)).structuredContent
}
/**
 * get_context's reply, as agents get it, for one input on one edition held in memory, recording
 * nothing: the full reply unless the input asks for the concise one.
 */
export async function deliverContext(
  bundle: ServingBundle,
  clock: Clock,
  input: object,
): Promise<Record<string, unknown>> {
  return (
    await previewDelivery(bundle, clock, { response_format: 'full', ...input }, null, 'get_context')
  ).structuredContent
}
export const deliveredIds = (reply: Reply) => (reply.items ?? []).map((i) => i.id)

export type RetrievalTrigger = 'edition' | 'daily'
type WordingResult = {
  passed: boolean
  status: string | null
  missing: string[]
  forbidden: string[]
}
type QuestionRow = {
  id: string
  revision: number
  area: string
  split: GoldenQuestion['split']
  passed: boolean
  checks: RetrievalChecks
  wordings: WordingResult[]
  digest: string
}

const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')

async function checkQuestion(
  bundle: ServingBundle,
  clock: Clock,
  id: string,
  revision: number,
  body: GoldenQuestion,
): Promise<QuestionRow> {
  const wordings: WordingResult[] = []
  const all: RetrievalChecks[] = []
  const digests: string[] = []
  for (const wording of body.wordings) {
    const reply = await deliver(bundle, questionClock(clock, body), {
      question: wording.text,
      ...body.scope,
    })
    const delivered = deliveredIds(reply)
    const status = reply.status ?? null
    const checks = retrievalChecks(body.expected, { status, delivered })
    all.push(checks)
    // What the agent is given, by date: the items, their versions and whether they are past review.
    digests.push(
      sha({
        status,
        items: (reply.items ?? []).map((i) => [i.id, i.version ?? null, i.freshness ?? null]),
        cut: reply.check_report?.cut_ids ?? [],
      }),
    )
    wordings.push({
      passed: Object.values(checks).every(Boolean),
      status,
      missing: body.expected.must_deliver.filter((x) => !delivered.includes(x)),
      forbidden: body.expected.must_not_deliver.filter((x) => delivered.includes(x)),
    })
  }
  const every = (name: keyof RetrievalChecks) => all.every((c) => c[name] !== false)
  const checks: RetrievalChecks = {
    served: every('served'),
    delivered: every('delivered'),
    not_delivered: every('not_delivered'),
    ...(body.expected.status ? { status: every('status') } : {}),
  }
  return {
    id,
    revision,
    area: body.area,
    split: body.split,
    passed: wordings.every((w) => w.passed),
    checks,
    wordings,
    digest: sha(digests),
  }
}

/**
 * One pass over an edition, saved once: a second call for the same edition (or the same day of
 * the live edition) saves nothing and returns null, so the job is safe to run twice (NFR-047).
 */
export async function runRetrievalPass(
  tx: Queryable,
  clock: Clock,
  head: Head,
  trigger: RetrievalTrigger,
): Promise<{ id: string; questions: number; passed: number } | null> {
  const { questions, setAside } = await loadActiveQuestions(tx, null)
  const live = await loadServingBundle(tx, head)
  const bundles = new Map<string, ServingBundle>()
  const rows: QuestionRow[] = []
  for (const q of questions) {
    let bundle = bundles.get(q.body.area)
    if (!bundle) bundles.set(q.body.area, (bundle = asDelivered(live, q.body.area)))
    rows.push(await checkQuestion(bundle, clock, q.id, q.revision, q.body))
  }
  const [areas] = await tx.query<{ counts: Record<string, number> }>(
    `select coalesce(jsonb_object_agg(area_id,n),'{}') as counts
       from (select area_id,count(*)::int as n from golden_questions where id=any($1) group by area_id) a`,
    [setAside],
  )
  const conflict =
    trigger === 'edition'
      ? `(edition_seq) where trigger='edition'`
      : `(edition_seq,as_of) where trigger='daily'`
  const [run] = await tx.query<{ id: string }>(
    `insert into retrieval_runs(edition_seq,overlay_seq,as_of,trigger,test_set_digest,questions,passed,set_aside)
     values($1,$2,$3,$4,decode($5,'hex'),$6,$7,$8)
     on conflict ${conflict} do nothing returning id::text`,
    [
      head.seq,
      head.overlay,
      clock.today(),
      trigger,
      testSetDigest(questions),
      rows.length,
      rows.filter((r) => r.passed).length,
      JSON.stringify(areas?.counts ?? {}),
    ],
  )
  if (!run) return null
  if (rows.length)
    await tx.query(
      `insert into retrieval_results(run_id,question_id,question_revision,area_id,split,passed,checks,wordings,delivery_digest)
       select $1,r.id,r.revision,r.area,r.split::question_split,r.passed,r.checks,r.wordings,decode(r.digest,'hex')
         from jsonb_to_recordset($2::jsonb) as r(id text,revision int,area text,split text,passed boolean,
                                                  checks jsonb,wordings jsonb,digest text)`,
      [run.id, JSON.stringify(rows)],
    )
  return { id: run.id, questions: rows.length, passed: rows.filter((r) => r.passed).length }
}

export type RetrievalWork = {
  /** Editions sealed since the last pass that got their pass now. */
  editions: number
  /** Whether the live edition got its pass for today. */
  daily: boolean
}

/**
 * The `evals.retrieval` job's work: a pass for every edition sealed since the newest one passed
 * (the live edition the first time), then the live edition's pass for today when it has none.
 * Today's pass against the previous pass of the same edition and serving overlay shows what
 * changed with the date alone (an expiry); triggers.ts queues full answer runs for it.
 */
export async function workRetrieval(database: Database, clock: Clock): Promise<RetrievalWork> {
  const work: RetrievalWork = { editions: 0, daily: false }
  const sealed = await database.query<{ seq: string }>(
    `select e.seq::text from editions e
      where e.sealed_at is not null
        and e.seq > coalesce((select max(edition_seq) from retrieval_runs), (select seq from live_edition) - 1)
        and not exists (select 1 from retrieval_runs r where r.edition_seq=e.seq and r.trigger='edition')
      order by e.seq limit 10`,
  )
  for (const { seq } of sealed) {
    const saved = await database.transaction(null, async (tx) =>
      runRetrievalPass(tx, clock, await headAt(tx, seq), 'edition'),
    )
    if (saved) work.editions++
  }
  const head = await liveHead(database)
  if (!head) return work
  const [today] = await database.query(
    'select 1 from retrieval_runs where edition_seq=$1 and as_of=$2',
    [head.seq, clock.today()],
  )
  if (today) return work
  const saved = await database.transaction(null, (tx) => runRetrievalPass(tx, clock, head, 'daily'))
  work.daily = saved !== null
  return work
}

// Reading results: owners and deputies of an area, and administrators (the data platform team).
