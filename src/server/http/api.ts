import { createHash, randomBytes } from 'node:crypto'
import { fallbackORPCErrorMessage, onError, ORPCError } from '@orpc/client'
import { SmartCoercionPlugin } from '@orpc/json-schema'
import { OpenAPIGenerator } from '@orpc/openapi'
import { OpenAPIHandler } from '@orpc/openapi/fastify'
import { implement, ValidationError } from '@orpc/server'
import { ZodToJsonSchemaConverter } from '@orpc/zod/zod4'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { API_PREFIX, contract } from '../../contract/index.ts'
import { refusalOfCode, refusals } from '../../contract/refusals.ts'
import { forRequest, type Database } from '../db/database.ts'
import type { Clock } from '../clock.ts'
import {
  createProposalsService,
  retryWrite,
  previewProposal,
  type ProposalsService,
} from '../modules/proposals/index.ts'
import {
  archivedAreas,
  areaRemoval,
  createArea,
  createAreasService,
  deleteEmptyArea,
  describeArea,
  getArea,
  removeArea,
  restoreArea,
  updateArea,
} from '../modules/areas/index.ts'
import {
  activeStops,
  compareEditions,
  compareItem,
  diffEditions,
  editionFeed,
  listEditions,
  rollbackPreview,
  rollbackTo,
  setStop,
} from '../modules/editions/index.ts'
import { createEvalsService } from '../modules/evals/index.ts'
import {
  exportAudit,
  exportEdition,
  importItems,
  knownTools,
  listClients,
  listSettings,
  listTools,
  plainReason,
  readWorkspace,
  saveClient,
  searchAudit,
  setSetting,
  setTool,
  settingHistory,
  trafficSummary,
  verifyAudit,
} from '../modules/admin/index.ts'
import { operationsView, type JobRunner } from '../modules/jobs/index.ts'
import { ITEM_FILE_MAX_LENGTH } from '../../domain/item-file.ts'
import { TERM_BATCH_BODY_MAX } from '../../contract/review.ts'
import { itemJsonSchema } from '../../domain/item-version.ts'
import { checkModelSetting, type ModelPort } from '../modules/models/index.ts'
import { labelOperation } from '../observability/metrics.ts'
import { createLimiter } from './rate-limit.ts'
import { connectInfo, readTryItQuestion } from '../modules/agents/index.ts'
import {
  askedThisWeek,
  createBundleCache,
  lookupQuestion,
  planWords,
  reachOfDraft,
  replayTopic,
  tryItRun,
  wordsInputOf,
  writeWords,
} from '../modules/answer/index.ts'
import {
  createDomainCache,
  prepareTurn,
  rateAnswer,
  ratingsPerMinute,
} from '../modules/assistant/index.ts'
import {
  createBinService,
  createReviewPath,
  createReviewService,
  type ReviewService,
} from '../modules/review/index.ts'
import { createContextService } from '../modules/context/index.ts'
import { createTermsService } from '../modules/terms/index.ts'
import { createInboxFeedService } from '../modules/inbox/index.ts'
import { createCommentsService } from '../modules/comments/index.ts'
import { createReportsService } from '../modules/reports/index.ts'
import {
  can,
  checkMutation,
  applyGrants,
  createInvites,
  listInvites,
  listMembers,
  lookupInvite,
  type OidcSignIn,
  removeMember,
  resendInvite,
  restoreMember,
  revokeInvite,
  setMemberRole,
  setOwners,
  changeGrant,
  listGrants,
  cookieAge,
  sessionCookie,
  createPeopleService,
  personSheet,
  type SignIn,
} from '../modules/auth/index.ts'
import { createAlertsService } from '../modules/alerts/index.ts'
import { createCatalogueService } from '../modules/catalogue/index.ts'
import {
  createSourcesService,
  createWorkspaceSources,
  noSecretStore,
  ConnectorRegistry,
  type TransactionHooks,
  type WorkspaceSources,
} from '../modules/connectors/index.ts'
import { createGapsService, gapReportsPerMinute } from '../modules/gaps/index.ts'
import { createLibraryService } from '../modules/library/index.ts'
import { createQualityService } from '../modules/quality/index.ts'
import { createObservabilityService } from '../modules/observability/index.ts'
import {
  adoptPublished,
  createSavedQuestionsService,
  runCheck,
} from '../modules/saved-questions/index.ts'
import { createVocabularyService } from '../modules/vocabulary/index.ts'
import type { LoginServer } from '../modules/oauth/index.ts'
import type { PageReader } from '../modules/web/index.ts'
import type { HelpLibrary } from '../modules/help/index.ts'
import {
  createActivityService,
  createInboxService,
  streamEvents,
  type Hub,
} from '../modules/notifications/index.ts'
import { productName } from '../brand.ts'

export interface ApiServices {
  signIn: SignIn
  database: Database
  clock: Clock
  origins: readonly string[]
  /** Wakes the live event streams. */
  hub: Hub
  /** The language model port for evaluations and the assistant (the mock unless MODELS=live). */
  models: ModelPort
  /** The MCP server's public address (`MCP_RESOURCE_URL`); null when this app serves no MCP. */
  mcpAddress?: string | null
  /** The built-in login server for agents; without it there is nothing to approve or list. */
  login?: LoginServer
  /** The scheduled jobs, for the operations view and manual runs (FR-810). */
  jobs: Pick<JobRunner, 'overview' | 'runNow'>
  /** The definition sources this server reads, for how each is configured (Sources). */
  sources?: Pick<ConnectorRegistry, 'list'>
  /** The sources administrators add, with the secret store that keeps their tokens. */
  workspaceSources?: WorkspaceSources
  /** Opens a web page for the assistant's read_source; the public web only by default. */
  readPage?: PageReader
  /** Heed's help pages for the assistant's search_help; this checkout's pages by default. */
  help?: HelpLibrary
}
type RequestContext = { request: FastifyRequest; reply: FastifyReply }
/** A retry key of 128 random bits: 32 hex digits (the web binding's) or a version 4 UUID. */
const randomRetryKey =
  /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i
const idempotencyKey = (context: RequestContext) =>
  context.request.headers['idempotency-key'] as string | undefined

