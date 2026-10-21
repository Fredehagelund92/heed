import type { Area, ClaimLevel, ItemKind, RiskLevel } from '@domain/item'
import type { ProposalState } from '@domain/proposal-state'
import type {
  Gate,
  LibraryItem,
  Permissions,
  ProposalRecord,
  QueueEntry as QueueProposal,
  Review,
  ReviewEditInput,
  ReviewProposal,
} from '@/api'
import { queryTerms, daysFrom } from '@/lib/library'
import { readGate, checkLevelNames, type CheckReading } from '@/lib/gate'
import { capacitiesIn, isAdmin, type Capacity, type ListedProposal } from '@/lib/permissions'
import type { ProposalsSearch } from '@/lib/search-params'

/*
  The review side of the Proposals page and of a single proposal (front end plan, frames C1 to C3,
  slice W5), pure so the screens, their stories and their tests agree:

  - the To review queue's rows, groups and filters,
  - which mode a proposal opens in for the person,
  - the decision bar's state and why a decision is blocked (never hidden, contract 9.4),
  - the owner's edits during review (FR-105, FR-106, FR-123, FR-324).

  The service checks every rule again and its answer wins; these decide what a screen offers.
*/

// ---- the queue ----

/** What a proposal does, the Change column's word. */
export type ChangeType = 'create' | 'change' | 'retire' | 'recheck' | 'term'

export const changeTypeNames: Record<ChangeType, string> = {
  create: 'New',
  change: 'Change',
  retire: 'Archive',
  recheck: 'Check',
  term: 'Name',
}

/** The header badge's words: "Change to a fact", "New fact", "Archive a fact". */
export const changeTypeLong: Record<ChangeType, string> = {
  create: 'New fact',
  change: 'Change to a fact',
  retire: 'Archive a fact',
  recheck: 'Checked, still correct',
  term: 'Name',
}

export function changeTypeOf(proposal: Pick<ReviewProposal, 'subject' | 'action'>): ChangeType {
  return proposal.subject === 'vocabulary' ? 'term' : proposal.action
}

/** Who holds the proposal, for the queue's filter: the person, someone else, or nobody yet. */
export const claimFilters = ['me', 'others', 'nobody'] as const
export type ClaimFilter = (typeof claimFilters)[number]

export const claimFilterNames: Record<ClaimFilter, string> = {
  me: 'You',
  others: 'Someone else',
  nobody: 'Nobody yet',
}

export type QueueRow = {
  id: string
  number: number
  title: string
  /** The kind of context, when the proposal is about an item. */
  kind: ItemKind | null
  change: ChangeType
  state: ProposalState
  areaId: string | null
  areaName: string
  areaLabel: Area['label']
  riskLevel: RiskLevel | null
  claimedBy: string | null
  claimedByName: string | null
  proposerId: string
  proposerName: string
  /** The day a decision is due. */
  dueOn: string | null
  submittedAt: string | null
  /** The revision the queue read, which a bulk step decides on (FR-223). */
  revision: number
  /** The required checks at a glance: failed and not yet passed. Null for a term or a retirement. */
  checks: QueueProposal['checks']
}

export type QueueContext = {
  areas: readonly Area[]
  people: readonly { id: string; name: string }[]
  /** Item proposals the person may read, for their kind of context (the queue has none: G2). */
  proposals: readonly (Pick<ProposalRecord, 'id' | 'draft'> &
    Partial<Pick<ProposalRecord, 'provenance'>>)[]
  /** The library, for the kind of an item a retirement or a re-check is about. */
  items: readonly Pick<LibraryItem, 'id' | 'kind'>[]
}

