/**
 * The one boundary between the web app and data. Two bindings implement it: `createMockApi`
 * answers from typed fixtures (src/web/mocks) and runs the proposal, review and edition state
 * machine in memory; `createHttpApi` calls the Heed service through the API contract.
 * `src/web/api/index.ts` picks one; nothing else in the app changes.
 *
 * Both bindings throw `ApiError` (errors.ts), so a screen handles a refusal the same way
 * whichever binding answered.
 */
import type * as z from 'zod/mini'
import type { Area, ContextItem, Person, Vocabulary } from '../../domain/item.ts'
import type { CatalogueTermKind } from '../../domain/catalogue.ts'
import type {
  Catalogue,
  CatalogueSource,
  CatalogueTerm,
  CatalogueTermDetail,
  HistoryEntry,
  ItemLinks,
  ItemSort,
  LibraryFreshness,
  LibraryFreshnessParams,
  LibraryIndex,
  LibraryItem,
  ListItemsParams,
  ScopeHit,
  ScopeMatchInput,
  ScopeMatchResult,
  ScopeSearchInput,
  ScopeSearchResult,
} from '../../contract/index.ts'
import type {
  ApplyGrantsInput,
  AssignmentInput,
  GrantChange,
  grantsSchema,
  GrantsApplied,
  Permissions,
  Principal,
  RoleInput,
  SignInPerson,
} from '../../contract/auth.ts'
import type {
  AdminDisconnect,
  AdminDisconnectPerson,
  Connection,
  ConnectionScope,
  ConnectRequest,
  connectDecisionResultSchema,
  connectDecisionSchema,
  PersonConnection,
} from '../../contract/connections.ts'
import type {
  commentSchema,
  createProposalSchema,
  discardedDraftSchema,
  handOverSchema,
  proposalEventSchema,
  proposalListSchema,
  proposalMutationSchema,
  ProposalRecord,
  PreviewReply,
  ProposalListResult,
  previewSchema,
  proposalPreviewSchema,
  ProposalTest,
  proposalTestInputSchema,
  overlapSchema,
  saveDraftSchema,
  withdrawSchema,
} from '../../contract/proposals.ts'
import type { UIMessage, UIMessageChunk } from 'ai'
import type {
  BinItem,
  BinItemsInput,
  BinList,
  BinMoveInput,
  BinMoveResult,
  BinPreview,
  BinRescuePreview,
  BinRescuePreviewInput,
  BinRestoreInput,
  BinRestoreResult,
} from '../../contract/bin.ts'
import type { Rating, RatingInput } from '../../contract/assistant.ts'
import type {
  ConnectInfo,
  TryIt,
  TryItInput,
  TryItReading,
  TryItReadInput,
} from '../../contract/connect.ts'
import type { PeoplePage, PeopleSearchInput, PersonSheet } from '../../contract/people.ts'
import type {
  AuditEntry,
  auditChainSchema,
  auditExportInputSchema,
  auditExportSchema,
  auditPageSchema,
  auditSearchSchema,
  ClientPolicy,
  editionExportSchema,
  ItemImportReport,
  itemImportSchema,
  saveClientSchema,
  Setting,
  SettingKey,
  setSettingSchema,
  setToolSchema,
  toolSwitchSchema,
  TrafficSummary,
} from '../../contract/admin.ts'
import type {
  AreaDetail,
  AreaHoldings,
  AreaRemoval,
  AreaRemoved,
  AreaRestored,
  ArchivedArea,
  createAreaSchema,
  describeAreaSchema,
  removeAreaSchema,
  restoreAreaSchema,
  updateAreaSchema,
} from '../../contract/areas.ts'
import type { OperationsOverviewView, runJobSchema } from '../../contract/operations.ts'
import type {
  AddSourceInput,
  SourceCheck,
  SourceSettings,
  ConnectorListing,
  TestSourceInput,
  UpdateSourceInput,
} from '../../contract/sources.ts'
import type {
  Gap,
  GapDetail,
  GapHistoryEntry,
  GapReport,
  GapReportInput,
  GapTest,
  gapDraftInputSchema,
  gapLinkTestInputSchema,
  gapListInputSchema,
  gapNoteInputSchema,
  gapStatusInputSchema,
  gapUnlinkTestInputSchema,
  TopicCounts,
  topicCountsInputSchema,
  WeeklyCalls,
  weeklyCallsInputSchema,
} from '../../contract/gaps.ts'
import type {
  EvalRun,
  estimateInputSchema,
  estimateSchema,
  importReportSchema,
  importSchema,
  questionListSchema,
  retrievalAreaSchema,
  retrievalEditionInputSchema,
  retrievalEditionSchema,
  RetrievalPoint,
  retrievalTrendInputSchema,
  runDetailSchema,
  runListSchema,
  saveQuestionSchema,
  setAsideSchema,
  storedQuestionSchema,
  transcriptSchema,
} from '../../contract/evals.ts'
import type {
  AppFamilyCounts,
  AppFamilyCountsInput,
  Comparison,
  compareInputSchema,
  FeedbackCounts,
  FixNext,
  fixNextInputSchema,
  HistoryPoint,
  historyInputSchema,
  qualityAreaInputSchema,
  qualityWeeksInputSchema,
  compareQuestionInputSchema,
  RatingCounts,
  QuestionComparison,
  QuestionHistory,
  questionHistoryInputSchema,
  Untested,
  Upkeep,
} from '../../contract/quality.ts'
import type {
  InboxItem,
  inboxChangeSchema,
  inboxIdsSchema,
  inboxListSchema,
  inboxPageSchema,
  StreamEvent,
} from '../../contract/notifications.ts'
import type {
  activeStopSchema,
  decideSchema,
  AttachedTest,
  decisionResultSchema,
  Edition,
  editionDiffInputSchema,
  editionDiffSchema,
  editionListSchema,
  Gate,
  itemReasonSchema,
  LevelResult,
  queueSchema,
  reviewEditSchema,
  ReviewProposal,
  reviewSchema,
  rollbackSchema,
  stopSchema,
  decideTermBatchSchema,
  termBatchDecisionSchema,
  termBatchResultSchema,
  termBatchSchema,
  TermCandidate,
  ItemReview,
  bulkAssignSchema,
  bulkAssignmentSchema,
  bulkDecideSchema,
  bulkDecisionSchema,
  bulkPlanInputSchema,
  bulkPlanSchema,
  QueueEntry,
  BulkSkip,
} from '../../contract/review.ts'
import type {
  compareItemInputSchema,
  editionCompareInputSchema,
  editionComparisonSchema,
  editionFeedInputSchema,
  editionFeedSchema,
  itemComparisonSchema,
  rollbackPreviewSchema,
} from '../../contract/editions.ts'

