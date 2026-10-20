import type { EditionChangeKind } from '@domain/editions'
import type { ComparisonFactor } from '@domain/quality'
import type { Gap, GapHistoryEntry, QuestionComparison, QuestionHistory, TestQuestion } from '@/api'
import { gapStageOf } from './gaps'
import { checkNames } from './quality'

/*
  What a test question's record in the Workbench reads out of its two runs, its history and the
  gaps (Workbench plan, slice W6b): the gaps on the same scope, each check over the tries of a
  run, what each run's tries were given, and the question's history as one line of events; and a
  gap's history the same way (W6c). Pure functions of what the reads return, so the record only
  lays them out.
*/

type Side = QuestionComparison['run']
type Naming = 'must_deliver' | 'must_not_deliver' | 'reachable_via_link'
const gapStageOrder = { open: 0, drafting: 1, closed: 2 } as const

/** A question names a metric by its key (`net_revenue`); a gap's topic by its term (`metric:…`). */
const metricTerm = (key: string) => (key.startsWith('metric:') ? key : `metric:${key}`)
const dimensionTerm = (key: string) => (key.startsWith('dim:') ? key : `dim:${key}`)
const valueTerm = (dimension: string, value: string) =>
  value.startsWith('val:') ? value : `val:${dimensionTerm(dimension).slice(4)}/${value}`

/**
 * The gaps on a test question's scope (Workbench plan, W6b): in its domain, or in none; about a
 * metric it asks about (or, when it names none, about none either); and, for a dimension it
 * narrows to some values, about one of those values or about the dimension as a whole. Gaps still
 * open come first, then the ones with a draft, then the closed; the latest seen first in each.
 */
export function gapsForScope(
  question: Pick<TestQuestion, 'area' | 'scope'>,
  gaps: readonly Gap[],
): Gap[] {
  const metrics = new Set((question.scope.metrics ?? []).map(metricTerm))
  const filters = (question.scope.dimension_filters ?? []).filter((filter) => filter.values.length)
  const narrowed = new Set(filters.map((filter) => dimensionTerm(filter.dimension)))
  const values = new Set(
    filters.flatMap((filter) => filter.values.map((value) => valueTerm(filter.dimension, value))),
  )
  return gaps
    .filter(({ topic }) => {
      if (topic.areaId !== null && topic.areaId !== question.area) return false
      const sameMetric = metrics.size
        ? topic.metrics.some((metric) => metrics.has(metric))
        : topic.metrics.length === 0
      if (!sameMetric) return false
      return topic.dimensionValues.every(
        ({ dimension, value }) => !narrowed.has(dimension) || values.has(value),
      )
    })
    .sort(
      (a, b) =>
        gapStageOrder[gapStageOf(a.status)] - gapStageOrder[gapStageOf(b.status)] ||
        b.lastSeen.localeCompare(a.lastSeen) ||
        a.id.localeCompare(b.id),
    )
}

/** One check over a run's tries: how many tries held it, of how many it was scored on. */
export type CheckTally = { check: string; held: number; tries: number }

const checkOrder = Object.keys(checkNames)
const checkRank = (check: string) => {
  const known = checkOrder.indexOf(check)
  return known === -1 ? checkOrder.length : known
}

/** Each check of a run's tries, in the order checks are named, rubrics last; none without tries. */
export function checkTallies(side: Side | null): CheckTally[] {
  const tallies = new Map<string, CheckTally>()
  for (const wording of side?.wordings ?? [])
    for (const attempt of wording.tries)
      for (const [check, held] of Object.entries(attempt.checks)) {
        const tally = tallies.get(check) ?? { check, held: 0, tries: 0 }
        tally.tries += 1
        if (held) tally.held += 1
        tallies.set(check, tally)
      }
  return [...tallies.values()].sort(
    (a, b) => checkRank(a.check) - checkRank(b.check) || a.check.localeCompare(b.check),
  )
}

/** How many of a run's tries were given an item, of all its tries. */
export type Given = { tries: number; of: number }

/** An item the question names or a try was given, and how often each run's tries were given it. */
export type DeliveredRow = {
  itemId: string
  /** How the question names it; null when a try was given it unasked. */
  named: Naming | null
  run: Given
  /** Null without a run to compare with. */
  against: Given | null
}

const namings: readonly Naming[] = ['must_deliver', 'must_not_deliver', 'reachable_via_link']

function givenIn(side: Side, itemId: string): Given {
  const tries = side.wordings.flatMap((wording) => wording.tries)
  return {
    tries: tries.filter((attempt) => attempt.delivered.includes(itemId)).length,
    of: tries.length,
  }
}

