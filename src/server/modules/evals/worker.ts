import { randomUUID } from 'node:crypto'
import { APICallError } from '@ai-sdk/provider'
import type { Logger } from 'pino'
import {
  agreementOf,
  flipOf,
  questionLayers,
  questionVerdict,
  wordingVerdict,
  type CellScore,
  type GoldenQuestion,
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
  type CallLimits,
  type Sleep,
} from '../models/index.ts'
import { readVersion } from '../proposals/index.ts'
import { tryQuestion } from './answer.ts'
import { openArm, ToolCallRefused, type Arm } from './arm.ts'
import { cellEstimateMicros, cellKey, loadRevisions, type ArmName, type Models } from './plan.ts'
import { replayDeliveries } from './replay.ts'
import {
  failRun,
  finishRun,
  headAt,
  modelsFor,
  queueVersionRun,
  runColumns,
  sidesFor,
  sidesOfRun,
  stopRun,
  type EvalDeps,
  type QuestionResult,
  type RunRow,
  type RunStop,
} from './runs.ts'
import { readEvalSettings, type EvalSettings } from './settings.ts'
import { capReached, formatUsd } from './spend.ts'

/**
 * The `evals.work` job: queue answer tests that are due, then work queued runs cell by cell until
 * the time slice ends. Every cell is saved as soon as it finishes, so a run that outlives a slice
 * (or the service) continues where it stopped. A cell whose inputs did not change reuses the
 * earlier result without a model call (FR-522); within a run, cells with the same inputs run once,
 * so an unchanged question cannot flip by chance.
 *
 * One worker works a run at a time: it holds a lease on the run and renews it while it works, so
 * the job never answers the cells of a run the command line is working (the cause of the spend
 * ledger counting a run twice). Every model call goes through the model call meter, which limits,
 * retries and records it. An answer the provider could not make is no quality result: the run
 * ends incomplete and can be resumed to make only those (R6). An answer the judge could not grade
 * is kept with its judge error, as neither a pass nor a fail, and the run counts them.
 */

export type WorkOptions = {
  deadline: number
  signal: AbortSignal
  logger: Logger
  /** Work this run only, with no queueing or expiry (the command line). */
  only?: string
  /** Who works: the lease holder's name. A new one per call unless given. */
  worker?: string
  /** Tests give their own limiter and clock for the waits. */
  limiter?: CallLimiter
  wait?: Sleep
}
export type WorkSummary = {
  queued: number
  runs: string[]
  cells: number
  expired: number
  resumed: number
}

/** How long a lease lasts without being renewed, and how often a working worker renews it. */
const LEASE = '5 minutes'
const HEARTBEAT_MS = 60_000
/**
 * Each answer in flight holds room under a run's cost ceiling: its estimate times this margin,
 * since a real answer can read more and reason longer than the estimate.
 */
export const CEILING_MARGIN = 1.5
/** An incomplete run that only lacks answers the provider failed is resumed this often, at most. */
const AUTO_RESUMES = 3
const AUTO_RESUME_AFTER = '15 minutes'

class Stop extends Error {}
/** The run stops, incomplete, for a reason that is not a failure of the run itself. */
class Halt extends Error {
  readonly reason: RunStop['reason']
  constructor(reason: RunStop['reason'], message: string) {
    super(message)
    this.reason = reason
  }
}

type Cell = { question: string; wording: number; arm: ArmName; trial: number }
const cellId = (c: Cell) => `${c.question}|${c.wording}|${c.arm}|${c.trial}`

export async function workEvaluations(
  database: Database,
  deps: EvalDeps,
  options: WorkOptions,
): Promise<WorkSummary> {
  const summary: WorkSummary = { queued: 0, runs: [], cells: 0, expired: 0, resumed: 0 }
  const worker = options.worker ?? randomUUID()
  if (options.only === undefined) await housekeeping(database, deps, options, summary)
  while (Date.now() < options.deadline && !options.signal.aborted) {
    // A run in flight first, then the oldest queued one; never one another worker holds.
    const [run] = await database.query<RunRow>(
      `update eval_runs set state='running',started_at=coalesce(started_at,now()),worker=$2,
              lease_until=now()+interval '${LEASE}'
        where id=(select id from eval_runs
                   where state in ('queued','running') and ($1::uuid is null or id=$1)
                     -- The assistant's test cases and the held-out questions are worked by the
                     -- command that runs them.
                     and kind not in ('assistant_mock','assistant_real','held_out')
                     and (worker is null or worker=$2 or lease_until is null or lease_until<now())
                   order by (state='running') desc,created_at limit 1 for update skip locked)
        returning ${runColumns}`,
      [options.only ?? null, worker],
    )
    if (!run) break
    summary.runs.push(run.id)
    const done = await workRun(database, deps, run, { ...options, worker }, summary)
    if (!done) break
  }
  return summary
}