export function createRouter({
  database,
  signIn,
  clock,
  origins,
  hub,
  models,
  mcpAddress = null,
  login,
  jobs,
  sources,
  workspaceSources = createWorkspaceSources({
    secrets: noSecretStore,
    registry: new ConnectorRegistry([...(sources?.list() ?? [])]),
  }),
  readPage,
  help,
}: ApiServices) {
  // A new secret per process: a confirmation or a sealed tool result outlives no restart, and
  // fails closed after one.
  const approvalSecret = randomBytes(32)
  const assistantDomains = createDomainCache()
  const limitGapReports = createLimiter(() => clock.now())
  const limitRatings = createLimiter(() => clock.now())
  // The editions the answer engine reads, kept a short while: one for every person.
  const answerBundles = createBundleCache()
  const os = implement(contract).$context<RequestContext>()
  const authorized = os.use(async ({ context, next, path }) => {
    // Work outside the database that must follow the transaction's outcome, such as a secret
    // file written for a source: kept on commit, removed on rollback.
    const committed: (() => Promise<void>)[] = []
    const rolledBack: (() => Promise<void>)[] = []
    const hooks: TransactionHooks = {
      onCommit: (work) => void committed.push(work),
      onRollback: (work) => void rolledBack.push(work),
    }
    const settle = async (works: (() => Promise<void>)[]) => {
      for (const work of works)
        await work().catch((error: unknown) =>
          // Names the failure only: the hooks handle secrets, so no detail is logged.
          context.request.log.error(
            { error: error instanceof Error ? error.name : 'unknown' },
            'work after the transaction failed',
          ),
        )
    }
    let result
    try {
      result = await database.transaction(
        null,
        async (tx) => {
          const session = await signIn.currentSession(tx, context.request.headers.cookie)
          const operation = path.join('.')
          labelOperation(context.request, operation)
          if (!can(session?.person ?? null, operation))
            throw new ORPCError(session ? 'FORBIDDEN' : 'UNAUTHORIZED')
          if (!['GET', 'HEAD', 'OPTIONS'].includes(context.request.method)) {
            checkMutation(context.request, session, origins, operation === 'auth.signIn')
          }
          await tx.query("select set_config('cl.person_id',$1,true)", [session?.person.id ?? ''])
          const proposals = createProposalsService(tx, clock, session?.person.id ?? '')
          const review = createReviewService(tx, clock)
          const gaps = createGapsService(tx, clock, session?.person.id ?? '')
          const comments = createCommentsService(tx)
          const reviewPath = createReviewPath(
            tx,
            clock,
            answerBundles,
            review,
            (id) => proposals.get(id),
            comments,
          )
          const library = createLibraryService(tx, clock)
          return next({
            context: {
              tx,
              session,
              library,
              context: createContextService(tx, clock, answerBundles, {
                library,
                proposals,
                review,
                path: reviewPath,
                readPage,
              }),
              catalogue: createCatalogueService(tx, clock),
              terms: createTermsService(tx),
              areas: createAreasService(tx),
              people: createPeopleService(tx),
              vocabulary: createVocabularyService(tx),
              proposals,
              review,
              path: reviewPath,
              cards: createInboxFeedService(tx, clock, answerBundles, {
                review,
                path: reviewPath,
                gaps,
                comments,
              }),
              comments,
              reports: createReportsService(tx),
              bin: createBinService(tx, clock, proposals),
              inbox: createInboxService(tx),
              activity: createActivityService(tx),
              gaps,
              sources: createSourcesService(tx),
              evals: createEvalsService(tx, { port: models, clock }),
              quality: createQualityService(tx, clock),
              observability: createObservabilityService(tx, clock),
              saved: createSavedQuestionsService(tx, clock, answerBundles),
              alerts: createAlertsService(tx),
              hooks,
            },
          })
        },
        { requestId: context.request.id },
      )
    } catch (error) {
      await settle(rolledBack)
      throw error
    }
    await settle(committed)
    return result
  })
  /** Submit runs the review engine's level 2 and 3 checks at once, on every channel. */
  const submitForReview =
    (context: { proposals: ProposalsService; review: ReviewService }) =>
    async (id: string, revision: number) => {
      const submitted = await context.proposals.submit(id, revision)
      await context.review.checkSubmitted(submitted.id)
      return submitted
    }
  /**
   * After a publish from the review commits, the saved questions it moved take what they say now
   * as their saved answer (FR-526), apart from the publish: a failure is logged, never the
   * publish's.
   */
  const adoptAfterCommit = (
    context: RequestContext & {
      hooks: TransactionHooks
      session: { person: { id: string } } | null
    },
    itemIds: string[],
  ) => {
    const person = context.session?.person.id
    if (!person || !itemIds.length) return
    context.hooks.onCommit(async () => {
      await adoptPublished(
        forRequest(database, context.request.id),
        clock,
        answerBundles,
        person,
        itemIds,
      )
    })
  }
  const webOrigin = (request: FastifyRequest) =>
    origins[0] ?? new URL(`${request.protocol}://${request.headers.host}`).origin
  const found = <T>(value: T | null): T => {
    if (value === null) throw new ORPCError('NOT_FOUND')
    return value
  }
  return authorized.router({
    proposals: {
      create: authorized.proposals.create.handler(({ context, input }) =>
        retryWrite(
          context.tx,
          context.request.headers['idempotency-key'] as string | undefined,
          'proposals.create',
          input,
          () => context.proposals.create(input),
        ),
      ),
      list: authorized.proposals.list.handler(({ context, input }) =>
        context.proposals.list(input),
      ),
      get: authorized.proposals.get.handler(({ context, input }) =>
        context.proposals.read(input.id),
      ),
      saveDraft: authorized.proposals.saveDraft.handler(({ context, input }) =>
        context.proposals.save(input.id, input.revision, input.draft, input.reason),
      ),
      submit: authorized.proposals.submit.handler(({ context, input }) =>
        retryWrite(
          context.tx,
          context.request.headers['idempotency-key'] as string | undefined,
          'proposals.submit',
          input,
          () => submitForReview(context)(input.id, input.revision),
        ),
      ),
      claim: authorized.proposals.claim.handler(({ context, input }) =>
        context.proposals.claim(input.id, input.revision),
      ),
      handOver: authorized.proposals.handOver.handler(({ context, input }) =>
        context.proposals.claim(input.id, input.revision, input.personId),
      ),
      withdraw: authorized.proposals.withdraw.handler(({ context, input }) =>
        context.proposals.withdraw(input.id, input.revision, input.reason),
      ),
      discard: authorized.proposals.discard.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'proposals.discard', input, () =>
          context.proposals.discard(input.id, input.revision),
        ),
      ),
      comment: authorized.proposals.comment.handler(({ context, input }) =>
        retryWrite(
          context.tx,
          context.request.headers['idempotency-key'] as string | undefined,
          'proposals.comment',
          input,
          () => context.proposals.comment(input.id, input.revision, input.text, input.replyTo),
        ),
      ),
      events: authorized.proposals.events.handler(({ context, input }) =>
        context.proposals.events(input.id),
      ),
      overlap: authorized.proposals.overlap.handler(({ context, input }) =>
        context.proposals.overlap(input.id),
      ),
      preview: authorized.proposals.preview.handler(async ({ context, input }) =>
        previewProposal(context.tx, clock, await context.proposals.get(input.id), input),
      ),
      tests: authorized.proposals.tests.handler(({ context, input }) =>
        context.proposals.tests(input.id),
      ),
      attachTest: authorized.proposals.attachTest.handler(({ context, input }) =>
        context.proposals.attachTest(input.id, input.question),
      ),
      detachTest: authorized.proposals.detachTest.handler(({ context, input }) =>
        context.proposals.detachTest(input.id, input.question),
      ),
    },
    review: {
      sheet: authorized.review.sheet.handler(({ context, input }) => context.path.sheet(input.id)),
      markRead: authorized.review.markRead.handler(({ context, input }) =>
        context.path.markRead(input),
      ),
      publish: authorized.review.publish.handler(async ({ context, input }) => {
        const published = await retryWrite(
          context.tx,
          idempotencyKey(context),
          'review.publish',
          input,
          () => context.path.publish(input),
        )
        if (published.proposal.action !== 'retire' && published.proposal.itemId)
          adoptAfterCommit(context, [published.proposal.itemId])
        return published
      }),
      return: authorized.review.return.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.return', input, () =>
          context.path.returnWithNote(input),
        ),
      ),
      publishRead: authorized.review.publishRead.handler(async ({ context, input }) => {
        const done = await retryWrite(
          context.tx,
          idempotencyKey(context),
          'review.publishRead',
          input,
          () => context.path.publishRead(input.ids),
        )
        const items = await context.tx.query<{ id: string }>(
          `select item_id as id from proposals
            where id = any($1::uuid[]) and action <> 'retire' and item_id is not null`,
          [done.published.map((p) => p.id)],
        )
        adoptAfterCommit(
          context,
          items.map((i) => i.id),
        )
        return done
      }),
      queue: authorized.review.queue.handler(({ context, input }) => context.review.queue(input)),
      get: authorized.review.get.handler(({ context, input }) => context.review.get(input.id)),
      runChecks: authorized.review.runChecks.handler(({ context, input }) =>
        context.review.runChecks(input.id),
      ),
      edit: authorized.review.edit.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.edit', input, () =>
          context.review.edit(input),
        ),
      ),
      decide: authorized.review.decide.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.decide', input, () =>
          context.review.decide(input),
        ),
      ),
      planDecisions: authorized.review.planDecisions.handler(({ context, input }) =>
        context.review.planDecisions(input),
      ),
      decideMany: authorized.review.decideMany.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.decideMany', input, () =>
          context.review.decideMany(input),
        ),
      ),
      assign: authorized.review.assign.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.assign', input, () =>
          context.proposals.assignMany(input.proposals, input.personId),
        ),
      ),
      retire: authorized.review.retire.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.retire', input, () =>
          context.review.retire(input.id, input.reason),
        ),
      ),
      proposeRetirement: authorized.review.proposeRetirement.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.proposeRetirement', input, () =>
          context.review.proposeRetirement(input.id, input.reason),
        ),
      ),
      recheck: authorized.review.recheck.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'review.recheck', input, () =>
          context.review.recheck(input.id, input.reason),
        ),
      ),
    },
    editions: {
      list: authorized.editions.list.handler(({ context, input }) =>
        listEditions(context.tx, input.limit, input.offset),
      ),
      diff: authorized.editions.diff.handler(({ context, input }) =>
        diffEditions(context.tx, input.label, input.against),
      ),
      feed: authorized.editions.feed.handler(({ context, input }) =>
        editionFeed(context.tx, input),
      ),
      compare: authorized.editions.compare.handler(({ context, input }) =>
        compareEditions(context.tx, input),
      ),
      compareItem: authorized.editions.compareItem.handler(({ context, input }) =>
        compareItem(context.tx, input),
      ),
      export: authorized.editions.export.handler(({ context, input }) =>
        exportEdition(context.tx, input.label),
      ),
      rollback: authorized.editions.rollback.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'editions.rollback', input, () =>
          rollbackTo(context.tx, input.label, input.note),
        ),
      ),
      rollbackPreview: authorized.editions.rollbackPreview.handler(({ context, input }) =>
        rollbackPreview(context.tx, input.label),
      ),
    },
    serving: {
      stops: authorized.serving.stops.handler(async ({ context }) => {
        const stops = await activeStops(context.tx)
        if (context.session!.person.permissions.roles.includes('administrator')) return stops
        // Everyone else gets only what the banner says: what is stopped, since when and why.
        return stops.map(({ at, scope, areaId, itemId, reason }) => ({
          at,
          scope,
          areaId,
          itemId,
          reason,
        }))
      }),
      setStop: authorized.serving.setStop.handler(({ context, input }) =>
        setStop(context.tx, input),
      ),
    },
    auth: {
      methods: authorized.auth.methods.handler(() =>
        signIn.method === 'oidc'
          ? {
              method: 'oidc' as const,
              name: (signIn as OidcSignIn).label,
              start: `${API_PREFIX}/auth/oidc/start`,
            }
          : { method: signIn.method, name: null, start: null },
      ),
      people: authorized.auth.people.handler(({ context }) => signIn.choices(context.tx)),
      signIn: authorized.auth.signIn.handler(async ({ context, input }) => {
        const login = await signIn.signIn(
          context.tx,
          input.email.toLowerCase(),
          context.request.headers.cookie,
        )
        if (!login) throw new ORPCError('UNAUTHORIZED')
        context.reply.header(
          'set-cookie',
          sessionCookie(
            login.token,
            context.request.protocol === 'https',
            cookieAge(signIn.lifetime),
          ),
        )
        return login.session
      }),
      signOut: authorized.auth.signOut.handler(async ({ context }) => {
        await signIn.signOut(context.tx, context.request.headers.cookie)
        context.reply.header(
          'set-cookie',
          sessionCookie('', context.request.protocol === 'https', 0),
        )
        return { signedOut: true }
      }),
      session: authorized.auth.session.handler(({ context }) => context.session!),
    },
    connections: {
      // A sign-in another browser started, or one that ended, answers like one that never was.
      request: authorized.connections.request.handler(async ({ context, input }) =>
        found(
          (await login?.describeRequest(context.tx, context.request.headers.cookie, input.id)) ??
            null,
        ),
      ),
      decide: authorized.connections.decide.handler(async ({ context, input }) =>
        found(
          (await login?.decide(
            context.tx,
            context.request.headers.cookie,
            context.session!.person.id,
            input.id,
            input.allow,
            context.request.log,
          )) ?? null,
        ),
      ),
      list: authorized.connections.list.handler(
        async ({ context }) =>
          (await login?.connections(context.tx, context.session!.person.id)) ?? [],
      ),
      disconnect: authorized.connections.disconnect.handler(async ({ context, input }) => {
        const done = await login?.disconnect(
          context.tx,
          context.session!.person.id,
          input.id,
          context.request.log,
        )
        if (!done)
          throw new ORPCError('NOT_FOUND', {
            message: "We couldn't find this connection. It may be disconnected already.",
          })
        return { disconnected: true }
      }),
    },
    agentConnections: {
      list: authorized.agentConnections.list.handler(
        async ({ context }) => (await login?.everyConnection(context.tx)) ?? [],
      ),
      disconnect: authorized.agentConnections.disconnect.handler(async ({ context, input }) => {
        plainReason(input.reason)
        const ended = await login?.disconnectAsAdmin(
          context.tx,
          { id: input.id },
          input.reason,
          context.request.log,
        )
        if (ended === null) throw new ORPCError('FORBIDDEN')
        // One that ended already, or never was, answers alike.
        if (!ended)
          throw new ORPCError('NOT_FOUND', {
            message: "We couldn't find this connection. It may be disconnected already.",
          })
        return { disconnected: ended }
      }),
      disconnectPerson: authorized.agentConnections.disconnectPerson.handler(
        async ({ context, input }) => {
          plainReason(input.reason)
          const ended = await login?.disconnectAsAdmin(
            context.tx,
            { personId: input.personId },
            input.reason,
            context.request.log,
          )
          if (ended === null) throw new ORPCError('FORBIDDEN')
          return { disconnected: ended ?? 0 }
        },
      ),
    },
    roles: {
      list: authorized.roles.list.handler(({ context }) => listGrants(context.tx)),
      grant: authorized.roles.grant.handler(({ context, input }) =>
        changeGrant(context.tx, input, true),
      ),
      revoke: authorized.roles.revoke.handler(({ context, input }) =>
        changeGrant(context.tx, input, false),
      ),
    },
    assignments: {
      grant: authorized.assignments.grant.handler(({ context, input }) =>
        changeGrant(context.tx, input, true),
      ),
      revoke: authorized.assignments.revoke.handler(({ context, input }) =>
        changeGrant(context.tx, input, false),
      ),
    },
    grants: {
      apply: authorized.grants.apply.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'grants.apply', input, () =>
          applyGrants(context.tx, input),
        ),
      ),
    },
    items: {
      list: authorized.items.list.handler(({ input, context }) => context.library.listItems(input)),
      get: authorized.items.get.handler(async ({ input, context }) =>
        found(await context.library.getItem(input.id)),
      ),
      history: authorized.items.history.handler(async ({ input, context }) =>
        found(await context.library.getHistory(input.id)),
      ),
      links: authorized.items.links.handler(async ({ input, context }) =>
        found(await context.library.getLinks(input.id)),
      ),
      page: authorized.items.page.handler(async ({ input, context }) =>
        found(await context.context.page(input.id)),
      ),
      markRead: authorized.items.markRead.handler(({ input, context }) =>
        context.context.markRead(input.id),
      ),
      related: authorized.items.related.handler(async ({ input, context }) =>
        found(await context.context.related(input.id)),
      ),
      restoreAsDraft: authorized.items.restoreAsDraft.handler(({ input, context }) =>
        retryWrite(context.tx, idempotencyKey(context), 'items.restoreAsDraft', input, () =>
          context.context.restoreAsDraft(input),
        ),
      ),
      publish: authorized.items.publish.handler(({ input, context }) =>
        retryWrite(context.tx, idempotencyKey(context), 'items.publish', input, () =>
          context.context.publish(input),
        ),
      ),
      bulkPlan: authorized.items.bulkPlan.handler(({ input, context }) =>
        context.context.plan(input),
      ),
      bulkApply: authorized.items.bulkApply.handler(({ input, context }) =>
        retryWrite(context.tx, idempotencyKey(context), 'items.bulkApply', input, () =>
          context.context.bulkApply(input),
        ),
      ),
      changes: authorized.items.changes.handler(({ context }) => context.context.changes()),
      deleted: authorized.items.deleted.handler(({ context }) => context.context.deleted()),
    },
    drafts: {
      fromText: authorized.drafts.fromText.handler(({ input, context }) =>
        context.context.draftFromText(input.text),
      ),
    },
    library: {
      index: authorized.library.index.handler(({ context }) => context.library.getIndex()),
      freshness: authorized.library.freshness.handler(({ context, input }) =>
        context.library.getFreshness(input.weeks),
      ),
      reviews: authorized.library.reviews.handler(({ context, input }) =>
        context.library.getReviews(input.ids),
      ),
    },
    search: {
      all: authorized.search.all.handler(({ context, input }) => context.library.search(input.q)),
    },
    bin: {
      list: authorized.bin.list.handler(({ context }) => context.bin.list()),
      get: authorized.bin.get.handler(({ context, input }) => context.bin.get(input.id)),
      preview: authorized.bin.preview.handler(({ context, input }) =>
        context.bin.preview(input.ids),
      ),
      move: authorized.bin.move.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'bin.move', input, () =>
          context.bin.move(input),
        ),
      ),
      rescuePreview: authorized.bin.rescuePreview.handler(({ context, input }) =>
        context.bin.rescuePreview(input),
      ),
      restore: authorized.bin.restore.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'bin.restore', input, async () => {
          const restored = await context.bin.restore(input)
          // A rescue's proposal is submitted, so its checks run at once, as any submit's do.
          for (const proposal of restored.proposals)
            await context.review.checkSubmitted(proposal.id)
          return restored
        }),
      ),
    },
    catalogue: {
      list: authorized.catalogue.list.handler(({ context }) => context.catalogue.list()),
      get: authorized.catalogue.get.handler(async ({ context, input }) =>
        found(await context.catalogue.get(input.kind, input.id)),
      ),
    },
    terms: {
      list: authorized.terms.list.handler(({ context }) => context.terms.list()),
      create: authorized.terms.create.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'terms.create', input, () =>
          context.terms.create(input),
        ),
      ),
      update: authorized.terms.update.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'terms.update', input, () =>
          context.terms.update(input),
        ),
      ),
      delete: authorized.terms.delete.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'terms.delete', input, () =>
          context.terms.remove(input),
        ),
      ),
      move: authorized.terms.move.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'terms.move', input, () =>
          context.terms.move(input),
        ),
      ),
      restore: authorized.terms.restore.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'terms.restore', input, () =>
          context.terms.restore(input),
        ),
      ),
      deleted: authorized.terms.deleted.handler(({ context }) => context.terms.deleted()),
      history: authorized.terms.history.handler(({ context, input }) =>
        context.terms.history(input.id),
      ),
    },
    definitions: {
      coverage: authorized.definitions.coverage.handler(({ context }) => context.terms.coverage()),
      related: authorized.definitions.related.handler(async ({ input, context }) =>
        found(await context.context.related(input.key)),
      ),
    },
    areas: {
      list: authorized.areas.list.handler(({ context }) => context.areas.list()),
      setOwners: authorized.areas.setOwners.handler(({ context, input }) =>
        setOwners(context.tx, input),
      ),
      get: authorized.areas.get.handler(({ context, input }) => getArea(context.tx, input.id)),
      create: authorized.areas.create.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'areas.create', input, () =>
          createArea(context.tx, input),
        ),
      ),
      update: authorized.areas.update.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'areas.update', input, () =>
          updateArea(context.tx, input),
        ),
      ),
      describe: authorized.areas.describe.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'areas.describe', input, () =>
          describeArea(context.tx, input),
        ),
      ),
      removal: authorized.areas.removal.handler(({ context, input }) =>
        areaRemoval(context.tx, input.id),
      ),
      remove: authorized.areas.remove.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'areas.remove', input, () =>
          removeArea(context.tx, input),
        ),
      ),
      deleteEmpty: authorized.areas.deleteEmpty.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'areas.deleteEmpty', input, () =>
          deleteEmptyArea(context.tx, input),
        ),
      ),
      archived: authorized.areas.archived.handler(({ context }) => archivedAreas(context.tx)),
      restore: authorized.areas.restore.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'areas.restore', input, () =>
          restoreArea(context.tx, input),
        ),
      ),
      dashboard: authorized.areas.dashboard.handler(({ context, input }) =>
        context.gaps.dashboard(input.areaId, input.weeks),
      ),
    },
    gaps: {
      report: authorized.gaps.report.handler(async ({ context, input }) => {
        const key = idempotencyKey(context)
        // 128 random bits, as the web binding sends: the stored digest mixes in the caller, so a
        // key that could be guessed would let anyone with the table test who reported what.
        if (!key || !randomRetryKey.test(key))
          throw new ORPCError('BAD_REQUEST', {
            message: 'Send an Idempotency-Key header of 32 random hex digits or a random UUID.',
          })
        // FR-408: a person's reports have a tighter limit of their own. The key lives in memory
        // only, for its minute, and the report records no person.
        const retry = limitGapReports([
          {
            key: `gap-report:${context.session!.person.id}`,
            limit: await gapReportsPerMinute(context.tx),
          },
        ])
        if (retry) {
          context.reply.header('retry-after', String(retry))
          throw new ORPCError('TOO_MANY_REQUESTS', {
            message: `You've sent a lot of reports. Try again in ${retry} seconds.`,
            data: { retryAfterSeconds: retry },
          })
        }
        return context.gaps.report(input, key)
      }),
      list: authorized.gaps.list.handler(({ context, input }) => context.gaps.list(input)),
      get: authorized.gaps.get.handler(({ context, input }) => context.gaps.get(input.id)),
      setStatus: authorized.gaps.setStatus.handler(({ context, input }) =>
        context.gaps.setStatus(input.id, input.status, input.reason),
      ),
      addNote: authorized.gaps.addNote.handler(({ context, input }) =>
        context.gaps.addNote(input.id, input.note),
      ),
      linkTest: authorized.gaps.linkTest.handler(({ context, input }) =>
        context.gaps.linkTest(input.id, input.question, input.evidenceRun),
      ),
      unlinkTest: authorized.gaps.unlinkTest.handler(({ context, input }) =>
        context.gaps.unlinkTest(input.id, input.question),
      ),
      startDraft: authorized.gaps.startDraft.handler(({ context, input }) =>
        retryWrite(
          context.tx,
          context.request.headers['idempotency-key'] as string | undefined,
          'gaps.startDraft',
          input,
          () => context.gaps.startDraft(input.id, input.areaId),
        ),
      ),
      draft: authorized.gaps.draft.handler(({ context, input }) =>
        retryWrite(
          context.tx,
          context.request.headers['idempotency-key'] as string | undefined,
          'gaps.draft',
          input,
          () => context.gaps.scopeDraft(input.id, input.areaId),
        ),
      ),
    },
    topics: {
      counts: authorized.topics.counts.handler(({ context, input }) =>
        context.gaps.topicCounts(input.areaId, input.weeks),
      ),
      weekly: authorized.topics.weekly.handler(({ context, input }) =>
        context.gaps.weeklyCalls(input.weeks),
      ),
    },
    sources: {
      flags: authorized.sources.flags.handler(({ context, input }) => context.sources.flags(input)),
      staleLinks: authorized.sources.staleLinks.handler(({ context, input }) =>
        context.sources.staleLinks(input),
      ),
      types: authorized.sources.types.handler(() => workspaceSources.types()),
      get: authorized.sources.get.handler(async ({ context, input }) =>
        found(await workspaceSources.get(context.tx, input.id)),
      ),
      // A retry is keyed on the input without its secrets, so no secret is kept, not even hashed.
      add: authorized.sources.add.handler(({ context, input }) =>
        retryWrite(
          context.tx,
          idempotencyKey(context),
          'sources.add',
          { ...input, secrets: Object.keys(input.secrets).sort() },
          () => workspaceSources.add(context.tx, input, context.hooks),
        ),
      ),
      update: authorized.sources.update.handler(({ context, input }) =>
        workspaceSources.update(context.tx, input, context.hooks),
      ),
      test: authorized.sources.test.handler(({ context, input }) =>
        workspaceSources.test(context.tx, input),
      ),
      read: authorized.sources.read.handler(async ({ context, input }) => {
        const [row] = await context.tx.query<{ enabled: boolean }>(
          'select enabled from connectors where id = $1',
          [input.id],
        )
        if (!row) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this source." })
        if (!row.enabled)
          throw new ORPCError('CONFLICT', {
            message: 'This source is switched off. Switch it on to read it.',
          })
        // Due now, on its own connection: the job may start before this request's transaction ends.
        await database.query('update connectors set next_read_at = now() where id = $1', [input.id])
        const result = await jobs.runNow('connectors.sync')
        if (result.outcome === 'unknown_job' || result.outcome === 'not_running')
          throw new ORPCError('SERVICE_UNAVAILABLE', {
            message: "The job runner isn't running. Ask the data team to start it.",
          })
        // Already waiting or running: the job's next turn reads it.
        return { id: input.id, status: 'queued' as const }
      }),
    },
    members: {
      list: authorized.members.list.handler(({ context }) => listMembers(context.tx)),
      setRole: authorized.members.setRole.handler(({ context, input }) =>
        setMemberRole(context.tx, input),
      ),
      remove: authorized.members.remove.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'members.remove', input, async () => {
          const removed = await removeMember(context.tx, input)
          await login?.endPerson(context.tx, input.personId.toLowerCase())
          return removed
        }),
      ),
      restore: authorized.members.restore.handler(({ context, input }) =>
        restoreMember(context.tx, input),
      ),
    },
    // An invite's link is on the web app's public address: the first allowed origin, or the
    // address this request came to when none is set.
    invites: {
      lookup: authorized.invites.lookup.handler(({ context, input }) =>
        lookupInvite(context.tx, input.token),
      ),
      list: authorized.invites.list.handler(({ context }) => listInvites(context.tx)),
      create: authorized.invites.create.handler(({ context, input }) =>
        createInvites(context.tx, input, webOrigin(context.request)),
      ),
      resend: authorized.invites.resend.handler(({ context, input }) =>
        resendInvite(context.tx, input.id, webOrigin(context.request)),
      ),
      revoke: authorized.invites.revoke.handler(({ context, input }) =>
        revokeInvite(context.tx, input.id),
      ),
    },
    people: {
      list: authorized.people.list.handler(({ context }) => context.people.list()),
      search: authorized.people.search.handler(({ context, input }) =>
        context.people.search(input),
      ),
      sheet: authorized.people.sheet.handler(({ context, input }) =>
        personSheet(context.people, input.id),
      ),
    },
    vocabulary: {
      get: authorized.vocabulary.get.handler(({ context }) => context.vocabulary.get()),
      search: authorized.vocabulary.search.handler(({ context, input }) =>
        context.vocabulary.search({
          query: input.q,
          ...(input.dimension === undefined ? {} : { dimension: input.dimension }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          ...(input.limit === undefined ? {} : { limit: input.limit }),
        }),
      ),
      describe: authorized.vocabulary.describe.handler(({ context, input }) =>
        context.vocabulary.describe(input.keys),
      ),
      propose: authorized.vocabulary.propose.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'vocabulary.propose', input, () =>
          context.review.proposeTerm(input),
        ),
      ),
      candidates: authorized.vocabulary.candidates.handler(({ context }) =>
        context.review.candidateTerms(),
      ),
      proposeBatch: authorized.vocabulary.proposeBatch.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'vocabulary.proposeBatch', input, () =>
          context.review.proposeTerms(input),
        ),
      ),
      decideBatch: authorized.vocabulary.decideBatch.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'vocabulary.decideBatch', input, () =>
          context.review.decideTermBatch(input),
        ),
      ),
    },
    inbox: {
      list: authorized.inbox.list.handler(({ context, input }) => context.inbox.list(input)),
      markRead: authorized.inbox.markRead.handler(({ context, input }) =>
        context.inbox.markRead(input.ids),
      ),
      markAllRead: authorized.inbox.markAllRead.handler(({ context }) =>
        context.inbox.markAllRead(),
      ),
      archive: authorized.inbox.archive.handler(({ context, input }) =>
        context.inbox.archive(input.ids),
      ),
      feed: authorized.inbox.feed.handler(({ context, input }) => context.cards.feed(input.tab)),
    },
    cards: {
      markRead: authorized.cards.markRead.handler(({ context, input }) =>
        context.cards.markRead(input.cards),
      ),
      decide: authorized.cards.decide.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'cards.decide', input, () =>
          context.cards.decide(input),
        ),
      ),
    },
    comments: {
      list: authorized.comments.list.handler(({ context, input }) => context.comments.list(input)),
      create: authorized.comments.create.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'comments.create', input, () =>
          context.comments.create(input),
        ),
      ),
      edit: authorized.comments.edit.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'comments.edit', input, () =>
          context.comments.edit(input),
        ),
      ),
      remove: authorized.comments.remove.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'comments.remove', input, () =>
          context.comments.remove(input),
        ),
      ),
      markMentionsRead: authorized.comments.markMentionsRead.handler(({ context, input }) =>
        context.comments.markMentionsRead(input),
      ),
    },
    reactions: {
      toggle: authorized.reactions.toggle.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'reactions.toggle', input, () =>
          context.comments.toggleReaction(input),
        ),
      ),
    },
    threads: {
      markRead: authorized.threads.markRead.handler(({ context, input }) =>
        context.comments.markThreadRead(input),
      ),
    },
    decisions: {
      undo: authorized.decisions.undo.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'decisions.undo', input, () => {
          const [kind, ids] = [
            input.token.split(':')[0],
            input.token.slice(input.token.indexOf(':') + 1),
          ]
          if (kind === 'decision' || kind === 'decisions')
            return context.path.undoDecisions(ids.split(','))
          if (kind === 'change') return context.context.undoChange(ids)
          if (kind === 'terms') return context.terms.undoChange(ids)
          if (kind === 'saved') return context.saved.undoSaved(ids)
          if (kind === 'kept') return context.saved.undoKept(ids)
          return context.cards.undoCard(input.token)
        }),
      ),
    },
    setup: {
      state: authorized.setup.state.handler(({ context }) => context.cards.setup()),
    },
    activity: {
      list: authorized.activity.list.handler(({ context, input }) => context.activity.list(input)),
    },
    events: {
      // The request's transaction ends when the stream starts: the stream reads in its own
      // short transactions and checks the session again before every read.
      stream: authorized.events.stream.handler(async function* ({ context, lastEventId, signal }) {
        const cookie = context.request.headers.cookie
        yield* streamEvents({
          database: forRequest(database, context.request.id),
          hub,
          lastEventId,
          signal: signal ?? new AbortController().signal,
          reader: async (tx) => (await signIn.currentSession(tx, cookie))?.person.id ?? null,
        })
      }),
    },
    evals: {
      questions: {
        list: authorized.evals.questions.list.handler(({ context, input }) =>
          context.evals.questions.list(input),
        ),
        get: authorized.evals.questions.get.handler(({ context, input }) =>
          context.evals.questions.get(input.id),
        ),
        save: authorized.evals.questions.save.handler(({ context, input }) =>
          retryWrite(context.tx, idempotencyKey(context), 'evals.questions.save', input, () =>
            context.evals.questions.save(input),
          ),
        ),
        setAside: authorized.evals.questions.setAside.handler(({ context, input }) =>
          context.evals.questions.setAside(input),
        ),
        import: authorized.evals.questions.import.handler(({ context, input }) =>
          context.evals.questions.import(input),
        ),
        export: authorized.evals.questions.export.handler(({ context, input }) =>
          context.evals.questions.export(input.area),
        ),
      },
      runs: {
        list: authorized.evals.runs.list.handler(({ context, input }) =>
          context.evals.runs.list(input),
        ),
        get: authorized.evals.runs.get.handler(({ context, input }) =>
          context.evals.runs.get(input.id),
        ),
        estimate: authorized.evals.runs.estimate.handler(({ context, input }) =>
          context.evals.runs.estimate(input.id, input.kind),
        ),
        start: authorized.evals.runs.start.handler(({ context, input }) =>
          retryWrite(context.tx, idempotencyKey(context), 'evals.runs.start', input, () =>
            context.evals.runs.start(input.id),
          ),
        ),
        startLinks: authorized.evals.runs.startLinks.handler(({ context, input }) =>
          retryWrite(context.tx, idempotencyKey(context), 'evals.runs.startLinks', input, () =>
            context.evals.runs.start(input.id, 'links'),
          ),
        ),
        approve: authorized.evals.runs.approve.handler(({ context, input }) =>
          context.evals.runs.approve(input.id),
        ),
        cancel: authorized.evals.runs.cancel.handler(({ context, input }) =>
          context.evals.runs.cancel(input.id),
        ),
        resume: authorized.evals.runs.resume.handler(({ context, input }) =>
          context.evals.runs.resume(input.id),
        ),
      },
      transcript: authorized.evals.transcript.handler(({ context, input }) =>
        context.evals.transcript(input.id),
      ),
      scorecard: authorized.evals.scorecard.handler(({ context, input }) =>
        context.evals.scorecard(input.id),
      ),
      retrieval: {
        latest: authorized.evals.retrieval.latest.handler(({ context, input }) =>
          context.evals.retrieval.latest(input.area),
        ),
        edition: authorized.evals.retrieval.edition.handler(({ context, input }) =>
          context.evals.retrieval.edition(input.label, input.area),
        ),
        trend: authorized.evals.retrieval.trend.handler(({ context, input }) =>
          context.evals.retrieval.trend(input.area, input.limit),
        ),
      },
    },
    quality: {
      history: authorized.quality.history.handler(({ context, input }) =>
        context.quality.history(input.area, input.limit),
      ),
      compare: authorized.quality.compare.handler(({ context, input }) =>
        context.quality.compare(input.id, input.against),
      ),
      feedback: authorized.quality.feedback.handler(({ context, input }) =>
        context.quality.feedback(input.area, input.weeks),
      ),
      ratings: authorized.quality.ratings.handler(({ context, input }) =>
        context.quality.ratings(input.area, input.weeks),
      ),
      apps: authorized.quality.apps.handler(({ context, input }) =>
        context.quality.apps(input.weeks),
      ),
      upkeep: authorized.quality.upkeep.handler(({ context, input }) =>
        context.quality.upkeep(input.area, input.weeks),
      ),
      untested: authorized.quality.untested.handler(({ context, input }) =>
        context.quality.untested(input.area),
      ),
      fixNext: authorized.quality.fixNext.handler(({ context, input }) =>
        context.quality.fixNext(input.area, input.limit),
      ),
      compareQuestion: authorized.quality.compareQuestion.handler(({ context, input }) =>
        context.quality.compareQuestion(input),
      ),
      questionHistory: authorized.quality.questionHistory.handler(({ context, input }) =>
        context.quality.questionHistory(input.question, input.limit),
      ),
    },
    me: { get: authorized.me.get.handler(({ context }) => context.session!.person) },
    workspace: {
      get: authorized.workspace.get.handler(({ context }) => readWorkspace(context.tx)),
    },
    settings: {
      list: authorized.settings.list.handler(({ context }) => listSettings(context.tx)),
      history: authorized.settings.history.handler(({ context, input }) =>
        settingHistory(context.tx, input.key),
      ),
      set: authorized.settings.set.handler(({ context, input }) =>
        setSetting(
          context.tx,
          input,
          () => knownTools(context.tx),
          (key, value) => checkModelSetting(models, key, value),
        ),
      ),
    },
    tools: {
      list: authorized.tools.list.handler(({ context }) => listTools(context.tx)),
      set: authorized.tools.set.handler(({ context, input }) => setTool(context.tx, input)),
    },
    clients: {
      list: authorized.clients.list.handler(({ context }) => listClients(context.tx)),
      save: authorized.clients.save.handler(({ context, input }) => saveClient(context.tx, input)),
    },
    traffic: {
      summary: authorized.traffic.summary.handler(({ context, input }) =>
        trafficSummary(context.tx, input.days),
      ),
    },
    operations: {
      // The view reads with the job runner's own connections, outside the request's transaction.
      overview: authorized.operations.overview.handler(async ({ context }) => {
        try {
          return operationsView(await jobs.overview(), sources)
        } catch (error) {
          context.request.log.error({ err: error }, 'operations view: database unreachable')
          throw new ORPCError('SERVICE_UNAVAILABLE', {
            message: "We couldn't reach the database. Try again in a minute.",
          })
        }
      }),
      run: authorized.operations.run.handler(async ({ input }) => {
        // Running the sources' job by hand reads every source now, whatever its schedule.
        if (input.job === 'connectors.sync')
          await database.query('update connectors set next_read_at = now() where enabled')
        const result = await jobs.runNow(input.job)
        switch (result.outcome) {
          case 'queued':
            return { job: input.job, status: 'queued' as const, id: result.id }
          case 'already_queued':
            throw new ORPCError('CONFLICT', {
              message: `${input.job} is already waiting or running. Try again once it's done.`,
            })
          case 'unknown_job':
            throw new ORPCError('NOT_FOUND', {
              message: `There's no scheduled job called ${input.job}.`,
            })
          case 'not_running':
            throw new ORPCError('SERVICE_UNAVAILABLE', {
              message: "The job runner isn't running. Ask the data team to start it.",
            })
        }
      }),
    },
    audit: {
      search: authorized.audit.search.handler(({ context, input }) =>
        searchAudit(context.tx, input),
      ),
      export: authorized.audit.export.handler(({ context, input }) =>
        exportAudit(context.tx, input),
      ),
      verify: authorized.audit.verify.handler(({ context }) => verifyAudit(context.tx)),
    },
    imports: {
      // A dry run changes nothing, so only an apply needs a retry key.
      items: authorized.imports.items.handler(({ context, input }) => {
        const run = () =>
          importItems(
            context.tx,
            {
              proposals: context.proposals,
              submit: submitForReview(context),
            },
            input,
          )
        return input.dryRun
          ? run()
          : retryWrite(context.tx, idempotencyKey(context), 'imports.items', input, run)
      }),
    },
    assistant: {
      // Like the live stream, the turn outlives the request's transaction: each tool call runs
      // in its own short transaction as the person and checks the session again.
      chat: authorized.assistant.chat.handler(async ({ context, input, signal }) => {
        const cookie = context.request.headers.cookie
        const turn = await prepareTurn(
          {
            database: forRequest(database, context.request.id),
            clock,
            models,
            logger: context.request.log,
            approvalSecret,
            domains: assistantDomains,
            ...(readPage ? { readPage } : {}),
            ...(help ? { help } : {}),
          },
          {
            messages: input.messages,
            ...(input.timeZone ? { timeZone: input.timeZone } : {}),
            personId: context.session!.person.id,
            session: (tx) => signIn.currentSession(tx, cookie),
            ...(signal ? { signal } : {}),
          },
        )
        return turn.stream()
      }),
      rate: authorized.assistant.rate.handler(async ({ context, input }) => {
        // FR-408: a person's ratings have a tighter limit of their own. The key lives in memory
        // only, for its minute, and the rating records no person (FR-712).
        const retry = limitRatings([
          {
            key: `rating:${context.session!.person.id}`,
            limit: await ratingsPerMinute(context.tx),
          },
        ])
        if (retry) {
          context.reply.header('retry-after', String(retry))
          throw new ORPCError('TOO_MANY_REQUESTS', {
            message: `You've sent a lot of ratings. Try again in ${retry} seconds.`,
            data: { retryAfterSeconds: retry },
          })
        }
        return rateAnswer(context.tx, input)
      }),
    },
    connect: {
      get: authorized.connect.get.handler(({ context }) =>
        connectInfo(context.tx, mcpAddress, Boolean(login)),
      ),
      // Without a login server here no agent signs in as a person, so the wait goes on.
      pending: authorized.connect.pending.handler(
        async ({ context, input }) =>
          (await login?.pending(context.tx, context.session!.person.id, new Date(input.since))) ?? {
            state: 'waiting' as const,
            agent: null,
            at: null,
          },
      ),
    },
    tryIt: {
      run: authorized.tryIt.run.handler(({ context, input }) =>
        tryItRun(context.tx, clock, answerBundles, input, origins[0] ?? null, (id) =>
          context.proposals.get(id),
        ),
      ),
      read: authorized.tryIt.read.handler(({ context, input }) =>
        readTryItQuestion(context.tx, clock, input),
      ),
    },
    reports: {
      create: authorized.reports.create.handler(async ({ context, input }) => {
        // FR-408: a person's reports share the tighter limit of their own; the key lives in memory
        // only, for its minute.
        const retry = limitGapReports([
          {
            key: `named-report:${context.session!.person.id}`,
            limit: await gapReportsPerMinute(context.tx),
          },
        ])
        if (retry) {
          context.reply.header('retry-after', String(retry))
          throw new ORPCError('TOO_MANY_REQUESTS', {
            message: `You've sent a lot of reports. Try again in ${retry} seconds.`,
            data: { retryAfterSeconds: retry },
          })
        }
        return retryWrite(context.tx, idempotencyKey(context), 'reports.create', input, () =>
          context.reports.create(input),
        )
      }),
      mine: authorized.reports.mine.handler(({ context }) => context.reports.mine()),
    },
    ask: {
      lookup: authorized.ask.lookup.handler(async ({ context, input }) => {
        // The setup checklist's Ask step (FR-816): only that Ask was used, never what or by whom.
        await context.cards.askedOnce()
        // With a real model, the assistant's model writes the words after the answer; like the
        // assistant's turn, that call outlives the request's transaction and opens its own.
        const plan = await planWords(context.tx, models, context.session!.person.id)
        const log = context.request.log
        return lookupQuestion(
          context.tx,
          clock,
          answerBundles,
          input,
          plan
            ? (answer) =>
                writeWords(
                  {
                    database: forRequest(database, context.request.id),
                    plan,
                    // Names the failure only, never the question or the words.
                    onError: (error) =>
                      log.warn(
                        { error: error instanceof Error ? error.name : 'unknown' },
                        'ask words not written',
                      ),
                  },
                  wordsInputOf(input.question, answer),
                )
            : undefined,
        )
      }),
      asked: authorized.ask.asked.handler(({ context }) =>
        askedThisWeek(context.tx, clock, answerBundles),
      ),
    },
    engine: {
      reach: authorized.engine.reach.handler(async ({ context, input }) =>
        reachOfDraft(context.tx, clock, answerBundles, await context.proposals.get(input.draft)),
      ),
    },
    obs: {
      agents: authorized.obs.agents.handler(({ context, input }) =>
        context.observability.agents(input),
      ),
      feedback: authorized.obs.feedback.handler(({ context, input }) =>
        context.observability.feedback(input),
      ),
      usage: authorized.obs.usage.handler(({ context, input }) =>
        context.observability.usage(input),
      ),
      views: {
        list: authorized.obs.views.list.handler(({ context }) => context.observability.views()),
        save: authorized.obs.views.save.handler(({ context, input }) =>
          context.observability.saveView(input),
        ),
        remove: authorized.obs.views.remove.handler(({ context, input }) =>
          context.observability.removeView(input),
        ),
      },
      replay: authorized.obs.replay.handler(({ context, input }) =>
        replayTopic(context.tx, clock, answerBundles, input),
      ),
    },
    savedQuestions: {
      list: authorized.savedQuestions.list.handler(({ context, input }) =>
        context.saved.list(input),
      ),
      create: authorized.savedQuestions.create.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'savedQuestions.create', input, () =>
          context.saved.create(input),
        ),
      ),
      remove: authorized.savedQuestions.remove.handler(({ context, input }) =>
        context.saved.remove(input),
      ),
      keep: authorized.savedQuestions.keep.handler(({ context, input }) =>
        retryWrite(context.tx, idempotencyKey(context), 'savedQuestions.keep', input, () =>
          context.saved.keep(input),
        ),
      ),
      // Check now outlives the request's transaction: it checks in short transactions of its
      // own, counting as it goes, so the page reads how far it got while it runs.
      check: authorized.savedQuestions.check.handler(async ({ context, input }) => {
        if (input.areaId) {
          const [row] = await context.tx.query<{ manages: boolean }>(
            'select cl_is_admin_now() or cl_is_owner_now($1) as manages',
            [input.areaId],
          )
          if (!row?.manages) throw new ORPCError('FORBIDDEN')
        }
        return runCheck(
          forRequest(database, context.request.id),
          clock,
          answerBundles,
          context.session!.person.id,
          { trigger: 'manual', areaId: input.areaId ?? null },
        )
      }),
      status: authorized.savedQuestions.status.handler(({ context, input }) =>
        context.saved.status(input),
      ),
    },
    alerts: {
      rules: authorized.alerts.rules.handler(({ context }) => context.alerts.rules()),
      setRule: authorized.alerts.setRule.handler(({ context, input }) =>
        context.alerts.setRule(input),
      ),
      mute: authorized.alerts.mute.handler(({ context, input }) => context.alerts.mute(input)),
      raised: authorized.alerts.raised.handler(({ context, input }) =>
        context.alerts.raised(input),
      ),
    },
    schema: {
      item: authorized.schema.item.handler(() => ({
        title: `${productName} item`,
        description:
          'One version of a context item. Mentions are @[words](target) tokens in summaryMarkup and bodyMarkup; mentions lists them in field order.',
        ...itemJsonSchema(),
      })),
    },
  })
}