export function toQueueRow(
  proposal: ReviewProposal & { checks?: QueueProposal['checks'] },
  context: QueueContext,
): QueueRow {
  const area = context.areas.find((candidate) => candidate.id === proposal.areaId)
  const nameOf = (id: string | null) =>
    id ? (context.people.find((person) => person.id === id)?.name ?? null) : null
  const record = context.proposals.find((candidate) => candidate.id === proposal.id)
  const kind =
    record?.draft.kind ?? context.items.find((item) => item.id === proposal.itemId)?.kind ?? null
  return {
    id: proposal.id,
    number: proposal.number,
    title: proposal.title.trim() || 'Untitled proposal',
    kind: proposal.subject === 'vocabulary' ? null : (kind ?? 'note'),
    change: changeTypeOf(proposal),
    state: proposal.state,
    areaId: proposal.areaId,
    areaName: area?.name ?? (proposal.areaId ? 'Unknown domain' : 'No domain'),
    areaLabel: area?.label ?? 'gray',
    riskLevel: proposal.riskLevel,
    claimedBy: proposal.claimedBy,
    claimedByName: nameOf(proposal.claimedBy),
    proposerId: proposal.proposerId,
    proposerName: nameOf(proposal.proposerId) ?? 'Someone',
    dueOn: proposal.dueAt ? proposal.dueAt.slice(0, 10) : null,
    submittedAt: proposal.submittedAt,
    revision: proposal.revision,
    checks: proposal.checks ?? null,
  }
}

/**
 * One of the person's own proposals (Mine) as a queue row, so a bulk step can decide it from
 * there when the person may (`canDecideInList`). Its checks are read by the step's plan.
 */
export function recordQueueRow(record: ProposalRecord, context: QueueContext): QueueRow {
  return toQueueRow(
    {
      ...record,
      termKey: record.vocabulary?.key ?? null,
      riskLevel: record.draft.riskLevel ?? null,
      submittedAt: null,
      closedAt: null,
    },
    { ...context, proposals: [record] },
  )
}

/** A queue row as `canDecideInList` reads it. */
export function listedOf(row: QueueRow): ListedProposal {
  return {
    subject: row.change === 'term' ? 'vocabulary' : 'item',
    areaId: row.areaId,
    proposerId: row.proposerId,
    state: row.state,
    riskLevel: row.riskLevel,
  }
}

/** "Change #228": what the proposal does, and its number. */
export function queueChangeLabel(row: Pick<QueueRow, 'change' | 'number'>): string {
  return `${changeTypeNames[row.change]} #${row.number}`
}

const riskRank: Record<RiskLevel | 'none', number> = { high: 0, normal: 1, low: 2, none: 3 }

/**
 * The queue's search and filters (domain, risk, who holds it), in the queue's own order: highest
 * risk first, then the one that has waited longest (FR-208).
 */