// The shapes come from the API contract (src/contract), so the mock and the http binding are
// checked against the same definition the service implements.
export type {
  AreaDetail,
  AttachedTest,
  AuditEntry,
  Catalogue,
  CatalogueSource,
  ClientPolicy,
  ConnectInfo,
  CatalogueTerm,
  CatalogueTermDetail,
  CatalogueTermKind,
  Edition,
  Gap,
  GapDetail,
  GapHistoryEntry,
  GapReport,
  GapReportInput,
  GapTest,
  EvalRun,
  Gate,
  HistoryEntry,
  InboxItem,
  ItemImportReport,
  ItemLinks,
  ItemSort,
  LevelResult,
  LibraryFreshness,
  LibraryFreshnessParams,
  LibraryIndex,
  LibraryItem,
  ListItemsParams,
  OperationsOverviewView,
  Permissions,
  Principal,
  PreviewReply,
  ProposalRecord,
  ProposalTest,
  ReviewProposal,
  ScopeHit,
  ScopeMatchInput,
  ScopeMatchResult,
  ScopeSearchInput,
  ScopeSearchResult,
  Setting,
  SettingKey,
  TopicCounts,
  WeeklyCalls,
  TrafficSummary,
  StreamEvent,
  TryIt,
  TryItInput,
  TryItReading,
  TryItReadInput,
}

/** The signed-in person with their roles, and the token every change must carry. */
export type Session = { person: Principal; csrfToken: string }
/** Someone the local sign-in can sign in as (the dev identity connector's list). */
export type { SignInPerson }

// A person's own AI apps (FR-403): the consent screen and the apps connected as the person.
export type { Connection, ConnectionScope, ConnectRequest }
// Every person's AI apps, for administrators (FR-403, FR-807).
export type { AdminDisconnect, AdminDisconnectPerson, PersonConnection }
export type ConnectDecisionInput = z.infer<typeof connectDecisionSchema>
/** The app's own redirect address, with the code or the refusal: the page goes there next. */
export type ConnectDecisionResult = z.infer<typeof connectDecisionResultSchema>

export type CreateProposalInput = z.infer<typeof createProposalSchema>
export type PreviewInput = z.infer<typeof previewSchema>
export type ProposalOverlap = z.infer<typeof overlapSchema>
/** The get_context reply an agent would get if the draft were accepted (FR-108, FR-214). */
export type ProposalPreview = z.infer<typeof proposalPreviewSchema>
export type SaveDraftInput = z.infer<typeof saveDraftSchema>
/** A proposal id and the revision the person read: a change to a newer revision is a conflict. */
export type ProposalMutation = z.infer<typeof proposalMutationSchema>
export type WithdrawInput = z.infer<typeof withdrawSchema>
/** A discarded draft reads as not found from then on, and leaves every list. */
export type DiscardedDraft = z.infer<typeof discardedDraftSchema>
export type CommentInput = z.infer<typeof commentSchema>
export type HandOverInput = z.infer<typeof handOverSchema>
export type ProposalListParams = z.infer<typeof proposalListSchema>
export type ProposalEvent = z.infer<typeof proposalEventSchema>
/** A development test question of the proposal's area, for its check (FR-524). */
export type ProposalTestInput = z.infer<typeof proposalTestInputSchema>
export type QueueParams = z.infer<typeof queueSchema>
export type Review = z.infer<typeof reviewSchema>
export type DecideInput = z.infer<typeof decideSchema>
/** What an owner changes during review: risk, review date, claim level, owner or area. */
export type ReviewEditInput = z.infer<typeof reviewEditSchema>
export type DecisionResult = z.infer<typeof decisionResultSchema>
/** Many terms proposed in one step: an administrator's batch (FR-125). */
export type TermBatchInput = z.infer<typeof termBatchSchema>
export type TermBatchResult = z.infer<typeof termBatchResultSchema>
export type DecideTermBatchInput = z.infer<typeof decideTermBatchSchema>
/** Several proposals of the review queue, at the revisions the person selected (FR-223). */
export type BulkPlanInput = z.infer<typeof bulkPlanInputSchema>
export type BulkPlan = z.infer<typeof bulkPlanSchema>
export type BulkDecideInput = z.infer<typeof bulkDecideSchema>
export type BulkDecision = z.infer<typeof bulkDecisionSchema>
export type BulkAssignInput = z.infer<typeof bulkAssignSchema>
export type BulkAssignment = z.infer<typeof bulkAssignmentSchema>
export type TermBatchDecision = z.infer<typeof termBatchDecisionSchema>
export type { TermCandidate, ItemReview }
export type { BulkSkip, QueueEntry }
export type EditionListParams = z.infer<typeof editionListSchema>
export type RollbackInput = z.infer<typeof rollbackSchema>
/** An edition as one canonical JSON document with its digests (NFR-045, NFR-093). */
export type EditionExport = z.infer<typeof editionExportSchema>
export type EditionDiffInput = z.infer<typeof editionDiffInputSchema>
/** Items, vocabulary terms and area states whose version or state differs between two editions. */
export type EditionDiff = z.infer<typeof editionDiffSchema>
// Seeing what changed between editions (Editions design G1 to G3), for the Editions pages and the
// Workbench alike: one comparison engine, on the service.
export type EditionCompareInput = z.infer<typeof editionCompareInputSchema>
/** Net change between two editions: each item once, with who and why and counts for filters. */
export type EditionComparison = z.infer<typeof editionComparisonSchema>
export type EditionItemCompareInput = z.infer<typeof compareItemInputSchema>
/** One item between two editions: its field changes, mentions and each edition that changed it. */
export type EditionItemComparison = z.infer<typeof itemComparisonSchema>
export type EditionFeedInput = z.infer<typeof editionFeedInputSchema>
/** Editions newest first, each with what it changed, who did it and why, and one sentence. */
export type EditionFeed = z.infer<typeof editionFeedSchema>
/**
 * What going back to an edition would do (G7): the live edition compared with it, backwards, and
 * the versions it serves that cannot be served again. Going back is refused while any remain.
 */