const schemaConverters = [new ZodToJsonSchemaConverter()]

/**
 * PostgreSQL text cannot hold U+0000, so a NUL anywhere in a request would fail in SQL as a 500.
 * The API refuses it at the door instead, for every operation.
 */
function holdsNul(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('\u0000')
  if (Array.isArray(value)) return value.some(holdsNul)
  if (value && typeof value === 'object')
    return Object.entries(value).some(([key, inner]) => key.includes('\u0000') || holdsNul(inner))
  return false
}

/** The OpenAPI 3.1 document of the contract, as served at /api/v1/openapi.json. */
export function openApiDocument() {
  return new OpenAPIGenerator({ schemaConverters }).generate(contract, {
    info: {
      title: `${productName} API`,
      version: '1.0.0',
      description:
        'Accepted business context, proposals, gaps and domain dashboards, dev sessions and role administration. Only dev sign-in and its people list are public.',
    },
    servers: [{ url: API_PREFIX }],
  })
}

/** The header on every API answer that names the contract the service speaks (`apiVersion`). */
export const API_VERSION_HEADER = 'x-heed-api'

let version: Promise<string> | undefined
/**
 * The contract the service speaks: a short digest of its OpenAPI document, as
 * `npm run api:generate` writes it to docs/api/openapi.json. The web app is built with the digest
 * of the same file (src/web/api/api-version.json), so it can tell when the service runs other code
 * than it was built from, such as a service started before an update.
 */
