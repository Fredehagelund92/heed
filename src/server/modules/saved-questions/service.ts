import { ORPCError } from '@orpc/client'
import type {
  CheckRun,
  SavedDraft,
  SavedQuestionRecord,
  SavedStatus,
} from '../../../contract/saved-questions.ts'
import { answer, type AnswerBundle } from '../../../domain/answer.ts'
import {
  compareSaved,
  savedAnswerOf,
  triggerOfEdition,
  type CheckTrigger,
  type SavedAnswer,
  type SavedReason,
  type SavedResult,
} from '../../../domain/saved-check.ts'
import type { Clock } from '../../clock.ts'
import type { Database, Queryable } from '../../db/database.ts'
import type { BundleCache } from '../answer/index.ts'
import type { ServingBundle } from '../editions/index.ts'

/**
 * Saved questions and the free check on the service (FR-526, src/domain/saved-check.ts). A saved
 * question keeps a domain's question with its saver's name and the answers it should keep getting
 * (its baselines); each check answers it again with the answer engine on what agents get, with no
 * model, and keeps a result. Row security keeps a domain's saved questions to its owners and the
 * administrators. A check never blocks a publish: the check job runs after the change, and Check
 * now runs in transactions of its own, counting as it goes so the page can say how far it got.
 */

/** What a check reads: the live edition, the stops and flags over it, and the day. */
type Head = { seq: string; label: string; overlay: string }

const headOf = `select e.seq::text, e.label, coalesce((select seq::text from serving_overlay),'0') as overlay
                  from editions e join live_edition l on l.seq = e.seq`

async function liveHead(tx: Queryable): Promise<Head | null> {
  const [head] = await tx.query<Head>(headOf)
  return head ?? null
}

const nothingLive = (what: string) =>
  new ORPCError('PRECONDITION_FAILED', {
    message: `Agents don't get any context yet, so there is ${what}.`,
  })

/** A saved question as a run checks it, with the baseline it is checked against. */
type ToCheck = {
  id: string
  areaId: string
  question: string
  expectItems: string[]
  baselineId: string
  saved: SavedAnswer
}

const toCheck = `select id::text, area_id as "areaId", question, expect_items as "expectItems",
                        baseline_id::text as "baselineId", answer as saved
                   from cl_saved_questions_to_check($1)`

/** The question answered on `bundle`, as get_context answers it, kept as the check keeps it. */
export const answerNow = (bundle: AnswerBundle, question: string, today: string): SavedAnswer =>
  savedAnswerOf(answer(bundle, { question }, { today }))

/** A run's row as the API gives it. */
const runFields = `r.id::text, r.trigger, r.area_id as "areaId",
  case when r.failed_at is not null then 'failed' when r.finished_at is not null then 'done' else 'running' end as state,
  r.checked, r.total, r.started_at::text as "startedAt", coalesce(r.finished_at, r.failed_at)::text as "endedAt"`

const iso = (at: string | null) => (at === null ? null : new Date(at).toISOString())
const runOf = (row: CheckRun): CheckRun => ({
  ...row,
  startedAt: iso(row.startedAt)!,
  endedAt: iso(row.endedAt),
})

/**
 * One check run over the saved questions `reader` manages (every one for the check job, which
 * reads as no person), or one domain's, on what agents get now. The run is counted as it goes, in
 * short transactions of its own, so a page that waits on it reads how far it got; one that fails
 * is marked failed and changes nothing that was checked before it.
 */