export function visibleQueueRows(
  rows: readonly QueueRow[],
  search: Pick<ProposalsSearch, 'q' | 'area' | 'risk' | 'claimed'>,
  viewerId: string,
): QueueRow[] {
  const terms = queryTerms(search.q)
  return rows
    .filter(
      (row) =>
        (search.area === undefined || row.areaId === search.area) &&
        (search.risk === undefined || row.riskLevel === search.risk) &&
        (search.claimed === undefined ||
          (search.claimed === 'me'
            ? row.claimedBy === viewerId
            : search.claimed === 'nobody'
              ? row.claimedBy === null
              : row.claimedBy !== null && row.claimedBy !== viewerId)) &&
        terms.every(
          (term) =>
            row.title.toLowerCase().includes(term) ||
            row.proposerName.toLowerCase().includes(term) ||
            `#${row.number}` === term ||
            String(row.number) === term,
        ),
    )
    .sort(
      (a, b) =>
        riskRank[a.riskLevel ?? 'none'] - riskRank[b.riskLevel ?? 'none'] ||
        (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') ||
        a.number - b.number,
    )
}

export type QueueGroup = {
  type: 'group'
  areaId: string | null
  name: string
  label: Area['label']
  count: number
}
export type QueueEntry = QueueGroup | { type: 'row'; row: QueueRow }

/** A group row per domain (the Domain column is dropped), domains A to Z, rows in queue order. */
export function groupQueueRows(rows: readonly QueueRow[]): QueueEntry[] {
  const domains = [...new Map(rows.map((row) => [row.areaId, row])).values()].sort((a, b) =>
    a.areaName.localeCompare(b.areaName, 'en'),
  )
  return domains.flatMap((domain) => {
    const inDomain = rows.filter((row) => row.areaId === domain.areaId)
    return [
      {
        type: 'group' as const,
        areaId: domain.areaId,
        name: domain.areaName,
        label: domain.areaLabel,
        count: inDomain.length,
      },
      ...inDomain.map((row) => ({ type: 'row' as const, row })),
    ]
  })
}

/** The queue's totals: how many, how many high risk, how many overdue. */
export function queueTotals(rows: readonly QueueRow[], today: string | null) {
  return {
    count: rows.length,
    high: rows.filter((row) => row.riskLevel === 'high').length,
    overdue: rows.filter(
      (row) => row.dueOn !== null && today !== null && daysFrom(today, row.dueOn) < 0,
    ).length,
  }
}

/** How many filters of the queue are on, for the filter button's count. */
export function queueFilterCount(search: Pick<ProposalsSearch, 'area' | 'risk' | 'claimed'>) {
  return (search.area ? 1 : 0) + (search.risk ? 1 : 0) + (search.claimed ? 1 : 0)
}

export { reviewsAnything } from '@/lib/permissions'

// ---- which mode a proposal opens in ----

export const underReview = (state: ProposalState) => state === 'submitted' || state === 'in_review'

/**
 * A proposal opens in review mode for a person who may decide it while it waits for a decision:
 * an owner or approver of its domain, or an administrator, in any domain and their own
 * proposals too (FR-202, FR-206). Everyone else, the writer included when they hold no role
 * there, gets the status page.
 */
export function opensInReview(
  proposal: Pick<ReviewProposal, 'state' | 'areaId' | 'subject'>,
  permissions: Permissions,
): boolean {
  if (!underReview(proposal.state)) return false
  return capacitiesIn(permissions, proposal.areaId).length > 0 || isAdmin(permissions)
}

// ---- the decision bar ----

export type DecisionOutcome = 'accept' | 'request_changes' | 'reject'

/** One of the three buttons: offered and allowed, offered but blocked with a reason, or absent. */
export type OutcomeState =
  | { allowed: true; label: string }
  /** `saving`: this is the decision the person made, on its way to the service. */
  | { allowed: false; label: string; title: string; reason: string; saving?: true }
  | null

export type DecisionState =
  | 'ready'
  | 'checks'
  | 'proposer'
  | 'claimed'
  | 'approver_next'
  | 'owner_next'
  | 'approver'
  | 'approved'
  | 'no_role'
  | 'closed'
  | 'saving'

export type DecisionBar = {
  state: DecisionState
  /** The bar's first line: "Your decision, as owner of Commercial". */
  heading: string
  /** One or two plain sentences under it. */
  detail: string
  /** The capacity the decision is made in, when the person may decide. */
  capacity: Capacity | 'administrator' | null
  outcomes: Record<DecisionOutcome, OutcomeState>
}

export type DecisionContext = {
  viewerId: string
  permissions: Permissions
  area: Area | undefined
  nameOf: (id: string) => string | null
}

/**
 * The first accept: an owner's of the domain or an administrator's (FR-202). An accept made as
 * deputy, before the role went, counts as an owner's.
 */
const ownerCapacities = ['owner', 'deputy', 'administrator']

const capacityNames: Record<Capacity | 'administrator', string> = {
  owner: 'owner',
  approver: 'high-risk approver',
  administrator: 'admin',
}

const firstName = (name: string) => name.split(' ')[0] ?? name

/** "09:41", the time of day of a decision (UTC, as every time on screen). */
export function timeOfDay(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

/** The first required level that has not passed, read in plain words. */
export function firstOpenCheck(gate: Pick<Gate, 'required' | 'levels'> | null) {
  if (!gate) return null
  return readGate(gate).find((reading) => reading.state !== 'passed') ?? null
}

/** Why Accept waits for a check, in one or two sentences: "The check “Complete” failed. …". */
export function checkBlockReason(reading: CheckReading): string {
  const check = `The check “${checkLevelNames[reading.level]}”`
  switch (reading.state) {
    case 'running':
      return `${check} is still running. You can accept once it passes.`
    case 'failed':
      return `${check} failed. Ask for changes, or run the checks again once it's fixed.`
    case 'error':
      return `${check} couldn't finish. Run the checks again.`
    default:
      return `${check} hasn't run yet. Run the checks again.`
  }
}

/** The newest accept on the proposal, by the people who give the given approvals. */
function latestAccept(decisions: Review['decisions'], capacities: readonly string[]) {
  return decisions
    .filter((decision) => decision.outcome === 'accept' && capacities.includes(decision.capacity))
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))[0]
}