async function housekeeping(
  database: Database,
  deps: EvalDeps,
  options: WorkOptions,
  summary: WorkSummary,
) {
  // FR-517: a scheduled run that has not finished within a day is failed and alerted, once.
  const expired = await database.query<{ id: string; area_id: string }>(
    `update eval_runs set state='failed',finished_at=now(),failure='The scheduled run did not finish within 24 hours',
            worker=null,lease_until=null
      where kind='scheduled' and state in ('estimated','awaiting_approval','queued','running')
        and created_at < now() - interval '24 hours' returning id::text,area_id`,
  )
  for (const run of expired)
    options.logger.error(
      { alert: 'eval_run_unfinished', run: run.id, area: run.area_id },
      'scheduled evaluation run did not finish',
    )
  summary.expired = expired.length
  // R6: a run the service started that stopped only because the provider kept failing is tried
  // again a while later, a few times. A run with a cost ceiling was approved at the command line,
  // with its own models: it is resumed there.
  const resumed = await database.query(
    `update eval_runs set state='queued',finished_at=null,failure=null,
            summary=summary||jsonb_build_object('resumes',coalesce((summary->>'resumes')::int,0)+1)
      where state='incomplete' and cost_ceiling_micros is null
        and kind not in ('assistant_mock','assistant_real','held_out')
        and summary->'stopped'->>'reason'='infrastructure'
        and coalesce((summary->>'resumes')::int,0) < ${AUTO_RESUMES}
        and finished_at < now() - interval '${AUTO_RESUME_AFTER}'
      returning id`,
  )
  summary.resumed = resumed.length
  // Versions under review whose answer tests have not run against the live edition yet.
  for (const due of await database.query<{ version: string; proposer: string }>(
    'select version_id::text as version,proposer_id::text as proposer from cl_eval_versions_due()',
  )) {
    try {
      const queued = await database.transaction(due.proposer, (tx) =>
        queueVersionRun(tx, deps, due.version),
      )
      if (queued) summary.queued++
    } catch (error) {
      options.logger.error(
        { err: errorCode(error), version: due.version },
        'could not queue answer tests',
      )
    }
  }
}

type Options = WorkOptions & { worker: string }

