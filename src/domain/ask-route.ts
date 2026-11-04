import { answer, type Answer, type AnswerAsk, type AnswerState } from './answer.ts'
import { asksNothing, nothingAskedSaid } from './ask-again.ts'
import { chatSources, fitChat, type ChatTurn } from './ask-chat.ts'
import {
  asksUndefinedWords,
  checkPlan,
  limitOf,
  plannerPrompt,
  plannerReason,
  plannerSystem,
  plannerVocabulary,
  turnIsDated,
  type AskPlan,
  type PlanCheck,
  type PlanContext,
  type PlannerPrevious,
  type PlannerReason,
} from './ask-plan.ts'
import { canRead } from './links.ts'
import {
  plannedAnswer,
  workingWords,
  type PlannedAnswer,
  type PlannedBundle,
} from './planned-answer.ts'
import { limitSaid, type RecordsAsk, type RecordsRecognition } from './records.ts'
import type { AnswerLimit, CannotReason, LimitReason } from './records-answer.ts'
import { cannotSaid, offTopicSaid, scopeWords } from './say.ts'
import { readQuestion } from './scope.ts'
import { dateWindowSchema } from './validity.ts'

/*
  How Ask reads one question (FR-701, FR-718, FR-719), the same on the service, in the planner
  cases and in the mock binding: the rules first, which answer as they always have, and the
  planner only for what they cannot read or for a follow-up. A plan is used once it is checked,
  and its reads run as Ask's own; with no plan, the rules' answer stands. Pure: the caller gives
  the records question the rules read, if any, and the planner, if there is one.
*/

/** What the planner reads: its instructions, the vocabulary, and the question with the chat. */
export type PlannerInput = { system: string; vocabulary: string; prompt: string }
/**
 * The planner: the checked plan for a question, null to answer it as with no model, or `missed`
 * when it was asked and gave none (a limit, a slow provider, a plan that failed the check).
 */
export type Planner = (
  input: PlannerInput,
  check: (raw: unknown) => PlanCheck,
) => Promise<AskPlan | null | 'missed'>

/** A bundle Ask's reads run on, with its domains. */
export type RouteBundle = PlannedBundle & { areas: readonly { id: string; name: string }[] }

/**
 * The chat as the browser sent it, kept to what the planner may read and what the edition holds:
 * the newest turns within the caps, their sources an agent would still be given, their scopes'
 * keys the vocabulary has, and a domain Heed has. Never stored.
 */
export function chatOf(
  bundle: RouteBundle,
  given: readonly ChatTurn[] | undefined,
  today: string,
): ChatTurn[] {
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  const keys = new Set(bundle.terms.map((t) => t.key))
  return fitChat(given ?? []).map((turn) => {
    const scope =
      turn.scope && dateWindowSchema.safeParse(turn.scope.window).success
        ? {
            metrics: turn.scope.metrics.filter((key) => keys.has(key)),
            filters: Object.fromEntries(
              Object.entries(turn.scope.filters)
                .filter(([dimension]) => keys.has(dimension))
                .map(([dimension, values]) => [dimension, values.filter((key) => keys.has(key))]),
            ),
            window: turn.scope.window,
          }
        : null
    return {
      ...turn,
      scope,
      ...(turn.rows ? { rows: turn.rows.filter((key) => keys.has(key)) } : {}),
      domain: bundle.areas.some((a) => a.id === turn.domain) ? turn.domain : null,
      sources: turn.sources.filter((id) => {
        const item = byId.get(id)
        return !!item && canRead(bundle, item, today)
      }),
    }
  })
}

const stateWord: Record<AnswerState, string> = {
  grounded: 'Checked',
  partial: 'Partial',
  missing: 'Not found',
  conflict: 'Conflict',
  stale: 'Outdated',
  failed: 'Not checked',
}

