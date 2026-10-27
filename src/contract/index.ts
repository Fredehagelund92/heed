/**
 * The one place an API operation is described: method, path, input, output, errors and what the
 * caller needs (`scope`). The service implements it, the front end's http binding calls it, and
 * the OpenAPI document is generated from it. Keep this folder free of server code: it imports
 * the domain only.
 */
import { eventIterator, oc } from '@orpc/contract'
import * as z from 'zod/mini'
import { areaSchema, itemSchema, personSchema, vocabularySchema } from '../domain/item.ts'
import {
  peoplePageSchema,
  peopleSearchSchema,
  personIdSchema,
  personSheetSchema,
} from './people.ts'
import {
  deletedDraftSchema,
  draftFromTextInputSchema,
  draftFromTextSchema,
  itemBulkInputSchema,
  itemBulkPlanSchema,
  itemBulkResultSchema,
  itemChangeSchema,
  itemPageSchema,
  publishItemInputSchema,
  publishItemResultSchema,
  relatedSchema,
  restoreAsDraftInputSchema,
  restoredDraftSchema,
} from './context.ts'
import {
  historyEntrySchema,
  itemLinksSchema,
  itemsPageSchema,
  libraryFreshnessInputSchema,
  libraryFreshnessSchema,
  libraryIndexSchema,
  listItemsInputSchema,
} from './schemas.ts'

import {
  cardIdSchema,
  decideCardResultSchema,
  decideCardSchema,
  feedInputSchema,
  feedSchema,
  markCardsReadSchema,
  setupSchema,
} from './inbox.ts'
import {
  markReadInputSchema,
  publishInputSchema,
  publishReadInputSchema,
  publishReadResultSchema,
  publishResultSchema,
  returnInputSchema,
  returnResultSchema,
  reviewIdInputSchema,
  reviewSheetSchema,
  undoInputSchema,
  undoResultSchema,
} from './review-path.ts'
import {
  obsAgentsInputSchema,
  obsAgentsSchema,
  obsFeedbackInputSchema,
  obsFeedbackSchema,
  obsUsageInputSchema,
  obsUsageSchema,
  obsViewRemoveInputSchema,
  obsViewSaveInputSchema,
  obsViewSchema,
} from './observability.ts'
import {
  askedSchema,
  lookupEventSchema,
  lookupInputSchema,
  reachInputSchema,
  reachSchema,
  replayInputSchema,
  replaySchema,
  tryItRunInputSchema,
  tryItRunSchema,
} from './answer.ts'
import {
  createProposalSchema,
  saveDraftSchema,
  proposalRecordSchema,
  proposalIdSchema,
  proposalMutationSchema,
  proposalListSchema,
  proposalListResultSchema,
  proposalEventSchema,
  commentSchema,
  withdrawSchema,
  discardedDraftSchema,
  handOverSchema,
  previewSchema,
  proposalPreviewSchema,
  proposalTestInputSchema,
  proposalTestSchema,
  overlapSchema,
  findingSchema,
} from './proposals.ts'

import {
  bulkAssignSchema,
  bulkAssignmentSchema,
  bulkDecideSchema,
  bulkDecisionSchema,
  bulkPlanInputSchema,
  bulkPlanSchema,
  activeStopSchema,
  decideSchema,
  decisionResultSchema,
  editionDiffInputSchema,
  editionDiffSchema,
  editionListSchema,
  editionSchema,
  gateSchema,
  itemReasonSchema,
  queueEntrySchema,
  queueSchema,
  reviewEditSchema,
  reviewIdSchema,
  reviewProposalSchema,
  reviewSchema,
  rollbackSchema,
  servedReviewSchema,
  servedReviewsInputSchema,
  stopSchema,
  decideTermBatchSchema,
  termBatchDecisionSchema,
  termBatchResultSchema,
  termBatchSchema,
  termCandidateSchema,
  vocabularyProposalSchema,
} from './review.ts'

import {
  areaInputSchema,
  estimateInputSchema,
  areaScorecardSchema,
  estimateSchema,
  exportSchema,
  importReportSchema,
  importSchema,
  questionIdInputSchema,
  questionListSchema,
  retrievalAreaSchema,
  retrievalEditionInputSchema,
  retrievalEditionSchema,
  retrievalPointSchema,
  retrievalTrendInputSchema,
  runDetailSchema,
  runIdSchema,
  runListSchema,
  runSchema,
  saveQuestionSchema,
  setAsideSchema,
  storedQuestionSchema,
  transcriptSchema,
} from './evals.ts'

import {
  meSchema,
  sessionSchema,
  signInMethodSchema,
  signInPersonSchema,
  roleInputSchema,
  assignmentInputSchema,
  grantsSchema,
  applyGrantsSchema,
  grantsAppliedSchema,
} from './auth.ts'
import {
  createInvitesSchema,
  inviteIdSchema,
  inviteLookupSchema,
  inviteTokenSchema,
  inviteResentSchema,
  inviteSchema,
  invitesCreatedSchema,
  memberIdSchema,
  memberRemovedSchema,
  memberSchema,
  ownersSetSchema,
  setOwnersSchema,
  setRoleSchema,
  soleOwnerSchema,
} from './members.ts'
import {
  activityListSchema,
  activityPageSchema,
  inboxChangeSchema,
  inboxIdsSchema,
  inboxListSchema,
  inboxPageSchema,
  streamEventSchema,
} from './notifications.ts'
import {
  dashboardInputSchema,
  dashboardSchema,
  gapDetailSchema,
  gapDraftInputSchema,
  gapIdInputSchema,
  gapLinkTestInputSchema,
  gapListInputSchema,
  gapNoteInputSchema,
  gapReportInputSchema,
  gapReportSchema,
  gapSchema,
  gapStatusInputSchema,
  gapUnlinkTestInputSchema,
  topicCountsInputSchema,
  topicCountsSchema,
  weeklyCallsInputSchema,
  weeklyCallsSchema,
} from './gaps.ts'
import {
  addSourceSchema,
  connectorListingSchema,
  flaggedItemSchema,
  sourceCheckSchema,
  sourceIdInputSchema,
  sourceListSchema,
  sourceSettingsSchema,
  staleLinkSchema,
  testSourceSchema,
  updateSourceSchema,
} from './sources.ts'
import {
  compareInputSchema,
  compareQuestionInputSchema,
  comparisonSchema,
  feedbackCountsSchema,
  fixNextInputSchema,
  fixNextSchema,
  historyInputSchema,
  historyPointSchema,
  qualityAreaInputSchema,
  qualityWeeksInputSchema,
  questionComparisonSchema,
  questionHistoryInputSchema,
  questionHistorySchema,
  ratingCountsSchema,
  appFamilyCountsInputSchema,
  appFamilyCountsSchema,
  untestedSchema,
  upkeepSchema,
} from './quality.ts'
import {
  catalogueSchema,
  catalogueTermDetailSchema,
  catalogueTermInputSchema,
} from './catalogue.ts'
import { searchAllInputSchema, searchResultsSchema } from './search.ts'
import {
  definitionCoverageSchema,
  deletedTermSchema,
  termChangeResultSchema,
  termCreateInputSchema,
  termIdsInputSchema,
  termListSchema,
  termMoveInputSchema,
  termRefusalSchema,
  termRestoreResultSchema,
  termSchema,
  termUpdateInputSchema,
  termVersionSchema,
} from './terms.ts'
import {
  commentIdSchema,
  commentSchema as threadCommentSchema,
  commentThreadsSchema,
  createCommentSchema,
  editCommentSchema,
  listCommentsInputSchema,
  removeCommentResultSchema,
  threadInputSchema,
  toggleReactionResultSchema,
  toggleReactionSchema,
} from './comments.ts'
import { chatChunkSchema, chatInputSchema, ratingInputSchema, ratingSchema } from './assistant.ts'
import { createReportSchema, myReportsSchema, sentReportSchema } from './reports.ts'
import { connectInfoSchema, tryItReadInputSchema, tryItReadingSchema } from './connect.ts'
import {
  adminDisconnectedSchema,
  adminDisconnectPersonSchema,
  adminDisconnectSchema,
  connectDecisionResultSchema,
  connectDecisionSchema,
  connectionIdSchema,
  connectionSchema,
  connectRequestIdSchema,
  connectRequestSchema,
  personConnectionSchema,
} from './connections.ts'
import {
  scopeDescribeInputSchema,
  scopeHitSchema,
  scopeSearchInputSchema,
  scopeSearchSchema,
} from './scope.ts'
import {
  auditChainSchema,
  auditExportInputSchema,
  auditExportSchema,
  auditPageSchema,
  auditSearchSchema,
  clientPolicySchema,
  editionExportInputSchema,
  editionExportSchema,
  itemImportReportSchema,
  itemImportSchema,
  jsonSchemaDocument,
  saveClientSchema,
  setSettingSchema,
  settingKeyInputSchema,
  settingSchema,
  setToolSchema,
  toolSwitchSchema,
  trafficInputSchema,
  trafficSummarySchema,
} from './admin.ts'
import {
  areaDetailSchema,
  archivedAreaSchema,
  areaHoldingsSchema,
  areaRemovalSchema,
  areaRemovedSchema,
  areaRestoredSchema,
  createAreaSchema,
  describeAreaSchema,
  removeAreaSchema,
  restoreAreaSchema,
  updateAreaSchema,
} from './areas.ts'
import {
  blockedVersionSchema,
  compareItemInputSchema,
  editionCompareInputSchema,
  editionComparisonSchema,
  editionFeedInputSchema,
  editionFeedSchema,
  itemComparisonSchema,
  rollbackPreviewInputSchema,
  rollbackPreviewSchema,
} from './editions.ts'
import {
  binItemSchema,
  binItemsSchema,
  binListSchema,
  binMoveResultSchema,
  binMoveSchema,
  binPreviewSchema,
  binRescuePreviewInputSchema,
  binRescuePreviewSchema,
  binRestoreResultSchema,
  binRestoreSchema,
} from './bin.ts'
import { operationsOverviewSchema, runJobInputSchema, runJobSchema } from './operations.ts'
import { refusals } from './refusals.ts'
export * from './schemas.ts'
export type {
  Dashboard,
  Gap,
  GapDetail,
  GapHistoryEntry,
  GapReport,
  GapReportInput,
  GapTest,
  TopicCounts,
  WeeklyCalls,
} from './gaps.ts'
export type {
  AddSourceInput,
  ConnectorListing,
  FlaggedItem,
  SourceCheck,
  SourceConfig,
  SourceSettings,
  StaleLink,
  TestSourceInput,
  UpdateSourceInput,
} from './sources.ts'
export type {
  Comparison,
  FeedbackCounts,
  FixNext,
  HistoryPoint,
  QuestionComparison,
  QuestionHistory,
  RatingCounts,
  Untested,
  Upkeep,
} from './quality.ts'
export type { ScopeHit, ScopeSearchInput, ScopeSearchResult } from './scope.ts'
export { SEARCH_GROUP_MAX } from './search.ts'
export type { SearchAllInput, SearchResults } from './search.ts'
export type { Comment as ThreadComment, Thread } from './comments.ts'
export type {
  Catalogue,
  CatalogueDefinition,
  CatalogueSource,
  CatalogueTerm,
  CatalogueTermDetail,
  CatalogueValue,
} from './catalogue.ts'
export type {
  DefinitionCoverage,
  DeletedTerm,
  Term,
  TermChangeResult,
  TermCreateInput,
  TermList,
  TermRefusalData,
  TermRestoreResult,
  TermUpdateInput,
  TermVersion,
} from './terms.ts'
export type {
  AuditEntry,
  ClientPolicy,
  ItemImportReport,
  Setting,
  SettingKey,
  TrafficSummary,
} from './admin.ts'
export type {
  AreaDetail,
  AreaHoldings,
  AreaRemoval,
  AreaRemoved,
  AreaRestored,
  ArchivedArea,
} from './areas.ts'
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
} from './bin.ts'
export type { Rating, RatingInput } from './assistant.ts'
export type { OperationsOverviewView } from './operations.ts'
export type { ConnectInfo, TryIt, TryItInput, TryItReading, TryItReadInput } from './connect.ts'
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
} from './people.ts'

