import type {
  AppFamilyCounts,
  Comparison,
  FeedbackCounts,
  FixNext,
  HistoryPoint,
  RatingCounts,
  Untested,
  Upkeep,
} from '../../../contract/quality.ts'
import type { AppFamily } from '../../../domain/app-family.ts'
import { visibleCount } from '../../../domain/gaps.ts'
import type { Verdict } from '../../../domain/golden-question.ts'
import { itemKinds, type ItemKind } from '../../../domain/item.ts'
import {
  compareRuns,
  rankFixNext,
  rate,
  type FixCandidate,
  type RunQuestion,
} from '../../../domain/quality.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import {
  heldOutLabel,
  hiddenQuestions,
  liveHead,
  readableAreas,
  type RunSummary,
} from '../evals/index.ts'
import { compareQuestion, questionHistory } from './question.ts'
import {
  againstRun,
  comparable,
  iso,
  loadAreaRun,
  type AreaRun,
  type ComparableRun,
} from './runs.ts'

/**
 * The Quality page's reads (Quality design, section 7: G2, G3, G8, G9, G12, G14), and the
 * Workbench's two reads of one test question (`question.ts`). Every read covers the areas the
 * reader maintains, or every area for an administrator, or the one area asked for, which they
 * must maintain (`readableAreas`). Nothing here stores anything; nothing returns a test
 * question's or an agent's question text (FR-602), only ids, counts and dates, and the answers
 * a test question's tries gave, which their transcripts already show to the same readers.
 */

type Scorecard = NonNullable<NonNullable<RunSummary['result']>['scorecard']>

const minimumCount = `(select (value #>> '{}')::int from settings_current where key = 'privacy.min_count')`
/** The weeks ending with the current one, Mondays as dates. */
const weekSeries = (today: string, weeks: string) =>
  `generate_series(date_trunc('week', ${today}::date) - make_interval(weeks => ${weeks} - 1),
                   date_trunc('week', ${today}::date), interval '1 week')`

/** The areas an answer lists rows for: the readable ones, or every area for an administrator. */
async function areaList(tx: Queryable, areas: string[] | null): Promise<string[]> {
  if (areas) return areas
  const rows = await tx.query<{ id: string }>('select id from areas order by id')
  return rows.map((r) => r.id)
}

/** An item the live edition serves and the library shows (no audience groups), with its tests. */
type LiveItem = {
  id: string
  area: string
  title: string
  kind: ItemKind
  risk: 'low' | 'normal' | 'high'
  reviewDate: string | null
  validUntil: string | null
  tested: boolean
}

/** The live edition's items in the areas, each with whether an active test question names it. */
async function liveItems(tx: Queryable, areas: string[] | null): Promise<LiveItem[]> {
  return tx.query<LiveItem>(
    `with named as (
       select distinct x.item from golden_questions q,
              lateral jsonb_array_elements_text(
                coalesce(q.expected->'must_deliver','[]') || coalesce(q.expected->'must_not_deliver','[]')
                || coalesce(q.expected->'reachable_via_link','[]')) as x(item)
        where q.status='active' and q.set_aside_reason is null)
     select l.id,l.area_id as area,l.title,l.kind::text as kind,l.risk::text as risk,
            l.review_date::text as "reviewDate",l.valid_until::text as "validUntil",
            exists (select 1 from named n where n.item=l.id) as tested
       from v_item_list l
      where l.status='accepted' and cl_audience_allows(l.audience_groups)
        and ($1::text[] is null or l.area_id=any($1))
      order by l.area_id,l.id`,
    [areas],
  )
}

/** An area run's questions as one side of a comparison: the live edition's verdicts. */
const sideOf = (run: AreaRun): RunQuestion[] =>
  (run.summary.result?.questions ?? []).map((q) => ({
    id: q.id,
    verdict: q.baseline,
    failedChecks: q.layers?.baseline.failedChecks ?? [],
  }))

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)

