import { createHash } from 'node:crypto'
import { ORPCError } from '@orpc/client'
import type { RetrievalPoint, RetrievalRun } from '../../../contract/evals.ts'
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

/**
 * The areas the reader may see results of: all for an administrator (null), else the ones they
 * maintain. Asking for an area they do not maintain, or maintaining none, is refused.
 */
export async function readableAreas(
  tx: Queryable,
  area: string | undefined,
): Promise<string[] | null> {
  const [me] = await tx.query<{ admin: boolean; areas: string[] }>(
    `select cl_is_admin_now() as admin,
            coalesce(array_agg(a.id order by a.id) filter (where cl_is_owner_now(a.id)),'{}') as areas
       from areas a`,
  )
  const refuse = () =>
    new ORPCError('FORBIDDEN', {
      message: 'Only the owners of the domain and admins can see its test results.',
    })
  if (me?.admin) return area ? [area] : null
  const mine = me?.areas ?? []
  if (area) {
    if (!mine.includes(area)) throw refuse()
    return [area]
  }
  if (!mine.length) throw refuse()
  return mine
}

const failedChecks = `jsonb_build_object(
    'served',count(*) filter (where (x.checks->>'served')::boolean is false),
    'delivered',count(*) filter (where (x.checks->>'delivered')::boolean is false),
    'not_delivered',count(*) filter (where (x.checks->>'not_delivered')::boolean is false),
    'status',count(*) filter (where (x.checks->>'status')::boolean is false))`

type Point = RetrievalPoint

/** Runs with their counts over the given areas (all when null), newest first. */
async function points(
  tx: Queryable,
  areas: string[] | null,
  where: string,
  params: unknown[],
  limit: number,
): Promise<Point[]> {
  const offset = params.length
  return tx.query<Point>(
    `select r.id::text,e.label as edition,r.as_of::text as "asOf",r.trigger::text as trigger,
            r.created_at::text as "createdAt",encode(r.test_set_digest,'hex') as "testSetDigest",
            count(x.question_id)::int as questions,
            (count(*) filter (where x.passed))::int as passed,
            (count(*) filter (where not x.passed))::int as failed,
            coalesce((select sum(value::int) from jsonb_each_text(r.set_aside)
                       where $${offset + 1}::text[] is null or key=any($${offset + 1})),0)::int as "setAside",
            ${failedChecks} as "failedChecks"
       from retrieval_runs r join editions e on e.seq=r.edition_seq
       left join retrieval_results x on x.run_id=r.id
        and ($${offset + 1}::text[] is null or x.area_id=any($${offset + 1}))
      where ${where}
      group by r.id,e.label order by r.created_at desc,r.id desc limit $${offset + 2}`,
    [...params, areas, limit],
  )
}

async function withResults(
  tx: Queryable,
  point: Point | undefined,
  areas: string[] | null,
): Promise<RetrievalRun | null> {
  if (!point) return null
  const results = await tx.query<RetrievalRun['results'][number]>(
    `select question_id as id,question_revision as revision,area_id as area,split::text as split,
            passed,checks,wordings
       from retrieval_results where run_id=$1 and ($2::text[] is null or area_id=any($2))
      order by area_id,question_id`,
    [point.id, areas],
  )
  return { ...point, results }
}

export function createRetrievalService(tx: Queryable) {
  return {
    /** The newest pass of the live edition. */
    async latest(area?: string) {
      const areas = await readableAreas(tx, area)
      const head = await liveHead(tx)
      if (!head) return { edition: null, run: null }
      const [point] = await points(tx, areas, 'r.edition_seq=$1', [head.seq], 1)
      return { edition: head.label, run: await withResults(tx, point, areas) }
    },
    /** The newest pass of one sealed edition, by its label. */
    async edition(label: string, area?: string) {
      const areas = await readableAreas(tx, area)
      const [edition] = await tx.query<{ seq: string }>(
        'select seq::text from editions where label=$1 and sealed_at is not null',
        [label],
      )
      if (!edition)
        throw new ORPCError('NOT_FOUND', { message: "We couldn't find these test results." })
      const [point] = await points(tx, areas, 'r.edition_seq=$1', [edition.seq], 1)
      return { edition: label, run: await withResults(tx, point, areas) }
    },
    /** Every pass, newest first: one point per edition sealed and per day of a live edition. */
    async trend(area?: string, limit = 52) {
      const areas = await readableAreas(tx, area)
      return points(tx, areas, 'true', [], limit)
    },
  }
}
export type RetrievalService = ReturnType<typeof createRetrievalService>