/** What the planner reads for a question on this edition. */
export function plannerInputOf(
  bundle: RouteBundle,
  question: string,
  turns: readonly ChatTurn[],
  today: string,
): PlannerInput {
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  const numbers = new Map(chatSources(turns).map((id, i) => [id, i + 1]))
  const seen = new Set<string>()
  // Newest first, so each source is listed on the newest turn that gave it.
  const newestFirst = [...turns].reverse().map((turn): PlannerPrevious => {
    const answered = [turn.state ? stateWord[turn.state] : null, turn.headline]
    return {
      question: turn.question,
      dated: turnIsDated(turn, today),
      read: turn.understood ?? (turn.scope ? scopeWords(bundle, turn.scope) : null),
      answered: answered.filter(Boolean).join(': ') || null,
      sources: turn.sources.flatMap((id) => {
        const item = byId.get(id)
        const number = numbers.get(id)
        if (!item || !number || seen.has(id)) return []
        seen.add(id)
        return [{ title: item.title, kind: item.kind, number }]
      }),
      ...(turn.asked ? { asked: turn.asked } : {}),
      ...(turn.rows?.length ? { rows: turn.rows } : {}),
    }
  })
  const [previous = null, ...earlier] = newestFirst
  return {
    system: plannerSystem,
    vocabulary: plannerVocabulary(bundle.terms, bundle.areas),
    prompt: plannerPrompt({ question, today, previous, earlier: earlier.reverse() }),
  }
}

/** What a plan is checked against on this edition. */
export function planContextOf(
  bundle: RouteBundle,
  question: string,
  turns: readonly ChatTurn[],
  moment: { today: string; now: string; business?: boolean },
): PlanContext {
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  return {
    question,
    terms: bundle.terms,
    areas: bundle.areas,
    today: moment.today,
    now: moment.now,
    ...(moment.business ? { business: true } : {}),
    previous: turns.at(-1) ?? null,
    earlier: turns.slice(0, -1),
    readable: (id) => {
      const item = byId.get(id)
      return !!item && canRead(bundle, item, moment.today)
    },
  }
}

/**
 * Nothing looked up: a question back, the sentence for a question off topic or for a message that
 * asks nothing, or a fixed sentence that says what Ask cannot do (FR-720), with the metrics whose
 * definitions it shows and what a draft would start from.
 */
export type RoutedReply =
  | { kind: 'clarify' | 'off_topic' | 'nothing_asked'; text: string }
  | {
      kind: 'cannot'
      reason: CannotReason
      text: string
      metrics: string[]
      filters: Record<string, string[]>
    }

const cannot = (
  reason: CannotReason,
  metrics: string[] = [],
  filters: Record<string, string[]> = {},
): { kind: 'reply'; reply: RoutedReply } => ({
  kind: 'reply',
  reply: { kind: 'cannot', reason, text: cannotSaid[reason], metrics, filters },
})

const limitOfReason = (reason: LimitReason | null | undefined): AnswerLimit | null =>
  reason ? { reason, sentence: limitSaid[reason] } : null

/** How a question was read, and what answers it. */
export type Routed =
  /** The rules' answer, as with no model, under a limit when the words reach beyond what is written. */
  | { kind: 'rules'; answer: Answer; limit: AnswerLimit | null }
  /**
   * A records question, as the rules read it or the planner chose it, with what the planner
   * carried from the last question and the question as it reads alone.
   */
  | {
      kind: 'records'
      found: RecordsRecognition
      planned: boolean
      carried?: string[]
      standalone?: string
    }
  /** The planner's reads, run, with what the working line says while they run. */
  | { kind: 'reads'; planned: PlannedAnswer; working: string; limit: AnswerLimit | null }
  /**
   * One short question back, the sentence for a question off topic, or the sentence for a message
   * that asks nothing: nothing is looked up.
   */
  | { kind: 'reply'; reply: RoutedReply }

/**
 * Reads a question: a message that asks nothing is told so, with no model call; then the rules'
 * answer and records question, then, when the planner is to read it (`plannerReason`) and there is
 * one, its checked plan. `reason` says why the planner read it, and `asked` whether it was asked
 * (a call the planner made, whatever came of it).
 */
