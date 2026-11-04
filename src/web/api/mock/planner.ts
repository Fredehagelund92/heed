import type { AnswerResult } from '@contract/answer'
import { nothingAskedSaid } from '@domain/ask-again'
import { checkPlan, readsAsFollowUp } from '@domain/ask-plan'
import { fixturePlan } from '@domain/ask-plan-fixture'
import type { ChatTurn } from '@domain/ask-chat'
import { chatOf, planContextOf, type RouteBundle } from '@domain/ask-route'
import type { AnswerSource } from '@domain/answer'
import { plannedAnswer, workingWords } from '@domain/planned-answer'
import { offTopicSaid } from '@domain/say'
import type { Term } from '@domain/vocabulary'
import { answerOf, type Names } from '@/api/http-ask'
import type { Definition } from '@/lib/definitions'
import { plainText } from '@/lib/mentions'
import { replyAnswer, type Answer } from '@/model/ask'
import { servedToAgents, type DomainId, type Fact } from '@/model/items'
import { toServerValidity } from '@/model/validity'
import { RECORDS_NOW, termsOf } from './records'

// Ask's planner on the mock binding (FR-719): the scripted planner's plans for the demo's
// questions (src/domain/ask-plan-fixture.ts), checked and run by the same pure code as on the
// service, over the demo world, so a demo asks and answers as the service does with the scripted
// planner. A question the scripted planner holds no plan for is answered as with no model.

/** The demo world's today. */
const TODAY = RECORDS_NOW.slice(0, 10)

/** The demo world as the engine and the planner read it: its facts, its vocabulary and its domains. */
function bundleOf(
  pool: readonly Fact[],
  terms: readonly Term[],
  domains: readonly { id: DomainId; name: string }[],
): RouteBundle {
  const byName = new Map(terms.map((t) => [t.name.toLowerCase(), t]))
  const itemOf = (f: Fact): AnswerSource => {
    const named = f.where.flatMap((name) => byName.get(name.toLowerCase()) ?? [])
    const days = toServerValidity(f.valid)
    const pair = f.disagreesWith ?? pool.find((x) => x.disagreesWith === f.id)?.id
    return {
      id: f.id,
      version: 1,
      areaId: f.domain,
      kind: f.kind,
      title: f.title,
      summary: plainText(f.summary),
      scope: {
        metrics: named.filter((t) => t.kind === 'metric').map((t) => t.key),
        dimensions: [],
        dimensionValues: named
          .filter((t) => t.kind === 'dimension_value')
          .map((t) => ({ dimension: t.parentKey!, value: t.key })),
      },
      validity: { start: days.start ?? '2000-01-01', end: days.end ?? null },
      reviewDate: null,
      riskLevel: 'normal',
      checkFlag: f.outOfDate ? 'needs_check' : null,
      status: servedToAgents(f) ? 'accepted' : 'proposal',
      audience: { kind: 'everyone' },
      conflicts: pair ? [pair] : [],
      proposerId: null,
      notToConclude: f.dontConclude,
    }
  }
  return {
    edition: 'demo',
    overlay: '0',
    items: pool.map(itemOf),
    terms,
    areas: domains.map((d) => ({ id: d.id, name: d.name })),
    groupsOfMetric: {},
    metricArea: {},
    stopped: { all: false, areas: [], items: [] },
  }
}

/** The names of the demo vocabulary's keys, as the service's answers are named in Ask. */
const namesOf = (terms: readonly Term[]): Names => {
  const name = new Map(terms.map((t) => [t.key, t.name]))
  return {
    metric: (key) => name.get(key) ?? key,
    value: (key) => name.get(key) ?? key,
    terms,
  }
}

export type PlannerWorld = {
  pool: readonly Fact[]
  definitions: readonly Definition[]
  domains: readonly { id: DomainId; name: string }[]
}

/** The planner's turn: the vocabulary, the edition, and the chat as Ask keeps it. */
function turnOf(world: PlannerWorld, given: readonly ChatTurn[] | undefined) {
  const terms = termsOf(world.definitions)
  const bundle = bundleOf(world.pool, terms, world.domains)
  const turns = chatOf(bundle, given, TODAY)
  return { terms, bundle, turns, last: turns.at(-1) ?? null }
}

/** Whether the planner reads a question first: it follows on from the last turn (FR-719). */
export function followsOn(
  question: string,
  turns: readonly ChatTurn[] | undefined,
  world: PlannerWorld,
  read: { metrics: number; answered: boolean; refused?: boolean },
): boolean {
  if (!turns?.length) return false
  return readsAsFollowUp(question, turnOf(world, turns).last, read)
}

/**
 * The scripted planner's answer to a question, as the service gives it: its reads, run on the
 * demo world, with how it was read; a short question back; or the sentence for a question off
 * topic. Null when it holds no plan for the question, or the plan fails the check.
 */
export function plannedFor(
  question: string,
  given: readonly ChatTurn[] | undefined,
  world: PlannerWorld,
): Answer | null {
  const raw = fixturePlan(question, given?.at(-1)?.question ?? null)
  if (!raw) return null
  const { bundle, turns, last } = turnOf(world, given)
  const checked = checkPlan(
    raw,
    planContextOf(bundle, question, turns, { today: TODAY, now: RECORDS_NOW }),
  )
  if (!checked.ok) return null
  const plan = checked.plan
  if (plan.kind === 'clarify')
    return replyAnswer(question, { kind: 'clarify', text: plan.question })
  if (plan.kind === 'off_topic')
    return replyAnswer(question, { kind: 'off_topic', text: offTopicSaid })
  if (plan.kind === 'nothing_asked')
    return replyAnswer(question, {
      kind: 'nothing_asked',
      text: nothingAskedSaid(question, turns),
    })
  // A records plan is the records reader's: the demo's records questions are read by their words.
  if (plan.kind === 'records') return null
  const planned = plannedAnswer(bundle, plan.reads, {
    question,
    today: TODAY,
    previous: last,
    turns,
    ...(plan.standalone ? { standalone: plan.standalone } : {}),
  })
  const { overlay: _overlay, ...answered } = planned.answer
  const result: AnswerResult = {
    ...answered,
    target: { kind: 'live' },
    reading: planned.reading,
  }
  const answer = answerOf(result, question, namesOf(bundle.terms))
  return answer.reading
    ? { ...answer, reading: { ...answer.reading, working: workingWords(bundle, plan.reads) } }
    : answer
}