export type RollbackPreview = z.infer<typeof rollbackPreviewSchema>
/** A version that cannot be served again, with the service's reason (FR-205). */
export type BlockedVersion = RollbackPreview['blocked'][number]
/** A stop switch that is on. Only an administrator gets its event number (`seq`). */
export type ActiveStop = z.infer<typeof activeStopSchema>
export type StopInput = z.infer<typeof stopSchema>
/** An item and the reason for retiring or rechecking it (FR-112, FR-218, CON-211). */
export type ItemReasonInput = z.infer<typeof itemReasonSchema>
export type {
  BinEntry,
  BinItem,
  BinItemsInput,
  BinList,
  BinMoveInput,
  BinMoveResult,
  BinPreview,
  BinRescuePreview,
  BinRescuePreviewInput,
  BinRestoreInput,
  BinRestoreResult,
  RescueChange,
} from '../../contract/bin.ts'
/** An answer test run with its results and the questions that flipped (FR-509, FR-510). */
export type EvalRunDetail = z.infer<typeof runDetailSchema>
export type TestQuestionListParams = z.infer<typeof questionListSchema>
/** A test question of an area with its wordings (FR-501). */
export type TestQuestion = z.infer<typeof storedQuestionSchema>
/** A new test question (no revision), or one replaced on the revision that was read. */
export type SaveTestQuestionInput = z.input<typeof saveQuestionSchema>
/** Sets a question aside with a reason, or brings it back (`reason` null). */
export type SetAsideInput = z.infer<typeof setAsideSchema>
/** A YAML or JSON file of test questions; a dry run reports without saving (FR-504). */
export type ImportQuestionsInput = z.input<typeof importSchema>
export type ImportReport = z.infer<typeof importReportSchema>
export type EvalRunListParams = z.infer<typeof runListSchema>
export type RunEstimateParams = z.infer<typeof estimateInputSchema>
/** What a full run of an area would cost, and whether an administrator must approve it (FR-516). */
export type RunEstimate = z.infer<typeof estimateSchema>
/** One try of one wording: the conversation, the tool calls and the scores (FR-519). */
export type EvalTranscript = z.infer<typeof transcriptSchema>
/** An edition's retrieval pass (no model): each test question delivered as expected or not. */
export type RetrievalEdition = z.infer<typeof retrievalEditionSchema>
export type { RetrievalPoint }
export type RetrievalAreaParams = z.infer<typeof retrievalAreaSchema>
export type RetrievalEditionParams = z.infer<typeof retrievalEditionInputSchema>
export type RetrievalTrendParams = z.infer<typeof retrievalTrendInputSchema>
// The Quality page (Quality design, section 7).
export type {
  AppFamilyCounts,
  Comparison,
  FeedbackCounts,
  FixNext,
  HistoryPoint,
  RatingCounts,
  Untested,
  Upkeep,
}
export type AppFamilyCountsParams = AppFamilyCountsInput
export type QualityHistoryParams = z.infer<typeof historyInputSchema>
export type QualityCompareParams = z.infer<typeof compareInputSchema>
export type QualityAreaParams = z.infer<typeof qualityAreaInputSchema>
export type QualityWeeksParams = z.infer<typeof qualityWeeksInputSchema>
export type FixNextParams = z.infer<typeof fixNextInputSchema>
// The Workbench (slice W3): one test question across two runs, and its history.
export type { QuestionComparison, QuestionHistory }
export type QuestionCompareParams = z.infer<typeof compareQuestionInputSchema>
export type QuestionHistoryParams = z.infer<typeof questionHistoryInputSchema>
/** An MCP tool and whether it is switched on for every client (FR-407). */
export type ToolSwitch = z.infer<typeof toolSwitchSchema>
export type SetToolInput = z.infer<typeof setToolSchema>
/** A client to add, or a client's new tools, limits or switch, with the reason (FR-408). */
export type SaveClientInput = z.infer<typeof saveClientSchema>
/** MCP traffic over the last this many days, counted in whole hours (FR-410). */
export type TrafficParams = { days?: number }
// Settings (FR-801, FR-804, FR-806 to FR-810). Administrators, and auditors for the history log.
/** A new version of a setting, on the version read, with the reason (FR-809). */
export type SetSettingInput = z.infer<typeof setSettingSchema>
/** The global roles and the area roles that are held, each since when (FR-804). */
export type Grants = z.infer<typeof grantsSchema>
export type {
  HeldRole,
  PeoplePage,
  PeopleRoleFilter,
  PeopleSearchInput,
  PeopleSignInFilter,
  PersonGrant,
  PersonRow,
  PersonSheet,
  PersonStatus,
  RoleChange,
} from '../../contract/people.ts'
export type { ApplyGrantsInput, AssignmentInput, GrantChange, GrantsApplied, RoleInput }
/** A new area, served at once, with the reason and, when named, its team (FR-801). */
export type CreateAreaInput = z.input<typeof createAreaSchema>
/** An area's name, hue, review time, channel or owner team, on the revision read. */
export type UpdateAreaInput = z.infer<typeof updateAreaSchema>
export type DescribeAreaInput = z.input<typeof describeAreaSchema>
/** Deleting an area: `permanently delete` typed to confirm, on the revision read (FR-814). */
export type RemoveAreaInput = z.infer<typeof removeAreaSchema>
export type RestoreAreaInput = z.infer<typeof restoreAreaSchema>
export type { AreaHoldings, AreaRemoval, AreaRemoved, AreaRestored, ArchivedArea }
/** A queued run of a scheduled job (FR-810). */
export type RunJobResult = z.infer<typeof runJobSchema>
export type {
  AddSourceInput,
  SourceCheck,
  SourceSettings,
  ConnectorListing,
  TestSourceInput,
  UpdateSourceInput,
}
/** Filters of the history log, and the page before (`before`, the previous page's `next`). */
export type AuditSearchParams = z.input<typeof auditSearchSchema>
/** A page of the history log, newest first; `next` reads the page after it. */
export type AuditPage = z.infer<typeof auditPageSchema>
export type AuditExportParams = z.input<typeof auditExportInputSchema>
/** The history log as JSON Lines or CSV, oldest first, with the chain's check (FR-808). */
export type AuditExport = z.infer<typeof auditExportSchema>
/** Whether every entry's hash follows from its content and the entry before (FR-806). */
export type AuditChain = z.infer<typeof auditChainSchema>
/** A YAML or JSON file of items to propose; a dry run by default (FR-120). */
export type ImportItemsInput = z.input<typeof itemImportSchema>