/** Returns false when the slice ended before the run did. */
async function workRun(
  database: Database,
  deps: EvalDeps,
  run: RunRow,
  options: Options,
  summary: WorkSummary,
): Promise<boolean> {
  const person = run.requested_by
  const log = options.logger.child({ run: run.id, kind: run.kind })
  const arms = new Map<string, Promise<Arm>>()
  const heartbeat = setInterval(() => {
    database
      .query(
        `update eval_runs set lease_until=now()+interval '${LEASE}' where id=$1 and worker=$2`,
        [run.id, options.worker],
      )
      .catch((error: unknown) => log.warn({ err: errorCode(error) }, 'lease not renewed'))
  }, HEARTBEAT_MS)
  heartbeat.unref()
  try {
    const settings = await readEvalSettings(database)
    const limits = await readCallLimits(database)
    const models = modelsFor(deps.port, settings)
    if (models.answer.id !== run.model_id || models.judge.id !== run.judge_model_id)
      throw new Halt(
        'stopped',
        `The run was planned for ${run.model_id} judged by ${run.judge_model_id ?? 'unknown'}; this service now uses ${models.answer.id} judged by ${models.judge.id}. Resume it with those models, or restore the settings.`,
      )
    const { bodies, sides } = await database.transaction(person, async (tx) => {
      const version = run.item_version_id ? await readVersion(tx, run.item_version_id) : null
      if (run.item_version_id && !version)
        throw new Error('The run cannot read the version it checks')
      const sides = sidesOfRun(
        run.kind,
        await sidesFor(tx, await headAt(tx, run.baseline_edition_seq!), version),
      )
      // FR-512: how many stored deliveries the change would alter, by topic, without a model.
      if (version && sides.candidate && !run.summary.replay) {
        const replay = await replayDeliveries(tx, sides.baseline!, sides.candidate)
        await tx.query(
          "update eval_runs set summary=summary||jsonb_build_object('replay',$2::jsonb) where id=$1",
          [run.id, JSON.stringify(replay)],
        )
        run.summary.replay = replay
      }
      return { bodies: await loadRevisions(tx, run.summary.plan.questions), sides }
    })
    const paired = sides.candidate !== undefined
    const scores = await finishedCells(database, run.id)
    const rule: PassRule = run.summary.passRule ?? 'majority'
    const context: CellContext = {
      database,
      run,
      models,
      settings,
      limits,
      bodies,
      scores,
      options,
      summary,
      log,
      person: run.summary.manual ? person : null,
      ceiling: run.cost_ceiling_micros === null ? null : Number(run.cost_ceiling_micros),
      spent: Number(run.actual_cost_micros),
      reserved: 0,
      arm(name, day) {
        const key = `${name}|${day ?? ''}`
        let arm = arms.get(key)
        if (!arm) {
          const clock = day ? onDay(deps.clock, day) : deps.clock
          arm = openArm(sides[name]!, database, clock, run.summary.tools?.[name])
          arms.set(key, arm)
        }
        return arm
      },
    }
    const armNames: ArmName[] = paired ? ['baseline', 'candidate'] : ['baseline']
    const cells = (trials: number[], questions = run.summary.plan.questions) =>
      questions.flatMap((q) =>
        bodies
          .get(q.id)!
          .wordings.flatMap((_, wording) =>
            armNames.flatMap((arm) =>
              trials.map((trial) => ({ question: q.id, wording, arm, trial })),
            ),
          ),
      )
    const range = (from: number, to: number) =>
      Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i)
    await runCells(context, cells(range(1, run.tries)))
    if (await stopIfMissing(database, run, log)) return true
    // FR-515: a case that flips between baseline and candidate is repeated and the majority decides.
    const flipped = paired
      ? run.summary.plan.questions.filter((q) => {
          const r = resultOf(q.id, bodies.get(q.id)!, scores, run.flip_repeats, armNames, rule)
          return r.baseline !== r.candidate
        })
      : []
    if (flipped.length) {
      await runCells(context, cells(range(run.tries + 1, run.flip_repeats), flipped))
      if (await stopIfMissing(database, run, log)) return true
    }
    const tries = (id: string, arm: ArmName) =>
      triesOf(id, bodies.get(id)!, scores, run.flip_repeats, arm)
    const results: QuestionResult[] = run.summary.plan.questions.map((q) => {
      const r = resultOf(q.id, bodies.get(q.id)!, scores, run.flip_repeats, armNames, rule)
      // Each side split into its code-checked and judge-checked layers.
      const layers = (arm: ArmName) => questionLayers(tries(q.id, arm), rule)
      return {
        id: q.id,
        impact: q.impact,
        ...(q.attached ? { attached: true as const } : {}),
        baseline: r.baseline,
        candidate: paired ? r.candidate : null,
        flip: paired ? flipOf(r.baseline, r.candidate) : null,
        layers: { baseline: layers('baseline'), candidate: paired ? layers('candidate') : null },
      }
    })
    // Where the judge and the code checks disagree, per side, by question and by try.
    const agreement = (arm: ArmName) =>
      agreementOf(
        results.flatMap((q) => {
          const layers = q.layers?.[arm]
          return layers ? [{ id: q.id, layers }] : []
        }),
        run.summary.plan.questions.flatMap((q) => tries(q.id, arm).flat()),
      )
    await database.transaction(person, async (tx) => {
      const [current] = await tx.query<RunRow>(
        `select ${runColumns} from eval_runs where id=$1 for update`,
        [run.id],
      )
      if (current?.state === 'running' && current.worker === options.worker)
        await finishRun(tx, current, results, {
          baseline: agreement('baseline'),
          candidate: paired ? agreement('candidate') : null,
        })
    })
    log.info({ questions: results.length, cells: summary.cells }, 'evaluation run finished')
    return true
  } catch (error) {
    if (error instanceof Stop) {
      // The command line stopped (Ctrl-C, or its deadline): the run ends incomplete, resumable.
      // The job's slice ended: the next slice, or another worker, takes the run over at once.
      if (options.only !== undefined)
        await database.transaction(person, async (tx) => {
          const [held] = await tx.query<{ id: string }>(
            "select id::text from eval_runs where id=$1 and state='running' and worker=$2 for update",
            [run.id, options.worker],
          )
          if (held) await stopRun(tx, held, 'stopped')
        })
      else
        await database.query(
          'update eval_runs set worker=null,lease_until=null where id=$1 and worker=$2',
          [run.id, options.worker],
        )
      return false
    }
    if (error instanceof Halt) {
      log.warn({ reason: error.reason }, 'evaluation run stopped before it finished')
      await database.transaction(person, (tx) => stopRun(tx, run, error.reason, error.message))
      return true
    }
    const reason = `The evaluation run failed: ${(error instanceof Error ? error.message : String(error)).slice(0, 300)}`
    log.error({ err: errorCode(error) }, 'evaluation run failed')
    await database.transaction(person, (tx) => failRun(tx, run, reason))
    return true
  } finally {
    clearInterval(heartbeat)
    for (const arm of arms.values()) await (await arm.catch(() => null))?.close()
  }
}