const blocked = (label: string, title: string, reason: string): OutcomeState => ({
  allowed: false,
  label,
  title,
  reason,
})
const allowed = (label: string): OutcomeState => ({ allowed: true, label })

/** The decision being saved, in the words of the bar: "Accepting". */
const savingWords: Record<DecisionOutcome, string> = {
  accept: 'Accepting',
  request_changes: 'Asking for changes',
  reject: 'Rejecting',
}

/**
 * The bar while the person's decision is on its way (lib/deciding.ts): the decision they made,
 * busy, and nothing else to choose, so a proposal is never decided twice from a screen that has
 * not caught up. If the service refuses, the bar is back as it was and a message says why.
 */
export function savingBar(outcome: DecisionOutcome, change: ChangeType): DecisionBar {
  const words = outcome === 'accept' && change === 'retire' ? 'Archiving' : savingWords[outcome]
  return {
    state: 'saving',
    heading: words,
    detail: "We're saving your decision. You can go on to the next proposal.",
    capacity: null,
    outcomes: {
      accept: null,
      request_changes: null,
      reject: null,
      [outcome]: {
        allowed: false,
        label: words,
        title: 'Saving your decision',
        reason: "We're saving your decision. It shows here in a moment.",
        saving: true,
      },
    },
  }
}

/**
 * The decision bar for one person and one proposal (frame C3): which decisions it offers, which
 * are blocked and why, and the two lines beside them. A blocked decision stays visible with its
 * reason. Mirrors the service's rules (review/service.ts): FR-202, FR-206, FR-207 and FR-211.
 */
