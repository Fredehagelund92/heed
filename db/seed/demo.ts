import type pg from 'pg'
import type { ContextItem } from '../../src/domain/item.ts'
import { textFindings } from '../../src/domain/draft.ts'
import { goldenQuestionSchema } from '../../src/domain/golden-question.ts'
import { shiftDate } from '../../src/domain/validity.ts'
import type { Clock } from '../../src/server/clock.ts'
import { calendarDateTypes, type Database, type Queryable } from '../../src/server/db/database.ts'
import { identifier } from '../../src/server/db/roles.ts'
import {
  liveHead,
  queueAreaRun,
  runRetrievalPass,
  workEvaluations,
  type RunSummary,
} from '../../src/server/modules/evals/index.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { gapFixtures } from './fixtures/gaps.ts'
import { generateItems, regression } from './fixtures/items.ts'
import { areas } from './fixtures/reference-data.ts'
import { bulkSeed, seedPersonId, type LibraryExtras } from './bulk.ts'
import { seedGaps } from './gaps.ts'
import { demoTestQuestions } from './test-questions.ts'

/*
  What the Quality page, Gaps and the Workbench read, on top of the bulk seed: the mock's gaps
  (gaps.ts), test questions in every area (test-questions.ts), a retrieval pass of every edition
  sealed since the first questions, and a finished weekly run of every area each Monday for
  the twelve weeks up to the newest edition. Offline and with no key: the runs and passes are the
  service's own, through the MCP gateway with the scripted mock model (MODELS=mock), on the
  edition that was live then and with the clock set to that day. The weekly run of the newest
  Monday fails the demo's regression (`regression` in db/seed/fixtures/items.ts) on its note, and
  the open gap about the same question is linked to it.

  A run plans on the live edition, so each Monday the seed points the live edition back to the
  one live then, and restores it after the last run. The service stamps runs and passes with the
  time it made them; the seed moves those stamps to the day they stand for, with the
  append-only guard of the retrieval tables off inside its transaction, as the bulk seed does.
*/

/** Weekly runs the demo keeps per area: the twelve the Quality page's history shows. */
const WEEKS = 12

const at = (day: string, time: string) => `${day}T${time}:00Z`
const mondayOf = (day: string) =>
  shiftDate(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7))
const clockAt = (day: string, time = '12:00'): Clock => ({
  now: () => new Date(at(day, time)),
  today: () => day,
})

/**
 * The service's database on the seed's one connection, inside the seed's transaction. The
 * evaluation worker answers a few tries at once, so the queries take turns on the connection.
 */
function seedDatabase(client: pg.Client): Database {
  let turn: Promise<unknown> = Promise.resolve()
  const tx: Queryable = {
    query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]) {
      const result = turn.then(
        async () => (await client.query<Row>({ text, values, types: calendarDateTypes })).rows,
      )
      turn = result.catch(() => undefined)
      return result
    },
  }
  return {
    ...tx,
    ping: () => Promise.resolve(),
    async transaction(personId, work) {
      // In turn with every other query: the client runs one at a time.
      await tx.query("select set_config('cl.person_id', $1, true)", [personId ?? ''])
      return work(tx)
    },
    close: () => Promise.resolve(),
  }
}

/** The test questions, as the service saves them, on the days the areas wrote them. */
async function saveQuestion(tx: Queryable, entry: (typeof demoTestQuestions)[number]) {
  const question = goldenQuestionSchema.parse(entry.question)
  if (textFindings(question).length)
    throw new Error(`The demo test question ${question.id} holds sensitive text`)
  const owner = areas.find((area) => area.id === question.area)?.ownerIds[0]
  if (!owner) throw new Error(`No owner writes the test questions of ${question.area}`)
  const author = seedPersonId(owner)
  await tx.query(
    `insert into golden_questions(id,area_id,wordings,scope,expected,rubrics,risk,source,status,split,
       set_aside_reason,revision,created_by,updated_at)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13)`,
    [
      question.id,
      question.area,
      JSON.stringify(question.wordings),
      JSON.stringify(question.scope),
      JSON.stringify(question.expected),
      JSON.stringify(question.rubrics),
      question.risk,
      question.source,
      question.status,
      question.split,
      entry.setAside,
      author,
      entry.savedAt,
    ],
  )
  await tx.query(
    `insert into golden_question_revisions(question_id,revision,body,saved_at,saved_by)
     values($1,1,$2,$3,$4)`,
    [question.id, JSON.stringify(question), entry.savedAt, author],
  )
}

type Step =
  | { at: string; kind: 'questions'; entries: typeof demoTestQuestions }
  | { at: string; kind: 'retrieval'; seq: string; day: string }
  | { at: string; kind: 'weekly'; day: string }

/**
 * The demo's quality history and gaps on a bulk-seeded database (bulk.ts) with the fixture
 * library, in one transaction. It refuses a database that has test questions, runs, retrieval
 * passes or gaps already: it adds to the bulk seed and never replaces anything.
 */