/** Gaps a person may see, open first; a page of at most 200 (FR-604 to FR-609). */
export type GapListParams = z.infer<typeof gapListInputSchema>
/** An owner sets open, won't fix or resolved, with an optional reason (FR-609). */
export type GapStatusInput = z.infer<typeof gapStatusInputSchema>
export type GapNoteInput = z.infer<typeof gapNoteInputSchema>
/** A test question of the gap's area, and the failing run that led to it if any (FR-610). */
export type GapLinkTestInput = z.infer<typeof gapLinkTestInputSchema>
export type GapUnlinkTestInput = z.infer<typeof gapUnlinkTestInputSchema>
/** The area is needed only when the gap's topic spans areas or has none (FR-616). */
export type GapDraftInput = z.infer<typeof gapDraftInputSchema>
export type TopicCountsParams = z.infer<typeof topicCountsInputSchema>
export type WeeklyCallsParams = z.infer<typeof weeklyCallsInputSchema>
export type InboxListParams = z.infer<typeof inboxListSchema>
/** A page of the inbox, newest first, with the unread count of the whole inbox. */
export type InboxPage = z.infer<typeof inboxPageSchema>
export type InboxIds = z.infer<typeof inboxIdsSchema>
/** How many items a change touched, and the unread count after it. */
export type InboxChange = z.infer<typeof inboxChangeSchema>
/**
 * One assistant turn: the whole conversation as the browser holds it, as AI SDK UI messages, with
 * the seals of what earlier turns read (`data-evidence`). The service keeps none of it (FR-603).
 * The person's time zone lets it count "today" and "last week" as they do.
 */
export type AssistantChatInput = {
  messages: (Omit<UIMessage, 'role'> & { role: 'user' | 'assistant' })[]
  timeZone?: string
}
export type { Rating, RatingInput }
export type AssistantChatOptions = {
  /** Aborting it stops the answer: a person pressed Stop. */
  signal?: AbortSignal
}

export type StreamOptions = {
  /** The id of the last event read: the stream replays every later one first. */
  lastEventId?: string
  /** Aborting it closes the stream. */
  signal: AbortSignal
}

export type Page<T> = {
  rows: T[]
  /** Number of rows that match, before paging. */
  total: number
  limit: number
  offset: number
}

/** Favourites and recent items: lists that stay in the person's browser (see personal.ts). */
export type PersonalLists = {
  listFavorites: () => string[]
  setFavorite: (id: string, favorite: boolean) => string[]
  listRecent: () => string[]
  recordVisit: (id: string) => string[]
}

export interface ContextApi {
  listItems: (params?: ListItemsParams) => Promise<Page<ContextItem>>
  getItem: (id: string) => Promise<ContextItem | null>
  /** What an item mentions and which items mention it; null for an unknown id. */
  getItemLinks: (id: string) => Promise<ItemLinks | null>
  /** Every item the person may read, as a light index for the list and search. */
  listLibrary: () => Promise<LibraryIndex>
  /**
   * How much of the library was current today and on the same weekday of each week before, over
   * the items for everyone, oldest first: Home's freshness and its change on the week before.
   */
  getLibraryFreshness: (params?: LibraryFreshnessParams) => Promise<LibraryFreshness>
  getItemHistory: (id: string) => Promise<HistoryEntry[]>
  /**
   * How the live edition's version of each item was reviewed (FR-326): who accepted it, on which
   * day, in which edition, and the checks it passed, for the review stamp. Items the person may
   * not read, or that agents are not served, are left out.
   */
  getServedReviews: (ids: readonly string[]) => Promise<ItemReview[]>
  listAreas: () => Promise<Area[]>
  listPeople: () => Promise<Person[]>
  getVocabulary: () => Promise<Vocabulary>
  /**
   * A page of metrics, dimensions and values for "Where it applies" (FR-107): per dimension the
   * dimension itself ("any value"), how many values match and the first few, recent and often
   * used first. Inside one dimension it pages through the values. Empty words find nothing there.
   */
  searchScope: (input: ScopeSearchInput) => Promise<ScopeSearchResult>
  /** A pasted list, matched name by name; what matches nothing is named. */
  matchScope: (input: ScopeMatchInput) => Promise<ScopeMatchResult>
  /** The names of a scope's keys, for its chips. A key no longer in use is left out. */
  describeScope: (keys: string[]) => Promise<ScopeHit[]>
  /**
   * Every metric and dimension of the live vocabulary, with the definition source's copy of its
   * description and what the library holds about it (FR-136).
   */
  listCatalogue: () => Promise<Catalogue>
  /** One metric or dimension, a dimension with its values; null for an unknown one. */
  getCatalogueTerm: (kind: CatalogueTermKind, id: string) => Promise<CatalogueTermDetail | null>
  /** The signed-in person, their roles and the change token. Throws `signed-out` without one. */
  getSession: () => Promise<Session>
  signOut: () => Promise<void>
  /** Who the local sign-in offers. Needs no session. */
  listSignInPeople: () => Promise<SignInPerson[]>
  /** Signs in as one of them, ending any session this browser had. */
  signIn: (email: string) => Promise<Session>

  // A person's own AI apps (FR-403)
  /** The AI app sign-in this browser started; null when it ended or another browser started it. */
  getConnectRequest: (id: string) => Promise<ConnectRequest | null>
  /** Allow or deny it. The answer is where the browser goes next: back to the app. */
  decideConnectRequest: (input: ConnectDecisionInput) => Promise<ConnectDecisionResult>
  /** The AI apps connected as the signed-in person, newest first. */
  listConnections: () => Promise<Connection[]>
  /** Disconnects an app at once: it can no longer read anything as the person. */
  disconnectApp: (input: { id: string }) => Promise<{ disconnected: boolean }>
  /**
   * The person's favourite items, in the order they were added. Favourites and recent items are
   * kept in this browser by both bindings: the service records who writes and decides, never
   * what a person reads (requirements, section 6).
   */
  listFavorites: () => Promise<string[]>
  setFavorite: (id: string, favorite: boolean) => Promise<string[]>
  /** The items the person opened, most recent first. */
  listRecent: () => Promise<string[]>
  recordVisit: (id: string) => Promise<string[]>

