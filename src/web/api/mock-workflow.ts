/**
 * The write side of the mock: proposals, review and editions held in memory, with the rules the
 * service applies (src/server/modules/proposals, review and editions). The conformance suite
 * (tests/conformance/context-api-writes.ts) runs the same steps on this and on the service, so
 * the two stay in step. What the mock does not do: resolve the matching and delivery probes
 * (they are generated from the item's scope and pass), score a proposal's answers (an area with
 * test questions in `testQuestions` passes them all, with a finished run for the review screen;
 * one without, as on the service without any, passes the impact level and fails the full set a
 * high-risk change needs; weekly runs and the runs an owner starts are scored, mock-quality.ts),
 * and rewrite an item's content when a proposal is accepted (the edition records the new version
 * number; the fixture text stays). Retiring, rechecking and going back to an edition change what
 * the library reads, through `liveItems`.
 *
 * The editions start with a history read from the fixture library: its latest accepted versions
 * and retirements, one edition each, the newest being the live edition of the fixture day. An
 * older version serves what it said then (`versionDays`' `patch`).
 *
 * Time, ids and edition labels are counted from the fixture day, so a story or a screenshot
 * that plays the same steps gets the same answers.
 */
import { refusals } from '../../contract/refusals.ts'
import { type ClientPolicy, unknownToolsMessage } from '../../contract/admin.ts'
import type {
  BinEntry,
  BinItem,
  BinItemsInput,
  BinRescuePreview,
  BinRescuePreviewInput,
  BinRestoreInput,
  BinList,
  BinMoveInput,
  BinMoveResult,
  BinPreview,
  BinRestoreResult,
} from '../../contract/bin.ts'
import type {
  ConnectInfo,
  TryIt,
  TryItInput,
  TryItReading,
  TryItReadInput,
} from '../../contract/connect.ts'
import type { Permissions, Principal } from '../../contract/auth.ts'
import type { ProposalRecord, ProposalListResult, ProposalTest } from '../../contract/proposals.ts'
import type {
  AttachedTest,
  Edition,
  Gate,
  LevelResult,
  ReviewProposal,
  BulkSkip,
  QueueEntry,
} from '../../contract/review.ts'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { bulkSkipWords, levelList, termKindOrder } from '../../domain/bulk-review.ts'
import { canonicalJson } from '../../domain/canonical.ts'
import {
  type Draft,
  formatDraft,
  formatOutcome,
  previewVersion,
  textFindings,
} from '../../domain/draft.ts'
import { compareRuns as compareQuestionRuns, heldConstant } from '../../domain/quality.ts'
import {
  goldenQuestionSchema,
  questionFileSchema,
  retrievalChecks,
  type GoldenQuestion,
  type RetrievalChecks,
} from '../../domain/golden-question.ts'
import {
  audienceAllows,
  type Area,
  type ContextItem,
  noGroups,
  type Person,
  reviewQuestion,
  type Vocabulary,
} from '../../domain/item.ts'
import type { ItemVersion } from '../../domain/item-version.ts'
import { parseMentions } from '../../domain/mentions.ts'
import { canTransitionProposal } from '../../domain/proposal.ts'
import {
  keepMarks,
  markedFields,
  provenanceOf,
  type FieldMark,
  type MarkedField,
  type Provenance,
} from '../../domain/provenance.ts'
import type { ProposalState } from '../../domain/proposal-state.ts'
import {
  addWorkingDays,
  matchingProbes,
  mentionDiff,
  noneWorseWords,
  testChange,
  testChangeWords,
  versionDiff,
  vocabularyFindings,
  type VocabularyChange,
  type VocabularyContext,
} from '../../domain/review.ts'
import { termCandidates } from '../../domain/term-candidates.ts'
import { DOMAIN_DELETED_REASON, termFates } from '../../domain/area-removal.ts'
import { rescueDraft } from '../../domain/bin-rescue.ts'
import type { ResolverItem } from '../../domain/resolver.ts'
import {
  areaOfMetrics,
  noteFindings,
  scopeIssueFindings,
  topicFor,
} from '../../domain/gap-reports.ts'
import { extractScope } from '../../domain/scope.ts'
import { questionReading } from '../../domain/question-reading.ts'
import type { Term } from '../../domain/vocabulary.ts'
import { previewItemId, type ServedReview } from '../../domain/served-review.ts'
import type { ItemReview } from '../../contract/review.ts'
import { describeScope, searchScope, type ScopeUsage } from '../../domain/scope-search.ts'
import type { ScopeSearchInput } from '../../contract/scope.ts'
import { isCalendarDate, shiftDate } from '../../domain/validity.ts'
import type {
  CommentInput,
  CreateProposalInput,
  DecideInput,
  DiscardedDraft,
  ActiveStop,
  DecisionResult,
  EditionCompareInput,
  EditionComparison,
  EditionDiff,
  EditionDiffInput,
  EditionExport,
  EditionFeed,
  EditionFeedInput,
  EditionItemCompareInput,
  EditionItemComparison,
  EditionListParams,
  GapDraftInput,
  GapLinkTestInput,
  GapListParams,
  GapNoteInput,
  GapReport,
  GapReportInput,
  GapStatusInput,
  GapTest,
  GapUnlinkTestInput,
  EvalRun,
  EvalRunDetail,
  EvalRunListParams,
  EvalTranscript,
  ImportQuestionsInput,
  ImportReport,
  RunEstimate,
  RunEstimateParams,
  SaveTestQuestionInput,
  SetAsideInput,
  HandOverInput,
  ImportItemsInput,
  InboxIds,
  ItemImportReport,
  InboxListParams,
  PreviewInput,
  PreviewReply,
  ProposalEvent,
  ProposalTestInput,
  ProposalListParams,
  ProposalMutation,
  ProposalOverlap,
  QueueParams,
  BulkAssignInput,
  BulkAssignment,
  BulkDecideInput,
  BulkDecision,
  BulkPlan,
  BulkPlanInput,
  Review,
  ReviewEditInput,
  ItemReasonInput,
  RollbackInput,
  RollbackPreview,
  BlockedVersion,
  SaveClientInput,
  SaveDraftInput,
  SetToolInput,
  StopInput,
  TopicCountsParams,
  WeeklyCallsParams,
  RetrievalAreaParams,
  RetrievalEdition,
  RetrievalEditionParams,
  RetrievalPoint,
  RetrievalTrendParams,
  Comparison,
  FeedbackCounts,
  Rating,
  RatingCounts,
  AppFamilyCounts,
  AppFamilyCountsParams,
  RatingInput,
  FixNext,
  FixNextParams,
  HistoryPoint,
  QualityAreaParams,
  QualityCompareParams,
  QualityHistoryParams,
  QualityWeeksParams,
  QuestionCompareParams,
  QuestionComparison,
  QuestionHistory,
  QuestionHistoryParams,
  Untested,
  Upkeep,
  TestQuestion,
  TestQuestionListParams,
  ToolSwitch,
  WithdrawInput,
  DecideTermBatchInput,
  TermBatchDecision,
  TermBatchInput,
  TermBatchResult,
  TermCandidate,
} from './client.ts'
import { ApiError, type ApiErrorDetails, type StatusKind, type Finding } from './errors.ts'
import * as editionReads from './mock-edition-compare.ts'
import { createMockGaps, type MockGapWorld } from './mock-gaps.ts'
import {
  createMockQuality,
  questionSide,
  type MockAppDay,
  type MockRating,
} from './mock-quality.ts'
import {
  MOCK_TRIES,
  runDetail,
  runOfCell,
  startedRun,
  transcriptOf,
  weeklyRun,
} from './mock-runs.ts'
import { createMockOutbox } from './mock-live.ts'
import { createMockAdmin, type MockDeletionPlan, type MockRoster } from './mock-admin.ts'
import { demoMetricArea } from '../mocks/cube-model.ts'
import { mockScenario } from './mock-scenario.ts'
import {
  ITEM_FILE_MAX_LENGTH,
  ITEM_IMPORT_MAX_PROPOSALS,
  readItemFile,
} from '../../domain/item-file.ts'
import {
  draftsOverlap,
  mockExplain,
  mockPreview,
  mockReply,
  type MockServedItem,
  type MockServing,
} from './mock-proposal-preview.ts'
import type { MockAssistantReads } from './mock-assistant.ts'
import { definitionRefOf, definitionRefsOf, demoDefinitions } from '../mocks/cube-model.ts'

/** The question every review screen asks (FR-210), in the service's words. */
export const SOURCE_TOOL_QUESTION =
  'Does this change a definition or the way agents choose data? That belongs in the source tool.'

/** Working days an owner has to decide (the service reads it from the area). */
const REVIEW_DAYS = 2
/** Days until the review date of a new item (setting review.default_days). */
const DEFAULT_REVIEW_DAYS = 90
/** Days an open issue runs before "Is this still going on?" (setting review.open_issue_days). */
const OPEN_ISSUE_DAYS = 14

type Role = 'owner' | 'approver'
type Capacity = Role | 'administrator'

export type MockWorld = {
  today: string
  people: readonly Person[]
  areas: readonly Area[]
  vocabulary: Vocabulary
  items: () => readonly ContextItem[]
  approvers: readonly { areaId: string; personId: string }[]
  administrators: readonly string[]
  /** People who read the history log (FR-808); none without it. */
  auditors?: readonly string[]
  /** When the clock starts; noon on `today` by default. A seed that tells a story starts earlier. */
  startsAt?: string
  /** Proposals created outside the item form, such as governed vocabulary changes. */
  proposals?: readonly ProposalRecord[]
  /**
   * When each version of a fixture item was accepted, and what a version had that the library's
   * item does not (`patch`, mocks/items.ts). With it the editions start with the library's recent
   * history; without it, with a bootstrap and the live edition only.
   */
  versionDays?: (
    item: ContextItem,
  ) => readonly { version: number; accepted: string; patch?: Partial<ContextItem> }[]
  /** The gaps and topic counts the world starts with; none without it. */
  gaps?: MockGapWorld
  /**
   * The areas' test questions. An area with active ones has weekly runs, and its proposals run
   * answer tests that pass, as a run the review screen can read; without them the answer levels
   * behave as on a service whose area has none.
   */
  testQuestions?: readonly TestQuestion[]
  /** The assistant's ratings the world starts with (FR-712); none without it. */
  ratings?: readonly MockRating[]
  /** The AI apps' tool calls per family and day in the request log (FR-410); none without it. */
  appDays?: readonly MockAppDay[]
  /**
   * The definitions each vocabulary term names: a metric's member, and every view's member of a
   * dimension's name (`definitionRefsOf`) unless the world says otherwise.
   */
  termRefs?: (term: { key: string; group?: string }) => string[]
}

/**
 * How many of the library's latest accepted versions and retirements the starting editions
 * hold, one edition each: more than one page of the editions list.
 */
const HISTORY_ACCEPTS = 55
const HISTORY_RETIREMENTS = 5

/**
 * The version of an item an edition serves, against the fixture library: null when it is not
 * served (not written yet, or retired), and what a recheck changed in it.
 */
type Served = { version: number; patch: Partial<ContextItem> } | null

/** An item in the Bin (0067): its entry, and what the live edition served of it when it moved. */
type BinRecord = { entry: Omit<BinEntry, 'openProposals' | 'deletedDomain'>; served: Served }
/** The items whose served version differs from the fixture library, by item id. */
type ServedState = Map<string, Served>

/** The fixture library's own answer: a retired item is not served. */
const fixtureServed = (item: ContextItem): Served =>
  item.status === 'retired' ? null : { version: item.version, patch: {} }

type StoredProposal = ProposalRecord & {
  areaId: string
  submittedAt: string | null
  closedAt: string | null
  /** The accepted version a change was written against. */
  base: ItemVersion | null
  /** The submitted version, fixed until changes are requested. */
  version: ItemVersion | null
  levels: LevelResult[]
  /** A discarded draft stays for its numbering and reads as not found. */
  discardedAt: string | null
}

type StoredDecision = {
  id: string
  proposalId: string
  versionId: string
  decidedBy: string
  capacity: Capacity
  outcome: 'accept' | 'request_changes' | 'reject' | 'retire'
  reason: string
  decidedAt: string
}

/** A time to the hour, as the history of gaps and tests keeps it (FR-410). */
const hourOf = (iso: string) => `${iso.slice(0, 13)}:00:00Z`

/** The selected proposals of a bulk step, each once, in the order they were selected. */
function uniqueTargets<T extends { id: string }>(targets: readonly T[]): T[] {
  const seen = new Set<string>()
  return targets.filter((target) => !seen.has(target.id) && Boolean(seen.add(target.id)))
}

type BulkEffect = BulkPlan['decided'][number]['effect']

function refuse(kind: StatusKind, message: string, details: ApiErrorDetails = {}): never {
  const status = {
    'signed-out': 401,
    forbidden: 403,
    'not-found': 404,
    conflict: 409,
    invalid: 422,
    precondition: 412,
    'bad-request': 400,
    unavailable: 503,
  }[kind]
  throw new ApiError(kind, message, { status, ...details })
}

const open: readonly ProposalState[] = ['draft', 'submitted', 'in_review', 'changes_requested']
const underReview: readonly ProposalState[] = ['submitted', 'in_review']
const riskOrder = { high: 0, normal: 1, low: 2 } as const

function rejectSensitive(value: unknown) {
  const findings = textFindings(value)
  if (findings.length)
    refuse('invalid', 'Remove the email address, phone number or secret from the text.', {
      findings,
    })
}

/** An administrator's reason is kept in the history log, so it must hold no sensitive text. */
function rejectReason(reason: string) {
  const findings = textFindings(reason, 'reason')
  if (findings.length)
    refuse('invalid', 'Remove the email address, phone number or secret from the reason.', {
      findings,
    })
}

/** A test question holds no sensitive text or real question (evals/questions.ts, `checkText`). */
function rejectQuestionText(question: GoldenQuestion | TestQuestion) {
  const findings = textFindings({
    wordings: question.wordings,
    rubrics: question.rubrics,
    caveat: question.expected.caveat,
    source: question.source,
  })
  if (findings.length)
    refuse(
      'invalid',
      "A test question can't hold an email address, phone number, secret or a question someone really asked.",
      {
        findings,
      },
    )
}

/** A stored test question as the file format writes it: without its revision and dates. */
function questionBody({
  revision: _revision,
  setAsideReason: _setAside,
  updatedAt: _updatedAt,
  ...body
}: TestQuestion): GoldenQuestion {
  return body
}

/** What one try of one wording costs in the mock, and the budget a run may spend unapproved. */
const MOCK_TRY_MICROS = 1_500
const MOCK_RUN_BUDGET = 2_000_000

function rejectMentions(text: string) {
  const parsed = parseMentions(text)
  if (!text.trim() || parsed.mentions.length || parsed.errors.length)
    refuse('invalid', 'Write it in plain text, without mentions.')
}

/**
 * What is wrong with the current version, as a change to an item stores it (heed-ux B5): trimmed,
 * null when empty, plain text without mentions or sensitive text. A new item has no current version.
 */
function changeReason(text: string | null | undefined, action: ProposalRecord['action']) {
  const reason = text?.trim() || null
  if (reason === null) return null
  if (action !== 'change')
    refuse('invalid', 'Only a suggested change says what is wrong with a fact.')
  rejectSensitive(reason)
  rejectMentions(reason)
  return reason
}

/** A draft as the service seeds it from an accepted item, with its keys in the API's form. */
function draftOfItem(item: ContextItem): Draft {
  return {
    kind: item.kind,
    areaId: item.areaId,
    title: item.title,
    summary: item.summary,
    ...(item.summaryMarkup === undefined ? {} : { summaryMarkup: item.summaryMarkup }),
    ...(item.body === undefined ? {} : { body: item.body }),
    ...(item.bodyMarkup === undefined ? {} : { bodyMarkup: item.bodyMarkup }),
    scope: {
      metrics: item.scope.metrics.map((metric) => `metric:${metric}`),
      dimensions: item.scope.dimensions.map((dimension) => `dim:${dimension}`),
      dimensionValues: item.scope.dimensionValues.map(({ dimension, value }) => ({
        dimension: `dim:${dimension}`,
        value: `val:${dimension}/${value}`,
      })),
    },
    validity: item.validity,
    reviewDate: item.reviewDate,
    evidence: item.evidence,
    references: item.references,
    changeMarks: item.changeMarks,
    claimLevel: item.claimLevel,
    riskLevel: item.riskLevel,
    audience: { kind: 'everyone' },
    ownerId: item.ownerId,
    notToConclude: item.notToConclude,
    replaces: [],
    conflicts: [],
  }
}