export async function seedDemo(client: pg.Client) {
  const role = await client.query<{ rolsuper: boolean }>(
    'select rolsuper from pg_roles where rolname=current_user',
  )
  if (!role.rows[0]?.rolsuper)
    throw new Error('The demo seed requires a superuser; it moves the live edition and stamps runs')
  const db = seedDatabase(client)
  await client.query('begin')
  try {
    await client.query("select pg_advisory_xact_lock(hashtextextended('heed.bulk_seed',0))")
    // The items the questions expect. One they forbid may be missing: a smaller library leaves
    // out a few, and a missing item is never delivered.
    const named = new Set(
      demoTestQuestions.flatMap(({ question: q }) => q.expected?.must_deliver ?? []),
    )
    const [state] = await db.query<{ items: number; quality: boolean }>(
      `select (select count(*)::int from items where id = any($1)) as items,
              exists (select 1 from golden_questions union all select 1 from eval_runs
                      union all select 1 from retrieval_runs union all select 1 from gaps
                      union all select 1 from topics) as quality`,
      [[...named]],
    )
    if (state!.quality)
      throw new Error(
        'The demo seed requires a database without test questions, runs, retrieval passes or gaps; it never replaces them',
      )
    const live = await liveHead(db)
    if (!live || state!.items !== named.size)
      throw new Error('The demo seed requires the bulk seed of the 1,500 fixture items first')
    await seedGaps(client)

    // The timeline: questions as they were written, a retrieval pass as each edition was sealed,
    // and the weekly runs, oldest first.
    const [{ day: liveDay }] = (await db.query<{ day: string }>(
      `select (created_at at time zone 'UTC')::date::text as day from editions where seq=$1`,
      [live.seq],
    )) as [{ day: string }]
    const lastMonday = mondayOf(liveDay)
    const mondays = Array.from({ length: WEEKS }, (_, i) =>
      shiftDate(lastMonday, -7 * (WEEKS - 1 - i)),
    )
    const firstSave = demoTestQuestions.map((q) => q.savedAt).sort()[0]!
    const editions = await db.query<{ seq: string; at: string; day: string }>(
      `select e.seq::text,to_char(e.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') as at,
              (e.created_at at time zone 'UTC')::date::text as day
         from editions e where e.sealed_at is not null and e.created_at > $1 and e.seq <= $2
        order by e.seq`,
      [firstSave, live.seq],
    )
    const steps: Step[] = [
      ...[...new Set(demoTestQuestions.map((q) => q.savedAt))].map((savedAt): Step => ({
        at: savedAt,
        kind: 'questions',
        entries: demoTestQuestions.filter((q) => q.savedAt === savedAt),
      })),
      ...editions.map((e): Step => ({ at: e.at, kind: 'retrieval', seq: e.seq, day: e.day })),
      ...mondays.map((day): Step => ({ at: at(day, '04:00'), kind: 'weekly', day })),
    ].sort((a, b) => a.at.localeCompare(b.at))

    const port = createModelPort({ mode: 'mock' })
    const logger = createLogger({ level: 'silent' })
    for (const table of ['retrieval_runs', 'retrieval_results'])
      await client.query(`alter table ${identifier(table)} disable trigger user`)
    for (const step of steps) {
      if (step.kind === 'questions') {
        for (const entry of step.entries) await saveQuestion(db, entry)
      } else if (step.kind === 'retrieval') {
        const [head] = await db.query<{ seq: string; label: string; overlay: string }>(
          `select seq::text,label,coalesce((select seq::text from serving_overlay),'0') as overlay
             from editions where seq=$1`,
          [step.seq],
        )
        const pass = await runRetrievalPass(db, clockAt(step.day), head!, 'edition')
        if (!pass) throw new Error(`The edition ${head!.label} has a retrieval pass already`)
        // Five minutes after the edition was sealed, as the minutely job would have made it.
        await db.query(
          `update retrieval_runs set created_at=$2::timestamptz + interval '5 minutes' where id=$1`,
          [pass.id, step.at],
        )
      } else {
        await weeklyRuns(client, db, port, logger, step.day)
      }
    }
    await client.query('update live_edition set seq=$1', [live.seq])
    for (const table of ['retrieval_runs', 'retrieval_results'])
      await client.query(`alter table ${identifier(table)} enable trigger user`)
    await linkRegressionGap(db, lastMonday)
    await client.query('commit')
  } catch (error) {
    await client.query('rollback')
    throw error
  }
}

/**
 * The weekly run of every live area with active test questions, on the edition live at 04:00
 * that Monday, worked to the end by the evaluation worker and stamped as finished by 04:30.
 */
