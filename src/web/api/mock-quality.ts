import type { Edition } from '../../contract/review.ts'
import type { AppFamily } from '../../domain/app-family.ts'
import { visibleCount } from '../../domain/gaps.ts'
import { wordingVerdict, type Verdict } from '../../domain/golden-question.ts'
import {
  audienceAllows,
  itemKinds,
  noGroups,
  type ContextItem,
  type ItemKind,
} from '../../domain/item.ts'
import {
  compareRuns,
  rankFixNext,
  rate,
  tryEvidence,
  type FixCandidate,
  type RunQuestion,
  type RunSetup,
} from '../../domain/quality.ts'
import { shiftDate } from '../../domain/validity.ts'
import type {
  AppFamilyCounts,
  Comparison,
  EvalRunDetail,
  EvalTranscript,
  FeedbackCounts,
  FixNext,
  Gap,
  HistoryPoint,
  QuestionComparison,
  RatingCounts,
  TestQuestion,
  Untested,
  Upkeep,
} from './client.ts'
import { ApiError } from './errors.ts'
import { MOCK_TRIES, scriptedResult } from './mock-runs.ts'

/*
  The Quality page in the mock (Quality design, section 7). An area with active test questions
  has a weekly run every Monday at 04:30 UTC since its first edition, on the edition live then.
  A run asks each question on its day, and the edition delivers the expected items it serves that
  are in force that day; the scripted answers are scored on that (mock-runs.ts). So every question
  passes until an edition stops delivering what it expects: the demo's regression
  (`regression` in mocks/items.ts) is the one that does. The retrieval pass checks the same deliveries without
  a model. It keeps no agent feedback, so the feedback counts are zero; the assistant's ratings are
  the world's seeded ones and those given since, counted as the service counts them, as are the agents'
  seeded calls. Upkeep, untested items and
  Fix next come from the mock's own library, proposals, gaps and runs, by the service's rules
  (src/server/modules/quality/service.ts).
*/

export type MockQualityWorld = {
  today: string
  /** Every area id, in order: the readable ones are a subset. */
  areaIds: readonly string[]
  questions: readonly TestQuestion[]
  editions: readonly Edition[]
  /** The library as the live edition serves it. */
  items: readonly ContextItem[]
  /** An item as an edition serves it; null when it does not. */
  served: (edition: Edition, id: string) => ContextItem | null
  /** Every proposal and retirement, with when it closed. */
  proposals: readonly { areaId: string | null; state: string; closedAt: string | null }[]
  gaps: readonly Gap[]
  /** The assistant's ratings, each with its area (null: about no one domain) and day. */
  ratings: readonly MockRating[]
  /** The MCP request log, counted per app family and day (FR-410). */
  appDays: readonly MockAppDay[]
  minimum: number
}

/** One stored rating, as the service keeps it: a verdict, an area and a time, nobody (FR-712). */
export type MockRating = { area: string | null; verdict: 'helpful' | 'wrong'; day: string }

/**
 * One app family's tool calls on one day, as the request log counts them: the family from the
 * fixed list, never the agent's own name, and no person (FR-410).
 */
export type MockAppDay = {
  family: AppFamily
  day: string
  calls: number
  needMoreDetail: number
  noMatch: number
  invalidInput: number
  errors: number
}

/** Mock costs: what one try of one wording costs, in micro-dollars. */
const TRY_MICROS = 1_500
const TRIES = MOCK_TRIES

const monday = (day: string) => {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return shiftDate(day, -((weekday + 6) % 7))
}
/** The day the mock's weekly runs started using today's judge; earlier runs had another. */
const JUDGE_REPLACED = '2026-09-01'

/** The Mondays of the `weeks` weeks ending with today's. */
const weeksUpTo = (today: string, weeks: number) =>
  Array.from({ length: weeks }, (_, i) => shiftDate(monday(today), -7 * (weeks - 1 - i)))

