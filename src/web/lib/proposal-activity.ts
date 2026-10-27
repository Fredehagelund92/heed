import type { Finding, Gate, LevelResult, ProposalEvent, ProposalRecord } from '@/api'
import type { TimelineEventKind, TimelineTone } from '@/components/proposal/timeline'
import { checkLevelNames, type CheckLevel } from '@/lib/gate'
import { channelText, formatDay } from '@/lib/library'
import { formatOutcome } from '../../domain/draft.ts'

/*
  A proposal's story, from its events (proposals.events): the timeline of the status page and
  the four steps above it. Events are the service's record of who did what; decisions and
  comments are events too, so one ordered list holds them all. Event data is a free record in
  the contract, so every reader checks the shape it needs and leaves out what it cannot read.
*/

type Data = Record<string, unknown>

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null
/** The levels in the order the checks run them. */
const checkLevels = Object.keys(checkLevelNames) as CheckLevel[]

export type ActivityContext = {
  /** The signed-in person: their own events read "You". */
  viewerId: string
  /** A person's name, or null when the people have not loaded. */
  nameOf: (personId: string) => string | null
  /** A domain's name, for an owner's move to another domain. */
  areaName?: (areaId: string) => string | null
  proposal: Pick<ProposalRecord, 'channel' | 'proposerId'>
}

/** One row of the timeline, ready for `TimelineEvent`. */
export type ActivityRow = {
  id: string
  kind: TimelineEventKind
  tone?: TimelineTone
  /** Who did it, in bold: "You", "Jon Abara". Missing for what the service did itself. */
  actor?: string
  action: string
  at: string
  detail?: string
  /** What a person wrote: a comment, a reason. */
  body?: string
  /** The outcomes of a check run, for the row's one line of glyphs. */
  checks?: Pick<Gate, 'required' | 'levels'>
}

/** " as admin": named for an administrator, who decides in any domain (FR-202). */
const asCapacity = (data: Data) => (data.capacity === 'administrator' ? ' as admin' : '')

/**
 * A decision's quiet line: that its proposer made it, which an administrator and an owner of the
 * domain may (FR-206), said plainly and not as a warning; then what else the row says.
 */
const decidedNote = (data: Data, then: string | null = null) =>
  [data.byProposer === true ? 'Decided by its proposer.' : null, then].filter(Boolean).join(' ') ||
  undefined

const outcomes = ['passed', 'failed', 'error', 'not_run'] as const
type Outcome = (typeof outcomes)[number]
const isOutcome = (value: unknown): value is Outcome =>
  typeof value === 'string' && (outcomes as readonly string[]).includes(value)
const isLevel = (value: unknown): value is CheckLevel =>
  typeof value === 'string' && (checkLevels as readonly string[]).includes(value)

/**
 * The levels one `checked` event reports. Submitting records the format check with its
 * findings; a later run records an outcome per level.
 */
function checkedLevels(event: ProposalEvent): LevelResult[] {
  const data: Data = event.data
  if (isLevel(data.level)) {
    // Only the format level reports findings: the ones its save returned.
    const findings = Array.isArray(data.findings) ? (data.findings as Finding[]) : []
    const outcome = isOutcome(data.outcome) ? data.outcome : formatOutcome(findings)
    return [
      data.level === 'format'
        ? { level: 'format', outcome, ranAt: event.at, details: { findings } }
        : { level: data.level, outcome, ranAt: event.at, details: {} },
    ]
  }
  const levels = data.levels
  if (typeof levels !== 'object' || levels === null) return []
  return Object.entries(levels).flatMap(([level, outcome]) =>
    isLevel(level) && isOutcome(outcome) ? [{ level, outcome, ranAt: event.at, details: {} }] : [],
  )
}

function checkTone(levels: readonly LevelResult[]): TimelineTone {
  if (levels.some((level) => level.outcome === 'failed')) return 'danger'
  if (levels.some((level) => level.outcome === 'error')) return 'warning'
  if (levels.every((level) => level.outcome === 'passed')) return 'success'
  return 'neutral'
}

const editedNames: Record<string, string> = {
  riskLevel: 'Risk',
  reviewDate: 'Check again by',
  claimLevel: 'Cause',
  ownerId: 'Owner',
  areaId: 'Domain',
}
const editedValues: Record<string, string> = {
  low: 'low',
  normal: 'normal',
  high: 'high',
  fact_only: 'not proven',
  effect_stated: 'stated',
}