export function apiVersion(): Promise<string> {
  return (version ??= openApiDocument().then((document) =>
    createHash('sha256')
      .update(`${JSON.stringify(document, null, 2)}\n`)
      .digest('hex')
      .slice(0, 16),
  ))
}

/** A field an answer got wrong: where, what kind of fault, and in how many places. */
export type OutputFault = { path: string; code: string; count: number }

/**
 * Where an answer broke the contract's output check, by path and kind of fault and never by
 * value. Each list index reads `*`, so a fault in a hundred rows is one entry with its count.
 * Undefined for any other error.
 */
export function outputFaults(error: unknown): OutputFault[] | undefined {
  const cause = error instanceof ORPCError ? error.cause : undefined
  if (!(cause instanceof ValidationError) || cause.message !== 'Output validation failed')
    return undefined
  const faults = new Map<string, OutputFault>()
  for (const issue of cause.issues) {
    const path = (issue.path ?? [])
      .map((step) => {
        const key = typeof step === 'object' ? step.key : step
        return typeof key === 'number' ? '*' : String(key)
      })
      .join('.')
    const { code } = issue as { code?: unknown }
    const fault = { path, code: typeof code === 'string' ? code : 'invalid', count: 0 }
    const id = `${fault.path} ${fault.code}`
    const seen = faults.get(id) ?? fault
    seen.count++
    faults.set(id, seen)
  }
  return [...faults.values()]
}

