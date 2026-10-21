/**
 * The Quality page's read model (Quality design, direction C): one health row per domain, the
 * one-line verdict above the grid ("are we better than last time?"), the Fix next list in words,
 * and the parts of a run and a transcript. Pure functions of what the API answered: every number
 * shown here is one the service gave, and what it has not measured stays empty, never invented.
 */
import type { Area } from '@domain/item'
import { signTest } from '@domain/quality'
import type {
  Comparison,
  EvalRun,
  EvalRunDetail,
  FixNext,
  Gap,
  HistoryPoint,
  RetrievalPoint,
  TestQuestion,
  Untested,
  Upkeep,
} from '@/api'
import { formatDay } from './library'

// ---- shares, changes and words ----

/** A share as a percentage with one decimal ("94.6%"), or null when there is nothing to show. */
export function formatRate(rate: number | null | undefined): string | null {
  if (rate === null || rate === undefined) return null
  const percent = Math.round(rate * 1000) / 10
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`
}

export type Change = {
  /** Percentage points, rounded to one decimal. */
  points: number
  direction: 'up' | 'down' | 'flat'
  /** "+1.4 pts", "-3.6 pts", "No change". */
  text: string
  /** The same in words for a screen reader: "up 1.4 points". */
  spoken: string
}

/** The change between two shares in percentage points, or null when either is missing. */
export function changeOf(now: number | null | undefined, before: number | null | undefined) {
  if (now === null || now === undefined || before === null || before === undefined) return null
  const points = Math.round((now - before) * 1000) / 10
  const size = Math.abs(points).toFixed(Number.isInteger(points) ? 0 : 1)
  if (points === 0)
    return { points, direction: 'flat', text: 'No change', spoken: 'no change' } as Change
  return {
    points,
    direction: points > 0 ? 'up' : 'down',
    text: `${points > 0 ? '+' : '-'}${size} pts`,
    spoken: `${points > 0 ? 'up' : 'down'} ${size} points`,
  } as Change
}

const plural = (count: number, word: string, many = `${word}s`) =>
  `${count.toLocaleString('en')} ${count === 1 ? word : many}`

/** Dollars from micro-dollars: "$3.42". */
export const formatUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`

// ---- the domain health grid ----

/** Where a domain stands, the grid's State column: a word, and a badge only when it asks for a look. */
export type DomainState =
  | { kind: 'not_started' }
  | { kind: 'no_run' }
  | { kind: 'failing'; count: number }
  | { kind: 'attention'; reason: string }
  | { kind: 'steady' }

export type DomainHealth = {
  area: Area
  /** Active test questions the reader can see in the domain. */
  questions: number
  state: DomainState
  /** The newest retrieval pass of the domain (no model) and its change against the edition before. */
  retrieval: {
    rate: number | null
    passed: number
    questions: number
    edition: string
    change: Change | null
  } | null
  /** The newest weekly answer run and its change against the run before. */
  answers: {
    rate: number | null
    passed: number
    questions: number
    run: string
    finishedAt: string
    change: Change | null
  } | null
  /** Required caveats kept on the held-out part, and their change. */
  caveats: { rate: number; change: Change | null } | null
  /** Questions that got better and worse since the run before; null until it is compared. */
  flips: { better: number; worse: number; pValue: number | null } | null
  openGaps: number | null
  pastReview: number | null
  untested: number | null
  /** Untested events and examples: FR-502 requires their questions. */
  untestedRequired: number | null
}

/** A drop this large in a share asks for a look, even when every question still passes. */
const ATTENTION_POINTS = 5

/**
 * The newest retrieval pass of one area and its change against the newest pass of an earlier
 * edition (the trend has one point per sealed edition and per day of the live edition).
 */
export function retrievalOf(points: readonly RetrievalPoint[] | undefined) {
  const scored = (points ?? []).filter((point) => point.questions > 0)
  const latest = scored[0]
  if (!latest) return null
  const before = scored.find((point) => point.edition !== latest.edition)
  const rate = (point: RetrievalPoint) => point.passed / point.questions
  return {
    rate: rate(latest),
    passed: latest.passed,
    questions: latest.questions,
    edition: latest.edition,
    change: before ? changeOf(rate(latest), rate(before)) : null,
  }
}

/**
 * Open gaps per area id (a gap with a draft under way still counts until it is closed). A gap whose
 * topic spans domains counts in each of them.
 */
export function openGapsByArea(gaps: readonly Gap[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const gap of gaps)
    if (gap.status === 'open' || gap.status === 'proposal_made')
      for (const area of gap.topic.areaIds) counts.set(area, (counts.get(area) ?? 0) + 1)
  return counts
}

/** The newest week's items past review per area. */
export function pastReviewByArea(upkeep: Upkeep | undefined): Map<string, number> {
  const latest = new Map<string, { week: string; count: number }>()
  for (const row of upkeep?.rows ?? []) {
    const known = latest.get(row.area)
    if (!known || row.week > known.week)
      latest.set(row.area, { week: row.week, count: row.itemsPastReview })
  }
  return new Map([...latest].map(([area, { count }]) => [area, count]))
}

export const isActive = (question: TestQuestion) =>
  question.status === 'active' && question.setAsideReason === null

/** One domain's row of the health grid, from what the service answered for it. */
export function domainHealth({
  area,
  questions,
  history,
  retrieval,
  comparison,
  untested,
  openGaps,
  pastReview,
}: {
  area: Area
  /** The domain's test questions the reader can see. */
  questions: readonly TestQuestion[]
  /** The domain's weekly runs, newest first. */
  history: readonly HistoryPoint[]
  retrieval: readonly RetrievalPoint[] | undefined
  comparison: Comparison | undefined
  untested: Untested | undefined
  openGaps: number | null
  pastReview: number | null
}): DomainHealth {
  const active = questions.filter(isActive).length
  const [latest, before] = history
  const answers = latest
    ? {
        rate: latest.rates.pass,
        passed: latest.passed,
        questions: latest.questions,
        run: latest.run,
        finishedAt: latest.finishedAt,
        change: before ? changeOf(latest.rates.pass, before.rates.pass) : null,
      }
    : null
  const caveats =
    latest?.rates.caveats !== null && latest?.rates.caveats !== undefined
      ? {
          rate: latest.rates.caveats,
          change: before ? changeOf(latest.rates.caveats, before.rates.caveats) : null,
        }
      : null
  const shown = retrievalOf(retrieval)
  const coverage = untested?.areas.find((row) => row.area === area.id)
  const flips = comparison
    ? {
        better: comparison.signTest.better,
        worse: comparison.signTest.worse,
        pValue: comparison.signTest.pValue,
      }
    : null

  let state: DomainState
  if (active === 0 && !latest) state = { kind: 'not_started' }
  else if (!latest) state = { kind: 'no_run' }
  else if (latest.failed + latest.noAnswer > 0)
    state = { kind: 'failing', count: latest.failed + latest.noAnswer }
  else if ((answers?.change?.points ?? 0) <= -ATTENTION_POINTS)
    state = { kind: 'attention', reason: 'Answers got worse since the last run' }
  else if ((shown?.change?.points ?? 0) <= -ATTENTION_POINTS)
    state = { kind: 'attention', reason: 'Fewer test questions find the right facts than before' }
  else if (latest.heldOut.questions > 0 && !latest.heldOut.meetsTargets)
    state = { kind: 'attention', reason: 'Hidden test questions are below their targets' }
  else state = { kind: 'steady' }

  return {
    area,
    questions: active,
    state,
    retrieval: shown,
    answers,
    caveats,
    flips,
    openGaps,
    pastReview,
    untested: coverage ? coverage.untested : null,
    untestedRequired: coverage ? coverage.untestedRequired : null,
  }
}

/** The domains a person sees on Quality: every one for an administrator, else their own. */
export function qualityAreas(
  areas: readonly Area[],
  { admin, maintained }: { admin: boolean; maintained: readonly string[] },
): Area[] {
  return areas
    .filter((area) => admin || maintained.includes(area.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
}

/** The State column in words. */
export function stateWords(state: DomainState): string {
  switch (state.kind) {
    case 'not_started':
      return 'No test questions yet'
    case 'no_run':
      return 'No weekly run yet'
    case 'failing':
      return `${state.count} failing`
    case 'attention':
      return 'Needs attention'
    case 'steady':
      return 'Steady'
  }
}

// ---- the verdict line ----

export type Verdict = {
  tone: 'better' | 'worse' | 'unclear' | 'same' | 'none'
  /** The one line above the grid. */
  text: string
  /** The line under it: what it was compared with. */
  detail: string | null
}

/**
 * "Are we better than last time?" in one line: the questions that got better and worse in each
 * domain's newest weekly run against the run before, added up, with the exact sign test on them.
 * A change counts as better or worse only when the test says it is unlikely to be noise (p below
 * 0.05); otherwise the line says there is no clear change, which is a normal result.
 */
export function verdictOf(
  rows: readonly DomainHealth[],
  /** The run each domain's newest run is compared with, in words. */
  baseline = 'the run before',
): Verdict {
  const compared = rows.filter((row) => row.flips !== null)
  const withRuns = rows.filter((row) => row.answers !== null)
  if (withRuns.length === 0)
    return {
      tone: 'none',
      text: 'No weekly test run has finished yet, so there is nothing to compare.',
      detail: rows.some((row) => row.questions > 0)
        ? 'The first weekly run sets the starting point. Runs start every Monday morning.'
        : 'Write test questions for a domain first. Each weekly run tests them.',
    }
  if (compared.length === 0)
    return {
      tone: 'none',
      text: 'One weekly run so far. The next one shows whether answers got better.',
      detail: null,
    }
  const better = compared.reduce((sum, row) => sum + row.flips!.better, 0)
  const worse = compared.reduce((sum, row) => sum + row.flips!.worse, 0)
  const domains = plural(compared.length, 'domain')
  const counts = `${plural(better, 'question')} got better and ${worse.toLocaleString('en')} got worse`
  if (better + worse === 0)
    return {
      tone: 'same',
      text: 'No change since the last run. Every question gave the same result.',
      detail: `Compared with ${baseline} in ${domains}.`,
    }
  const p = signTest(better, worse)!
  const clear = p < 0.05
  const odds = `p = ${p < 0.001 ? '< 0.001' : p.toFixed(2)}`
  if (clear && better > worse)
    return {
      tone: 'better',
      text: `Better than last time: ${counts}.`,
      detail: `Unlikely to be noise (sign test, ${odds}), across ${domains}.`,
    }
  if (clear && worse > better)
    return {
      tone: 'worse',
      text: `Worse than last time: ${counts}.`,
      detail: `Unlikely to be noise (sign test, ${odds}), across ${domains}.`,
    }
  return {
    tone: 'unclear',
    text: `No clear change since last time: ${counts}.`,
    detail: `A difference this small can be noise (sign test, ${odds}), across ${domains}.`,
  }
}

// ---- Fix next ----

export type FixEntry = FixNext['entries'][number]

/** How each kind of work is named in its badge, and the tone the badge takes. */
export const fixKindWords: Record<
  FixEntry['kind'],
  { label: string; tone: 'danger' | 'warning' | 'info' }
> = {
  regression: { label: 'Got worse', tone: 'danger' },
  failing_question: { label: 'Test fails', tone: 'danger' },
  gap: { label: 'Agents found nothing', tone: 'warning' },
  past_review: { label: 'Check date passed', tone: 'warning' },
  untested: { label: 'No test yet', tone: 'info' },
}

/** The words for the checks a run keeps (src/domain/golden-question.ts, `scoreTry`). */
export const checkNames: Record<string, string> = {
  delivered: 'expected facts given',
  not_delivered: 'wrong facts kept out',
  cited: 'fact cited',
  status: 'right kind of reply',
  caveat: 'fact mentioned',
  no_cause_claim: 'no cause claimed',
  clarifying_question: 'asks a clarifying question',
  reached: 'linked facts reached',
  forbidden_links: 'wrong links left alone',
  served: 'every wording gets it',
}

/** A check's name in words; a rubric check is "right-answer point 2". */
export function checkName(check: string): string {
  const rubric = /^rubric_(\d+)$/.exec(check)
  if (rubric) return `right-answer point ${Number(rubric[1]) + 1}`
  return checkNames[check] ?? check.replaceAll('_', ' ')
}

/** A question's title: its natural wording, or its id when the reader cannot see it. */
export function questionTitle(question: TestQuestion | undefined, id: string): string {
  if (id === 'held-out') return 'A hidden test question'
  return question?.wordings.find((wording) => wording.kind === 'natural')?.text ?? id
}

export type FixAction =
  | { kind: 'question'; id: string; label: string }
  | { kind: 'gap'; id: string; label: string }
  | { kind: 'item'; id: string; label: string }
  | { kind: 'write'; itemId: string; area: string | null; label: string }

/** One line of the Fix next list: its title, why it is there and what to do. */
export function fixEntryView(entry: FixEntry, questions: ReadonlyMap<string, TestQuestion>) {
  const subject = entry.subject
  const title =
    subject.type === 'question'
      ? questionTitle(questions.get(subject.id), subject.id)
      : subject.type === 'gap'
        ? `Gap ${subject.label ?? subject.id}`
        : (subject.label ?? subject.id)
  const checks = entry.checks.length ? `Failed: ${entry.checks.map(checkName).join(', ')}.` : null
  const reasons = [...entry.reasons.map((reason) => `${reason}.`), ...(checks ? [checks] : [])]
  const action: FixAction =
    subject.type === 'question'
      ? { kind: 'question', id: subject.id, label: 'Open question' }
      : subject.type === 'gap'
        ? { kind: 'gap', id: subject.id, label: 'Open gap' }
        : entry.kind === 'untested'
          ? { kind: 'write', itemId: subject.id, area: entry.area, label: 'Write a test' }
          : { kind: 'item', id: subject.id, label: 'Check it' }
  return {
    key: `${entry.kind}:${subject.type}:${subject.id}`,
    badge: fixKindWords[entry.kind],
    title,
    reasons: reasons.join(' '),
    since: entry.since ? formatDay(entry.since) : null,
    action,
  }
}

// ---- test questions ----

/** Where a test question stands, in words. */
export function questionStateWords(question: TestQuestion): string {
  if (question.setAsideReason !== null) return 'Set aside'
  if (question.status === 'saturated') return 'Always passes'
  if (question.status === 'retired') return 'Archived'
  return 'Active'
}

/** Test questions matching the search, the domain and the state. */
export function visibleQuestions(
  questions: readonly TestQuestion[],
  { q, area }: { q?: string | undefined; area?: string | undefined },
): TestQuestion[] {
  const terms = (q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  return questions
    .filter((question) => area === undefined || question.area === area)
    .filter((question) => {
      if (!terms.length) return true
      const text = [question.id, ...question.wordings.map((wording) => wording.text)]
        .join(' ')
        .toLowerCase()
      return terms.every((term) => text.includes(term))
    })
    .sort(
      (a, b) =>
        Number(!isActive(a)) - Number(!isActive(b)) ||
        a.area.localeCompare(b.area) ||
        a.id.localeCompare(b.id),
    )
}

// ---- runs ----

export const runKindWords: Record<EvalRun['kind'], string> = {
  scheduled: 'Weekly run',
  full: 'Full run',
  impact: 'Proposal check',
  links: 'Links run',
  assistant_mock: 'Assistant check',
  assistant_real: 'Assistant check',
  replay: 'Replay',
  held_out: 'Hidden test check',
}

export const runStateWords: Record<EvalRun['state'], string> = {
  estimated: 'Estimated',
  awaiting_approval: 'Waiting for approval',
  queued: 'Queued',
  running: 'Running',
  finished: 'Finished',
  failed: 'Failed',
  cancelled: 'Cancelled',
  incomplete: 'Incomplete',
}

/** Why a run started without a person (G17). */
export const runTriggerWords: Record<NonNullable<EvalRun['trigger']>, string> = {
  source_sync: 'a source was updated',
  tool_descriptions: 'the tools agents use changed',
  date_expiry: 'a fact reached its last day',
}

/** A run's title: its kind and the day it finished (or was asked for). */
export function runTitle(run: EvalRun): string {
  return `${runKindWords[run.kind]}, ${formatDay(run.finishedAt ?? run.createdAt)}`
}

/** Runs that can be compared on Quality: finished weekly and full runs of an area. */
export const comparable = (run: EvalRun) =>
  (run.kind === 'scheduled' || run.kind === 'full') &&
  run.state === 'finished' &&
  run.areaId !== null

/** A run's results in words, from its scorecard or, without one, its results. */
export function runOutcome(detail: EvalRunDetail) {
  const card = detail.scorecard
  const verdicts = detail.results.map((result) => result.candidate ?? result.baseline)
  const passed = card?.passed ?? verdicts.filter((verdict) => verdict === 'pass').length
  const failed = card?.failed ?? verdicts.filter((verdict) => verdict === 'fail').length
  const noAnswer =
    card?.noAnswer ?? verdicts.filter((verdict) => verdict === 'no_answer' || !verdict).length
  const questions = card?.questions ?? detail.results.length
  return { questions, passed, failed, noAnswer, rate: questions ? passed / questions : null }
}

/** The verdict a question got in a run: the candidate's on a run with two arms. */
export const verdictOfResult = (result: EvalRunDetail['results'][number]) =>
  result.candidate ?? result.baseline

export const verdictWords = { pass: 'Passes', fail: 'Fails', no_answer: 'No answer' } as const

// ---- transcripts ----

export type TranscriptTurn =
  | { kind: 'text'; role: 'person' | 'agent'; text: string }
  | { kind: 'call'; tool: string; input: string }
  | { kind: 'result'; tool: string; output: string }

const show = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2)

/**
 * A transcript's messages as turns: the question, each tool call and its result, and the answer.
 * The messages are the model's own form (role and content, the content a text or a list of
 * parts); anything else is shown as it is, so nothing is left out.
 */
export function transcriptTurns(messages: readonly unknown[]): TranscriptTurn[] {
  return messages.flatMap((message): TranscriptTurn[] => {
    if (!message || typeof message !== 'object') return []
    const { role, content } = message as { role?: unknown; content?: unknown }
    const speaker = role === 'user' ? 'person' : 'agent'
    if (typeof content === 'string') return [{ kind: 'text', role: speaker, text: content }]
    if (!Array.isArray(content)) return [{ kind: 'text', role: speaker, text: show(message) }]
    return content.flatMap((part): TranscriptTurn[] => {
      if (!part || typeof part !== 'object') return []
      const entry = part as Record<string, unknown>
      if (entry.type === 'text' && typeof entry.text === 'string')
        return entry.text.trim() ? [{ kind: 'text', role: speaker, text: entry.text }] : []
      if (entry.type === 'tool-call')
        return [
          {
            kind: 'call',
            tool: typeof entry.toolName === 'string' ? entry.toolName : 'tool',
            input: show(entry.input),
          },
        ]
      if (entry.type === 'tool-result') {
        const output = entry.output as { value?: unknown } | undefined
        return [
          {
            kind: 'result',
            tool: typeof entry.toolName === 'string' ? entry.toolName : 'tool',
            output: show(output && 'value' in output ? output.value : output),
          },
        ]
      }
      return []
    })
  })
}

/** The checks of one try, from its scores (`CellScore`): each check and whether it held. */
export function transcriptChecks(
  scores: Record<string, unknown>,
): { check: string; held: boolean }[] {
  const checks = scores.checks
  if (!checks || typeof checks !== 'object') return []
  return Object.entries(checks as Record<string, unknown>)
    .filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
    .map(([check, held]) => ({ check, held }))
}