export function decisionBar(
  review: Pick<Review, 'proposal' | 'gate' | 'decisions'>,
  { viewerId, permissions, area, nameOf }: DecisionContext,
): DecisionBar {
  const { proposal, gate, decisions } = review
  const areaName = area?.name ?? 'this domain'
  const change = changeTypeOf(proposal)
  // A retirement and a term are accepted or rejected; only an item version can go back for changes.
  const asks = change !== 'retire' && change !== 'term'
  const acceptWord = change === 'retire' ? 'Archive' : 'Accept'
  const all = (title: string, reason: string) => ({
    accept: blocked(acceptWord, title, reason),
    request_changes: asks ? blocked('Ask for changes', title, reason) : null,
    reject: blocked('Reject', title, reason),
  })

  if (!underReview(proposal.state))
    return {
      state: 'closed',
      heading: 'This proposal is decided',
      detail: 'Someone already made the decision.',
      capacity: null,
      outcomes: all('Decided', 'This proposal is already decided.'),
    }

  const capacities = capacitiesIn(permissions, proposal.areaId)
  // An owner of the domain, or an administrator in any domain, decides: their own proposals too
  // (FR-202, FR-206). An approver who is neither adds the high-risk accept only.
  const decider =
    capacities.find((capacity) => capacity !== 'approver') ??
    (isAdmin(permissions) ? 'administrator' : undefined)
  const approverOnly = !decider && capacities.includes('approver')
  const proposer = proposal.proposerId === viewerId
  const reading = firstOpenCheck(gate)
  const ownNote = proposer ? ' You can decide your own proposal.' : ''

  // A vocabulary term: an owner of its domain, or an administrator, accepts or rejects.
  if (change === 'term') {
    const capacity = decider ?? null
    if (!capacity)
      return {
        state: 'no_role',
        heading: `Only an owner of ${areaName} or an admin decides`,
        detail: 'You can read this proposal.',
        capacity: null,
        outcomes: all(
          "You can't decide this",
          `An owner of ${areaName}, or an admin, decides the names we know.`,
        ),
      }
    return {
      state: 'ready',
      heading: `Your decision, as ${capacityNames[capacity]}${capacity === 'administrator' ? '' : ` of ${areaName}`}`,
      detail: `Once you accept, people and agents can use the name.${ownNote}`,
      capacity,
      outcomes: { accept: allowed('Accept'), request_changes: null, reject: allowed('Reject') },
    }
  }

  if (!decider && !approverOnly)
    return {
      state: 'no_role',
      heading: `Only an owner or approver of ${areaName}, or an admin, decides`,
      detail: 'You can read this proposal and its checks.',
      capacity: null,
      outcomes: all(
        "You can't decide this",
        `Only an owner or high-risk approver of ${areaName}, or an admin, decides.`,
      ),
    }

  // The high-risk approver adds the second accept to a high-risk proposal, and nothing else.
  if (approverOnly) {
    const onlyAccept = (outcome: OutcomeState) => ({
      accept: outcome,
      request_changes: null,
      reject: null,
    })
    if (proposal.riskLevel !== 'high')
      return {
        state: 'no_role',
        heading: 'No approver is needed',
        detail: 'Only a high-risk proposal needs the second yes of an approver.',
        capacity: null,
        outcomes: onlyAccept(
          blocked(
            'Accept as approver',
            'No approver is needed',
            'Only a high-risk proposal needs the second yes of an approver.',
          ),
        ),
      }
    if (proposer)
      return {
        state: 'proposer',
        heading: 'Someone else must decide',
        detail: 'You wrote this proposal, so another approver gives the second yes.',
        capacity: 'approver',
        outcomes: onlyAccept(
          blocked(
            'Accept as approver',
            'You wrote this proposal',
            'Someone else must accept a proposal you wrote.',
          ),
        ),
      }
    const approval = latestAccept(decisions, ['approver'])
    if (gate?.approvals.approver)
      return {
        state: 'approved',
        heading:
          approval?.decidedBy === viewerId
            ? `You accepted at ${timeOfDay(approval.decidedAt)}`
            : 'The approver has accepted',
        detail: gate.approvals.owner
          ? 'The owner and the approver both accepted.'
          : 'Agents get it once an owner or an admin accepts too.',
        capacity: 'approver',
        outcomes: onlyAccept(
          blocked(
            approval?.decidedBy === viewerId ? 'Accepted by you' : 'Accepted',
            'Already accepted',
            'The approver has accepted this version.',
          ),
        ),
      }
    if (reading)
      return {
        state: 'checks',
        heading: "You can't accept yet",
        detail: checkBlockReason(reading),
        capacity: 'approver',
        outcomes: onlyAccept(
          blocked('Accept as approver', "You can't accept yet", checkBlockReason(reading)),
        ),
      }
    const owner = latestAccept(decisions, ownerCapacities)
    return {
      state: 'approver',
      heading: 'Give the second yes',
      detail:
        gate?.approvals.owner && owner
          ? `${nameOf(owner.decidedBy) ?? 'The owner'} accepted at ${timeOfDay(owner.decidedAt)}. As approver, you can only accept.`
          : 'No owner or admin has accepted yet. We save your yes now, and agents get it once one of them accepts too.',
      capacity: 'approver',
      outcomes: onlyAccept(allowed('Accept as approver')),
    }
  }

  // An owner of the domain, or an administrator (`decider` is set from here on).
  const capacity = decider!
  if (proposal.claimedBy && proposal.claimedBy !== viewerId) {
    const name = nameOf(proposal.claimedBy) ?? 'Another owner'
    return {
      state: 'claimed',
      heading: `${name} is reviewing this`,
      detail: `Ask ${firstName(name)} to hand it over, or wait.`,
      capacity,
      outcomes: all(
        `${firstName(name)} is reviewing this`,
        `${name} claimed this proposal. Ask ${firstName(name)} to hand it over, or wait.`,
      ),
    }
  }

  const ownerAccept = latestAccept(decisions, ownerCapacities)
  if (gate?.approvals.owner && gate.approvals.approver === false) {
    const mine = ownerAccept?.decidedBy === viewerId
    const who = ownerAccept
      ? mine
        ? `You accepted at ${timeOfDay(ownerAccept.decidedAt)}`
        : `${nameOf(ownerAccept.decidedBy) ?? 'The other owner'} accepted at ${timeOfDay(ownerAccept.decidedAt)}`
      : 'Accepted'
    const reason = 'This version is accepted and waits for the high-risk approver.'
    return {
      state: 'approver_next',
      heading: `${who}. Waiting for the approver`,
      detail: "We've told the high-risk approver. Agents get it once they accept too.",
      capacity,
      outcomes: {
        accept: blocked(mine ? 'Accepted by you' : 'Accepted', 'Already accepted', reason),
        request_changes: asks
          ? blocked('Ask for changes', 'Waiting for the approver', reason)
          : null,
        reject: blocked('Reject', 'Waiting for the approver', reason),
      },
    }
  }

  if (reading)
    return {
      state: 'checks',
      heading: "You can't accept yet",
      detail: checkBlockReason(reading),
      capacity,
      outcomes: {
        accept: blocked(acceptWord, "You can't accept yet", checkBlockReason(reading)),
        request_changes: asks ? allowed('Ask for changes') : null,
        reject: allowed('Reject'),
      },
    }

  const approverWaits = proposal.riskLevel === 'high' && gate?.approvals.approver === false
  return {
    state: 'ready',
    heading: `Your decision, as ${capacityNames[capacity]}${capacity === 'administrator' ? '' : ` of ${areaName}`}`,
    detail:
      change === 'retire'
        ? `Archiving takes effect at once, and agents stop getting the fact.${ownNote}`
        : approverWaits
          ? `All required checks passed. High risk: the approver accepts after you.${ownNote}`
          : `All required checks passed.${ownNote}`,
    capacity,
    outcomes: {
      accept: allowed(acceptWord),
      request_changes: asks ? allowed('Ask for changes') : null,
      reject: allowed('Reject'),
    },
  }
}