/**
 * What Heed gave the controlled test in each run, item by item: first the items the question
 * expects, forbids or reaches by a link, in its own order, then any other item a try was given.
 */
export function deliveredRows(
  question: Pick<TestQuestion, 'expected'>,
  comparison: Pick<QuestionComparison, 'run' | 'against'>,
): DeliveredRow[] {
  const named = new Map<string, Naming>()
  for (const naming of namings)
    for (const id of question.expected[naming] ?? []) if (!named.has(id)) named.set(id, naming)
  const sides = [comparison.run, ...(comparison.against ? [comparison.against] : [])]
  const others = [
    ...new Set(
      sides.flatMap((side) =>
        side.wordings.flatMap((wording) => wording.tries.flatMap((attempt) => attempt.delivered)),
      ),
    ),
  ]
    .filter((id) => !named.has(id))
    .sort()
  return [...named.keys(), ...others].map((itemId) => ({
    itemId,
    named: named.get(itemId) ?? null,
    run: givenIn(comparison.run, itemId),
    against: comparison.against ? givenIn(comparison.against, itemId) : null,
  }))
}

/**
 * What decides an answer besides chance, as the record states it: "Only the edition differs"
 * needs every other factor held and none unknown; otherwise it names what else changed and what
 * neither run recorded, so a confounded comparison is never read as the edition's doing.
 */
export function comparisonFactors(
  comparison: Pick<QuestionComparison, 'against' | 'changed' | 'unknown'>,
): { onlyEdition: boolean; changed: ComparisonFactor[]; unknown: ComparisonFactor[] } | null {
  if (!comparison.against) return null
  const changed = comparison.changed.filter((factor) => factor !== 'edition')
  return {
    onlyEdition:
      comparison.changed.includes('edition') && !changed.length && !comparison.unknown.length,
    changed,
    unknown: [...comparison.unknown],
  }
}

/** A version step of an item, from the editions comparison (`editions.compareItem`). */
export type ItemSteps = {
  itemId: string
  title: string
  steps: readonly {
    edition: { label: string; sealedAt: string | null; createdAt: string }
    change: EditionChangeKind
    from: { version: number } | null
    to: { version: number } | null
  }[]
}

/** One event in a test question's history, newest first. */
export type HistoryEvent =
  | { kind: 'run'; at: string; run: QuestionHistory['runs'][number] }
  | {
      kind: 'retrieval'
      at: string
      edition: string
      passed: boolean
      /** Against the pass before it: none shown (the oldest), a different result, or the same. */
      change: 'first' | 'changed' | 'same'
    }
  | {
      kind: 'edition'
      at: string
      edition: string
      itemId: string
      title: string
      change: EditionChangeKind
      from: number | null
      to: number | null
    }

const eventOrder = { run: 0, retrieval: 1, edition: 2 } as const

/**
 * A test question's history as one line (Workbench plan, W6b): each run that tested it or skipped
 * it; the retrieval pass whenever its result changed from the edition before, and the newest one;
 * and each edition that changed an item it names or was given. Newest first; on one moment a run
 * comes before the retrieval pass and the edition, the order a reader works back in.
 */
export function questionHistory(
  history: Pick<QuestionHistory, 'runs' | 'retrieval'>,
  items: readonly ItemSteps[] = [],
): HistoryEvent[] {
  const passes = [...history.retrieval].reverse()
  const retrieval = passes.flatMap((pass, index): HistoryEvent[] =>
    index === 0 || pass.passed !== passes[index - 1]!.passed || index === passes.length - 1
      ? [
          {
            kind: 'retrieval',
            at: pass.asOf,
            edition: pass.edition,
            passed: pass.passed,
            change:
              index === 0
                ? 'first'
                : pass.passed === passes[index - 1]!.passed
                  ? 'same'
                  : 'changed',
          },
        ]
      : [],
  )
  const editions = items.flatMap((item) =>
    item.steps.map((step): HistoryEvent => ({
      kind: 'edition',
      at: step.edition.sealedAt ?? step.edition.createdAt,
      edition: step.edition.label,
      itemId: item.itemId,
      title: item.title,
      change: step.change,
      from: step.from?.version ?? null,
      to: step.to?.version ?? null,
    })),
  )
  return [
    ...history.runs.map((run): HistoryEvent => ({ kind: 'run', at: run.finishedAt, run })),
    ...retrieval,
    ...editions,
  ].sort(
    (a, b) =>
      b.at.slice(0, 10).localeCompare(a.at.slice(0, 10)) ||
      eventOrder[a.kind] - eventOrder[b.kind] ||
      b.at.localeCompare(a.at),
  )
}