export async function runCheck(
  database: Database,
  clock: Clock,
  cache: BundleCache,
  reader: string | null,
  options: { trigger: CheckTrigger; areaId?: string | null; batch?: number },
): Promise<{ run: CheckRun; same: number; changed: number; look: number }> {
  const today = clock.today()
  const batch = options.batch ?? 20
  const start = await database.transaction(reader, async (tx) => {
    const head = await liveHead(tx)
    if (!head) throw nothingLive('nothing to check')
    const questions = await tx.query<ToCheck>(toCheck, [options.areaId ?? null])
    const [run] = await tx.query<{ id: string }>(
      `insert into check_runs (trigger, area_id, started_by, edition, overlay, day, total)
       values ($1, $2, cl_person(), $3, $4, $5, $6) returning id::text`,
      [options.trigger, options.areaId ?? null, head.seq, head.overlay, today, questions.length],
    )
    return { head, questions, run: run!.id }
  })
  const counts: Record<SavedResult, number> = { same: 0, changed: 0, look: 0 }
  try {
    for (let at = 0; at < start.questions.length; at += batch) {
      const part = start.questions.slice(at, at + batch)
      await database.transaction(reader, async (tx) => {
        const bundle = await cache.bundle(tx, start.head)
        for (const q of part) {
          const now = answerNow(bundle, q.question, today)
          const { result, reason } = compareSaved(q.saved, now, q.expectItems)
          counts[result] += 1
          await tx.query(
            `insert into saved_question_results (run_id, question_id, baseline_id, result, reason, answer)
             values ($1, $2, $3, $4, $5, $6)`,
            [start.run, q.id, q.baselineId, result, reason, JSON.stringify(now)],
          )
        }
        await tx.query('update check_runs set checked = checked + $2 where id = $1', [
          start.run,
          part.length,
        ])
      })
    }
  } catch (error) {
    await database
      .transaction(reader, (tx) =>
        tx.query('update check_runs set failed_at = now() where id = $1', [start.run]),
      )
      .catch(() => undefined)
    throw error
  }
  const run = await database.transaction(reader, async (tx) => {
    const [row] = await tx.query<CheckRun>(
      `update check_runs r set finished_at = now() where r.id = $1 returning ${runFields}`,
      [start.run],
    )
    return runOf(row!)
  })
  return { run, ...counts }
}

/**
 * After a suggestion is published from the review, once it is committed: each saved question the
 * publisher manages that answers from its item and that the change moved, at the same certainty or
 * better (Changed), takes what it says now as its saved answer. The review showed that change
 * before Publish; one that got worse stays to be looked at. Runs apart from the publish, so it never
 * blocks one.
 */
export async function adoptPublished(
  database: Database,
  clock: Clock,
  cache: BundleCache,
  publisher: string,
  itemIds: readonly string[],
): Promise<number> {
  if (!itemIds.length) return 0
  return database.transaction(publisher, async (tx) => {
    const head = await liveHead(tx)
    if (!head) return 0
    // What agents got before the publish: the sealed edition before the live one.
    const [before] = await tx.query<Head>(
      `select e.seq::text, e.label, $2::text as overlay from editions e
        where e.sealed_at is not null and e.seq < $1::bigint order by e.seq desc limit 1`,
      [head.seq, head.overlay],
    )
    const questions = await tx.query<ToCheck>(
      `${toCheck} where expect_items && $2::text[]
          or exists (select 1 from jsonb_array_elements(answer -> 'items') i where i ->> 'id' = any($2::text[]))`,
      [null, itemIds],
    )
    const bundle = await cache.bundle(tx, head)
    const previous = before ? await cache.bundle(tx, before) : null
    const adopted: { q: ToCheck; now: SavedAnswer; baseline: string }[] = []
    for (const q of questions) {
      const now = answerNow(bundle, q.question, clock.today())
      // Only a question this publish moved, no worse than before it, and that is not worse than
      // its saved answer either: one that needs a look stays to be looked at.
      const then = previous ? answerNow(previous, q.question, clock.today()) : q.saved
      if (movedBy(then, now, q.expectItems).result !== 'changed') continue
      if (compareSaved(q.saved, now, q.expectItems).result !== 'changed') continue
      const [kept] = await tx.query<{ id: string }>(
        `insert into saved_question_baselines (question_id, answer, edition, why, kept_by)
         values ($1, $2, $3, 'published', cl_person()) returning id::text`,
        [q.id, JSON.stringify(now), head.seq],
      )
      adopted.push({ q, now, baseline: kept!.id })
    }
    if (!adopted.length) return 0
    const [run] = await tx.query<{ id: string }>(
      `insert into check_runs (trigger, started_by, edition, overlay, day, total, checked, finished_at)
       values ('publish', cl_person(), $1, $2, $3, $4, $4, now()) returning id::text`,
      [head.seq, head.overlay, clock.today(), adopted.length],
    )
    for (const { q, now, baseline } of adopted)
      await tx.query(
        `insert into saved_question_results (run_id, question_id, baseline_id, result, reason, answer)
         values ($1, $2, $3, 'same', 'published', $4)`,
        [run!.id, q.id, baseline, JSON.stringify(now)],
      )
    return adopted.length
  })
}