async function weeklyRuns(
  client: pg.Client,
  db: Database,
  port: ReturnType<typeof createModelPort>,
  logger: ReturnType<typeof createLogger>,
  day: string,
) {
  const [edition] = await db.query<{ seq: string }>(
    `select e.seq::text from editions e where e.sealed_at is not null and e.created_at <= $1
      order by e.seq desc limit 1`,
    [at(day, '04:00')],
  )
  await client.query('update live_edition set seq=$1', [edition!.seq])
  const due = await db.query<{ area: string }>(
    `select a.id as area from areas a
      where a.archived_at is null and exists (select 1 from golden_questions q where q.area_id=a.id
                                               and q.status='active' and q.set_aside_reason is null)
      order by a.id`,
  )
  const deps = { port, clock: clockAt(day, '04:00') }
  for (const [index, { area }] of due.entries()) {
    const run = await queueAreaRun(db, deps, area, 'scheduled', false)
    if (run?.state !== 'queued')
      throw new Error(`The weekly run of ${area} on ${day} was not queued (${run?.state})`)
    await workEvaluations(db, deps, {
      only: run.id,
      deadline: Number.POSITIVE_INFINITY,
      signal: new AbortController().signal,
      logger,
    })
    const [done] = await db.query<{ state: string; failure: string | null }>(
      'select state::text,failure from eval_runs where id=$1',
      [run.id],
    )
    if (done?.state !== 'finished')
      throw new Error(`The weekly run of ${area} on ${day} did not finish: ${done?.failure}`)
    const started = at(day, `04:0${index}`)
    const finished = at(day, `04:${30 + 2 * index}`)
    await db.query('update eval_runs set created_at=$2,started_at=$2,finished_at=$3 where id=$1', [
      run.id,
      started,
      finished,
    ])
    await db.query('update eval_cells set started_at=$2,finished_at=$3 where run_id=$1', [
      run.id,
      started,
      finished,
    ])
    // The next run's scorecard reads its baseline as the newest one set.
    await db.query('update eval_baselines set set_at=$2 where run_id=$1', [run.id, finished])
    await db.query(
      "update outbox_events set at=$2 where aggregate_type='eval_run' and aggregate_id=$1",
      [run.id, finished],
    )
  }
}

/**
 * Checks the story the seed tells, so a change to the library cannot quietly break it: every
 * weekly run passes every question, but the newest Sales run fails the regression's question
 * on its note, after the run before passed it: the Sales note it expects ended, so it is no
 * longer delivered (other domains' notes with the same words still carry the caveat, as every
 * domain is served). Then links the open gap agents raised about the
 * same scope (gaps.ts) to that question, with the failing run as its evidence.
 */
async function linkRegressionGap(db: Queryable, lastMonday: string) {
  const runs = await db.query<{ id: string; area: string; day: string; summary: RunSummary }>(
    `select id::text,area_id as area,(finished_at at time zone 'UTC')::date::text as day,summary
       from eval_runs where kind='scheduled' order by finished_at,area_id`,
  )
  let evidence: string | null = null
  for (const run of runs) {
    const card = run.summary.result?.scorecard
    const newest = run.area === 'area_sales' && run.day === lastMonday
    const failing = newest ? [regression.question] : []
    if (!card || JSON.stringify(card.failing) !== JSON.stringify(failing)) {
      const checks = run.summary.result?.questions
        .filter((q) => q.baseline !== 'pass')
        .map((q) => `${q.id} (${q.layers?.baseline.failedChecks.join(', ')})`)
      throw new Error(
        `The weekly run of ${run.area} on ${run.day} fails ${checks?.join('; ')}, not ${JSON.stringify(failing)}`,
      )
    }
    if (!newest) continue
    const question = run.summary.result!.questions.find((q) => q.id === regression.question)
    if (
      JSON.stringify(card.regressions) !== JSON.stringify(failing) ||
      !question?.layers?.baseline.failedChecks.includes('delivered')
    )
      throw new Error(`The weekly run of ${run.day} does not show the regression on its note`)
    evidence = run.id
  }
  const gap = gapFixtures.find((g) => g.topic.includes('metric:net_revenue|val:market/spain'))
  if (!evidence || !gap) throw new Error('The demo has no failing run or gap to link')
  await db.query(
    `insert into gap_tests(gap_id,question_id,evidence_run,linked_hour) values($1,$2,$3,$4)`,
    [gap.id, regression.question, evidence, at(shiftDate(lastMonday, 1), '09:00')],
  )
}

/** What `loadDemo` added. */
export type DemoCounts = {
  items: number
  questions: number
  runs: number
  passes: number
  gaps: number
}

/**
 * The demo on an empty database, as a superuser: the bulk seed of a library (the demo library
 * unless another is given; golden-fixtures.ts has the other), then its quality
 * history and gaps (`seedDemo`). Each step is one transaction; a failed second step leaves the
 * library, which a rerun refuses, so start again from an empty database.
 */
export async function loadDemo(
  client: pg.Client,
  library: { items: ContextItem[]; extras?: LibraryExtras } = { items: generateItems() },
): Promise<DemoCounts> {
  const items = await bulkSeed(client, library.items, library.extras)
  await seedDemo(client)
  const [counts] = (
    await client.query<Omit<DemoCounts, 'items'>>(
      `select (select count(*)::int from golden_questions) as questions,
              (select count(*)::int from eval_runs) as runs,
              (select count(*)::int from retrieval_runs) as passes,
              (select count(*)::int from gaps) as gaps`,
    )
  ).rows
  return { items, ...counts! }
}