/**
 * What an operation needs from its caller. Reading needs a signed-in person (FR-128); `audit`
 * needs an administrator or an auditor (FR-808).
 */
export type OperationMeta = {
  scope: 'public' | 'read' | 'feedback' | 'propose' | 'maintain' | 'admin' | 'audit'
}

const read = oc.$meta<OperationMeta>({ scope: 'read' }).errors({
  UNAUTHORIZED: { message: refusals.signedOut },
  FORBIDDEN: { message: refusals.forbidden },
  CONFLICT: { message: refusals.conflict },
  NOT_FOUND: { message: refusals.notFound },
})

const notFound = {
  NOT_FOUND: {
    message: "We couldn't find this fact. It may have been deleted, or you may not have access.",
  },
}
const itemId = z.object({ id: z.string().check(z.minLength(1), z.maxLength(64)) })

const admin = read.meta({ scope: 'admin' })
const publicRoute = read.meta({ scope: 'public' })
const changed = z.object({ changed: z.boolean() })
const proposal = read.meta({ scope: 'propose' }).errors({
  CONFLICT: {
    message:
      'Someone changed this proposal after you opened it. Look at the latest version, then try again.',
    data: z.optional(z.object({ current: proposalRecordSchema })),
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Some details need attention. Fix the problems shown, then try again.',
    data: z.optional(z.object({ findings: z.array(findingSchema) })),
  },
})
const review = read.meta({ scope: 'propose' }).errors({
  CONFLICT: {
    message:
      'The proposal, or what agents get, changed after you opened it. Look at the latest version, then try again.',
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Fix the problems shown, then try again.',
    data: z.optional(
      z.object({
        findings: z.optional(z.array(findingSchema)),
        gate: z.optional(gateSchema),
      }),
    ),
  },
})
const release = review.meta({ scope: 'admin' })
const settings = admin.errors({
  CONFLICT: {
    message:
      'Someone changed this setting after you opened it. Look at the latest value, then try again.',
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: "This setting can't take that value. Check it, then try again.",
  },
})
const auditor = read.meta({ scope: 'audit' })
/** An administrator ends a person's agent connection: the reason must hold no sensitive text. */
const aiDisconnect = admin.errors({
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Remove the email address, phone number or secret from the reason.',
    data: z.optional(z.object({ findings: z.array(findingSchema) })),
  },
})
/** A source an administrator adds or changes: a stale revision, or settings with problems. */
const sourceSettings = admin.errors({
  CONFLICT: {
    message:
      'Someone changed this source after you opened it. Look at the latest version, then try again.',
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Some settings need attention. Fix the problems shown, then try again.',
    data: z.optional(z.object({ findings: z.array(findingSchema) })),
  },
})
const areaSettings = admin.errors({
  CONFLICT: {
    message:
      'Someone changed this domain after you opened it, or another domain already has this id or name.',
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Some details need attention. Fix the problems shown, then try again.',
    data: z.optional(z.object({ findings: z.array(findingSchema) })),
  },
})

const evals = read.meta({ scope: 'propose' }).errors({
  CONFLICT: {
    message:
      'Someone changed this test question or run after you opened it. Look at the latest version, then try again.',
  },
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Fix the problems shown, then try again.',
    data: z.optional(z.object({ findings: z.optional(z.array(findingSchema)) })),
  },
  PRECONDITION_FAILED: {
    message: "Agents don't get any facts yet. Ask an admin to finish the setup.",
  },
})
/** For owners of any area, and administrators. */
const maintain = evals.meta({ scope: 'maintain' })
/** Reads for owners of any area, and administrators; narrowed to their areas. */
const maintainRead = read.meta({ scope: 'maintain' })
const areaId = z.object({ id: z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/)) })
/** Deleting an area (FR-814): a conflict is a change since it was read, or the demo area. */
const areaRemovalRoute = admin.errors({
  CONFLICT: {
    message:
      "Someone changed this domain after you opened it, or it's the demo domain, which can't be deleted.",
    data: z.optional(z.object({ holdings: areaHoldingsSchema })),
  },
})

/** A comment or a reaction: anyone signed in, on what they may read; words they may change are their own. */
const commentWrite = read.errors({
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Check the comment, then try again.',
  },
})

/**
 * A term or a synonym an owner writes (FR-138): a word that already means something is refused,
 * naming what it means and who gave it that meaning.
 */
const termWrite = read.meta({ scope: 'propose' }).errors({
  CONFLICT: {
    message:
      'This word already means something here, or someone changed the term after you opened it.',
    data: z.optional(z.object({ refusal: termRefusalSchema })),
  },
})
const termId = z.object({ id: z.string().check(z.uuid()) })