/** "Risk: normal to high." for one field of an owner's change during review. */
function editedWords(
  field: string,
  change: unknown,
  nameOf: (id: string) => string | null,
  areaName: (id: string) => string | null = () => null,
): string[] {
  const label = editedNames[field]
  if (!label || typeof change !== 'object' || change === null) return []
  const { before, after } = change as { before?: unknown; after?: unknown }
  const word = (value: unknown) =>
    typeof value !== 'string'
      ? 'none'
      : field === 'ownerId'
        ? (nameOf(value) ?? 'someone')
        : field === 'reviewDate'
          ? formatDay(value)
          : field === 'areaId'
            ? (areaName(value) ?? 'another domain')
            : (editedValues[value] ?? value)
  return [`${label}: ${word(before)} to ${word(after)}.`]
}

/**
 * The timeline, newest first. Autosaves fold into the row that started the draft ("Saved
 * automatically 3 times"), and the checks one submission runs in a row become one "Checks ran"
 * row with every level's outcome. Events of a kind this page does not know are left out.
 */
export function buildActivity(
  events: readonly ProposalEvent[],
  context: ActivityContext,
): ActivityRow[] {
  const { viewerId, nameOf, areaName, proposal } = context
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at))
  const who = (personId: string | null) =>
    personId === null ? undefined : personId === viewerId ? 'You' : (nameOf(personId) ?? 'Someone')
  const saves = ordered.filter((event) => event.kind === 'saved').length
  const rows: ActivityRow[] = []
  let checks: ActivityRow | null = null
  let sentBefore = false

  for (const event of ordered) {
    const data: Data = event.data
    if (event.kind !== 'checked') checks = null
    switch (event.kind) {
      case 'created':
        rows.push({
          id: event.id,
          kind: 'started',
          actor: who(event.actorId),
          action: 'started this draft',
          at: event.at,
          detail: [
            `${channelText[proposal.channel]}.`,
            saves ? `Saved automatically ${saves === 1 ? 'once' : `${saves} times`}.` : null,
          ]
            .filter(Boolean)
            .join(' '),
        })
        break
      case 'submitted':
        rows.push({
          id: event.id,
          kind: 'submitted',
          actor: who(event.actorId),
          action: sentBefore ? 'sent it back for review' : 'sent it for review',
          at: event.at,
        })
        sentBefore = true
        break
      case 'checked': {
        const levels = checkedLevels(event)
        if (!levels.length) break
        if (checks?.checks) {
          // A later level of the same run, or a run again of a level: the newest outcome wins.
          const merged = [
            ...checks.checks.levels.filter(
              (level) => !levels.some((next) => next.level === level.level),
            ),
            ...levels,
          ].sort((a, b) => checkLevels.indexOf(a.level) - checkLevels.indexOf(b.level))
          checks.checks = { required: merged.map((level) => level.level), levels: merged }
          checks.tone = checkTone(merged)
          checks.at = event.at
        } else {
          checks = {
            id: event.id,
            kind: 'checked',
            tone: checkTone(levels),
            action: 'Checks ran',
            at: event.at,
            checks: { required: levels.map((level) => level.level), levels },
          }
          rows.push(checks)
        }
        break
      }
      case 'claimed':
        rows.push({
          id: event.id,
          kind: 'claimed',
          actor: who(event.actorId),
          action: 'claimed this review',
          at: event.at,
        })
        break
      case 'handed_over': {
        const to = text(data.personId)
        rows.push({
          id: event.id,
          kind: 'handed_over',
          actor: who(event.actorId),
          action: to
            ? `handed the review to ${to === viewerId ? 'you' : (nameOf(to) ?? 'another owner')}`
            : 'handed the review over',
          at: event.at,
        })
        break
      }
      case 'edited': {
        const changes =
          typeof data.changes === 'object' && data.changes !== null ? data.changes : {}
        const said = Object.entries(changes as Record<string, unknown>).flatMap(([field, change]) =>
          editedWords(field, change, nameOf, areaName),
        )
        rows.push({
          id: event.id,
          kind: 'edited',
          actor: who(event.actorId),
          action: 'changed the review settings',
          at: event.at,
          detail: [...said, 'Every check ran again.'].join(' '),
          body: text(data.reason) ?? undefined,
        })
        break
      }
      case 'commented':
        rows.push({
          id: event.id,
          kind: 'commented',
          actor: who(event.actorId),
          action: event.actorId === proposal.proposerId ? 'replied' : 'commented',
          at: event.at,
          body: text(data.text) ?? undefined,
        })
        break
      case 'decided': {
        const reason = text(data.reason) ?? undefined
        const edition = text(data.edition)
        if (data.outcome === 'request_changes')
          rows.push({
            id: event.id,
            kind: 'changes_requested',
            actor: who(event.actorId),
            action: `asked for changes${asCapacity(data)}`,
            at: event.at,
            detail: decidedNote(data),
            body: reason,
          })
        else if (data.outcome === 'reject')
          rows.push({
            id: event.id,
            kind: 'rejected',
            actor: who(event.actorId),
            action: `rejected it${asCapacity(data)}`,
            at: event.at,
            detail: decidedNote(data),
            body: reason,
          })
        else if (data.outcome === 'accept' || data.outcome === 'retire')
          rows.push({
            id: event.id,
            kind: 'accepted',
            actor: who(event.actorId),
            action: `accepted it${asCapacity(data)}`,
            at: event.at,
            detail: decidedNote(data, edition ? 'From then on, agents get it.' : null),
            body: reason,
          })
        break
      }
      case 'approved':
        rows.push({
          id: event.id,
          kind: 'approved',
          actor: who(event.actorId),
          action: `accepted it${asCapacity(data)}`,
          at: event.at,
          detail: decidedNote(data, "It's high risk, so an approver gives the second yes."),
          body: text(data.reason) ?? undefined,
        })
        break
      case 'withdrawn':
        rows.push({
          id: event.id,
          kind: 'withdrawn',
          actor: who(event.actorId),
          action: 'withdrew it',
          at: event.at,
          body: text(data.reason) ?? undefined,
        })
        break
      default:
        break
    }
  }
  return rows.reverse()
}