  // Proposals (FR-101 to FR-115). Every change names the revision it was made on.
  /** Item create and change proposals, newest first; `own` keeps the person's own. */
  listProposals: (params?: ProposalListParams) => Promise<ProposalListResult>
  getProposal: (id: string) => Promise<ProposalRecord | null>
  previewProposal: (input: PreviewInput) => Promise<ProposalPreview>
  getProposalOverlap: (id: string) => Promise<ProposalOverlap>
  createProposal: (input: CreateProposalInput) => Promise<ProposalRecord>
  saveDraft: (input: SaveDraftInput) => Promise<ProposalRecord>
  submitProposal: (input: ProposalMutation) => Promise<ProposalRecord>
  withdrawProposal: (input: WithdrawInput) => Promise<ProposalRecord>
  /** The author, or an administrator, discards a draft that was never sent. */
  discardDraft: (input: ProposalMutation) => Promise<DiscardedDraft>
  commentOnProposal: (input: CommentInput) => Promise<ProposalRecord>
  /** An owner or deputy of the area takes the proposal for review (FR-211). */
  claimProposal: (input: ProposalMutation) => Promise<ProposalRecord>
  handOverProposal: (input: HandOverInput) => Promise<ProposalRecord>
  /** What happened to a proposal, oldest first. */
  listProposalEvents: (id: string) => Promise<ProposalEvent[]>
  /**
   * The test questions attached to a proposal's check (FR-524). The gate reports their results
   * with the change; they never block it.
   */
  listProposalTests: (id: string) => Promise<ProposalTest[]>
  /**
   * The draft's author while it is a draft, or the area's owners, deputies and administrators
   * until a decision, attaches a development test question of the area; attaching it again
   * changes nothing.
   */
  attachProposalTest: (input: ProposalTestInput) => Promise<ProposalTest[]>
  /** Detaches a test question; detaching one that is not attached changes nothing. */
  detachProposalTest: (input: ProposalTestInput) => Promise<ProposalTest[]>

  // Review (FR-201 to FR-211)
  /** Open proposals the person may decide, highest risk first, then oldest (FR-208). */
  listReviewQueue: (params?: QueueParams) => Promise<QueueEntry[]>
  /** The review screen's data; null for an unknown proposal or one the person may not see. */
  getReview: (id: string) => Promise<Review | null>
  runChecks: (id: string) => Promise<Gate>
  /**
   * An owner or deputy changes the risk, review date, claim level, owner or area of a
   * proposal under review (FR-105, FR-106, FR-123, FR-324). The checks run again on the changed
   * version; the answer is the review screen's data after the change.
   */
  editReview: (input: ReviewEditInput) => Promise<Review>
  /** Accept, ask for changes or reject. The last needed accept publishes an edition. */
  decide: (input: DecideInput) => Promise<DecisionResult>
  /**
   * What one decision for several proposals would do to each, and which it leaves out with
   * why, before anything is written (FR-223).
   */
  planDecisions: (input: BulkPlanInput) => Promise<BulkPlan>
  /**
   * One decision for several proposals, with one reason (FR-223): each gets its own decision
   * and checks; the ones the person may not decide this way are left out and named. Accepts
   * publish as few editions as the rules allow.
   */
  decideMany: (input: BulkDecideInput) => Promise<BulkDecision>
  /** Claims several proposals for a reviewer of their area, or hands them over to one. */
  assignProposals: (input: BulkAssignInput) => Promise<BulkAssignment>

  // Vocabulary from the definition source (FR-125, FR-136)
  /**
   * The source's members that no term or open proposal links yet, each as the term to propose
   * for it. Administrators only.
   */
  listTermCandidates: () => Promise<TermCandidate[]>
  /**
   * Proposes many terms in one step, all or none: one proposal each, in one batch. Nothing is
   * accepted: an owner of each term's domain, or an administrator, decides. Administrators
   * only.
   */
  proposeTerms: (input: TermBatchInput) => Promise<TermBatchResult>
  /** Accepts or rejects every open term of a batch the person may decide; an accept is one edition. */
  decideTermBatch: (input: DecideTermBatchInput) => Promise<TermBatchDecision>

  // Editions (FR-215, FR-217)
  /** Editions, newest first. */
  listEditions: (params?: EditionListParams) => Promise<Edition[]>
  /** Serve an earlier edition's content again, as a new edition. Administrators only. */
  rollbackEdition: (input: RollbackInput) => Promise<Edition>
  /**
   * What going back to an edition would change against the live edition, and what would stop it,
   * before anyone does it. Administrators only, like going back.
   */
  previewRollback: (label: string) => Promise<RollbackPreview>
  /** What changed in an edition against another one, by default the edition before it. */
  diffEdition: (input: EditionDiffInput) => Promise<EditionDiff>
  /** An edition as one JSON document with its digests (NFR-045), for download. */
  exportEdition: (label: string) => Promise<EditionExport>
  /**
   * What changed between two editions, each item once (by default the live edition against the
   * one before), with who made each change and why, and counts over every change for filters.
   */
  compareEditions: (input?: EditionCompareInput) => Promise<EditionComparison>
  /** One item between two editions, field by field, and each edition in between that changed it. */
  compareEditionItem: (input: EditionItemCompareInput) => Promise<EditionItemComparison>
  /** Editions newest first, each with what it changed in counts and one sentence; paged by edition. */
  editionFeed: (input?: EditionFeedInput) => Promise<EditionFeed>

  // Delivery (FR-805)
  /** The stop switches that are on. Everyone signed in reads them, for the banner. */
  listStops: () => Promise<ActiveStop[]>
  /** Switch delivery off or on for one item, one area or everything. Administrators only. */
  setStop: (input: StopInput) => Promise<ActiveStop[]>

  // Retiring and rechecking an item (FR-112, FR-218, CON-211)
  /** An owner, deputy or administrator retires an item at once; it publishes an edition. */
  retireItem: (input: ItemReasonInput) => Promise<Edition>
  /** Anyone proposes that an item is retired; an owner of its area decides. */
  proposeRetirement: (input: ItemReasonInput) => Promise<ReviewProposal>
  /**
   * An owner or deputy records "checked, still correct". It publishes an edition at once, or
   * waits in the review queue (`edition` is null) while its answer tests or an approver are due.
   */
  recheckItem: (input: ItemReasonInput) => Promise<DecisionResult>

