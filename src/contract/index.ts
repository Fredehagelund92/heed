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
  historyEntrySchema,
  itemLinksSchema,
  itemsPageSchema,
  libraryFreshnessInputSchema,
  libraryFreshnessSchema,
  libraryIndexSchema,
  listItemsInputSchema,
} from './schemas.ts'

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
  signInPersonSchema,
  roleInputSchema,
  assignmentInputSchema,
  grantsSchema,
  applyGrantsSchema,
  grantsAppliedSchema,
} from './auth.ts'
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
import { chatChunkSchema, chatInputSchema, ratingInputSchema, ratingSchema } from './assistant.ts'
import {
  connectInfoSchema,
  tryItInputSchema,
  tryItReadInputSchema,
  tryItReadingSchema,
  tryItSchema,
} from './connect.ts'
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
export type {
  Catalogue,
  CatalogueDefinition,
  CatalogueSource,
  CatalogueTerm,
  CatalogueTermDetail,
  CatalogueValue,
} from './catalogue.ts'
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
      'The proposal, or what AI apps get, changed after you opened it. Look at the latest version, then try again.',
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
/** An administrator ends a person's AI app connection: the reason must hold no sensitive text. */
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
    message: "AI apps don't get any facts yet. Ask an admin to finish the setup.",
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
            "AI apps already get this edition, or some of its facts can't be shared with AI apps again.",
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
          'The AI app sign-in that this browser started, for the consent screen (FR-403); the handle goes in the query',
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
        summary: 'The AI apps connected to Heed as the signed-in person',
      })
      .output(z.array(connectionSchema)),
    disconnect: read
      .route({
        method: 'POST',
        path: '/connections/{id}/disconnect',
        tags: ['session'],
        summary:
          'Disconnect an AI app: its refresh tokens end and the MCP server refuses its access tokens at once',
      })
      .input(connectionIdSchema)
      .output(z.object({ disconnected: z.boolean() })),
  },
  // Every person's AI apps, for administrators (FR-403, FR-807): see them and disconnect them.
  aiConnections: {
    list: admin
      .route({
        method: 'GET',
        path: '/ai-connections',
        tags: ['admin'],
        summary:
          "Every person's AI app connections that are still open: the person, the app as it names itself, what it may do, when it connected, last refreshed and ends",
      })
      .output(z.array(personConnectionSchema)),
    disconnect: aiDisconnect
      .route({
        method: 'POST',
        path: '/ai-connections/{id}/disconnect',
        tags: ['admin'],
        summary:
          "Disconnect one person's AI app with a reason: its refresh tokens end and the MCP server refuses its access tokens at the next request. The history log keeps the reason",
      })
      .input(adminDisconnectSchema)
      .output(adminDisconnectedSchema),
    disconnectPerson: aiDisconnect
      .route({
        method: 'POST',
        path: '/ai-connections/people/{personId}/disconnect',
        tags: ['admin'],
        summary:
          'Disconnect every AI app of one person with one reason, in one step: each connection is its own history entry, with the batch id they share',
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
            'A fact is already in the Bin, or what AI apps get changed. Look at the latest version, then try again.',
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
            "A fact can't be shared with AI apps again, or what AI apps get changed. Look at the latest version, then try again.",
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
  areas: {
    list: read
      .route({ method: 'GET', path: '/areas', tags: ['reference'], summary: 'Domains, by name' })
      .output(z.array(areaSchema)),
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
          message: "AI apps don't get any facts yet. Ask an admin to finish the setup.",
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
          'How the AI apps that called the MCP server fared, per app family and week; small counts hidden (FR-410, FR-614)',
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
          message: "AI apps don't get any facts yet. Ask an admin to finish the setup.",
        },
      })
      .route({
        method: 'POST',
        path: '/try-it',
        tags: ['assistant'],
        summary:
          "What an agent would get: get_context's reply for a scope on the live edition, without a model, recording nothing (FR-602)",
      })
      .input(tryItInputSchema)
      .output(tryItSchema),
    read: read
      .errors({
        PRECONDITION_FAILED: {
          message: "AI apps don't get any facts yet. Ask an admin to finish the setup.",
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
