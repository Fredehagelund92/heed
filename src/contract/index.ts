/**
 * The one place an API operation is described: method, path, input, output, errors and what the
 * caller needs (`scope`). The service implements it, the front end's http binding calls it, and
 * the OpenAPI document is generated from it. Keep this folder free of server code: it imports
 * the domain only.
 */
import { eventIterator, oc } from '@orpc/contract'
import * as z from 'zod/mini'
import { areaSchema, personSchema, vocabularySchema } from '../domain/item.ts'
import {
  definitionRelatedInputSchema,
  deletedDraftSchema,
  draftFromTextInputSchema,
  draftFromTextSchema,
  itemBulkInputSchema,
  itemBulkResultSchema,
  itemChangeSchema,
  itemPageSchema,
  publishItemInputSchema,
  publishItemResultSchema,
  relatedSchema,
  restoreAsDraftInputSchema,
  restoredDraftSchema,
} from './context.ts'
import { libraryIndexSchema } from './schemas.ts'

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
  closeInputSchema,
  closeResultSchema,
  markReadInputSchema,
  publishInputSchema,
  publishReadInputSchema,
  publishReadResultSchema,
  publishResultSchema,
  returnInputSchema,
  returnResultSchema,
  reviewIdInputSchema,
  reviewSheetSchema,
  reviewSheetsInputSchema,
  reviewSheetsSchema,
  undoInputSchema,
  undoResultSchema,
} from './review-path.ts'
import {
  obsAgentsInputSchema,
  obsAgentsSchema,
  obsFeedbackInputSchema,
  obsFeedbackSchema,
  obsSnapshotInputSchema,
  obsSnapshotItemSchema,
  obsSnapshotSchema,
  obsSnapshotsInputSchema,
  obsSnapshotTakeSchema,
  obsSummaryInputSchema,
  obsSummarySchema,
  obsUsageInputSchema,
  obsUsageSchema,
  obsViewRemoveInputSchema,
  obsViewSaveInputSchema,
  obsViewSchema,
} from './observability.ts'
import {
  savedCheckInputSchema,
  savedCheckResultSchema,
  savedChangeSchema,
  savedCreateInputSchema,
  savedIdInputSchema,
  savedListInputSchema,
  savedQuestionSchema,
  savedStatusInputSchema,
  savedStatusSchema,
} from './saved-questions.ts'
import {
  alertMuteInputSchema,
  alertRaisedInputSchema,
  alertRaiseSchema,
  alertRuleRecordSchema,
  alertRulesSchema,
  alertSetRuleInputSchema,
} from './alerts.ts'
import {
  askedSchema,
  lookupEventSchema,
  lookupInputSchema,
  replayInputSchema,
  replaySchema,
} from './answer.ts'
import {
  createProposalSchema,
  proposalRecordSchema,
  proposalIdSchema,
  proposalMutationSchema,
  proposalListSchema,
  proposalListResultSchema,
  withdrawSchema,
  findingSchema,
} from './proposals.ts'

import {
  activeStopSchema,
  editionListSchema,
  editionSchema,
  gateSchema,
  itemReasonSchema,
  reviewProposalSchema,
  rollbackSchema,
  stopSchema,
} from './review.ts'

import {
  importReportSchema,
  importSchema,
  runDetailSchema,
  runIdSchema,
  runListSchema,
  runSchema,
} from './evals.ts'