  // The Bin: administrators remove items from the library and bring them back
  /** Items in the Bin, newest first, with who moved each, when and why. Administrators only. */
  listBin: () => Promise<BinList>
  /**
   * One item in the Bin, as the library showed it, to read before restoring it; null when it is
   * not in the Bin. Administrators only.
   */
  getBinItem: (id: string) => Promise<BinItem | null>
  /** What moving items to the Bin would do: which agents get now, and their open proposals. */
  previewBin: (input: BinItemsInput) => Promise<BinPreview>
  /**
   * Moves items to the Bin with one reason. The ones agents get stop in one new edition; an item
   * already retired moves without one. Administrators only.
   */
  moveToBin: (input: BinMoveInput) => Promise<BinMoveResult>
  /**
   * What restoring the items of a deleted domain among `ids` into the domain `areaId` would
   * change in each (FR-814), and why one cannot go there. Administrators only.
   */
  previewRescue: (input: BinRescuePreviewInput) => Promise<BinRescuePreview>
  /**
   * Restores items from the Bin: the ones agents got are served again in one new edition, the
   * others come back retired. An item whose domain is deleted goes to `areaId` instead: retired,
   * with a proposal there for its owners to review (FR-814). Administrators only.
   */
  restoreFromBin: (input: BinRestoreInput) => Promise<BinRestoreResult>

