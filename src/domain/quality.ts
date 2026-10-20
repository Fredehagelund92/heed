/**
 * The Quality page's arithmetic: two answer runs compared question by question with an exact
 * sign test, one question across two runs (what was held constant, what each try showed), the
 * rates of a scorecard, and the ranked "Fix next" list across failing test questions, gaps, items
 * past their review date and items no test question covers. Pure functions of what they are
 * given: no clock, no input or output.
 */
import type { ItemKind } from './item.ts'
import type { Verdict } from './golden-question.ts'

/** A share, or null when there is nothing to divide by. */
export const rate = (part: number, whole: number): number | null =>
  whole > 0 ? part / whole : null

/**
 * The exact two-sided sign test on the questions that changed between two runs: under "no real
 * change" a question that changed is as likely to get better as worse. Returns the p-value, or
 * null when nothing changed. Computed in log space, so it holds for any test set size.
 */
export function signTest(better: number, worse: number): number | null {
  const n = better + worse
  if (n === 0) return null
  const k = Math.min(better, worse)
  let logChoose = 0
  let tail = 0
  for (let i = 0; i <= k; i++) {
    if (i > 0) logChoose += Math.log(n - i + 1) - Math.log(i)
    tail += Math.exp(logChoose - n * Math.LN2)
  }
  return Math.min(1, 2 * tail)
}

/** One question's verdict in a run, with the checks it failed. */
export type RunQuestion = { id: string; verdict: Verdict | null; failedChecks: readonly string[] }
export type QuestionChange = {
  id: string
  from: Verdict
  to: Verdict
  /** The checks the question failed in the newer run (worse) or the older run (better). */
  failedChecks: string[]
}
export type RunComparison = {
  /** Questions with a verdict in both runs. */
  questions: number
  /** Failed or gave no answer before, pass now. */
  better: QuestionChange[]
  /** Passed before, fail or give no answer now. */
  worse: QuestionChange[]
  /** Neither better nor worse, counted by the newer verdict. */
  unchanged: { pass: number; fail: number; noAnswer: number }
  /** Questions with a verdict only in the newer run, or only in the older one. */
  added: number
  removed: number
  signTest: { better: number; worse: number; pValue: number | null }
}

/**
 * Compares the verdicts of two runs over the questions both answered. A question counts as
 * better or worse only across pass; failing in another way, or going from a failure to no
 * answer, is unchanged. Ids are sorted, so the lists are stable.
 */
export function compareRuns(
  older: readonly RunQuestion[],
  newer: readonly RunQuestion[],
): RunComparison {
  const before = new Map(older.filter((q) => q.verdict !== null).map((q) => [q.id, q]))
  const after = new Map(newer.filter((q) => q.verdict !== null).map((q) => [q.id, q]))
  const better: QuestionChange[] = []
  const worse: QuestionChange[] = []
  const unchanged = { pass: 0, fail: 0, noAnswer: 0 }
  let questions = 0
  for (const id of [...after.keys()].sort()) {
    const was = before.get(id)
    const now = after.get(id)!
    if (!was) continue
    questions++
    const from = was.verdict!
    const to = now.verdict!
    if (from !== 'pass' && to === 'pass')
      better.push({ id, from, to, failedChecks: [...was.failedChecks] })
    else if (from === 'pass' && to !== 'pass')
      worse.push({ id, from, to, failedChecks: [...now.failedChecks] })
    else if (to === 'pass') unchanged.pass++
    else if (to === 'fail') unchanged.fail++
    else unchanged.noAnswer++
  }
  return {
    questions,
    better,
    worse,
    unchanged,
    added: [...after.keys()].filter((id) => !before.has(id)).length,
    removed: [...before.keys()].filter((id) => !after.has(id)).length,
    signTest: {
      better: better.length,
      worse: worse.length,
      pValue: signTest(better.length, worse.length),
    },
  }
}

// One question across two runs: what was held constant, and what one try showed.

/**
 * What decides an answer besides the model's chance: the edition served, the question's revision
 * and wordings, the tries per wording, the answering model and its judge, the tool descriptions
 * and the answering system prompt (the cell cache key's inputs, plan section 7.6).
 */
export const comparisonFactors = [
  'edition',
  'revision',
  'wordings',
  'tries',
  'answer_model',
  'judge_model',
  'tool_descriptions',
  'prompt',
] as const
export type ComparisonFactor = (typeof comparisonFactors)[number]

/** One run's setup for one question; null where the run did not record it. */
export type RunSetup = Record<ComparisonFactor, string | number | null>

