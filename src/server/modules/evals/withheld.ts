import { APICallError } from '@ai-sdk/provider'
import type { Logger } from 'pino'
import {
  questionVerdict,
  wordingVerdict,
  type CellScore,
  type GoldenQuestion,
  type Judging,
  type PassRule,
  type Verdict,
} from '../../../domain/golden-question.ts'
import { onDay } from '../../clock.ts'
import type { Database } from '../../db/database.ts'
import { errorCode } from '../../observability/logger.ts'
import {
  createCallMeter,
  ModelCallError,
  readCallLimits,
  testRunRetry,
  type CallLimiter,
  type Sleep,
} from '../models/index.ts'
import { tryQuestion } from './answer.ts'
import { openArm, ToolCallRefused, type Arm } from './arm.ts'
import { cellEstimateMicros } from './plan.ts'
import { armTools, insertRun, liveHead, modelsFor, sidesFor, type EvalDeps } from './runs.ts'
import { readEvalSettings } from './settings.ts'
import { capReached, formatUsd } from './spend.ts'
import { CEILING_MARGIN } from './worker.ts'

/*
  An area run of questions held in memory, of which nothing is kept (FR-525): the sealed held-out
  questions, which only the code that opened them hands over (db/seed/held-out-runs.ts). It is the
  same runner as every area run: the live edition, the eval client's tools through the real MCP
  wire, each question on its own as-of day, the same answer, judge and score (`tryQuestion`), the
  run's tries and pass rule, the call limits, the spending caps and a cost ceiling. But no
  question's words, expectations, answer or transcript reach the database or a log: there are no
  cells and no transcripts, and the run is recorded only for its model calls and cost (kind
  `held_out`, no area, no question ids), with counts in words. The caller gets a verdict per
  question, in the order given, and says nothing more than counts.
*/

export type WithheldOptions = {
  area: string
  questions: readonly GoldenQuestion[]
  /** Who the run counts against for the daily limit; null at the command line. */
  person: string | null
  /** The most the run may spend, in micros; null when only the spending caps apply. */
  ceilingMicros: number | null
  passRule?: PassRule
  signal: AbortSignal
  logger: Logger
  limiter?: CallLimiter
  wait?: Sleep
}

export type WithheldRun = {
  runId: string
  /** `incomplete` when an answer could not be made, or the run stopped at a cap or its ceiling. */
  state: 'finished' | 'incomplete'
  /** One per question, in the order given; `no_answer` for one that was not answered. */
  verdicts: Verdict[]
  judging: Judging
  costMicros: number
  /** Why the run stopped before every answer was made, in words without a question in them. */
  stopped: string | null
}

/** What a run of these questions would make and cost: counts and money only. */
export async function estimateWithheld(
  database: Database,
  deps: EvalDeps,
  questions: readonly GoldenQuestion[],
): Promise<{ edition: string | null; cells: number; costMicros: number }> {
  return database.transaction(null, async (tx) => {
    const head = await liveHead(tx)
    const settings = await readEvalSettings(tx)
    const models = modelsFor(deps.port, settings)
    const cells = questions.reduce((n, q) => n + q.wordings.length * settings.tries, 0)
    return { edition: head?.label ?? null, cells, costMicros: cells * cellEstimateMicros(models) }
  })
}

/** Why a run stops starting answers: a spending cap or its ceiling. */
class Halt extends Error {}