const owner = read.meta({ scope: 'propose' }).errors({
  UNPROCESSABLE_CONTENT: {
    status: 422,
    message: 'Some details need attention. Fix the problems shown, then try again.',
    data: z.optional(z.object({ findings: z.array(findingSchema) })),
  },
})
export const contract = {
  proposals: {
    create: proposal
      .route({ method: 'POST', path: '/proposals', tags: ['proposals'] })
      .input(createProposalSchema)
      .output(proposalRecordSchema),
    list: proposal
      .route({ method: 'GET', path: '/proposals', tags: ['proposals'] })
      .input(proposalListSchema)
      .output(proposalListResultSchema),
    get: proposal
      .route({ method: 'GET', path: '/proposals/{id}', tags: ['proposals'] })
      .input(proposalIdSchema)
      .output(proposalRecordSchema),
    saveDraft: proposal
      .route({ method: 'PUT', path: '/proposals/{id}/draft', tags: ['proposals'] })
      .input(saveDraftSchema)
      .output(proposalRecordSchema),
    submit: proposal
      .route({ method: 'POST', path: '/proposals/{id}/submit', tags: ['proposals'] })
      .input(proposalMutationSchema)
      .output(proposalRecordSchema),
    claim: proposal
      .route({ method: 'POST', path: '/proposals/{id}/claim', tags: ['proposals'] })
      .input(proposalMutationSchema)
      .output(proposalRecordSchema),
    handOver: proposal
      .route({ method: 'POST', path: '/proposals/{id}/hand-over', tags: ['proposals'] })
      .input(handOverSchema)
      .output(proposalRecordSchema),
    withdraw: proposal
      .route({ method: 'POST', path: '/proposals/{id}/withdraw', tags: ['proposals'] })
      .input(withdrawSchema)
      .output(proposalRecordSchema),
    discard: proposal
      .route({
        method: 'POST',
        path: '/proposals/{id}/discard',
        tags: ['proposals'],
        summary: 'Discard a draft that was never sent; a sent proposal is withdrawn instead',
      })
      .input(proposalMutationSchema)
      .output(discardedDraftSchema),
    comment: proposal
      .route({ method: 'POST', path: '/proposals/{id}/comments', tags: ['proposals'] })
      .input(commentSchema)
      .output(proposalRecordSchema),
    events: proposal
      .route({ method: 'GET', path: '/proposals/{id}/events', tags: ['proposals'] })
      .input(proposalIdSchema)
      .output(z.array(proposalEventSchema)),
    overlap: proposal
      .route({ method: 'GET', path: '/proposals/{id}/overlap', tags: ['proposals'] })
      .input(proposalIdSchema)
      .output(overlapSchema),
    preview: proposal
      .route({ method: 'POST', path: '/proposals/{id}/preview', tags: ['proposals'] })
      .input(previewSchema)
      .output(proposalPreviewSchema),
    tests: proposal
      .route({
        method: 'GET',
        path: '/proposals/{id}/tests',
        tags: ['proposals'],
        summary: 'The test questions attached to the check of a proposal (FR-524)',
      })
      .input(proposalIdSchema)
      .output(z.array(proposalTestSchema)),
    attachTest: proposal
      .route({
        method: 'POST',
        path: '/proposals/{id}/tests',
        tags: ['proposals'],
        summary:
          'Attach a development test question of the domain to the check, reported only (FR-524); attaching it again changes nothing',
      })
      .input(proposalTestInputSchema)
      .output(z.array(proposalTestSchema)),
    detachTest: proposal
      .route({
        method: 'POST',
        path: '/proposals/{id}/tests/{question}/detach',
        tags: ['proposals'],
        summary: 'Detach a test question from the check of a proposal',
      })
      .input(proposalTestInputSchema)
      .output(z.array(proposalTestSchema)),
  },
  review: {
    sheet: review
      .route({
        method: 'GET',
        path: '/review/{id}/sheet',
        tags: ['review'],
        summary:
          "The review page's read: the change by kind, its claims against the copied sentence, a clash with live context, what agents say before and after, and the Ready line (FR-224 to FR-226)",
      })
      .input(reviewIdInputSchema)
      .output(reviewSheetSchema),
    markRead: review
      .route({
        method: 'POST',
        path: '/review/{id}/read',
        tags: ['review'],
        summary:
          'The person read this version of a suggestion: it may go out with "Publish the N you\'ve read" (FR-226)',
      })
      .input(markReadInputSchema)
      .output(z.object({ read: z.boolean() })),
    publish: review
      .route({
        method: 'POST',
        path: '/review/{id}/publish',
        tags: ['review'],
        summary:
          'Publishes the whole change, once the owner said how it relates to each live item it clashes with (FR-225); answers with a token that undoes it',
      })
      .input(publishInputSchema)
      .output(publishResultSchema),
    return: review
      .route({
        method: 'POST',
        path: '/review/{id}/return',
        tags: ['review'],
        summary:
          'Returns a suggestion to its sender with a note, which becomes the first comment of its discussion; answers with a token that undoes it',
      })
      .input(returnInputSchema)
      .output(returnResultSchema),
    publishRead: review
      .route({
        method: 'POST',
        path: '/review/publish-read',
        tags: ['review'],
        summary:
          "Publish the N you've read: each plain change the person read publishes as Publish would; the rest is named and left out (FR-226)",
      })
      .input(publishReadInputSchema)
      .output(publishReadResultSchema),
    queue: review
      .route({
        method: 'GET',
        path: '/review/queue',
        tags: ['review'],
        summary: 'Open proposals the person may decide, by risk and then age (FR-208)',
      })
      .input(queueSchema)
      .output(z.array(queueEntrySchema)),
    get: review
      .route({
        method: 'GET',
        path: '/proposals/{id}/review',
        tags: ['review'],
        summary: 'Diff, mentions, warnings, checks, gate and decisions of one proposal',
      })
      .input(reviewIdSchema)
      .output(reviewSchema),
    runChecks: review
      .route({
        method: 'POST',
        path: '/proposals/{id}/checks',
        tags: ['review'],
        summary: 'Run levels 1 to 3 again against the live edition',
      })
      .input(reviewIdSchema)
      .output(gateSchema),
    edit: review
      .route({
        method: 'POST',
        path: '/proposals/{id}/review-edits',
        tags: ['review'],
        summary:
          'Change the risk, review date, claim level, owner or domain during review; the checks run again (FR-105, FR-106, FR-123, FR-324)',
      })
      .input(reviewEditSchema)
      .output(reviewSchema),
    decide: review
      .route({
        method: 'POST',
        path: '/proposals/{id}/decisions',
        tags: ['review'],
        summary: 'Accept, ask for changes or reject; the last needed accept publishes an edition',
      })
      .input(decideSchema)
      .output(decisionResultSchema),
    planDecisions: review
      .route({
        method: 'POST',
        path: '/review/decisions/plan',
        tags: ['review'],
        summary:
          'What one decision for several proposals would do to each, and which it leaves out (FR-223)',
      })
      .input(bulkPlanInputSchema)
      .output(bulkPlanSchema),
    decideMany: review
      .route({
        method: 'POST',
        path: '/review/decisions',
        tags: ['review'],
        summary:
          'Accept, ask for changes or reject several proposals with one reason; each gets its own decision (FR-223)',
      })
      .input(bulkDecideSchema)
      .output(bulkDecisionSchema),
    assign: review
      .route({
        method: 'POST',
        path: '/review/assignments',
        tags: ['review'],
        summary:
          'Claim several proposals for a reviewer of their domain, or hand them over (FR-211)',
      })
      .input(bulkAssignSchema)
      .output(bulkAssignmentSchema),
    retire: review
      .route({
        method: 'POST',
        path: '/items/{id}/retire',
        tags: ['review'],
        summary: 'Retire an item at once, with a reason (FR-218)',
      })
      .input(itemReasonSchema)
      .output(editionSchema),
    proposeRetirement: review
      .route({
        method: 'POST',
        path: '/items/{id}/retire-proposals',
        tags: ['review'],
        summary: 'Propose that an item is retired, with a reason (FR-112)',
      })
      .input(itemReasonSchema)
      .output(reviewProposalSchema),
    recheck: review
      .route({
        method: 'POST',
        path: '/items/{id}/recheck',
        tags: ['review'],
        summary: 'Record "checked, still correct" with the current change marks (CON-211)',
      })
      .input(itemReasonSchema)
      .output(decisionResultSchema),
  },
  editions: {
    list: maintainRead
      .route({
        method: 'GET',
        path: '/editions',
        tags: ['editions'],
        summary: 'Editions, newest first',
      })
      .input(editionListSchema)
      .output(z.array(editionSchema)),
    diff: maintainRead
      .route({
        method: 'GET',
        path: '/editions/{label}/diff',
        tags: ['editions'],
        summary: 'What changed against another edition, by default the one before',
      })
      .input(editionDiffInputSchema)
      .output(editionDiffSchema),
    feed: maintainRead
      .route({
        method: 'GET',
        path: '/editions/feed',
        tags: ['editions'],
        summary:
          'Editions newest first, each with what it changed, who did it and why, in counts and one sentence',
      })
      .input(editionFeedInputSchema)
      .output(editionFeedSchema),
    compare: maintainRead
      .route({
        method: 'GET',
        path: '/editions/compare',
        tags: ['editions'],
        summary:
          'What changed between two editions, each item once, with who and why and counts for filters',
      })
      .input(editionCompareInputSchema)
      .output(editionComparisonSchema),
    compareItem: maintainRead
      .route({
        method: 'GET',
        path: '/editions/compare/items/{id}',
        tags: ['editions'],
        summary:
          'One item between two editions: its field changes, mentions and each edition that changed it',
      })
      .input(compareItemInputSchema)
      .output(itemComparisonSchema),
    export: maintainRead
      .route({
        method: 'GET',
        path: '/editions/{label}/export',
        tags: ['editions'],
        summary: 'An edition as one canonical JSON document with its digests (NFR-045, NFR-093)',
      })
      .input(editionExportInputSchema)
      .output(editionExportSchema),
    rollback: release
      .route({
        method: 'POST',
        path: '/editions/{label}/rollback',
        tags: ['editions'],
        summary: 'Serve the content of an earlier edition again, as a new edition (FR-217)',
      })
      .errors({
        CONFLICT: {
          message:
            "Agents already get this edition, or some of its facts can't be shared with agents again.",
          data: z.optional(z.object({ blocked: z.array(blockedVersionSchema) })),
        },
      })
      .input(rollbackSchema)
      .output(editionSchema),
    rollbackPreview: admin
      .route({
        method: 'GET',
        path: '/editions/{label}/rollback-preview',
        tags: ['editions'],
        summary:
          'What going back to an edition would change, and the versions that cannot be served again',
      })
      .input(rollbackPreviewInputSchema)
      .output(rollbackPreviewSchema),
  },
  serving: {
    stops: read
      .route({
        method: 'GET',
        path: '/serving/stops',
        tags: ['editions'],
        summary: 'Stop switches that are on, for the banner every signed-in person sees',
      })
      .output(z.array(activeStopSchema)),
    setStop: release
      .route({
        method: 'POST',
        path: '/serving/stops',
        tags: ['editions'],
        summary: 'Switch delivery off or on for one item, one domain or everything (FR-805)',
      })
      .input(stopSchema)
      .output(z.array(activeStopSchema)),
  },
  auth: {
    methods: publicRoute
      .route({
        method: 'GET',
        path: '/auth/methods',
        tags: ['session'],
        summary:
          "How people sign in here (FR-416): the company's OpenID Connect provider, with its name and the address that starts a sign-in, or the picker in development and demos",
      })
      .output(signInMethodSchema),
    people: publicRoute
      .route({ method: 'GET', path: '/auth/people', tags: ['session'] })
      .output(z.array(signInPersonSchema)),
    signIn: publicRoute
      .route({ method: 'POST', path: '/auth/sign-in', tags: ['session'] })
      .input(z.object({ email: z.email() }))
      .output(sessionSchema),
    signOut: read
      .route({ method: 'POST', path: '/auth/sign-out', tags: ['session'] })
      .output(z.object({ signedOut: z.boolean() })),
    session: read
      .route({ method: 'GET', path: '/auth/session', tags: ['session'] })
      .output(sessionSchema),
  },
  connections: {
    request: read
      .route({
        method: 'GET',
        path: '/connections/request',
        tags: ['session'],
        summary:
          'The agent sign-in that this browser started, for the consent screen (FR-403); the handle goes in the query',
      })
      .input(connectRequestIdSchema)
      .output(connectRequestSchema),
    decide: read
      .route({
        method: 'POST',
        path: '/connections/request/decision',
        tags: ['session'],
        summary:
          "The signed-in person's answer on the consent screen; returns the app's redirect address with the code or the refusal",
      })
      .input(connectDecisionSchema)
      .output(connectDecisionResultSchema),
    list: read
      .route({
        method: 'GET',
        path: '/connections',
        tags: ['session'],
        // eslint-disable-next-line brand/no-product-name -- API documentation for developers (docs/rename-checklist.md)
        summary: 'The agents connected to Heed as the signed-in person',
      })
      .output(z.array(connectionSchema)),
    disconnect: read
      .route({
        method: 'POST',
        path: '/connections/{id}/disconnect',
        tags: ['session'],
        summary:
          'Disconnect an agent: its refresh tokens end and the MCP server refuses its access tokens at once',
      })
      .input(connectionIdSchema)
      .output(z.object({ disconnected: z.boolean() })),
  },
  // Every person's agents, for administrators (FR-403, FR-807): see them and disconnect them.
  aiConnections: {
    list: admin
      .route({
        method: 'GET',
        path: '/ai-connections',
        tags: ['admin'],
        summary:
          "Every person's agent connections that are still open: the person, the app as it names itself, what it may do, when it connected, last refreshed and ends",
      })
      .output(z.array(personConnectionSchema)),
    disconnect: aiDisconnect
      .route({
        method: 'POST',
        path: '/ai-connections/{id}/disconnect',
        tags: ['admin'],
        summary:
          "Disconnect one person's agent with a reason: its refresh tokens end and the MCP server refuses its access tokens at the next request. The history log keeps the reason",
      })
      .input(adminDisconnectSchema)
      .output(adminDisconnectedSchema),
    disconnectPerson: aiDisconnect
      .route({
        method: 'POST',
        path: '/ai-connections/people/{personId}/disconnect',
        tags: ['admin'],
        summary:
          'Disconnect every agent of one person with one reason, in one step: each connection is its own history entry, with the batch id they share',
      })
      .input(adminDisconnectPersonSchema)
      .output(adminDisconnectedSchema),
  },
  roles: {
    list: admin.route({ method: 'GET', path: '/roles', tags: ['roles'] }).output(grantsSchema),
    grant: admin
      .route({ method: 'POST', path: '/roles/grant', tags: ['roles'] })
      .input(roleInputSchema)
      .output(changed),
    revoke: admin
      .route({ method: 'POST', path: '/roles/revoke', tags: ['roles'] })
      .input(roleInputSchema)
      .output(changed),
  },
  assignments: {
    grant: admin
      .route({ method: 'POST', path: '/assignments/grant', tags: ['roles'] })
      .input(assignmentInputSchema)
      .output(changed),
    revoke: admin
      .route({ method: 'POST', path: '/assignments/revoke', tags: ['roles'] })
      .input(assignmentInputSchema)
      .output(changed),
  },
  grants: {
    apply: admin
      .route({
        method: 'POST',
        path: '/grants/apply',
        tags: ['roles'],
        summary:
          'Give and remove many roles in one step, all or none, with an optional reason (FR-804); removals apply first, so removing an owner and giving the role to another replaces them at once. Each change is its own history entry, with the batch id they share',
      })
      .errors({
        BAD_REQUEST: {
          message: 'The same role is in this change twice. Remove one, then try again.',
        },
        CONFLICT: {
          message:
            'This would leave a domain without an owner, or nobody as admin. Give the role to someone else first.',
        },
        UNPROCESSABLE_CONTENT: {
          status: 422,
          message: 'Remove the email address, phone number or secret from the reason.',
          data: z.optional(z.object({ findings: z.array(findingSchema) })),
        },
      })
      .input(applyGrantsSchema)
      .output(grantsAppliedSchema),
  },
  items: {
    list: read
      .route({ method: 'GET', path: '/items', tags: ['library'], summary: 'List and search items' })
      .input(listItemsInputSchema)
      .output(itemsPageSchema),
    get: read
      .route({ method: 'GET', path: '/items/{id}', tags: ['library'], summary: 'Read one item' })
      .errors(notFound)
      .input(itemId)
      .output(itemSchema),
    history: read
      .route({
        method: 'GET',
        path: '/items/{id}/history',
        tags: ['library'],
        summary: 'What happened to an item, newest first',
      })
      .errors(notFound)
      .input(itemId)
      .output(z.array(historyEntrySchema)),
    links: read
      .route({
        method: 'GET',
        path: '/items/{id}/links',
        tags: ['library'],
        summary: 'What an item mentions, and which items mention it',
      })
      .errors(notFound)
      .input(itemId)
      .output(itemLinksSchema),
    page: read
      .route({
        method: 'GET',
        path: '/items/{id}/page',
        tags: ['library'],
        summary:
          "A context item's page: the item, what its list row reads, its owners and its history, newest first",
      })
      .errors(notFound)
      .input(itemId)
      .output(itemPageSchema),
    markRead: read
      .route({
        method: 'POST',
        path: '/items/{id}/read',
        tags: ['library'],
        summary: 'The person opened an item: only opened items can be marked as checked together',
      })
      .errors(notFound)
      .input(itemId)
      .output(z.object({ read: z.boolean() })),
    related: read
      .route({
        method: 'GET',
        path: '/items/{id}/related',
        tags: ['library'],
        summary:
          'Context related to an item, one step away, as get_related follows it: what people see in Related',
      })
      .errors(notFound)
      .input(itemId)
      .output(relatedSchema),
    restoreAsDraft: proposal
      .route({
        method: 'POST',
        path: '/items/{id}/restore-draft',
        tags: ['library'],
        summary:
          'Restore an earlier version as a draft, for an owner of its domain or an admin; what agents get does not change (FR-140)',
      })
      .errors(notFound)
      .input(restoreAsDraftInputSchema)
      .output(restoredDraftSchema),
    publish: review
      .route({
        method: 'POST',
        path: '/items/publish',
        tags: ['library'],
        summary:
          "Publish in one step as an owner of the draft's domain or an admin; anyone else sends it to the owners as a suggestion (FR-137)",
      })
      .errors(notFound)
      .input(publishItemInputSchema)
      .output(publishItemResultSchema),
    bulkPlan: read
      .route({
        method: 'POST',
        path: '/items/bulk/plan',
        tags: ['library'],
        summary:
          'What a change to many items would do: the rows it acts on, and the rows it leaves alone and why (FR-139)',
      })
      .input(itemBulkInputSchema)
      .output(itemBulkPlanSchema),
    bulkApply: review
      .route({
        method: 'POST',
        path: '/items/bulk',
        tags: ['library'],
        summary:
          'Change many items at once: each row it may change is done or failed, the rest skipped with why, with one Undo (FR-139)',
      })
      .input(itemBulkInputSchema)
      .output(itemBulkResultSchema),
    changes: read
      .route({
        method: 'GET',
        path: '/context/changes',
        tags: ['library'],
        summary: 'Changes made to many items at once, newest first: the History log',
      })
      .output(z.array(itemChangeSchema)),
    deleted: admin
      .route({
        method: 'GET',
        path: '/context/deleted',
        tags: ['library'],
        summary: 'Drafts that were deleted, newest first, with who deleted them and when',
      })
      .output(z.array(deletedDraftSchema)),
  },
  drafts: {
    fromText: proposal
      .route({
        method: 'POST',
        path: '/drafts/from-text',
        tags: ['library'],
        summary:
          'A draft read from pasted text or a link, with no model: the fields it could read, and those it guessed',
      })
      .input(draftFromTextInputSchema)
      .output(draftFromTextSchema),
  },
  library: {
    index: read
      .route({
        method: 'GET',
        path: '/library',
        tags: ['library'],
        summary: 'Every item the person may read, as one light index',
      })
      .output(libraryIndexSchema),
    freshness: read
      .route({
        method: 'GET',
        path: '/library/freshness',
        tags: ['library'],
        summary:
          'Items that applied and items that were current, today and on the same weekday of each week before',
      })
      .input(libraryFreshnessInputSchema)
      .output(libraryFreshnessSchema),
    reviews: read
      .route({
        method: 'POST',
        path: '/library/reviews',
        tags: ['library'],
        summary:
          'How the served version of each item was reviewed: who accepted it, on which day, in which edition, and the checks it passed (FR-326)',
      })
      .input(servedReviewsInputSchema)
      .output(z.array(servedReviewSchema)),
  },
  search: {
    all: read
      .route({
        method: 'GET',
        path: '/search',
        tags: ['library'],
        summary:
          'Search everywhere: items, definitions, domains and people whose names have the words, a few of each, best match first',
      })
      .input(searchAllInputSchema)
      .output(searchResultsSchema),
  },
  bin: {
    list: admin
      .route({
        method: 'GET',
        path: '/bin',
        tags: ['library'],
        summary: 'Items in the Bin, newest first, with who moved them, when and why',
      })
      .output(binListSchema),
    get: admin
      .route({
        method: 'GET',
        path: '/bin/{id}',
        tags: ['library'],
        summary: 'One item in the Bin, as the library showed it, to read before restoring it',
      })
      .errors({
        NOT_FOUND: {
          message:
            "We couldn't find this fact in the Bin. Someone may have restored or deleted it.",
        },
      })
      .input(itemId)
      .output(binItemSchema),
    preview: admin
      .route({
        method: 'POST',
        path: '/bin/preview',
        tags: ['library'],
        summary: 'What moving items to the Bin would do: which agents get now, and open proposals',
      })
      .errors({ NOT_FOUND: { message: "We couldn't find this fact in the library." } })
      .input(binItemsSchema)
      .output(binPreviewSchema),
    move: release
      .route({
        method: 'POST',
        path: '/bin',
        tags: ['library'],
        summary:
          'Move items to the Bin with one reason: agents stop getting them in one new edition (FR-218)',
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this fact in the library." },
        CONFLICT: {
          message:
            'A fact is already in the Bin, or what agents get changed. Look at the latest version, then try again.',
        },
      })
      .input(binMoveSchema)
      .output(binMoveResultSchema),
    rescuePreview: admin
      .route({
        method: 'POST',
        path: '/bin/rescue-preview',
        tags: ['library'],
        summary:
          'What restoring items of a deleted domain into another domain would change in each (FR-814)',
      })
      .errors({
        NOT_FOUND: {
          message:
            "We couldn't find this fact in the Bin. Someone may have restored or deleted it.",
        },
        UNPROCESSABLE_CONTENT: { message: 'Choose a domain that exists.' },
      })
      .input(binRescuePreviewInputSchema)
      .output(binRescuePreviewSchema),
    restore: release
      .route({
        method: 'POST',
        path: '/bin/restore',
        tags: ['library'],
        summary:
          'Restore items from the Bin: the ones agents got are served again in one new edition; one of a deleted domain goes to another domain, retired, with a proposal there',
      })
      .errors({
        NOT_FOUND: {
          message:
            "We couldn't find this fact in the Bin. Someone may have restored or deleted it.",
        },
        CONFLICT: {
          message:
            "A fact can't be shared with agents again, or what agents get changed. Look at the latest version, then try again.",
        },
        UNPROCESSABLE_CONTENT: { message: "A fact can't go to the domain you chose." },
      })
      .input(binRestoreSchema)
      .output(binRestoreResultSchema),
  },
  catalogue: {
    list: read
      .route({
        method: 'GET',
        path: '/catalogue',
        tags: ['library'],
        summary:
          'Every metric and dimension of the live vocabulary, with its definition copy and what the library holds about it (FR-136)',
      })
      .output(catalogueSchema),
    get: read
      .route({
        method: 'GET',
        path: '/catalogue/{kind}/{id}',
        tags: ['library'],
        summary: 'One metric or dimension of the catalogue; a dimension with its values (FR-136)',
      })
      .errors({ NOT_FOUND: { message: "We couldn't find this metric or dimension." } })
      .input(catalogueTermInputSchema)
      .output(catalogueTermDetailSchema),
  },
  terms: {
    list: read
      .route({
        method: 'GET',
        path: '/terms',
        tags: ['library'],
        summary:
          'The terms and synonyms written here, by name, each with how much live context is about it and any conflict (FR-138)',
      })
      .output(termListSchema),
    create: termWrite
      .route({
        method: 'POST',
        path: '/terms',
        tags: ['library'],
        summary:
          'Write a term with its own meaning, or another name for a metric, a dimension or a term; a word that already means something is refused, naming who has it (FR-138)',
      })
      .input(termCreateInputSchema)
      .output(termSchema),
    update: termWrite
      .route({
        method: 'PUT',
        path: '/terms/{id}',
        tags: ['library'],
        summary:
          "Change a term's word, meaning, what it is another name for, or domain, by an owner of its domain or an admin (FR-138)",
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this term. Someone may have deleted it." },
      })
      .input(termUpdateInputSchema)
      .output(termSchema),
    delete: read
      .meta({ scope: 'propose' })
      .route({
        method: 'POST',
        path: '/terms/delete',
        tags: ['library'],
        summary:
          'Delete terms, with the synonyms that point at them; the rest are left as they were, with why, and one Undo takes it back',
      })
      .input(termIdsInputSchema)
      .output(termChangeResultSchema),
    move: read
      .meta({ scope: 'propose' })
      .route({
        method: 'POST',
        path: '/terms/move',
        tags: ['library'],
        summary:
          'Move terms to another domain, with their synonyms; the rest are left as they were, with why, and one Undo takes it back',
      })
      .input(termMoveInputSchema)
      .output(termChangeResultSchema),
    restore: termWrite
      .route({
        method: 'POST',
        path: '/terms/restore',
        tags: ['library'],
        summary:
          'Bring deleted terms back, with the synonyms deleted with them; a word that means something else by now stays deleted, with why',
      })
      .input(termIdsInputSchema)
      .output(termRestoreResultSchema),
    deleted: read
      .route({
        method: 'GET',
        path: '/terms/deleted',
        tags: ['library'],
        summary:
          'Terms that were deleted, newest first, with who deleted them and the synonyms that went with them: Settings, Advanced, Deleted',
      })
      .output(z.array(deletedTermSchema)),
    history: read
      .route({
        method: 'GET',
        path: '/terms/{id}/history',
        tags: ['library'],
        summary: "A term's versions, newest first: what each write made of it, and who wrote it",
      })
      .errors({ NOT_FOUND: { message: "We couldn't find this term." } })
      .input(termId)
      .output(z.array(termVersionSchema)),
  },
  definitions: {
    coverage: read
      .route({
        method: 'GET',
        path: '/definitions/coverage',
        tags: ['library'],
        summary:
          'What agents can be asked about with nothing written down: each metric and term with its own meaning, and how many live context items are about it',
      })
      .output(definitionCoverageSchema),
  },
  areas: {
    list: read
      .route({ method: 'GET', path: '/areas', tags: ['reference'], summary: 'Domains, by name' })
      .output(z.array(areaSchema)),
    setOwners: read
      .route({
        method: 'PUT',
        path: '/areas/{areaId}/owners',
        tags: ['roles'],
        summary:
          "Set a domain's owners, all of them, in one step (FR-804): its owners and admins may. Those not named stop owning it, those named start; a domain that has owners keeps at least one",
      })
      .errors({
        FORBIDDEN: { message: 'Only its owners and admins add owners.' },
        CONFLICT: {
          message: 'A domain needs an owner. Add another owner first, then take this one off.',
        },
      })
      .input(setOwnersSchema)
      .output(ownersSetSchema),
    get: admin
      .route({
        method: 'GET',
        path: '/areas/{id}',
        tags: ['admin'],
        summary:
          'One domain as settings edits it: name, hue, review time, chat channel, owner team and who looks after it',
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this domain. Someone may have deleted it." },
      })
      .input(areaId)
      .output(areaDetailSchema),
    create: areaSettings
      .route({
        method: 'POST',
        path: '/areas',
        tags: ['admin'],
        summary:
          'Create a domain with a reason (FR-801), and its owners and approvers in the same step; the team is given as one grants.apply batch with the same reason',
      })
      .input(createAreaSchema)
      .output(areaDetailSchema),
    update: areaSettings
      .route({
        method: 'PUT',
        path: '/areas/{id}',
        tags: ['admin'],
        summary:
          'Change the name, hue, review time, chat channel, owner team, summary or description of a domain, with a reason (FR-801)',
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this domain. Someone may have deleted it." },
      })
      .input(updateAreaSchema)
      .output(areaDetailSchema),
    describe: areaSettings
      .meta({ scope: 'maintain' })
      .route({
        method: 'PUT',
        path: '/areas/{id}/description',
        tags: ['reference'],
        summary:
          "Write what a domain is and what kind of data it holds: a summary line and a description (FR-813); one of the domain's owners or an administrator",
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this domain. Someone may have deleted it." },
      })
      .input(describeAreaSchema)
      .output(areaDetailSchema),
    removal: admin
      .route({
        method: 'GET',
        path: '/areas/{id}/removal',
        tags: ['admin'],
        summary:
          'What deleting a domain would do (FR-814), named by kind: its accepted items move to the Bin, its terms are retired (or kept without a domain when another domain uses them), its open proposals are withdrawn, its drafts stay with their authors, its roles end',
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this domain. Someone may have deleted it." },
      })
      .input(areaId)
      .output(areaRemovalSchema),
    remove: areaRemovalRoute
      .route({
        method: 'POST',
        path: '/areas/{id}/removal',
        tags: ['admin'],
        summary:
          'Delete a domain and everything under it in one step, with the words permanently delete typed to confirm (FR-814): one new edition stops delivery of its items and terms, its open proposals are withdrawn and its roles end; one that history names is kept as history and can be restored at any time',
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this domain. Someone may have deleted it." },
      })
      .input(removeAreaSchema)
      .output(areaRemovedSchema),
    archived: admin
      .route({
        method: 'GET',
        path: '/archived-areas',
        tags: ['admin'],
        summary:
          'The deleted domains that history keeps, newest first, with what restoring each gives back',
      })
      .output(z.array(archivedAreaSchema)),
    restore: areaSettings
      .route({
        method: 'POST',
        path: '/archived-areas/{id}/restore',
        tags: ['admin'],
        summary:
          'Restore a deleted domain (FR-814), with the roles that ended and the terms it took, in one edition; its items wait in the Bin',
      })
      .errors({
        NOT_FOUND: {
          message: "We couldn't find this deleted domain. Someone may have restored it already.",
        },
      })
      .input(restoreAreaSchema)
      .output(areaRestoredSchema),
    dashboard: maintainRead
      .route({
        method: 'GET',
        path: '/areas/{areaId}/dashboard',
        tags: ['gaps'],
        summary: 'Weekly calls, calls without items, items past review, open gaps, review times',
      })
      .input(dashboardInputSchema)
      .output(dashboardSchema),
  },
  gaps: {
    list: read
      .route({ method: 'GET', path: '/gaps', tags: ['gaps'], summary: 'Gaps, open first' })
      .input(gapListInputSchema)
      .output(z.array(gapSchema)),
    get: read
      .route({
        method: 'GET',
        path: '/gaps/{id}',
        tags: ['gaps'],
        summary:
          'One gap, whether it is verified by test, and for its owners and administrators its notes, linked tests and history',
      })
      .input(gapIdInputSchema)
      .output(gapDetailSchema),
    setStatus: owner
      .meta({ scope: 'maintain' })
      .route({ method: 'POST', path: '/gaps/{id}/status', tags: ['gaps'] })
      .input(gapStatusInputSchema)
      .output(gapDetailSchema),
    addNote: owner
      .meta({ scope: 'maintain' })
      .route({ method: 'POST', path: '/gaps/{id}/notes', tags: ['gaps'] })
      .input(gapNoteInputSchema)
      .output(gapDetailSchema),
    linkTest: owner
      .meta({ scope: 'maintain' })
      .route({
        method: 'POST',
        path: '/gaps/{id}/tests',
        tags: ['gaps'],
        summary:
          'Link a test question of the domain that captures the gap (FR-610); linking it again changes nothing',
      })
      .input(gapLinkTestInputSchema)
      .output(gapDetailSchema),
    unlinkTest: owner
      .meta({ scope: 'maintain' })
      .route({
        method: 'POST',
        path: '/gaps/{id}/tests/{question}/unlink',
        tags: ['gaps'],
        summary: 'Unlink a test question from the gap; a verification already recorded stays',
      })
      .input(gapUnlinkTestInputSchema)
      .output(gapDetailSchema),
    report: read
      .errors({
        UNPROCESSABLE_CONTENT: {
          status: 422,
          message: 'Some details need attention. Fix the problems shown, then try again.',
          data: z.optional(z.object({ findings: z.array(findingSchema) })),
        },
        PRECONDITION_FAILED: {
          message: "Agents don't get any facts yet. Ask an admin to finish the setup.",
        },
        TOO_MANY_REQUESTS: {
          status: 429,
          message: "You've sent a lot of reports. Try again in a minute.",
          data: z.object({ retryAfterSeconds: z.number() }),
        },
      })
      .route({
        method: 'POST',
        path: '/gaps/reports',
        tags: ['gaps'],
        summary:
          'Report a gap about a scope (FR-606 case 5): counts one report against the topic, as report_gap does, and records no person',
      })
      .input(gapReportInputSchema)
      .output(gapReportSchema),
    startDraft: proposal
      .route({
        method: 'POST',
        path: '/gaps/{id}/draft',
        tags: ['gaps'],
        summary: 'Start a draft filled with the scope of the gap',
      })
      .input(gapDraftInputSchema)
      .output(proposalRecordSchema),
    draft: proposal
      .route({
        method: 'POST',
        path: '/gaps/{id}/scope-draft',
        tags: ['gaps'],
        summary:
          "A Not found card's draft: the gap's scope, its own month as when it applies and a title in words, or the draft already started from it",
      })
      .input(gapDraftInputSchema)
      .output(proposalRecordSchema),
  },
  topics: {
    counts: read
      .route({
        method: 'GET',
        path: '/topics/counts',
        tags: ['gaps'],
        summary: 'Calls per topic and week, where a topic reaches the minimum count',
      })
      .input(topicCountsInputSchema)
      .output(topicCountsSchema),
    weekly: read
      .route({
        method: 'GET',
        path: '/topics/weekly',
        tags: ['gaps'],
        summary: 'Agent calls per week over every topic, each total hidden below the minimum count',
      })
      .input(weeklyCallsInputSchema)
      .output(weeklyCallsSchema),
  },
  sources: {
    flags: read
      .route({
        method: 'GET',
        path: '/sources/flags',
        tags: ['sources'],
        summary: 'Items waiting for a source check: a definition they reference changed or is gone',
      })
      .input(sourceListSchema)
      .output(z.array(flaggedItemSchema)),
    staleLinks: read
      .route({
        method: 'GET',
        path: '/sources/stale-links',
        tags: ['sources'],
        summary: 'Mentions whose target was retired, replaced, changed or is gone (inform only)',
      })
      .input(sourceListSchema)
      .output(z.array(staleLinkSchema)),
    // The sources an administrator adds in Administration › Sources (connector interface 3.0).
    types: admin
      .route({
        method: 'GET',
        path: '/sources/types',
        tags: ['sources'],
        summary:
          'The connectors an administrator may add a source of: each manifest, with the access it needs and its form',
      })
      .output(z.array(connectorListingSchema)),
    get: admin
      .errors({
        NOT_FOUND: { message: "We couldn't find this source among the ones an admin added." },
      })
      .route({
        method: 'GET',
        path: '/sources/{id}',
        tags: ['sources'],
        summary: 'A source an administrator added: its settings, and whether each secret is set',
      })
      .input(sourceIdInputSchema)
      .output(sourceSettingsSchema),
    add: sourceSettings
      .route({
        method: 'POST',
        path: '/sources',
        successStatus: 201,
        tags: ['sources'],
        summary: 'Add a source with its settings and secrets, with a reason (CON-105)',
      })
      .input(addSourceSchema)
      .output(sourceSettingsSchema),
    update: sourceSettings
      .errors({
        NOT_FOUND: { message: "We couldn't find this source among the ones an admin added." },
      })
      .route({
        method: 'PUT',
        path: '/sources/{id}',
        tags: ['sources'],
        summary: 'Change a source an administrator added, with a reason; a secret left out is kept',
      })
      .input(updateSourceSchema)
      .output(sourceSettingsSchema),
    test: sourceSettings
      .errors({
        NOT_FOUND: { message: "We couldn't find this source among the ones an admin added." },
      })
      .route({
        method: 'POST',
        path: '/sources/test',
        tags: ['sources'],
        summary:
          "Run the connector's check and read a source once with these settings, keeping nothing and changing nothing",
      })
      .input(testSourceSchema)
      .output(sourceCheckSchema),
  },
  // The people of the workspace as Heed v1 has them: Admin or Member, and the domains each owns.
  members: {
    list: read
      .route({
        method: 'GET',
        path: '/members',
        tags: ['roles'],
        summary:
          'Everyone in the workspace: their role (Admin or Member), the domains they own and when they last signed in',
      })
      .output(z.array(memberSchema)),
    setRole: admin
      .route({
        method: 'POST',
        path: '/members/{personId}/role',
        tags: ['roles'],
        summary:
          "Make someone an Admin or a Member (FR-804); not one's own role, and the workspace keeps an active admin",
      })
      .errors({
        CONFLICT: {
          message: "You can't change your own role. Ask another admin.",
        },
      })
      .input(setRoleSchema)
      .output(changed),
    remove: admin
      .route({
        method: 'POST',
        path: '/members/{personId}/remove',
        tags: ['roles'],
        summary:
          'Remove someone from the workspace: their roles end, they are signed out and their agents disconnected. Refused while a domain has them as its only owner, and for oneself. What they wrote stays, with their name',
      })
      .errors({
        CONFLICT: {
          message: 'Hand over first: they are the only owner of a domain.',
          data: z.optional(soleOwnerSchema),
        },
      })
      .input(memberIdSchema)
      .output(memberRemovedSchema),
    restore: admin
      .route({
        method: 'POST',
        path: '/members/{personId}/restore',
        tags: ['roles'],
        summary:
          'Undo a removal: the person is back, with the roles their last removal ended (those of a domain that still exists). They sign in again',
      })
      .input(memberIdSchema)
      .output(changed),
  },
  invites: {
    lookup: publicRoute
      .route({
        method: 'GET',
        path: '/invites/lookup',
        tags: ['session'],
        summary:
          'What an invite link says on the sign-in screen: the address, the role and the domains, while the invite is open. Every other link gets the same answer, whatever the reason',
      })
      .errors({
        NOT_FOUND: {
          message: "This invite link doesn't work any more. Ask whoever invited you for a new one.",
        },
      })
      .input(inviteTokenSchema)
      .output(inviteLookupSchema),
    list: read
      .route({
        method: 'GET',
        path: '/invites',
        tags: ['roles'],
        summary: 'The open invites: who, as what, owning which domains, sent when and by whom',
      })
      .output(z.array(inviteSchema)),
    create: read
      .route({
        method: 'POST',
        path: '/invites',
        tags: ['roles'],
        summary:
          'Invite people by address, as an Admin or a Member owning some domains from the start (FR-417). An admin invites anyone; an owner invites a Member to the domains they own. Each new invite comes with its link, shown only here; an address already in the workspace or already invited is named, not invited again',
      })
      .errors({
        FORBIDDEN: {
          message:
            'Only an admin invites people. An owner invites people to their own domains, but not as an admin.',
        },
      })
      .input(createInvitesSchema)
      .output(invitesCreatedSchema),
    resend: read
      .route({
        method: 'POST',
        path: '/invites/{id}/resend',
        tags: ['roles'],
        summary:
          'Send an invite again, by its sender or an admin: a new link that works for another week, and the old one stops working',
      })
      .input(inviteIdSchema)
      .output(inviteResentSchema),
    revoke: read
      .route({
        method: 'POST',
        path: '/invites/{id}/revoke',
        tags: ['roles'],
        summary: 'Take an invite back, by its sender or an admin: its link stops working',
      })
      .input(inviteIdSchema)
      .output(z.object({ revoked: z.boolean() })),
  },
  people: {
    list: read
      .route({ method: 'GET', path: '/people', tags: ['reference'], summary: 'People, by name' })
      .output(z.array(personSchema)),
    search: auditor
      .route({
        method: 'GET',
        path: '/people/search',
        tags: ['roles'],
        summary:
          'Find people by name or email, a page at a time, with their roles and last sign-in; active people unless a status is asked for',
      })
      .input(peopleSearchSchema)
      .output(peoplePageSchema),
    sheet: admin
      .route({
        method: 'GET',
        path: '/people/{id}/roles',
        tags: ['roles'],
        summary:
          "A person's sheet: every role they hold, since when and from whom, and every change to their roles",
      })
      .input(personIdSchema)
      .output(personSheetSchema),
  },
  vocabulary: {
    get: read
      .route({
        method: 'GET',
        path: '/vocabulary',
        tags: ['reference'],
        summary: 'The live vocabulary: metrics, dimensions and their values, by name',
      })
      .output(vocabularySchema),
    search: read
      .route({
        method: 'GET',
        path: '/vocabulary/search',
        tags: ['reference'],
        summary:
          'A page of metrics, dimensions and values for the scope picker: recent and often used first (FR-107)',
      })
      .input(scopeSearchInputSchema)
      .output(scopeSearchSchema),
    describe: read
      .route({
        method: 'POST',
        path: '/vocabulary/terms',
        tags: ['reference'],
        summary:
          'The names of scope keys, for the chips of a draft; a key no longer in use is left out',
      })
      .input(scopeDescribeInputSchema)
      .output(z.array(scopeHitSchema)),
    propose: review
      .route({
        method: 'POST',
        path: '/vocabulary/proposals',
        tags: ['review'],
        summary: 'Propose a new or changed vocabulary term (FR-125)',
      })
      .input(vocabularyProposalSchema)
      .output(reviewProposalSchema),
    candidates: admin
      .route({
        method: 'GET',
        path: '/vocabulary/candidates',
        tags: ['review'],
        summary:
          'The members of the definition sources that no term or open proposal links yet, each as the term to propose for it',
      })
      .output(z.array(termCandidateSchema)),
    proposeBatch: review
      .meta({ scope: 'admin' })
      .route({
        method: 'POST',
        path: '/vocabulary/batches',
        tags: ['review'],
        summary:
          'Propose many terms in one step, all or none: one proposal each in one batch, each still decided by an owner of its domain or an administrator',
      })
      .input(termBatchSchema)
      .output(termBatchResultSchema),
    decideBatch: review
      .route({
        method: 'POST',
        path: '/vocabulary/batches/{batchId}/decisions',
        tags: ['review'],
        summary:
          'Accept or reject every open term of a batch you may decide, all or none; an accept publishes them as one edition',
      })
      .input(decideTermBatchSchema)
      .output(termBatchDecisionSchema),
  },
  inbox: {
    list: read
      .route({
        method: 'GET',
        path: '/inbox',
        tags: ['notifications'],
        summary: "The signed-in person's inbox, newest first",
      })
      .input(inboxListSchema)
      .output(inboxPageSchema),
    markRead: read
      .route({ method: 'POST', path: '/inbox/read', tags: ['notifications'] })
      .input(inboxIdsSchema)
      .output(inboxChangeSchema),
    markAllRead: read
      .route({ method: 'POST', path: '/inbox/read-all', tags: ['notifications'] })
      .output(inboxChangeSchema),
    archive: read
      .route({ method: 'POST', path: '/inbox/archive', tags: ['notifications'] })
      .input(inboxIdsSchema)
      .output(inboxChangeSchema),
    feed: read
      .route({
        method: 'GET',
        path: '/inbox/feed',
        tags: ['inbox'],
        summary:
          'The Inbox by need: Not found, Reported, Due for a check and Suggestions for the domains the person owns, with what they sent that waits and what is done under All; counts from agents only, small counts hidden (FR-614)',
      })
      .input(feedInputSchema)
      .output(feedSchema),
  },
  cards: {
    markRead: read
      .route({
        method: 'POST',
        path: '/inbox/cards/read',
        tags: ['inbox'],
        summary: 'The person opened these cards: their unread mark goes',
      })
      .input(markCardsReadSchema)
      .output(z.object({ cards: z.array(cardIdSchema) })),
    decide: review
      .route({
        method: 'POST',
        path: '/inbox/cards/decide',
        tags: ['inbox'],
        summary:
          "A card's one decision: Not something we write down, Not a problem, Still true or Archive; it answers with a token that undoes it (FR-227)",
      })
      .input(decideCardSchema)
      .output(decideCardResultSchema),
  },
  comments: {
    list: read
      .route({
        method: 'GET',
        path: '/comments',
        tags: ['comments'],
        summary:
          'The threads on suggestions and context items the person may read: comments oldest first with their replies and reactions, the reactions on each subject, the newest reply since they last opened it, and the comments that mention them unread. Agents never read comments (FR-817)',
      })
      .input(listCommentsInputSchema)
      .output(commentThreadsSchema),
    create: commentWrite
      .route({
        method: 'POST',
        path: '/comments',
        tags: ['comments'],
        summary:
          'A comment on a suggestion or a context item, or a reply to one, by anyone who may read it; its mentions of people reach their Inbox (FR-817)',
      })
      .input(createCommentSchema)
      .output(threadCommentSchema),
    edit: commentWrite
      .route({
        method: 'PUT',
        path: '/comments/{id}',
        tags: ['comments'],
        summary: "Changes a comment's words: its author only",
      })
      .input(editCommentSchema)
      .output(threadCommentSchema),
    remove: commentWrite
      .route({
        method: 'DELETE',
        path: '/comments/{id}',
        tags: ['comments'],
        summary:
          'Deletes a comment, its author only: one something answers keeps its place without its words, one nobody answered goes',
      })
      .input(commentIdSchema)
      .output(removeCommentResultSchema),
    markMentionsRead: read
      .route({
        method: 'POST',
        path: '/comments/mentions/read',
        tags: ['comments'],
        summary:
          'The person read the comments that mention them in a thread: their Inbox card goes',
      })
      .input(threadInputSchema)
      .output(z.object({ marked: z.number() })),
  },
  reactions: {
    toggle: commentWrite
      .route({
        method: 'POST',
        path: '/reactions/toggle',
        tags: ['comments'],
        summary:
          'Gives or takes back one of the five reactions, on a comment or on the suggestion or item itself',
      })
      .input(toggleReactionSchema)
      .output(toggleReactionResultSchema),
  },
  threads: {
    markRead: read
      .route({
        method: 'POST',
        path: '/comments/threads/read',
        tags: ['comments'],
        summary: 'The person opened a thread: a reply before now is no longer new to them',
      })
      .input(threadInputSchema)
      .output(z.object({ seenAt: z.string() })),
  },
  decisions: {
    undo: review
      .route({
        method: 'POST',
        path: '/decisions/undo',
        tags: ['review'],
        summary:
          'Takes back a decision its maker made moments ago, as a new edition that serves again exactly what it changed (FR-227)',
      })
      .input(undoInputSchema)
      .output(undoResultSchema),
  },
  setup: {
    state: read
      .route({
        method: 'GET',
        path: '/setup',
        tags: ['admin'],
        summary:
          "A new workspace's setup checklist, read from what exists: About our business, a published context item, Ask used, an agent connected, definitions connected (FR-816)",
      })
      .output(setupSchema),
  },
  activity: {
    list: read
      .route({
        method: 'GET',
        path: '/activity',
        tags: ['notifications'],
        summary: 'Recent submissions, reviews and releases the person may see, newest first',
      })
      .input(activityListSchema)
      .output(activityPageSchema),
  },
  events: {
    stream: read
      .route({
        method: 'GET',
        path: '/events',
        tags: ['notifications'],
        summary: 'Live updates as server-sent events; resume with Last-Event-ID',
      })
      .output(eventIterator(streamEventSchema)),
  },
  evals: {
    questions: {
      list: evals
        .route({
          method: 'GET',
          path: '/evals/questions',
          tags: ['evals'],
          summary: 'Test questions; held-out ones only for their maintainers (FR-503)',
        })
        .input(questionListSchema)
        .output(z.array(storedQuestionSchema)),
      get: evals
        .route({ method: 'GET', path: '/evals/questions/{id}', tags: ['evals'] })
        .input(questionIdInputSchema)
        .output(storedQuestionSchema),
      save: maintain
        .route({
          method: 'PUT',
          path: '/evals/questions/{id}',
          tags: ['evals'],
          summary: 'Create a test question, or replace it with the revision you read (FR-520)',
        })
        .input(saveQuestionSchema)
        .output(storedQuestionSchema),
      setAside: maintain
        .route({
          method: 'POST',
          path: '/evals/questions/{id}/set-aside',
          tags: ['evals'],
          summary: 'Set a test question aside with a reason, or take it back with null (FR-514)',
        })
        .input(setAsideSchema)
        .output(storedQuestionSchema),
      import: maintain
        .route({
          method: 'POST',
          path: '/evals/import',
          tags: ['evals'],
          summary: 'Import a YAML or JSON file of test questions; a dry run by default (FR-504)',
        })
        .input(importSchema)
        .output(importReportSchema),
      export: maintain
        .route({
          method: 'GET',
          path: '/evals/export',
          tags: ['evals'],
          summary: 'The test questions as a YAML file (FR-504)',
        })
        .input(questionListSchema)
        .output(exportSchema),
    },
    runs: {
      list: maintain
        .route({
          method: 'GET',
          path: '/evals/runs',
          tags: ['evals'],
          summary: 'Evaluation runs, newest first',
        })
        .input(runListSchema)
        .output(z.array(runSchema)),
      get: evals
        .route({
          method: 'GET',
          path: '/evals/runs/{id}',
          tags: ['evals'],
          summary: 'A run with its results, flips, cells and replay (FR-509, FR-510, FR-512)',
        })
        .input(runIdSchema)
        .output(runDetailSchema),
      estimate: maintain
        .route({
          method: 'GET',
          path: '/evals/areas/{id}/estimate',
          tags: ['evals'],
          summary: 'The cost estimate of a full or links run of a domain, before it runs (FR-516)',
        })
        .input(estimateInputSchema)
        .output(estimateSchema),
      start: maintain
        .route({
          method: 'POST',
          path: '/evals/areas/{id}/runs',
          tags: ['evals'],
          summary: 'Start a full run of a domain on the live edition',
        })
        .input(areaInputSchema)
        .output(runSchema),
      startLinks: maintain
        .route({
          method: 'POST',
          path: '/evals/areas/{id}/link-runs',
          tags: ['evals'],
          summary:
            "Start a links run: the domain's questions on the live edition with get_related off and on (FR-523)",
        })
        .input(areaInputSchema)
        .output(runSchema),
      approve: evals
        .meta({ scope: 'admin' })
        .route({
          method: 'POST',
          path: '/evals/runs/{id}/approve',
          tags: ['evals'],
          summary: 'Approve a run estimated above the budget (FR-516)',
        })
        .input(runIdSchema)
        .output(runSchema),
      cancel: evals
        .route({ method: 'POST', path: '/evals/runs/{id}/cancel', tags: ['evals'] })
        .input(runIdSchema)
        .output(runSchema),
      resume: evals
        .route({
          method: 'POST',
          path: '/evals/runs/{id}/resume',
          tags: ['evals'],
          summary: 'Resume a run that stopped before every answer was made, making only those (R6)',
        })
        .input(runIdSchema)
        .output(runSchema),
    },
    transcript: maintain
      .route({
        method: 'GET',
        path: '/evals/cells/{id}/transcript',
        tags: ['evals'],
        summary: 'The transcript of one try, for owners and administrators (FR-519)',
      })
      .input(runIdSchema)
      .output(transcriptSchema),
    scorecard: maintainRead
      .route({
        method: 'GET',
        path: '/evals/areas/{id}/scorecard',
        tags: ['evals'],
        summary: 'The latest weekly scorecard of a domain and its baseline (FR-517, FR-518)',
      })
      .input(areaInputSchema)
      .output(areaScorecardSchema),
    // The retrieval pass of every edition, without a model: owners and administrators.
    retrieval: {
      latest: maintain
        .route({
          method: 'GET',
          path: '/evals/retrieval',
          tags: ['evals'],
          summary:
            'The newest retrieval pass of the live edition: each test question delivered as expected, no model',
        })
        .input(retrievalAreaSchema)
        .output(retrievalEditionSchema),
      edition: maintain
        .route({
          method: 'GET',
          path: '/evals/retrieval/editions/{label}',
          tags: ['evals'],
          summary: 'The retrieval pass of one sealed edition',
        })
        .input(retrievalEditionInputSchema)
        .output(retrievalEditionSchema),
      trend: maintain
        .route({
          method: 'GET',
          path: '/evals/retrieval/trend',
          tags: ['evals'],
          summary:
            'Retrieval passes newest first, one per sealed edition and per day of the live edition',
        })
        .input(retrievalTrendInputSchema)
        .output(z.array(retrievalPointSchema)),
    },
  },
  // The Quality page: owners of an area, and administrators (the data platform team).
  quality: {
    history: maintainRead
      .route({
        method: 'GET',
        path: '/quality/history',
        tags: ['quality'],
        summary:
          'Weekly scores in one call: per finished weekly run, its rates, held-out measures, retrieval pass and cost',
      })
      .input(historyInputSchema)
      .output(z.array(historyPointSchema)),
    compare: maintainRead
      .errors({
        UNPROCESSABLE_CONTENT: { status: 422, message: "These runs can't be compared." },
      })
      .route({
        method: 'GET',
        path: '/quality/runs/{id}/compare',
        tags: ['quality'],
        summary:
          'Two runs of a domain compared: questions that got better and worse, their failing checks and a sign test',
      })
      .input(compareInputSchema)
      .output(comparisonSchema),
    feedback: maintainRead
      .route({
        method: 'GET',
        path: '/quality/feedback',
        tags: ['quality'],
        summary: 'Agent feedback per verdict, week and domain; small counts hidden (FR-614)',
      })
      .input(qualityWeeksInputSchema)
      .output(feedbackCountsSchema),
    ratings: maintainRead
      .route({
        method: 'GET',
        path: '/quality/ratings',
        tags: ['quality'],
        summary:
          "The assistant's ratings per verdict, week and domain; small counts hidden (FR-614, FR-712)",
      })
      .input(qualityWeeksInputSchema)
      .output(ratingCountsSchema),
    apps: maintainRead
      .route({
        method: 'GET',
        path: '/quality/apps',
        tags: ['quality'],
        summary:
          'How the agents that called the MCP server fared, per app family and week; small counts hidden (FR-410, FR-614)',
      })
      .input(appFamilyCountsInputSchema)
      .output(appFamilyCountsSchema),
    upkeep: maintainRead
      .route({
        method: 'GET',
        path: '/quality/upkeep',
        tags: ['quality'],
        summary: 'Items past their review date and proposals accepted, per week and domain',
      })
      .input(qualityWeeksInputSchema)
      .output(upkeepSchema),
    untested: maintainRead
      .route({
        method: 'GET',
        path: '/quality/untested',
        tags: ['quality'],
        summary: 'Items in the live edition that no active test question names, per domain',
      })
      .input(qualityAreaInputSchema)
      .output(untestedSchema),
    fixNext: maintainRead
      .route({
        method: 'GET',
        path: '/quality/fix-next',
        tags: ['quality'],
        summary:
          'One ranked list of work: failing test questions, open gaps, items past review and untested items',
      })
      .input(fixNextInputSchema)
      .output(fixNextSchema),
    compareQuestion: maintainRead
      .errors({
        UNPROCESSABLE_CONTENT: { status: 422, message: "These runs can't be compared." },
      })
      .route({
        method: 'GET',
        path: '/quality/questions/{question}/compare',
        tags: ['quality'],
        summary:
          'One test question across two runs: each try, what was held constant and the items that changed between the editions',
      })
      .input(compareQuestionInputSchema)
      .output(questionComparisonSchema),
    questionHistory: maintainRead
      .route({
        method: 'GET',
        path: '/quality/questions/{question}/history',
        tags: ['quality'],
        summary:
          "One test question's verdict in its domain's recent runs, and its retrieval result per edition",
      })
      .input(questionHistoryInputSchema)
      .output(questionHistorySchema),
  },
  me: {
    get: read
      .route({ method: 'GET', path: '/me', tags: ['session'], summary: 'The signed-in person' })
      .output(meSchema),
  },
  settings: {
    list: admin
      .route({
        method: 'GET',
        path: '/settings',
        tags: ['admin'],
        summary:
          'Limits, thresholds, retention periods and review times, current versions (FR-809)',
      })
      .output(z.array(settingSchema)),
    history: admin
      .route({
        method: 'GET',
        path: '/settings/{key}/history',
        tags: ['admin'],
        summary: 'Every version of one setting, newest first',
      })
      .input(settingKeyInputSchema)
      .output(z.array(settingSchema)),
    set: settings
      .route({
        method: 'PUT',
        path: '/settings/{key}',
        tags: ['admin'],
        summary: 'Change a setting with a reason, as a new version (FR-806, FR-809)',
      })
      .input(setSettingSchema)
      .output(settingSchema),
  },
  tools: {
    list: admin
      .route({
        method: 'GET',
        path: '/tools',
        tags: ['admin'],
        summary: 'Which MCP tools are switched on (FR-407)',
      })
      .output(z.array(toolSwitchSchema)),
    set: admin
      .route({
        method: 'POST',
        path: '/tools/{tool}',
        tags: ['admin'],
        summary: 'Switch an MCP tool on or off for every client, with a reason (FR-407)',
      })
      .input(setToolSchema)
      .output(toolSwitchSchema),
  },
  clients: {
    list: admin
      .route({
        method: 'GET',
        path: '/clients',
        tags: ['admin'],
        summary: 'The AI clients that may connect, with their tools and limits',
      })
      .output(z.array(clientPolicySchema)),
    save: admin
      .route({
        method: 'PUT',
        path: '/clients/{label}',
        tags: ['admin'],
        summary: 'Add a client or change its tools, limits or switch, with a reason (FR-408)',
      })
      .input(saveClientSchema)
      .output(clientPolicySchema),
  },
  traffic: {
    summary: admin
      .route({
        method: 'GET',
        path: '/traffic',
        tags: ['admin'],
        summary:
          'MCP calls by client and tool over the last days, from the request log: outcomes, durations and bytes, no person (FR-410)',
      })
      .input(trafficInputSchema)
      .output(trafficSummarySchema),
  },
  // The operations view and manual job runs (FR-810), for administrators.
  operations: {
    overview: admin
      .errors({
        SERVICE_UNAVAILABLE: { message: "We couldn't reach the database. Try again in a minute." },
      })
      .route({
        method: 'GET',
        path: '/operations',
        tags: ['admin'],
        summary:
          'Each scheduled job and connector: last success, last error and age of its data, the job queue and model spending (FR-810)',
      })
      .output(operationsOverviewSchema),
    run: admin
      .errors({
        NOT_FOUND: { message: "There's no scheduled job with this name." },
        CONFLICT: { message: "This job is already waiting or running. Try again once it's done." },
        SERVICE_UNAVAILABLE: {
          message: "The job runner isn't running. Ask the data team to start it.",
        },
      })
      .route({
        method: 'POST',
        path: '/operations/jobs/{job}/run',
        successStatus: 202,
        tags: ['admin'],
        summary: 'Queue a run of a scheduled job now',
      })
      .input(runJobInputSchema)
      .output(runJobSchema),
  },
  audit: {
    search: auditor
      .route({
        method: 'GET',
        path: '/audit',
        tags: ['admin'],
        summary: 'Search the history log, newest first (FR-808)',
      })
      .input(auditSearchSchema)
      .output(auditPageSchema),
    export: auditor
      .route({
        method: 'GET',
        path: '/audit/export',
        tags: ['admin'],
        summary: 'Export the history log as JSON Lines or CSV, oldest first (FR-808)',
      })
      .input(auditExportInputSchema)
      .output(auditExportSchema),
    verify: auditor
      .route({
        method: 'GET',
        path: '/audit/verify',
        tags: ['admin'],
        summary: 'Check the hash chain of the whole history log (FR-806)',
      })
      .output(auditChainSchema),
  },
  imports: {
    items: proposal
      .route({
        method: 'POST',
        path: '/imports',
        tags: ['proposals'],
        summary: 'Import a YAML or JSON file of items as proposals; a dry run by default (FR-120)',
      })
      .input(itemImportSchema)
      .output(itemImportReportSchema),
  },
  assistant: {
    chat: read
      .meta({ scope: 'propose' })
      .errors({
        UNPROCESSABLE_CONTENT: {
          status: 422,
          message: "We couldn't read this conversation. Start a new one, then ask again.",
        },
      })
      .route({
        method: 'POST',
        path: '/assistant/chat',
        tags: ['assistant'],
        summary:
          'One assistant turn: send the conversation, receive the answer as UI message chunks (FR-701). It may propose drafts, never decide or publish (FR-706)',
      })
      .input(chatInputSchema)
      .output(eventIterator(chatChunkSchema)),
    rate: read
      .meta({ scope: 'propose' })
      .errors({
        TOO_MANY_REQUESTS: {
          status: 429,
          message: "You've sent a lot of ratings. Try again in a minute.",
          data: z.object({ retryAfterSeconds: z.number() }),
        },
      })
      .route({
        method: 'POST',
        path: '/assistant/ratings',
        tags: ['assistant'],
        summary:
          "Rate an answer good or wrong (FR-712): counts the verdict in the domain of the answer's metrics, and records no person, question or answer",
      })
      .input(ratingInputSchema)
      .output(ratingSchema),
  },
  connect: {
    get: read
      .route({
        method: 'GET',
        path: '/connect',
        tags: ['assistant'],
        summary:
          "How to connect an AI client: the MCP server's address, the tools switched on and the clients that may connect (FR-404)",
      })
      .output(connectInfoSchema),
  },
  tryIt: {
    run: read
      .errors({
        PRECONDITION_FAILED: {
          message: "Agents don't get any facts yet. Ask an admin to finish the setup.",
        },
      })
      .route({
        method: 'POST',
        path: '/try-it',
        tags: ['assistant'],
        summary:
          "What an agent would get: get_facts's reply and the answer engine's answer for a scope on the live edition, or with a draft in it, without a model, recording nothing (FR-602)",
      })
      .input(tryItRunInputSchema)
      .output(tryItRunSchema),
    read: read
      .errors({
        PRECONDITION_FAILED: {
          message: "Agents don't get any facts yet. Ask an admin to finish the setup.",
        },
      })
      .route({
        method: 'POST',
        path: '/try-it/read',
        tags: ['assistant'],
        summary:
          'A question read as a scope with the vocabulary of the live edition, so Try it opens on what was asked; the question is never stored (FR-602)',
      })
      .input(tryItReadInputSchema)
      .output(tryItReadingSchema),
  },
  reports: {
    create: read
      .errors({
        TOO_MANY_REQUESTS: {
          status: 429,
          message: "You've sent a lot of reports. Try again in a minute.",
          data: z.object({ retryAfterSeconds: z.number() }),
        },
      })
      .route({
        method: 'POST',
        path: '/reports',
        tags: ['assistant'],
        summary:
          "A named report from Ask (FR-622): what is wrong with an answer, to the owners of its item's domain as a Reported card, with the question and the sender's name; nothing else of the chat is kept, and agents never read it",
      })
      .input(createReportSchema)
      .output(sentReportSchema),
    mine: read
      .route({
        method: 'GET',
        path: '/reports/mine',
        tags: ['assistant'],
        summary:
          "The person's own named reports of the last 90 days, newest first, each with what the owners did after it, for Ask to show in the chat",
      })
      .output(myReportsSchema),
  },
  ask: {
    lookup: read
      .errors({
        PRECONDITION_FAILED: {
          message: "Agents don't get any context yet. Ask an admin to finish the setup.",
        },
      })
      .route({
        method: 'POST',
        path: '/ask/lookup',
        tags: ['assistant'],
        summary:
          'A question looked up on the live edition as get_context answers it, with no model: each step as it is done, then the answer with its state; the question is never stored (FR-602)',
      })
      .input(lookupInputSchema)
      .output(eventIterator(lookupEventSchema)),
    asked: read
      .errors({
        PRECONDITION_FAILED: {
          message: "Agents don't get any context yet. Ask an admin to finish the setup.",
        },
      })
      .route({
        method: 'GET',
        path: '/ask/asked',
        tags: ['assistant'],
        summary:
          'Asked this week: the topics agents asked about most, with the state each gets now; counts only, small counts hidden (FR-614)',
      })
      .output(askedSchema),
  },
  engine: {
    reach: read
      .meta({ scope: 'propose' })
      .errors({
        PRECONDITION_FAILED: {
          message: "Agents don't get any context yet, so no question would get this draft.",
        },
        UNPROCESSABLE_CONTENT: {
          status: 422,
          message: 'Complete the draft to see who would get it.',
        },
      })
      .route({
        method: 'POST',
        path: '/engine/reach',
        tags: ['assistant'],
        summary:
          "How many questions agents asked this week would get a draft: each topic answered with the draft in the live edition; topics asked fewer than the minimum don't count (FR-614)",
      })
      .input(reachInputSchema)
      .output(reachSchema),
  },
  obs: {
    agents: maintainRead
      .route({
        method: 'GET',
        path: '/observability/agents',
        tags: ['quality'],
        summary:
          "Overview's and Questions' read: what agents asked in a range and how it was answered, per day, per topic and per kind of agent; counts and scopes only, small counts hidden (FR-614, FR-620)",
      })
      .input(obsAgentsInputSchema)
      .output(obsAgentsSchema),
    feedback: maintainRead
      .route({
        method: 'GET',
        path: '/observability/feedback',
        tags: ['quality'],
        summary:
          "Feedback's read: what agents and people reported about answers in a range, and the answers people marked good; no person named, small counts hidden (FR-614, FR-620)",
      })
      .input(obsFeedbackInputSchema)
      .output(obsFeedbackSchema),
    usage: admin
      .route({
        method: 'GET',
        path: '/observability/usage',
        tags: ['quality'],
        summary:
          "Usage's read, for administrators: tool calls and how they ended, calls by kind of agent, reply times, and model spend against the caps (FR-410, FR-620)",
      })
      .input(obsUsageInputSchema)
      .output(obsUsageSchema),
    views: {
      list: maintainRead
        .route({
          method: 'GET',
          path: '/observability/views',
          tags: ['quality'],
          summary:
            'The views people saved on Questions, for everyone in the workspace: a name and filters, never a question',
        })
        .output(z.array(obsViewSchema)),
      save: maintainRead
        .errors({
          CONFLICT: { message: 'A view with this name is already saved. Name it another way.' },
        })
        .route({
          method: 'POST',
          path: '/observability/views',
          tags: ['quality'],
          summary: "Save Questions' filters as a view everyone in the workspace has as a tab",
        })
        .input(obsViewSaveInputSchema)
        .output(obsViewSchema),
      remove: maintainRead
        .route({
          method: 'DELETE',
          path: '/observability/views/{id}',
          tags: ['quality'],
          summary: 'Remove a saved view: only whoever saved it, or an administrator',
        })
        .input(obsViewRemoveInputSchema)
        .output(z.object({ removed: z.boolean() })),
    },
    replay: maintainRead
      .errors({
        PRECONDITION_FAILED: {
          message:
            'Agents got nothing before what they get today, so there is nothing to compare with yet.',
        },
      })
      .route({
        method: 'POST',
        path: '/observability/replay',
        tags: ['quality'],
        summary:
          "The answer panel's replay: a topic answered now or before the last publish, step by step, with no model; for administrators and the owners of the topic's domains",
      })
      .input(replayInputSchema)
      .output(replaySchema),
  },
  schema: {
    item: publicRoute
      .route({
        method: 'GET',
        path: '/schema/item',
        tags: ['reference'],
        summary: 'The JSON Schema of the item format, mentions included (FR-124)',
      })
      .output(jsonSchemaDocument),
  },
}

export type Contract = typeof contract