/** Ends the run incomplete when an answer could not be made; true when it did. */
async function stopIfMissing(database: Database, run: RunRow, log: Logger): Promise<boolean> {
  const [failed] = await database.query<{ n: number }>(
    "select count(*)::int as n from eval_cells where run_id=$1 and state='failed'",
    [run.id],
  )
  if (!failed?.n) return false
  log.warn({ failed: failed.n }, 'evaluation run incomplete')
  await database.transaction(run.requested_by, (tx) => stopRun(tx, run, 'infrastructure'))
  return true
}

type CellContext = {
  database: Database
  run: RunRow
  models: Models
  settings: EvalSettings
  limits: CallLimits
  bodies: Map<string, GoldenQuestion>
  scores: Map<string, CellScore>
  options: Options
  summary: WorkSummary
  log: Logger
  person: string | null
  /** The run's cost ceiling, what it spent (every call, as metered) and what answers in flight hold. */
  ceiling: number | null
  spent: number
  reserved: number
  /** The side's tool server, answering as of `day` (the question's), or the run's clock. */
  arm(name: ArmName, day: string | undefined): Promise<Arm>
}

async function finishedCells(database: Database, run: string): Promise<Map<string, CellScore>> {
  const rows = await database.query<Cell & { scores: CellScore | null; passed: boolean | null }>(
    `select question_id as question,wording,arm::text as arm,trial,passed,scores from eval_cells
      where run_id=$1 and state='finished'`,
    [run],
  )
  return new Map(
    rows.map((r) => [cellId(r), r.scores ?? { passed: r.passed, caveat: null, checks: {} }]),
  )
}

/** One side's scored tries of a question, one list per wording. */
function triesOf(
  id: string,
  body: GoldenQuestion,
  scores: Map<string, CellScore>,
  maxTrials: number,
  arm: ArmName,
): CellScore[][] {
  return body.wordings.map((_, wording) => {
    const tries: CellScore[] = []
    for (let trial = 1; trial <= maxTrials; trial++) {
      const score = scores.get(cellId({ question: id, wording, arm, trial }))
      if (score) tries.push(score)
    }
    return tries
  })
}

function resultOf(
  id: string,
  body: GoldenQuestion,
  scores: Map<string, CellScore>,
  maxTrials: number,
  arms: ArmName[],
  rule: PassRule,
): Record<ArmName, Verdict> {
  const verdict = (arm: ArmName) =>
    questionVerdict(
      triesOf(id, body, scores, maxTrials, arm).map((tries) => wordingVerdict(tries, rule)),
    )
  return {
    baseline: verdict('baseline'),
    candidate: arms.includes('candidate') ? verdict('candidate') : 'no_answer',
  }
}

/**
 * Runs cells grouped by cache key: one model call per distinct input, the rest reuse it. As many
 * groups run at once as `models.call_limits` lets a provider answer at once (R5).
 */