/**
 * Sorts each factor into held (the same in both runs), changed, or unknown (either run did not
 * record it). Unknown never counts as held: "only the edition differs" needs every other factor
 * held, which is `changed` equal to `['edition']` and `unknown` empty.
 */
export function heldConstant(
  a: RunSetup,
  b: RunSetup,
): { held: ComparisonFactor[]; changed: ComparisonFactor[]; unknown: ComparisonFactor[] } {
  const held: ComparisonFactor[] = []
  const changed: ComparisonFactor[] = []
  const unknown: ComparisonFactor[] = []
  for (const factor of comparisonFactors) {
    const before = a[factor]
    const after = b[factor]
    if (before === null || after === null) unknown.push(factor)
    else if (before === after) held.push(factor)
    else changed.push(factor)
  }
  return { held, changed, unknown }
}

/** What one try showed, read from its stored scores and transcript. */
export type TryEvidence = {
  checks: Record<string, boolean>
  delivered: string[]
  reached: string[]
  statuses: string[]
  /** The judge's reason; null without a verdict (a refusal, a failed call, an older run). */
  judgeReason: string | null
  /** The answer's final text; null without one. */
  answer: string | null
}

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

/**
 * The final answer of a transcript: the text of its last message when the agent wrote it. A
 * transcript that ends on a tool call or result has no final answer, and says so with null.
 */
export function answerText(messages: readonly unknown[]): string | null {
  const last = messages.at(-1)
  if (!last || typeof last !== 'object') return null
  const { role, content } = last as { role?: unknown; content?: unknown }
  if (role !== 'assistant') return null
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content
            .flatMap((part: unknown) => {
              const entry = (part ?? {}) as { type?: unknown; text?: unknown }
              return entry.type === 'text' && typeof entry.text === 'string' ? [entry.text] : []
            })
            .join('\n')
        : ''
  return text.trim() ? text.trim() : null
}

/**
 * One try's evidence from what the worker stores (`eval_cells.scores`: the checks, the judge's
 * verdict, the items delivered and reached and the statuses) and its transcript's messages.
 * Anything missing or malformed reads as empty or null, never as a pass.
 */
export function tryEvidence(scores: unknown, messages: readonly unknown[]): TryEvidence {
  const stored = (scores && typeof scores === 'object' ? scores : {}) as Record<string, unknown>
  const checks = Object.fromEntries(
    Object.entries(
      stored.checks && typeof stored.checks === 'object'
        ? (stored.checks as Record<string, unknown>)
        : {},
    ).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'),
  )
  const verdict = stored.verdict
  const reason =
    verdict && typeof verdict === 'object' ? (verdict as { reason?: unknown }).reason : null
  return {
    checks,
    delivered: strings(stored.delivered),
    reached: strings(stored.reached),
    statuses: strings(stored.statuses),
    judgeReason: typeof reason === 'string' ? reason : null,
    answer: answerText(messages),
  }
}

// Fix next: one ranked list of work, each entry with its reasons in plain words.

export const fixKinds = [
  'regression',
  'failing_question',
  'gap',
  'past_review',
  'untested',
] as const
export type FixKind = (typeof fixKinds)[number]
type Risk = 'low' | 'normal' | 'high'

/** A test question that fails its newest weekly answer run, its newest retrieval pass, or both. */
export type QuestionCandidate = {
  type: 'question'
  area: string
  id: string
  risk: Risk
  /** The newest weekly run's verdict; null when it had none. */
  answer: Verdict | null
  /** It passed in the area's baseline run and fails now. */
  regression: boolean
  /** Whether it passed the newest retrieval pass of the live edition; null when not checked. */
  retrieval: boolean | null
  failedChecks: readonly string[]
  /** When the failing run finished, or the pass was made. */
  since: string | null
}
export type GapCandidate = {
  type: 'gap'
  area: string | null
  id: string
  ref: string
  gapType: string
  status: 'open' | 'proposal_made'
  severity: number
  reports: number
  lastSeen: string
}
export type ItemCandidate = {
  type: 'item'
  area: string
  id: string
  title: string
  kind: ItemKind
  risk: Risk
  /** Days since the review date passed (at least 1); null when it has not. */
  daysPastReview: number | null
  reviewDate: string | null
  /** No active test question names the item. */
  untested: boolean
}
export type FixCandidate = QuestionCandidate | GapCandidate | ItemCandidate

export type FixEntry = {
  kind: FixKind
  area: string | null
  subject: { type: 'question' | 'gap' | 'item'; id: string; label: string | null }
  score: number
  reasons: string[]
  checks: string[]
  since: string | null
}