/** The newest decision event of an outcome, with who made it. */
export function latestDecision(
  events: readonly ProposalEvent[],
  outcome: 'request_changes' | 'reject' | 'accept',
) {
  const event = [...events]
    .filter((candidate) => candidate.kind === 'decided' && candidate.data.outcome === outcome)
    .sort((a, b) => b.at.localeCompare(a.at))[0]
  if (!event) return null
  return {
    at: event.at,
    actorId: event.actorId,
    reason: text(event.data.reason),
    edition: text(event.data.edition),
  }
}

/** The proposer's newest reply after a moment, such as a request for changes. */
export function replyAfter(
  events: readonly ProposalEvent[],
  proposerId: string | null,
  at: string,
) {
  const replies = events.flatMap((event) => {
    const said = text(event.data.text)
    return event.kind === 'commented' &&
      event.actorId === proposerId &&
      Date.parse(event.at) > Date.parse(at) &&
      said
      ? [{ at: event.at, text: said }]
      : []
  })
  return replies.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null
}

/** The withdrawal's reason, as the writer gave it. */
export function withdrawal(events: readonly ProposalEvent[]) {
  const event = [...events].reverse().find((candidate) => candidate.kind === 'withdrawn')
  return event ? { at: event.at, reason: text(event.data.reason) } : null
}

export type StepState = 'done' | 'current' | 'attention' | 'failed' | 'waiting'
export type ProposalStep = {
  key: 'submitted' | 'checks' | 'claimed' | 'decision'
  label: string
  state: StepState
  /** When the step happened. */
  at: string | null
  /** The day a decision is due, for the decision step while it waits. */
  due: string | null
}

const step = (
  key: ProposalStep['key'],
  label: string,
  state: StepState,
  at: string | null = null,
  due: string | null = null,
): ProposalStep => ({ key, label, state, at, due })

/**
 * Where a proposal stands, in four steps (frame B, 1): submitted, checks, claimed, decision. The
 * steps read the latest round: after changes are asked for and the writer sends it again, they
 * start over from that submission. The gate, when the review has one, has the checks' last word.
 */