/**
 * A refusal thrown without words of its own, and the input check that refuses what the app sent,
 * say the plain default for their code (contract/refusals.ts), never the library's English
 * ("Forbidden", "Input validation failed"): a screen may show the message. Any other error passes
 * as it is.
 */
export function withPlainWords(error: unknown): unknown {
  if (!(error instanceof ORPCError)) return error
  const code = String(error.code)
  const plain = refusalOfCode[code]
  const bare =
    error.message === fallbackORPCErrorMessage(code, undefined) ||
    error.cause instanceof ValidationError
  if (!plain || !bare) return error
  return new ORPCError(code, {
    defined: error.defined,
    status: error.status,
    message: plain,
    data: error.data,
    cause: error.cause,
  })
}

/**
 * Serves the contract under /api/v1 and its OpenAPI document at /api/v1/openapi.json. Errors are
 * typed (UNAUTHORIZED, NOT_FOUND, BAD_REQUEST); an unexpected failure is logged and answered as
 * 500 without its details. An answer that breaks the contract's output check is logged with the
 * fields it got wrong, never their values. Every answer names the contract (`API_VERSION_HEADER`).
 */
export function registerApiRoutes(app: FastifyInstance, services: ApiServices): void {
  const handler = new OpenAPIHandler(createRouter(services), {
    plugins: [new SmartCoercionPlugin({ schemaConverters })],
    // A comment line every 15 s keeps idle live streams open through proxies.
    eventIteratorKeepAliveInterval: 15_000,
    clientInterceptors: [
      onError((error, { context }) => {
        const status = error instanceof ORPCError ? error.status : 500
        // The request's own logger, so the line carries the request id (NFR-071).
        if (status >= 500) context.request.log.error({ err: error }, 'API operation failed')
      }),
      async (options) => {
        try {
          return await options.next()
        } catch (error) {
          const faults = outputFaults(error)
          if (!faults) throw withPlainWords(error)
          options.context.request.log.error({ faults }, 'API answer broke the contract')
          throw new ORPCError('INTERNAL_SERVER_ERROR', { message: refusals.failed, cause: error })
        }
      },
    ],
  })

  let document: ReturnType<typeof openApiDocument> | undefined
  app.get(`${API_PREFIX}/openapi.json`, () => (document ??= openApiDocument()))

  // An event stream's connection closes when the stream ends. Otherwise a stream that a shutdown
  // ends would leave a keep-alive connection that holds the closing server open.
  app.addHook('onSend', async (_request, reply, payload) => {
    if (String(reply.getHeader('content-type')).startsWith('text/event-stream'))
      reply.header('connection', 'close')
    return payload
  })

  const serve = async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('cache-control', 'no-store')
    reply.header(API_VERSION_HEADER, await apiVersion())
    if (/%00/i.test(request.url) || holdsNul(request.body))
      return reply
        .code(400)
        .send({ code: 'BAD_REQUEST', message: 'Remove the hidden NUL character from the text.' })
    const { matched } = await handler.handle(request, reply, {
      prefix: API_PREFIX,
      context: { request, reply },
    })
    if (matched) return reply
    return reply.code(404).send({ code: 'NOT_FOUND', message: 'No such API operation' })
  }
  // An item file can hold a whole exported edition, and a batch of terms a whole model's members;
  // every other body keeps Fastify's 1 MiB.
  app.post(`${API_PREFIX}/imports`, { bodyLimit: 2 * ITEM_FILE_MAX_LENGTH + 65_536 }, serve)
  app.post(`${API_PREFIX}/vocabulary/batches`, { bodyLimit: TERM_BATCH_BODY_MAX }, serve)
  app.all(`${API_PREFIX}/*`, serve)
}
