import { createHash } from 'node:crypto'
import { contentDigest } from '../../../domain/canonical.ts'
import type {
  Agreement,
  CellScore,
  PassRule,
  QuestionLayers,
  Verdict,
} from '../../../domain/golden-question.ts'
import { noneWorseWords, testChange, testChangeWords } from '../../../domain/review.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { toolSchemaDigest } from '../../mcp/tools.ts'
import {
  asDelivered,
  enabledTools,
  loadServingBundle,
  type ServingBundle,
} from '../editions/index.ts'
import { verifyGapsByRun } from '../gaps/index.ts'
import {
  differentFamily,
  type JudgeSetting,
  type ModelChoice,
  type ModelPort,
} from '../models/index.ts'
import {
  attachedQuestions,
  candidateBundle,
  proposalEvent,
  readVersion,
  type StoredVersion,
} from '../proposals/index.ts'
import { answerPromptDigest } from './answer.ts'
import { evalClient } from './arm.ts'
import {
  estimate,
  loadActiveQuestions,
  loadRevisions,
  planQuestions,
  testSetDigest,
  type ArmName,
  type ArmTools,
  type Models,
  type PlannedQuestion,
} from './plan.ts'
import type { ReplayReport } from './replay.ts'
import { readEvalSettings, type EvalSettings } from './settings.ts'
import { formatUsd } from './spend.ts'

/**
 * Evaluation runs. A run is planned and costed without a model, stored, and then worked by the
 * `evals.work` job. Normal-risk versions get an impact run (level 4, `answer_impact`); high-risk
 * versions a full run of their area (also level 5, `answer_full`) (FR-513). Scheduled runs score
 * a live area every week and move its baseline (FR-517, FR-518).
 */

export type EvalDeps = { port: ModelPort; clock: Clock }
/** `held_out`: the sealed held-out questions of an area, run with nothing of them kept. */
export type RunKind = 'impact' | 'full' | 'scheduled' | 'links' | 'held_out'
export type RunState =
  | 'estimated'
  | 'awaiting_approval'
  | 'queued'
  | 'running'
  | 'finished'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
export type AnswerLevel = 'answer_impact' | 'answer_full'
/** Why a full run was queued without a person: a change that bypasses the review gate. */
export type RunTrigger = 'source_sync' | 'tool_descriptions' | 'date_expiry'

export type RunSummary = {
  edition: string
  plan: { questions: PlannedQuestion[]; setAside: string[] }
  estimate: { cells: number; cached: number; micros: number }
  /** The tools each side offered; runs planned before this was recorded use the live switch. */
  tools?: ArmTools
  replay?: ReplayReport
  /** A run a person started themself counts against their daily limit. */
  manual?: boolean
  trigger?: RunTrigger
  /** How tries decide a wording; absent means `majority` (FR-515). */
  passRule?: PassRule
  /** Why the run last stopped before it finished, and what was missing then. */
  stopped?: RunStop
  /** How often the run was resumed after it stopped. */
  resumes?: number
  /** A held-out run (withheld.ts): the area and how many questions, never which. */
  heldOut?: { area: string; questions: number }
  result?: RunResult
}
/**
 * Why a run ended incomplete: answers the provider or the tool server kept from being made
 * (`infrastructure`), a spending cap (`cap`), the run's own cost ceiling (`ceiling`), or the
 * command that worked it was stopped (`stopped`). None of it is a quality result. (`judge` counts
 * answers of runs made before a judge error was kept on the answer it could not grade.)
 */
export type RunStop = {
  reason: 'infrastructure' | 'cap' | 'ceiling' | 'stopped'
  /** Answers not made yet, by why they failed (`missing`: not tried before the stop). */
  failed: Partial<Record<'throttled' | 'provider' | 'judge' | 'tool' | 'error' | 'missing', number>>
  cells: number
  at: string
}
export type QuestionResult = {
  id: string
  impact: boolean
  /** Attached to the proposal (FR-524); absent when not. */
  attached?: true
  baseline: Verdict | null
  candidate: Verdict | null
  flip: 'pass_to_fail' | 'fail_to_pass' | null
  /** Each side split into the code-checked and judge-checked layers; absent on older runs. */
  layers?: { baseline: QuestionLayers; candidate: QuestionLayers | null }
}
/** An attached test's answers without and with the change, as the level details report them. */
export type AttachedResult = Pick<QuestionResult, 'id' | 'baseline' | 'candidate'>
export type LevelOutcome = {
  outcome: 'passed' | 'failed' | 'error'
  message: string
  /** FR-524: reported only, never part of the outcome. */
  attached?: AttachedResult[]
}
export type RunResult = {
  questions: QuestionResult[]
  levels?: Partial<Record<AnswerLevel, LevelOutcome>>
  scorecard?: Scorecard
  links?: LinkResult
  /** Judge against code, per side; absent on older runs. */
  agreement?: { baseline: Agreement; candidate: Agreement | null }
}
/**
 * A links run (FR-523): the same questions on the same edition with get_related off (baseline)
 * and on (candidate). It shows a gain when some answers pass only with it, none fail because of
 * it, and following links brings no new cause claims (mentions research, section 4.10). Calls and
 * cost per answer show over-following (R20). The tool stays off until an administrator decides.
 */