/**
 * The weights of the ranking. A judgment call, kept in one place: a question that got worse
 * comes first, then failures the no-model retrieval check proves, then open gaps by severity and
 * evidence, items past review, and items no question covers (events and examples first, since
 * FR-502 requires their questions).
 */
export const fixWeights = {
  regression: 60,
  answerFail: 40,
  noAnswer: 20,
  retrievalFail: 40,
  risk: { high: 15, normal: 5, low: 0 } as Record<Risk, number>,
  gapOpen: 25,
  gapProposalMade: 5,
  gapSeverity: 8,
  gapReportsCap: 20,
  pastReview: 30,
  pastReviewDaysCap: 60,
  untestedRequired: 25,
  untestedOther: 10,
} as const

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const requiresQuestions = (kind: ItemKind) => kind === 'event' || kind === 'example'

function questionEntry(q: QuestionCandidate): FixEntry | null {
  const answerFails = q.answer === 'fail' || q.answer === 'no_answer'
  const retrievalFails = q.retrieval === false
  if (!answerFails && !retrievalFails) return null
  const w = fixWeights
  const reasons: string[] = []
  let score = w.risk[q.risk]
  if (q.regression && answerFails) {
    score += w.regression
    reasons.push('Passed in the baseline run and fails in the newest weekly run')
  } else if (q.answer === 'fail') {
    score += w.answerFail
    reasons.push('Fails the newest weekly answer test')
  } else if (q.answer === 'no_answer') {
    score += w.noAnswer
    reasons.push('The model gave no answer in the newest weekly run')
  }
  if (retrievalFails) {
    score += w.retrievalFail
    reasons.push('Fails the retrieval check on the live edition, without a model')
  }
  return {
    kind: q.regression && answerFails ? 'regression' : 'failing_question',
    area: q.area,
    subject: { type: 'question', id: q.id, label: null },
    score,
    reasons,
    checks: [...q.failedChecks],
    since: q.since,
  }
}

function gapEntry(g: GapCandidate): FixEntry {
  const w = fixWeights
  const severity = Math.min(Math.max(g.severity, 1), 4)
  const score =
    (g.status === 'open' ? w.gapOpen : w.gapProposalMade) +
    severity * w.gapSeverity +
    Math.min(g.reports, w.gapReportsCap)
  return {
    kind: 'gap',
    area: g.area,
    subject: { type: 'gap', id: g.id, label: g.ref },
    score,
    reasons: [
      `${g.status === 'open' ? 'Open gap' : 'Gap with a proposal under way'}, severity ${severity}`,
      ...(g.reports ? [`${plural(g.reports, 'report')} from agents and feedback`] : []),
    ],
    checks: [],
    since: g.lastSeen,
  }
}

function itemEntry(item: ItemCandidate): FixEntry | null {
  const past = item.daysPastReview !== null && item.daysPastReview > 0
  if (!past && !item.untested) return null
  const w = fixWeights
  const reasons: string[] = []
  let score = w.risk[item.risk]
  let pastScore = 0
  let untestedScore = 0
  if (past) {
    pastScore = w.pastReview + Math.min(item.daysPastReview!, w.pastReviewDaysCap) / 3
    reasons.push(`The review date passed ${plural(item.daysPastReview!, 'day')} ago`)
  }
  if (item.untested) {
    untestedScore = requiresQuestions(item.kind) ? w.untestedRequired : w.untestedOther
    reasons.push(
      requiresQuestions(item.kind)
        ? `No test question covers this ${item.kind}, which needs one`
        : `No test question covers this ${item.kind}`,
    )
  }
  score += pastScore + untestedScore
  return {
    kind: pastScore >= untestedScore ? 'past_review' : 'untested',
    area: item.area,
    subject: { type: 'item', id: item.id, label: item.title },
    score: Math.round(score * 10) / 10,
    reasons,
    checks: [],
    since: past ? item.reviewDate : null,
  }
}

/** The candidates as one list, highest score first, then by area and subject for a stable order. */
export function rankFixNext(candidates: readonly FixCandidate[], limit: number): FixEntry[] {
  const entries = candidates.flatMap((c) => {
    const entry =
      c.type === 'question' ? questionEntry(c) : c.type === 'gap' ? gapEntry(c) : itemEntry(c)
    return entry ? [entry] : []
  })
  return entries
    .sort(
      (a, b) =>
        b.score - a.score ||
        (a.area ?? '').localeCompare(b.area ?? '') ||
        a.subject.type.localeCompare(b.subject.type) ||
        a.subject.id.localeCompare(b.subject.id),
    )
    .slice(0, limit)
}