/** A decision the bar offers and allows, so its key opens its dialog (a, r, Shift r). */
export function canOpen(bar: DecisionBar, outcome: DecisionOutcome): boolean {
  return bar.outcomes[outcome]?.allowed === true
}

// ---- the owner's edits during review ----

/** What an owner may change around the content (FR-105, FR-106, FR-123, FR-324). */
export type OwnerFields = {
  riskLevel: RiskLevel
  /** The day an owner checks it again; null only for an item that ends. */
  reviewDate: string | null
  claimLevel: ClaimLevel
  claimAuthority: string
  claimQuote: string
  areaId: string
  ownerId: string
}

/** The fields as the proposal holds them now, from its draft with the service's defaults. */
export function ownerFieldsOf(
  draft: ProposalRecord['draft'],
  proposal: Pick<ReviewProposal, 'riskLevel' | 'areaId'>,
  area: Area | undefined,
): OwnerFields {
  return {
    riskLevel: draft.riskLevel ?? proposal.riskLevel ?? 'normal',
    reviewDate: draft.reviewDate ?? null,
    claimLevel: draft.claimLevel ?? 'fact_only',
    claimAuthority: draft.claimAuthority ?? '',
    claimQuote: draft.claimQuote ?? '',
    areaId: draft.areaId ?? proposal.areaId ?? '',
    ownerId: draft.ownerId ?? area?.ownerIds[0] ?? '',
  }
}