/**
 * What the check job does each minute: once what agents get has moved since its last run (a new
 * edition, a stop or a flag over it from a sync, or a new day, on which a check date may pass), a
 * run over every saved question, named by what moved. Otherwise nothing.
 */
export async function checkIfMoved(
  database: Database,
  clock: Clock,
  cache: BundleCache,
): Promise<{ trigger: CheckTrigger; checked: number } | null> {
  const today = clock.today()
  const moved = await database.transaction(null, async (tx) => {
    const head = await liveHead(tx)
    if (!head) return null
    const [last] = await tx.query<{ edition: string; overlay: string; day: string }>(
      `select edition::text, overlay::text, day::text from check_runs
        where started_by is null and finished_at is not null
        order by started_at desc limit 1`,
    )
    const [questions] = await tx.query<{ n: number }>(
      'select count(*)::int as n from cl_saved_questions_to_check(null)',
    )
    if (!questions?.n) return null
    if (!last) return 'publish' as const
    if (last.edition !== head.seq) {
      const [newest] = await tx.query<{ reason: string }>(
        'select reason::text from editions where seq = $1',
        [head.seq],
      )
      return triggerOfEdition(newest?.reason ?? '')
    }
    if (last.overlay !== head.overlay) return 'sync' as const
    if (last.day !== today) return 'check_date' as const
    return null
  })
  if (!moved) return null
  const done = await runCheck(database, clock, cache, null, { trigger: moved })
  return { trigger: moved, checked: done.run.checked }
}

type ListRow = Omit<SavedQuestionRecord, 'savedAt' | 'result'> & {
  savedAt: string
  result: SavedResult
  reason: SavedReason
  now: SavedAnswer
  checkedAt: string
  trigger: CheckTrigger
}

const listFields = `q.id::text, q.area_id as "areaId", q.question, q.origin,
  json_build_object('personId', q.created_by::text, 'name', p.display_name) as "savedBy",
  q.created_at::text as "savedAt", q.expect_items as "expectItems", b.answer as saved,
  r.result, r.reason, r.answer as now, r.checked_at::text as "checkedAt", c.trigger`
const listFrom = `from saved_questions q
  join people p on p.id = q.created_by
  join lateral (select x.answer from saved_question_baselines x
                 where x.question_id = q.id and x.undone_at is null
                 order by x.kept_at desc, x.id desc limit 1) b on true
  join lateral (select x.* from saved_question_results x where x.question_id = q.id
                 order by x.checked_at desc, x.run_id desc limit 1) r on true
  join check_runs c on c.id = r.run_id
  where q.removed_at is null`

const recordOf = (row: ListRow): SavedQuestionRecord => ({
  id: row.id,
  areaId: row.areaId,
  question: row.question,
  origin: row.origin,
  savedBy: row.savedBy,
  savedAt: iso(row.savedAt)!,
  expectItems: row.expectItems,
  saved: row.saved,
  result: {
    result: row.result,
    reason: row.reason,
    now: row.now,
    checkedAt: iso(row.checkedAt)!,
    trigger: row.trigger,
  },
})

