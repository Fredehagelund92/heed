import { answer, readAsk, type Answer, type AnswerAsk, type AnswerState } from './answer.ts'
import { asksNothing, nothingAskedSaid } from './ask-again.ts'
import { chatSources, fitChat, type ChatTurn, type HeldReading, type HeldWord } from './ask-chat.ts'
import { chosenMeanings, heldOf, settled } from './ask-held.ts'
import {
  checkPlan,
  leftOpen,
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
import type { RecordsRecognition } from './records.ts'
import {
  contestedAlso,
  contestedQuestion,
  offTopicSaid,
  scopeWords,
  termChosenSaid,
} from './say.ts'
import { readQuestion } from './scope.ts'
import { dateWindowSchema } from './validity.ts'
import { namesOf, normalizeName } from './vocabulary.ts'

/*
  How Ask reads one question (FR-701, FR-718, FR-719), the same on the service, in the planner
  cases and in the mock binding: the rules first, which answer as they always have, and the
  planner only for what they cannot read or for a follow-up. A plan is used once it is checked,
  and its reads run as Ask's own; with no plan, the rules' answer stands. Pure: the caller gives
  the records question the rules read, if any, and the planner, if there is one.
*/

/** What the planner reads: its instructions, the vocabulary, and the question with the chat. */
export type PlannerInput = { system: string; vocabulary: string; prompt: string }
/** The planner: the checked plan for a question, or null to answer it as with no model. */
export type Planner = (
  input: PlannerInput,
  check: (raw: unknown) => PlanCheck,
) => Promise<AskPlan | null>

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
  const known = ({ metrics, filters }: Pick<HeldReading, 'metrics' | 'filters'>) => ({
    metrics: metrics.filter((key) => keys.has(key)),
    filters: Object.fromEntries(
      Object.entries(filters)
        .filter(([dimension]) => keys.has(dimension))
        .map(([dimension, values]) => [dimension, values.filter((key) => keys.has(key))]),
    ),
  })
  // Heed's own names, so a turn from the browser can only say what the edition holds.
  const meanings = new Map(
    bundle.terms.flatMap((term) => [
      [term.key, term.name] as const,
      ...(term.contested ?? []).flatMap((c) => c.meanings.map((m) => [m.key, m.name] as const)),
    ]),
  )
  const namedWord = ({ word, meanings: given }: HeldWord): HeldWord | undefined => {
    const said = bundle.terms.some(
      (term) =>
        given.some((m) => m.key === term.key) && namesOf(term).includes(normalizeName(word)),
    )
    const known = given.flatMap((m) => {
      const name = meanings.get(m.key)
      return name === undefined ? [] : [{ key: m.key, name }]
    })
    return said && known.length === given.length ? { word, meanings: known } : undefined
  }
  // A held reading that no longer fits the edition or the calendar holds nothing.
  const heldIn = (held: HeldReading): HeldReading | undefined => {
    const first = namedWord(held)
    const more = held.more?.map(namedWord)
    if (!first || more?.some((word) => !word)) return undefined
    if (held.window && !dateWindowSchema.safeParse(held.window).success) return undefined
    return { ...held, ...first, ...known(held), ...(more ? { more: more as HeldWord[] } : {}) }
  }
  return fitChat(given ?? []).map((turn) => {
    const scope =
      turn.scope && dateWindowSchema.safeParse(turn.scope.window).success
        ? { ...known(turn.scope), window: turn.scope.window }
        : null
    const { held: given, ...rest } = turn
    const held = given && heldIn(given)
    return {
      ...rest,
      ...(held ? { held } : {}),
      scope,
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
  moment: { today: string; now: string },
): PlanContext {
  const byId = new Map(bundle.items.map((item) => [item.id, item]))
  return {
    question,
    terms: bundle.terms,
    areas: bundle.areas,
    today: moment.today,
    now: moment.now,
    previous: turns.at(-1) ?? null,
    earlier: turns.slice(0, -1),
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
  | { kind: 'reads'; planned: PlannedAnswer; working: string }
  /**
   * One short question back, the sentence for a question off topic, or the sentence for a message
   * that asks nothing: nothing is looked up.
   */
  | {
      kind: 'reply'
      reply: {
        kind: 'clarify' | 'off_topic' | 'nothing_asked'
        text: string
        /** What Ask holds while it waits to hear which meaning of a word the person means. */
        held?: HeldReading
      }
    }

/**
 * A word with more than one meaning, by the fixed rules and with no model, or null when the
 * question has none: the answer to the question Ask just asked, read with what that turn held; or
 * the question itself, which the person settles, before a model could choose. A question the
 * records answer in full keeps that answer: it reads no metric.
 */
export function routeHeld(
  c: {
    bundle: RouteBundle
    ask: Extract<AnswerAsk, { question: string }>
    turns: readonly ChatTurn[]
    records?: RecordsRecognition | null
    today: string
    now: string
    clock?: () => number
  },
  scoped: boolean,
) {
  const { bundle, ask, turns, today } = c
  const previous = turns.at(-1) ?? null
  const chosen =
    previous?.held && !scoped
      ? chosenMeanings(ask.question, previous.held, bundle.terms, today)
      : null
  if (previous?.held && chosen) {
    const next = settled(previous.held, chosen, bundle.terms, today)
    if (next.kind === 'ask') return askedWhich(next.held)
    if (next.kind === 'nothing')
      return {
        kind: 'reply' as const,
        reply: { kind: 'nothing_asked' as const, text: termChosenSaid(next.word) },
        reason: null,
        asked: false,
      }
    const planned = plannedAnswer(bundle, [next.read], {
      question: ask.question,
      today,
      previous,
      turns,
      settled: { also: contestedAlso(next.word, next.others) },
      ...(c.clock ? { now: c.clock } : {}),
    })
    return {
      kind: 'reads' as const,
      planned,
      working: workingWords(bundle, planned.reads),
      reason: null,
      asked: false,
    }
  }
  const firm = c.records && (c.records.type === 'refused' || !c.records.loose)
  const held = firm ? null : heldOf(readAsk(ask, bundle.terms, today))
  if (!held) return null
  const context = planContextOf(bundle, ask.question, turns, { today, now: c.now })
  const open = scoped ? null : leftOpen(context)
  return askedWhich({
    ...held,
    filters: { ...open?.filters, ...held.filters },
    window: held.window ?? open?.window ?? null,
  })
}

/**
 * Reads a question: a word with more than one meaning is asked about (`routeHeld`), a message that
 * asks nothing is told so, with no model call; then the rules' answer and records question, then,
 * when the planner is to read it (`plannerReason`) and there is one, its checked plan. `reason`
 * says why the planner read it, and `asked` whether it was asked (a call the planner made,
 * whatever came of it).
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
  const held = routeHeld(c, scoped)
  if (held) return held
  const names = readQuestion(ask.question, bundle.terms, today).terms.length > 0
  if (!scoped && !names && asksNothing(ask.question, turns))
    return nothingAsked(ask.question, turns)
  const rules = answer(bundle, ask, { today, ...(c.clock ? { now: c.clock } : {}) })
  const reason = plannerReason({
    question: ask.question,
    previous,
    scoped,
    records: c.records,
    rules,
  })
  const asks = !!reason && !!c.planner
  const plan = asks
    ? await c.planner!(plannerInputOf(bundle, ask.question, turns, today), (raw) =>
        checkPlan(raw, planContextOf(bundle, ask.question, turns, { today, now: c.now })),
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
      case 'nothing_asked':
        return nothingAsked(ask.question, turns)
      case 'records':
        return {
          kind: 'records',
          found: { type: 'records', ask: plan.ask },
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
            ...(c.clock ? { now: c.clock } : {}),
          }),
          working: workingWords(bundle, plan.reads),
        }
    }
  })()
  return { ...routed, reason, asked: asks }
}

/** One plain question about a word's meanings, from the fixed rules: nothing looked up, no model. */
const askedWhich = (held: HeldReading) => ({
  kind: 'reply' as const,
  reply: { kind: 'clarify' as const, text: contestedQuestion(held), held },
  reason: null,
  asked: false,
})

/** What a message that asks nothing gets: one sentence, nothing looked up and no model called. */
export const nothingAsked = (question: string, turns: readonly ChatTurn[]) => ({
  kind: 'reply' as const,
  reply: { kind: 'nothing_asked' as const, text: nothingAskedSaid(question, turns) },
  reason: null,
  asked: false,
})