export type LinkResult = {
  gained: string[]
  lost: string[]
  arms: Record<ArmName, { answers: number; calls: number; costMicros: number; causeClaims: number }>
  gain: boolean
}
export type Scorecard = {
  edition: string
  questions: number
  passed: number
  failed: number
  noAnswer: number
  setAside: number
  failing: string[]
  regressions: string[]
  baselineRun: string | null
  heldOut: HeldOut
  /**
   * Questions passing and failing in each layer, and how many questions each check failed, so a
   * drop can be traced to retrieval and citing (code) or to caveats, causes and rubrics (judge).
   * Absent on older runs.
   */
  layers?: Record<'code' | 'judge', { passed: number; failed: number }>
  failedChecks?: Record<string, number>
  /** Where the judge and the code checks disagreed; absent on older runs. */
  agreement?: Agreement
}
/**
 * The quality targets of requirements section 1.7, on the held-out part: at least 90 percent of
 * required caveats appear (strict), at most 5 percent of answers claim an unproven cause, at least
 * 80 percent of answers are acceptable. Counts come with the rates.
 */
export type HeldOut = {
  questions: number
  answers: number
  caveats: { required: number; present: number }
  causeClaims: number
  acceptable: number
  meetsTargets: boolean
}

export type RunRow = {
  id: string
  kind: RunKind
  state: RunState
  area_id: string | null
  proposal_id: string | null
  item_version_id: string | null
  baseline_edition_seq: string | null
  model_id: string
  judge_model_id: string | null
  answer_family: string | null
  judge_family: string | null
  answer_provider: string | null
  judge_provider: string | null
  answer_vendor: string | null
  judge_vendor: string | null
  tries: number
  flip_repeats: number
  estimated_cost_micros: string
  actual_cost_micros: string
  requested_by: string | null
  approved_by: string | null
  /** The most the run may spend, as approved; null when only the spending caps apply. */
  cost_ceiling_micros: string | null
  /** The worker holding the run's lease, while one works it. */
  worker: string | null
  summary: RunSummary
  failure: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
}
export const runColumns = `id::text,kind::text,state::text,area_id,proposal_id::text,item_version_id::text,
  baseline_edition_seq::text,model_id,judge_model_id,answer_provider,judge_provider,answer_family,judge_family,answer_vendor,judge_vendor,tries,flip_repeats,estimated_cost_micros::text,
  actual_cost_micros::text,requested_by::text,approved_by::text,cost_ceiling_micros::text,worker,summary,failure,created_at::text,
  started_at::text,finished_at::text`

/**
 * The answering model and its judge. By default the judge comes from another family than the
 * answering model line, so it does not grade its own line's answers; it stays with the answering
 * model's provider and vendor. A named judge (which may be another vendor) is used as set, and a
 * run records both providers, families and vendors either way.
 */
export function modelsFor(port: ModelPort, settings: EvalSettings): Models {
  const answer = port.choose('eval_answer', settings.models.eval_answer)
  return { answer, judge: judgeFor(port, answer, settings.models.judge) }
}

export function judgeFor(port: ModelPort, answer: ModelChoice, setting: JudgeSetting): ModelChoice {
  return setting === differentFamily
    ? port.otherLine('judge', answer)
    : port.choose('judge', setting)
}