export function createSavedQuestionsService(
  tx: Queryable,
  clock: Clock,
  cache: BundleCache,
): SavedQuestionsService {
  async function one(id: string): Promise<SavedQuestionRecord> {
    const [row] = await tx.query<ListRow>(`select ${listFields} ${listFrom} and q.id = $1`, [id])
    if (!row) throw new ORPCError('NOT_FOUND')
    return recordOf(row)
  }

  async function manages(areaId: string) {
    const [row] = await tx.query<{ manages: boolean; exists: boolean }>(
      `select cl_is_admin_now() or cl_is_owner_now($1) as manages,
              exists (select 1 from areas where id = $1 and archived_at is null) as exists`,
      [areaId],
    )
    if (!row?.exists) throw new ORPCError('NOT_FOUND')
    if (!row.manages)
      throw new ORPCError('FORBIDDEN', {
        message: 'Owners of the domain and admins save questions about it.',
      })
  }

  /** One question's result in a run of its own: when it is saved, or a new answer is kept. */
  async function single(
    q: { id: string; areaId: string },
    head: Head,
    baseline: string,
    trigger: 'saved' | 'kept',
    result: { result: SavedResult; reason: SavedReason; now: SavedAnswer },
  ) {
    const [run] = await tx.query<{ id: string }>(
      `insert into check_runs (trigger, area_id, started_by, edition, overlay, day, total, checked, finished_at)
       values ($1, $2, cl_person(), $3, $4, $5, 1, 1, now()) returning id::text`,
      [trigger, q.areaId, head.seq, head.overlay, clock.today()],
    )
    await tx.query(
      `insert into saved_question_results (run_id, question_id, baseline_id, result, reason, answer)
       values ($1, $2, $3, $4, $5, $6)`,
      [run!.id, q.id, baseline, result.result, result.reason, JSON.stringify(result.now)],
    )
  }

  /** The question answered on the live edition now. */
  async function live(question: string): Promise<{ head: Head; now: SavedAnswer }> {
    const head = await liveHead(tx)
    if (!head) throw nothingLive('no answer to keep')
    const bundle = await cache.bundle(tx, head)
    return { head, now: answerNow(bundle, question, clock.today()) }
  }

  return {
    async list({ areaId }) {
      const rows = await tx.query<ListRow>(
        `select ${listFields} ${listFrom} and ($1::text is null or q.area_id = $1)
          order by q.created_at desc, q.id desc`,
        [areaId ?? null],
      )
      return rows.map(recordOf)
    },

    async create(input) {
      await manages(input.areaId)
      const { head, now } = await live(input.question)
      const given = new Set(now.items.map((i) => i.id))
      const expect = input.expectItems
        ? input.expectItems.filter((id) => given.has(id))
        : [...given]
      const [q] = await tx.query<{ id: string }>(
        `insert into saved_questions (area_id, question, origin, expect_items, created_by)
         values ($1, $2, $3, $4, cl_person()) returning id::text`,
        [input.areaId, input.question, input.origin, expect],
      )
      const [baseline] = await tx.query<{ id: string }>(
        `insert into saved_question_baselines (question_id, answer, edition, why, kept_by)
         values ($1, $2, $3, 'saved', cl_person()) returning id::text`,
        [q!.id, JSON.stringify(now), head.seq],
      )
      await single({ id: q!.id, areaId: input.areaId }, head, baseline!.id, 'saved', {
        result: 'same',
        reason: 'saved',
        now,
      })
      return { question: await one(q!.id), undo: `saved:${q!.id}` }
    },

    async remove({ id }) {
      const removed = await tx.query(
        `update saved_questions set removed_at = now(), removed_by = cl_person()
          where id = $1 and removed_at is null returning id`,
        [id],
      )
      return { removed: removed.length > 0 }
    },

    async keep({ id }) {
      const q = await one(id)
      if (q.result.result === 'same')
        throw new ORPCError('CONFLICT', {
          message: 'It already answers as saved. There is no new answer to keep.',
        })
      const { head, now } = await live(q.question)
      const [baseline] = await tx.query<{ id: string }>(
        `insert into saved_question_baselines (question_id, answer, edition, why, kept_by)
         values ($1, $2, $3, 'kept', cl_person()) returning id::text`,
        [id, JSON.stringify(now), head.seq],
      )
      await single(q, head, baseline!.id, 'kept', { result: 'same', reason: 'kept', now })
      return { question: await one(id), undo: `kept:${baseline!.id}` }
    },

    /** Undo of Save question: only its saver takes it back. */
    async undoSaved(id) {
      const [q] = await tx.query<{ mine: boolean }>(
        'select created_by = cl_person() as mine from saved_questions where id = $1 and removed_at is null',
        [id],
      )
      if (!q) throw new ORPCError('CONFLICT', { message: 'This question is already removed.' })
      if (!q.mine)
        throw new ORPCError('FORBIDDEN', {
          message: 'Only the person who saved the question can undo it.',
        })
      await tx.query(
        'update saved_questions set removed_at = now(), removed_by = cl_person() where id = $1',
        [id],
      )
      return { edition: null }
    },

    /** Undo of Keep the new answer: the answer before is the saved one again, checked now. */
    async undoKept(baselineId) {
      const [undone] = await tx.query<{ question: string }>(
        `update saved_question_baselines set undone_at = now()
          where id = $1 and kept_by = cl_person() and why = 'kept' and undone_at is null
          returning question_id::text as question`,
        [baselineId],
      )
      if (!undone)
        throw new ORPCError('CONFLICT', {
          message: 'Only the person who kept this answer can undo it, once.',
        })
      const [q] = await tx.query<ToCheck>(`${toCheck} where id = $2::uuid`, [null, undone.question])
      if (!q) return { edition: null }
      const { head, now } = await live(q.question)
      await single(q, head, q.baselineId, 'kept', {
        ...compareSaved(q.saved, now, q.expectItems),
        now,
      })
      return { edition: null }
    },

    async status({ areaId }) {
      const [run] = await tx.query<CheckRun>(
        `select ${runFields} from check_runs r
          where (r.started_by is null or r.started_by = cl_person())
            and r.trigger not in ('saved', 'kept')
            and ($1::text is null or r.area_id is null or r.area_id = $1)
          order by r.started_at desc limit 1`,
        [areaId ?? null],
      )
      const [last] = await tx.query<{ at: string | null }>(
        `select max(x.checked_at)::text as at from saved_question_results x
           join saved_questions q on q.id = x.question_id
          where q.removed_at is null and ($1::text is null or q.area_id = $1)`,
        [areaId ?? null],
      )
      const weeks = await tx.query<{ week: string; same: number; total: number }>(
        `with weeks as (
           select (date_trunc('week', $2::date) - make_interval(weeks => n))::date as week
             from generate_series(0, 7) n)
         select w.week::text,
                count(q.id) filter (where r.result = 'same')::int as same,
                count(q.id)::int as total
           from weeks w
           -- The end of a week; the current week runs to now.
           cross join lateral (select case when w.week = date_trunc('week', $2::date)::date
                                           then 'infinity'::timestamptz
                                           else (w.week + 7)::timestamptz end as until) e
           left join saved_questions q
             on q.created_at < e.until
            and (q.removed_at is null or q.removed_at >= e.until)
            and ($1::text is null or q.area_id = $1)
           left join lateral (
             select x.result from saved_question_results x
              where x.question_id = q.id and x.checked_at < e.until
              order by x.checked_at desc, x.run_id desc limit 1) r on true
          group by w.week order by w.week`,
        [areaId ?? null, clock.today()],
      )
      return { run: run ? runOf(run) : null, checkedAt: iso(last?.at ?? null), weeks }
    },
  }
}