import {
  meSchema,
  sessionSchema,
  signInMethodSchema,
  signInPersonSchema,
  roleInputSchema,
  assignmentInputSchema,
} from './auth.ts'
import {
  createInvitesSchema,
  inviteIdSchema,
  inviteLookupSchema,
  inviteTokenSchema,
  inviteResentSchema,
  inviteSchema,
  invitesCreatedSchema,
  memberActivityInputSchema,
  memberActivitySchema,
  memberIdSchema,
  memberRemovedSchema,
  memberSchema,
  ownersSetSchema,
  setOwnersSchema,
  setRoleSchema,
  soleOwnerSchema,
} from './members.ts'
import { gapDetailSchema, gapIdInputSchema } from './gaps.ts'
import {
  addSourceSchema,
  connectorListingSchema,
  pausedSourceSchema,
  pauseSourceSchema,
  removedSourceSchema,
  removeSourceSchema,
  sourceActivitySchema,
  sourceCheckSchema,
  sourceReadSchema,
  sourceIdInputSchema,
  sourceRowSchema,
  sourceSettingsSchema,
  testSourceSchema,
  updateSourceSchema,
} from './sources.ts'
import { catalogueSchema } from './catalogue.ts'
import { searchAllInputSchema, searchResultsSchema } from './search.ts'
import { scopeSearchInputSchema, scopeSearchSchema } from './scope.ts'
import {
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
  resolveCommentSchema,
  threadInputSchema,
  toggleReactionResultSchema,
  toggleReactionSchema,
  withdrawCommentSchema,
} from './comments.ts'
import { createReportSchema, myReportsSchema, sentReportSchema } from './reports.ts'
import {
  figureReadSchema,
  figureSourceSchema,
  figureSourcesSchema,
  figureTrySchema,
  readFigureInputSchema,
  setFiguresInputSchema,
  tryFigureInputSchema,
} from './figures.ts'
import { connectInfoSchema, tryItReadInputSchema, tryItReadingSchema } from './connect.ts'
import {
  adminDisconnectedSchema,
  adminDisconnectSchema,
  agentConnectionSchema,
  agentToolInputSchema,
  agentRevokedSchema,
  agentRevokeSchema,
  agentSchema,
  connectDecisionResultSchema,
  connectDecisionSchema,
  connectionIdSchema,
  connectionSchema,
  connectPendingInputSchema,
  connectPendingSchema,
  connectRequestIdSchema,
  connectRequestSchema,
  createAccessKeySchema,
  createdAccessKeySchema,
  renameAccessKeySchema,
} from './connections.ts'
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
  settingSchema,
  workspaceSchema,
  setToolSchema,
  toolSwitchSchema,
} from './admin.ts'
import {
  areaDetailSchema,
  archivedAreaSchema,
  areaHoldingsSchema,
  areaRemovedSchema,
  createAreaSchema,
  describeAreaSchema,
  deleteEmptyAreaSchema,
} from './areas.ts'
import {
  blockedVersionSchema,
  rollbackPreviewInputSchema,
  rollbackPreviewSchema,
} from './editions.ts'
import { operationsOverviewSchema, runJobInputSchema, runJobSchema } from './operations.ts'
import { refusals } from './refusals.ts'
export * from './schemas.ts'
export type { Gap, GapDetail, GapHistoryEntry, GapTest, TopicCounts } from './gaps.ts'
export type {
  AddSourceInput,
  ConnectorListing,
  PauseSourceInput,
  SourceActivity,
  SourceCheck,
  SourceDocumentState,
  SourceHealth,
  SourceReadEntry,
  SourceRow,
  RemoveSourceInput,
  SourceConfig,
  SourceSettings,
  TestSourceInput,
  UpdateSourceInput,
} from './sources.ts'
export { SEARCH_GROUP_MAX } from './search.ts'
export type { SearchAllInput, SearchResults } from './search.ts'
export type { ScopeHit, ScopeSearchInput, ScopeSearchResult } from './scope.ts'
export type {
  Comment as ThreadComment,
  CommentAnchorInput as CommentAnchor,
  Thread,
} from './comments.ts'
export type {
  Catalogue,
  CatalogueDefinition,
  CatalogueSource,
  CatalogueTerm,
  CatalogueValue,
} from './catalogue.ts'
export type {
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
export type { AuditEntry, ClientPolicy, ItemImportReport, Setting, SettingKey } from './admin.ts'
export type { AreaDetail, AreaHoldings, AreaRemoved, ArchivedArea } from './areas.ts'
export type { OperationsOverviewView } from './operations.ts'
export type { ConnectInfo, TryItReading, TryItReadInput } from './connect.ts'
export type { HeldRole, PeopleRoleFilter, PeopleSignInFilter, PersonStatus } from './people.ts'

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
const agentDisconnect = admin.errors({
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
    submit: proposal
      .route({ method: 'POST', path: '/proposals/{id}/submit', tags: ['proposals'] })
      .input(proposalMutationSchema)
      .output(proposalRecordSchema),
    withdraw: proposal
      .route({ method: 'POST', path: '/proposals/{id}/withdraw', tags: ['proposals'] })
      .input(withdrawSchema)
      .output(proposalRecordSchema),
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
    sheets: review
      .route({
        method: 'POST',
        path: '/review/sheets',
        tags: ['review'],
        summary:
          "The review page's read for many suggestions in one call, as the Inbox lists them: each sheet in the order asked, leaving out one that went or the person may not read",
      })
      .input(reviewSheetsInputSchema)
      .output(reviewSheetsSchema),
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
    close: review
      .route({
        method: 'POST',
        path: '/review/{id}/close',
        tags: ['review'],
        summary:
          'Closes a suggestion to archive that its sender took back in the comments: nothing changes, and the context item stays live; answers with a token that undoes it',
      })
      .input(closeInputSchema)
      .output(closeResultSchema),
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
    proposeRetirement: review
      .route({
        method: 'POST',
        path: '/items/{id}/retire-proposals',
        tags: ['review'],
        summary:
          'Suggest that a context item is archived, with a reason (FR-112); its owners review it like any suggestion',
      })
      .input(itemReasonSchema)
      .output(reviewProposalSchema),
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
  agentConnections: {
    list: admin
      .route({
        method: 'GET',
        path: '/agent-connections',
        tags: ['admin'],
        summary:
          "Every person's agent connections that are still open: the person, the app as it names itself, what it may do, when it connected, last refreshed and ends; and every access key not revoked, with who made it, when, and when it was last used",
      })
      .output(z.array(agentConnectionSchema)),
    disconnect: agentDisconnect
      .route({
        method: 'POST',
        path: '/agent-connections/{id}/disconnect',
        tags: ['admin'],
        summary:
          "Disconnect one person's agent, or revoke an access key, with a reason: its refresh tokens end, or the key stops working, and the MCP server refuses it at the next request. The history log keeps the reason",
      })
      .input(adminDisconnectSchema)
      .output(adminDisconnectedSchema),
  },
  // Access keys, for administrators: a key for a bot or a scheduled job that can't sign in.
  accessKeys: {
    create: admin
      .route({
        method: 'POST',
        path: '/access-keys',
        tags: ['admin'],
        summary:
          'Create an access key with a name, for a bot or a scheduled job that cannot sign in: it may read context and give feedback, names no person, and lasts until revoked. The key is in this answer only; it is kept as a digest and never shown again',
      })
      .input(createAccessKeySchema)
      .output(createdAccessKeySchema),
  },
  // Every agent with its name, kind and what it may do (FR-420): everyone sees their own, an
  // administrator every agent, and only an administrator changes what one may do.
  agents: {
    list: read
      .route({
        method: 'GET',
        path: '/agents',
        tags: ['session'],
        summary:
          'The agents that may reach context: the apps people signed in with and the access keys, each with its name, its kind, every tool with whether it is switched on for this agent and whether the agent may have it, and what it suggested lately. An administrator sees every agent; anyone else their own apps',
      })
      .output(z.array(agentSchema)),
    rename: admin
      .route({
        method: 'POST',
        path: '/agents/{id}/name',
        tags: ['admin'],
        summary:
          'Rename an access key, by its agent; the history log keeps the name before and after. An app keeps the name it gives itself',
      })
      .input(renameAccessKeySchema)
      .output(changed),
    setTool: agentDisconnect
      .route({
        method: 'POST',
        path: '/agents/{id}/tools',
        tags: ['admin'],
        summary:
          "Switch one tool on or off for one agent. It acts at the agent's next request and never widens what a person allowed; an access key never gets suggest_context. The history log keeps the reason",
      })
      .input(agentToolInputSchema)
      .output(changed),
    revoke: read
      .errors({
        UNPROCESSABLE_CONTENT: {
          status: 422,
          message: 'Remove the email address, phone number or secret from the reason.',
          data: z.optional(z.object({ findings: z.array(findingSchema) })),
        },
      })
      .route({
        method: 'POST',
        path: '/agents/{id}/revoke',
        tags: ['session'],
        summary:
          'End one agent at once: every connection of an app, or an access key. An administrator ends any agent with a reason the history log keeps; anyone else their own apps',
      })
      .input(agentRevokeSchema)
      .output(agentRevokedSchema),
  },
  roles: {
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
  items: {
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
    related: read
      .route({
        method: 'GET',
        path: '/definitions/related',
        tags: ['library'],
        summary:
          'Context related to a metric or a dimension, one step away, as get_related follows it: what people see in Related',
      })
      .errors(notFound)
      .input(definitionRelatedInputSchema)
      .output(relatedSchema),
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
    deleteEmpty: areaRemovalRoute
      .route({
        method: 'POST',
        path: '/areas/{id}/delete',
        tags: ['admin'],
        summary:
          "Delete a domain from its page (FR-815): only one with no context and no terms, never the sandbox. Its open suggestions are withdrawn, its drafts stay with their authors, its owners' ownership ends; one that history names is kept as history",
      })
      .errors({
        NOT_FOUND: { message: "We couldn't find this domain. Someone may have deleted it." },
      })
      .input(deleteEmptyAreaSchema)
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
  },
  gaps: {
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
  },
  sources: {
    // Settings › Integrations: every source, the server's own and those an admin added, with how
    // each is and what it holds (CON-104, CON-115).
    list: admin
      .route({
        method: 'GET',
        path: '/sources',
        tags: ['sources'],
        summary:
          'Every source: its connector, how it is, when it was read and is read next, and what it holds',
      })
      .output(z.array(sourceRowSchema)),
    activity: admin
      .errors({
        NOT_FOUND: { message: "We couldn't find this source." },
      })
      .route({
        method: 'GET',
        path: '/sources/{id}/activity',
        tags: ['sources'],
        summary:
          "A source's reads, newest first, what it reads with the domain each part maps to, and its documents read most recently",
      })
      .input(sourceIdInputSchema)
      .output(sourceActivitySchema),
    pause: admin
      .errors({
        NOT_FOUND: { message: "We couldn't find this source." },
      })
      .route({
        method: 'PUT',
        path: '/sources/{id}/paused',
        tags: ['sources'],
        summary: 'Pause reading a source, or let it go on, with a reason (CON-115)',
      })
      .input(pauseSourceSchema)
      .output(pausedSourceSchema),
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
    // Read again (CON-115): one source read now, at the job's next turn, whatever its schedule.
    read: admin
      .errors({
        NOT_FOUND: { message: "We couldn't find this source." },
        CONFLICT: { message: 'This source is switched off. Switch it on to read it.' },
        SERVICE_UNAVAILABLE: {
          message: "The job runner isn't running. Ask the data team to start it.",
        },
      })
      .route({
        method: 'POST',
        path: '/sources/{id}/read',
        successStatus: 202,
        tags: ['sources'],
        summary: 'Read one source now, whatever its schedule (Read again)',
      })
      .input(sourceIdInputSchema)
      .output(sourceReadSchema),
    // Disconnect (CON-118): read no more, its secrets removed, its open suggestions withdrawn.
    remove: admin
      .errors({
        NOT_FOUND: { message: "We couldn't find this source among the ones an admin added." },
      })
      .route({
        method: 'POST',
        path: '/sources/{id}/disconnect',
        tags: ['sources'],
        summary:
          'Disconnect a source an administrator added, with a reason: it is read no more, its secrets are removed and its open suggestions withdrawn; what it read stays',
      })
      .input(removeSourceSchema)
      .output(removedSourceSchema),
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
    activity: read
      .route({
        method: 'GET',
        path: '/members/{personId}/activity',
        tags: ['roles'],
        summary:
          'What someone did lately, as People shows it: the context items they checked last, newest first, of those the reader may read',
      })
      .input(memberActivityInputSchema)
      .output(memberActivitySchema),
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
  },
  inbox: {
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
    withdraw: commentWrite
      .route({
        method: 'POST',
        path: '/comments/{id}/withdraw',
        tags: ['comments'],
        summary:
          "Marks one's own comment on a suggestion to archive, while it waits, as taking it back, or takes the mark back: its owners see it in the review and close it or archive anyway",
      })
      .input(withdrawCommentSchema)
      .output(threadCommentSchema),
    resolve: commentWrite
      .route({
        method: 'POST',
        path: '/comments/{id}/resolve',
        tags: ['comments'],
        summary: 'Resolves a thread on a line or a field of a suggestion, or opens it again',
      })
      .input(resolveCommentSchema)
      .output(threadCommentSchema),
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
  evals: {
    questions: {
      import: maintain
        .route({
          method: 'POST',
          path: '/evals/import',
          tags: ['evals'],
          summary: 'Import a YAML or JSON file of test questions; a dry run by default (FR-504)',
        })
        .input(importSchema)
        .output(importReportSchema),
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
  },
  workspace: {
    get: read
      .route({
        method: 'GET',
        path: '/workspace',
        tags: ['session'],
        summary:
          "The workspace's name, which an admin sets (workspace.name), for everyone signed in (FR-818)",
      })
      .output(workspaceSchema),
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
    pending: read
      .route({
        method: 'GET',
        path: '/connect/pending',
        tags: ['session'],
        summary:
          "Connect an agent's live line (FR-418): whether the signed-in person's own agent signed in, or they declined it in the browser, since a moment; the newest of the two, with the agent's own name",
      })
      .input(connectPendingInputSchema)
      .output(connectPendingSchema),
  },
  tryIt: {
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
  figures: {
    list: read
      .route({
        method: 'GET',
        path: '/figures',
        tags: ['sources'],
        summary:
          'The integrations that can read a figure for Ask (FR-716, CON-612): whether Show figures in Ask is on (off by default) and the data contact; for administrators also the data endpoint, its declared host and whether its token is set, never the token',
      })
      .output(figureSourcesSchema),
    set: sourceSettings
      .errors({
        NOT_FOUND: { message: "We couldn't find this integration, or it doesn't read figures." },
      })
      .route({
        method: 'PUT',
        path: '/figures/{id}',
        tags: ['sources'],
        summary:
          "Change an integration's figures settings: Show figures in Ask, the data endpoint, its token (kept in the secret store, sent only to the endpoint's origin, and forgotten when the scheme, host or port changes) and the data contact; switching figures on needs all three. Recorded in the history log, never the token",
      })
      .input(setFiguresInputSchema)
      .output(figureSourceSchema),
    read: read
      .errors({
        UNPROCESSABLE_CONTENT: {
          status: 422,
          message: 'Check the days: the last one comes after the first.',
          data: z.optional(z.object({ findings: z.array(findingSchema) })),
        },
      })
      .route({
        method: 'POST',
        path: '/figures/read',
        tags: ['sources'],
        summary:
          "One figure for an answer in Ask, from the integration the metric's definition comes from, for the days and values asked, compared with the days just before, within 4 seconds; a link into the tool while figures are off; or why there is none. Kept nowhere, and no person's identity is passed on",
      })
      .input(readFigureInputSchema)
      .output(figureReadSchema),
    try: admin
      .errors({
        NOT_FOUND: { message: "We couldn't find this integration, or it doesn't read figures." },
      })
      .route({
        method: 'POST',
        path: '/figures/{id}/try',
        tags: ['sources'],
        summary:
          "Try a figure: one measure of the integration's first view with a single date, for the last 7 days, read with the figures settings as they are saved and the same 4 second limit as Ask, whether Show figures in Ask is on or off. The value and when the data is from, or a failure code; kept nowhere, and no person's identity is passed on",
      })
      .input(tryFigureInputSchema)
      .output(figureTrySchema),
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
          "A question looked up on the live edition as get_context answers it, with no model: each step as it is done, then the answer with its state; or a question about the context's own records, answered from what the person may see, with no answer state; the question is never stored (FR-602)",
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
    summary: maintainRead
      .route({
        method: 'GET',
        path: '/observability/summary',
        tags: ['quality'],
        summary:
          "Summary's read: the last whole calendar month or quarter, what agents asked and how it was answered against the period before, a weekly trend, what is still open and what changed; counts only, one disclosure pass, small counts hidden (FR-614, FR-620)",
      })
      .input(obsSummaryInputSchema)
      .output(obsSummarySchema),
    snapshots: {
      list: maintainRead
        .route({
          method: 'GET',
          path: '/observability/snapshots',
          tags: ['quality'],
          summary: "Summary's monthly snapshots a reader may open, the latest first (FR-620)",
        })
        .input(obsSnapshotsInputSchema)
        .output(z.array(obsSnapshotItemSchema)),
      get: maintainRead
        .route({
          method: 'GET',
          path: '/observability/snapshots/{id}',
          tags: ['quality'],
          summary:
            'One monthly snapshot as taken: disclosed counts and their sentences only (FR-612)',
        })
        .input(obsSnapshotInputSchema)
        .output(obsSnapshotSchema),
      take: admin
        .route({
          method: 'POST',
          path: '/observability/snapshots',
          tags: ['quality'],
          summary: "Take the last whole month's snapshots now, as the nightly job does (admins)",
        })
        .output(obsSnapshotTakeSchema),
    },
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
  savedQuestions: {
    list: read
      .route({
        method: 'GET',
        path: '/saved-questions',
        tags: ['quality'],
        summary:
          "The saved questions of the domains the person owns, every domain's for an administrator, newest first, each with what it should keep getting and its last check (FR-526); anyone else gets none",
      })
      .input(savedListInputSchema)
      .output(z.array(savedQuestionSchema)),
    create: maintainRead
      .errors({
        PRECONDITION_FAILED: {
          message: "Agents don't get any context yet, so there is no answer to keep.",
        },
      })
      .route({
        method: 'POST',
        path: '/saved-questions',
        tags: ['quality'],
        summary:
          "Save a question for a domain, with the person's name: what the answer engine gives it now becomes what it should keep getting, checked after every change; for the domain's owners and administrators",
      })
      .input(savedCreateInputSchema)
      .output(savedChangeSchema),
    remove: maintainRead
      .route({
        method: 'DELETE',
        path: '/saved-questions/{id}',
        tags: ['quality'],
        summary: "Remove a saved question; for its domain's owners and administrators",
      })
      .input(savedIdInputSchema)
      .output(z.object({ removed: z.boolean() })),
    keep: maintainRead
      .errors({
        CONFLICT: { message: 'It already answers as saved. There is no new answer to keep.' },
      })
      .route({
        method: 'POST',
        path: '/saved-questions/{id}/keep',
        tags: ['quality'],
        summary:
          "Keep the new answer: what a saved question gets now becomes what it should keep getting; Undo takes it back; for its domain's owners and administrators",
      })
      .input(savedIdInputSchema)
      .output(savedChangeSchema),
    check: maintainRead
      .errors({
        PRECONDITION_FAILED: {
          message: "Agents don't get any context yet, so there is nothing to check.",
        },
      })
      .route({
        method: 'POST',
        path: '/saved-questions/check',
        tags: ['quality'],
        summary:
          "Check now: every saved question the person manages, or one domain's, answered again on what agents get, with no model, counting as it goes; nothing is published and nothing waits on it (FR-526)",
      })
      .input(savedCheckInputSchema)
      .output(savedCheckResultSchema),
    status: read
      .route({
        method: 'GET',
        path: '/saved-questions/status',
        tags: ['quality'],
        summary:
          'How far the newest check run got, when the saved questions were last checked, and how many answered as saved each of the last eight weeks',
      })
      .input(savedStatusInputSchema)
      .output(savedStatusSchema),
  },
  alerts: {
    rules: maintainRead
      .route({
        method: 'GET',
        path: '/alerts/rules',
        tags: ['quality'],
        summary:
          'The eight alert rules, each on or off with its threshold, the domains the person muted it for, and its newest raise they may read (FR-621); for administrators and owners',
      })
      .output(alertRulesSchema),
    setRule: admin
      .errors({
        UNPROCESSABLE_CONTENT: { message: "This rule's sentence doesn't offer that threshold." },
      })
      .route({
        method: 'POST',
        path: '/alerts/rules/{rule}',
        tags: ['quality'],
        summary:
          'Turn an alert rule on or off for everyone, or set its threshold from those its sentence offers; for administrators',
      })
      .input(alertSetRuleInputSchema)
      .output(alertRuleRecordSchema),
    mute: maintainRead
      .errors({
        UNPROCESSABLE_CONTENT: {
          message: "This rule's cards go only to admins, so there is nothing to mute.",
        },
      })
      .route({
        method: 'POST',
        path: '/alerts/rules/{rule}/mute',
        tags: ['quality'],
        summary:
          "Mute an alert rule for domains the person owns, or unmute it: its cards stop reaching them there and still reach the domain's other owners and the administrators",
      })
      .input(alertMuteInputSchema)
      .output(alertRuleRecordSchema),
    raised: maintainRead
      .route({
        method: 'GET',
        path: '/alerts/raised',
        tags: ['quality'],
        summary:
          'What the alert rules raised lately, newest first, each with whom its Inbox card reached: every raise for an administrator, those about their own domains for an owner; counts and scopes only (FR-614)',
      })
      .input(alertRaisedInputSchema)
      .output(z.array(alertRaiseSchema)),
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