  // Gaps (FR-604 to FR-616). Counts below the privacy minimum come back hidden (null, FR-614).
  /** Gaps the person may see, open first, then most recently seen. */
  listGaps: (params?: GapListParams) => Promise<Gap[]>
  /**
   * One gap and whether it is verified by test; its notes, linked tests and history only for an
   * owner of its area or an administrator. Null when not seen.
   */
  getGap: (id: string) => Promise<GapDetail | null>
  /** An owner of the gap's area, or an administrator, sets its status. */
  setGapStatus: (input: GapStatusInput) => Promise<GapDetail>
  addGapNote: (input: GapNoteInput) => Promise<GapDetail>
  /**
   * An owner of the gap's area, or an administrator, links a test question of the area that
   * captures the gap (FR-610); linking it again changes nothing.
   */
  linkGapTest: (input: GapLinkTestInput) => Promise<GapDetail>
  /** Unlinks a test from the gap; a verification already recorded stays. */
  unlinkGapTest: (input: GapUnlinkTestInput) => Promise<GapDetail>
  /** Starts a draft filled with the gap's scope, owned by the person (FR-616). */
  startDraftFromGap: (input: GapDraftInput) => Promise<ProposalRecord>
  /**
   * Reports a gap about a scope the person was looking at (FR-606 case 5): Try it today, the
   * assistant next. One report counts against the topic's gap, as an agent's report_gap does;
   * nothing names the person. Refused (`invalid`) when the scope does not resolve on the live
   * edition or the note holds personal data; `unavailable` after too many reports in a minute.
   */
  reportGap: (input: GapReportInput) => Promise<GapReport>
  /** Agent calls per topic and week, only where a topic week reaches the minimum (FR-614). */
  getTopicCounts: (params?: TopicCountsParams) => Promise<TopicCounts>
  /**
   * Agent calls per week over every topic, the same for every reader: the exact weekly total,
   * hidden when it or what it adds over the shown topic weeks is under the minimum (FR-614), with
   * the shown topic weeks' sum as a floor. Oldest week first, the current one last.
   */
  getWeeklyCalls: (params?: WeeklyCallsParams) => Promise<WeeklyCalls>
  // Answer tests (FR-509, FR-510): what a review screen shows of a proposal's answer run
  /** One answer test run with its results and flips; null for an unknown one. */
  getEvalRun: (id: string) => Promise<EvalRunDetail | null>
  /** The test questions the person may read, held-out ones only for an owner of the area. */
  listTestQuestions: (params?: TestQuestionListParams) => Promise<TestQuestion[]>
  // Test questions and runs on the Quality page: owners, deputies and administrators.
  /** Writes a test question: a new one, or a change on the revision read. */
  saveTestQuestion: (input: SaveTestQuestionInput) => Promise<TestQuestion>
  /** Sets a question aside, out of every run, with the reason; null brings it back. */
  setAsideTestQuestion: (input: SetAsideInput) => Promise<TestQuestion>
  /** Checks a file of test questions, or saves it when every entry is valid. */
  importTestQuestions: (input: ImportQuestionsInput) => Promise<ImportReport>
  /** The test questions, of one area or every area the person maintains, as a YAML file. */
  exportTestQuestions: (params?: TestQuestionListParams) => Promise<{ content: string }>
  /** Answer test runs, newest first (20 unless a limit is given). */
  listEvalRuns: (params?: EvalRunListParams) => Promise<EvalRun[]>
  /** What a full run of an area would cost now. */
  estimateEvalRun: (params: RunEstimateParams) => Promise<RunEstimate>
  /** Starts a full run of an area on the live edition; above the budget it waits for approval. */
  startEvalRun: (input: { id: string }) => Promise<EvalRun>
  /** An administrator approves a run estimated above the budget (FR-516). */
  approveEvalRun: (input: { id: string }) => Promise<EvalRun>
  /** Stops a run that has not ended. */
  cancelEvalRun: (input: { id: string }) => Promise<EvalRun>
  /** Queues a run that stopped before every answer was made; only those are made (R6). */
  resumeEvalRun: (input: { id: string }) => Promise<EvalRun>
  /** One try's transcript; null when it is unknown or the person may not read it. */
  getEvalTranscript: (cellId: string) => Promise<EvalTranscript | null>
  // The retrieval pass of every edition, without a model: owners, deputies and administrators.
  /** The newest pass of the live edition, over one area or every area the person maintains. */
  getRetrievalLatest: (params?: RetrievalAreaParams) => Promise<RetrievalEdition>
  /** The pass of one sealed edition; `run` is null until it has had one. */
  getRetrievalEdition: (params: RetrievalEditionParams) => Promise<RetrievalEdition>
  /** Every pass, newest first: one per sealed edition and per day of the live edition. */
  getRetrievalTrend: (params?: RetrievalTrendParams) => Promise<RetrievalPoint[]>
  // The Quality page: owners, deputies and administrators, over the areas they maintain.
  /** Per finished weekly run, newest first: rates, held-out measures, retrieval and cost. */
  getQualityHistory: (params?: QualityHistoryParams) => Promise<HistoryPoint[]>
  /** A weekly or full run against an earlier one of its area: better, worse and a sign test. */
  compareRuns: (params: QualityCompareParams) => Promise<Comparison>
  /** Agent feedback per verdict, week and area; small counts hidden (FR-614). */
  getFeedbackCounts: (params?: QualityWeeksParams) => Promise<FeedbackCounts>
  /** The assistant's ratings per verdict, week and area; small counts hidden (FR-712). */
  getRatingCounts: (params?: QualityWeeksParams) => Promise<RatingCounts>
  /** How the AI apps that called the MCP server fared, per family and week; small counts hidden (FR-410). */
  getAppFamilyCounts: (params?: AppFamilyCountsParams) => Promise<AppFamilyCounts>
  /** Items past review and proposals accepted, per week and area. */
  getUpkeep: (params?: QualityWeeksParams) => Promise<Upkeep>
  /** Live items no active test question names, per area. */
  getUntested: (params?: QualityAreaParams) => Promise<Untested>
  /** One ranked list of what to fix next, with its reasons. */
  getFixNext: (params?: FixNextParams) => Promise<FixNext>
  /** One test question across two runs: each try, what was held constant, the items that changed. */
  compareQuestion: (params: QuestionCompareParams) => Promise<QuestionComparison>
  /** One test question's verdict in its area's recent runs, and its retrieval result per edition. */
  getQuestionHistory: (params: QuestionHistoryParams) => Promise<QuestionHistory>
  // The MCP gateway (FR-407, FR-408). Administrators only.
  /** Every MCP tool, by name, and whether it is switched on for every client. */
  listTools: () => Promise<ToolSwitch[]>
  /** Switch a tool on or off for every client, with a reason; the next request sees it. */
  setTool: (input: SetToolInput) => Promise<ToolSwitch>
  /** The clients that may connect, by label, with their tools, limits and switch. */
  listClients: () => Promise<ClientPolicy[]>
  /** Add a client, or change its tools, limits or switch. A label is never removed. */
  saveClient: (input: SaveClientInput) => Promise<ClientPolicy>
  /** MCP calls by client and tool over the last days, from the request log; no person. */
  getTraffic: (params?: TrafficParams) => Promise<TrafficSummary>
  /** Every person's open AI app connections, the last used first. */
  listAiConnections: () => Promise<PersonConnection[]>
  /**
   * Disconnect one person's AI app with a reason the history log keeps: it is refused from its
   * next request. One that ended already is not found.
   */
  disconnectAiConnection: (input: AdminDisconnect) => Promise<{ disconnected: number }>
  /** Disconnect every AI app of one person in one step, with one reason; how many ended. */
  disconnectPersonAiConnections: (input: AdminDisconnectPerson) => Promise<{ disconnected: number }>
  // Settings (FR-801 to FR-810). Administrators, except the history log, which auditors read too.
  /** The current version of every setting. */
  listSettings: () => Promise<Setting[]>
  /** Every version of one setting, newest first. */
  getSettingHistory: (key: string) => Promise<Setting[]>
  /** A new version of a setting, with a reason; a newer version than the one read is a conflict. */
  setSetting: (input: SetSettingInput) => Promise<Setting>
  /**
   * People by name or email, a page at a time, with the roles they hold and when they last signed
   * in; active people unless a status is asked for, so a picker never offers a leaver.
   * Administrators and auditors.
   */
  searchPeople: (params: PeopleSearchInput) => Promise<PeoplePage>
  /** A person's sheet: every role they hold and every change to their roles; null if unknown. */
  getPersonSheet: (id: string) => Promise<PersonSheet | null>
  /** Who holds a global role and who holds which role in which area, each since when. */
  listGrants: () => Promise<Grants>
  /**
   * Gives and removes roles in one step, all or none, with an optional reason (FR-804). Removals
   * apply first, so removing an owner and giving the seat to another replaces them at once.
   */
  applyGrants: (input: ApplyGrantsInput) => Promise<GrantsApplied>
  /** One area as settings edits it; null for an unknown id. */
  getArea: (id: string) => Promise<AreaDetail | null>
  createArea: (input: CreateAreaInput) => Promise<AreaDetail>
  updateArea: (input: UpdateAreaInput) => Promise<AreaDetail>
  /**
   * What a domain is and what kind of data it holds (FR-813): its owner, its deputy or an
   * administrator writes the summary line and the description.
   */
  describeArea: (input: DescribeAreaInput) => Promise<AreaDetail>
  /** What deleting an area would do, named by kind (FR-814); null for an unknown id. */
  getAreaRemoval: (id: string) => Promise<AreaRemoval | null>
  /**
   * Deletes an area and everything under it in one step (FR-814): its items go to the Bin and its
   * terms retire in one edition, its open proposals are withdrawn and its roles end. Refuses only
   * the demo area.
   */
  removeArea: (input: RemoveAreaInput) => Promise<AreaRemoved>
  /** The deleted areas history keeps, newest first, with what restoring each gives back. */
  listArchivedAreas: () => Promise<ArchivedArea[]>
  /** Restores a deleted area, with its roles and its terms; its items wait in the Bin. */
  restoreArea: (input: RestoreAreaInput) => Promise<AreaRestored>
  /** Each scheduled job and connector, the job queue and the model spending (FR-810). */
  getOperations: () => Promise<OperationsOverviewView>
  /** Queues a run of a scheduled job now. */
  runJob: (input: { job: string }) => Promise<RunJobResult>
  // Sources an administrator adds (connector interface v2). Administrators only.
  /** The types of source an administrator may add, with the access each needs and its form. */
  listSourceTypes: () => Promise<ConnectorListing[]>
  /** A source an administrator added: its settings, and whether each secret is set; null if none. */
  getSourceSettings: (id: string) => Promise<SourceSettings | null>
  /** Adds a source with its settings, secrets and reason. A secret is never sent back. */
  addSource: (input: AddSourceInput) => Promise<SourceSettings>
  /** Changes a source on the revision read; a secret left out keeps the one in the store. */
  updateSource: (input: UpdateSourceInput) => Promise<SourceSettings>
  /** Reads a source once with these settings, keeping nothing and changing nothing. */
  testSource: (input: TestSourceInput) => Promise<SourceCheck>
  /** The history log, newest first, a page at a time (FR-808). */
  searchAudit: (params?: AuditSearchParams) => Promise<AuditPage>
  exportAudit: (params?: AuditExportParams) => Promise<AuditExport>
  /** Checks the hash chain of the whole history log (FR-806). */
  verifyAudit: () => Promise<AuditChain>
  /** Checks a file of items, or makes them proposals when every entry is valid (FR-120). */
  importItems: (input: ImportItemsInput) => Promise<ItemImportReport>
  // Connect your AI and What an agent would get: every signed-in person.
  /** The MCP server's address, the tools switched on and the clients that may connect. */
  getConnectInfo: () => Promise<ConnectInfo>
  /** get_context's reply for a scope on the live edition, without a model, recording nothing. */
  tryIt: (input: TryItInput) => Promise<TryIt>
  /** A question read as a scope on the live edition, so Try it opens on it; nothing is kept. */
  readTryItQuestion: (input: TryItReadInput) => Promise<TryItReading>
  /**
   * One assistant turn (FR-701): the answer streams back as UI message chunks, each sentence after
   * the citation check, then the citation report. A spending limit, a refusal and a failure part
   * way are chunks too (`data-limit`, `data-refusal`, `error`).
   */
  assistantChat: (
    input: AssistantChatInput,
    options?: AssistantChatOptions,
  ) => Promise<AsyncIterable<UIMessageChunk>>
  /**
   * Rates an answer good or wrong (FR-712). Only the verdict, the domain of the metrics and the
   * hour are kept, never who rated, the question or the answer. `unavailable` after too many
   * ratings in a minute.
   */
  rateAnswer: (input: RatingInput) => Promise<Rating>
  // The inbox and live updates
  /** The person's inbox, newest first: everything not archived by default. */
  listInbox: (params?: InboxListParams) => Promise<InboxPage>
  markInboxRead: (input: InboxIds) => Promise<InboxChange>
  markAllInboxRead: () => Promise<InboxChange>
  /** Archived items are read, and leave the inbox for its Archived view. */
  archiveInbox: (input: InboxIds) => Promise<InboxChange>
  /**
   * The live stream of what changed (ids and states only, never content): the events this
   * person may see. It opens with `stream.ready`, or replays the events after `lastEventId`, or
   * says `stream.reset` when those are no longer kept. It ends when the connection does.
   */
  streamEvents: (options: StreamOptions) => Promise<AsyncIterable<StreamEvent>>
}

