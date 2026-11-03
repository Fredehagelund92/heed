import { answer, type Answer, type AnswerAsk } from './answer.ts'
import {
  checkPlan,
  plannerPrompt,
  plannerReason,
  plannerSystem,
  plannerVocabulary,
  type AskPlan,
  type PlanCheck,
  type PlanContext,
  type PlannerReason,
  type PreviousTurn,
} from './ask-plan.ts'
import { canRead } from './links.ts'
import {
  plannedAnswer,
  workingWords,
  type PlannedAnswer,
  type PlannedBundle,
} from './planned-answer.ts'
import type { RecordsRecognition } from './records.ts'
import { offTopicSaid, scopeWords } from './say.ts'
import type { ResolvedScope } from './scope.ts'
import { dateWindowSchema } from './validity.ts'

/*
  How Ask reads one question (FR-701, FR-718, FR-719), the same on the service, in the planner
  cases and in the mock binding: the rules first, which answer as they always have, and the
  planner only for what they cannot read or for a follow-up. A plan is used once it is checked,
  and its reads run as Ask's own; with no plan, the rules' answer stands. Pure: the caller gives
  the records question the rules read, if any, and the planner, if there is one.
*/

/** What the planner reads: its instructions, the vocabulary, and the question with the last turn. */
export type PlannerInput = { system: string; vocabulary: string; prompt: string }
/** The planner: the checked plan for a question, or null to answer it as with no model. */
export type Planner = (
  input: PlannerInput,
  check: (raw: unknown) => PlanCheck,
) => Promise<AskPlan | null>

/** A bundle Ask's reads run on, with its domains. */
export type RouteBundle = PlannedBundle & { areas: readonly { id: string; name: string }[] }

/** The last turn as the browser sent it, before it is checked. */
export type GivenTurn = {
  question: string
  scope?: ResolvedScope | null | undefined
  sources: readonly string[]
  asked?: string | undefined
}

/**
 * The last turn as the browser sent it, kept to what the edition holds: its sources an agent would
 * still be given, and its scope's keys the vocabulary has. Never stored.
 */
export function previousOf(
  bundle: RouteBundle,
  given: GivenTurn | undefined,
  today: string,
): PreviousTurn | null {
  if (!given) return null
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  const keys = new Set(bundle.terms.map((t) => t.key))
  const scope =
    given.scope && dateWindowSchema.safeParse(given.scope.window).success
      ? {
          metrics: given.scope.metrics.filter((key) => keys.has(key)),
          filters: Object.fromEntries(
            Object.entries(given.scope.filters)
              .filter(([dimension]) => keys.has(dimension))
              .map(([dimension, values]) => [dimension, values.filter((key) => keys.has(key))]),
          ),
          window: given.scope.window,
        }
      : null
  return {
    question: given.question,
    scope,
    sources: given.sources.filter((id) => {
      const item = byId.get(id)
      return !!item && canRead(bundle, item, today)
    }),
    ...(given.asked ? { asked: given.asked } : {}),
  }
}

/** What the planner reads for a question on this edition. */
export function plannerInputOf(
  bundle: RouteBundle,
  question: string,
  previous: PreviousTurn | null,
  today: string,
): PlannerInput {
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  return {
    system: plannerSystem,
    vocabulary: plannerVocabulary(bundle.terms, bundle.areas),
    prompt: plannerPrompt({
      question,
      today,
      previous: previous && {
        question: previous.question,
        read: previous.scope ? scopeWords(bundle, previous.scope) : null,
        sources: previous.sources.flatMap((id) => {
          const item = byId.get(id)
          return item ? [{ title: item.title, kind: item.kind }] : []
        }),
        ...(previous.asked ? { asked: previous.asked } : {}),
      },
    }),
  }
}

/** What a plan is checked against on this edition. */
export function planContextOf(
  bundle: RouteBundle,
  question: string,
  previous: PreviousTurn | null,
  moment: { today: string; now: string },
): PlanContext {
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  return {
    question,
    terms: bundle.terms,
    areas: bundle.areas,
    today: moment.today,
    now: moment.now,
    previous,
    readable: (id) => {
      const item = byId.get(id)
      return !!item && canRead(bundle, item, moment.today)
    },
  }
}

/** How a question was read, and what answers it. */
export type Routed =
  /** The rules' answer, as with no model. */
  | { kind: 'rules'; answer: Answer }
  /** A records question, as the rules read it or the planner chose it. */
  | { kind: 'records'; found: RecordsRecognition; planned: boolean }
  /** The planner's reads, run, with what the working line says while they run. */
  | { kind: 'reads'; planned: PlannedAnswer; working: string }
  /** One short question back, or the sentence for a question off topic: nothing is looked up. */
  | { kind: 'reply'; reply: { kind: 'clarify' | 'off_topic'; text: string } }

/**
 * Reads a question: the rules' answer and records question, then, when the planner is to read
 * it (`plannerReason`) and there is one, its checked plan. `reason` says why the planner read
 * it, and `asked` whether it was asked (a call the planner made, whatever came of it).
 */
export async function routeQuestion(c: {
  bundle: RouteBundle
  ask: Extract<AnswerAsk, { question: string }>
  previous: PreviousTurn | null
  records: RecordsRecognition | null
  today: string
  /** The moment it is now, an ISO instant, for the records' periods. */
  now: string
  planner?: Planner | undefined
  clock?: () => number
}): Promise<Routed & { reason: PlannerReason | null; asked: boolean }> {
  const { bundle, ask, previous, today } = c
  const rules = answer(bundle, ask, { today, ...(c.clock ? { now: c.clock } : {}) })
  const reason = plannerReason({
    question: ask.question,
    previous,
    scoped: !!(ask.metrics?.length || ask.dimension_filters?.length || ask.window),
    records: c.records,
    rules,
  })
  const asks = !!reason && !!c.planner
  const plan = asks
    ? await c.planner!(plannerInputOf(bundle, ask.question, previous, today), (raw) =>
        checkPlan(raw, planContextOf(bundle, ask.question, previous, { today, now: c.now })),
      )
    : null
  const routed = ((): Routed => {
    if (!plan)
      return c.records
        ? { kind: 'records', found: c.records, planned: false }
        : { kind: 'rules', answer: rules }
    switch (plan.kind) {
      case 'clarify':
        return { kind: 'reply', reply: { kind: 'clarify', text: plan.question } }
      case 'off_topic':
        return { kind: 'reply', reply: { kind: 'off_topic', text: offTopicSaid } }
      case 'records':
        return { kind: 'records', found: { type: 'records', ask: plan.ask }, planned: true }
      case 'reads':
        return {
          kind: 'reads',
          planned: plannedAnswer(bundle, plan.reads, {
            question: ask.question,
            today,
            previous,
            ...(c.clock ? { now: c.clock } : {}),
          }),
          working: workingWords(bundle, plan.reads),
        }
    }
  })()
  return { ...routed, reason, asked: asks }
}