async function runCells(context: CellContext, cells: Cell[]) {
  const { run, scores } = context
  const groups = new Map<string, Cell[]>()
  for (const cell of cells) {
    if (scores.has(cellId(cell))) continue
    const planned = run.summary.plan.questions.find((q) => q.id === cell.question)!
    const key = cellKey(planned.keys[cell.arm]![cell.wording]!, cell.trial)
    groups.set(key, [...(groups.get(key) ?? []), cell])
  }
  const queue = [...groups]
  const workers = Array.from(
    { length: Math.min(context.limits.concurrency, queue.length) },
    async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [key, group] = next
        let failure: Failure | undefined
        for (const cell of group)
          if (failure) await failCell(context, cell, key, failure)
          else failure = await saveCell(context, cell, key)
      }
    },
  )
  const settled = await Promise.allSettled(workers)
  const failed = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected')
  if (failed) throw failed.reason
}

/** Why an answer could not be made: what the cell records, never a provider's message. */
type Failure = { kind: 'throttled' | 'provider' | 'tool' | 'error'; message: string }
function failureOf(error: unknown): Failure {
  if (error instanceof ModelCallError) return { kind: error.kind, message: error.message }
  if (error instanceof ToolCallRefused) return { kind: 'tool', message: error.message }
  // A provider's message can quote the request it failed on, prompt and question included.
  if (APICallError.isInstance(error))
    return {
      kind: 'provider',
      message: `The model provider refused the call${error.statusCode ? ` (HTTP ${error.statusCode})` : ''}`,
    }
  return {
    kind: 'error',
    message: (error instanceof Error ? error.message : String(error)).slice(0, 300),
  }
}

/**
 * Records a cell as failed with the failure of an earlier cell with the same inputs: no model call,
 * no spend. Resuming the run makes it like any failed cell.
 */
async function failCell(context: CellContext, cell: Cell, key: string, failure: Failure) {
  const planned = context.run.summary.plan.questions.find((q) => q.id === cell.question)!
  await context.database.query(
    `insert into eval_cells(run_id,question_id,question_revision,wording,arm,trial,cache_key,state,error,failure_kind,started_at,finished_at)
     values($1,$2,$3,$4,$5,$6,$7,'failed',$8,$9,now(),now())
     on conflict (run_id,question_id,wording,arm,trial) do update
       set state='failed',error=$8,failure_kind=$9,finished_at=now()`,
    [
      context.run.id,
      cell.question,
      planned.revision,
      cell.wording,
      cell.arm,
      cell.trial,
      Buffer.from(key, 'hex'),
      failure.message,
      failure.kind,
    ],
  )
  context.summary.cells++
}

/**
 * Saves one cell: a cached result when its inputs were answered before, otherwise a model call.
 * Returns why the answer could not be made, when it could not.
 */
