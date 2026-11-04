import { createHash } from 'node:crypto'
import { plannerSystem, plannerVocabulary } from '../../../domain/ask-plan.ts'
import { answer } from '../../../domain/answer.ts'
import { planProblems, type PlanCase, type PlanOutcome } from './plan-cases.ts'
import { PLAN_TODAY, planAreas, planBundle } from './plan-world.ts'

/*
  The release gate of Ask's promises (FR-720, docs/evaluations.md): the zero-tolerance rules and the
  thresholds, scored from the planner cases' run. Code decides honesty: a judge can never pass a
  case. Pure over a run, so the same gate reads the scripted planner in every build and the real
  model on request (`npm run eval:ask-gate`), reported apart (FR-710).
*/

/** The last real run's plans: replayed through the check in every build. */
export const recordedPlansFile = new URL('./recorded-plans.json', import.meta.url)

/** The classes a case is scored in. The planner cases that came first have none of their own. */
export type GateClass = 'R' | 'S' | 'D' | 'A' | 'X' | 'earlier'

export const classOf = (c: PlanCase): GateClass => c.class ?? 'earlier'

/** What a shown count under the minimum looks like in a line about a topic. */
const SMALL_COUNT = /\b[Aa]sked (?:[1-4])\b/
/** Advice in Ask's own voice. A cited item may say so; Ask's own sentences may not. */
const OWN_VOICE = /\b(?:I recommend|I suggest|you should|we should|I would)\b/i

export type ZeroRule =
  'invented' | 'unsupported sentence' | 'hidden given away' | 'substitution' | 'advice'

export type GateScore = {
  cases: number
  /** Read as it should be: its route, its plan, its facets and its exit. */
  read: number
  /** What it must say, it said. */
  complete: number
  /** Every problem, by case. */
  problems: Record<string, string[]>
  /** Each zero-tolerance rule, with the cases that broke it. */
  zero: Record<ZeroRule, string[]>
}

const readProblem = (p: string) =>
  /^(?:read by|planned|read facets|records |domain |exit |limit |metric |asked the planner)/.test(p)
const mustProblem = (p: string) => p.startsWith('does not say')

/** A run of cases scored: what the gate reads, whichever planner made it. */
export function scoreRun(
  cases: readonly PlanCase[],
  got: ReadonlyMap<string, PlanOutcome>,
): GateScore {
  const problems: Record<string, string[]> = {}
  const zero: GateScore['zero'] = {
    invented: [],
    'unsupported sentence': [],
    'hidden given away': [],
    substitution: [],
    advice: [],
  }
  let read = 0
  let complete = 0
  for (const c of cases) {
    const outcome = got.get(c.id)!
    const found = planProblems(c, outcome)
    if (found.length) problems[c.id] = found
    if (!found.some(readProblem)) read++
    if (!found.some(mustProblem)) complete++
    if (found.some((p) => p.startsWith('invents'))) zero.invented.push(c.id)
    if (/Finance counts/.test(outcome.rendered) || SMALL_COUNT.test(outcome.rendered))
      zero['hidden given away'].push(c.id)
    // A rule or a plan that answered with a read the question did not ask for.
    if (found.some(readProblem) && c.class) zero.substitution.push(c.id)
    if (OWN_VOICE.test(outcome.rendered)) zero.advice.push(c.id)
  }
  return { cases: cases.length, read, complete, problems, zero }
}

/** The bars of section 8.6, as shares. */
export const GATE_BARS = { read: 0.95, complete: 0.95, samePlan: 0.9 } as const

/** Whether a run passes: no zero-tolerance rule broken, and each share at its bar. */
export function gatePasses(score: GateScore): boolean {
  return (
    Object.values(score.zero).every((ids) => !ids.length) &&
    score.read / score.cases >= GATE_BARS.read &&
    score.complete / score.cases >= GATE_BARS.complete
  )
}

/** What each class may cost and take (section 7.6): micro-dollars at p50, milliseconds at p90. */
export const GATE_BUDGETS: Record<GateClass, { micros: number; ms: number }> = {
  D: { micros: 300, ms: 150 },
  R: { micros: 100, ms: 2_000 },
  S: { micros: 300, ms: 3_500 },
  A: { micros: 300, ms: 3_500 },
  X: { micros: 100, ms: 2_000 },
  earlier: { micros: 300, ms: 3_500 },
}

/** What a recorded plan was recorded against: a changed one must be recorded again. */
export function plannerDigest(model: string): string {
  return createHash('sha256')
    .update(plannerSystem)
    .update(plannerVocabulary(planBundle.terms, planAreas))
    .update(model)
    .digest('hex')
    .slice(0, 16)
}

/**
 * What get_context says for every case's question in the cases' world, as a digest, so a change to
 * it fails the gate: the answer engine's status, state, items and words, with no model and no plan.
 */
export function engineDigest(cases: readonly PlanCase[]): string {
  const hash = createHash('sha256')
  for (const c of cases) {
    const a = answer(planBundle, { question: c.question }, { today: PLAN_TODAY })
    hash.update(JSON.stringify([c.question, a.status, a.state, a.say, a.items.map((i) => i.id)]))
  }
  return hash.digest('hex').slice(0, 16)
}