export function createQualityService(tx: Queryable, clock: Clock) {
  async function minimum(): Promise<number> {
    const [row] = await tx.query<{ minimum: number }>(`select ${minimumCount} as minimum`)
    return row!.minimum
  }
  return {
    /**
     * G2: per finished weekly run of each area, newest first, its rates, held-out measures,
     * the retrieval pass of the same edition for the area and its cost. `limit` runs per area.
     */
    async history(area?: string, limit = 12): Promise<HistoryPoint[]> {
      const areas = await readableAreas(tx, area)
      const rows = await tx.query<{
        run: string
        area: string
        edition: string
        finishedAt: string
        card: Scorecard | null
        costMicros: number
        estimatedCostMicros: number
        modelId: string
        judgeModelId: string | null
        retrievalId: string | null
        asOf: string | null
        retrievalQuestions: number | null
        retrievalPassed: number | null
      }>(
        `with r as (
           select e.*, row_number() over (partition by e.area_id order by e.finished_at desc, e.id desc) as n
             from eval_runs e
            where e.kind='scheduled' and e.state='finished' and e.area_id is not null
              and ($1::text[] is null or e.area_id=any($1)))
         select r.id::text as run,r.area_id as area,r.summary->>'edition' as edition,
                ${iso('r.finished_at')} as "finishedAt",r.summary->'result'->'scorecard' as card,
                r.actual_cost_micros::float8 as "costMicros",r.estimated_cost_micros::float8 as "estimatedCostMicros",
                r.model_id as "modelId",r.judge_model_id as "judgeModelId",
                p.id::text as "retrievalId",p.as_of::text as "asOf",
                c.questions as "retrievalQuestions",c.passed as "retrievalPassed"
           from r
           left join lateral (
             select x.id,x.as_of from retrieval_runs x where x.edition_seq=r.baseline_edition_seq
              order by (x.created_at <= r.finished_at) desc, x.created_at desc, x.id desc limit 1) p on true
           left join lateral (
             select count(*)::int as questions,(count(*) filter (where y.passed))::int as passed
               from retrieval_results y where y.run_id=p.id and y.area_id=r.area_id) c on p.id is not null
          where r.n <= $2
          order by r.finished_at desc, r.area_id`,
        [areas, limit],
      )
      return rows.flatMap((row): HistoryPoint[] => {
        const card = row.card
        if (!card) return []
        const held = card.heldOut
        return [
          {
            run: row.run,
            area: row.area,
            edition: row.edition,
            finishedAt: row.finishedAt,
            questions: card.questions,
            passed: card.passed,
            failed: card.failed,
            noAnswer: card.noAnswer,
            setAside: card.setAside,
            regressions: card.regressions.length,
            rates: {
              pass: rate(card.passed, card.questions),
              caveats: rate(held.caveats.present, held.caveats.required),
              causeClaims: rate(held.causeClaims, held.answers),
              acceptable: rate(held.acceptable, held.questions),
            },
            heldOut: held,
            layers: card.layers ?? null,
            failedChecks: card.failedChecks ?? null,
            retrieval:
              row.retrievalId && row.asOf
                ? {
                    id: row.retrievalId,
                    asOf: row.asOf,
                    questions: row.retrievalQuestions ?? 0,
                    passed: row.retrievalPassed ?? 0,
                    failed: (row.retrievalQuestions ?? 0) - (row.retrievalPassed ?? 0),
                    rate: rate(row.retrievalPassed ?? 0, row.retrievalQuestions ?? 0),
                  }
                : null,
            costMicros: row.costMicros,
            estimatedCostMicros: row.estimatedCostMicros,
            modelId: row.modelId,
            judgeModelId: row.judgeModelId,
          },
        ]
      })
    },

    /**
     * G3: a finished weekly or full run of an area against another of the same area, by default
     * the weekly run that finished before it: which questions got better and worse, the checks
     * they failed, and the exact sign test on the questions that changed.
     */
    async compare(id: string, againstId?: string): Promise<Comparison> {
      const run = await loadAreaRun(tx, id)
      if (run.area) await readableAreas(tx, run.area)
      comparable(run)
      const against = await againstRun(tx, run, againstId)
      const ref = (r: ComparableRun) => ({
        id: r.id,
        kind: r.kind,
        edition: r.edition,
        finishedAt: r.finishedAt,
      })
      const result = compareRuns(against ? sideOf(against) : [], sideOf(run))
      const hidden = await hiddenQuestions(tx, [
        ...result.better.map((q) => q.id),
        ...result.worse.map((q) => q.id),
      ])
      const shown = <T extends { id: string }>(q: T) =>
        hidden.has(q.id) ? { ...q, id: heldOutLabel } : q
      return {
        area: run.area,
        run: ref(run),
        against: against ? ref(against) : null,
        ...result,
        // Without an earlier run there is nothing to compare: every question is new.
        added: against ? result.added : 0,
        better: result.better.map(shown),
        worse: result.worse.map(shown),
      }
    },

    /**
     * G8: feedback agents gave per verdict, week and area. Each count below the minimum is
     * hidden (FR-614). Feedback the service cannot place in an area is a row of its own, for
     * administrators asking for every area.
     */
    async feedback(area?: string, weeks = 8): Promise<FeedbackCounts> {
      const areas = await readableAreas(tx, area)
      const listed: (string | null)[] = await areaList(tx, areas)
      if (areas === null) listed.push(null)
      const today = clock.today()
      const rows = await tx.query<{
        area: string | null
        week: string
        helpful: number
        wrong: number
        missing: number
        unclear: number
      }>(
        `with a as (select unnest($1::text[]) as area),
         w as (select gs::date as week from ${weekSeries('$2', '$3')} gs),
         f as (select coalesce(f.area_id,t.area_id) as area,
                      date_trunc('week', f.created_hour at time zone 'UTC')::date as week,f.verdict
                 from feedback f left join gaps g on g.id=f.gap_id left join topics t on t.id=g.topic_id
                where f.created_hour >= (date_trunc('week', $2::date) - make_interval(weeks => $3 - 1)) at time zone 'UTC')
         select a.area,w.week::text as week,
                (count(f.verdict) filter (where f.verdict='helpful'))::int as helpful,
                (count(f.verdict) filter (where f.verdict='wrong'))::int as wrong,
                (count(f.verdict) filter (where f.verdict='missing'))::int as missing,
                (count(f.verdict) filter (where f.verdict='unclear'))::int as unclear
           from a cross join w
           left join f on f.area is not distinct from a.area and f.week=w.week
          group by a.area,w.week order by a.area nulls last,w.week`,
        [listed, today, weeks],
      )
      const least = await minimum()
      const shown = (count: number) => visibleCount(count, least)
      const shownTotal = (counts: number[]) =>
        counts.some((count) => shown(count) === null)
          ? null
          : shown(counts.reduce((sum, count) => sum + count, 0))
      return {
        today,
        minimumCount: least,
        rows: rows.map((row) => ({
          area: row.area,
          week: row.week,
          helpful: shown(row.helpful),
          wrong: shown(row.wrong),
          missing: shown(row.missing),
          unclear: shown(row.unclear),
          total: shownTotal([row.helpful, row.wrong, row.missing, row.unclear]),
        })),
      }
    },

    /**
     * The assistant's ratings per area and week (FR-712), as G8 counts feedback: each week a cell
     * of its own, so no two answers overlap and no hidden count can be found by subtracting one
     * period from another. Each count below the minimum is hidden (FR-614), and the week's total
     * with it. Ratings about no one domain are a row of their own, for administrators asking for
     * every area.
     */
    async ratings(area?: string, weeks = 8): Promise<RatingCounts> {
      const areas = await readableAreas(tx, area)
      const listed: (string | null)[] = await areaList(tx, areas)
      if (areas === null) listed.push(null)
      const today = clock.today()
      const rows = await tx.query<{
        area: string | null
        week: string
        helpful: number
        wrong: number
      }>(
        `with a as (select unnest($1::text[]) as area),
         w as (select gs::date as week from ${weekSeries('$2', '$3')} gs),
         r as (select r.area_id as area, date_trunc('week', r.created_hour at time zone 'UTC')::date as week, r.verdict
                 from assistant_ratings r
                where r.created_hour >= (date_trunc('week', $2::date) - make_interval(weeks => $3 - 1)) at time zone 'UTC')
         select a.area,w.week::text as week,
                (count(r.verdict) filter (where r.verdict='helpful'))::int as helpful,
                (count(r.verdict) filter (where r.verdict='wrong'))::int as wrong
           from a cross join w
           left join r on r.area is not distinct from a.area and r.week=w.week
          group by a.area,w.week order by a.area nulls last,w.week`,
        [listed, today, weeks],
      )
      const least = await minimum()
      const shown = (count: number) => visibleCount(count, least)
      return {
        today,
        minimumCount: least,
        rows: rows.map((row) => ({
          area: row.area,
          week: row.week,
          helpful: shown(row.helpful),
          wrong: shown(row.wrong),
          total:
            shown(row.helpful) === null || shown(row.wrong) === null
              ? null
              : shown(row.helpful + row.wrong),
        })),
      }
    },

    /**
     * How the AI apps that called the MCP server fared (FR-410), per app family and week, from
     * the request log: tool calls, and of them the reads that needed more detail or matched
     * nothing, the calls with arguments the tool could not read, and Heed's errors. Not per area:
     * a request names no domain. Each week is a cell of its own and each count below the minimum
     * is hidden (FR-614), so no small count can be found by subtracting one period from another.
     */
    async apps(weeks = 1): Promise<AppFamilyCounts> {
      const today = clock.today()
      const rows = await tx.query<{
        family: AppFamily
        week: string
        calls: number
        needMoreDetail: number
        noMatch: number
        invalidInput: number
        errors: number
      }>(
        `select r.app_family as family, date_trunc('week', r.hour at time zone 'UTC')::date::text as week,
                count(*)::int as calls,
                (count(*) filter (where r.result_status = 'need_more_detail'))::int as "needMoreDetail",
                (count(*) filter (where r.result_status = 'no_match'))::int as "noMatch",
                (count(*) filter (where r.status = 'invalid_input'))::int as "invalidInput",
                (count(*) filter (where r.status = 'error'))::int as errors
           from mcp_requests r
          where r.tool <> 'protocol'
            and r.hour >= (date_trunc('week', $1::date::timestamp) - make_interval(weeks => $2 - 1)) at time zone 'UTC'
          group by 1, 2 order by r.app_family collate "C", 2`,
        [today, weeks],
      )
      const least = await minimum()
      const shown = (count: number) => visibleCount(count, least)
      return {
        today,
        minimumCount: least,
        rows: rows.map((row) => ({
          family: row.family,
          week: row.week,
          calls: shown(row.calls),
          needMoreDetail: shown(row.needMoreDetail),
          noMatch: shown(row.noMatch),
          invalidInput: shown(row.invalidInput),
          errors: shown(row.errors),
        })),
      }
    },

    /**
     * G9: per week and area, the items past their review date at the end of the week (today for
     * the current week; the area dashboard's rule, on the edition sealed by then) and the
     * proposals accepted during the week.
     */
    async upkeep(area?: string, weeks = 8): Promise<Upkeep> {
      const areas = await areaList(tx, await readableAreas(tx, area))
      const today = clock.today()
      const rows = await tx.query<Upkeep['rows'][number]>(
        `with a as (select unnest($1::text[]) as area),
         w as (select gs::date as week, least(gs::date + 6, $2::date) as day from ${weekSeries('$2', '$3')} gs),
         e as (select w.week,w.day,
                      (select max(seq) from editions where sealed_at is not null
                          and sealed_at < (w.day + 1)::timestamp at time zone 'UTC') as seq
                 from w)
         select a.area,e.week::text as week,
                (select count(*)::int from item_version_service s join item_versions v on v.id=s.version_id
                  where s.editions @> e.seq and v.area_id=a.area and v.review_date < e.day
                    and (v.valid_until is null or v.valid_until > e.day)
                    and cl_audience_allows(v.audience_groups)) as "itemsPastReview",
                (select count(*)::int from proposals p
                  where p.area_id=a.area and p.state='accepted'
                    and p.closed_at >= e.week::timestamp at time zone 'UTC'
                    and p.closed_at < (e.week + 7)::timestamp at time zone 'UTC') as "proposalsAccepted"
           from a cross join e order by a.area,e.week`,
        [areas, today, weeks],
      )
      return { today, rows }
    },

    /** G12: per area, the live items no active test question names, and how many need one. */
    async untested(area?: string): Promise<Untested> {
      const areas = await readableAreas(tx, area)
      const listed = await areaList(tx, areas)
      const head = await liveHead(tx)
      const items = head ? await liveItems(tx, areas) : []
      return {
        edition: head?.label ?? null,
        areas: listed.map((id) => {
          const own = items.filter((item) => item.area === id)
          const untested = own.filter((item) => !item.tested)
          const byKind = Object.fromEntries(itemKinds.map((kind) => [kind, 0])) as Record<
            ItemKind,
            number
          >
          for (const item of untested) byKind[item.kind]++
          return {
            area: id,
            items: own.length,
            untested: untested.length,
            untestedRequired: byKind.event + byKind.example,
            byKind,
          }
        }),
      }
    },

    /**
     * G14: one ranked list across test questions failing the newest weekly run or the newest
     * retrieval pass of the live edition, open gaps, items past their review date and items no
     * test question covers. The weights are in `rankFixNext` (src/domain/quality.ts).
     */
    async fixNext(area?: string, limit = 25): Promise<FixNext> {
      const areas = await readableAreas(tx, area)
      const today = clock.today()
      const head = await liveHead(tx)
      const candidates: FixCandidate[] = []

      // Active test questions, with the newest weekly verdict and the newest retrieval result.
      const questions = await tx.query<{
        id: string
        area: string
        risk: 'low' | 'normal' | 'high'
      }>(
        `select id,area_id as area,risk::text as risk from golden_questions
          where status='active' and set_aside_reason is null and ($1::text[] is null or area_id=any($1))`,
        [areas],
      )
      const weekly = await tx.query<{ area: string; finishedAt: string; summary: RunSummary }>(
        `select distinct on (area_id) area_id as area,${iso('finished_at')} as "finishedAt",summary
           from eval_runs where kind='scheduled' and state='finished' and area_id is not null
            and ($1::text[] is null or area_id=any($1))
          order by area_id,finished_at desc,id desc`,
        [areas],
      )
      const answers = new Map<
        string,
        { verdict: Verdict | null; regression: boolean; checks: string[]; since: string }
      >()
      for (const run of weekly) {
        const regressions = new Set(run.summary.result?.scorecard?.regressions ?? [])
        for (const q of run.summary.result?.questions ?? [])
          answers.set(q.id, {
            verdict: q.baseline,
            regression: regressions.has(q.id),
            checks: q.layers?.baseline.failedChecks ?? [],
            since: run.finishedAt,
          })
      }
      const retrieval = new Map<string, { passed: boolean; checks: string[]; since: string }>()
      if (head) {
        const results = await tx.query<{
          id: string
          passed: boolean
          checks: Record<string, boolean>
          since: string
        }>(
          `select x.question_id as id,x.passed,x.checks,${iso('r.created_at')} as since
             from retrieval_results x
             join (select id,created_at from retrieval_runs where edition_seq=$1
                    order by created_at desc,id desc limit 1) r on r.id=x.run_id
            where ($2::text[] is null or x.area_id=any($2))`,
          [head.seq, areas],
        )
        for (const r of results)
          retrieval.set(r.id, {
            passed: r.passed,
            checks: Object.entries(r.checks)
              .filter(([, ok]) => ok === false)
              .map(([check]) => check),
            since: r.since,
          })
      }
      for (const q of questions) {
        const answer = answers.get(q.id)
        const pass = retrieval.get(q.id)
        if (!answer && !pass) continue
        const answerFails = answer?.verdict === 'fail' || answer?.verdict === 'no_answer'
        candidates.push({
          type: 'question',
          area: q.area,
          id: q.id,
          risk: q.risk,
          answer: answer?.verdict ?? null,
          regression: answer?.regression ?? false,
          retrieval: pass?.passed ?? null,
          failedChecks: [...new Set([...(answer?.checks ?? []), ...(pass?.checks ?? [])])].sort(),
          since: (answerFails ? answer?.since : pass?.since) ?? answer?.since ?? null,
        })
      }

      // Open gaps of the areas asked about; a gap whose topic spans areas shows in each of them.
      const gaps = await tx.query<{
        id: string
        ref: string
        area: string | null
        type: string
        status: 'open' | 'proposal_made'
        severity: number
        reports: number
        lastSeen: string
      }>(
        `select g.id::text,g.ref,t.area_id as area,g.type::text as type,g.status::text as status,
                g.severity::int as severity,g.last_seen::text as "lastSeen",
                coalesce((select sum(w.reports) from gap_weekly_counts w where w.gap_id=g.id),0)::int as reports
           from gaps g join topics t on t.id=g.topic_id
          where g.status in ('open','proposal_made')
            and (case when $1::text[] is null then true else cl_topic_domains(t.area_id,t.metric_keys) && $1 end)`,
        [areas],
      )
      for (const gap of gaps)
        candidates.push({
          type: 'gap',
          area: gap.area,
          id: gap.id,
          ref: gap.ref,
          gapType: gap.type,
          status: gap.status,
          severity: gap.severity,
          reports: gap.reports,
          lastSeen: gap.lastSeen,
        })

      // Items past review (the dashboard's rule) or with no test question naming them.
      if (head)
        for (const item of await liveItems(tx, areas)) {
          if (item.validUntil !== null && item.validUntil <= today) continue
          const daysPast =
            item.reviewDate !== null && item.reviewDate < today
              ? daysBetween(item.reviewDate, today)
              : null
          candidates.push({
            type: 'item',
            area: item.area,
            id: item.id,
            title: item.title,
            kind: item.kind,
            risk: item.risk,
            daysPastReview: daysPast,
            reviewDate: item.reviewDate,
            untested: !item.tested,
          })
        }

      const entries = rankFixNext(candidates, limit)
      const hidden = await hiddenQuestions(
        tx,
        entries.filter((e) => e.subject.type === 'question').map((e) => e.subject.id),
      )
      return {
        edition: head?.label ?? null,
        entries: entries.map((entry) =>
          entry.subject.type === 'question' && hidden.has(entry.subject.id)
            ? { ...entry, subject: { ...entry.subject, id: heldOutLabel } }
            : entry,
        ),
      }
    },

    /**
     * The Workbench: one test question across two runs of its area, try by try, with what was
     * held constant and the items that changed between the two editions (`question.ts`).
     */
    compareQuestion: (input: { question: string; run: string; against?: string | undefined }) =>
      compareQuestion(tx, input),
    /** The Workbench: one test question's verdict in recent runs, and per edition's retrieval pass. */
    questionHistory: (question: string, limit = 12) => questionHistory(tx, question, limit),
  }
}
export type QualityService = ReturnType<typeof createQualityService>
