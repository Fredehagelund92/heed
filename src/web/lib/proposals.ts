import type { Area, ItemKind, RiskLevel } from '@domain/item'
import type { ProposalState } from '@domain/proposal-state'
import type { Provenance } from '@domain/provenance'
import type { ProposalRecord } from '@/api'
import { queryTerms } from '@/lib/library'
import { isUnsubmittedDraft } from '@/lib/my-drafts'
import type { ProposalsSearch } from '@/lib/search-params'

/*
  The Proposals page's row model (front end plan, screen 2 and slice W4): one pure pipeline from
  the person's proposals to the rows on screen, and what the writer may do with one proposal in
  each state. The page, its tests and the status page all read it, so they agree.

    records -> rows (names resolved) -> filters -> search -> groups
*/

/** A proposal state's name on a badge, a filter and a status line. */
export const proposalStateNames: Record<ProposalState, string> = {
  draft: 'Draft',
  submitted: 'Waiting for review',
  in_review: 'In review',
  changes_requested: 'Changes requested',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

/**
 * The views of the Proposals page: To review (the queue of an owner, deputy or approver, slice
 * W5) and Mine. Source checks mounts here with the release slice, so the address already names it.
 */
export const proposalViews = [
  { id: 'review', title: 'To review' },
  { id: 'mine', title: 'Mine' },
] as const
export type ProposalViewId = (typeof proposalViews)[number]['id']

/** The views a person sees: To review only for someone who reviews a domain. */
export function proposalViewsFor(reviews: boolean) {
  return proposalViews.filter((view) => reviews || view.id !== 'review')
}

/**
 * The view a search opens: the one it names when the person has it, else To review for someone
 * who reviews, Mine for everyone else.
 */
export function proposalViewOf(
  search: Pick<ProposalsSearch, 'view'>,
  { reviews }: { reviews: boolean } = { reviews: false },
): ProposalViewId {
  if (search.view === 'mine') return 'mine'
  return reviews ? 'review' : 'mine'
}

export const openProposalStates: readonly ProposalState[] = [
  'draft',
  'submitted',
  'in_review',
  'changes_requested',
]

/**
 * Where a proposal stands for its writer, the groups of the Mine view in order: the drafts never
 * sent come first and apart, so they are not mixed with the proposals an owner already has.
 */
export const proposalStages = ['draft', 'yours', 'reviewing', 'closed'] as const
export type ProposalStage = (typeof proposalStages)[number]

export const proposalStageNames: Record<ProposalStage, string> = {
  draft: 'Draft, not sent',
  yours: 'Needs you',
  reviewing: 'With the owner',
  closed: 'Closed',
}

export function stageOf(state: ProposalState): ProposalStage {
  if (isUnsubmittedDraft({ state })) return 'draft'
  if (state === 'changes_requested') return 'yours'
  if (state === 'submitted' || state === 'in_review') return 'reviewing'
  return 'closed'
}

export type ProposalRow = {
  id: string
  number: number
  title: string
  kind: ItemKind
  /** A vocabulary proposal's kind of term; null for an item. */
  term: 'metric' | 'dimension' | null
  /** The action the proposal asks its reviewer to take. */
  change: ProposalRecord['action']
  state: ProposalState
  stage: ProposalStage
  areaId: string
  areaName: string
  areaLabel: Area['label']
  riskLevel: RiskLevel | null
  /** The day a decision is due, while the proposal waits for one. */
  dueOn: string | null
  updatedAt: string
  /** An AI app or the assistant drafted it with the person: a quiet mark on the row (6.13). */
  drafted: Provenance['by'] | null
}

/** The words of a proposal's title when the writer has not said what happened yet. */
export const UNTITLED = 'Untitled draft'

export function proposalTitle(
  proposal: Pick<ProposalRecord, 'draft'> & { title?: string },
): string {
  return proposal.draft.title?.trim() || proposal.title?.trim() || UNTITLED
}

/** A term's kind as the catalogue groups it: a group is with the metrics, a value with its dimension. */
const termKindOf = (record: ProposalRecord): ProposalRow['term'] =>
  record.subject !== 'vocabulary'
    ? null
    : record.vocabulary?.kind === 'dimension' || record.vocabulary?.kind === 'dimension_value'
      ? 'dimension'
      : 'metric'

export function toProposalRow(proposal: ProposalRecord, areas: readonly Area[]): ProposalRow {
  const area = areas.find((candidate) => candidate.id === proposal.areaId)
  const waiting = proposal.state === 'submitted' || proposal.state === 'in_review'
  return {
    id: proposal.id,
    number: proposal.number,
    title: proposalTitle(proposal),
    kind: proposal.draft.kind ?? 'note',
    term: termKindOf(proposal),
    change: proposal.action,
    state: proposal.state,
    stage: stageOf(proposal.state),
    areaId: proposal.areaId ?? '',
    // Only a deleted domain is missing from the list of domains (FR-814).
    areaName: area?.name ?? (proposal.areaId === null ? 'No domain' : 'Domain deleted'),
    areaLabel: area?.label ?? 'gray',
    riskLevel: proposal.draft.riskLevel ?? null,
    dueOn: waiting && proposal.dueAt ? proposal.dueAt.slice(0, 10) : null,
    updatedAt: proposal.updatedAt,
    drafted: proposal.provenance?.by ?? null,
  }
}

/** Where a proposal was written (FR-103), as a short chip. */
export const channelNames: Record<ProposalRecord['channel'], string> = {
  form: 'Web form',
  assistant: 'Assistant',
  chat: 'Chat message',
  command_line: 'Command line',
  mcp: 'AI app',
  import: 'Import',
}

/** "New #4", "Change #5": what the proposal does, and its number. */
export function changeLabel(row: Pick<ProposalRow, 'change' | 'number'>): string {
  const names = { create: 'New', change: 'Change', retire: 'Archive', recheck: 'Check' }
  return `${names[row.change]} #${row.number}`
}

/** The state, domain and search filters of the address, newest change first within a group. */
export function visibleProposalRows(rows: readonly ProposalRow[], search: ProposalsSearch) {
  const terms = queryTerms(search.q)
  return rows
    .filter(
      (row) =>
        (search.state === undefined || row.state === search.state) &&
        (search.area === undefined || row.areaId === search.area) &&
        terms.every(
          (term) =>
            row.title.toLowerCase().includes(term) ||
            `#${row.number}` === term ||
            String(row.number) === term,
        ),
    )
    .sort(
      (a, b) =>
        proposalStages.indexOf(a.stage) - proposalStages.indexOf(b.stage) ||
        b.updatedAt.localeCompare(a.updatedAt) ||
        b.number - a.number,
    )
}

export type ProposalGroup = { type: 'group'; stage: ProposalStage; count: number }
export type ProposalEntry = ProposalGroup | { type: 'row'; row: ProposalRow }

/** The rows under a group row per stage, in the stage order; empty stages leave no row. */
export function groupProposalRows(rows: readonly ProposalRow[]): ProposalEntry[] {
  return proposalStages.flatMap((stage) => {
    const inStage = rows.filter((row) => row.stage === stage)
    if (!inStage.length) return []
    return [
      { type: 'group' as const, stage, count: inStage.length },
      ...inStage.map((row) => ({ type: 'row' as const, row })),
    ]
  })
}

/** How many filters are on, for the filter button's count. */
export function proposalFilterCount(search: ProposalsSearch): number {
  return (search.state ? 1 : 0) + (search.area ? 1 : 0)
}

/** "“Norway” with Status: Rejected", naming what is on, for the no-results message. */
export function describeProposalFilters(search: ProposalsSearch, areaName: (id: string) => string) {
  const parts = [
    search.state ? `Status: ${proposalStateNames[search.state]}` : null,
    search.area ? `Domain: ${areaName(search.area)}` : null,
  ].filter((part): part is string => part !== null)
  const query = search.q?.trim()
  if (query && parts.length) return `Nothing matches “${query}” with ${parts.join('; ')}.`
  if (query) return `Nothing matches “${query}”. Try fewer or shorter words.`
  return `Nothing matches ${parts.join('; ')}.`
}

/**
 * What a person may do with a proposal on its status page, by its state (requirements 4.2 and
 * FR-109 to FR-115). The service checks again; these decide what the page offers.
 *
 * - `primary`: the page's one filled button. Continue editing a draft, or edit and resubmit when
 *   the reviewer asked for changes.
 * - `withdraw`: the writer takes back a sent proposal that is still open.
 * - `discard`: the writer throws away a draft that was never sent.
 * - `reply`: the writer, or an owner or deputy of the domain, adds to the conversation while
 *   the proposal is with a reviewer.
 */
export type ProposalActions = {
  primary: 'continue' | 'resubmit' | null
  withdraw: boolean
  discard: boolean
  reply: boolean
}

export function proposalActions(
  state: ProposalState,
  { author, reviewer }: { author: boolean; reviewer: boolean },
): ProposalActions {
  const sent = state === 'submitted' || state === 'in_review' || state === 'changes_requested'
  return {
    primary:
      author && state === 'draft'
        ? 'continue'
        : author && state === 'changes_requested'
          ? 'resubmit'
          : null,
    withdraw: author && sent,
    discard: author && state === 'draft',
    reply: sent && (author || reviewer),
  }
}

/**
 * Where the writer edits a proposal: the Add context form for a new item, Suggest a change for a
 * change to an accepted item, with the proposal as the draft.
 */
export function editLinkOf(proposal: Pick<ProposalRecord, 'id' | 'action' | 'itemId'>) {
  return proposal.action === 'change' && proposal.itemId
    ? ({
        to: '/library/$itemId/suggest',
        params: { itemId: proposal.itemId },
        search: { draft: proposal.id },
      } as const)
    : ({ to: '/library/new', search: { draft: proposal.id } } as const)
}

/** Days from an open issue's start to its first "Is this still going on?" (FR-135); 14 by default. */
export function openIssueReviewDays(draft: ProposalRecord['draft']): number | null {
  if (draft.kind !== 'issue' || draft.validity?.end !== null || !draft.validity.start) return null
  const { start } = draft.validity
  const review = draft.reviewDate
  if (!review) return 14
  const days = Math.round(
    (Date.parse(`${review}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  )
  return Number.isFinite(days) && days > 0 ? days : 14
}

/** The patterns the service refuses in free text (FR-116, FR-117), in plain words. */
const sensitiveNames: Record<string, string> = {
  email_address: 'an email address',
  private_key: 'a private key',
  access_key: 'an access key',
  password_or_token: 'a password or an access key',
  phone_number: 'a phone number',
  // The stricter check of an anonymous note (FR-611): a gap report's note.
  personal_data: 'personal data or a secret',
  question_text: 'the question itself',
}

/**
 * Why the service refused a reply or a reason, naming the pattern it found ("It looks like it
 * holds a phone number."), or null when the refusal was not about the text.
 */
export function refusedTextMessage(findings: readonly { code: string }[]): string | null {
  const names = [...new Set(findings.map((finding) => sensitiveNames[finding.code]))].filter(
    (name): name is string => name !== undefined,
  )
  if (!names.length) return null
  return `It looks like it holds ${names.join(' and ')}. Take that out, then send it again.`
}

/** The form's names for the fields a format finding can be about. */
const fieldLabels: Record<string, string> = {
  kind: 'What kind is it',
  summary: 'What happened',
  summaryMarkup: 'What happened',
  title: 'What happened',
  scope: 'Where it applies',
  validity: 'When it applies',
  evidence: 'Where this comes from',
  areaId: 'Domain',
  notToConclude: 'What not to conclude',
  body: 'Longer explanation',
  bodyMarkup: 'Longer explanation',
}

/**
 * A draft's format findings as plain notes for its checks card: the field's name from the form,
 * never the schema's own words ("Where this comes from needs attention.").
 */
export function draftFindingNotes<F extends { field: string; message: string }>(
  findings: readonly F[],
): F[] {
  return findings.map((finding) => {
    const label = fieldLabels[finding.field.split('.')[0] ?? '']
    return {
      ...finding,
      message: label ? `${label} needs attention.` : 'Something needs attention.',
    }
  })
}