/** One moment in a gap's history (Workbench plan, W6c and V5). */
export type GapEvent =
  | { kind: 'first_seen'; at: string }
  | {
      kind: 'status'
      at: string
      status: Gap['status']
      /** The live edition an owner resolved it on (V5), when the history recorded it. */
      edition?: string
      reason?: string
    }
  | { kind: 'draft'; at: string; proposal: string }
  | { kind: 'note'; at: string }
  | { kind: 'test_linked' | 'test_unlinked'; at: string; question: string }
  | { kind: 'verified'; at: string; edition: string | null; run: string | null }
  | { kind: 'verification_cleared'; at: string }
  | { kind: 'last_seen'; at: string }

const text = (value: unknown) => (typeof value === 'string' ? value : undefined)

/** A step of the history log as an event; null for one the record does not tell. */
function historyEvent({ action, hour, details }: GapHistoryEntry): GapEvent | null {
  const question = text(details.question)
  switch (action) {
    case 'gap.status_changed': {
      const status = text(details.to) as Gap['status'] | undefined
      if (!status) return null
      const edition = text(details.edition)
      const reason = text(details.reason)
      return {
        kind: 'status',
        at: hour,
        status,
        ...(edition ? { edition } : {}),
        ...(reason ? { reason } : {}),
      }
    }
    case 'gap.note_added':
      return { kind: 'note', at: hour }
    case 'gap.draft_started': {
      const proposal = text(details.proposal)
      return proposal ? { kind: 'draft', at: hour, proposal } : null
    }
    case 'gap.test_linked':
    case 'gap.test_unlinked':
      return question
        ? {
            kind: action === 'gap.test_linked' ? 'test_linked' : 'test_unlinked',
            at: hour,
            question,
          }
        : null
    case 'gap.verified':
      return {
        kind: 'verified',
        at: hour,
        edition: text(details.edition) ?? null,
        run: text(details.run) ?? null,
      }
    case 'gap.verification_cleared':
      return { kind: 'verification_cleared', at: hour }
  }
}

/**
 * A gap's history as one line (Workbench plan, W6c): when agents first found nothing, each draft
 * started from it that the reader may see, where it stands since when, and when it was last seen.
 * Open since the day it was first seen is how it began, so it is no event of its own; Draft
 * started is the draft's own event. Newest first, and on one day by the hour.
 *
 * Its owners and administrators also read its lifecycle from the history log (V5, `history`):
 * each status change with the resolving edition and the reason, the notes added, the tests linked
 * and unlinked, its verification by test and a verification cleared. Without that log (anyone
 * else, or a change made before Heed kept it) the current status since when stands in for it.
 */
export function gapHistory(
  gap: Pick<Gap, 'firstSeen' | 'lastSeen' | 'status' | 'statusSince'>,
  drafts: readonly { id: string; createdAt: string }[] = [],
  history: readonly GapHistoryEntry[] | null = null,
): GapEvent[] {
  const day = (at: string) => at.slice(0, 10)
  const logged = (history ?? []).flatMap((entry) => historyEvent(entry) ?? [])
  // A draft the reader cannot open is left out, as the drafts list leaves it out.
  const readable = new Set(drafts.map((draft) => draft.id))
  const steps = logged.filter((event) => event.kind !== 'draft' || readable.has(event.proposal))
  const loggedDrafts = new Set(
    steps.flatMap((event) => (event.kind === 'draft' ? [event.proposal] : [])),
  )
  const statusLogged = steps.some((event) => event.kind === 'status' && event.status === gap.status)
  const status =
    statusLogged ||
    (gap.status === 'open' && day(gap.statusSince) === day(gap.firstSeen)) ||
    (gap.status === 'proposal_made' && drafts.length > 0)
      ? []
      : [{ kind: 'status' as const, at: gap.statusSince, status: gap.status }]
  const events: GapEvent[] = [
    { kind: 'first_seen' as const, at: gap.firstSeen },
    ...steps,
    ...status,
    ...drafts
      .filter((draft) => !loggedDrafts.has(draft.id))
      .map((draft) => ({ kind: 'draft' as const, at: draft.createdAt, proposal: draft.id })),
    ...(day(gap.lastSeen) === day(gap.firstSeen)
      ? []
      : [{ kind: 'last_seen' as const, at: gap.lastSeen }]),
  ]
  const edge = (event: GapEvent) =>
    event.kind === 'last_seen' ? 0 : event.kind === 'first_seen' ? 2 : 1
  return events
    .map((event, index) => ({ event, index }))
    .sort(
      (a, b) =>
        day(b.event.at).localeCompare(day(a.event.at)) ||
        edge(a.event) - edge(b.event) ||
        b.event.at.localeCompare(a.event.at) ||
        b.index - a.index,
    )
    .map(({ event }) => event)
}