export async function routeQuestion(c: {
  bundle: RouteBundle
  ask: Extract<AnswerAsk, { question: string }>
  /** The chat so far, oldest first (`chatOf`). */
  turns: readonly ChatTurn[]
  records: RecordsRecognition | null
  today: string
  /** The moment it is now, an ISO instant, for the records' periods. */
  now: string
  planner?: Planner | undefined
  clock?: () => number
}): Promise<Routed & { reason: PlannerReason | null; asked: boolean }> {
  const { bundle, ask, turns, today } = c
  const previous = turns.at(-1) ?? null
  const scoped = !!(ask.metrics?.length || ask.dimension_filters?.length || ask.window)
  const names = readQuestion(ask.question, bundle.terms, today).terms.length > 0
  if (!scoped && !names && asksNothing(ask.question, turns))
    return nothingAsked(ask.question, turns)
  if (!scoped && asksUndefinedWords(ask.question))
    return { ...cannot('not_yet'), reason: null, asked: false }
  const rules = answer(bundle, ask, { today, ...(c.clock ? { now: c.clock } : {}) })
  const reason = plannerReason({
    question: ask.question,
    previous,
    scoped,
    records: c.records,
    rules,
  })
  const business = reason === 'business change'
  const asks = !!reason && !!c.planner
  const plan = asks
    ? await c.planner!(plannerInputOf(bundle, ask.question, turns, today), (raw) =>
        checkPlan(raw, planContextOf(bundle, ask.question, turns, { today, now: c.now, business })),
      )
    : null
  const missed = plan === 'missed'
  const routed = ((): Routed => {
    if (!plan || missed) {
      // A word of judgement a read cannot answer: the honest exit, never the nearest read.
      const judged =
        c.records?.type === 'records' && c.records.judgement && c.records.ask.intent !== 'audit'
      if (judged) return cannot('not_yet')
      if (c.records) return { kind: 'records', found: c.records, planned: false }
      // The planner was asked and gave nothing: that is why it was not read, not a missing name.
      if (missed && rules.status === 'need_more_detail') return cannot('unread')
      return { kind: 'rules', answer: rules, limit: limitOfReason(limitOf(ask.question)) }
    }
    switch (plan.kind) {
      case 'cannot':
        return cannot(plan.reason, plan.metrics, plan.filters)
      case 'clarify':
        return { kind: 'reply', reply: { kind: 'clarify', text: plan.question } }
      case 'off_topic':
        return { kind: 'reply', reply: { kind: 'off_topic', text: offTopicSaid } }
      case 'nothing_asked':
        return nothingAsked(ask.question, turns)
      case 'records':
        return {
          kind: 'records',
          found: { type: 'records', ask: withRulesFacets(plan.ask, c.records) },
          planned: true,
          carried: plan.carried,
          ...(plan.standalone ? { standalone: plan.standalone } : {}),
        }
      case 'reads':
        return {
          kind: 'reads',
          planned: plannedAnswer(bundle, plan.reads, {
            question: ask.question,
            today,
            previous,
            turns,
            ...(plan.standalone ? { standalone: plan.standalone } : {}),
            ...(plan.left ? { left: plan.left } : {}),
            ...(c.clock ? { now: c.clock } : {}),
          }),
          working: workingWords(bundle, plan.reads),
          limit: limitOfReason(plan.limit ?? limitOf(ask.question)),
        }
    }
  })()
  return { ...routed, reason, asked: asks }
}

/**
 * An analysis the rules read keeps what they read: a plan may add to it, never leave a part out,
 * so the same words get at least the same answer whatever the model chose.
 */
function withRulesFacets(ask: RecordsAsk, rules: RecordsRecognition | null): RecordsAsk {
  const floor = rules?.type === 'records' && rules.ask.intent === 'audit' ? rules.ask.audit : null
  if (!floor || ask.intent !== 'audit' || !ask.audit) return ask
  const facets = [...new Set([...floor.facets, ...ask.audit.facets])]
  return {
    ...ask,
    audit: { ...ask.audit, facets, of: floor.of, kind: floor.kind ?? ask.audit.kind },
  }
}

/** What a message that asks nothing gets: one sentence, nothing looked up and no model called. */
export const nothingAsked = (question: string, turns: readonly ChatTurn[]) => ({
  kind: 'reply' as const,
  reply: { kind: 'nothing_asked' as const, text: nothingAskedSaid(question, turns) },
  reason: null,
  asked: false,
})