/** A fixture version's id, the same on every load: the mock keeps no version rows. */
function fixtureVersionId(itemId: string, version: number): string {
  const hex = digestOf(`${itemId}.${version}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** Where the mock's MCP server answers: the local service's address (README, "Connect Claude Code"). */
export const MOCK_MCP_ADDRESS = 'http://localhost:3000/mcp'

/** Dollars from micros, as the service writes a run's estimate: "$0.42". */
const formatUsd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`

/** A deterministic 64 character hex digest, standing in for an edition's content digest. */
function digestOf(text: string): string {
  let out = ''
  for (let round = 0; out.length < 64; round++) {
    let hash = 0x811c9dc5 ^ round
    for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193)
    out += (hash >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, 64)
}

/**
 * The MCP tools and clients the service's migrations start with (db/migrations/0001_baseline.sql):
 * every tool on except `get_related`, which stays off until an evaluation shows it helps
 * (FR-332), and `draft_context`, off until an administrator turns it on (FR-121). The mock
 * adds one client that is switched off and limited to three tools, so the screens show every kind
 * of policy.
 */
function startingGateway(today: string) {
  const since = `${shiftDate(today, -30)}T09:00:00.000Z`
  const tools: ToolSwitch[] = [
    'domain_overview',
    'draft_context',
    'find_context',
    'get_context',
    'get_related',
    'give_feedback',
    'improve_question',
    'read_item',
    'report_gap',
    'search_context',
    'search_help',
    'what_changed',
  ].map((tool) => ({
    tool,
    enabled: tool !== 'get_related' && tool !== 'draft_context',
    updatedAt: since,
  }))
  const clients: ClientPolicy[] = [
    {
      label: 'claude-code',
      displayName: 'Claude Code with a token',
      toolsAllowed: null,
      ratePerMinute: 120,
      maxResponseBytes: 100_000,
      enabled: true,
    },
    {
      label: 'cursor',
      displayName: 'Cursor',
      toolsAllowed: ['get_context', 'read_item', 'search_context'],
      ratePerMinute: 60,
      maxResponseBytes: null,
      enabled: false,
    },
    {
      label: 'eval',
      displayName: 'Evaluation runner',
      toolsAllowed: null,
      ratePerMinute: 120,
      maxResponseBytes: 100_000,
      enabled: true,
    },
  ]
  return { tools, clients }
}

/**
 * Other names the mock's definition source gives metrics, as a real one does: "Revenue" names
 * both revenue metrics, so a question that says only "revenue" names neither until the person
 * chooses (the Ask composer's "which one?").
 */
const metricOtherNames: Record<string, string[]> = {
  net_revenue: ['Revenue'],
  gross_sales: ['Revenue'],
}

/**
 * One shared world of proposals, decisions and editions. Each mock binding acts in it as one
 * person (`as(personId)`), so a test or a story can play a contributor and an owner together.
 */
export function createMockWorkflow(start: MockWorld) {
  /*
    Who holds which role, and the areas, as Settings changes them (mock-admin.ts): copies the
    world reads from here on, so a role granted or an area created applies everywhere at once.
  */
  const roster: MockRoster = {
    areas: structuredClone([...start.areas]),
    approvers: start.approvers.map((grant) => ({ ...grant })),
    administrators: [...start.administrators],
    auditors: [...(start.auditors ?? [])],
  }
  const world: MockWorld = { ...start, ...roster }
  let tick = 0
  let counter = 0
  const seededProposals = structuredClone(world.proposals ?? [])
  const lastSeedNumber = Math.max(0, ...seededProposals.map((p) => p.number))
  const proposals = new Map<string, StoredProposal>()
  /** The terms accepted since the world began, which the checks and the candidates read. */
  const acceptedTerms: Term[] = []
  const termRefs = world.termRefs ?? definitionRefsOf
  /** Terms proposed in one step (proposeTerms), by proposal id: never served until accepted. */
  const termProposals = new Map<string, { record: ProposalRecord; batchId: string }>()
  const events = new Map<string, ProposalEvent[]>()
  const decisions: StoredDecision[] = []
  /** Every submitted version by id, for what changed since a request for changes (heed-ux B2). */
  const submittedVersions = new Map<string, ItemVersion>()
  /** The test questions attached to each proposal's check, by proposal id (FR-524). */
  const attachedStore = new Map<string, { question: string; attachedHour: string }[]>()
  const { editions, states } = startingEditions(world)
  const stops: Required<ActiveStop>[] = []
  const gateway = startingGateway(world.today)
  /** Open and closed retirement proposals, apart from the item proposals above. */
  const retirements = new Map<string, ReviewProposal>()
  /** The Bin: items an administrator moved out of the library, by item id. */
  const bin = new Map<string, BinRecord>()
  /**
   * Rescues (FR-814), by proposal id: an item of a deleted domain restored into another domain,
   * retired, with this proposal there, as the Bin record keeps it (0079).
   */
  const rescues = new Map<
    string,
    { itemId: string; deletedDomain: string; restoredBy: string; restoredAt: string }
  >()
  /** A rescue's note for its reviewers, or null for any other proposal. */
  const rescueNote = (id: string) => {
    const rescue = rescues.get(id)
    return rescue
      ? {
          deletedDomain: rescue.deletedDomain,
          restoredBy: rescue.restoredBy,
          restoredAt: rescue.restoredAt,
        }
      : null
  }
  /** The answer runs of submitted versions, for the review screen (evals.runs.get). */
  const runs = new Map<string, EvalRunDetail>()
  /** The test questions by id: owners write, set aside and import them (FR-501, FR-504). */
  const questionStore = new Map(
    (world.testQuestions ?? []).map((question) => [question.id, structuredClone(question)]),
  )
  const testQuestions = () => [...questionStore.values()]
  /** The vocabulary as governed terms, for the probes of the matching check. */
  const terms: Term[] = [
    ...world.vocabulary.metrics.map((metric): Term => ({
      key: `metric:${metric.id}`,
      kind: 'metric',
      name: metric.name,
      aliases: metricOtherNames[metric.id] ?? [],
      parentKey: null,
      areaId: null,
      definitionRefs: [],
    })),
    ...world.vocabulary.dimensions.flatMap((dimension) => [
      {
        key: `dim:${dimension.id}`,
        kind: 'dimension' as const,
        name: dimension.name,
        aliases: [],
        parentKey: null,
        areaId: null,
        definitionRefs: [],
      },
      ...dimension.values.map((value): Term => ({
        key: `val:${dimension.id}/${value.id}`,
        kind: 'dimension_value',
        name: value.name,
        aliases: [...value.aliases],
        parentKey: `dim:${dimension.id}`,
        areaId: null,
        definitionRefs: [],
      })),
    ]),
  ]

  /** The governed terms with the dimensions, as get_context resolves a scope against them. */
  const scopeTerms: Term[] = [
    ...terms,
    ...world.vocabulary.dimensions.map((dimension): Term => ({
      key: `dim:${dimension.id}`,
      kind: 'dimension',
      name: dimension.name,
      aliases: [],
      parentKey: null,
      areaId: null,
      definitionRefs: [],
    })),
  ]

  const termNames = new Map(scopeTerms.map((term) => [term.key, term.name]))
  /** Each metric's domain by the one rule the service applies: the vocabulary's, else Cube's. */
  const metricArea = demoMetricArea(world.vocabulary.metrics)

  /** What the live edition serves agents: its accepted items and its stops. */
  /**
   * How the version an edition serves of each item was accepted, as `cl_version_review`
   * reads it: the last accept decision that is not an approver's, and the first edition that
   * served the version. An acceptance older than the mock's edition history gets the label its
   * day's first edition would have.
   */
  function acceptances(edition: Edition) {
    const reads = editionWorld()
    const ordered = [...editions].sort((a, b) => a.seq - b.seq)
    return (id: string): (ServedReview & { personId: string }) | null => {
      const version = reads.served(edition, id)
      if (!version) return null
      const accept = reads
        .why(id, version, false)
        .decisions.filter((d) => d.outcome === 'accept' && d.capacity !== 'approver')
        .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
        .at(-1)
      if (!accept) return null
      const acceptedOn = accept.decidedAt.slice(0, 10)
      const first = ordered.find((e) => servedIn(e, id)?.version === version.version)
      return {
        acceptedOn,
        acceptedAs: accept.capacity as ServedReview['acceptedAs'],
        areaId: version.areaId,
        edition: first && first.label.slice(0, 10) >= acceptedOn ? first.label : `${acceptedOn}.1`,
        personId: accept.decidedBy,
      }
    }
  }

  function servedToAgents() {
    const edition = liveEdition()
    const reviewed = acceptances(edition)
    const items = liveItems(world.items()).flatMap((item): MockServedItem[] =>
      item.status === 'accepted'
        ? [
            {
              ...item,
              scope: draftOfItem(item).scope!,
              conflicts: [],
              notToConclude: draftOfItem(item).notToConclude!,
              review: reviewed(item.id),
            },
          ]
        : [],
    )
    const serving: MockServing = {
      metricArea,
      stopped: {
        all: stops.some((stop) => stop.scope === 'all'),
        areas: stops.flatMap((stop) => (stop.scope === 'area' && stop.areaId ? [stop.areaId] : [])),
        items: stops.flatMap((stop) => (stop.scope === 'item' && stop.itemId ? [stop.itemId] : [])),
      },
    }
    return { edition, items, serving }
  }

  /** A question and a typed scope, resolved as get_context resolves them. */
  function agentScope(question: string, input: TryItInput) {
    const filters: Record<string, string[]> = {}
    for (const { dimension, values } of input.dimension_filters ?? [])
      filters[dimension] = [...(filters[dimension] ?? []), ...values]
    return extractScope(question, scopeTerms, world.today, {
      ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
      ...(input.dimension_filters === undefined ? {} : { filters }),
      ...(input.window === undefined
        ? {}
        : { window: { start: input.window.from, end: shiftDate(input.window.to, 1) } }),
    })
  }

  /** get_context's reply on the live edition for a question and a typed scope. */
  function agentReply(question: string, input: TryItInput): PreviewReply {
    const { edition, items, serving } = servedToAgents()
    return mockReply(world, items, agentScope(question, input), edition.label, serving, scopeTerms)
  }

  /** Each call is one second after the last, from noon on the fixture day (or `startsAt`). */
  const clockStart = Date.parse(world.startsAt ?? `${world.today}T12:00:00.000Z`)
  const now = () => new Date(clockStart + 1000 * tick++).toISOString()
  /** Moves the clock forward to a moment, never back, so a seed can spread its steps over days. */
  function travelTo(at: string) {
    tick = Math.max(tick, Math.ceil((Date.parse(at) - clockStart) / 1000))
  }
  const admin = createMockAdmin({
    today: world.today,
    now: () => now(),
    people: world.people,
    roster,
    tools: () => gateway.tools.map((tool) => tool.tool),
    clients: () => gateway.clients,
    scenario: mockScenario,
    deletion: {
      plan: (areaId) => deletionPlan(areaId),
      apply: (areaId, name, personId, plan, reason) =>
        deleteContents(areaId, name, personId, plan, reason),
      binned: (areaId) => binnedOf(areaId),
    },
    subjectOf: (subject, personId) => ({
      subjectNumber:
        subject.type === 'proposal' && seesProposal(personId, subject.id)
          ? ((proposals.get(subject.id) ?? retirements.get(subject.id))?.number ?? null)
          : null,
      subjectTitle:
        subject.type === 'proposal' || subject.type === 'item' ? titleOf(subject, personId) : null,
    }),
  })
  /** Each accepted term as it is now: the last version accepted of each key. */
  const latestTerms = () => [...new Map(acceptedTerms.map((term) => [term.key, term])).values()]
  /** Deleted domains by id, with their names: their items cannot leave the Bin (FR-814). */
  const deletedAreas = new Map<string, string>()
  const openStates: readonly ProposalState[] = ['submitted', 'in_review', 'changes_requested']
  const personName = (id: string) =>
    world.people.find((person) => person.id === id)?.name ?? 'Someone'

  /**
   * What deleting an area would do (FR-814), as the service reads it (0074): its accepted items,
   * its terms with each one's fate, its open proposals, its drafts and its team, every one named.
   */
  function deletionPlan(areaId: string): MockDeletionPlan {
    const stored = [...proposals.values()].filter(
      (proposal) => proposal.areaId === areaId && !proposal.discardedAt,
    )
    const termRecords = [...termProposals.values()]
      .map(({ record }) => record)
      .filter((record) => record.areaId === areaId)
    const retired = [...retirements.values()].filter((proposal) => proposal.areaId === areaId)
    const live = liveItems(world.items()).filter((item) => item.status === 'accepted')
    const items = live
      .filter((item) => item.areaId === areaId)
      .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
    // A term another domain's accepted item names stays, without a domain.
    const usedElsewhere = new Set(
      live
        .filter((item) => item.areaId !== areaId)
        .flatMap((item) => {
          const { scope } = draftOfItem(item)
          return [
            ...(scope?.metrics ?? []),
            ...(scope?.dimensions ?? []),
            ...(scope?.dimensionValues ?? []).flatMap(({ dimension, value }) => [dimension, value]),
          ]
        }),
    )
    const own = latestTerms().filter((term) => term.areaId === areaId)
    const fates = termFates(
      own.map((term) => ({
        key: term.key,
        parentKey: term.parentKey,
        usedElsewhere: usedElsewhere.has(term.key),
      })),
      new Set(
        [...terms, ...acceptedTerms]
          .filter((term) => term.areaId !== areaId && term.parentKey !== null)
          .map((term) => term.parentKey!),
      ),
    )
    const ownKeys = new Set(own.map((term) => term.key))
    const fromSource = Object.entries(metricArea)
      .filter(([key, id]) => id === areaId && !ownKeys.has(key))
      .map(([key]) => key)
    const area = roster.areas.find((candidate) => candidate.id === areaId)
    const team = [
      ...(area?.ownerIds ?? []).map((id) => ({ personId: id, role: 'owner' as const })),
      ...roster.approvers
        .filter((grant) => grant.areaId === areaId)
        .map((grant) => ({ personId: grant.personId, role: 'approver' as const })),
    ].map((role) => ({ ...role, name: personName(role.personId) }))
    const open = [...stored, ...termRecords, ...retired]
      .filter((proposal) => openStates.includes(proposal.state))
      .sort((a, b) => a.number - b.number)
    const drafts = stored.filter((proposal) => proposal.state === 'draft')
    const plan: MockDeletionPlan = {
      holdings: {
        items: items.length,
        terms: own.length + fromSource.length,
        openProposals: open.length,
        sourceMembers: demoDefinitions.filter((definition) => definition.areaHint === areaId)
          .length,
        drafts: drafts.length,
        team: team.length,
        history:
          world.items().some((item) => item.areaId === areaId) ||
          stored.length + termRecords.length + retired.length > 0 ||
          testQuestions().some((question) => question.area === areaId),
      },
      items: items.map(({ id, title, kind }) => ({ id, title, kind })),
      terms: [
        ...own.map((term) => ({
          key: term.key,
          name: term.name,
          kind: term.kind,
          fate: fates.get(term.key)!,
        })),
        ...fromSource.map((key) => ({
          key,
          name: termNames.get(key) ?? key,
          kind: 'metric' as const,
          fate: 'source' as const,
        })),
      ],
      openProposals: open.map((proposal) => ({
        id: proposal.id,
        number: proposal.number,
        subject: termProposals.has(proposal.id) ? ('vocabulary' as const) : ('item' as const),
        title: proposal.title,
      })),
      drafts: drafts.map((draft) => ({
        id: draft.id,
        title: draft.title.trim() || 'Untitled draft',
        author: personName(draft.proposerId),
      })),
      team,
      recipients: [
        ...new Set([
          ...open.map((proposal) => proposal.proposerId),
          ...drafts.map((draft) => draft.proposerId),
          ...team.map((role) => role.personId),
        ]),
      ],
    }
    return plan
  }

  /**
   * Deletes what an area holds, as the service does (areas/deletion.ts): its accepted items move
   * to the Bin and its terms retire (or stay without a domain) in one edition, and its open
   * proposals are withdrawn with the reason "Domain deleted". Returns how to serve the terms again.
   */
  function deleteContents(
    areaId: string,
    name: string,
    personId: string,
    plan: MockDeletionPlan,
    reason: string | undefined,
  ) {
    const at = now()
    const targets = plan.items
      .map((entry) => libraryItem(entry.id)!)
      .map((item) => liveItems([item])[0]!)
    const served = new Map(targets.map((item) => [item.id, servedIn(liveEdition(), item.id)]))
    for (const item of targets)
      noteRetired(item.id, item.version, {
        proposal: null,
        proposerId: null,
        channel: null,
        editedBy: null,
        decisions: [
          {
            decidedBy: personId,
            capacity: 'administrator',
            outcome: 'retire',
            reason: DOMAIN_DELETED_REASON,
            decidedAt: at,
          },
        ],
      })
    // The terms: a retired one leaves the vocabulary, a kept one loses the domain, and a metric
    // only the source put in the domain loses it.
    const before = latestTerms().filter((term) => term.areaId === areaId)
    const fateOf = new Map(plan.terms.map((term) => [term.key, term.fate]))
    const lostDomain = plan.terms
      .filter((term) => term.fate === 'source')
      .map((term) => [term.key, metricArea[term.key]!] as const)
    const keptAs = new Map<string, Term>()
    const retiredTerms: Term[] = []
    for (const term of before)
      if (fateOf.get(term.key) === 'kept') {
        const kept = { ...term, areaId: null }
        keptAs.set(term.key, kept)
        acceptedTerms.push(kept)
      } else
        for (let at = acceptedTerms.length - 1; at >= 0; at -= 1)
          if (acceptedTerms[at]!.key === term.key)
            retiredTerms.unshift(...acceptedTerms.splice(at, 1))
    for (const [key] of lostDomain) delete metricArea[key]
    const edition =
      targets.length || plan.terms.length
        ? publish(
            {
              reason: 'area_deleted',
              actorId: personId,
              note: reason ?? `${DOMAIN_DELETED_REASON}: ${name}`,
              restores: null,
            },
            { items: targets.map((item): [string, Served] => [item.id, null]) },
          )
        : null
    for (const item of targets) {
      bin.set(item.id, {
        entry: {
          itemId: item.id,
          kind: item.kind,
          areaId: item.areaId,
          title: item.title,
          version: item.version,
          reason: DOMAIN_DELETED_REASON,
          binnedBy: personId,
          binnedAt: at,
          wasLive: true,
        },
        served: served.get(item.id) ?? null,
      })
      admin.record({
        actorId: personId,
        action: 'item.binned',
        areaId: item.areaId,
        subjectType: 'item',
        subjectId: item.id,
        details: {
          title: item.title,
          reason: DOMAIN_DELETED_REASON,
          edition: edition!.label,
          openProposals: 0,
        },
      })
    }
    // Open proposals close for good, with the reason their authors read.
    const withdrawn = { state: 'withdrawn' as const, reason: DOMAIN_DELETED_REASON }
    for (const { id } of plan.openProposals) {
      const stored = proposals.get(id)
      const term = termProposals.get(id)?.record
      const retirement = retirements.get(id)
      const proposal = stored ?? term ?? retirement
      if (!proposal) continue
      Object.assign(proposal, withdrawn, {
        revision: proposal.revision + 1,
        ...(stored ? { closedAt: at, updatedAt: at } : term ? { updatedAt: at } : {}),
      })
      const list = events.get(id) ?? []
      list.push({
        id: uuid(),
        at,
        actorId: personId,
        kind: 'withdrawn',
        data: { reason: DOMAIN_DELETED_REASON },
      })
      events.set(id, list)
      proposalPosted(proposal, 'withdrawn', personId, { reason: DOMAIN_DELETED_REASON })
    }
    deletedAreas.set(areaId, name)
    outbox.post({
      topic: 'area.deleted',
      areaId,
      subject: { type: 'area', id: areaId },
      payload: { name },
      actorId: personId,
      recipients: plan.recipients.filter((id) => id !== personId),
      visibleTo: (reader) =>
        plan.recipients.includes(reader) || world.administrators.includes(reader),
    })
    return {
      edition,
      terms: plan.terms.length,
      /** Serves the terms again as they were, while they are still as deleting left them. */
      restore: (by: string, why: string | undefined) => {
        deletedAreas.delete(areaId)
        let count = 0
        for (const term of before) {
          const latest = latestTerms().find((candidate) => candidate.key === term.key)
          const kept = keptAs.get(term.key)
          if (kept ? latest === kept : latest === undefined) {
            if (kept) acceptedTerms.push(term)
            else acceptedTerms.push(...retiredTerms.filter((old) => old.key === term.key))
            count += 1
          }
        }
        for (const [key, id] of lostDomain) {
          metricArea[key] = id
          count += 1
        }
        const back = count
          ? publish({
              reason: 'area_restored',
              actorId: by,
              note: why ?? `Domain restored: ${name}`,
              restores: null,
            })
          : null
        return { edition: back, terms: count }
      },
    }
  }

  /** The area's items in the Bin, newest first. */
  function binnedOf(areaId: string) {
    return binEntries([...bin.keys()])
      .filter((entry) => entry.areaId === areaId)
      .map(({ itemId, title, kind }) => ({ id: itemId, title, kind }))
  }
  /** Version 4 shaped ids, counted. */
  const uuid = () => {
    counter += 1
    return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`
  }
  const newItemId = () => `itm_mock${(counter + 1).toString().padStart(6, '0')}`
  // Gap notes count apart from proposals and events, so a world with gaps gives its proposals the
  // same ids as one without (the demo's links and stories name proposals by id).
  let gapNotes = 0
  // The assistant's ratings: a verdict, an area and a day each, never who gave it (FR-712).
  const ratings: MockRating[] = [...(world.ratings ?? [])]
  const gapStore = createMockGaps(world.gaps ?? { topics: [], gaps: [], minimum: 5 }, {
    today: world.today,
    now: () => now(),
    uuid: () => `00000000-0000-4000-a000-${(++gapNotes).toString(16).padStart(12, '0')}`,
    isDiscarded: (id) => Boolean(proposals.get(id)?.discardedAt),
    liveEdition: () => editions.find((edition) => edition.live)?.label ?? null,
    metricArea,
  })

  /** The subject's title for the inbox, as the service reads it (`subjectTitle`). */
  function titleOf(subject: { type: string; id: string }, personId: string): string | null {
    if (subject.type === 'proposal') {
      if (!seesProposal(personId, subject.id)) return null
      return proposals.get(subject.id)?.draft.title ?? retirements.get(subject.id)?.title ?? null
    }
    if (subject.type === 'item') {
      return world.items().find((candidate) => candidate.id === subject.id)?.title ?? null
    }
    if (subject.type === 'area')
      return (
        roster.areas.find((area) => area.id === subject.id)?.name ??
        deletedAreas.get(subject.id) ??
        null
      )
    if (subject.type === 'vocabulary') {
      const [kind, id] = subject.id.split(':')
      const terms = kind === 'metric' ? world.vocabulary.metrics : world.vocabulary.dimensions
      return terms.find((term) => term.id === id)?.name ?? null
    }
    return null
  }
  const outbox = createMockOutbox({ now, people: world.people, titleOf })

  type Proposal = Pick<
    ReviewProposal,
    'id' | 'areaId' | 'state' | 'revision' | 'proposerId' | 'claimedBy'
  >
  /**
   * Who sees a proposal's events (row security on the service): the proposer, anyone with a
   * role in its area and administrators, and everyone once it is accepted. A discarded draft is
   * gone.
   */
  function seesProposal(personId: string, id: string): boolean {
    const proposal = proposals.get(id) ?? retirements.get(id)
    if (!proposal || ('discardedAt' in proposal && proposal.discardedAt)) return false
    const { roles, assignments } = permissionsOf(personId)
    return (
      proposal.state === 'accepted' ||
      proposal.proposerId === personId ||
      roles.includes('administrator') ||
      assignments.some((assignment) => assignment.areaId === proposal.areaId)
    )
  }
  /** Who hears about a proposal event in their inbox (`cl_inbox_recipients`). */
  function inboxRecipients(topic: string, proposal: Proposal, personId?: unknown): string[] {
    const area = world.areas.find((candidate) => candidate.id === proposal.areaId)
    const reviewers = proposal.claimedBy ? [proposal.claimedBy] : (area?.ownerIds ?? [])
    switch (topic) {
      case 'proposal.submitted':
      case 'proposal.withdrawn':
        return reviewers
      case 'proposal.commented':
        // A term without an area is the administrators' to decide, and so to discuss.
        return [
          proposal.proposerId,
          ...(proposal.claimedBy || proposal.areaId !== null
            ? reviewers
            : world.people
                .filter((person) => permissionsOf(person.id).roles.includes('administrator'))
                .map((person) => person.id)),
        ]
      case 'proposal.claimed':
      case 'proposal.decided':
        return [proposal.proposerId]
      case 'proposal.handed_over':
        return typeof personId === 'string' ? [personId] : []
      default:
        return []
    }
  }
  /** One outbox event for a step of a proposal, ids and states only (proposals/events.ts). */
  function proposalPosted(
    proposal: Proposal,
    kind: string,
    actorId: string,
    data: Record<string, unknown> = {},
  ) {
    const topic = `proposal.${kind}`
    // Every proposal event is in the history log too, named for who acted (FR-806).
    admin.record({
      actorId,
      action: topic,
      areaId: proposal.areaId,
      subjectType: 'proposal',
      subjectId: proposal.id,
      details: { revision: proposal.revision, ...data },
    })
    outbox.post({
      topic,
      areaId: proposal.areaId,
      subject: { type: 'proposal', id: proposal.id },
      // A claim or a hand-over names its reviewer, who gets the inbox item.
      payload: {
        id: proposal.id,
        state: proposal.state,
        revision: proposal.revision,
        ...(typeof data.personId === 'string' ? { personId: data.personId } : {}),
      },
      actorId,
      recipients: inboxRecipients(topic, proposal, data.personId),
      // A request for changes or a rejection tells the proposer why, in the inbox.
      ...(kind === 'decided' &&
      ['changes_requested', 'rejected'].includes(proposal.state) &&
      typeof data.reason === 'string'
        ? { note: data.reason }
        : {}),
      visibleTo: (reader) => seesProposal(reader, proposal.id),
    })
  }

  function permissionsOf(personId: string): Permissions {
    const assignments = [
      ...world.areas.flatMap((area) =>
        area.ownerIds.includes(personId) ? [{ areaId: area.id, role: 'owner' as const }] : [],
      ),
      ...world.approvers
        .filter((grant) => grant.personId === personId)
        .map((grant) => ({ areaId: grant.areaId, role: 'approver' as const })),
    ]
    const roleOrder = { owner: 0, approver: 1 }
    assignments.sort(
      (a, b) =>
        (a.areaId < b.areaId ? -1 : a.areaId > b.areaId ? 1 : 0) ||
        roleOrder[a.role] - roleOrder[b.role],
    )
    return {
      roles: [
        ...(roster.administrators.includes(personId) ? (['administrator'] as const) : []),
        ...(roster.auditors.includes(personId) ? (['auditor'] as const) : []),
      ],
      assignments,
    }
  }

  function principal(personId: string): Principal {
    const person = world.people.find((candidate) => candidate.id === personId)
    if (!person) return refuse('signed-out', refusals.signedOut)
    return { ...person, permissions: permissionsOf(personId) }
  }

  const vocabularyKeys = new Set([
    ...world.vocabulary.metrics.map((metric) => `metric:${metric.id}`),
    ...world.vocabulary.dimensions.flatMap((dimension) => [
      `dim:${dimension.id}`,
      ...dimension.values.map((value) => `val:${dimension.id}/${value.id}`),
    ]),
  ])

  /** Level 1: the format and the scope against the live vocabulary (checks.ts). */
  function checkDraft(draft: Draft, proposerId: string, channel: ProposalRecord['channel']) {
    const result = formatDraft(draft, proposerId, channel)
    const findings: Finding[] = [...result.findings]
    for (const key of [
      ...(draft.scope?.metrics ?? []),
      ...(draft.scope?.dimensions ?? []),
      ...(draft.scope?.dimensionValues.flatMap((row) => [row.dimension, row.value]) ?? []),
    ])
      if (!vocabularyKeys.has(key))
        findings.push({
          code: 'unknown_scope',
          field: 'scope',
          message: `We don't know the name ${key}. Choose one from the list.`,
          severity: 'error',
        })
    // As the service warns (FR-505): a dimension with any value is broad; it never blocks.
    for (const key of draft.scope?.dimensions ?? []) {
      const name = terms.find((term) => term.key === key)?.name
      if (name)
        findings.push({
          code: 'broad_scope',
          field: 'scope',
          message: `Broad: it applies to all of ${name}, so AI apps get it for any question about ${name}.`,
          severity: 'warning',
        })
    }
    return { findings, version: result.version }
  }

  /** The defaults the service fills in (proposals/service.ts, `defaults`). */
  function defaults(input: Draft, areaFallback?: string): Draft {
    input = { ...input }
    for (const field of ['summary', 'body'] as const) {
      const markupField = field === 'summary' ? 'summaryMarkup' : 'bodyMarkup'
      const markup = input[markupField] ?? input[field]
      if (markup === undefined) continue
      const parsed = parseMentions(markup)
      if (input[markupField] !== undefined || parsed.mentions.length || parsed.errors.length) {
        input[markupField] = markup
        input[field] = parsed.text
      }
    }
    const areaId = input.areaId ?? areaFallback
    const area = world.areas.find((candidate) => candidate.id === areaId)
    if (!area) return refuse('invalid', 'Choose an active domain.')
    const issue = input.kind === 'issue'
    const draft: Draft = {
      kind: 'note',
      summary: '',
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
      evidence: [],
      claimLevel: 'fact_only',
      riskLevel: input.kind && input.kind !== 'note' ? 'normal' : 'low',
      audience: { kind: 'everyone' },
      notToConclude: 'cause not proven',
      replaces: [],
      conflicts: [],
      reviewDate: issue ? null : shiftDate(world.today, DEFAULT_REVIEW_DAYS),
      ...(area.ownerIds[0] ? { ownerId: area.ownerIds[0] } : {}),
      ...input,
      title: input.title ?? [...(input.summary ?? '')].slice(0, 200).join(''),
      references: input.references ?? [],
      changeMarks: input.changeMarks ?? {},
      areaId: area.id,
    }
    const start = draft.validity?.start
    if (
      issue &&
      draft.validity?.end === null &&
      !draft.reviewDate &&
      start &&
      isCalendarDate(start)
    )
      draft.reviewDate = shiftDate(start, OPEN_ISSUE_DAYS)
    return draft
  }

  function record(stored: StoredProposal): ProposalRecord {
    const {
      submittedAt: _submitted,
      closedAt: _closed,
      base: _base,
      version: _version,
      levels: _levels,
      discardedAt: _discarded,
      ...proposal
    } = stored
    return structuredClone({ ...proposal, title: stored.draft.title ?? 'Untitled proposal' })
  }

  function reviewRecord(stored: StoredProposal): ReviewProposal {
    return {
      id: stored.id,
      number: stored.number,
      subject: 'item',
      action: stored.action,
      state: stored.state,
      areaId: stored.areaId,
      itemId: stored.itemId,
      itemVersionId: stored.itemVersionId,
      vocabularyVersionId: null,
      termKey: null,
      title: stored.version?.title ?? stored.draft.title ?? 'Untitled proposal',
      riskLevel: stored.version?.riskLevel ?? null,
      proposerId: stored.proposerId,
      channel: stored.channel,
      revision: stored.revision,
      reason: stored.reason,
      claimedBy: stored.claimedBy,
      dueAt: stored.dueAt,
      submittedAt: stored.submittedAt,
      closedAt: stored.closedAt,
      createdAt: stored.createdAt,
    }
  }

  function requiredLevels(risk: ItemVersion['riskLevel']): LevelResult['level'][] {
    const levels: LevelResult['level'][] = ['format', 'matching', 'delivery']
    if (risk !== 'low') levels.push('answer_impact')
    if (risk === 'high') levels.push('answer_full')
    return levels
  }

  /** A typed scope (Try it's, or a report's) resolved as get_context resolves it. */
  function scopeOfTry(input: TryItInput) {
    const filters: Record<string, string[]> = {}
    for (const { dimension, values } of input.dimension_filters ?? [])
      filters[dimension] = [...(filters[dimension] ?? []), ...values]
    return extractScope('', scopeTerms, world.today, {
      ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
      ...(input.dimension_filters === undefined ? {} : { filters }),
      ...(input.window === undefined
        ? {}
        : { window: { start: input.window.from, end: shiftDate(input.window.to, 1) } }),
    })
  }

  function liveEdition() {
    return editions.find((edition) => edition.live)!
  }

  /** The library by id, rebuilt when the library is another list. */
  const libraryIndex = new WeakMap<readonly ContextItem[], Map<string, ContextItem>>()
  function libraryItem(id: string): ContextItem | undefined {
    const items = world.items()
    let index = libraryIndex.get(items)
    if (!index) libraryIndex.set(items, (index = new Map(items.map((item) => [item.id, item]))))
    return index.get(id)
  }

  /** The version an edition serves of an item: its own state first, then the fixture library. */
  function servedIn(edition: Edition, id: string): Served {
    const state = states.get(edition.seq)!
    if (state.has(id)) return state.get(id)!
    const item = libraryItem(id)
    return item ? fixtureServed(item) : null
  }

  /** An item as an edition serves it, or null when it is not served. */
  function servedItem(edition: Edition, id: string): ContextItem | null {
    const item = libraryItem(id)
    if (!item) return null
    const served = servedIn(edition, id)
    return served ? { ...item, ...served.patch, version: served.version, status: 'accepted' } : null
  }

  /** An item as the live edition serves it, or null when it is not served. */
  const liveItem = (id: string) => servedItem(liveEdition(), id)

  /**
   * The library as the live edition serves it: retired, rechecked or rolled back items. An item
   * in the Bin is in no read model, as `v_item_list` leaves it out.
   */
  function liveItems(items: readonly ContextItem[]): ContextItem[] {
    const state = states.get(liveEdition().seq)!
    return items
      .flatMap((item) => (bin.has(item.id) ? [] : [item]))
      .map((item) => {
        if (!state.has(item.id)) return item
        const served = state.get(item.id)!
        if (!served) return { ...item, status: 'retired' }
        return { ...item, ...served.patch, version: served.version, status: 'accepted' }
      })
  }

  function editionByLabel(label: string): Edition {
    const edition = editions.find((candidate) => candidate.label === label)
    return edition ?? refuse('not-found', refusals.notFound)
  }

  /**
   * What the mock knows of a version beyond the fixture library, by item and version number
   * (`noteKey`): its id, its content when it is not the fixture item's (an accepted change, a
   * recheck), the proposal that brought it in or who accepted it directly, and who retired it.
   */
  type VersionNote = {
    versionId: string
    content?: ItemVersion
    recheck?: boolean
    proposalId?: string
    accepted?: editionReads.ChangeWhy
    retired?: editionReads.ChangeWhy
  }
  const versionNotes = new Map<string, VersionNote>()
  const noteKey = (id: string, version: number) => `${id}.${version}`

  /**
   * Versions that cannot be served again, with the database's reason (`cl_item_version_problem`,
   * FR-205), by `noteKey`. Every version the mock serves passes its checks, so this is empty, but
   * in the `rollback-blocked` scenario a check failed on one version after it left service.
   */
  const versionProblems = new Map<string, string>()
  if (mockScenario() === 'rollback-blocked') {
    const blocked = supersededVersion()
    if (blocked) versionProblems.set(blocked, 'a required check has not passed')
  }

  /**
   * The version an item served before the newest earlier edition that changed it, when the live
   * edition no longer serves it: going back to the edition before that change would serve it
   * again.
   */
  function supersededVersion(): string | null {
    const live = liveEdition()
    const ordered = [...editions].sort((a, b) => b.seq - a.seq)
    for (const [index, edition] of ordered.entries()) {
      const before = ordered[index + 1]
      if (!before || edition.live) continue
      for (const id of states.get(edition.seq)!.keys()) {
        const was = servedIn(before, id)
        const now = servedIn(edition, id)
        if (
          was &&
          now &&
          was.version !== now.version &&
          servedIn(live, id)?.version !== was.version
        )
          return noteKey(id, was.version)
      }
    }
    return null
  }

  /**
   * The versions an edition serves that cannot be served again, as the service names them
   * (`blockedVersions`): a version the live edition still serves is not entered again. A version
   * with an audience group names only its item.
   */
  function blockedIn(target: Edition): BlockedVersion[] {
    if (versionProblems.size === 0) return []
    const live = liveEdition()
    const ids = new Set([
      ...states.get(target.seq)!.keys(),
      ...world.items().map((item) => item.id),
    ])
    return [...ids]
      .flatMap((id): BlockedVersion[] => {
        const served = servedIn(target, id)
        const problem = served ? versionProblems.get(noteKey(id, served.version)) : undefined
        const item = libraryItem(id)
        if (!served || !problem || !item || servedIn(live, id)?.version === served.version)
          return []
        const title = { ...item, ...served.patch }.title
        return [
          {
            itemId: id,
            title: audienceAllows(item.audience, noGroups) ? title : null,
            version: served.version,
            problem,
          },
        ]
      })
      .sort(
        (a, b) => (a.title ?? '').localeCompare(b.title ?? '') || a.itemId.localeCompare(b.itemId),
      )
  }

  /** The next version number of an item: one after any it ever had, as the service counts. */
  function nextVersion(id: string): number {
    let highest = world.items().find((candidate) => candidate.id === id)?.version ?? 0
    for (const state of states.values()) highest = Math.max(highest, state.get(id)?.version ?? 0)
    return highest + 1
  }

  /** A retirement: who retired the version an item served last, and why (FR-218). */
  function noteRetired(id: string, version: number, retired: editionReads.ChangeWhy) {
    const key = noteKey(id, version)
    const note = versionNotes.get(key)
    // A rolled-back item may be retired again: the first decision stands beside the new one.
    versionNotes.set(key, {
      versionId: note?.versionId ?? fixtureVersionId(id, version),
      ...note,
      retired: note?.retired
        ? { ...retired, decisions: [...note.retired.decisions, ...retired.decisions] }
        : retired,
    })
  }

  /**
   * The mock's editions as the editions engine reads them (mock-edition-compare.ts). A fixture
   * version holds the fixture item with its patch, so every earlier version of a fixture item
   * holds what the current one does, as the database seed stores them: going from one to the
   * next is "saved again, nothing different". Who accepted a fixture version and why is the
   * seed's too: its owner, in the demo history.
   */
  function editionWorld(): editionReads.EditionWorld {
    const items = new Map(world.items().map((item) => [item.id, item]))
    const contents = new Map<string, ItemVersion | null>()
    const digested = new Map<string, editionReads.VersionDigests>()
    const served = (edition: Edition, id: string): editionReads.ServedVersion | null => {
      const item = items.get(id)
      const version = item ? servedIn(edition, id) : null
      if (!item || !version) return null
      const key = noteKey(id, version.version)
      const note = versionNotes.get(key)
      const shown = { ...item, ...version.patch }
      const content = () => {
        if (!contents.has(key))
          contents.set(
            key,
            note?.content ??
              formatDraft(draftOfItem(shown), item.proposerId, item.createdVia).version,
          )
        return contents.get(key)!
      }
      const digests = () => {
        if (!digested.has(key))
          digested.set(key, editionReads.versionDigests(content(), draftOfItem(shown)))
        return digested.get(key)!
      }
      return {
        version: version.version,
        versionId: note?.versionId ?? fixtureVersionId(id, version.version),
        recheck: note?.recheck ?? false,
        title: note?.content?.title ?? shown.title,
        areaId: note?.content?.areaId ?? shown.areaId,
        kind: note?.content?.kind ?? shown.kind,
        riskLevel: note?.content?.riskLevel ?? shown.riskLevel,
        withheld: !audienceAllows(item.audience, noGroups),
        content,
        digests,
      }
    }
    const demoDecision = (
      item: ContextItem,
      outcome: 'accept' | 'retire',
      decidedAt: string,
    ): editionReads.ChangeWhy['decisions'][number] => ({
      decidedBy: item.ownerId,
      capacity: 'owner',
      outcome,
      reason:
        outcome === 'retire' ? 'Retired in the demo history.' : 'Accepted in the demo history.',
      decidedAt,
    })
    return {
      editions,
      candidates: (a, b) =>
        a ? new Set([...states.get(a.seq)!.keys(), ...states.get(b.seq)!.keys()]) : items.keys(),
      served,
      why(id, version, left) {
        const item = items.get(id)!
        const note = versionNotes.get(noteKey(id, version.version))
        const none = { proposal: null, proposerId: null, channel: null, editedBy: null }
        if (left) {
          if (note?.retired) return note.retired
          return item.status === 'retired' && version.version === item.version
            ? { ...none, decisions: [demoDecision(item, 'retire', item.updatedAt)] }
            : { ...none, decisions: [] }
        }
        if (note?.accepted) return note.accepted
        const proposal = note?.proposalId ? proposals.get(note.proposalId) : undefined
        if (proposal)
          return {
            proposal: { id: proposal.id, number: proposal.number },
            proposerId: proposal.proposerId,
            channel: proposal.channel,
            editedBy: null,
            decisions: decisions
              .filter((d) => d.versionId === version.versionId && d.outcome === 'accept')
              .map((d) => ({
                decidedBy: d.decidedBy,
                capacity: d.capacity,
                outcome: 'accept' as const,
                reason: d.reason,
                decidedAt: d.decidedAt,
              })),
          }
        const day =
          world.versionDays?.(item).find((entry) => entry.version === version.version)?.accepted ??
          item.updatedAt.slice(0, 10)
        return {
          ...none,
          proposerId: item.proposerId,
          channel: item.createdVia,
          decisions: [demoDecision(item, 'accept', `${day}T08:30:00.000Z`)],
        }
      },
      areaName: (id) => world.areas.find((area) => area.id === id)?.name ?? id,
      personName: (id) => world.people.find((person) => person.id === id)?.name ?? null,
      exists: (id) => items.has(id),
    }
  }

  /**
   * Publishes an edition that serves what the live one does, with `changes` on top (an item id
   * and the version it now serves, or null when it leaves service), or exactly `state`.
   */
  /**
   * While a bulk decision runs (FR-223), the accepts of one kind share one edition: the first
   * publish of a reason opens it and later ones of the same reason add their changes to it. A
   * re-check keeps an edition of its own, with its own note.
   */
  let gathering: Map<string, Edition> | null = null
  function publish(
    edition: Omit<Edition, 'seq' | 'label' | 'digest' | 'sealedAt' | 'createdAt' | 'live'> & {
      digest?: string
    },
    changes: {
      state?: ServedState
      items?: [string, Served][]
    } = {},
  ) {
    const shared =
      gathering && edition.reason !== 'source_rechecked' ? gathering.get(edition.reason) : null
    if (shared) {
      const state = states.get(shared.seq)!
      for (const [id, served] of changes.items ?? []) state.set(id, served)
      return structuredClone(shared)
    }
    const state = new Map(changes.state ?? states.get(liveEdition().seq)!)
    for (const [id, served] of changes.items ?? []) state.set(id, served)
    const at = now()
    const day = world.today
    const sameDay = editions.filter((existing) => existing.label.startsWith(`${day}.`)).length
    const label = `${day}.${sameDay + 1}`
    for (const existing of editions) existing.live = false
    const published: Edition = {
      seq: Math.max(...editions.map((existing) => existing.seq)) + 1,
      label,
      digest: digestOf(label),
      sealedAt: at,
      createdAt: at,
      live: true,
      ...edition,
    }
    editions.push(published)
    states.set(published.seq, state)
    if (gathering && edition.reason !== 'source_rechecked') gathering.set(edition.reason, published)
    outbox.post({
      topic: 'edition.published',
      areaId: null,
      subject: { type: 'edition', id: label },
      payload: { seq: published.seq, label, reason: published.reason },
      actorId: published.actorId,
      visibleTo: () => true,
    })
    return structuredClone(published)
  }

  /** Proposals about an item that a reviewer still decides (Bin preview and entries). */
  function openProposalsOf(id: string): number {
    const open: readonly ProposalState[] = ['submitted', 'in_review', 'changes_requested']
    return (
      [...proposals.values()].filter(
        (proposal) =>
          proposal.itemId === id && proposal.discardedAt === null && open.includes(proposal.state),
      ).length +
      [...retirements.values()].filter(
        (proposal) => proposal.itemId === id && open.includes(proposal.state),
      ).length
    )
  }

  /** The Bin's entries of `ids`, newest first, as the service orders them. */
  function binEntries(ids: readonly string[]): BinEntry[] {
    return ids
      .flatMap((id) => {
        const record = bin.get(id)
        return record
          ? [
              {
                ...record.entry,
                deletedDomain: deletedAreas.get(record.entry.areaId) ?? null,
                openProposals: openProposalsOf(id),
              },
            ]
          : []
      })
      .sort(
        (a, b) =>
          b.binnedAt.localeCompare(a.binnedAt) ||
          (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
      )
  }

  /** The library items of `ids`, as the library shows them; refuses one it does not show. */
  function binTargets(ids: readonly string[]): ContextItem[] {
    const unique = [...new Set(ids)]
    const binned = unique.filter((id) => bin.has(id)).length
    if (binned)
      refuse(
        'conflict',
        binned === 1
          ? 'This fact is already in the Bin.'
          : `${binned} of these facts are already in the Bin.`,
      )
    // The mock's library lists every fixture item, whatever its audience, so the Bin takes any.
    return unique.map((id) => {
      const item = libraryItem(id)
      if (!item) return refuse('not-found', "We couldn't find this fact in the library.")
      return liveItems([item])[0]!
    })
  }

  /** Runs a bulk decision with its accepts gathered into as few editions as the rules allow. */
  function gathered<T>(run: () => T): { result: T; editions: Edition[] } {
    gathering = new Map()
    try {
      const result = run()
      return {
        result,
        editions: [...gathering.values()].map((edition) => structuredClone(edition)),
      }
    } finally {
      gathering = null
    }
  }

  /** Acting as one person: every rule that depends on who asks is checked here. */
  function as(personId: string) {
    const me = () => principal(personId)
    const rolesIn = (areaId: string | null): Set<Role> =>
      new Set(
        me()
          .permissions.assignments.filter((assignment) => assignment.areaId === areaId)
          .map((assignment) => assignment.role),
      )
    const isAdmin = () => me().permissions.roles.includes('administrator')
    const maintains = (areaId: string) => rolesIn(areaId).has('owner')
    /** Editions and test results are for owners of any area, and administrators. */
    const maintainsAny = () => {
      if (!isAdmin() && !world.areas.some((area) => maintains(area.id)))
        refuse('forbidden', refusals.forbidden)
    }

    /** Test results are for owners of an area, and administrators (null: all). */
    function retrievalAreas(area: string | undefined): string[] | null {
      const refuseRead = () =>
        refuse('forbidden', 'Only the owners of the domain and admins can see its test results.')
      if (isAdmin()) return area === undefined ? null : [area]
      if (area !== undefined) return maintains(area) ? [area] : refuseRead()
      const mine = world.areas.map((candidate) => candidate.id).filter(maintains)
      return mine.length ? mine : refuseRead()
    }

    /** The areas a Quality read covers, listed: every area for an administrator. */
    const readable = (area: string | undefined) =>
      retrievalAreas(area) ?? world.areas.map((candidate) => candidate.id)
    /** The Quality page's model of this world, as it stands now. */
    const quality = () =>
      createMockQuality({
        today: world.today,
        areaIds: world.areas.map((candidate) => candidate.id),
        questions: testQuestions(),
        editions,
        items: liveItems(world.items()),
        served: servedItem,
        proposals: [...proposals.values(), ...retirements.values()].filter(
          (p) => !('discardedAt' in p && p.discardedAt),
        ),
        gaps: gapStore.as({ manages: () => true }).list({ limit: 200 }),
        ratings,
        appDays: world.appDays ?? [],
        minimum: world.gaps?.minimum ?? 5,
      })

    /**
     * A test question the Workbench reads, as the service's rule: for the owners
     * of its area and administrators; a held-out one is not found for anyone else (FR-503).
     */
    const workbenchQuestion = (id: string): TestQuestion => {
      maintainsAny()
      const question = questionStore.get(id)
      if (!question || (question.split === 'held_out' && !(isAdmin() || maintains(question.area))))
        return refuse('not-found', "We couldn't find this test question, or you can't see it.")
      retrievalAreas(question.area)
      return question
    }

    /** Writing test questions is for owners of their area, and administrators. */
    const mustMaintain = (area: string) => {
      if (!(isAdmin() || maintains(area)))
        refuse(
          'forbidden',
          'Only the owners of the domain and admins can change its test questions.',
        )
    }
    const activeQuestionsOf = (area: string) =>
      testQuestions().filter(
        (q) => q.area === area && q.status === 'active' && q.setAsideReason === null,
      )
    /** Who reads a run, as the service's rule: its proposal's readers, or its area's maintainers. */
    const runVisible = (run: EvalRun) => {
      const proposal = run.proposalId ? proposals.get(run.proposalId) : undefined
      if (run.proposalId) return proposal ? visible(proposal) : false
      return (
        isAdmin() || run.requestedBy === personId || (run.areaId !== null && maintains(run.areaId))
      )
    }
    /**
     * A run the person may read: a stored one, or a weekly run of mock-quality.ts (of `shared`,
     * the model a read of several runs shares).
     */
    function evalRunOf(
      id: string,
      notFound = (): never => refuse('not-found', "We couldn't find this test run."),
      shared?: ReturnType<typeof createMockQuality>,
    ): EvalRunDetail {
      const stored = runs.get(id)
      if (stored) return runVisible(stored.run) ? stored : notFound()
      const model = shared ?? quality()
      let area: string
      try {
        area = model.areaOfRun(id)
      } catch {
        return notFound()
      }
      if (!(isAdmin() || maintains(area))) return notFound()
      const point = model.history([area], 10_000).find((candidate) => candidate.run === id)
      if (!point) return notFound()
      return runDetail(
        weeklyRun(point, digestOf),
        activeQuestionsOf(area),
        MOCK_TRY_MICROS,
        model.weekly(id),
      )
    }

    /**
     * The expected items a run's edition gave a question, on the run's day. A review-screen run
     * passes every question (it is recorded so), so it was given them all.
     */
    function deliveredIn(run: EvalRun): (question: TestQuestion) => readonly string[] {
      const edition = editions.find((candidate) => candidate.label === run.edition)
      if (run.proposalId || !edition) return (question) => question.expected.must_deliver
      return quality().delivered(edition, (run.finishedAt ?? run.createdAt).slice(0, 10))
    }

    /**
     * An edition's newest retrieval pass as the service stores it (mock-quality.ts, `passOf`): a
     * question passes when the edition delivers every item it expects, for each wording.
     */
    function retrievalRun(edition: Edition, areas: string[] | null) {
      const inScope = testQuestions().filter(
        (question) =>
          question.status === 'active' && (areas === null || areas.includes(question.area)),
      )
      const checked = inScope.filter((question) => question.setAsideReason === null)
      const model = quality()
      const pass = model.passOf(edition)
      const deliver = model.delivered(edition, pass.asOf)
      const results = checked.map((question) => {
        const given = deliver(question)
        // The scripted agent is given the status a question expects, or matched when it was
        // given what it expects (mock-runs.ts).
        const status =
          question.expected.status ??
          (given.length || !question.expected.must_deliver.length ? 'matched' : 'no_match')
        const checks = retrievalChecks(question.expected, { status, delivered: given })
        const passed = Object.values(checks).every(Boolean)
        return { question, given, status, checks, passed }
      })
      const failed = (check: keyof RetrievalChecks) =>
        results.filter((result) => result.checks[check] === false).length
      return {
        id: pass.id,
        edition: edition.label,
        asOf: pass.asOf,
        trigger: pass.trigger,
        createdAt: pass.createdAt,
        testSetDigest: digestOf(checked.map((q) => `${q.id}:${q.revision}`).join(',')),
        questions: checked.length,
        passed: results.filter((result) => result.passed).length,
        failed: results.filter((result) => !result.passed).length,
        setAside: inScope.length - checked.length,
        failedChecks: {
          served: failed('served'),
          delivered: failed('delivered'),
          not_delivered: failed('not_delivered'),
          status: failed('status'),
        },
        results: results.map(({ question, given, status, checks, passed }) => ({
          id: question.id,
          revision: question.revision,
          area: question.area,
          split: question.split,
          passed,
          checks,
          wordings: question.wordings.map(() => ({
            passed,
            status,
            missing: question.expected.must_deliver.filter((id) => !given.includes(id)),
            forbidden: [],
          })),
        })),
      }
    }
    /** Accepted proposals are public; other proposals need authorship or a review role. */
    const visible = (stored: Pick<ProposalRecord, 'state' | 'proposerId' | 'areaId'>) =>
      stored.state === 'accepted' ||
      stored.proposerId === personId ||
      rolesIn(stored.areaId).size > 0 ||
      isAdmin()

    function readableProposals(): ProposalRecord[] {
      return [
        ...[...proposals.values()].filter((p) => !p.discardedAt).map(record),
        ...[...retirements.values()].map((p) => {
          const {
            termKey: _term,
            riskLevel: _risk,
            submittedAt: _submitted,
            closedAt: _closed,
            ...proposal
          } = p
          return {
            ...proposal,
            draft: {},
            provenance: null,
            findings: [],
            vocabulary: null,
            updatedAt: p.createdAt,
          }
        }),
        ...seededProposals,
        ...[...termProposals.values()].map(({ record }) => structuredClone(record)),
      ].filter(visible)
    }

    function find(id: string): StoredProposal {
      const stored = proposals.get(id)
      if (!stored || stored.discardedAt || !visible(stored))
        return refuse('not-found', refusals.notFound)
      return stored
    }
    function current(id: string, revision: number): StoredProposal {
      const stored = find(id)
      if (stored.revision !== revision)
        refuse(
          'conflict',
          'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
          { current: record(stored) },
        )
      return stored
    }
    function proposerOnly(stored: StoredProposal) {
      if (stored.proposerId !== personId) refuse('forbidden', refusals.forbidden)
    }
    function owner(areaId: string, actor = personId) {
      const roles = actor === personId ? rolesIn(areaId) : as(actor).rolesIn(areaId)
      if (!roles.has('owner')) refuse('forbidden', 'Only an owner of this domain can do this.')
    }
    function event(stored: StoredProposal, kind: string, data: Record<string, unknown> = {}) {
      const list = events.get(stored.id) ?? []
      list.push({ id: uuid(), at: now(), actorId: personId, kind, data })
      events.set(stored.id, list)
      proposalPosted(stored, kind, personId, data)
    }
    /**
     * Any proposal the person may read, whatever it changes (an item, a retirement, a re-check or
     * a term), for its discussion: the proposal, what it is about, its record as the service
     * returns it, and a step of its revision.
     */
    function discussed(id: string): {
      proposal: Proposal & { proposerId: string }
      subject: 'item' | 'vocabulary'
      record: () => ProposalRecord
      bump: () => void
    } {
      const item = proposals.get(id)
      if (item) {
        const stored = find(id)
        return {
          proposal: stored,
          subject: 'item',
          record: () => record(stored),
          bump: () => update(stored, {}),
        }
      }
      const term = termProposals.get(id)
      if (term && visible(term.record))
        return {
          proposal: term.record,
          subject: 'vocabulary',
          record: () => structuredClone(term.record),
          bump: () =>
            Object.assign(term.record, { revision: term.record.revision + 1, updatedAt: now() }),
        }
      const retirement = retirements.get(id)
      if (retirement) {
        visibleRetirement(retirement)
        return {
          proposal: retirement,
          subject: 'item',
          record: () =>
            readableProposals().find((candidate) => candidate.id === id) ??
            refuse('not-found', refusals.notFound),
          bump: () => Object.assign(retirement, { revision: retirement.revision + 1 }),
        }
      }
      return refuse('not-found', refusals.notFound)
    }
    /** A reviewer of the proposal: of its area, or an administrator for a term. */
    function reviews(proposal: Pick<Proposal, 'areaId'>, subject: 'item' | 'vocabulary') {
      return rolesIn(proposal.areaId).size > 0 || (subject === 'vocabulary' && isAdmin())
    }
    /** An event on any proposal, as `event` records one on an item proposal. */
    function threadEvent(proposal: Proposal, kind: string, data: Record<string, unknown>) {
      const list = events.get(proposal.id) ?? []
      list.push({ id: uuid(), at: now(), actorId: personId, kind, data })
      events.set(proposal.id, list)
      proposalPosted(proposal, kind, personId, data)
    }
    /** Every change moves the revision on by one, as the database trigger does. */
    function update(stored: StoredProposal, changes: Partial<StoredProposal>) {
      if (
        changes.state &&
        changes.state !== stored.state &&
        !canTransitionProposal(stored.state, changes.state)
      )
        refuse('conflict', `This proposal can't change from ${stored.state} to ${changes.state}.`)
      // FR-524: a proposal that moves to another area leaves the tests of the old one behind.
      if (changes.areaId !== undefined && changes.areaId !== stored.areaId)
        attachedStore.set(
          stored.id,
          (attachedStore.get(stored.id) ?? []).filter(
            (test) => questionStore.get(test.question)?.area === changes.areaId,
          ),
        )
      Object.assign(stored, changes, { revision: stored.revision + 1, updatedAt: now() })
    }

    /**
     * FR-524: the tests attached to a proposal, oldest first, as the service shows them: one held
     * out since only to its area's maintainers.
     */
    function testsOf(stored: StoredProposal): ProposalTest[] {
      return (attachedStore.get(stored.id) ?? [])
        .flatMap(({ question, attachedHour }) => {
          const found = questionStore.get(question)
          if (!found || (found.split === 'held_out' && !isAdmin() && !maintains(found.area)))
            return []
          return [{ question, active: found.status === 'active', attachedHour }]
        })
        .sort(
          (a, b) =>
            a.attachedHour.localeCompare(b.attachedHour) || a.question.localeCompare(b.question),
        )
    }
    /** The active attached questions the checks and answer tests report on. */
    const attachedIds = (stored: StoredProposal) =>
      new Set(
        testsOf(stored)
          .filter((test) => test.active)
          .map((test) => test.question),
      )
    /**
     * The draft's author attaches and detaches while it is a draft; the area's owners
     * and administrators until a decision.
     */
    function attachable(id: string): StoredProposal {
      const stored = find(id)
      if (!open.includes(stored.state))
        refuse('conflict', 'Test questions can be attached only until the proposal is decided.')
      if (stored.state === 'draft' && stored.proposerId === personId) return stored
      if (!isAdmin() && !maintains(stored.areaId))
        refuse(
          'forbidden',
          "The writer attaches test questions while it's a draft. After that, the owners of the domain and admins do, until it's decided.",
        )
      return stored
    }
    /** An attached test's results in the newest checks of the version under review. */
    function attachedResults(stored: StoredProposal): AttachedTest[] {
      let delivery: (LevelResult & { level: 'delivery' })['details'] | undefined
      let answer: (LevelResult & { level: 'answer_impact' })['details'] | undefined
      for (const level of stored.levels) {
        if (level.outcome === 'not_run') continue
        if (level.level === 'delivery') delivery = level.details
        if (level.level === 'answer_impact') answer = level.details
      }
      return testsOf(stored).map((test) => {
        const checked = delivery?.questions?.find((q) => q.id === test.question)
        const answered = answer?.attached?.find((q) => q.id === test.question)
        return {
          ...test,
          retrieval:
            checked?.baseline === undefined || checked.candidate === undefined
              ? null
              : { baseline: checked.baseline, candidate: checked.candidate },
          answer:
            answered && answer?.run
              ? { run: answer.run, baseline: answered.baseline, candidate: answered.candidate }
              : null,
        }
      })
    }

    /**
     * As the service's capacityFor: an owner of the area or an administrator decides, an approver
     * adds the high-risk accept, and the proposer decides their own only as one of the first two.
     */
    function capacityFor(
      areaId: string,
      outcome: DecideInput['outcome'],
      wanted: Capacity | undefined,
      risk: string | null,
      proposerId: string,
    ): Capacity {
      const roles = rolesIn(areaId)
      const admin = isAdmin()
      const choice = wanted ?? (roles.has('owner') ? 'owner' : admin ? 'administrator' : 'approver')
      if (choice === 'administrator' ? !admin : !roles.has(choice))
        refuse(
          'forbidden',
          'Only the owners and approvers of this domain, or an admin, can decide.',
        )
      if (choice === 'approver' && (outcome !== 'accept' || risk !== 'high'))
        refuse('forbidden', 'An approver only gives the second yes on a high-risk proposal.')
      if (proposerId === personId && !admin && !roles.has('owner'))
        refuse(
          'forbidden',
          'You wrote this proposal, so an owner of its domain or an admin decides it.',
        )
      return choice
    }

    function gateOf(stored: StoredProposal): Gate | null {
      if (!stored.itemVersionId || !stored.version) return null
      const accepts = decisions.filter(
        (decision) => decision.versionId === stored.itemVersionId && decision.outcome === 'accept',
      )
      // The first accept is an owner's or an administrator's; one made as deputy, before the role
      // went, counts as an owner's.
      const owner = accepts.some((decision) =>
        ['owner', 'deputy', 'administrator'].includes(decision.capacity),
      )
      const approver =
        stored.version.riskLevel === 'high'
          ? accepts.some((decision) => decision.capacity === 'approver')
          : null
      // The database's own verdict, in its words (cl_item_version_problem).
      const problem = !owner
        ? 'no accept decision by an owner of the domain or an administrator'
        : approver === false
          ? 'high risk needs an accept decision by a named approver'
          : stored.levels.some((level) => level.outcome !== 'passed')
            ? 'a required check has not passed'
            : null
      return {
        required: stored.levels.map((level) => level.level),
        levels: structuredClone(stored.levels),
        approvals: { owner, approver },
        problem,
        attached: attachedResults(stored),
      }
    }

    /**
     * Levels 2 to 5. Matching and delivery pass, with the probes the service would generate from
     * the item's scope. An area with test questions runs the answer tests, which pass, as a
     * finished run; one without passes the impact level and fails the full set, as on the
     * service with none.
     */
    function runLevels(stored: StoredProposal) {
      const ranAt = now()
      const version = stored.version!
      const edition = liveEdition().label
      const probes = matchingProbes(
        { scope: version.scope, validity: version.validity } as Pick<
          ResolverItem,
          'scope' | 'validity'
        > as ResolverItem,
        { groupsOfMetric: {} },
        terms,
      ).map((probe) => ({
        ...probe,
        scope: {
          ...probe.scope,
          window: { start: probe.scope.window.start, end: probe.scope.window.end ?? '' },
        },
        actual: probe.expect,
        ...(probe.expect === 'delivered'
          ? { match: probe.name === 'all_values' ? ('partial' as const) : ('exact' as const) }
          : {}),
        passed: true,
      }))
      const inside = probes[0]!
      const questions = testQuestions().filter(
        (question) => question.area === version.areaId && question.status === 'active',
      )
      const metrics = new Set(version.scope.metrics.map((key) => key.replace(/^metric:/, '')))
      const affected = questions.filter((question) =>
        (question.scope.metrics ?? []).some((metric) =>
          metrics.has(metric.replace(/^metric:/, '')),
        ),
      )
      const full = version.riskLevel === 'high'
      // FR-524: the attached tests are always planned with the change, and reported only.
      const attached = attachedIds(stored)
      const planned = full
        ? questions
        : questions.filter((question) => affected.includes(question) || attached.has(question.id))
      const run = questions.length ? recordRun(stored, planned, affected) : null
      const reported = run ? run.results.filter((result) => attached.has(result.id)) : []
      const report = reported.length
        ? ` Attached tests, reported only: ${reported
            .map((result) => {
              const change = testChange(
                result.baseline === null ? null : result.baseline === 'pass',
                result.candidate === null ? null : result.candidate === 'pass',
              )
              return `${result.id} ${change ? testChangeWords[change] : 'has no answer to compare'}`
            })
            .join('; ')}.`
        : ''
      const answer = (count: number, message: string) => ({
        edition,
        ...(run ? { run: run.run.id, runState: run.run.state, setAside: 0 } : {}),
        questions: count,
        ...(run ? { estimate: formatUsd(run.run.estimatedCostMicros) } : {}),
        message: message + report,
        ...(reported.length
          ? {
              attached: reported.map(({ id, baseline, candidate }) => ({
                id,
                baseline,
                candidate,
              })),
            }
          : {}),
      })
      const results: LevelResult[] = [
        stored.levels.find((level) => level.level === 'format') ?? {
          level: 'format',
          outcome: 'passed',
          ranAt,
          details: {},
        },
        { level: 'matching', outcome: 'passed', ranAt, details: { edition, probes } },
        {
          level: 'delivery',
          outcome: 'passed',
          ranAt,
          details: {
            probe: {
              question: '',
              metrics: inside.scope.metrics,
              dimension_filters: Object.entries(inside.scope.filters).map(
                ([dimension, values]) => ({ dimension, values }),
              ),
              window: { from: inside.scope.window.start, to: inside.scope.window.start },
            },
            status: 'matched',
            delivered: true,
            cut: false,
            replacedShown: [],
            questions: questions.map((question) => ({
              id: question.id,
              baseline: true,
              candidate: true,
              regression: false,
              ...(attached.has(question.id) ? { attached: true } : {}),
            })),
            note: 'Checked as delivered once nothing stops it.',
          },
        },
        {
          level: 'answer_impact',
          outcome: 'passed',
          ranAt,
          details: answer(
            planned.length,
            affected.length
              ? noneWorseWords(affected.length)
              : 'None of the test questions could change.',
          ),
        },
        questions.length
          ? {
              level: 'answer_full',
              outcome: 'passed',
              ranAt,
              details: answer(
                questions.length,
                `All ${questions.length} test questions of the domain pass.`,
              ),
            }
          : {
              level: 'answer_full',
              outcome: 'failed',
              ranAt,
              details: {
                questions: 0,
                message:
                  "The domain has no active test questions, so this check can't pass. Add test questions first.",
              },
            },
      ]
      stored.levels = requiredLevels(version.riskLevel).map((level) =>
        results.find((result) => result.level === level)!,
      )
    }

    /** A finished answer run of the version: every question passes on both arms. */
    function recordRun(
      stored: StoredProposal,
      questions: readonly TestQuestion[],
      affected: readonly TestQuestion[],
    ): EvalRunDetail {
      const at = now()
      const impact = new Set(affected.map((question) => question.id))
      // Runs count apart from proposals and events, so a world with test questions gives its
      // proposals the same ids as one without.
      const id = `00000000-0000-4000-9000-${(runs.size + 1).toString(16).padStart(12, '0')}`
      const detail: EvalRunDetail = {
        run: {
          id,
          kind: stored.version!.riskLevel === 'high' ? 'full' : 'impact',
          state: 'finished',
          areaId: stored.areaId,
          proposalId: stored.id,
          itemVersionId: stored.itemVersionId,
          edition: liveEdition().label,
          modelId: 'mock-model',
          judgeModelId: 'mock-judge',
          modelProvider: 'mock',
          judgeProvider: 'mock',
          modelFamily: 'mock/model',
          judgeFamily: 'mock/judge',
          judgeSameFamily: false,
          modelVendor: 'mock',
          judgeVendor: 'mock',
          judgeSameVendor: true,
          trigger: null,
          toolSchemaDigest: digestOf('get_context'),
          testSetDigest: digestOf(questions.map((question) => question.id).join(',')),
          tries: 3,
          flipRepeats: 2,
          questions: questions.length,
          setAside: 0,
          estimatedCostMicros: 60_000 * questions.length,
          actualCostMicros: 52_500 * questions.length,
          costCeilingMicros: null,
          passRule: 'majority',
          requestedBy: stored.proposerId,
          approvedBy: null,
          failure: null,
          createdAt: at,
          startedAt: at,
          finishedAt: at,
        },
        results: questions.map((question) => ({
          id: question.id,
          impact: impact.has(question.id),
          baseline: 'pass',
          candidate: 'pass',
          flip: null,
          layers: {
            baseline: { code: 'pass', judge: 'pass', failedChecks: [] },
            candidate: { code: 'pass', judge: 'pass', failedChecks: [] },
          },
        })),
        flips: [],
        levels: {},
        scorecard: null,
        links: null,
        replay: null,
        agreement: null,
        judging: { judged: 0, errors: 0 },
        stopped: null,
        cells: [],
      }
      runs.set(id, detail)
      return detail
    }

    /** The live vocabulary as governed terms, with every term accepted since the world began. */
    const governedTerms = () => [
      ...new Map([...terms, ...acceptedTerms].map((term) => [term.key, term])).values(),
    ]
    const termContext = (key: string, pending: readonly Term[] = []): VocabularyContext => ({
      live: [...governedTerms(), ...pending],
      existing: null,
      definitions: new Map(
        demoDefinitions.map((definition) => [
          definition.ref,
          { kind: definition.kind, missing: false, areaHint: definition.areaHint },
        ]),
      ),
      areas: new Map(world.areas.map((area) => [area.id, area.name])),
      ...(governedTerms().some((term) => term.key === key)
        ? { existing: governedTerms().find((term) => term.key === key)! }
        : {}),
    })
    const termOf = (record: ProposalRecord): VocabularyChange => record.vocabulary!
    /** The term proposals the person may read, as the service's row security has it. */
    const visibleTerms = (rows: { record: ProposalRecord; batchId: string }[]) =>
      rows.filter(({ record }) => visible(record))
    const termRecord = (record: ProposalRecord): ReviewProposal => ({
      id: record.id,
      number: record.number,
      subject: 'vocabulary',
      action: record.action,
      state: record.state,
      areaId: record.areaId,
      itemId: null,
      itemVersionId: null,
      vocabularyVersionId: record.vocabularyVersionId,
      termKey: record.vocabulary?.key ?? null,
      title: record.title,
      riskLevel: null,
      proposerId: record.proposerId,
      channel: record.channel,
      revision: record.revision,
      reason: null,
      claimedBy: null,
      dueAt: record.dueAt,
      submittedAt: record.createdAt,
      closedAt: underReview.includes(record.state) ? null : record.updatedAt,
      createdAt: record.createdAt,
    })
    function termReview({ record, batchId }: { record: ProposalRecord; batchId: string }): Review {
      if (!visible(record)) return refuse('not-found', refusals.notFound)
      const batch = visibleTerms(
        [...termProposals.values()].filter((term) => term.batchId === batchId),
      )
      return {
        proposal: termRecord(record),
        diff: [],
        sinceRequest: null,
        mentions: { added: [], removed: [] },
        warnings: [],
        findings: underReview.includes(record.state)
          ? vocabularyFindings(termOf(record), termContext(termOf(record).key), true)
          : structuredClone(record.findings),
        gate: null,
        decisions: decisions
          .filter((decision) => decision.proposalId === record.id)
          .map(({ proposalId: _proposal, versionId: _version, ...decision }) => decision),
        vocabulary: {
          before: governedTerms().find((term) => term.key === termOf(record).key) ?? null,
          after: structuredClone(termOf(record)),
        },
        termBatch: {
          id: batchId,
          open: batch.filter((term) => underReview.includes(term.record.state)).length,
          total: batch.length,
        },
        rescue: null,
        sourceToolQuestion: SOURCE_TOOL_QUESTION,
        provenance: null,
      }
    }
    /**
     * Accepts or rejects term proposals as the service does (decideTermBatch): an owner of each
     * term's domain, or an administrator, their own too; an accept is one edition, values after
     * their dimension.
     */
    function decideTerms(
      rows: { record: ProposalRecord; batchId: string }[],
      input: Pick<DecideTermBatchInput, 'outcome' | 'reason' | 'capacity'>,
    ): TermBatchDecision {
      rejectSensitive(input.reason)
      rejectMentions(input.reason)
      const order = (record: ProposalRecord) =>
        record.vocabulary?.kind === 'dimension_value'
          ? 2
          : record.vocabulary?.kind === 'metric_group'
            ? 0
            : 1
      const sorted = [...rows].sort(
        (a, b) => order(a.record) - order(b.record) || a.record.number - b.record.number,
      )
      const pending: Term[] = []
      const decided: { record: ProposalRecord; capacity: Capacity }[] = []
      for (const { record } of sorted) {
        const roles = rolesIn(record.areaId)
        const capacity: Capacity | null =
          input.capacity === 'administrator'
            ? isAdmin()
              ? 'administrator'
              : null
            : roles.has('owner')
              ? 'owner'
              : isAdmin()
                ? 'administrator'
                : null
        if (!capacity)
          refuse('forbidden', "Only an owner of this name's domain or an admin can decide it.")
        if (input.outcome === 'accept') {
          const findings = vocabularyFindings(
            termOf(record),
            termContext(termOf(record).key, pending),
            true,
          ).filter((finding) => finding.severity === 'error')
          if (findings.length)
            refuse('invalid', 'Fix the problems with this name first.', { findings })
          pending.push(structuredClone(termOf(record)))
        }
        decided.push({ record, capacity })
      }
      const edition =
        input.outcome === 'accept'
          ? publish({
              reason: 'vocabulary_changed',
              actorId: personId,
              note: null,
              restores: null,
            })
          : null
      if (edition) acceptedTerms.push(...pending)
      const at = now()
      return {
        proposals: decided.map(({ record, capacity }) => {
          const decision: StoredDecision = {
            id: uuid(),
            proposalId: record.id,
            versionId: record.vocabularyVersionId!,
            decidedBy: personId,
            capacity,
            outcome: input.outcome,
            reason: input.reason,
            decidedAt: at,
          }
          decisions.push(decision)
          Object.assign(record, {
            state: input.outcome === 'accept' ? 'accepted' : 'rejected',
            revision: record.revision + 1,
            updatedAt: at,
          })
          return termRecord(record)
        }),
        edition,
      }
    }

    /** The review screen's data for one proposal (review.get). */
    function reviewOf(stored: StoredProposal): Review {
      const after =
        stored.version ?? formatDraft(stored.draft, stored.proposerId, stored.channel).version
      const before = stored.base
      // A resubmission: what changed since the newest request for changes (heed-ux B2).
      const asked = underReview.includes(stored.state)
        ? decisions.findLast(
            (decision) =>
              decision.proposalId === stored.id && decision.outcome === 'request_changes',
          )
        : undefined
      const askedOn = asked ? submittedVersions.get(asked.versionId) : undefined
      return {
        proposal: reviewRecord(stored),
        diff: after ? versionDiff(before, after) : [],
        sinceRequest:
          asked && askedOn && after && asked.versionId !== stored.itemVersionId
            ? { decisionId: asked.id, diff: versionDiff(askedOn, after) }
            : null,
        mentions: after
          ? mentionDiff(before?.mentions ?? [], after.mentions)
          : { added: [], removed: [] },
        warnings: [],
        findings: structuredClone(stored.findings),
        gate: gateOf(stored),
        decisions: decisions
          .filter((decision) => decision.proposalId === stored.id)
          .map(({ proposalId: _proposal, versionId: _version, ...decision }) => decision),
        vocabulary: null,
        termBatch: null,
        rescue: rescueNote(stored.id),
        sourceToolQuestion: SOURCE_TOOL_QUESTION,
        provenance: structuredClone(stored.provenance),
      }
    }

    /** A retirement someone proposed, as its proposer or a reviewer of its area sees it. */
    function visibleRetirement(proposal: ReviewProposal): ReviewProposal {
      if (proposal.proposerId !== personId && rolesIn(proposal.areaId).size === 0 && !isAdmin())
        return refuse('not-found', refusals.notFound)
      return proposal
    }

    /** review.get for a retirement: the status the item moves to, and no checks. */
    function retirementReview(proposal: ReviewProposal): Review {
      visibleRetirement(proposal)
      return {
        proposal: structuredClone(proposal),
        diff: [{ field: 'status', before: 'accepted', after: 'retired' }],
        sinceRequest: null,
        mentions: { added: [], removed: [] },
        warnings: [],
        findings: [],
        gate: null,
        decisions: decisions
          .filter((decision) => decision.proposalId === proposal.id)
          .map(({ proposalId: _proposal, versionId: _version, ...decision }) => decision),
        vocabulary: null,
        termBatch: null,
        rescue: null,
        sourceToolQuestion: SOURCE_TOOL_QUESTION,
        provenance: null,
      }
    }

    /** An owner retires the item (it publishes an edition) or rejects the proposal. */
    function decideRetirement(proposal: ReviewProposal, input: DecideInput): DecisionResult {
      visibleRetirement(proposal)
      if (proposal.revision !== input.revision)
        refuse(
          'conflict',
          'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
        )
      if (!underReview.includes(proposal.state))
        refuse('conflict', 'This proposal no longer waits for a decision.')
      if (input.outcome === 'request_changes')
        refuse('conflict', 'A proposal to archive a fact can only be accepted or rejected.')
      rejectSensitive(input.reason)
      rejectMentions(input.reason)
      const capacity = capacityFor(
        proposal.areaId!,
        input.outcome,
        input.capacity,
        null,
        proposal.proposerId,
      )
      const at = now()
      decisions.push({
        id: uuid(),
        proposalId: proposal.id,
        versionId: proposal.itemVersionId ?? proposal.id,
        decidedBy: personId,
        capacity,
        outcome: input.outcome === 'accept' ? 'retire' : 'reject',
        reason: input.reason,
        decidedAt: at,
      })
      Object.assign(proposal, {
        state: input.outcome === 'accept' ? 'accepted' : 'rejected',
        revision: proposal.revision + 1,
        closedAt: at,
      })
      if (input.outcome !== 'accept') return { proposal: structuredClone(proposal), edition: null }
      const retired = liveItem(proposal.itemId!)
      if (retired)
        noteRetired(retired.id, retired.version, {
          proposal: { id: proposal.id, number: proposal.number },
          proposerId: proposal.proposerId,
          channel: proposal.channel,
          editedBy: null,
          decisions: [
            {
              decidedBy: personId,
              capacity,
              outcome: 'retire',
              reason: input.reason,
              decidedAt: at,
            },
          ],
        })
      const edition = publish(
        { reason: 'item_retired', actorId: personId, note: input.reason, restores: null },
        { items: [[proposal.itemId!, null]] },
      )
      return { proposal: structuredClone(proposal), edition }
    }

    /** An open proposal that overlaps, as proposals.overlap lists it. */
    const overlapping = (other: StoredProposal) => ({
      id: other.id,
      number: other.number,
      title: other.version?.title ?? other.draft.title ?? 'Untitled proposal',
      kind: other.version?.kind ?? other.draft.kind ?? 'note',
      state: other.state,
    })

    function claim({ id, revision }: ProposalMutation, recipient?: string): ProposalRecord {
      const stored = current(id, revision)
      owner(stored.areaId)
      if (!underReview.includes(stored.state))
        refuse(
          'conflict',
          'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
        )
      if (stored.claimedBy && stored.claimedBy !== personId)
        refuse('conflict', 'Another owner is already reviewing this proposal.')
      if (recipient) {
        if (stored.state !== 'in_review' || stored.claimedBy !== personId)
          refuse(
            'conflict',
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
          )
        owner(stored.areaId, recipient)
      }
      update(stored, { state: 'in_review', claimedBy: recipient ?? personId })
      event(stored, recipient ? 'handed_over' : 'claimed', { personId: recipient ?? personId })
      return record(stored)
    }

    /** A proposal of the review queue the person may read, whatever it changes. */
    function bulkReview(
      id: string,
    ): { review: ReviewProposal; stored: StoredProposal | null } | null {
      const stored = proposals.get(id)
      if (stored)
        return !stored.discardedAt && visible(stored)
          ? { review: reviewRecord(stored), stored }
          : null
      const retirement = retirements.get(id)
      if (retirement?.action === 'retire')
        return retirement.proposerId === personId ||
          rolesIn(retirement.areaId).size > 0 ||
          isAdmin()
          ? { review: structuredClone(retirement), stored: null }
          : null
      const term = termProposals.get(id)
      if (term && visible(term.record)) return { review: termRecord(term.record), stored: null }
      return null
    }
    /**
     * Whether a bulk decision may decide one proposal and what it would do (FR-223), with the
     * service's rules in its order: a proposal the person proposed is left out unless they are an
     * administrator or an owner of its domain, and so is an accept with a failed required check
     * or answer tests that have not passed yet.
     */
    function bulkCheck(
      target: { id: string; revision: number },
      outcome: BulkPlanInput['outcome'],
    ): { review: ReviewProposal; effect: BulkEffect } | BulkSkip {
      const known = bulkReview(target.id)
      if (!known)
        return {
          id: target.id,
          number: null,
          title: null,
          code: 'not_found',
          message: bulkSkipWords.notFound,
        }
      const { review, stored } = known
      const skip = (code: BulkSkip['code'], message: string): BulkSkip => ({
        id: review.id,
        number: review.number,
        title: review.title,
        code,
        message,
      })
      if (review.revision !== target.revision) return skip('changed', bulkSkipWords.changed)
      if (!underReview.includes(review.state)) return skip('not_waiting', bulkSkipWords.notWaiting)
      const roles = rolesIn(review.areaId)
      const decidesAny = isAdmin() || roles.has('owner')
      if (review.proposerId === personId && !decidesAny) return skip('own', bulkSkipWords.own)
      const decides: BulkEffect = outcome === 'accept' ? 'publish' : 'decide'
      if (review.subject === 'vocabulary') {
        if (outcome === 'request_changes') return skip('not_allowed', bulkSkipWords.termChanges)
        if (!decidesAny) return skip('forbidden', bulkSkipWords.termDecider)
        return { review, effect: decides }
      }
      const approves = roles.has('approver') && outcome === 'accept' && review.riskLevel === 'high'
      if (!decidesAny && !approves) return skip('forbidden', bulkSkipWords.itemDecider)
      if (review.action === 'retire') {
        if (outcome === 'request_changes')
          return skip('not_allowed', bulkSkipWords.retirementChanges)
        return { review, effect: decides }
      }
      const onlyApprover = approves && !decidesAny
      if (review.claimedBy && review.claimedBy !== personId && !onlyApprover)
        return skip('claimed', bulkSkipWords.claimed)
      if (outcome !== 'accept') return { review, effect: 'decide' }
      const gate = stored ? gateOf(stored) : null
      const failed = gate?.levels.filter((level) => level.outcome === 'failed') ?? []
      if (failed.length) return skip('checks_failed', bulkSkipWords.failed(levelList(failed)))
      const waiting =
        gate?.levels.filter(
          (level) =>
            (level.level === 'answer_impact' || level.level === 'answer_full') &&
            level.outcome !== 'passed',
        ) ?? []
      if (waiting.length) return skip('checks_waiting', bulkSkipWords.waiting(levelList(waiting)))
      // A second owner's accept adds nothing: the approver's is the one still needed.
      if (gate?.approvals.owner && !onlyApprover)
        return skip('not_waiting', bulkSkipWords.approverNext)
      const approverNext = review.riskLevel === 'high' && !gate?.approvals.approver && !onlyApprover
      return { review, effect: approverNext ? 'wait' : 'publish' }
    }
    /** Leaves out an accept of an item that an earlier proposal of the same step already takes. */
    function bulkSameItem(
      review: ReviewProposal,
      outcome: BulkPlanInput['outcome'],
      taken: Set<string>,
    ): BulkSkip | null {
      if (outcome !== 'accept' || !review.itemId) return null
      if (taken.has(review.itemId))
        return {
          id: review.id,
          number: review.number,
          title: review.title,
          code: 'refused',
          message: bulkSkipWords.sameItem,
        }
      taken.add(review.itemId)
      return null
    }
    /** How many editions the accepts of a bulk decision publish: one per kind of change. */
    const bulkEditionCount = (decided: readonly { review: ReviewProposal; effect: BulkEffect }[]) =>
      new Set(
        decided
          .filter((entry) => entry.effect === 'publish')
          .map(({ review }) =>
            review.subject === 'vocabulary'
              ? 'terms'
              : review.action === 'retire'
                ? 'retire'
                : 'items',
          ),
      ).size

    /**
     * Items of a deleted domain fitted to the domain `areaId`, as the service fits them (bin.ts,
     * `fit`): each one's last content, the changes it needs and why one cannot go. The mock's
     * vocabulary keeps its fixture terms, and it holds no definition rows, so a reference stays.
     */
    function fitRescues(records: readonly BinRecord[], areaId: string) {
      const area =
        world.areas.find((candidate) => candidate.id === areaId) ??
        refuse('invalid', 'Choose a domain that exists.')
      const items = new Set(
        liveItems(world.items())
          .filter((item) => item.status === 'accepted')
          .map((item) => item.id),
      )
      const terms = new Set([...vocabularyKeys, ...latestTerms().map((term) => term.key)])
      return records.map((record) => {
        const item = libraryItem(record.entry.itemId)!
        const content = { ...item, ...record.served?.patch }
        const draft = draftOfItem(content)
        const rescue = rescueDraft(draft, item.id, {
          today: world.today,
          from: { name: deletedAreas.get(record.entry.areaId)! },
          to: { id: area.id, name: area.name, owners: area.ownerIds },
          terms,
          definitions: new Set(draft.references ?? []),
          items,
          areas: new Set(world.areas.map((candidate) => candidate.id)),
          personName,
          termName: (key) => termNames.get(key) ?? key,
          itemTitle: (id) => libraryItem(id)?.title ?? id,
        })
        const problem =
          rescue.problem ??
          checkDraft(defaults(rescue.draft), personId, 'form').findings.find(
            (finding) => finding.severity === 'error',
          )?.message ??
          null
        return {
          record,
          rescue: { ...rescue, problem },
          base: formatDraft(draft, content.proposerId, content.createdVia).version,
        }
      })
    }

    const inbox = outbox.inboxOf(personId)
    const actions = {
      rolesIn,
      session: () => ({ person: me(), csrfToken: `mock-csrf-${personId}` }),

      listInbox: (params?: InboxListParams) => inbox.list(params),
      markInboxRead: (input: InboxIds) => inbox.markRead(input),
      markAllInboxRead: () => inbox.markAllRead(),
      archiveInbox: (input: InboxIds) => inbox.archive(input),
      streamEvents: (options: { lastEventId?: string; signal: AbortSignal }) =>
        outbox.stream(personId, options),

      listProposals(params: ProposalListParams = {}): ProposalListResult {
        const { areaId, state, own, itemId, limit = 50, offset = 0 } = params
        const matches = readableProposals()
          .filter(
            (stored) =>
              (areaId === undefined || stored.areaId === areaId) &&
              (state === undefined || stored.state === state) &&
              (!own || stored.proposerId === personId) &&
              (itemId === undefined || stored.itemId === itemId),
          )
          .sort(
            (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id),
          )
        return {
          rows: structuredClone(matches.slice(offset, offset + limit)),
          total: matches.length,
          limit,
          offset,
        }
      },

      getProposal: (id: string) =>
        structuredClone(
          readableProposals().find((p) => p.id === id) ?? refuse('not-found', refusals.notFound),
        ),

      previewProposal(input: PreviewInput) {
        const p = find(input.id)
        const checked = previewVersion(p.draft, p.proposerId, p.channel)
        if (!checked.version)
          return refuse('invalid', 'Complete the draft to see what AI apps will get.', {
            findings: checked.findings,
          })
        return {
          proposalId: p.id,
          revision: p.revision,
          result: mockPreview(world, checked.version, input, liveEdition().label, previewItemId(p)),
        }
      },

      getProposalOverlap(id: string): ProposalOverlap {
        const p = find(id)
        const others = [...proposals.values()].filter(
          (other) =>
            other.id !== id &&
            !other.discardedAt &&
            open.includes(other.state) &&
            draftsOverlap(p.draft, other.draft),
        )
        return {
          accepted: world
            .items()
            .filter(
              (item) =>
                item.status === 'accepted' &&
                item.id !== p.itemId &&
                draftsOverlap(p.draft, draftOfItem(item)),
            )
            .map(({ id, title, kind }) => ({ id, title, kind })),
          ownProposals: others.filter((other) => other.proposerId === personId).map(overlapping),
          // A reviewer of the other proposal's area sees it; a draft stays with its writer.
          otherProposals: others
            .filter(
              (other) => other.proposerId !== personId && other.state !== 'draft' && visible(other),
            )
            .map(overlapping),
          otherProposalExists: others.some((other) => other.proposerId !== personId),
        }
      },

      /**
       * `provenance` stands in for the service's agent drafts (FR-121): only the demo seed passes
       * it, as only the service's own tools do; the API binding never does.
       */
      createProposal(
        input: CreateProposalInput,
        options: { provenance?: (draft: Draft) => Provenance } = {},
      ): ProposalRecord {
        let source: Draft = {}
        let itemId: string | null = input.itemId ?? null
        let base: ItemVersion | null = null
        if (input.itemId) {
          const item = world.items().find((candidate) => candidate.id === input.itemId)
          if (!item || item.status !== 'accepted') return refuse('not-found', refusals.notFound)
          source = draftOfItem(item)
          base = formatDraft(source, item.proposerId, item.createdVia).version
        }
        if (input.derivedFrom) {
          const prior = find(input.derivedFrom)
          proposerOnly(prior)
          if (prior.state !== 'rejected')
            refuse('conflict', 'You can start a new draft only from a rejected proposal.')
          if (input.itemId && (prior.action !== 'change' || input.itemId !== prior.itemId))
            refuse('conflict', 'That proposal is about a different fact.')
          itemId = prior.action === 'change' ? prior.itemId : null
          base = prior.action === 'change' ? prior.base : null
          source = prior.draft
        }
        const draft = defaults({ ...source, ...input.draft })
        const channel = input.channel ?? 'form'
        const { findings } = checkDraft(draft, personId, channel)
        rejectSensitive(draft)
        const action = itemId ? 'change' : 'create'
        const reason = changeReason(input.reason, action)
        const at = now()
        const stored: StoredProposal = {
          subject: 'item',
          vocabularyVersionId: null,
          vocabulary: null,
          title: draft.title ?? 'Untitled proposal',
          id: uuid(),
          number: lastSeedNumber + proposals.size + retirements.size + termProposals.size + 1,
          action,
          state: 'draft',
          areaId: draft.areaId!,
          itemId,
          itemVersionId: null,
          proposerId: personId,
          channel,
          revision: 1,
          draft,
          provenance: options.provenance ? options.provenance(draft) : null,
          findings,
          claimedBy: null,
          dueAt: null,
          createdAt: at,
          updatedAt: at,
          reason,
          submittedAt: null,
          closedAt: null,
          base,
          version: null,
          levels: [],
          discardedAt: null,
        }
        proposals.set(stored.id, stored)
        event(stored, 'created')
        return record(stored)
      },

      /** `reason` left out keeps the stored one; null or empty clears it. */
      saveDraft({
        id,
        revision,
        draft: input,
        reason: reasonInput,
      }: SaveDraftInput): ProposalRecord {
        const stored = current(id, revision)
        proposerOnly(stored)
        if (!['draft', 'changes_requested'].includes(stored.state))
          refuse('conflict', 'You can only edit a draft, or a proposal sent back for changes.')
        const draft = defaults(input, stored.areaId)
        rejectSensitive(draft)
        const reason =
          reasonInput === undefined ? stored.reason : changeReason(reasonInput, stored.action)
        const { findings } = checkDraft(draft, personId, stored.channel)
        // A field the person changed is theirs from now on: it loses the agent's mark (FR-121).
        const provenance = stored.provenance
          ? keepMarks(stored.provenance, stored.draft, draft)
          : null
        update(stored, { draft, areaId: draft.areaId!, findings, provenance, reason })
        event(stored, 'saved')
        return record(stored)
      },

      submitProposal({ id, revision }: ProposalMutation): ProposalRecord {
        const stored = current(id, revision)
        proposerOnly(stored)
        if (!['draft', 'changes_requested'].includes(stored.state))
          refuse(
            'conflict',
            'Only a draft, or a proposal sent back for changes, can be sent for review.',
          )
        const { findings, version } = checkDraft(stored.draft, personId, stored.channel)
        if (!version || findings.some((finding) => finding.severity === 'error'))
          refuse('invalid', 'Fix the problems shown before you send it for review.', { findings })
        if (stored.action === 'change' && stored.base?.kind !== version.kind)
          refuse('conflict', "The accepted fact is gone, or it's now a different kind.")
        const at = now()
        const versionId = uuid()
        update(stored, {
          state: 'submitted',
          itemId: stored.itemId ?? newItemId(),
          itemVersionId: versionId,
          submittedAt: at,
          dueAt: addWorkingDays(at, REVIEW_DAYS),
          claimedBy: null,
          findings,
          version,
          levels: [
            {
              level: 'format',
              outcome: formatOutcome(findings),
              ranAt: at,
              details: { findings },
            },
          ],
        })
        submittedVersions.set(versionId, version)
        event(stored, 'submitted', { versionId })
        event(stored, 'checked', { level: 'format', findings })
        runLevels(stored)
        event(stored, 'checked', {
          levels: Object.fromEntries(
            stored.levels
              .filter((level) => level.level === 'matching' || level.level === 'delivery')
              .map((level) => [level.level, level.outcome]),
          ),
        })
        return record(stored)
      },

      withdrawProposal({ id, revision, reason }: WithdrawInput): ProposalRecord {
        const term = termProposals.get(id)
        if (term) {
          const record = visibleTerms([term])[0]?.record ?? refuse('not-found', refusals.notFound)
          if (record.revision !== revision)
            refuse(
              'conflict',
              'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
              {
                current: structuredClone(record),
              },
            )
          if (record.proposerId !== personId) refuse('forbidden', refusals.forbidden)
          if (!underReview.includes(record.state))
            refuse(
              'conflict',
              'The proposal, or what AI apps get, changed after you opened it. Look at the latest version, then try again.',
            )
          rejectSensitive(reason)
          rejectMentions(reason)
          Object.assign(record, {
            state: 'withdrawn',
            reason,
            revision: record.revision + 1,
            updatedAt: now(),
          })
          return structuredClone(record)
        }
        const stored = current(id, revision)
        proposerOnly(stored)
        if (!['submitted', 'in_review', 'changes_requested'].includes(stored.state))
          refuse(
            'conflict',
            'The proposal, or what AI apps get, changed after you opened it. Look at the latest version, then try again.',
          )
        rejectSensitive(reason)
        rejectMentions(reason)
        update(stored, { state: 'withdrawn', closedAt: now(), reason })
        event(stored, 'withdrawn', { reason })
        return record(stored)
      },

      discardDraft({ id, revision }: ProposalMutation): DiscardedDraft {
        const stored = current(id, revision)
        if (stored.proposerId !== personId && !isAdmin()) refuse('forbidden', refusals.forbidden)
        if (stored.state !== 'draft')
          refuse(
            'conflict',
            'Only a draft can be discarded. To take back a proposal you sent, withdraw it.',
          )
        update(stored, { discardedAt: now() })
        event(stored, 'discarded')
        return { id, discardedAt: stored.discardedAt! }
      },

      commentOnProposal({ id, revision, text, replyTo }: CommentInput): ProposalRecord {
        const thread = discussed(id)
        const target = thread.proposal
        if (target.revision !== revision)
          refuse(
            'conflict',
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
            { current: thread.record() },
          )
        if (target.proposerId !== personId && !reviews(target, thread.subject))
          refuse(
            'forbidden',
            'Only the writer and the owners of its domain can comment on a proposal.',
          )
        if (!open.includes(target.state))
          refuse(
            'conflict',
            'The proposal, or what AI apps get, changed after you opened it. Look at the latest version, then try again.',
          )
        rejectSensitive(text)
        rejectMentions(text)
        if (
          replyTo &&
          !(events.get(id) ?? []).some(
            (entry) => entry.id === replyTo && entry.kind === 'commented',
          )
        )
          refuse('not-found', refusals.notFound)
        thread.bump()
        threadEvent(target, 'commented', { text, ...(replyTo ? { replyTo } : {}) })
        return thread.record()
      },

      claimProposal: (mutation: ProposalMutation) => claim(mutation),

      handOverProposal({ personId: recipient, ...mutation }: HandOverInput): ProposalRecord {
        return claim(mutation, recipient)
      },

      listProposalEvents(id: string): ProposalEvent[] {
        const { proposal, subject } = discussed(id)
        // The discussion is the proposer's and the reviewers' (row security on the service).
        const discusses =
          proposal.proposerId === personId || isAdmin() || reviews(proposal, subject)
        return structuredClone(
          (events.get(id) ?? []).filter((entry) => discusses || entry.kind !== 'commented'),
        )
      },

      listProposalTests(id: string): ProposalTest[] {
        return testsOf(find(id))
      },

      /**
       * FR-524: attaches a test question of the proposal's area to its check. A held-out one is
       * never attached (FR-503), and is not found for anyone but its area's maintainers.
       */
      attachProposalTest({ id, question }: ProposalTestInput): ProposalTest[] {
        const stored = attachable(id)
        const found = questionStore.get(question)
        if (!found || (found.split === 'held_out' && !isAdmin() && !maintains(found.area)))
          return refuse('not-found', "We couldn't find this test question, or you can't see it.")
        if (found.split === 'held_out')
          refuse('invalid', "A hidden test question can't be attached to a proposal.")
        if (found.area !== stored.areaId)
          refuse('invalid', 'This test question belongs to another domain than the proposal.')
        if (found.status !== 'active')
          refuse('invalid', 'Only an active test question can be attached.')
        const tests = attachedStore.get(id) ?? []
        if (!tests.some((test) => test.question === question))
          attachedStore.set(id, [...tests, { question, attachedHour: hourOf(now()) }])
        return testsOf(stored)
      },

      detachProposalTest({ id, question }: ProposalTestInput): ProposalTest[] {
        const stored = attachable(id)
        attachedStore.set(
          id,
          (attachedStore.get(id) ?? []).filter((test) => test.question !== question),
        )
        return testsOf(stored)
      },

      listReviewQueue({ areaId, limit = 50, offset = 0 }: QueueParams = {}): QueueEntry[] {
        return [...proposals.values()]
          .filter((stored) => {
            if (!underReview.includes(stored.state)) return false
            if (areaId !== undefined && stored.areaId !== areaId) return false
            const roles = rolesIn(stored.areaId)
            return (
              isAdmin() ||
              roles.has('owner') ||
              (stored.version?.riskLevel === 'high' && roles.has('approver'))
            )
          })
          .map((stored): QueueEntry => {
            const gate = gateOf(stored)
            return {
              ...reviewRecord(stored),
              checks: gate
                ? {
                    failed: gate.levels.filter((l) => l.outcome === 'failed').map((l) => l.level),
                    waiting: gate.levels
                      .filter((l) => l.outcome !== 'passed' && l.outcome !== 'failed')
                      .map((l) => l.level),
                  }
                : null,
            }
          })
          .concat(
            [...retirements.values()]
              .filter(
                (proposal) =>
                  proposal.action === 'retire' &&
                  underReview.includes(proposal.state) &&
                  (areaId === undefined || proposal.areaId === areaId) &&
                  (isAdmin() || rolesIn(proposal.areaId).has('owner')),
              )
              .map((proposal): QueueEntry => ({ ...structuredClone(proposal), checks: null })),
          )
          .concat(
            // Terms: an owner of the term's domain, or an administrator (as the service's queue
            // has it).
            [...termProposals.values()]
              .map(({ record }) => record)
              .filter(
                (record) =>
                  underReview.includes(record.state) &&
                  (areaId === undefined || record.areaId === areaId) &&
                  (rolesIn(record.areaId).has('owner') || isAdmin()),
              )
              .map((record): QueueEntry => ({ ...termRecord(record), checks: null })),
          )
          .sort(
            (a, b) =>
              riskOrder[a.riskLevel ?? 'low'] - riskOrder[b.riskLevel ?? 'low'] ||
              (a.submittedAt ?? '').localeCompare(b.submittedAt ?? '') ||
              (a.id < b.id ? -1 : 1),
          )
          .slice(offset, offset + limit)
          .map((proposal) => structuredClone(proposal))
      },

      getReview(id: string): Review {
        const retirement = retirements.get(id)
        if (retirement?.action === 'retire') return retirementReview(retirement)
        const term = termProposals.get(id)
        if (term) return termReview(term)
        return reviewOf(find(id))
      },

      /** An answer run of a version the person may read, as evals.runs.get answers. */
      getEvalRun(id: string): EvalRunDetail {
        return structuredClone(evalRunOf(id))
      },

      /** The newest retrieval pass of the live edition (evals.retrieval.latest). */
      getRetrievalLatest({ area }: RetrievalAreaParams = {}): RetrievalEdition {
        const areas = retrievalAreas(area)
        const live = liveEdition()
        return { edition: live.label, run: retrievalRun(live, areas) }
      },

      /** One sealed edition's retrieval pass (evals.retrieval.edition). */
      getRetrievalEdition({ label, area }: RetrievalEditionParams): RetrievalEdition {
        const areas = retrievalAreas(area)
        const edition = editions.find((candidate) => candidate.label === label)
        if (!edition) return refuse('not-found', "We couldn't find these test results.")
        return { edition: label, run: retrievalRun(edition, areas) }
      },

      /** One point per edition, newest first (evals.retrieval.trend). */
      getRetrievalTrend({ area, limit = 52 }: RetrievalTrendParams = {}): RetrievalPoint[] {
        const areas = retrievalAreas(area)
        return [...editions]
          .sort((a, b) => b.seq - a.seq)
          .slice(0, limit)
          .map((edition) => {
            const { results: _results, ...point } = retrievalRun(edition, areas)
            return point
          })
      },

      /** The test questions, held-out ones only for an owner of their area. */
      listTestQuestions({ area, status }: TestQuestionListParams = {}): TestQuestion[] {
        return structuredClone(
          testQuestions().filter(
            (question) =>
              (area === undefined || question.area === area) &&
              (status === undefined || question.status === status) &&
              (question.split === 'development' ||
                isAdmin() ||
                rolesIn(question.area).has('owner')),
          ),
        )
      },

      /** An owner changes a proposal under review, as review.edit does. */
      editReview(input: ReviewEditInput): Review {
        const stored = find(input.id)
        if (stored.revision !== input.revision)
          refuse(
            'conflict',
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
          )
        if (!stored.itemVersionId || !stored.version)
          refuse('conflict', 'Only a proposal for a new or changed fact can be edited in review.')
        if (!underReview.includes(stored.state))
          refuse('conflict', "This proposal isn't in review any more.")
        if (input.reason !== undefined) {
          rejectSensitive(input.reason)
          rejectMentions(input.reason)
        }
        const current = stored.version
        const roles = rolesIn(current.areaId)
        if (!roles.has('owner'))
          refuse('forbidden', 'Only an owner of the domain can edit a proposal in review.')
        if (current.proposerId === personId)
          refuse('forbidden', 'You wrote this proposal, so another owner edits it in review.')
        if (stored.claimedBy && stored.claimedBy !== personId)
          refuse('conflict', 'Another owner is already reviewing this proposal.')
        const areaId = input.areaId ?? current.areaId
        const target = world.areas.find((area) => area.id === areaId)
        if (!target) return refuse('invalid', 'Choose an active domain.')
        const moved = areaId !== current.areaId
        if (moved) {
          const there = rolesIn(areaId)
          if (!there.has('owner') && !isAdmin())
            refuse(
              'forbidden',
              `Moving this proposal to ${target.name} also needs an owner of ${target.name}, or an admin.`,
            )
        }
        const claim: Pick<ItemVersion, 'claimLevel' | 'claimAuthority' | 'claimQuote'> =
          !input.claim
            ? {
                claimLevel: current.claimLevel,
                ...(current.claimAuthority === undefined
                  ? {}
                  : { claimAuthority: current.claimAuthority }),
                ...(current.claimQuote === undefined ? {} : { claimQuote: current.claimQuote }),
              }
            : input.claim.level === 'effect_stated'
              ? {
                  claimLevel: 'effect_stated',
                  claimAuthority: input.claim.authority,
                  claimQuote: input.claim.quote,
                }
              : { claimLevel: 'fact_only' }
        const edited = {
          riskLevel: input.riskLevel ?? current.riskLevel,
          reviewDate: input.reviewDate === undefined ? current.reviewDate : input.reviewDate,
          ...claim,
          ownerId:
            input.ownerId ?? (moved ? (target.ownerIds[0] ?? current.ownerId) : current.ownerId),
          areaId,
        }
        const changes = (
          [
            'riskLevel',
            'reviewDate',
            'claimLevel',
            'claimAuthority',
            'claimQuote',
            'ownerId',
            'areaId',
          ] as const
        ).flatMap((field) =>
          current[field] === edited[field]
            ? []
            : [[field, { before: current[field] ?? null, after: edited[field] ?? null }] as const],
        )
        if (!changes.length) refuse('invalid', "There's nothing to save. Change a field first.")
        rejectSensitive(input.claim ?? {})
        const { claimAuthority: _authority, claimQuote: _quote, ...kept } = current
        const version: ItemVersion = { ...kept, ...edited }
        const { proposerId: _p, createdVia: _c, mentions: _m, ...content } = version
        const { findings, version: checked } = checkDraft(
          content,
          current.proposerId,
          stored.channel,
        )
        const owner = as(edited.ownerId).rolesIn(areaId)
        if (!owner.has('owner'))
          findings.push({
            code: 'owner',
            field: 'ownerId',
            message: 'Choose an active owner of this domain.',
            severity: 'error',
          })
        if (!checked || findings.some((finding) => finding.severity === 'error'))
          refuse('invalid', 'Fix the problems shown, then try again.', { findings })
        const { claimAuthority: _a, claimQuote: _q, ...draft } = stored.draft
        const versionId = uuid()
        const replaces = stored.itemVersionId
        update(stored, {
          itemVersionId: versionId,
          version,
          areaId,
          draft: { ...draft, ...edited },
          findings,
          levels: [
            {
              level: 'format',
              outcome: formatOutcome(findings),
              ranAt: now(),
              details: { findings },
            },
          ],
        })
        submittedVersions.set(versionId, version)
        event(stored, 'edited', {
          versionId,
          replaces,
          changes: Object.fromEntries(changes),
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        })
        runLevels(stored)
        event(stored, 'checked', {
          levels: Object.fromEntries(stored.levels.map((level) => [level.level, level.outcome])),
        })
        return reviewOf(stored)
      },

      runChecks(id: string): Gate {
        const stored = find(id)
        if (!stored.itemVersionId || !stored.version)
          refuse('conflict', 'Checks run only on a fact that was sent for review.')
        if (!underReview.includes(stored.state))
          refuse('conflict', 'Checks run only while a proposal is in review.')
        runLevels(stored)
        event(stored, 'checked', {
          levels: Object.fromEntries(stored.levels.map((level) => [level.level, level.outcome])),
        })
        return gateOf(stored)!
      },

      /** What one decision for several proposals would do to each (FR-223), as the service plans it. */
      planDecisions({ proposals: targets, outcome }: BulkPlanInput): BulkPlan {
        const decided: { review: ReviewProposal; effect: BulkEffect }[] = []
        const skipped: BulkSkip[] = []
        const taken = new Set<string>()
        for (const target of uniqueTargets(targets)) {
          const checked = bulkCheck(target, outcome)
          const same = 'code' in checked ? null : bulkSameItem(checked.review, outcome, taken)
          if ('code' in checked) skipped.push(checked)
          else if (same) skipped.push(same)
          else decided.push(checked)
        }
        return {
          decided: decided.map(({ review, effect }) => ({
            id: review.id,
            number: review.number,
            title: review.title,
            effect,
          })),
          skipped,
          editions: outcome === 'accept' ? bulkEditionCount(decided) : 0,
        }
      },

      /**
       * One decision for several proposals with one reason (FR-223): each decided as on its own,
       * a refused one left out and named, the accepts of one kind published as one edition.
       */
      decideMany({ proposals: targets, outcome, reason }: BulkDecideInput): BulkDecision {
        rejectSensitive(reason)
        rejectMentions(reason)
        const skipped: BulkSkip[] = []
        const ready: ReviewProposal[] = []
        const taken = new Set<string>()
        for (const target of uniqueTargets(targets)) {
          const checked = bulkCheck(target, outcome)
          const same = 'code' in checked ? null : bulkSameItem(checked.review, outcome, taken)
          if ('code' in checked) skipped.push(checked)
          else if (same) skipped.push(same)
          else ready.push(checked.review)
        }
        const order = (review: ReviewProposal) =>
          review.subject === 'vocabulary'
            ? (termKindOrder[termProposals.get(review.id)?.record.vocabulary?.kind ?? ''] ?? 1)
            : 1
        ready.sort((a, b) => order(a) - order(b))
        const settled: ReviewProposal[] = []
        const { editions } = gathered(() => {
          for (const review of ready) {
            try {
              settled.push(
                actions.decide({ id: review.id, revision: review.revision, outcome, reason })
                  .proposal,
              )
            } catch (error) {
              if (!(error instanceof ApiError)) throw error
              const named = { id: review.id, number: review.number, title: review.title }
              skipped.push(
                error.gate
                  ? {
                      ...named,
                      code: 'checks_failed',
                      message: bulkSkipWords.failedAgain(
                        levelList(error.gate.levels.filter((level) => level.outcome !== 'passed')),
                      ),
                    }
                  : {
                      ...named,
                      code: error.kind === 'forbidden' ? 'forbidden' : 'refused',
                      message: error.message,
                    },
              )
            }
          }
        })
        return { proposals: settled, skipped, editions }
      },

      /** Claims several proposals for a reviewer of their area, or hands them over to one. */
      assignProposals({
        proposals: targets,
        personId: recipient,
      }: BulkAssignInput): BulkAssignment {
        const assigned: ProposalRecord[] = []
        const skipped: BulkSkip[] = []
        for (const target of uniqueTargets(targets)) {
          const known = bulkReview(target.id)
          const skip = (code: BulkSkip['code'], message: string) =>
            skipped.push({
              id: target.id,
              number: known?.review.number ?? null,
              title: known?.review.title ?? null,
              code,
              message,
            })
          if (!known) {
            skip('not_found', bulkSkipWords.notFound)
            continue
          }
          const { review, stored } = known
          if (!stored || !['create', 'change'].includes(review.action)) {
            skip('not_allowed', bulkSkipWords.notClaimed)
            continue
          }
          if (review.revision !== target.revision) {
            skip('changed', bulkSkipWords.changed)
            continue
          }
          if (!underReview.includes(review.state)) {
            skip('not_waiting', bulkSkipWords.notWaiting)
            continue
          }
          if (review.claimedBy === recipient) {
            skip('claimed', bulkSkipWords.alreadyTheirs)
            continue
          }
          if (review.claimedBy && review.claimedBy !== personId) {
            skip('claimed', bulkSkipWords.claimed)
            continue
          }
          try {
            // Both must review its area before anything changes, as the service's savepoint has it.
            owner(stored.areaId)
            if (recipient !== personId) owner(stored.areaId, recipient)
            let current = stored.claimedBy
              ? record(stored)
              : claim({ id: stored.id, revision: stored.revision })
            if (recipient !== personId)
              current = claim({ id: current.id, revision: current.revision }, recipient)
            assigned.push(current)
          } catch (error) {
            if (!(error instanceof ApiError)) throw error
            skip(
              error.kind === 'forbidden' ? 'forbidden' : 'refused',
              error.kind === 'forbidden' ? bulkSkipWords.assigner : error.message,
            )
          }
        }
        return { proposals: assigned, skipped }
      },

      decide(input: DecideInput): DecisionResult {
        const comment = input.comment?.trim()
        if (comment !== undefined) {
          if (input.outcome !== 'request_changes')
            refuse('invalid', 'Only a request for changes takes a comment. Write a reason instead.')
          if (!comment) refuse('invalid', 'Write a comment.')
          rejectSensitive(comment)
          rejectMentions(comment)
        }
        const retirement = retirements.get(input.id)
        if (retirement?.action === 'retire') return decideRetirement(retirement, input)
        const term = termProposals.get(input.id)
        if (term) {
          const visibleTerm = visibleTerms([term])[0] ?? refuse('not-found', refusals.notFound)
          if (visibleTerm.record.revision !== input.revision)
            refuse(
              'conflict',
              'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
            )
          if (!underReview.includes(visibleTerm.record.state))
            refuse('conflict', 'This proposal no longer waits for a decision.')
          if (input.outcome === 'request_changes')
            refuse(
              'conflict',
              'A proposed name can only be accepted or rejected. To change it, propose it again.',
            )
          const decided = decideTerms([visibleTerm], {
            outcome: input.outcome,
            reason: input.reason,
            ...(input.capacity === 'administrator' ? { capacity: input.capacity } : {}),
          })
          return { proposal: decided.proposals[0]!, edition: decided.edition }
        }
        const stored = find(input.id)
        if (stored.revision !== input.revision)
          refuse(
            'conflict',
            'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
          )
        if (!underReview.includes(stored.state))
          refuse('conflict', 'This proposal no longer waits for a decision.')
        rejectSensitive(input.reason)
        rejectMentions(input.reason)
        const version = stored.version!
        const capacity = capacityFor(
          stored.areaId,
          input.outcome,
          input.capacity,
          version.riskLevel,
          stored.proposerId,
        )
        if (stored.claimedBy && stored.claimedBy !== personId && capacity !== 'approver')
          refuse('conflict', 'Another owner is already reviewing this proposal.')
        const decided = (outcome: StoredDecision['outcome']) => {
          if (
            decisions.some(
              (decision) =>
                decision.versionId === stored.itemVersionId &&
                decision.decidedBy === personId &&
                decision.outcome === outcome,
            )
          )
            refuse(
              'conflict',
              outcome === 'accept'
                ? 'You already accepted this version.'
                : 'You already decided this version.',
            )
          const decision: StoredDecision = {
            id: uuid(),
            proposalId: stored.id,
            versionId: stored.itemVersionId!,
            decidedBy: personId,
            capacity,
            outcome,
            reason: input.reason,
            decidedAt: now(),
          }
          decisions.push(decision)
          return {
            decisionId: decision.id,
            outcome,
            capacity,
            reason: input.reason,
            // The timeline and the history log say plainly when the proposer decided (FR-206).
            ...(stored.proposerId === personId ? { byProposer: true } : {}),
          }
        }
        if (input.outcome !== 'accept') {
          const data = decided(input.outcome)
          // Asking for changes hands the proposal back: nobody holds it until it returns.
          update(
            stored,
            input.outcome === 'reject'
              ? { state: 'rejected', closedAt: now() }
              : { state: 'changes_requested', claimedBy: null },
          )
          event(stored, 'decided', data)
          // The comment goes in the discussion beside the decision, which already told the
          // proposer; the history log names it without its text.
          if (comment) {
            const list = events.get(stored.id) ?? []
            list.push({
              id: uuid(),
              at: now(),
              actorId: personId,
              kind: 'commented',
              data: { text: comment, decisionId: data.decisionId },
            })
            events.set(stored.id, list)
            admin.record({
              actorId: personId,
              action: 'proposal.commented',
              areaId: stored.areaId,
              subjectType: 'proposal',
              subjectId: stored.id,
              details: { revision: stored.revision, decisionId: data.decisionId },
            })
          }
          return { proposal: reviewRecord(stored), edition: null }
        }
        // A change is written against the live version: none, while the item is in the Bin. A
        // rescue changes a retired item, which must still be retired (FR-814).
        const rescue = rescues.get(stored.id)
        if (rescue && stored.itemId && liveItem(stored.itemId))
          refuse(
            'conflict',
            'AI apps get this fact again since it was restored, so this proposal is out of date. Reject it.',
          )
        if (stored.itemId && bin.has(stored.itemId))
          refuse(
            'conflict',
            rescue
              ? 'This fact is in the Bin again. You can accept it once an admin restores it.'
              : 'The accepted fact changed after this version was written. Ask for changes.',
          )
        const gate = gateOf(stored)!
        if (!gate.levels.every((level) => level.outcome === 'passed'))
          refuse('invalid', 'Every required check must pass before you accept it.', { gate })
        const data = decided('accept')
        const waitingFor = gateOf(stored)!.problem
        if (waitingFor) {
          event(stored, 'approved', { ...data, waitingFor })
          return { proposal: reviewRecord(stored), edition: null }
        }
        // A change serves the item's next version; a new item is not in the fixture library.
        // The library keeps the fixture text, but the editions compare the accepted version.
        const changed = stored.itemId
          ? (liveItem(stored.itemId) ?? (rescue ? libraryItem(stored.itemId) : null))
          : null
        const next = changed ? nextVersion(changed.id) : 0
        if (changed)
          versionNotes.set(noteKey(changed.id, next), {
            versionId: stored.itemVersionId!,
            content: version,
            proposalId: stored.id,
          })
        // A rescue serves the item again in its new domain, with the owner and the review date
        // the proposal gave it.
        const patch: Partial<ContextItem> = rescue
          ? {
              areaId: version.areaId,
              ownerId: version.ownerId,
              reviewDate: version.reviewDate,
            }
          : {}
        const edition = publish(
          { reason: 'proposal_accepted', actorId: personId, note: null, restores: null },
          changed ? { items: [[changed.id, { version: next, patch }]] } : {},
        )
        update(stored, { state: 'accepted', closedAt: now() })
        event(stored, 'decided', { ...data, edition: edition.label })
        return { proposal: reviewRecord(stored), edition }
      },

      listTermCandidates(): TermCandidate[] {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        // A model with no terms yet, as a new pilot has it: every member is a candidate.
        const fresh = mockScenario() === 'no-terms'
        const open = [...termProposals.values()]
          .map(({ record }) => record)
          .filter((record) => underReview.includes(record.state))
        return termCandidates(
          demoDefinitions.map((definition) => ({
            ref: definition.ref,
            source: 'cube',
            kind: definition.kind,
            name: definition.name,
            title: definition.title,
            description: definition.descriptionCopy,
            valueType: definition.valueType,
            areaHint: definition.areaHint,
            // The demo model gives no member other names and joins none with a prefix.
            synonyms: [],
            baseName: null,
          })),
          [
            ...new Map(
              [
                ...(fresh ? [] : world.vocabulary.metrics).map((metric) => ({
                  key: `metric:${metric.id}`,
                  kind: 'metric',
                  name: metric.name,
                  aliases: metricOtherNames[metric.id] ?? [],
                  areaId: null,
                  definitionRefs: termRefs({ key: `metric:${metric.id}`, group: metric.group }),
                  open: false,
                })),
                ...(fresh ? [] : world.vocabulary.dimensions).map((dimension) => ({
                  key: `dim:${dimension.id}`,
                  kind: 'dimension',
                  name: dimension.name,
                  aliases: [],
                  areaId: null,
                  definitionRefs: termRefs({ key: `dim:${dimension.id}` }),
                  open: false,
                })),
                ...acceptedTerms.map((term) => ({ ...term, open: false })),
              ].map((term) => [term.key, term]),
            ).values(),
            ...open.map(termOf).map((term) => ({ ...term, open: true })),
          ],
        )
      },

      proposeTerms(input: TermBatchInput): TermBatchResult {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        rejectSensitive(input)
        const kindOrder = { metric_group: 0, metric: 1, dimension: 1, dimension_value: 2 }
        const ordered = input.terms
          .map((term, index) => ({ term, index }))
          .sort((a, b) => kindOrder[a.term.kind] - kindOrder[b.term.kind] || a.index - b.index)
        const findings: Finding[] = []
        const seen = new Set<string>()
        const pending: Term[] = []
        for (const { term, index } of ordered) {
          const named = (finding: Finding): Finding => ({
            ...finding,
            field: `terms.${index}.${finding.field}`,
            message: `${term.name}: ${finding.message}`,
          })
          if (seen.has(term.key))
            findings.push(
              named({
                code: 'duplicate_key',
                field: 'key',
                message: `You proposed ${term.key} twice.`,
                severity: 'error',
              }),
            )
          seen.add(term.key)
          findings.push(...vocabularyFindings(term, termContext(term.key, pending)).map(named))
          pending.push(structuredClone(term))
        }
        if (findings.some((finding) => finding.severity === 'error'))
          refuse('invalid', 'Fix the problems with this name first.', { findings })
        const batchId = uuid()
        const at = now()
        const made = ordered.map(({ term }) => {
          const record: ProposalRecord = {
            id: uuid(),
            number: lastSeedNumber + proposals.size + retirements.size + termProposals.size + 1,
            subject: 'vocabulary',
            action: governedTerms().some((live) => live.key === term.key) ? 'change' : 'create',
            state: 'submitted',
            areaId: term.areaId,
            itemId: null,
            itemVersionId: null,
            vocabularyVersionId: uuid(),
            title: term.name,
            reason: null,
            vocabulary: structuredClone(term),
            proposerId: personId,
            channel: 'import',
            revision: 1,
            draft: {},
            provenance: null,
            findings: vocabularyFindings(term, termContext(term.key, pending)),
            claimedBy: null,
            dueAt: term.areaId ? addWorkingDays(at, REVIEW_DAYS) : null,
            createdAt: at,
            updatedAt: at,
          }
          termProposals.set(record.id, { record, batchId })
          return termRecord(record)
        })
        return { batchId, proposals: made }
      },

      decideTermBatch(input: DecideTermBatchInput): TermBatchDecision {
        const open = visibleTerms(
          [...termProposals.values()].filter(
            (term) => term.batchId === input.batchId && underReview.includes(term.record.state),
          ),
        )
        if (!open.length) refuse('not-found', 'None of these names wait for a decision any more.')
        return decideTerms(open, input)
      },

      listAreas(): Area[] {
        return world.areas.map((area) => ({ ...area })).sort((a, b) => a.name.localeCompare(b.name))
      },

      listEditions({ limit = 50, offset = 0 }: EditionListParams = {}): Edition[] {
        maintainsAny()
        return structuredClone(
          [...editions].sort((a, b) => b.seq - a.seq).slice(offset, offset + limit),
        )
      },

      rollbackEdition({ label, note }: RollbackInput): Edition {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        const target = editions.find((edition) => edition.label === label)
        // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
        if (!target) return refuse('not-found', "We couldn't find this edition.")
        if (target.seq === liveEdition().seq)
          // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
          refuse('conflict', 'AI apps already get this edition.')
        // Every version served again passes the serving rules once more (FR-205), as on the
        // service: the refusal names the versions that would not.
        const blocked = blockedIn(target)
        if (blocked.length) {
          const [first] = blocked
          const others =
            blocked.length > 1
              ? ` ${blocked.length - 1} more ${blocked.length === 2 ? 'fact' : 'facts'} can't either.`
              : ''
          refuse(
            'conflict',
            // eslint-disable-next-line heed/plain-words -- shown only on the Editions page
            `You can't go back to edition ${label}. ${first!.title === null ? 'A fact' : `"${first!.title}"`} (version ${first!.version}) can't be shared with AI apps again: ${first!.problem}.${others}`,
            { blocked },
          )
        }
        const published = publish(
          {
            reason: 'rollback',
            actorId: personId,
            note,
            restores: label,
            digest: target.digest ?? digestOf(label),
          },
          { state: states.get(target.seq)! },
        )
        // An item in the Bin that the rollback serves again leaves the Bin with it.
        for (const [id, record] of [...bin])
          if (servedIn(published, id)) {
            bin.delete(id)
            admin.record({
              actorId: personId,
              action: 'item.restored',
              areaId: record.entry.areaId,
              subjectType: 'item',
              subjectId: id,
              details: { title: record.entry.title, edition: published.label, via: 'rollback' },
            })
          }
        admin.record({
          actorId: personId,
          action: 'edition.rollback',
          areaId: null,
          subjectType: 'edition',
          subjectId: published.label,
          details: { seq: published.seq, reason: published.reason, note: published.note },
        })
        return published
      },

      previewRollback(label: string): RollbackPreview {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        const target = editionByLabel(label)
        const live = liveEdition()
        return structuredClone({
          live,
          target,
          comparison: editionReads.compareEditions(
            editionWorld(),
            { from: live.label, to: target.label },
            refuse,
          ),
          blocked: blockedIn(target),
        })
      },

      diffEdition({ label, against }: EditionDiffInput): EditionDiff {
        maintainsAny()
        const to = editionByLabel(label)
        const from = against
          ? editionByLabel(against)
          : ([...editions]
              .filter((edition) => edition.seq < to.seq)
              .sort((a, b) => b.seq - a.seq)[0] ?? null)
        // The first edition is compared with nothing: everything it serves is new.
        const ids = new Set([
          ...states.get(to.seq)!.keys(),
          ...(from ? states.get(from.seq)!.keys() : world.items().map((item) => item.id)),
        ])
        const items = [...ids]
          .sort()
          .map((id) => ({
            id,
            from: from ? (servedIn(from, id)?.version ?? null) : null,
            to: servedIn(to, id)?.version ?? null,
          }))
          .filter((change) => change.from !== change.to)
        return { from: from?.label ?? null, to: to.label, items, vocabulary: [] }
      },

      exportEdition(label: string): EditionExport {
        maintainsAny()
        const edition = editionByLabel(label)
        const items = world.items().flatMap((item) => {
          const served = servedIn(edition, item.id)
          if (!served) return []
          const source = { ...item, ...served.patch }
          const version = formatDraft(draftOfItem(source), item.proposerId, item.createdVia).version
          if (!version) return []
          const number = served.version
          return [
            { id: item.id, version: number, digest: digestOf(`${item.id}.${number}`), ...version },
          ]
        })
        return {
          format: 'heed.edition/1',
          edition: {
            seq: edition.seq,
            label: edition.label,
            reason: edition.reason,
            note: edition.note,
            restores: edition.restores,
            createdAt: edition.createdAt,
            sealedAt: edition.sealedAt ?? edition.createdAt,
          },
          digest: edition.digest ?? digestOf(edition.label),
          items,
          withheld: [],
          vocabulary: [],
          // Domains have no state any more; only editions sealed before that carry one.
          areas: [],
        }
      },

      // Seeing what changed between editions (Editions design G1 to G3), for the owners of any
      // area and administrators, by the service's rules (mock-edition-compare.ts).
      compareEditions(input: EditionCompareInput = {}): EditionComparison {
        maintainsAny()
        return structuredClone(editionReads.compareEditions(editionWorld(), input, refuse))
      },
      compareEditionItem(input: EditionItemCompareInput): EditionItemComparison {
        maintainsAny()
        return structuredClone(editionReads.compareItem(editionWorld(), input, refuse))
      },
      editionFeed(input: EditionFeedInput = {}): EditionFeed {
        maintainsAny()
        return structuredClone(editionReads.editionFeed(editionWorld(), input, refuse))
      },

      /** Everyone signed in reads the stops; only an administrator gets their event numbers. */
      listStops(): ActiveStop[] {
        return isAdmin()
          ? structuredClone(stops)
          : stops.map(({ seq: _seq, ...stop }) => structuredClone(stop))
      },

      setStop(input: StopInput): ActiveStop[] {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        const areaId = input.scope === 'area' ? input.areaId : undefined
        const itemId = input.scope === 'item' ? input.itemId : undefined
        if (
          (input.scope === 'area') !== (input.areaId !== undefined) ||
          (input.scope === 'item') !== (input.itemId !== undefined)
        )
          refuse('bad-request', 'Name either the domain or the fact to stop.')
        const exists =
          input.scope === 'all' ||
          (input.scope === 'area'
            ? world.areas.some((area) => area.id === areaId)
            : world.items().some((item) => item.id === itemId))
        if (!exists)
          refuse('not-found', "We couldn't find this domain or fact. Someone may have deleted it.")
        const index = stops.findIndex(
          (stop) =>
            stop.scope === input.scope &&
            stop.areaId === (areaId ?? null) &&
            stop.itemId === (itemId ?? null),
        )
        if (input.on && index < 0)
          stops.push({
            seq: editions.length + stops.length + 1,
            at: now(),
            scope: input.scope,
            areaId: areaId ?? null,
            itemId: itemId ?? null,
            reason: input.reason,
          })
        if (!input.on && index >= 0) stops.splice(index, 1)
        // A switch that moved is kept in the history log, as the service keeps it.
        if (input.on === index < 0)
          admin.record({
            actorId: personId,
            action: input.on ? 'stop.on' : 'stop.off',
            areaId: areaId ?? null,
            subjectType: input.scope,
            subjectId: itemId ?? areaId ?? 'all',
            details: { reason: input.reason },
          })
        return structuredClone(stops)
      },

      /** FR-407: one list decides which tools are on, for every client. Administrators only. */
      listTools(): ToolSwitch[] {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        return structuredClone(gateway.tools)
      },

      setTool(input: SetToolInput): ToolSwitch {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        rejectReason(input.reason)
        const tool = gateway.tools.find((candidate) => candidate.tool === input.tool)
        if (!tool) return refuse('not-found', "We couldn't find this tool.")
        if (tool.enabled !== input.enabled) {
          tool.enabled = input.enabled
          tool.updatedAt = now()
        }
        return structuredClone(tool)
      },

      listClients(): ClientPolicy[] {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        return structuredClone(gateway.clients)
      },

      /**
       * Connect your AI, for every signed-in person: the address, every tool with whether it is
       * on, and the clients switched on, by name. The evaluation runner is not a person's client.
       */
      getConnectInfo(): ConnectInfo {
        return {
          address: MOCK_MCP_ADDRESS,
          tools: gateway.tools.map((tool) => ({
            tool: tool.tool,
            enabled: tool.enabled,
            // Only a signed-in person may call it: the draft is theirs (FR-121).
            personOnly: tool.tool === 'draft_context',
          })),
          clients: gateway.clients
            .filter((client) => client.enabled && client.label !== 'eval')
            .map((client) => ({ label: client.label, name: client.displayName }))
            .sort((a, b) => a.name.localeCompare(b.name, 'en') || (a.label < b.label ? -1 : 1)),
          // The mock has a login server: a person's own client can sign in (mock-connections.ts).
          signIn: true,
        }
      },

      /**
       * How the live edition's version of each item was reviewed (FR-326), for the review stamp:
       * items the person may read that the live edition serves, in id order.
       */
      servedReviews(ids: readonly string[]): ItemReview[] {
        const live = liveEdition()
        const reviewOf = acceptances(live)
        return [...new Set(ids)].sort().flatMap((id) => {
          const item = liveItem(id)
          if (!item || bin.has(id) || !audienceAllows(item.audience, noGroups)) return []
          const review = reviewOf(id)
          if (!review) return []
          return [
            {
              id,
              version: item.version,
              acceptedOn: review.acceptedOn,
              acceptedAs: review.acceptedAs,
              areaId: review.areaId,
              personId: review.personId,
              edition: review.edition,
              checks: requiredLevels(item.riskLevel),
            },
          ]
        })
      },

      /**
       * What an agent would get: the delivery resolver over the live edition's items, its live
       * areas and its stops, for a scope resolved as get_context resolves it. Nothing is kept.
       */
      tryIt(input: TryItInput): TryIt {
        const result = {
          ...agentReply('', input),
          tool_schema_digest: digestOf('get_context tools'),
        }
        const text = JSON.stringify(result)
        // The gateway's measure: the MCP result with its text copy, plus room for the envelope.
        const bytes =
          new TextEncoder().encode(
            JSON.stringify({ content: [{ type: 'text', text }], structuredContent: result }),
          ).length + 384
        return { result, bytes, limit: 100_000 }
      },

      /** A question read as a scope with the vocabulary, as the service reads it; nothing is kept. */
      readTryItQuestion({ question }: TryItReadInput): TryItReading {
        return questionReading(question, scopeTerms, world.today)
      },

      /**
       * The live edition as the assistant's read tools see it (the scripted mock assistant): the
       * reply for a question and a scope, why one item does or does not apply, and the items
       * served to everyone. Like the service's, these record nothing.
       */
      assistantReads(): MockAssistantReads {
        const { edition, items, serving } = servedToAgents()
        return {
          today: world.today,
          edition: edition.label,
          areas: world.areas.map(({ id, name, summary, ownerIds }) => ({
            id,
            name,
            summary,
            owners: ownerIds.flatMap((ownerId) => {
              const owner = world.people.find((person) => person.id === ownerId)
              return owner ? [owner.name] : []
            }),
          })),
          items,
          context: agentReply,
          nameOf: (key) => termNames.get(key),
          describe: (key) => {
            const term = terms.find((candidate) => candidate.key === key)
            if (!term) return null
            const metric = world.vocabulary.metrics.find((m) => `metric:${m.id}` === key)
            let definition: string | null = null
            if (term.kind !== 'dimension_value')
              try {
                const ref = definitionRefOf({ key, group: metric?.group })
                definition = demoDefinitions.find((d) => d.ref === ref)?.descriptionCopy ?? null
              } catch {
                // A metric of a group the demo model has no view for: no definition.
              }
            return {
              kind: term.kind as 'metric' | 'dimension' | 'dimension_value',
              name: term.name,
              definition,
              dimension: term.parentKey ? (termNames.get(term.parentKey) ?? null) : null,
              values: terms.filter((t) => t.parentKey === key).map((t) => t.name),
            }
          },
          explain: (id, question, input) =>
            mockExplain(world, items, agentScope(question, input), edition.label, serving, id),
          // create_draft once the person confirmed: their own unsubmitted draft, marked as the
          // service marks it (agent-drafts.ts, marksOfSources).
          saveDraft: ({ draft, sources, datesUncertain }) => {
            const marks: Partial<Record<MarkedField, FieldMark>> = {}
            for (const [path, source] of Object.entries(sources)) {
              const head = path.split('.')[0]!.replace(/Markup$/, '')
              if (source === 'your_text' || !(markedFields as readonly string[]).includes(head))
                continue
              marks[head as MarkedField] = source === 'default' ? 'default' : 'prefilled'
            }
            const saved = actions.createProposal(
              { draft, channel: 'assistant' },
              {
                provenance: (stored) =>
                  provenanceOf('assistant', marks, stored, undefined, datesUncertain),
              },
            )
            return { id: saved.id, number: saved.number, title: saved.draft.title ?? saved.title }
          },
        }
      },

      /** Adds a client label to the closed list, or changes it (FR-408). A label stays. */
      saveClient({ reason, ...input }: SaveClientInput): ClientPolicy {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        rejectReason(reason)
        const unknown = (input.toolsAllowed ?? []).filter(
          (name) => !gateway.tools.some((tool) => tool.tool === name),
        )
        if (unknown.length) refuse('invalid', unknownToolsMessage(unknown))
        const saved: ClientPolicy = {
          ...input,
          toolsAllowed: input.toolsAllowed && [...new Set(input.toolsAllowed)].sort(),
        }
        const index = gateway.clients.findIndex((client) => client.label === input.label)
        if (index >= 0) gateway.clients[index] = saved
        else {
          gateway.clients.push(saved)
          gateway.clients.sort((a, b) => (a.label < b.label ? -1 : 1))
        }
        return structuredClone(saved)
      },

      retireItem({ id, reason }: ItemReasonInput): Edition {
        rejectSensitive(reason)
        rejectMentions(reason)
        const item =
          liveItem(id) ??
          refuse(
            'not-found',
            "We couldn't find an accepted version of this fact. Someone may have archived it.",
          )
        const roles = rolesIn(item.areaId)
        if (!roles.has('owner') && !isAdmin())
          refuse('forbidden', 'Only an owner of the domain or an admin can archive a fact.')
        const capacity = roles.has('owner') ? 'owner' : 'administrator'
        const decidedAt = now()
        noteRetired(id, item.version, {
          proposal: null,
          proposerId: null,
          channel: null,
          editedBy: null,
          decisions: [{ decidedBy: personId, capacity, outcome: 'retire', reason, decidedAt }],
        })
        return publish(
          { reason: 'item_retired', actorId: personId, note: reason, restores: null },
          { items: [[id, null]] },
        )
      },

      listBin(): BinList {
        if (!isAdmin()) refuse('forbidden', 'Only an admin can open the Bin.')
        return { items: binEntries([...bin.keys()]) }
      },

      /** The item as the library showed it when it moved: the version agents got, if any. */
      getBinItem(id: string): BinItem {
        if (!isAdmin()) refuse('forbidden', 'Only an admin can open the Bin.')
        const record = bin.get(id) ?? refuse('not-found', "We couldn't find this fact in the Bin.")
        const item = world.items().find((candidate) => candidate.id === id)!
        const [entry] = binEntries([id])
        const served = record.served
        return {
          entry: entry!,
          item: served
            ? { ...item, ...served.patch, version: served.version, status: 'accepted' }
            : { ...item, status: 'retired' },
        }
      },

      previewBin({ ids }: BinItemsInput): BinPreview {
        if (!isAdmin()) refuse('forbidden', 'Only an admin can move facts to the Bin.')
        return {
          items: binTargets(ids).map((item) => ({
            itemId: item.id,
            title: item.title,
            live: item.status === 'accepted',
            openProposals: openProposalsOf(item.id),
          })),
        }
      },

      moveToBin({ ids, reason }: BinMoveInput): BinMoveResult {
        if (!isAdmin()) refuse('forbidden', 'Only an admin can move facts to the Bin.')
        rejectSensitive(reason)
        rejectMentions(reason)
        const targets = binTargets(ids)
        const live = targets.filter((item) => item.status === 'accepted')
        const at = now()
        const served = new Map(live.map((item) => [item.id, servedIn(liveEdition(), item.id)]))
        for (const item of live)
          noteRetired(item.id, item.version, {
            proposal: null,
            proposerId: null,
            channel: null,
            editedBy: null,
            decisions: [
              {
                decidedBy: personId,
                capacity: 'administrator',
                outcome: 'retire',
                reason,
                decidedAt: at,
              },
            ],
          })
        // One edition for the whole action, for the items agents get.
        const edition = live.length
          ? publish(
              { reason: 'item_retired', actorId: personId, note: reason, restores: null },
              { items: live.map((item): [string, Served] => [item.id, null]) },
            )
          : null
        for (const item of targets) {
          bin.set(item.id, {
            entry: {
              itemId: item.id,
              kind: item.kind,
              areaId: item.areaId,
              title: item.title,
              version: item.version,
              reason,
              binnedBy: personId,
              binnedAt: at,
              wasLive: item.status === 'accepted',
            },
            served: served.get(item.id) ?? null,
          })
          admin.record({
            actorId: personId,
            action: 'item.binned',
            areaId: item.areaId,
            subjectType: 'item',
            subjectId: item.id,
            details: {
              title: item.title,
              reason,
              edition: item.status === 'accepted' ? edition!.label : null,
              openProposals: openProposalsOf(item.id),
            },
          })
        }
        return { items: binEntries(targets.map((item) => item.id)), edition }
      },

      previewRescue({ ids, areaId }: BinRescuePreviewInput): BinRescuePreview {
        if (!isAdmin()) refuse('forbidden', 'Only an admin can restore facts from the Bin.')
        const records = [...new Set(ids)].map(
          (id) => bin.get(id) ?? refuse('not-found', "We couldn't find this fact in the Bin."),
        )
        return {
          items: fitRescues(
            records.filter((record) => deletedAreas.has(record.entry.areaId)),
            areaId,
          ).map(({ record, rescue }) => ({
            itemId: record.entry.itemId,
            title: record.entry.title,
            deletedDomain: deletedAreas.get(record.entry.areaId)!,
            changes: rescue.changes,
            problem: rescue.problem,
          })),
        }
      },

      restoreFromBin({ ids, areaId }: BinRestoreInput): BinRestoreResult {
        if (!isAdmin()) refuse('forbidden', 'Only an admin can restore facts from the Bin.')
        const records = [...new Set(ids)].map(
          (id) => bin.get(id) ?? refuse('not-found', "We couldn't find this fact in the Bin."),
        )
        // An item of a deleted domain has no domain to go back to (FR-814): it goes to the
        // domain the administrator chose, retired, with a proposal there.
        const orphaned = records.filter((record) => deletedAreas.has(record.entry.areaId))
        const returning = records.filter((record) => !deletedAreas.has(record.entry.areaId))
        if (orphaned.length && !areaId)
          refuse(
            'conflict',
            `${orphaned.length === 1 ? `"${orphaned[0]!.entry.title}"` : `${orphaned.length} facts`} ${orphaned.length === 1 ? 'belongs' : 'belong'} to ${deletedAreas.get(orphaned[0]!.entry.areaId)}, which was deleted. Nothing was restored. Choose another domain for ${orphaned.length === 1 ? 'it' : 'them'}, or restore ${deletedAreas.get(orphaned[0]!.entry.areaId)} first in Administration, Domains.`,
          )
        if (areaId && !orphaned.length)
          refuse(
            'invalid',
            'Nothing was restored. Only a fact whose domain was deleted can move to another domain.',
          )
        const fitted = areaId ? fitRescues(orphaned, areaId) : []
        const unfit = fitted.filter(({ rescue }) => rescue.problem)
        if (unfit.length)
          refuse(
            'invalid',
            `${unfit.length === 1 ? `"${unfit[0]!.record.entry.title}"` : `${unfit.length} facts`} can't move to ${fitted[0]!.rescue.changes[0]!.after}: ${unfit[0]!.rescue.problem} Nothing was restored.`,
          )
        // Every version served again passes the serving rules once more (FR-205).
        const blocked = returning.flatMap((record) => {
          const problem = record.served
            ? versionProblems.get(noteKey(record.entry.itemId, record.served.version))
            : undefined
          return problem ? [{ title: record.entry.title, problem }] : []
        })
        if (blocked.length)
          refuse(
            'conflict',
            `${blocked.length === 1 ? `"${blocked[0]!.title}"` : `${blocked.length} facts`} can't be shared with AI apps again: ${blocked[0]!.problem}. Nothing was restored.`,
          )
        const back = returning.filter((record) => record.served)
        const edition = back.length
          ? publish(
              {
                reason: 'item_restored',
                actorId: personId,
                note: null,
                restores: null,
              },
              {
                items: back.map((record): [string, Served] => [record.entry.itemId, record.served]),
              },
            )
          : null
        for (const record of returning) {
          bin.delete(record.entry.itemId)
          admin.record({
            actorId: personId,
            action: 'item.restored',
            areaId: record.entry.areaId,
            subjectType: 'item',
            subjectId: record.entry.itemId,
            details: {
              title: record.entry.title,
              edition: record.served ? edition!.label : null,
            },
          })
        }
        // A rescue serves nothing: the item stays retired until its proposal is accepted.
        const opened: BinRestoreResult['proposals'] = []
        for (const { record, rescue, base } of fitted) {
          const id = record.entry.itemId
          const draft = defaults(rescue.draft)
          const at = now()
          const stored: StoredProposal = {
            subject: 'item',
            vocabularyVersionId: null,
            vocabulary: null,
            title: draft.title ?? 'Untitled proposal',
            id: uuid(),
            number: lastSeedNumber + proposals.size + retirements.size + termProposals.size + 1,
            action: 'change',
            state: 'draft',
            areaId: draft.areaId!,
            itemId: id,
            itemVersionId: null,
            proposerId: personId,
            channel: 'form',
            revision: 1,
            draft,
            provenance: null,
            findings: checkDraft(draft, personId, 'form').findings,
            claimedBy: null,
            dueAt: null,
            createdAt: at,
            updatedAt: at,
            reason: null,
            submittedAt: null,
            closedAt: null,
            base,
            version: null,
            levels: [],
            discardedAt: null,
          }
          proposals.set(stored.id, stored)
          event(stored, 'created', { rescue: true })
          bin.delete(id)
          rescues.set(stored.id, {
            itemId: id,
            deletedDomain: deletedAreas.get(record.entry.areaId)!,
            restoredBy: personId,
            restoredAt: at,
          })
          const submitted = actions.submitProposal({ id: stored.id, revision: stored.revision })
          admin.record({
            actorId: personId,
            action: 'item.restored',
            areaId: areaId!,
            subjectType: 'item',
            subjectId: id,
            details: {
              title: record.entry.title,
              edition: null,
              deletedDomain: deletedAreas.get(record.entry.areaId)!,
              domain: rescue.changes[0]!.after,
              proposal: submitted.number,
              changes: rescue.changes,
            },
          })
          opened.push({ itemId: id, id: submitted.id, number: submitted.number })
        }
        return {
          restored: records.map((record) => record.entry.itemId),
          edition,
          proposals: opened,
        }
      },

      proposeRetirement({ id, reason }: ItemReasonInput): ReviewProposal {
        rejectSensitive(reason)
        rejectMentions(reason)
        const item =
          liveItem(id) ??
          refuse(
            'not-found',
            "We couldn't find an accepted version of this fact. Someone may have archived it.",
          )
        if (
          [...retirements.values()].some(
            (proposal) => proposal.itemId === id && underReview.includes(proposal.state),
          )
        )
          refuse('conflict', 'Someone already proposed to archive this fact.')
        const at = now()
        const proposal: ReviewProposal = {
          id: uuid(),
          number: lastSeedNumber + proposals.size + retirements.size + termProposals.size + 1,
          subject: 'item',
          action: 'retire',
          state: 'submitted',
          areaId: item.areaId,
          itemId: id,
          itemVersionId: uuid(),
          vocabularyVersionId: null,
          termKey: null,
          title: item.title,
          riskLevel: item.riskLevel,
          proposerId: personId,
          channel: 'form',
          revision: 1,
          reason,
          claimedBy: null,
          dueAt: addWorkingDays(at, REVIEW_DAYS),
          submittedAt: at,
          closedAt: null,
          createdAt: at,
        }
        retirements.set(proposal.id, proposal)
        proposalPosted(proposal, 'submitted', personId, { reason })
        return structuredClone(proposal)
      },

      /**
       * CON-211, as the service does it: a new version with the same content, the current change
       * marks and a new review date. A high-risk recheck waits for its answer tests and the
       * approver, so it publishes nothing yet.
       */
      recheckItem({ id, reason }: ItemReasonInput): DecisionResult {
        rejectSensitive(reason)
        rejectMentions(reason)
        const item =
          liveItem(id) ??
          refuse(
            'not-found',
            "We couldn't find an accepted version of this fact. Someone may have archived it.",
          )
        const roles = rolesIn(item.areaId)
        if (!roles.has('owner'))
          refuse('forbidden', 'Only an owner of the domain can check this fact again.')
        if (item.checkFlag === 'source_missing')
          refuse('conflict', 'A definition this fact uses is gone. Suggest a change instead.')
        const days =
          reviewQuestion(item) === 'still_going_on' ? OPEN_ISSUE_DAYS : DEFAULT_REVIEW_DAYS
        const reviewDate =
          item.validity.end === null ? shiftDate(world.today, days) : item.reviewDate
        if (item.checkFlag === null && reviewDate === item.reviewDate)
          refuse(
            'conflict',
            "Nothing changed since the last check, so this fact doesn't need checking.",
          )
        const at = now()
        const proposal: ReviewProposal = {
          id: uuid(),
          number: lastSeedNumber + proposals.size + retirements.size + termProposals.size + 1,
          subject: 'item',
          action: 'recheck',
          state: item.riskLevel === 'high' ? 'submitted' : 'accepted',
          areaId: item.areaId,
          itemId: id,
          itemVersionId: uuid(),
          vocabularyVersionId: null,
          termKey: null,
          title: item.title,
          riskLevel: item.riskLevel,
          proposerId: personId,
          channel: 'form',
          revision: 1,
          reason,
          claimedBy: null,
          dueAt: null,
          submittedAt: at,
          closedAt: item.riskLevel === 'high' ? null : at,
          createdAt: at,
        }
        retirements.set(proposal.id, proposal)
        if (item.riskLevel === 'high') return { proposal: structuredClone(proposal), edition: null }
        // The checked version holds what the version before it did, with the new review date.
        const next = nextVersion(id)
        const before = editionWorld().served(liveEdition(), id)?.content()
        versionNotes.set(noteKey(id, next), {
          versionId: proposal.itemVersionId!,
          recheck: true,
          ...(before ? { content: { ...before, reviewDate } } : {}),
          accepted: {
            proposal: { id: proposal.id, number: proposal.number },
            proposerId: personId,
            channel: 'form',
            editedBy: null,
            decisions: [
              {
                decidedBy: personId,
                capacity: 'owner',
                outcome: 'accept',
                reason,
                decidedAt: at,
              },
            ],
          },
        })
        const edition = publish(
          { reason: 'source_rechecked', actorId: personId, note: reason, restores: null },
          {
            items: [[id, { version: next, patch: { checkFlag: null, reviewDate, updatedAt: at } }]],
          },
        )
        return { proposal: structuredClone(proposal), edition }
      },
    }

    // Gaps (mock-gaps.ts): an owner of the topic's area, or an administrator, manages
    // a gap. Starting a draft goes through createProposal, as it does on the service.
    const gaps = () =>
      gapStore.as({
        manages: (areaId) => isAdmin() || (areaId !== null && rolesIn(areaId).has('owner')),
        tests: {
          question: (id) => questionStore.get(id),
          areaRun(id) {
            const stored = runs.get(id)?.run
            if (stored)
              return stored.proposalId === null &&
                stored.areaId !== null &&
                (stored.kind === 'scheduled' || stored.kind === 'full')
                ? { area: stored.areaId }
                : undefined
            try {
              return { area: quality().areaOfRun(id) }
            } catch {
              return undefined
            }
          },
          latest: latestResult,
        },
      })
    /**
     * A test question's result in the newest finished weekly or full run of its area that tested
     * it, as a gap's linked tests read it (gaps/service.ts).
     */
    function latestResult(question: TestQuestion): GapTest['latest'] {
      const model = quality()
      const candidates = [
        ...model.history([question.area], 10_000),
        ...[...runs.values()]
          .filter(
            ({ run }) =>
              run.areaId === question.area &&
              run.proposalId === null &&
              run.kind === 'full' &&
              run.state === 'finished',
          )
          .map(({ run }) => ({ run: run.id, finishedAt: run.finishedAt ?? run.createdAt })),
      ].sort((a, b) => b.finishedAt.localeCompare(a.finishedAt) || b.run.localeCompare(a.run))
      // The mock reads a weekly run's results from today's questions; a question written since
      // was never in it, as on the service.
      const written = question.revision === 1 ? question.updatedAt : null
      for (const candidate of candidates) {
        if (written && candidate.finishedAt < written) continue
        const { run, results } = evalRunOf(candidate.run, undefined, model)
        const result = results.find((found) => found.id === question.id)
        if (result)
          return {
            run: run.id,
            kind: run.kind === 'full' ? 'full' : 'scheduled',
            edition: run.edition,
            finishedAt: run.finishedAt ?? run.createdAt,
            verdict: result.baseline ?? null,
          }
      }
      return null
    }
    const { recordImport, ...settings } = admin.as(personId)

    /**
     * FR-120: an item file becomes proposals through the same steps as the form, never accepted
     * items (admin/imports.ts). A dry run changes nothing; an apply makes the proposals only when
     * no entry has an error, and submits them unless asked to keep drafts.
     */
    function importItems(input: ImportItemsInput): ItemImportReport {
      const dryRun = input.dryRun ?? true
      const submit = input.submit ?? true
      type Entry = ItemImportReport['entries'][number]
      const counted = (entries: Entry[], error: string | null = null): ItemImportReport => ({
        applied: false,
        batchId: null,
        error,
        entries,
        counts: {
          create: entries.filter((e) => e.action === 'create').length,
          change: entries.filter((e) => e.action === 'change').length,
          unchanged: entries.filter((e) => e.action === 'unchanged').length,
          errors: entries.filter((e) => e.findings.some((f) => f.severity === 'error')).length,
        },
      })
      if (!input.content || input.content.length > ITEM_FILE_MAX_LENGTH)
        refuse('bad-request', refusals.badRequest)
      let document: unknown
      try {
        document = parseYaml(input.content, { maxAliasCount: 0 })
      } catch {
        return counted([], 'The file is neither YAML nor JSON')
      }
      const file = readItemFile(document)
      if (file.error) return counted([], file.error)
      const entries: Entry[] = []
      const plan: { entry: Entry; draft: Draft }[] = []
      const seen = new Set<string>()
      for (const read of file.entries) {
        const findings: Finding[] = [...read.findings]
        const entry: Entry = {
          index: read.index,
          itemId: read.itemId,
          title: read.draft?.title ?? null,
          action: read.itemId ? 'change' : 'create',
          proposalId: null,
          findings,
        }
        entries.push(entry)
        const error = (code: string, field: string, message: string) =>
          findings.push({ code, field, message, severity: 'error' })
        if (read.itemId) {
          if (seen.has(read.itemId))
            error('duplicate_item', 'id', 'This fact is in the file twice. Keep one of them.')
          seen.add(read.itemId)
        }
        if (!read.draft || findings.some((f) => f.severity === 'error')) continue
        const item = read.itemId
          ? world.items().find((candidate) => candidate.id === read.itemId)
          : undefined
        if (read.itemId && item?.status !== 'accepted') {
          error('unknown_item', 'id', "We couldn't find an accepted fact with this id.")
          continue
        }
        let draft: Draft
        try {
          draft = defaults(item ? { ...draftOfItem(item), ...read.draft } : read.draft)
        } catch (refused) {
          if (!(refused instanceof ApiError)) throw refused
          error('format', 'areaId', refused.message)
          continue
        }
        entry.title = draft.title ?? null
        const checked = checkDraft(draft, personId, 'import')
        if (item && checked.version) {
          const live = formatDraft(draftOfItem(item), 'import', 'import').version
          const mine = formatDraft(draft, 'import', 'import').version
          if (live && canonicalJson(live) === canonicalJson(mine)) {
            entry.action = 'unchanged'
            continue
          }
        }
        for (const found of [...checked.findings, ...textFindings(draft)])
          if (
            !findings.some(
              (f) =>
                f.code === found.code && f.field === found.field && f.message === found.message,
            )
          )
            findings.push(found)
        if (findings.some((f) => f.severity === 'error')) continue
        plan.push({ entry, draft: read.draft })
      }
      const report = counted(
        entries,
        plan.length > ITEM_IMPORT_MAX_PROPOSALS
          ? `An import makes at most ${ITEM_IMPORT_MAX_PROPOSALS} proposals; this file would make ${plan.length}. Split it.`
          : null,
      )
      if (dryRun || report.counts.errors || report.error) return report
      const batchId = uuid()
      for (const { entry, draft } of plan) {
        const created = actions.createProposal({
          draft,
          ...(entry.itemId ? { itemId: entry.itemId } : {}),
          channel: 'import',
        })
        const proposal = submit
          ? actions.submitProposal({ id: created.id, revision: created.revision })
          : created
        entry.proposalId = proposal.id
        entry.itemId = proposal.itemId
      }
      recordImport(
        { sourceName: input.sourceName ?? null, ...report.counts, submitted: submit },
        batchId,
      )
      return { ...report, applied: true, batchId }
    }

    return {
      ...actions,
      ...settings,
      importItems,
      listGaps: (params?: GapListParams) => gaps().list(params),
      getGap: (id: string) => gaps().get(id),
      setGapStatus: (input: GapStatusInput) => gaps().setStatus(input),
      addGapNote: (input: GapNoteInput) => gaps().addNote(input),
      linkGapTest: (input: GapLinkTestInput) => gaps().linkTest(input),
      unlinkGapTest: (input: GapUnlinkTestInput) => gaps().unlinkTest(input),
      startDraftFromGap({ id, areaId }: GapDraftInput): ProposalRecord {
        const draft = gaps().draftOf(id, areaId)
        const proposal = actions.createProposal({ draft, channel: 'form' })
        const tests = gaps().linkProposal(id, proposal.id, proposal.areaId)
        // FR-524: the draft carries the gap's linked, active development tests of its area.
        const attachedHour = hourOf(now())
        attachedStore.set(
          proposal.id,
          tests.map((question) => ({ question, attachedHour })),
        )
        return proposal
      },
      /**
       * FR-606 case 5: a person reports a gap about a scope. The scope resolves as get_context
       * resolves it; the topic comes from it alone, its area by the domain rule.
       */
      reportGap({ type, note, ...scopeInput }: GapReportInput): GapReport {
        const scope = scopeOfTry(scopeInput)
        if (scope.status !== 'resolved')
          refuse('invalid', "Add the metric, the market or the dates it's about.", {
            findings: scopeIssueFindings(scope.issues),
          })
        if (note !== undefined) {
          const findings = noteFindings(note)
          if (findings.length)
            refuse('invalid', 'Remove the email address, phone number or secret from the text.', {
              findings,
            })
        }
        return gaps().report({
          topic: topicFor(scope.scope, metricArea),
          type,
          ...(note === undefined ? {} : { note }),
        })
      },
      getTopicCounts: (params?: TopicCountsParams) => gaps().topicCounts(params),
      getWeeklyCalls: (params?: WeeklyCallsParams) => gaps().weeklyCalls(params),

      // The Quality page (mock-quality.ts), over the areas the person maintains.
      getQualityHistory({ area, limit }: QualityHistoryParams = {}): HistoryPoint[] {
        return quality().history(readable(area), limit)
      },
      compareRuns({ id, against }: QualityCompareParams): Comparison {
        const model = quality()
        const started = runs.get(id)
        if (!started) {
          retrievalAreas(model.areaOfRun(id))
          return model.compare(id, against)
        }
        // A full run someone started, against a weekly run of its area.
        const detail = evalRunOf(id)
        const run = detail.run
        if (run.kind !== 'full' || run.areaId === null || run.finishedAt === null)
          refuse('invalid', "These test runs can't be compared.")
        const area = run.areaId
        const older = against
          ? model.history([area], 10_000).find((point) => point.run === against)
          : model.history([area], 10_000).find((point) => point.finishedAt < run.finishedAt!)
        if (against && !older) refuse('invalid', "These test runs can't be compared.")
        const result = compareQuestionRuns(
          older ? model.answers(older.run) : [],
          detail.results.map((result) => ({
            id: result.id,
            verdict: result.baseline,
            failedChecks: result.layers?.baseline.failedChecks ?? [],
          })),
        )
        return {
          area,
          run: { id: run.id, kind: 'full', edition: run.edition, finishedAt: run.finishedAt },
          against: older
            ? {
                id: older.run,
                kind: 'scheduled',
                edition: older.edition,
                finishedAt: older.finishedAt,
              }
            : null,
          ...result,
          added: older ? result.added : 0,
        }
      },

      // The Workbench (slice W3): one test question across two runs, and its history, built
      // from the mock's runs and transcripts by the service's rules (quality/question.ts).
      compareQuestion({ question: id, run, against }: QuestionCompareParams): QuestionComparison {
        const question = workbenchQuestion(id)
        const comparable = (detail: EvalRunDetail) => {
          const { kind, state, areaId, finishedAt } = detail.run
          if ((kind !== 'scheduled' && kind !== 'full') || state !== 'finished' || !finishedAt)
            refuse(
              'invalid',
              'Only finished weekly and full test runs of a domain can be compared.',
            )
          if (areaId !== question.area)
            refuse('invalid', 'This test run belongs to another domain than the test question.')
          return detail
        }
        const now = comparable(evalRunOf(run))
        const older = against
          ? undefined
          : quality()
              .history([question.area], 10_000)
              .find((point) => point.finishedAt < now.run.finishedAt!)
        const before = against
          ? comparable(evalRunOf(against))
          : older
            ? evalRunOf(older.run)
            : null
        const digests = {
          prompt: digestOf('mock answer prompt'),
          wordings: digestOf(canonicalJson(question.wordings)),
        }
        const sideOf = (detail: EvalRunDetail) => {
          const delivered = deliveredIn(detail.run)(question)
          return questionSide(
            detail,
            question,
            (cell) => transcriptOf(detail, cell, question, delivered),
            digests,
          )
        }
        const after = sideOf(now)
        const then = before ? sideOf(before) : null
        const factors = then
          ? heldConstant(then.setup, after.setup)
          : { held: [], changed: [], unknown: [] }
        const namings = ['must_deliver', 'must_not_deliver', 'reachable_via_link'] as const
        const named = (item: string) =>
          namings.filter((naming) => (question.expected[naming] ?? []).includes(item))
        const deliveredBy = (side: QuestionComparison['run']) =>
          new Set(side.wordings.flatMap((w) => w.tries.flatMap((t) => t.delivered)))
        const delivered = {
          run: deliveredBy(after.side),
          against: then ? deliveredBy(then.side) : null,
        }
        const ids = [
          ...new Set([
            ...namings.flatMap((naming) => question.expected[naming] ?? []),
            ...delivered.run,
            ...(delivered.against ?? []),
          ]),
        ]
        // The items that differ between the two editions, from the editions engine.
        const changes =
          then && then.side.run.edition !== after.side.run.edition && ids.length
            ? editionReads.compareEditions(
                editionWorld(),
                { from: then.side.run.edition, to: after.side.run.edition, limit: ids.length },
                refuse,
                { items: ids },
              )
            : { items: [], withheld: 0 }
        return structuredClone({
          question: question.id,
          area: question.area,
          run: after.side,
          against: then?.side ?? null,
          heldConstant: factors.held,
          changed: factors.changed,
          unknown: factors.unknown,
          items: changes.items.map((item) => ({
            itemId: item.itemId,
            title: item.title,
            kind: item.kind,
            change: item.change,
            fields: item.fields,
            named: named(item.itemId),
            delivered: {
              run: delivered.run.has(item.itemId),
              against: delivered.against?.has(item.itemId) ?? false,
            },
          })),
          withheld: changes.withheld,
        })
      },
      getQuestionHistory({ question: id, limit = 12 }: QuestionHistoryParams): QuestionHistory {
        const question = workbenchQuestion(id)
        const model = quality()
        const weekly = model
          .history([question.area], limit)
          .map((point) => evalRunOf(point.run, undefined, model))
        const started = [...runs.values()].filter(
          ({ run }) =>
            run.areaId === question.area &&
            run.proposalId === null &&
            run.kind === 'full' &&
            run.state === 'finished',
        )
        const listed = [...weekly, ...started]
          .sort(
            (a, b) =>
              (b.run.finishedAt ?? '').localeCompare(a.run.finishedAt ?? '') ||
              b.run.id.localeCompare(a.run.id),
          )
          .slice(0, limit)
        return structuredClone({
          question: question.id,
          area: question.area,
          runs: listed.map(({ run, results }) => {
            const result = results.find((candidate) => candidate.id === question.id)
            return {
              run: run.id,
              kind: run.kind === 'full' ? ('full' as const) : ('scheduled' as const),
              edition: run.edition,
              finishedAt: run.finishedAt ?? run.createdAt,
              state: result
                ? ('tested' as const)
                : question.setAsideReason !== null
                  ? ('set_aside' as const)
                  : ('absent' as const),
              revision: result ? question.revision : null,
              verdict: result?.baseline ?? null,
              layers: result?.layers?.baseline ?? null,
            }
          }),
          retrieval: [...editions]
            .sort((a, b) => b.seq - a.seq)
            .flatMap((edition) => {
              const pass = retrievalRun(edition, [question.area])
              const result = pass.results.find((candidate) => candidate.id === question.id)
              return result
                ? [
                    {
                      run: pass.id,
                      edition: edition.label,
                      asOf: pass.asOf,
                      revision: result.revision,
                      passed: result.passed,
                      checks: result.checks,
                    },
                  ]
                : []
            })
            .slice(0, limit),
        })
      },
      getFeedbackCounts({ area, weeks }: QualityWeeksParams = {}): FeedbackCounts {
        return quality().feedback(retrievalAreas(area), weeks)
      },
      getRatingCounts({ area, weeks }: QualityWeeksParams = {}): RatingCounts {
        return quality().ratings(retrievalAreas(area), weeks)
      },
      /** For whoever maintains a domain, and administrators: Health's readers. */
      getAppFamilyCounts({ weeks }: AppFamilyCountsParams = {}): AppFamilyCounts {
        retrievalAreas(undefined)
        return quality().apps(weeks)
      },
      /**
       * FR-712: the person rates an answer. Only the verdict, the area of its metrics by the
       * domain rule, as reportGap takes it, and the day are kept.
       */
      rateAnswer({ verdict, metrics }: RatingInput): Rating {
        ratings.push({
          area: areaOfMetrics(metrics ?? [], metricArea),
          verdict,
          day: now().slice(0, 10),
        })
        return { counted: true }
      },
      getUpkeep({ area, weeks }: QualityWeeksParams = {}): Upkeep {
        return quality().upkeep(readable(area), weeks)
      },
      getUntested({ area }: QualityAreaParams = {}): Untested {
        return quality().untested(readable(area))
      },
      getFixNext({ area, limit }: FixNextParams = {}): FixNext {
        const areas = retrievalAreas(area)
        return quality().fixNext(areas ?? world.areas.map((a) => a.id), areas === null, limit)
      },

      // Test questions and runs on the Quality page (mock-runs.ts), as evals.questions and
      // evals.runs answer them: for owners of an area, and administrators.
      saveTestQuestion({ id, revision, question }: SaveTestQuestionInput): TestQuestion {
        const parsed = goldenQuestionSchema.safeParse(question)
        if (!parsed.success)
          refuse(
            'bad-request',
            parsed.error.issues
              .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
              .join('; '),
          )
        const body = parsed.data
        if (body.id !== id)
          refuse(
            'bad-request',
            "This test question doesn't match the one you opened. Reload the page, then try again.",
          )
        rejectQuestionText(body)
        if (!world.areas.some((candidate) => candidate.id === body.area))
          refuse('invalid', `We couldn't find the domain ${body.area}.`)
        mustMaintain(body.area)
        const current = questionStore.get(id)
        if (current) {
          if (revision === undefined)
            refuse('conflict', 'A test question with this id already exists.')
          if (current.revision !== revision)
            refuse(
              'conflict',
              'Someone changed this test question after you opened it. Look at the latest version, then try again.',
            )
          if (current.area !== body.area) mustMaintain(current.area)
        } else if (revision !== undefined)
          refuse('not-found', "We couldn't find this test question. Someone may have deleted it.")
        const saved: TestQuestion = {
          ...body,
          revision: (current?.revision ?? 0) + 1,
          setAsideReason: current?.setAsideReason ?? null,
          updatedAt: now(),
        }
        questionStore.set(id, saved)
        return structuredClone(saved)
      },
      setAsideTestQuestion({ id, revision, reason }: SetAsideInput): TestQuestion {
        const current =
          questionStore.get(id) ??
          refuse('not-found', "We couldn't find this test question. Someone may have deleted it.")
        mustMaintain(current.area)
        if (reason !== null) rejectQuestionText({ ...current, source: reason })
        if (current.revision !== revision)
          refuse(
            'conflict',
            'Someone changed this test question after you opened it. Look at the latest version, then try again.',
          )
        const saved = { ...current, setAsideReason: reason, updatedAt: now() }
        questionStore.set(id, saved)
        return structuredClone(saved)
      },
      importTestQuestions({ content, dryRun = true }: ImportQuestionsInput): ImportReport {
        const report: ImportReport = {
          applied: false,
          created: [],
          updated: [],
          unchanged: [],
          errors: [],
        }
        let document: unknown
        try {
          document = parseYaml(content, { maxAliasCount: 0 })
        } catch {
          report.errors.push({
            index: -1,
            id: null,
            message: "We couldn't read this file. Use YAML or JSON.",
          })
          return report
        }
        const file = questionFileSchema.safeParse(document)
        if (!file.success) {
          report.errors.push({
            index: -1,
            id: null,
            message: 'The file should hold a list of test questions.',
          })
          return report
        }
        const entries = Array.isArray(file.data) ? file.data : file.data.questions
        const plan: GoldenQuestion[] = []
        const seen = new Set<string>()
        for (const [index, entry] of entries.entries()) {
          const id =
            entry && typeof entry === 'object' && 'id' in entry && typeof entry.id === 'string'
              ? entry.id
              : null
          const parsed = goldenQuestionSchema.safeParse(entry)
          if (!parsed.success) {
            report.errors.push({
              index,
              id,
              message: parsed.error.issues
                .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                .join('; '),
            })
            continue
          }
          const question = parsed.data
          if (seen.has(question.id)) {
            report.errors.push({ index, id, message: 'This id is in the file twice.' })
            continue
          }
          seen.add(question.id)
          if (textFindings(question).length) {
            report.errors.push({
              index,
              id,
              message:
                'It holds an email address, phone number, secret or a question someone really asked.',
            })
            continue
          }
          const current = questionStore.get(question.id)
          const mine = (area: string) =>
            world.areas.some((candidate) => candidate.id === area) && (isAdmin() || maintains(area))
          if (!mine(question.area) || (current && !mine(current.area))) {
            report.errors.push({
              index,
              id,
              message: `You can't change the test questions of ${current && !mine(current.area) ? current.area : question.area}.`,
            })
            continue
          }
          if (current && canonicalJson(questionBody(current)) === canonicalJson(question))
            report.unchanged.push(question.id)
          else {
            ;(current ? report.updated : report.created).push(question.id)
            plan.push(question)
          }
        }
        if (report.errors.length || dryRun) return report
        for (const question of plan) {
          const current = questionStore.get(question.id)
          questionStore.set(question.id, {
            ...question,
            revision: (current?.revision ?? 0) + 1,
            setAsideReason: current?.setAsideReason ?? null,
            updatedAt: now(),
          })
        }
        report.applied = true
        return report
      },
      exportTestQuestions({ area, status }: TestQuestionListParams = {}): { content: string } {
        maintainsAny()
        const questions = testQuestions()
          .filter(
            (question) =>
              (area === undefined || question.area === area) &&
              (status === undefined || question.status === status) &&
              (isAdmin() || maintains(question.area)),
          )
          .sort((a, b) => a.id.localeCompare(b.id))
        return {
          content: stringifyYaml({ questions: questions.map(questionBody) }, { lineWidth: 0 }),
        }
      },
      listEvalRuns({ area, proposal, limit = 20 }: EvalRunListParams = {}): EvalRun[] {
        maintainsAny()
        const weekly = proposal
          ? []
          : quality()
              .history(
                (area === undefined ? world.areas.map((a) => a.id) : [area]).filter(
                  (id) => isAdmin() || maintains(id),
                ),
                limit,
              )
              .map((point) => weeklyRun(point, digestOf))
        const own = [...runs.values()]
          .map((detail) => detail.run)
          .filter(
            (run) =>
              (area === undefined || run.areaId === area) &&
              (proposal === undefined || run.proposalId === proposal) &&
              runVisible(run),
          )
        return structuredClone(
          [...weekly, ...own]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
            .slice(0, limit),
        )
      },
      estimateEvalRun({ id, kind = 'full' }: RunEstimateParams): RunEstimate {
        maintainsAny()
        const questions = activeQuestionsOf(id)
        const cells = questions.reduce((sum, q) => sum + q.wordings.length * MOCK_TRIES, 0)
        return {
          area: id,
          kind,
          edition: liveEdition().label,
          questions: questions.length,
          setAside: testQuestions().filter((q) => q.area === id && q.setAsideReason !== null)
            .length,
          cells: kind === 'links' ? cells * 2 : cells,
          cached: 0,
          costMicros: (kind === 'links' ? cells * 2 : cells) * MOCK_TRY_MICROS,
          budgetMicros: MOCK_RUN_BUDGET,
          needsApproval: false,
          modelId: 'mock-scripted-answer',
        }
      },
      startEvalRun({ id }: { id: string }): EvalRun {
        if (!world.areas.some((candidate) => candidate.id === id))
          refuse('not-found', "We couldn't find this domain. Someone may have deleted it.")
        if (!(isAdmin() || maintains(id)))
          refuse('forbidden', 'Only the owners of the domain and admins can start its test runs.')
        const questions = activeQuestionsOf(id)
        const cells = questions.reduce((sum, q) => sum + q.wordings.length * MOCK_TRIES, 0)
        const run = startedRun(
          {
            id: uuid(),
            areaId: id,
            edition: liveEdition().label,
            createdAt: now(),
            requestedBy: personId,
          },
          questions,
          cells * MOCK_TRY_MICROS,
          digestOf,
        )
        // Measured against the area's newest weekly run, the weekly baseline.
        const model = quality()
        const [newest] = model.history([id], 1)
        runs.set(
          run.id,
          runDetail(run, questions, MOCK_TRY_MICROS, {
            delivered: deliveredIn(run),
            baseline: newest
              ? {
                  run: newest.run,
                  verdicts: new Map(
                    model.answers(newest.run).map((a) => [a.id, a.verdict ?? 'no_answer']),
                  ),
                }
              : null,
          }),
        )
        // FR-610: a finished full run of the area verifies its resolved gaps by test.
        const verdicts = new Map(
          runs.get(run.id)!.results.map((result) => [result.id, result.baseline]),
        )
        gapStore.verifyByRun({
          run: run.id,
          kind: run.kind,
          area: id,
          edition: run.edition,
          finishedAt: run.finishedAt ?? run.createdAt,
          verdict: (question) => verdicts.get(question) ?? null,
          question: (question) => questionStore.get(question),
          seqOf: (label) => editions.find((edition) => edition.label === label)?.seq ?? null,
        })
        return structuredClone(run)
      },
      approveEvalRun({ id }: { id: string }): EvalRun {
        if (!isAdmin()) refuse('forbidden', refusals.forbidden)
        evalRunOf(id)
        // A mock run finishes as it starts, so it never waits for approval.
        return refuse('conflict', 'This test run no longer waits for approval.')
      },
      cancelEvalRun({ id }: { id: string }): EvalRun {
        const detail = evalRunOf(id)
        if (
          detail.run.requestedBy !== personId &&
          !(isAdmin() || (detail.run.areaId !== null && maintains(detail.run.areaId)))
        )
          refuse(
            'forbidden',
            'Only the person who started this test run, an owner of the domain or an admin can cancel it.',
          )
        return refuse('conflict', 'This test run has already ended.')
      },
      resumeEvalRun({ id }: { id: string }): EvalRun {
        const detail = evalRunOf(id)
        if (
          detail.run.requestedBy !== personId &&
          !(isAdmin() || (detail.run.areaId !== null && maintains(detail.run.areaId)))
        )
          refuse(
            'forbidden',
            'Only the person who started this test run, an owner of the domain or an admin can resume it.',
          )
        // A mock run finishes as it starts, so it never stops before every answer is made.
        return refuse('conflict', 'Only a test run that stopped before it finished can be resumed.')
      },
      getEvalTranscript(cellId: string): EvalTranscript {
        const notFound = () =>
          refuse('not-found', "We couldn't find this transcript, or you can't see it.")
        const detail = evalRunOf(runOfCell(cellId), notFound)
        const cell = detail.cells.find((candidate) => candidate.id === cellId) ?? notFound()
        const question = questionStore.get(cell.questionId) ?? notFound()
        if (!(isAdmin() || maintains(question.area))) notFound()
        return transcriptOf(detail, cell, question, deliveredIn(detail.run)(question))
      },
      searchScope: (input: ScopeSearchInput) =>
        searchScope(terms, scopeUsage(), {
          query: input.q ?? '',
          ...(input.dimension === undefined ? {} : { dimension: input.dimension }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        }),
      describeScope: (keys: readonly string[]) => describeScope(terms, scopeUsage(), keys),
    }

    /**
     * What the picker puts first, as the service counts it: the terms of the person's own newest
     * drafts, and the live items about each term (a dimension counts every item about it).
     */
    function scopeUsage(): ScopeUsage {
      const mine = [...proposals.values()]
        .filter((p) => p.proposerId === personId && p.discardedAt === null)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 20)
      const recent = [
        ...new Set(
          mine.flatMap(({ draft }) => [
            ...(draft.scope?.metrics ?? []),
            ...(draft.scope?.dimensions ?? []),
            ...(draft.scope?.dimensionValues.map((row) => row.value) ?? []),
          ]),
        ),
      ]
      const uses: Record<string, number> = {}
      for (const item of liveItems(world.items())) {
        if (item.status !== 'accepted') continue
        const keys = new Set([
          ...item.scope.metrics.map((id) => `metric:${id}`),
          ...item.scope.dimensions.map((id) => `dim:${id}`),
          ...item.scope.dimensionValues.flatMap(({ dimension, value }) => [
            `val:${dimension}/${value}`,
            `dim:${dimension}`,
          ]),
        ])
        for (const key of keys) uses[key] = (uses[key] ?? 0) + 1
      }
      return { recent, uses }
    }
  }

  // The `binned` scenario: an administrator moved three items out of the library with one
  // reason, so the Bin has rows to show (stories and screenshots).
  if (mockScenario() === 'binned') {
    const ids = liveItems(world.items())
      .filter((item) => item.status === 'accepted' && audienceAllows(item.audience, noGroups))
      .slice(0, 3)
      .map((item) => item.id)
    const administrator = roster.administrators[0]
    if (administrator && ids.length)
      as(administrator).moveToBin({
        ids,
        reason: 'Duplicates of the pilot import, kept the newer ones',
      })
  }

  return { as, liveItems, travelTo }
}

/**
 * The editions the mock starts with: a bootstrap, then one edition for each of the fixture
 * library's latest accepted versions and retirements, the newest being the live edition of the
 * fixture day. Each edition's state is worked out backwards from the library, which is what the
 * live edition serves.
 */
function startingEditions(world: MockWorld): {
  editions: Edition[]
  states: Map<number, ServedState>
} {
  type Change = { day: string; item: ContextItem; version: number; retired: boolean }
  const byDay = (a: Change, b: Change) =>
    a.day.localeCompare(b.day) ||
    Number(a.retired) - Number(b.retired) ||
    (a.item.id < b.item.id ? -1 : 1)
  const items = world.versionDays ? world.items() : []
  const accepts = items
    .flatMap((item) =>
      world.versionDays!(item)
        .filter((entry) => entry.accepted < world.today)
        .map((entry) => ({ day: entry.accepted, item, version: entry.version, retired: false })),
    )
    .sort(byDay)
    .slice(-HISTORY_ACCEPTS)
  const retirements = items
    .filter((item) => item.status === 'retired' && item.updatedAt.slice(0, 10) < world.today)
    .map((item) => ({
      day: item.updatedAt.slice(0, 10),
      item,
      version: item.version,
      retired: true,
    }))
    .sort(byDay)
    .slice(-HISTORY_RETIREMENTS)
  const changes: Change[] = [...accepts, ...retirements].sort(byDay)
  // The newest change is the live edition's; the others come before it, one edition each.
  const earlier = changes.slice(0, -1)
  const latest = changes.at(-1)
  const perDay = new Map<string, number>()
  const editionOf = (seq: number, day: string, change: Change | undefined): Edition => {
    const count = (perDay.get(day) ?? 0) + 1
    perDay.set(day, count)
    const label = `${day}.${count}`
    const at = `${day}T${String(8 + count).padStart(2, '0')}:00:00.000Z`
    return {
      seq,
      label,
      reason: change?.retired ? 'item_retired' : 'proposal_accepted',
      actorId: change?.item.ownerId ?? null,
      note: change?.retired ? 'No longer true' : null,
      restores: null,
      digest: digestOf(label),
      sealedAt: at,
      createdAt: at,
      live: false,
    }
  }
  const bootstrap: Edition = {
    ...editionOf(1, '2024-01-01', undefined),
    reason: 'bootstrap',
    actorId: null,
  }
  const history = earlier.map((change, index) => editionOf(index + 2, change.day, change))
  const live = { ...editionOf(history.length + 2, world.today, latest), live: true }
  const editions = [bootstrap, ...history, live]

  // Backwards from the library: before a change, its item served the version before it, with
  // what that version said.
  const states = new Map<number, ServedState>()
  let state: ServedState = new Map()
  states.set(live.seq, state)
  const undo = (change: Change | undefined) => {
    if (!change) return
    state = new Map(state)
    const version = change.retired ? change.version : change.version - 1
    const patch =
      world.versionDays!(change.item).find((entry) => entry.version === version)?.patch ?? {}
    state.set(change.item.id, version > 0 ? { version, patch } : null)
  }
  undo(latest)
  for (let index = history.length - 1; index >= 0; index--) {
    states.set(history[index]!.seq, state)
    undo(earlier[index])
  }
  states.set(bootstrap.seq, state)
  return { editions, states }
}

export type MockWorkflow = ReturnType<typeof createMockWorkflow>