/** The fields that change between what the proposal holds and what the owner chose. */
export function changedOwnerFields(current: OwnerFields, next: OwnerFields): (keyof OwnerFields)[] {
  const claimChanged =
    current.claimLevel !== next.claimLevel ||
    (next.claimLevel === 'effect_stated' &&
      (current.claimAuthority.trim() !== next.claimAuthority.trim() ||
        current.claimQuote.trim() !== next.claimQuote.trim()))
  return (Object.keys(current) as (keyof OwnerFields)[]).filter((field) => {
    if (field === 'claimLevel') return claimChanged
    if (field === 'claimAuthority' || field === 'claimQuote') return false
    return current[field] !== next[field]
  })
}

/**
 * The change as review.edit takes it: the fields that change, nothing else, so a field another
 * owner changed meanwhile is not set back. Null when nothing changes.
 */
export function reviewEditInput(
  { id, revision }: { id: string; revision: number },
  current: OwnerFields,
  next: OwnerFields,
  reason: string,
): ReviewEditInput | null {
  const changed = changedOwnerFields(current, next)
  if (!changed.length) return null
  return {
    id,
    revision,
    ...(changed.includes('riskLevel') ? { riskLevel: next.riskLevel } : {}),
    ...(changed.includes('reviewDate') ? { reviewDate: next.reviewDate } : {}),
    ...(changed.includes('claimLevel')
      ? {
          claim:
            next.claimLevel === 'effect_stated'
              ? {
                  level: 'effect_stated' as const,
                  authority: next.claimAuthority.trim(),
                  quote: next.claimQuote.trim(),
                }
              : { level: 'fact_only' as const },
        }
      : {}),
    ...(changed.includes('areaId') ? { areaId: next.areaId } : {}),
    ...(changed.includes('ownerId') ? { ownerId: next.ownerId } : {}),
    ...(reason.trim() ? { reason: reason.trim() } : {}),
  }
}

/** What an owner must fix before the change can be sent, by field. */
export function ownerFieldProblems(
  next: OwnerFields,
  { ends }: { ends: boolean },
): Partial<Record<keyof OwnerFields, string>> {
  const problems: Partial<Record<keyof OwnerFields, string>> = {}
  if (!ends && !next.reviewDate)
    problems.reviewDate = 'It has no end date, so it needs a day to check it again.'
  if (next.claimLevel === 'effect_stated') {
    if (!next.claimAuthority.trim()) problems.claimAuthority = 'Name who states the effect.'
    else if ([...next.claimAuthority.trim()].length > 200)
      problems.claimAuthority = 'Keep it to 200 characters.'
    if (!next.claimQuote.trim()) problems.claimQuote = 'Quote what they said.'
    else if ([...next.claimQuote.trim()].length > 500)
      problems.claimQuote = 'Keep it to 500 characters.'
  }
  if (!next.ownerId) problems.ownerId = 'Choose who reviews it.'
  return problems
}

/**
 * What the change will do, in plain sentences, for the confirmation: every check runs again on
 * the changed version, and a raise to high risk needs the whole-domain tests and the approver.
 */
export function ownerEditEffects(
  current: OwnerFields,
  next: OwnerFields,
  { areaName, ownerName }: { areaName: (id: string) => string; ownerName: string | null },
): string[] {
  const changed = changedOwnerFields(current, next)
  if (!changed.length) return []
  const effects = ['It becomes a new version of the proposal, and every check runs again on it.']
  if (changed.includes('riskLevel') && next.riskLevel === 'high')
    effects.push(
      'High risk needs all five checks, the answer tests on the whole domain included, and the high-risk approver.',
    )
  else if (changed.includes('riskLevel') && current.riskLevel === 'high')
    effects.push('It no longer needs the whole-domain answer tests or the approver.')
  if (changed.includes('areaId'))
    effects.push(
      `It moves to ${areaName(next.areaId)}${ownerName ? `, and ${ownerName} reviews it` : ''}.`,
    )
  else if (changed.includes('ownerId') && ownerName)
    effects.push(`${ownerName} reviews it from now on.`)
  effects.push('Earlier accepts stay with the version they were given on.')
  return effects
}

/** The people who may review a proposal in a domain: its owners. */
export function reviewersOf(area: Area | undefined): string[] {
  return [...(area?.ownerIds ?? [])]
}