/** Runs the questions as one area run, keeping none of their words. */
export async function runWithheld(
  database: Database,
  deps: EvalDeps,
  options: WithheldOptions,
): Promise<WithheldRun> {
  const { questions, person, signal } = options
  const rule = options.passRule ?? 'majority'
  const prepared = await database.transaction(person, async (tx) => {
    const head = await liveHead(tx)
    if (!head) throw new Error('There is no live edition yet')
    const settings = await readEvalSettings(tx)
    const models = modelsFor(deps.port, settings)
    const tools = await armTools(tx, 'full')
    const bundle = (await sidesFor(tx, head, null)).baseline!
    const cells = questions.reduce((n, q) => n + q.wordings.length * settings.tries, 0)
    const run = await insertRun(tx, {
      kind: 'held_out',
      state: 'running',
      // No area: the run is listed for administrators and its requester, not in an area's runs.
      area: null,
      proposal: null,
      version: null,
      head,
      models,
      settings,
      planned: [],
      summary: {
        edition: head.label,
        plan: { questions: [], setAside: [] },
        estimate: { cells, cached: 0, micros: cells * cellEstimateMicros(models) },
        tools,
        manual: person !== null,
        heldOut: { area: options.area, questions: questions.length },
        ...(rule !== 'majority' ? { passRule: rule } : {}),
      },
      requestedBy: person,
      costCeilingMicros: options.ceilingMicros,
    })
    return { run, settings, models, tools, bundle }
  })
  const { run, settings, models, tools, bundle } = prepared
  const limits = await readCallLimits(database)
  const ceiling = options.ceilingMicros
  const estimate = cellEstimateMicros(models)
  let spent = 0
  let reserved = 0
  /** Why the run stopped starting answers, once it did. */
  const halt: { reason: string | null } = { reason: null }
  const failed: Record<string, number> = {}
  // Each question's tries, one list per wording; a try not made stays out.
  const scores = questions.map((q) => q.wordings.map((): CellScore[] => []))
  const arms = new Map<string, Promise<Arm>>()
  const armOn = (day: string) => {
    let arm = arms.get(day)
    if (!arm) {
      arm = openArm(bundle, database, onDay(deps.clock, day), tools.baseline)
      arms.set(day, arm)
    }
    return arm
  }
  const queue = questions.flatMap((q, question) =>
    q.wordings.flatMap((_, wording) =>
      Array.from({ length: settings.tries }, () => ({ question, wording })),
    ),
  )
  const total = queue.length

  async function makeTry(question: number, wording: number) {
    if (await capReached(database, settings, estimate, person))
      throw new Halt('A spending cap stopped it.')
    const hold = Math.ceil(estimate * CEILING_MARGIN)
    if (ceiling !== null && spent + reserved + hold > ceiling)
      throw new Halt(`It spent ${formatUsd(spent)} of its ${formatUsd(ceiling)} ceiling.`)
    reserved += hold
    const meter = createCallMeter({
      database,
      feature: 'eval',
      person,
      runId: run.id,
      limits,
      retry: testRunRetry,
      ...(options.limiter ? { limiter: options.limiter } : {}),
      ...(options.wait ? { wait: options.wait } : {}),
      admit: () => {
        if (ceiling !== null && spent >= ceiling)
          throw new Halt(`It spent its ${formatUsd(ceiling)} ceiling.`)
      },
      onCall: (call) => {
        spent += call.costMicros
      },
      onRecordError: (error) =>
        options.logger.error({ err: errorCode(error), run: run.id }, 'model call not recorded'),
    })
    try {
      const body = questions[question]!
      const made = await tryQuestion(
        await armOn(body.as_of ?? deps.clock.today()),
        {
          answer: meter.wrap(models.answer, { role: 'eval_answer' }),
          judge: meter.wrap(models.judge, { role: 'judge' }),
        },
        body,
        wording,
        signal,
      )
      await meter.settled()
      scores[question]![wording]!.push(made.score)
    } catch (error) {
      await meter.close()
      if (error instanceof Halt || signal.aborted) throw error
      // The kind of failure only: a provider's message can quote the request, question included.
      const kind =
        error instanceof ModelCallError
          ? error.kind
          : error instanceof ToolCallRefused
            ? 'tool'
            : APICallError.isInstance(error)
              ? 'provider'
              : 'error'
      failed[kind] = (failed[kind] ?? 0) + 1
      options.logger.warn(
        { err: errorCode(error), run: run.id, failure: kind },
        'held-out answer failed',
      )
    } finally {
      reserved -= hold
    }
  }

  try {
    await Promise.all(
      Array.from({ length: Math.min(limits.concurrency, queue.length) }, async () => {
        for (let next = queue.shift(); next && !halt.reason; next = queue.shift()) {
          if (signal.aborted) {
            halt.reason = 'It was stopped before it finished.'
            break
          }
          try {
            await makeTry(next.question, next.wording)
          } catch (error) {
            if (signal.aborted) halt.reason = 'It was stopped before it finished.'
            else if (error instanceof Halt) halt.reason = error.message
            else throw error
          }
        }
      }),
    )
  } finally {
    for (const arm of arms.values()) await (await arm.catch(() => null))?.close()
  }

  const verdicts = scores.map((wordings) =>
    questionVerdict(wordings.map((tries) => wordingVerdict(tries, rule))),
  )
  const tries = scores.flat(2)
  const judging = {
    judged: tries.filter((t) => t.passed !== null || t.judgeError).length,
    errors: tries.filter((t) => t.judgeError).length,
  }
  const made = tries.length
  const missing = total - made
  const failures = Object.entries(failed)
    .map(([kind, n]) => `${n} ${kind}`)
    .join(', ')
  const stopped =
    halt.reason || missing
      ? `${halt.reason ? `${halt.reason} ` : ''}${missing} of ${total} answers not made${failures ? ` (${failures})` : ''}.`
      : null
  const count = (verdict: Verdict) => verdicts.filter((v) => v === verdict).length
  const words =
    `Held-out questions: ${count('pass')} passed, ${count('fail')} failed, ` +
    `${count('no_answer')} without an answer, of ${questions.length}.`
  const state = stopped ? 'incomplete' : 'finished'
  const [row] = await database.transaction(person, (tx) =>
    tx.query<{ cost: string }>(
      `update eval_runs set state=$2,finished_at=now(),worker=null,lease_until=null,failure=$3,
         summary=summary||jsonb_build_object('judging',$4::jsonb)
       where id=$1 returning actual_cost_micros::text as cost`,
      [
        run.id,
        state,
        `${stopped ? `${stopped} ` : ''}${words}`.slice(0, 500),
        JSON.stringify(judging),
      ],
    ),
  )
  return {
    runId: run.id,
    state,
    verdicts,
    judging,
    costMicros: Number(row?.cost ?? spent),
    stopped,
  }
}