export type Head = { seq: string; label: string; overlay: string }
export async function liveHead(tx: Queryable): Promise<Head | null> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
       from editions e join live_edition l on l.seq=e.seq`,
  )
  return head ?? null
}
export async function headAt(tx: Queryable, seq: string): Promise<Head> {
  const [head] = await tx.query<Head>(
    `select e.seq::text,e.label,coalesce((select seq::text from serving_overlay),'0') as overlay
       from editions e where e.seq=$1`,
    [seq],
  )
  if (!head) throw new Error('The run edition does not exist')
  return head
}

/** A version whose answer tests are planned: a submitted one, or a draft. */
type Candidate = Pick<StoredVersion, 'itemId' | 'versionNo' | 'version'>

/** The two sides of a paired run: the live edition, and the live edition with the version. */
export async function sidesFor(
  tx: Queryable,
  head: Head,
  version: Candidate | null,
): Promise<Partial<Record<ArmName, ServingBundle>>> {
  const live = await loadServingBundle(tx, head)
  if (!version) return { baseline: live }
  const area = version.version.areaId
  const candidate = candidateBundle(live, {
    id: version.itemId,
    versionNo: version.versionNo,
    proposerId: version.version.proposerId,
    version: version.version,
  })
  return { baseline: asDelivered(live, area), candidate: asDelivered(candidate, area) }
}

/** A links run compares the live edition with itself; only the tools differ. */
export function sidesOfRun(
  kind: RunKind,
  sides: Partial<Record<ArmName, ServingBundle>>,
): Partial<Record<ArmName, ServingBundle>> {
  return kind === 'links' ? { baseline: sides.baseline!, candidate: sides.baseline! } : sides
}

/**
 * The tools switched on now; a links run takes get_related off and on. The `eval` client's own
 * policy still applies on top, in the gateway.
 */
export async function armTools(tx: Queryable, kind: RunKind): Promise<ArmTools> {
  const on = await enabledTools(tx)
  if (kind !== 'links') return { baseline: on, candidate: on }
  const off = on.filter((tool) => tool !== 'get_related')
  return { baseline: off, candidate: [...off, 'get_related'].sort() }
}

const levelsOf = (kind: RunKind): AnswerLevel[] =>
  kind === 'full' ? ['answer_impact', 'answer_full'] : kind === 'impact' ? ['answer_impact'] : []

export async function insertRun(
  tx: Queryable,
  values: {
    kind: RunKind
    state: RunState
    area: string | null
    proposal: string | null
    version: StoredVersion | null
    head: Head
    models: Models
    settings: EvalSettings
    planned: PlannedQuestion[]
    summary: RunSummary
    requestedBy: string | null
    costCeilingMicros?: number | null
  },
): Promise<RunRow> {
  const [row] = await tx.query<RunRow>(
    `insert into eval_runs(kind,state,area_id,proposal_id,item_version_id,baseline_edition_seq,candidate_digest,
       tool_schema_digest,model_id,judge_model_id,client_label,test_set_digest,tries,flip_repeats,
       estimated_cost_micros,requested_by,system_prompt_digest,summary,answer_family,judge_family,answer_vendor,judge_vendor,
       answer_provider,judge_provider,cost_ceiling_micros)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) returning ${runColumns}`,
    [
      values.kind,
      values.state,
      values.area,
      values.proposal,
      values.version?.id ?? null,
      values.head.seq,
      values.version
        ? createHash('sha256').update(`${values.head.label}:${values.version.digest}`).digest()
        : null,
      toolSchemaDigest,
      values.models.answer.id,
      values.models.judge.id,
      evalClient,
      Buffer.from(testSetDigest(values.planned), 'hex'),
      values.settings.tries,
      values.settings.flipRepeats,
      values.summary.estimate.micros,
      values.requestedBy,
      answerPromptDigest,
      JSON.stringify(values.summary),
      values.models.answer.family,
      values.models.judge.family,
      values.models.answer.vendor,
      values.models.judge.vendor,
      values.models.answer.provider,
      values.models.judge.provider,
      values.costCeilingMicros ?? null,
    ],
  )
  return row!
}

const OPEN_STATES: RunState[] = ['estimated', 'awaiting_approval', 'queued', 'running']

export type Queued = { id: string; state: RunState }

/**
 * Queues the answer tests of a normal or high-risk version against the live edition, under the
 * caller's row security (the proposer at submit, a reviewer on request). A run already made for
 * this version and live edition is reused unless `again` asks for a new one and the earlier run is no longer open.
 */
export async function queueVersionRun(
  tx: Queryable,
  deps: EvalDeps,
  versionId: string,
  again = false,
): Promise<Queued | null> {
  const version = await readVersion(tx, versionId)
  if (!version || version.version.riskLevel === 'low') return null
  const head = await liveHead(tx)
  if (!head) return null
  const [existing] = await tx.query<Queued>(
    `select id::text,state::text from eval_runs where item_version_id=$1 and baseline_edition_seq=$2
      order by created_at desc limit 1`,
    [versionId, head.seq],
  )
  if (existing && (!again || OPEN_STATES.includes(existing.state))) return existing
  const [proposal] = await tx.query<{ id: string }>(
    'select id::text from proposals where item_version_id=$1 order by created_at desc limit 1',
    [versionId],
  )
  const { settings, models, kind, planned, cost, setAside, tools } = await planVersion(
    tx,
    deps,
    head,
    version,
    proposal?.id ?? null,
  )
  const area = version.version.areaId
  const [asideInArea] = await tx.query<{ ids: string[] }>(
    `select coalesce(array_agg(id order by id),'{}') as ids from golden_questions
      where area_id=$1 and status='active' and set_aside_reason is not null`,
    [area],
  )
  const summary: RunSummary = {
    edition: head.label,
    plan: { questions: planned, setAside: asideInArea?.ids ?? setAside },
    estimate: cost,
    tools,
  }
  const run = await insertRun(tx, {
    kind,
    state: cost.micros > settings.runBudgetMicros ? 'awaiting_approval' : 'queued',
    area,
    proposal: proposal?.id ?? null,
    version,
    head,
    models,
    settings,
    planned,
    summary,
    requestedBy: await person(tx),
  })
  if (!planned.length) await finishRun(tx, run, [])
  return { id: run.id, state: planned.length ? run.state : 'finished' }
}

/** An area run's kind: the whole set on its own, or a links run with get_related off and on. */
export type AreaRunKind = 'full' | 'scheduled' | 'links'

/**
 * Plans a version's answer tests against the live edition, saving nothing: the impact set for a
 * normal-risk version, and also the rest of its area for a high-risk one (FR-511, FR-513). The
 * tests attached to its proposal are always planned, to be reported (FR-524).
 */
async function planVersion(
  tx: Queryable,
  deps: EvalDeps,
  head: Head,
  version: Candidate,
  proposal: string | null,
) {
  const settings = await readEvalSettings(tx)
  const models = modelsFor(deps.port, settings)
  const kind: RunKind = version.version.riskLevel === 'high' ? 'full' : 'impact'
  const area = version.version.areaId
  const { questions, setAside } = await loadActiveQuestions(tx, null)
  const sides = await sidesFor(tx, head, version)
  const changed = [version.itemId, ...version.version.replaces]
  const tools = await armTools(tx, 'impact')
  const all = await planQuestions(questions, sides, deps.clock, models, changed, tools)
  const inArea = new Set(questions.filter((q) => q.body.area === area).map((q) => q.id))
  const attached = await attachedQuestions(tx, proposal)
  const planned = all
    .map((q): PlannedQuestion => (attached.has(q.id) ? { ...q, attached: true } : q))
    .filter((q) => q.impact || q.attached || (kind === 'full' && inArea.has(q.id)))
  const cost = await estimate(tx, planned, settings.tries, models)
  return { settings, models, kind, planned, cost, setAside, tools }
}

/**
 * What the answer tests of a draft would cost if it were submitted now (FR-704), saving nothing,
 * with the tests attached to its proposal. Low-risk versions have none. Counts only: which
 * questions are planned is not shown (FR-503).
 */
export async function estimateDraftRun(
  tx: Queryable,
  deps: EvalDeps,
  version: Candidate,
  proposal: string | null,
) {
  const head = await liveHead(tx)
  if (!head || version.version.riskLevel === 'low') return null
  const { settings, models, kind, planned, cost } = await planVersion(
    tx,
    deps,
    head,
    version,
    proposal,
  )
  return {
    kind,
    edition: head.label,
    questions: planned.length,
    cells: cost.cells,
    cached: cost.cached,
    costMicros: cost.micros,
    needsApproval: cost.micros > settings.runBudgetMicros,
    modelId: models.answer.id,
  }
}

/** Plans an area's whole active set on the live edition, without saving anything (FR-516). */
export async function planArea(
  tx: Queryable,
  deps: EvalDeps,
  area: string,
  kind: AreaRunKind = 'full',
) {
  const head = await liveHead(tx)
  if (!head) return null
  const settings = await readEvalSettings(tx)
  const models = modelsFor(deps.port, settings)
  const { questions, setAside } = await loadActiveQuestions(tx, [area])
  const tools = await armTools(tx, kind)
  const planned = await planQuestions(
    questions,
    sidesOfRun(kind, await sidesFor(tx, head, null)),
    deps.clock,
    models,
    [],
    tools,
  )
  const cost = await estimate(tx, planned, settings.tries, models)
  return { head, settings, models, planned, setAside, cost, tools }
}

/**
 * A run of an area's whole active set on the live edition: scheduled weekly, started by hand,
 * queued by a change that bypasses the review gate, or a links run (FR-523).
 */
export async function queueAreaRun(
  tx: Queryable,
  deps: EvalDeps,
  area: string,
  kind: AreaRunKind,
  manual: boolean,
  trigger?: RunTrigger,
  options: { passRule?: PassRule; costCeilingMicros?: number | null } = {},
): Promise<RunRow | null> {
  const planned = await planArea(tx, deps, area, kind)
  if (!planned) return null
  const { head, settings, models, cost } = planned
  const run = await insertRun(tx, {
    kind,
    state: cost.micros > settings.runBudgetMicros ? 'awaiting_approval' : 'queued',
    area,
    proposal: null,
    version: null,
    head,
    models,
    settings,
    planned: planned.planned,
    summary: {
      edition: head.label,
      plan: { questions: planned.planned, setAside: planned.setAside },
      estimate: cost,
      tools: planned.tools,
      manual,
      ...(trigger ? { trigger } : {}),
      ...(options.passRule && options.passRule !== 'majority'
        ? { passRule: options.passRule }
        : {}),
    },
    requestedBy: manual ? await person(tx) : null,
    costCeilingMicros: options.costCeilingMicros ?? null,
  })
  if (!planned.planned.length) return finishRun(tx, run, [])
  return run
}

async function person(tx: Queryable): Promise<string | null> {
  const [row] = await tx.query<{ id: string | null }>('select cl_person()::text as id')
  return row?.id ?? null
}

/**
 * The gate's view of a finished paired run (FR-513, FR-514, FR-515). A test attached to the
 * proposal only for the report (FR-524) is named with its result and leaves the outcome alone.
 */
export function levelResults(
  kind: RunKind,
  questions: QuestionResult[],
  heldOut: ReadonlySet<string> = new Set(),
): NonNullable<RunResult['levels']> {
  // The gate is read by the proposer: held-out questions are counted, never named (FR-503).
  const listed = (ids: string[]) => {
    const named = ids.filter((id) => !heldOut.has(id))
    const hidden = ids.length - named.length
    return [
      ...(named.length > 5 ? [...named.slice(0, 5), `${named.length - 5} more`] : named),
      ...(hidden ? [`${hidden} held-out question${hidden === 1 ? '' : 's'}`] : []),
    ].join(', ')
  }
  const levels: NonNullable<RunResult['levels']> = {}
  if (kind === 'scheduled') return levels
  // An attached test is never held out (FR-503); the check keeps that true here too.
  const attached = questions.filter((q) => q.attached && !heldOut.has(q.id))
  const report = attached.length
    ? ` Attached tests, reported only: ${attached
        .map((q) => {
          const change = testChange(
            q.baseline === null ? null : q.baseline === 'pass',
            q.candidate === null ? null : q.candidate === 'pass',
          )
          return `${q.id} ${change ? testChangeWords[change] : 'has no answer to compare'}`
        })
        .join('; ')}.`
    : ''
  const reported = (level: Omit<LevelOutcome, 'attached'>): LevelOutcome =>
    attached.length
      ? {
          ...level,
          message: level.message + report,
          attached: attached.map(({ id, baseline, candidate }) => ({ id, baseline, candidate })),
        }
      : level
  const impact = questions.filter((q) => q.impact)
  const regressions = impact.filter((q) => q.flip === 'pass_to_fail').map((q) => q.id)
  const silent = impact
    .filter((q) => q.baseline === 'no_answer' || q.candidate === 'no_answer')
    .map((q) => q.id)
  levels.answer_impact = reported(
    regressions.length
      ? {
          outcome: 'failed',
          message: `These answers got worse with this change: ${listed(regressions)}. Read the transcripts of the failed tries.`,
        }
      : silent.length
        ? {
            outcome: 'error',
            message: `The answering AI gave no answer, or the judge no usable verdict, for ${listed(silent)}. Run the checks again, or set the questions aside with a reason.`,
          }
        : {
            outcome: 'passed',
            message: impact.length
              ? noneWorseWords(impact.length, {
                  alreadyFailing: impact.filter(
                    (q) => q.baseline === 'fail' && q.candidate === 'fail',
                  ).length,
                  nowPassing: impact.filter((q) => q.flip === 'fail_to_pass').length,
                })
              : 'None of the test questions could change.',
          },
  )
  if (kind === 'full') {
    const failing = questions.filter((q) => q.candidate === 'fail').map((q) => q.id)
    const unanswered = questions.filter((q) => q.candidate === 'no_answer').map((q) => q.id)
    levels.answer_full = reported(
      !questions.length
        ? {
            outcome: 'failed',
            message:
              "The domain has no active test questions, so this check can't pass. Add test questions first.",
          }
        : failing.length
          ? {
              outcome: 'failed',
              message: `${failing.length} of ${questions.length} test questions of the domain fail with this change: ${listed(failing)}.`,
            }
          : unanswered.length
            ? {
                outcome: 'error',
                message: `The answering AI gave no answer, or the judge no usable verdict, for ${listed(unanswered)}. Run the checks again, or set the questions aside with a reason.`,
              }
            : {
                outcome: 'passed',
                message: `All ${questions.length} test questions of the domain pass.`,
              },
    )
  }
  return levels
}

/** Records the levels on the version (paired runs) or the scorecard and baseline (area runs). */
export async function finishRun(
  tx: Queryable,
  run: RunRow,
  questions: QuestionResult[],
  agreement?: NonNullable<RunResult['agreement']>,
): Promise<RunRow> {
  const result: RunResult = { questions, ...(agreement ? { agreement } : {}) }
  if (run.item_version_id) {
    const bodies = await loadRevisions(tx, run.summary.plan.questions)
    const heldOut = new Set(
      [...bodies].filter(([, body]) => body.split === 'held_out').map(([id]) => id),
    )
    result.levels = levelResults(run.kind, questions, heldOut)
    await recordLevels(tx, run, result.levels, questions.length)
  } else if (run.kind === 'links') {
    result.links = await linkResult(tx, run, questions)
  } else {
    result.scorecard = await scorecard(tx, run, questions)
    if (agreement) result.scorecard.agreement = agreement.baseline
    if (run.kind === 'scheduled') {
      // FR-518: only a finished full scheduled run on the live edition moves the baseline.
      await tx.query('insert into eval_baselines(area_id,run_id,edition_seq) values($1,$2,$3)', [
        run.area_id,
        run.id,
        run.baseline_edition_seq,
      ])
      await tx.query(
        `insert into outbox_events(topic,area_id,aggregate_type,aggregate_id,payload)
         values('eval.scorecard',$1,'eval_run',$2,$3)`,
        [run.area_id, run.id, JSON.stringify(result.scorecard)],
      )
    }
  }
  const [row] = await tx.query<RunRow>(
    `update eval_runs set state='finished',finished_at=now(),started_at=coalesce(started_at,now()),
       worker=null,lease_until=null,summary=(summary-'stopped')||jsonb_build_object('result',$2::jsonb)
     where id=$1 returning ${runColumns}`,
    [run.id, JSON.stringify(result)],
  )
  // FR-610: a finished weekly or full run of an area verifies the resolved gaps whose tests it passed.
  await verifyGapsByRun(tx, row!)
  return row!
}

async function linkResult(
  tx: Queryable,
  run: RunRow,
  questions: QuestionResult[],
): Promise<LinkResult> {
  // A cell reused from the cache cost nothing now; its original answer's cost is what it costs.
  const cells = await tx.query<{
    arm: ArmName
    calls: number | null
    cost: string
    cause: boolean
  }>(
    `select c.arm::text as arm,(c.scores->>'calls')::int as calls,
            coalesce(o.cost_micros,c.cost_micros,0)::text as cost,
            coalesce(c.scores->'checks'->>'no_cause_claim','true')='false' as cause
       from eval_cells c left join eval_cells o on o.id=c.reused_from
      where c.run_id=$1 and c.state='finished' and c.passed is not null`,
    [run.id],
  )
  const arm = (name: ArmName) => {
    const own = cells.filter((c) => c.arm === name)
    const mean = (values: number[]) =>
      values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
    return {
      answers: own.length,
      calls: Math.round(mean(own.map((c) => c.calls ?? 0)) * 100) / 100,
      costMicros: Math.round(mean(own.map((c) => Number(c.cost)))),
      causeClaims: own.filter((c) => c.cause).length,
    }
  }
  const arms = { baseline: arm('baseline'), candidate: arm('candidate') }
  const gained = questions.filter((q) => q.flip === 'fail_to_pass').map((q) => q.id)
  const lost = questions.filter((q) => q.flip === 'pass_to_fail').map((q) => q.id)
  return {
    gained,
    lost,
    arms,
    gain:
      gained.length > 0 &&
      lost.length === 0 &&
      arms.candidate.causeClaims <= arms.baseline.causeClaims,
  }
}

async function scorecard(
  tx: Queryable,
  run: RunRow,
  questions: QuestionResult[],
): Promise<Scorecard> {
  const [baseline] = await tx.query<{ run: string; summary: RunSummary }>(
    `select r.id::text as run,r.summary from eval_baselines b join eval_runs r on r.id=b.run_id
      where b.area_id=$1 order by b.set_at desc limit 1`,
    [run.area_id],
  )
  const before = new Map(
    (baseline?.summary.result?.questions ?? []).map((q) => [q.id, q.baseline] as const),
  )
  const failing = questions.filter((q) => q.baseline === 'fail').map((q) => q.id)
  const bodies = await loadRevisions(tx, run.summary.plan.questions)
  const heldOutIds = new Set(
    [...bodies].filter(([, body]) => body.split === 'held_out').map(([id]) => id),
  )
  const cells = await tx.query<{ question: string; scores: CellScore }>(
    `select question_id as question,scores from eval_cells
      where run_id=$1 and state='finished' and passed is not null and question_id=any($2)`,
    [run.id, [...heldOutIds]],
  )
  const required = cells.filter((c) => c.scores.caveat !== null)
  const caveats = {
    required: required.length,
    present: required.filter((c) => c.scores.caveat).length,
  }
  const causeClaims = cells.filter((c) => c.scores.checks.no_cause_claim === false).length
  const acceptable = questions.filter((q) => heldOutIds.has(q.id) && q.baseline === 'pass').length
  const heldOut: HeldOut = {
    questions: heldOutIds.size,
    answers: cells.length,
    caveats,
    causeClaims,
    acceptable,
    meetsTargets:
      heldOutIds.size > 0 &&
      cells.length > 0 &&
      caveats.present >= 0.9 * caveats.required &&
      causeClaims <= 0.05 * cells.length &&
      acceptable >= 0.8 * heldOutIds.size,
  }
  const layers = { code: { passed: 0, failed: 0 }, judge: { passed: 0, failed: 0 } }
  const failedChecks: Record<string, number> = {}
  for (const q of questions) {
    if (!q.layers) continue
    for (const layer of ['code', 'judge'] as const) {
      const verdict = q.layers.baseline[layer]
      if (verdict === 'pass') layers[layer].passed++
      if (verdict === 'fail') layers[layer].failed++
    }
    for (const check of q.layers.baseline.failedChecks)
      failedChecks[check] = (failedChecks[check] ?? 0) + 1
  }
  return {
    edition: run.summary.edition,
    questions: questions.length,
    passed: questions.filter((q) => q.baseline === 'pass').length,
    failed: failing.length,
    noAnswer: questions.filter((q) => q.baseline === 'no_answer').length,
    setAside: run.summary.plan.setAside.length,
    failing,
    regressions: failing.filter((id) => before.get(id) === 'pass'),
    baselineRun: baseline?.run ?? null,
    heldOut,
    layers,
    failedChecks,
  }
}

async function recordLevels(
  tx: Queryable,
  run: RunRow,
  levels: NonNullable<RunResult['levels']>,
  questions: number,
) {
  const [version] = await tx.query<{ digest: string }>(
    "select encode(content_digest,'hex') as digest from item_versions where id=$1",
    [run.item_version_id],
  )
  if (!version) throw new Error('The run cannot read the version it checks')
  for (const [level, result] of Object.entries(levels)) {
    const details = {
      edition: run.summary.edition,
      run: run.id,
      message: result.message,
      questions,
      setAside: run.summary.plan.setAside.length,
      estimate: formatUsd(Number(run.estimated_cost_micros)),
      ...(result.attached ? { attached: result.attached } : {}),
    }
    await tx.query(
      `insert into check_results(item_version_id,level,outcome,eval_run_id,inputs_digest,details)
       values($1,$2,$3,$4,decode($5,'hex'),$6)`,
      [
        run.item_version_id,
        level,
        result.outcome,
        run.id,
        await contentDigest({
          level,
          edition: run.summary.edition,
          version: version.digest,
          run: run.id,
        }),
        JSON.stringify(details),
      ],
    )
  }
  if (run.proposal_id) {
    const [p] = await tx.query<{
      id: string
      areaId: string | null
      state: string
      revision: number
    }>('select id::text,area_id as "areaId",state::text,revision from proposals where id=$1', [
      run.proposal_id,
    ])
    if (p && ['submitted', 'in_review'].includes(p.state))
      await proposalEvent(tx, p as Parameters<typeof proposalEvent>[1], 'checked', {
        levels: Object.fromEntries(Object.entries(levels).map(([l, r]) => [l, r.outcome])),
        run: run.id,
      })
  }
}

/** Stops a run with a reason; a paired run records the reason as an error on its levels. */
export async function failRun(tx: Queryable, run: RunRow, reason: string): Promise<void> {
  await tx.query(
    `update eval_runs set state='failed',failure=$2,finished_at=now(),worker=null,lease_until=null
      where id=$1 and state in ('queued','running','awaiting_approval','estimated','incomplete')`,
    [run.id, reason.slice(0, 500)],
  )
  if (run.item_version_id) {
    const levels = Object.fromEntries(
      levelsOf(run.kind).map((level) => [level, { outcome: 'error' as const, message: reason }]),
    )
    await recordLevels(tx, run, levels, run.summary.plan.questions.length)
  }
}

/** What a stopped run says, in words: why, and what is missing. */
export function stopWords(stop: RunStop): string {
  const missing = Object.values(stop.failed).reduce((sum, n) => sum + (n ?? 0), 0)
  const kinds: [keyof RunStop['failed'], string][] = [
    ['throttled', 'refused for the provider’s rate limit'],
    ['provider', 'failed at the provider'],
    ['judge', 'without a readable verdict from the judge'],
    ['tool', 'with a tool call the tool server refused'],
    ['error', 'failed for another reason'],
    ['missing', 'not tried yet'],
  ]
  const parts = kinds
    .filter(([kind]) => stop.failed[kind])
    .map(([kind, words]) => `${stop.failed[kind]} ${words}`)
  const why =
    stop.reason === 'cap'
      ? 'A spending cap stopped it. '
      : stop.reason === 'ceiling'
        ? 'It reached its cost ceiling. '
        : stop.reason === 'stopped'
          ? 'It was stopped before it finished. '
          : ''
  return (
    `${why}${missing} of ${stop.cells} answer${stop.cells === 1 ? '' : 's'} not made` +
    `${parts.length ? ` (${parts.join(', ')})` : ''}. ` +
    'They count as neither a pass nor a fail; resuming the run makes only those.'
  ).slice(0, 500)
}

/**
 * Stops a run before it finished (R6): its finished answers stay, nothing is scored, and resuming
 * it makes only the missing ones. A paired run records nothing on the version: the gate says the
 * answer tests did not finish.
 */
export async function stopRun(
  tx: Queryable,
  run: Pick<RunRow, 'id'>,
  reason: RunStop['reason'],
  detail?: string,
): Promise<RunStop> {
  const counts = await tx.query<{ kind: string; n: number }>(
    `select coalesce(failure_kind,case when state='failed' then 'error' else 'missing' end) as kind,count(*)::int as n
       from eval_cells where run_id=$1 and state<>'finished' group by 1`,
    [run.id],
  )
  const [planned] = await tx.query<{ cells: number; finished: number }>(
    `select (select count(*)::int from eval_cells where run_id=$1) as cells,
            (select count(*)::int from eval_cells where run_id=$1 and state='finished') as finished`,
    [run.id],
  )
  const stop: RunStop = {
    reason,
    failed: Object.fromEntries(counts.map((c) => [c.kind, c.n])),
    cells: planned?.cells ?? 0,
    at: new Date().toISOString(),
  }
  await tx.query(
    `update eval_runs set state='incomplete',finished_at=now(),worker=null,lease_until=null,failure=$2,
       summary=summary||jsonb_build_object('stopped',$3::jsonb)
     where id=$1 and state in ('queued','running')`,
    [run.id, `${detail ? `${detail} ` : ''}${stopWords(stop)}`.slice(0, 500), JSON.stringify(stop)],
  )
  return stop
}

/**
 * Queues an incomplete run again: the worker skips every finished answer and makes only the
 * missing ones. `costCeilingMicros` replaces the run's ceiling when given (the whole run's,
 * what it spent so far included). Returns false when the run is not incomplete.
 */
export async function resumeRun(
  tx: Queryable,
  id: string,
  options: { costCeilingMicros?: number | null } = {},
): Promise<boolean> {
  const rows = await tx.query(
    `update eval_runs set state='queued',finished_at=null,failure=null,worker=null,lease_until=null,
       cost_ceiling_micros=case when $2::boolean then $3::bigint else cost_ceiling_micros end,
       summary=summary||jsonb_build_object('resumes',coalesce((summary->>'resumes')::int,0)+1)
     where id=$1 and state='incomplete' returning id`,
    [id, options.costCeilingMicros !== undefined, options.costCeilingMicros ?? null],
  )
  return rows.length > 0
}