/** Every method of `ContextApi`, for code that forwards them all (index.ts). */
export const contextApiMethods = [
  'listItems',
  'getItem',
  'getItemLinks',
  'listLibrary',
  'getLibraryFreshness',
  'getItemHistory',
  'getServedReviews',
  'listAreas',
  'listPeople',
  'getVocabulary',
  'searchScope',
  'matchScope',
  'describeScope',
  'listCatalogue',
  'getCatalogueTerm',
  'getSession',
  'signOut',
  'listSignInPeople',
  'signIn',
  'getConnectRequest',
  'decideConnectRequest',
  'listConnections',
  'disconnectApp',
  'listFavorites',
  'setFavorite',
  'listRecent',
  'recordVisit',
  'listProposals',
  'getProposal',
  'previewProposal',
  'getProposalOverlap',
  'createProposal',
  'saveDraft',
  'submitProposal',
  'withdrawProposal',
  'discardDraft',
  'commentOnProposal',
  'claimProposal',
  'handOverProposal',
  'listProposalEvents',
  'listProposalTests',
  'attachProposalTest',
  'detachProposalTest',
  'listReviewQueue',
  'getReview',
  'runChecks',
  'editReview',
  'decide',
  'planDecisions',
  'decideMany',
  'assignProposals',
  'listTermCandidates',
  'proposeTerms',
  'decideTermBatch',
  'listEditions',
  'rollbackEdition',
  'previewRollback',
  'diffEdition',
  'exportEdition',
  'compareEditions',
  'compareEditionItem',
  'editionFeed',
  'listStops',
  'setStop',
  'retireItem',
  'proposeRetirement',
  'recheckItem',
  'listBin',
  'getBinItem',
  'previewBin',
  'moveToBin',
  'previewRescue',
  'restoreFromBin',
  'listGaps',
  'getGap',
  'setGapStatus',
  'addGapNote',
  'linkGapTest',
  'unlinkGapTest',
  'startDraftFromGap',
  'reportGap',
  'getTopicCounts',
  'getWeeklyCalls',
  'getEvalRun',
  'listTestQuestions',
  'saveTestQuestion',
  'setAsideTestQuestion',
  'importTestQuestions',
  'exportTestQuestions',
  'listEvalRuns',
  'estimateEvalRun',
  'startEvalRun',
  'approveEvalRun',
  'cancelEvalRun',
  'resumeEvalRun',
  'getEvalTranscript',
  'getRetrievalLatest',
  'getRetrievalEdition',
  'getRetrievalTrend',
  'getQualityHistory',
  'compareRuns',
  'getFeedbackCounts',
  'getRatingCounts',
  'getAppFamilyCounts',
  'getUpkeep',
  'getUntested',
  'getFixNext',
  'compareQuestion',
  'getQuestionHistory',
  'listTools',
  'setTool',
  'listClients',
  'saveClient',
  'getTraffic',
  'listAiConnections',
  'disconnectAiConnection',
  'disconnectPersonAiConnections',
  'listSettings',
  'getSettingHistory',
  'setSetting',
  'searchPeople',
  'getPersonSheet',
  'listGrants',
  'applyGrants',
  'getArea',
  'createArea',
  'updateArea',
  'describeArea',
  'getAreaRemoval',
  'removeArea',
  'listArchivedAreas',
  'restoreArea',
  'getOperations',
  'runJob',
  'listSourceTypes',
  'getSourceSettings',
  'addSource',
  'updateSource',
  'testSource',
  'searchAudit',
  'exportAudit',
  'verifyAudit',
  'importItems',
  'getConnectInfo',
  'tryIt',
  'readTryItQuestion',
  'assistantChat',
  'rateAnswer',
  'listInbox',
  'markInboxRead',
  'markAllInboxRead',
  'archiveInbox',
  'streamEvents',
] as const satisfies readonly (keyof ContextApi)[]

// Fails to compile when a method is added to the interface but not to the list above.
type Missing = Exclude<keyof ContextApi, (typeof contextApiMethods)[number]>
const _everyMethodListed: [Missing] extends [never] ? true : Missing = true
void _everyMethodListed