export interface SavedQuestionsService {
  list(input: { areaId?: string }): Promise<SavedQuestionRecord[]>
  create(input: {
    areaId: string
    question: string
    origin: 'ask' | 'gap' | 'typed'
    expectItems?: string[]
  }): Promise<{ question: SavedQuestionRecord; undo: string }>
  remove(input: { id: string }): Promise<{ removed: boolean }>
  keep(input: { id: string }): Promise<{ question: SavedQuestionRecord; undo: string }>
  undoSaved(id: string): Promise<{ edition: null }>
  undoKept(baselineId: string): Promise<{ edition: null }>
  status(input: { areaId?: string }): Promise<SavedStatus>
}

/**
 * The saved questions the reader manages that answer from `itemId`, or should, checked against
 * what agents would get with a suggestion (`draft`) beside what they get now (`live`): the review's
 * line before Publish, which says what this change does to them. Shown only, never kept, and never
 * a reason Publish waits.
 */
export async function draftChecks(
  tx: Queryable,
  today: string,
  itemId: string,
  bundles: { live: ServingBundle; draft: ServingBundle },
): Promise<SavedDraft[]> {
  const rows = await tx.query<ToCheck>(
    `${toCheck} where $2 = any(expect_items)
        or exists (select 1 from jsonb_array_elements(answer -> 'items') i where i ->> 'id' = $2)`,
    [null, itemId],
  )
  return rows.map((q) => {
    const live = answerNow(bundles.live, q.question, today)
    const draft = answerNow(bundles.draft, q.question, today)
    const expectItems = givenOf(live, q.expectItems)
    return {
      id: q.id,
      question: q.question,
      ...compareSaved(live, draft, expectItems),
      live,
      draft,
      expectItems,
    }
  })
}

/**
 * The items a saved question should answer from that an answer gives: an item it should answer
 * from that was not given before a change is not the change's doing.
 */
const givenOf = (before: SavedAnswer, expect: readonly string[]) =>
  expect.filter((id) => before.items.some((i) => i.id === id))

/** What a change does to a saved question: the answer after it beside the answer before it. */
const movedBy = (before: SavedAnswer, after: SavedAnswer, expect: readonly string[]) =>
  compareSaved(before, after, givenOf(before, expect))