export function proposalSteps(
  proposal: Pick<ProposalRecord, 'state' | 'claimedBy' | 'dueAt'>,
  events: readonly ProposalEvent[],
  gate: Pick<Gate, 'levels'> | null,
  { viewerId, nameOf }: Pick<ActivityContext, 'viewerId' | 'nameOf'>,
): ProposalStep[] {
  const ordered = [...events].sort((a, b) => a.at.localeCompare(b.at))
  const submits = ordered.filter((event) => event.kind === 'submitted')
  const submitted = submits.at(-1)
  const round = submitted ? ordered.slice(ordered.indexOf(submitted)) : []
  const last = (kind: string) => round.findLast((event) => event.kind === kind)
  const draft = proposal.state === 'draft'

  const first = submitted
    ? step('submitted', submits.length > 1 ? 'Sent again' : 'Sent for review', 'done', submitted.at)
    : step('submitted', draft ? 'Not sent yet' : 'Sent for review', draft ? 'current' : 'waiting')

  const checked = round.filter((event) => event.kind === 'checked')
  const ranAt = checked.at(-1)?.at ?? null
  // A decided proposal shows the checks as they stood when it was decided: the gate checks it
  // again on every new edition, its own acceptance included, which is not a step it still waits for.
  const closed = ['accepted', 'rejected', 'withdrawn'].includes(proposal.state)
  const outcomes = (
    gate?.levels.length && !closed ? gate.levels : checked.flatMap((event) => checkedLevels(event))
  ).map((level) => level.outcome)
  const checks = !submitted
    ? step('checks', 'Checks', 'waiting')
    : outcomes.includes('failed')
      ? step('checks', 'A check failed', 'failed', ranAt)
      : outcomes.includes('error')
        ? step('checks', "A check couldn't finish", 'attention', ranAt)
        : outcomes.length && outcomes.every((outcome) => outcome === 'passed')
          ? step('checks', 'Checks passed', 'done', ranAt)
          : step('checks', 'Checks running', 'current')

  const claim = round.findLast((event) => event.kind === 'claimed' || event.kind === 'handed_over')
  const claimer =
    proposal.claimedBy ?? (claim ? (text(claim.data.personId) ?? claim.actorId) : null)
  const reviewer = (id: string) => (id === viewerId ? 'you' : (nameOf(id) ?? 'an owner'))
  const decided = last('decided')
  const claimed =
    claim && claimer
      ? step('claimed', `Claimed by ${reviewer(claimer)}`, 'done', claim.at)
      : decided?.actorId
        ? // Decided without claiming it first: the reviewer took it up as they decided.
          step('claimed', `Reviewed by ${reviewer(decided.actorId)}`, 'done', decided.at)
        : proposal.state === 'submitted'
          ? step('claimed', 'Waiting for an owner', 'current')
          : step('claimed', 'Claimed', 'waiting')

  const decidedAt = decided?.at ?? null
  const approved = last('approved')
  const decision =
    proposal.state === 'changes_requested'
      ? step('decision', 'Changes requested', 'attention', decidedAt)
      : proposal.state === 'accepted'
        ? step('decision', 'Accepted', 'done', decidedAt)
        : proposal.state === 'rejected'
          ? step('decision', 'Rejected', 'failed', decidedAt)
          : proposal.state === 'withdrawn'
            ? step(
                'decision',
                'Withdrawn',
                'done',
                ordered.findLast((event) => event.kind === 'withdrawn')?.at ?? null,
              )
            : approved
              ? step('decision', 'Waiting for an approver', 'current', approved.at)
              : step(
                  'decision',
                  'Decision',
                  proposal.state === 'in_review' ? 'current' : 'waiting',
                  null,
                  submitted && proposal.dueAt ? proposal.dueAt.slice(0, 10) : null,
                )
  return [first, checks, claimed, decision]
}

/**
 * What a person is in a proposal's discussion, beside their name. Besides the proposer and the
 * domain's owners, only an approver of the domain or an administrator may comment
 * (proposals.comment); the area does not say which, so the badge says what they do.
 */
export type DiscussionRole = 'proposer' | 'owner' | 'reviewer'

export const discussionRoleNames: Record<DiscussionRole, string> = {
  proposer: 'Proposer',
  owner: 'Owner',
  reviewer: 'Reviewing',
}

/** One comment of the discussion, oldest first. */
export type DiscussionComment = {
  id: string
  at: string
  actorId: string | null
  role: DiscussionRole
  text: string
  /** The comment came with a request for changes. */
  withRequest: boolean
}

/**
 * A proposal's discussion: its comments in the order they were written, each with the role of
 * whoever wrote it, and whether it came with a request for changes. The rest of the events are
 * the history's.
 */
export function discussionOf(
  events: readonly ProposalEvent[],
  context: {
    proposerId: string | null
    area: { ownerIds: readonly string[] } | null
  },
): DiscussionComment[] {
  const role = (actorId: string | null): DiscussionRole =>
    actorId === context.proposerId
      ? 'proposer'
      : actorId !== null && context.area?.ownerIds.includes(actorId)
        ? 'owner'
        : 'reviewer'
  return events
    .flatMap((event): DiscussionComment[] => {
      const said = event.kind === 'commented' ? text(event.data.text) : null
      return said
        ? [
            {
              id: event.id,
              at: event.at,
              actorId: event.actorId,
              role: role(event.actorId),
              text: said,
              withRequest: typeof event.data.decisionId === 'string',
            },
          ]
        : []
    })
    .sort((a, b) => a.at.localeCompare(b.at))
}

/**
 * The history beside a discussion: a comment is one line there ("Jon Abara commented"), its
 * words are in the discussion.
 */
export function historyRows(rows: readonly ActivityRow[]): ActivityRow[] {
  return rows.map((row) =>
    row.kind === 'commented' ? { ...row, body: undefined, detail: 'In the discussion.' } : row,
  )
}
