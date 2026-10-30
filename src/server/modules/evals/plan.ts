import { createHash } from 'node:crypto'
import { canonicalJson } from '../../../domain/canonical.ts'
import type { GoldenQuestion } from '../../../domain/golden-question.ts'
import { onDay, type Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { toolSchemaDigest } from '../../mcp/tools.ts'
import type { ServingBundle } from '../editions/index.ts'
import { costMicros, type ModelChoice } from '../models/index.ts'
import { previewDelivery } from '../proposals/index.ts'
import { answerPromptDigest, judgePromptDigest } from './answer.ts'

/**
 * Planning a run without a model: what each wording would be delivered on each side (the
 * resolver through get_facts's own code), the impact set (FR-511) and the cell cache keys
 * (FR-522). Nothing here calls a model.
 */

export type ArmName = 'baseline' | 'candidate'
export type PlannedQuestion = {
  id: string
  revision: number
  /** In the impact set: a wording's delivery changes, or the question names the changed item. */
  impact: boolean
  /** Attached to the proposal (FR-524): planned with it, reported only. Absent when not. */
  attached?: true
  /** Cache key base per arm and wording (hex); a cell key adds the trial. */
  keys: Partial<Record<ArmName, string[]>>
  /**
   * The day the question is asked on: its own as-of day, or the run's day when it has none.
   * Absent on runs planned before it was kept, which ask on the day they are worked.
   */
  asOf?: string
}
export type Plan = { questions: PlannedQuestion[]; setAside: string[] }
export type LoadedQuestion = { id: string; revision: number; body: GoldenQuestion }

const sha = (value: unknown) => createHash('sha256').update(canonicalJson(value)).digest('hex')

/**
 * The clock a question is asked on: its as-of day when it has one, so a wording without dates
 * means the days its expectations were written for, whatever day the run is (round 6). The time
 * still runs, for the request limits and timings.
 */
export const questionClock = (clock: Clock, q: Pick<GoldenQuestion, 'as_of'>): Clock =>
  q.as_of ? onDay(clock, q.as_of) : clock

/** What get_facts delivers for one wording on one side, without the per-call delivery id. */
async function deliveryDigest(
  bundle: ServingBundle,
  clock: Clock,
  q: GoldenQuestion,
  text: string,
) {
  const reply = await previewDelivery(bundle, questionClock(clock, q), {
    question: text,
    ...q.scope,
  })
  const { delivery_id: _id, ...rest } = reply.structuredContent
  return sha(rest)
}

export type Models = { answer: ModelChoice; judge: ModelChoice }
/** The tools each side of a run offers the model, fixed when the run is planned. */
export type ArmTools = Record<ArmName, string[]>
/** Everything that decides an answer's result except the trial (plan section 7.6). */
function keyBase(
  q: GoldenQuestion,
  text: string,
  delivered: string,
  models: Models,
  offered: readonly string[],
) {
  return sha({
    v: 1,
    wording: text,
    expected: q.expected,
    rubrics: q.rubrics,
    // Only a question with its own day names it, so the keys of the others stay as they were.
    ...(q.as_of ? { as_of: q.as_of } : {}),
    delivered,
    tools: toolSchemaDigest,
    // Which tools are switched on changes what the model can do (FR-407, FR-523).
    offered,
    answer: { model: models.answer.id, effort: models.answer.effort, prompt: answerPromptDigest },
    judge: { model: models.judge.id, effort: models.judge.effort, prompt: judgePromptDigest },
  })
}
export const cellKey = (base: string, trial: number) => sha({ base, trial })

export async function planQuestions(
  questions: readonly LoadedQuestion[],
  sides: Partial<Record<ArmName, ServingBundle>>,
  clock: Clock,
  models: Models,
  changed: readonly string[],
  tools: ArmTools,
): Promise<PlannedQuestion[]> {
  const planned: PlannedQuestion[] = []
  for (const { id, revision, body } of questions) {
    const keys: PlannedQuestion['keys'] = {}
    const digests: Partial<Record<ArmName, string[]>> = {}
    for (const arm of ['baseline', 'candidate'] as const) {
      const bundle = sides[arm]
      if (!bundle) continue
      digests[arm] = []
      keys[arm] = []
      for (const wording of body.wordings) {
        const delivered = await deliveryDigest(bundle, clock, body, wording.text)
        digests[arm].push(delivered)
        keys[arm].push(keyBase(body, wording.text, delivered, models, tools[arm]))
      }
    }
    const named = [...body.expected.must_deliver, ...body.expected.must_not_deliver]
    const impact =
      changed.some((item) => named.includes(item)) ||
      (digests.baseline !== undefined &&
        digests.candidate !== undefined &&
        digests.baseline.some((d, i) => d !== digests.candidate![i]))
    planned.push({ id, revision, impact, keys, asOf: body.as_of ?? clock.today() })
  }
  return planned
}

/** The active questions of the given areas (all areas when null), with set-aside ones counted apart. */
export async function loadActiveQuestions(
  tx: Queryable,
  areas: readonly string[] | null,
): Promise<{ questions: LoadedQuestion[]; setAside: string[] }> {
  const rows = await tx.query<{
    id: string
    revision: number
    body: GoldenQuestion
    aside: boolean
  }>(
    `select q.id,q.revision,r.body,q.set_aside_reason is not null as aside
       from golden_questions q join golden_question_revisions r on r.question_id=q.id and r.revision=q.revision
      where q.status='active' and ($1::text[] is null or q.area_id=any($1)) order by q.id`,
    [areas],
  )
  return {
    questions: rows
      .filter((r) => !r.aside)
      .map(({ id, revision, body }) => ({ id, revision, body })),
    setAside: rows.filter((r) => r.aside).map((r) => r.id),
  }
}

/** The exact question texts a run used (FR-510). */
export async function loadRevisions(
  tx: Queryable,
  planned: readonly { id: string; revision: number }[],
): Promise<Map<string, GoldenQuestion>> {
  const rows = await tx.query<{ id: string; body: GoldenQuestion }>(
    `select r.question_id as id,r.body from golden_question_revisions r
       join unnest($1::text[],$2::int[]) as p(id,revision) on p.id=r.question_id and p.revision=r.revision`,
    [planned.map((p) => p.id), planned.map((p) => p.revision)],
  )
  return new Map(rows.map((r) => [r.id, r.body]))
}

export const testSetDigest = (planned: readonly { id: string; revision: number }[]) =>
  sha(planned.map((p) => [p.id, p.revision]))

/**
 * A typical judge call, for the evaluations and the assistant cases. Round 6 measured about 600
 * tokens in and 800 out for Gemini 2.5 Flash-Lite, which reasons first, and 1,000 in and 130 out
 * for a Claude judge.
 */
const typicalJudgeCall = { inputTokens: 1_000, outputTokens: 600, cacheReadTokens: 0 }
/**
 * A typical cell: two or three answer steps (a tool call, then the answer) and one judge call.
 * The answer steps send their instructions and tools through the prompt cache: round 6 measured
 * 12,800 tokens in a cell, 70% read from the cache and the rest written to it, and 800 (Sonnet)
 * to 1,200 (Haiku) out. A model without cache prices bills them all at its input price.
 */
const typicalAnswer = {
  inputTokens: 13_000,
  cacheReadTokens: 9_000,
  cacheWriteTokens: 4_000,
  outputTokens: 1_200,
}
export const cellEstimateMicros = (models: Models) =>
  costMicros(models.answer.prices, typicalAnswer) +
  costMicros(models.judge.prices, typicalJudgeCall)

/** FR-516: the estimate counts every cell without a cached result, at the first tries only. */
export async function estimate(
  tx: Queryable,
  planned: readonly PlannedQuestion[],
  tries: number,
  models: Models,
): Promise<{ cells: number; cached: number; micros: number }> {
  const keys = planned.flatMap((q) =>
    Object.values(q.keys).flatMap((bases) =>
      bases.flatMap((base) => Array.from({ length: tries }, (_, t) => cellKey(base, t + 1))),
    ),
  )
  const unique = [...new Set(keys)]
  const cached = unique.length
    ? (
        await tx.query<{ n: string }>(
          `select count(distinct cache_key)::text as n from eval_cells
            where cache_key=any($1::bytea[]) and passed is not null and reused_from is null and not refused`,
          [unique.map((k) => Buffer.from(k, 'hex'))],
        )
      )[0]!.n
    : '0'
  const fresh = unique.length - Number(cached)
  return { cells: keys.length, cached: Number(cached), micros: fresh * cellEstimateMicros(models) }
}