async function saveCell(
  context: CellContext,
  cell: Cell,
  key: string,
): Promise<Failure | undefined> {
  const { database, run, options } = context
  if (Date.now() >= options.deadline || options.signal.aborted) throw new Stop()
  // Renews the lease; a run another worker took over, or one stopped, is left alone.
  const [state] = await database.query<{ state: string }>(
    `update eval_runs set lease_until=now()+interval '${LEASE}' where id=$1 and worker=$2
      returning state::text`,
    [run.id, options.worker],
  )
  if (state?.state !== 'running') throw new Stop()
  const body = context.bodies.get(cell.question)!
  const planned = run.summary.plan.questions.find((q) => q.id === cell.question)!
  const keyBytes = Buffer.from(key, 'hex')
  const [row] = await database.query<{ id: string }>(
    `insert into eval_cells(run_id,question_id,question_revision,wording,arm,trial,cache_key,state,started_at)
     values($1,$2,$3,$4,$5,$6,$7,'running',now())
     on conflict (run_id,question_id,wording,arm,trial) do update
       set state='running',started_at=now(),error=null,failure_kind=null
     returning id::text`,
    [run.id, cell.question, planned.revision, cell.wording, cell.arm, cell.trial, keyBytes],
  )
  const id = row!.id
  // The same inputs answered before, in this run (an earlier cell of the group) or an earlier one.
  const [cached] = await database.query<{ id: string; passed: boolean | null; scores: CellScore }>(
    `select id::text,passed,scores from eval_cells
      where cache_key=$1 and state='finished' and reused_from is null and not refused and passed is not null
        and id<>$2 order by finished_at desc limit 1`,
    [keyBytes, id],
  )
  if (cached) {
    await database.query(
      `update eval_cells set state='finished',passed=$2,scores=$3,reused_from=$4,cost_micros=0,finished_at=now()
        where id=$1`,
      [id, cached.passed, JSON.stringify(cached.scores), cached.id],
    )
    context.scores.set(cellId(cell), cached.scores)
    return undefined
  }
  const estimate = cellEstimateMicros(context.models)
  const cap = await capReached(database, context.settings, estimate, context.person)
  if (cap) throw new Halt('cap', cap)
  // The ceiling holds room for every answer in flight, with a margin: the next one starts only
  // when what was spent and what is held leave room for it too.
  const hold = Math.ceil(estimate * CEILING_MARGIN)
  const { ceiling } = context
  if (ceiling !== null && context.spent + context.reserved + hold > ceiling)
    throw new Halt(
      'ceiling',
      `It spent ${formatUsd(context.spent)} of its ${formatUsd(ceiling)} ceiling, too little to start another answer safely.`,
    )
  context.reserved += hold
  const meter = createCallMeter({
    database,
    feature: 'eval',
    person: context.person,
    runId: run.id,
    limits: context.limits,
    retry: testRunRetry,
    ...(options.limiter ? { limiter: options.limiter } : {}),
    ...(options.wait ? { wait: options.wait } : {}),
    // A call never starts once the run spent its ceiling, whatever the answers in flight held.
    admit: () => {
      if (ceiling !== null && context.spent >= ceiling)
        throw new Halt('ceiling', `It spent its ${formatUsd(ceiling)} ceiling.`)
    },
    onCall: (call) => {
      context.spent += call.costMicros
    },
    onRecordError: (error) =>
      context.log.error({ err: errorCode(error), cell: id }, 'model call not recorded'),
  })
  try {
    const arm = await context.arm(cell.arm, planned.asOf)
    const { answer, verdict, refused, score } = await tryQuestion(
      arm,
      {
        answer: meter.wrap(context.models.answer, { role: 'eval_answer', cell: id }),
        judge: meter.wrap(context.models.judge, { role: 'judge', cell: id }),
      },
      body,
      cell.wording,
      options.signal,
    )
    const scores = {
      ...score,
      verdict,
      delivered: answer.delivered,
      applied: answer.applied,
      reached: answer.reached,
      statuses: answer.statuses,
      // Tool calls per answer: following links must not turn into over-following (R20).
      calls: answer.toolCalls.length,
    }
    await meter.settled()
    await database.transaction(null, async (tx) => {
      await tx.query(
        `update eval_cells set state='finished',passed=$2,refused=$3,scores=$4,tokens_in=$5,tokens_out=$6,
           cost_micros=$7,finished_at=now() where id=$1`,
        [
          id,
          score.passed,
          refused,
          JSON.stringify(scores),
          meter.inputTokens,
          meter.outputTokens,
          meter.costMicros,
        ],
      )
      await tx.query(
        // Written with the finished cell, once: a cell that failed has no transcript to replace.
        'insert into eval_transcripts(cell_id,messages,tool_calls) values($1,$2,$3)',
        [id, JSON.stringify(answer.messages), JSON.stringify(answer.toolCalls)],
      )
    })
    context.scores.set(cellId(cell), scores)
    context.summary.cells++
    return undefined
  } catch (error) {
    await meter.close()
    if (options.signal.aborted) throw new Stop()
    // A stop for the whole run leaves this answer to be made when the run resumes.
    if (error instanceof Halt) throw error
    const failure = failureOf(error)
    context.log.warn(
      { err: errorCode(error), run: run.id, cell: id, failure: failure.kind },
      'evaluation cell failed',
    )
    await database.query(
      `update eval_cells set state='failed',error=$2,failure_kind=$3,tokens_in=$4,tokens_out=$5,cost_micros=$6,
         finished_at=now() where id=$1`,
      [id, failure.message, failure.kind, meter.inputTokens, meter.outputTokens, meter.costMicros],
    )
    // No quality result: the run ends incomplete, and resuming it makes this answer again.
    context.summary.cells++
    return failure
  } finally {
    context.reserved -= hold
  }
}