const active = (q: TestQuestion) => q.status === 'active' && q.setAsideReason === null
const everyone = (item: ContextItem) => audienceAllows(item.audience, noGroups)
/** An item in force on a day: its validity has started and not ended (the end is exclusive). */
const inForce = (item: ContextItem, day: string) =>
  item.validity.start <= day && (item.validity.end === null || day < item.validity.end)
const runId = (area: number, week: number) =>
  `00000000-0000-4000-b${area.toString(16).padStart(3, '0')}-${week.toString(16).padStart(12, '0')}`

function notFound(): never {
  throw new ApiError('not-found', "We couldn't find this test run.", { status: 404 })
}

export function createMockQuality(world: MockQualityWorld) {
  const firstDay = (world.editions.map((e) => e.sealedAt ?? e.createdAt).sort()[0] ?? '').slice(
    0,
    10,
  )
  /** The edition sealed last before a moment; the first edition before any. */
  const editionAt = (at: string) =>
    [...world.editions]
      .filter((e) => (e.sealedAt ?? e.createdAt) <= at)
      .sort((a, b) => b.seq - a.seq)[0] ?? world.editions[0]!
  const questionsOf = (area: string) => world.questions.filter((q) => q.area === area && active(q))

  // A model answers one read, so what an edition serves and an area's runs are worked out once.
  const servedCache = new Map<string, ContextItem | null>()
  const served = (edition: Edition, id: string) => {
    const key = `${edition.seq}:${id}`
    if (!servedCache.has(key)) servedCache.set(key, world.served(edition, id))
    return servedCache.get(key)!
  }

  /** The expected items an edition delivers to a question asked on a day. */
  const delivered = (edition: Edition, day: string) => (question: TestQuestion) =>
    question.expected.must_deliver.filter((id) => {
      const item = served(edition, id)
      return item !== null && item.status === 'accepted' && everyone(item) && inForce(item, day)
    })

  /**
   * The newest retrieval pass of an edition: the one made when it was sealed or, for the live
   * edition sealed before today, today's daily pass.
   */
  function passOf(edition: Edition) {
    const sealed = edition.sealedAt ?? edition.createdAt
    const seq = edition.seq.toString(16).padStart(12, '0')
    return edition.live && sealed.slice(0, 10) < world.today
      ? {
          id: `00000000-0000-4000-a001-${seq}`,
          asOf: world.today,
          trigger: 'daily' as const,
          createdAt: `${world.today}T00:30:00.000Z`,
        }
      : {
          id: `00000000-0000-4000-a000-${seq}`,
          asOf: sealed.slice(0, 10),
          trigger: 'edition' as const,
          createdAt: sealed,
        }
  }

  /** The newest retrieval pass of an edition for an area's questions, without a model. */
  function retrievalOf(edition: Edition, area: string) {
    const { id, asOf } = passOf(edition)
    const deliver = delivered(edition, asOf)
    const questions = questionsOf(area)
    const passed = questions.filter(
      (q) => deliver(q).length === q.expected.must_deliver.length,
    ).length
    return {
      id,
      asOf,
      questions: questions.length,
      passed,
      failed: questions.length - passed,
      rate: rate(passed, questions.length),
    }
  }

  type WeeklyRun = { point: HistoryPoint; edition: Edition; answers: RunQuestion[] }

  // Most weeks deliver a question what the week before did, so a result is scored once.
  const resultCache = new Map<string, ReturnType<typeof scriptedResult>>()
  const resultOf = (question: TestQuestion, given: readonly string[]) => {
    const key = `${question.id}:${given.join(',')}`
    let result = resultCache.get(key)
    if (!result) resultCache.set(key, (result = scriptedResult(question, given)))
    return result
  }

  const weeklyCache = new Map<string, WeeklyRun[]>()
  /** The weekly runs of an area, oldest first: one per Monday since its first edition. */
  function weeklyRuns(area: string): WeeklyRun[] {
    let runs = weeklyCache.get(area)
    if (!runs) weeklyCache.set(area, (runs = scoreWeeks(area)))
    return runs
  }

  function scoreWeeks(area: string): WeeklyRun[] {
    const questions = questionsOf(area)
    if (!questions.length || !firstDay) return []
    const index = world.areaIds.indexOf(area)
    const runs: WeeklyRun[] = []
    for (
      let week = 0, day = monday(firstDay);
      day <= world.today;
      week++, day = shiftDate(day, 7)
    ) {
      if (day < firstDay) continue
      const finishedAt = `${day}T04:30:00.000Z`
      const edition = editionAt(finishedAt)
      const deliver = delivered(edition, day)
      const results = questions.map((q) => ({ q, ...resultOf(q, deliver(q)) }))
      const answers = results.map(({ q, verdict, layers }) => ({
        id: q.id,
        verdict,
        failedChecks: layers.failedChecks,
      }))
      const before = runs.at(-1)?.answers
      const passing = (id: string) => before?.find((a) => a.id === id)?.verdict === 'pass'
      const failing = results.filter((r) => r.verdict === 'fail')
      const heldOut = results.filter((r) => r.q.split === 'held_out')
      const caveats = heldOut.filter((r) => r.q.expected.caveat)
      const kept = caveats.filter((r) => !r.layers.failedChecks.includes('caveat'))
      const acceptable = heldOut.filter((r) => r.verdict === 'pass').length
      const layer = (name: 'code' | 'judge', verdict: Verdict) =>
        results.filter((r) => r.layers[name] === verdict).length
      const failedChecks: Record<string, number> = {}
      for (const { layers } of results)
        for (const check of layers.failedChecks)
          failedChecks[check] = (failedChecks[check] ?? 0) + 1
      const cost = questions.reduce((sum, q) => sum + q.wordings.length * TRIES * TRY_MICROS, 0)
      runs.push({
        edition,
        answers,
        point: {
          run: runId(index, week),
          area,
          edition: edition.label,
          finishedAt,
          questions: questions.length,
          passed: questions.length - failing.length,
          failed: failing.length,
          noAnswer: 0,
          setAside: world.questions.filter((q) => q.area === area && q.setAsideReason !== null)
            .length,
          regressions: failing.filter((r) => passing(r.q.id)).length,
          rates: {
            pass: rate(questions.length - failing.length, questions.length),
            caveats: rate(kept.length * TRIES, caveats.length * TRIES),
            causeClaims: rate(0, heldOut.length * TRIES),
            acceptable: rate(acceptable, heldOut.length),
          },
          heldOut: {
            questions: heldOut.length,
            answers: heldOut.length * TRIES,
            caveats: { required: caveats.length * TRIES, present: kept.length * TRIES },
            causeClaims: 0,
            acceptable,
            meetsTargets: heldOut.length > 0 && acceptable === heldOut.length,
          },
          layers: {
            code: { passed: layer('code', 'pass'), failed: layer('code', 'fail') },
            judge: { passed: layer('judge', 'pass'), failed: layer('judge', 'fail') },
          },
          failedChecks,
          retrieval: retrievalOf(edition, area),
          costMicros: cost,
          estimatedCostMicros: cost,
          modelId: 'mock-scripted-answer',
          // The judge was replaced on 1 September 2026, so a comparison with an earlier run is
          // not only the edition's doing (the Workbench's compare focus says so).
          judgeModelId:
            day < JUDGE_REPLACED ? 'mock-scripted-judge-earlier' : 'mock-scripted-judge',
        },
      })
    }
    return runs
  }

  /** The library's live items an area holds, with whether an active question names each. */
  function liveItemsOf(areas: readonly string[]) {
    const named = new Set(
      world.questions
        .filter(active)
        .flatMap((q) => [
          ...q.expected.must_deliver,
          ...q.expected.must_not_deliver,
          ...(q.expected.reachable_via_link ?? []),
        ]),
    )
    return world.items
      .filter((item) => item.status === 'accepted' && everyone(item) && areas.includes(item.areaId))
      .map((item) => ({ item, tested: named.has(item.id) }))
  }

  /** The run's area, or not found: a weekly run's id carries its area's index (`runId`). */
  function areaOfRun(id: string): string {
    const index = /^00000000-0000-4000-b([0-9a-f]{3})-[0-9a-f]{12}$/.exec(id)?.[1]
    const area = index === undefined ? undefined : world.areaIds[Number.parseInt(index, 16)]
    return area && weeklyRuns(area).some((r) => r.point.run === id) ? area : notFound()
  }

  /** A weekly run with the run before it, or not found. */
  function weeklyRun(id: string) {
    const runs = weeklyRuns(areaOfRun(id))
    const at = runs.findIndex((r) => r.point.run === id)
    return { run: runs[at]!, before: runs[at - 1] ?? null, runs }
  }

  return {
    areaOfRun,
    delivered,
    passOf,

    /** A weekly run's answers and its baseline, the run before it, for its run detail. */
    weekly(id: string) {
      const { run, before } = weeklyRun(id)
      return {
        delivered: delivered(run.edition, run.point.finishedAt.slice(0, 10)),
        baseline: before
          ? {
              run: before.point.run,
              verdicts: new Map(before.answers.map((a) => [a.id, a.verdict ?? 'no_answer'])),
            }
          : null,
      }
    },

    /** The verdicts of a weekly run, question by question. */
    answers(id: string): RunQuestion[] {
      return weeklyRun(id).run.answers
    },

    history(areas: readonly string[], limit = 12): HistoryPoint[] {
      return areas
        .flatMap((area) =>
          weeklyRuns(area)
            .map((r) => r.point)
            .reverse()
            .slice(0, limit),
        )
        .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || a.area.localeCompare(b.area))
    },

    compare(id: string, againstId?: string): Comparison {
      const { run, before, runs } = weeklyRun(id)
      const area = run.point.area
      if (againstId && areaOfRun(againstId) !== area)
        throw new ApiError('invalid', "Test runs of different domains can't be compared.", {
          status: 422,
        })
      const against = againstId ? runs.find((r) => r.point.run === againstId) : before
      const result = compareRuns(against?.answers ?? [], run.answers)
      const ref = (r: WeeklyRun) => ({
        id: r.point.run,
        kind: 'scheduled' as const,
        edition: r.point.edition,
        finishedAt: r.point.finishedAt,
      })
      return {
        area,
        run: ref(run),
        against: against ? ref(against) : null,
        ...result,
        added: against ? result.added : 0,
      }
    },

    feedback(areas: readonly string[] | null, weeks = 8): FeedbackCounts {
      const listed: (string | null)[] = [...(areas ?? world.areaIds)]
      if (areas === null) listed.push(null)
      return {
        today: world.today,
        minimumCount: world.minimum,
        rows: listed.flatMap((area) =>
          weeksUpTo(world.today, weeks).map((week) => ({
            area,
            week,
            helpful: 0,
            wrong: 0,
            missing: 0,
            unclear: 0,
            total: 0,
          })),
        ),
      }
    },

    /** The assistant's ratings per verdict, week and area, small counts hidden (FR-614). */
    ratings(areas: readonly string[] | null, weeks = 8): RatingCounts {
      const listed: (string | null)[] = [...(areas ?? world.areaIds)]
      if (areas === null) listed.push(null)
      const shown = (count: number) => visibleCount(count, world.minimum)
      return {
        today: world.today,
        minimumCount: world.minimum,
        rows: listed.flatMap((area) =>
          weeksUpTo(world.today, weeks).map((week) => {
            const counted = world.ratings.filter(
              (rating) => rating.area === area && monday(rating.day) === week,
            )
            const helpful = counted.filter((rating) => rating.verdict === 'helpful').length
            const wrong = counted.length - helpful
            return {
              area,
              week,
              helpful: shown(helpful),
              wrong: shown(wrong),
              total:
                shown(helpful) === null || shown(wrong) === null ? null : shown(counted.length),
            }
          }),
        ),
      }
    },

    /** The agents per family and week, small counts hidden (FR-410, FR-614). */
    apps(weeks = 1): AppFamilyCounts {
      const shown = (count: number) => visibleCount(count, world.minimum)
      return {
        today: world.today,
        minimumCount: world.minimum,
        rows: [...new Set(world.appDays.map((d) => d.family))].sort().flatMap((family) =>
          weeksUpTo(world.today, weeks).flatMap((week) => {
            const days = world.appDays.filter(
              (d) => d.family === family && d.day <= world.today && monday(d.day) === week,
            )
            if (!days.length) return []
            const sum = (key: Exclude<keyof MockAppDay, 'family' | 'day'>) =>
              shown(days.reduce((total, d) => total + d[key], 0))
            return [
              {
                family,
                week,
                calls: sum('calls'),
                needMoreDetail: sum('needMoreDetail'),
                noMatch: sum('noMatch'),
                invalidInput: sum('invalidInput'),
                errors: sum('errors'),
              },
            ]
          }),
        ),
      }
    },

    upkeep(areas: readonly string[], weeks = 8): Upkeep {
      return {
        today: world.today,
        rows: areas.flatMap((area) =>
          weeksUpTo(world.today, weeks).map((week) => {
            const day = shiftDate(week, 6) < world.today ? shiftDate(week, 6) : world.today
            return {
              area,
              week,
              itemsPastReview: world.items.filter(
                (item) =>
                  item.status === 'accepted' &&
                  item.areaId === area &&
                  item.createdAt.slice(0, 10) <= day &&
                  item.reviewDate !== null &&
                  item.reviewDate < day &&
                  (item.validity.end === null || item.validity.end > day),
              ).length,
              proposalsAccepted: world.proposals.filter(
                (p) =>
                  p.areaId === area &&
                  p.state === 'accepted' &&
                  p.closedAt !== null &&
                  p.closedAt.slice(0, 10) >= week &&
                  p.closedAt.slice(0, 10) < shiftDate(week, 7),
              ).length,
            }
          }),
        ),
      }
    },

    untested(areas: readonly string[]): Untested {
      const items = liveItemsOf(areas)
      return {
        edition: world.editions.find((e) => e.live)?.label ?? null,
        areas: areas.map((area) => {
          const own = items.filter(({ item }) => item.areaId === area)
          const byKind = Object.fromEntries(itemKinds.map((kind) => [kind, 0])) as Record<
            ItemKind,
            number
          >
          for (const { item } of own.filter(({ tested }) => !tested)) byKind[item.kind]++
          const untested = own.filter(({ tested }) => !tested).length
          return {
            area,
            items: own.length,
            untested,
            untestedRequired: byKind.event + byKind.example,
            byKind,
          }
        }),
      }
    },

    fixNext(areas: readonly string[], everyArea: boolean, limit = 25): FixNext {
      const today = world.today
      const candidates: FixCandidate[] = []
      // Test questions: the newest weekly run's verdict against the run before it (the weekly
      // baseline), and the live edition's retrieval pass, without a model.
      const live = world.editions.find((e) => e.live)
      const pass = live ? passOf(live) : null
      for (const area of areas) {
        const runs = weeklyRuns(area)
        const newest = runs.at(-1)
        const before = runs.at(-2)
        for (const q of questionsOf(area)) {
          const answer = newest?.answers.find((a) => a.id === q.id)
          const retrieval =
            live && pass
              ? delivered(live, pass.asOf)(q).length === q.expected.must_deliver.length
              : null
          if (!answer && retrieval === null) continue
          const answerFails = answer?.verdict === 'fail' || answer?.verdict === 'no_answer'
          candidates.push({
            type: 'question',
            area,
            id: q.id,
            risk: q.risk,
            answer: answer?.verdict ?? null,
            regression:
              answerFails && before?.answers.find((a) => a.id === q.id)?.verdict === 'pass',
            retrieval,
            failedChecks: [
              ...new Set([
                ...(answer?.failedChecks ?? []),
                ...(retrieval === false ? ['delivered'] : []),
              ]),
            ].sort(),
            since: (answerFails ? newest?.point.finishedAt : pass?.createdAt) ?? null,
          })
        }
      }
      for (const gap of world.gaps)
        if (
          (gap.status === 'open' || gap.status === 'proposal_made') &&
          // A gap whose topic spans areas shows in each of them, as on the service.
          (everyArea || gap.topic.areaIds.some((area) => areas.includes(area)))
        )
          candidates.push({
            type: 'gap',
            area: gap.topic.areaId,
            id: gap.id,
            ref: gap.ref,
            gapType: gap.type,
            status: gap.status,
            severity: gap.severity,
            reports: gap.reports ?? 0,
            lastSeen: gap.lastSeen,
          })
      for (const { item, tested } of liveItemsOf(areas)) {
        if (item.validity.end !== null && item.validity.end <= today) continue
        const past =
          item.reviewDate !== null && item.reviewDate < today
            ? Math.round(
                (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${item.reviewDate}T00:00:00Z`)) /
                  86_400_000,
              )
            : null
        candidates.push({
          type: 'item',
          area: item.areaId,
          id: item.id,
          title: item.title,
          kind: item.kind,
          risk: item.riskLevel,
          daysPastReview: past,
          reviewDate: item.reviewDate,
          untested: !tested,
        })
      }
      return {
        edition: world.editions.find((e) => e.live)?.label ?? null,
        entries: rankFixNext(candidates, limit),
      }
    },
  }
}

/**
 * One run's side of a test question across two runs (quality.compareQuestion), from the run's
 * detail and each try's transcript, read as the service reads its stored scores (`tryEvidence`).
 * The mock keeps no revisions, so a run that has the question used its current revision.
 */
export function questionSide(
  detail: EvalRunDetail,
  question: TestQuestion,
  transcript: (cell: EvalRunDetail['cells'][number]) => EvalTranscript,
  digests: { prompt: string; wordings: string },
): { side: QuestionComparison['run']; setup: RunSetup } {
  const { run } = detail
  const result = detail.results.find((candidate) => candidate.id === question.id)
  const revision = result ? question.revision : null
  const cells = detail.cells.filter((cell) => cell.questionId === question.id)
  const wordings = [...new Set(cells.map((cell) => cell.wording))].map((wording) => {
    const tries = cells
      .filter((cell) => cell.wording === wording)
      .map((cell) => {
        const read = transcript(cell)
        return {
          cell,
          caveat: typeof read.scores.caveat === 'boolean' ? read.scores.caveat : null,
          evidence: tryEvidence(read.scores, read.messages),
        }
      })
    return {
      wording,
      verdict:
        revision === null
          ? null
          : wordingVerdict(
              tries.map(({ cell, caveat, evidence }) => ({
                passed: cell.passed,
                caveat,
                checks: evidence.checks,
              })),
            ),
      tries: tries.map(({ cell, evidence }) => ({
        cell: cell.id,
        trial: cell.trial,
        passed: cell.passed,
        refused: cell.refused,
        reused: cell.reused,
        error: cell.error,
        ...evidence,
      })),
    }
  })
  return {
    side: {
      run: {
        id: run.id,
        kind: run.kind === 'full' ? 'full' : 'scheduled',
        edition: run.edition,
        finishedAt: run.finishedAt ?? run.createdAt,
        modelId: run.modelId,
        judgeModelId: run.judgeModelId,
        toolSchemaDigest: run.toolSchemaDigest || null,
        promptDigest: digests.prompt,
        tries: run.tries,
      },
      revision,
      verdict: result?.baseline ?? null,
      layers: result?.layers?.baseline ?? null,
      wordings,
    },
    setup: {
      edition: run.edition,
      revision,
      wordings: revision === null ? null : digests.wordings,
      tries: run.tries,
      answer_model: run.modelId,
      judge_model: run.judgeModelId,
      tool_descriptions: run.toolSchemaDigest || null,
      prompt: digests.prompt,
    },
  }
}
