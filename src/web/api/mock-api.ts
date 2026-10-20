import type { ContextItem } from '@domain/item'
import { addDays } from '@domain/status'
import type {
  ContextApi,
  HistoryEntry,
  ItemSort,
  LibraryFreshness,
  LibraryFreshnessParams,
  LibraryItem,
  ListItemsParams,
} from './client'
import { ITEMS_PAGE_MAX } from '../../contract/limits.ts'
import { catalogueTermInputSchema } from '../../contract/catalogue.ts'
import { chatInputSchema, ratingInputSchema } from '../../contract/assistant.ts'
import { tryItInputSchema, tryItReadInputSchema } from '../../contract/connect.ts'
import { gapReportInputSchema } from '../../contract/gaps.ts'
import { peopleSearchSchema } from '../../contract/people.ts'
import { addSourceSchema, testSourceSchema, updateSourceSchema } from '../../contract/sources.ts'
import { proposalTestInputSchema } from '../../contract/proposals.ts'
import {
  bulkDecideSchema,
  bulkPlanInputSchema,
  decideTermBatchSchema,
  termBatchSchema,
} from '../../contract/review.ts'
import {
  binItemsSchema,
  binMoveSchema,
  binRescuePreviewInputSchema,
  binRestoreSchema,
} from '../../contract/bin.ts'
import { inboxIdsSchema, inboxListSchema } from '../../contract/notifications.ts'
import { ApiError } from './errors'
import { DEFAULT_MOCK_PERSON, exposeMockWorld, mockPersonId, mockScenario } from './mock-scenario'
import {
  demoStartsAt,
  seedDemoAgentDrafts,
  seedDemoGaps,
  seedDemoProposals,
  seedOwnTerms,
} from './mock-demo-proposals'
import { mockAssistantTurn, type MockAssistantMode } from './mock-assistant'
import { createMockWorkflow, type MockWorkflow } from './mock-workflow'
import { createMockConnections } from './mock-connections'
import { refusals } from '../../contract/refusals.ts'
import { browserPersonalLists } from './personal'
import { firstViewRefs, GONE_DEFINITION_REF } from '../mocks/cube-model.ts'
import { people as mockPeople } from '../mocks/reference-data.ts'
import { demoAppDays } from '../mocks/app-days.ts'
import { demoRatings } from '../mocks/ratings.ts'

/**
 * Simulated network delay in milliseconds. Set VITE_MOCK_LATENCY_MS=0 for tests and
 * screenshots. A little latency in development keeps loading states honest.
 */
function latency(): number {
  if (mockScenario() === 'slow') return 2500
  const value = Number(import.meta.env.VITE_MOCK_LATENCY_MS)
  return Number.isFinite(value) && import.meta.env.VITE_MOCK_LATENCY_MS !== undefined ? value : 120
}

async function delay<T>(value: T): Promise<T> {
  const ms = latency()
  if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms))
  return value
}

// Fixtures are imported lazily so the 1,500 item generator is its own chunk.
const fixtures = () => import('../mocks/fixtures')
const gapFixtures = () => import('../mocks/gaps')

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en')

// The order the API contract defines (src/contract/schemas.ts): ties are broken by id.
const sorters: Record<ItemSort, (a: ContextItem, b: ContextItem) => number> = {
  updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt) || byId(a, b),
  title: (a, b) => a.title.localeCompare(b.title, 'en') || byId(a, b),
  start: (a, b) => b.validity.start.localeCompare(a.validity.start) || byId(a, b),
}

function toLibraryItem(item: ContextItem): LibraryItem {
  return {
    id: item.id,
    kind: item.kind,
    areaId: item.areaId,
    status: item.status,
    version: item.version,
    title: item.title,
    summary: item.summary,
    scope: item.scope,
    validity: item.validity,
    reviewDate: item.reviewDate,
    reviewQuestion: item.reviewQuestion,
    checkFlag: item.checkFlag,
    ownerId: item.ownerId,
    proposerId: item.proposerId,
    updatedAt: item.updatedAt,
  }
}

/**
 * The library's freshness today and on the same weekday of each week before, over the items the
 * index lists. The fixtures keep no history, so an earlier day takes today's items as they stood
 * then: accepted ones created by that day and not past their last day, current when they carry no
 * source flag and their review date had not passed. Today's count is the index's.
 */
export function mockLibraryFreshness(
  items: readonly ContextItem[],
  today: string,
  { weeks = 8 }: LibraryFreshnessParams = {},
): LibraryFreshness {
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > 52)
    throw new ApiError('bad-request', refusals.badRequest, { status: 400 })
  return {
    today,
    days: Array.from({ length: weeks }, (_, index) => {
      const day = addDays(today, -7 * (weeks - 1 - index))
      const applying = items.filter(
        (item) =>
          item.status === 'accepted' &&
          item.createdAt.slice(0, 10) <= day &&
          (item.validity.end === null || item.validity.end > day),
      )
      const current = applying.filter(
        (item) => item.checkFlag === null && (item.reviewDate === null || item.reviewDate >= day),
      )
      return { day, applying: applying.length, current: current.length }
    }),
  }
}

/** Items the scenario allows: none for a first run, a handful for a nearly empty library. */
async function scenarioItems(): Promise<ContextItem[]> {
  const { getFixtureItems } = await fixtures()
  const scenario = mockScenario()
  if (scenario === 'empty') return []
  if (scenario === 'few')
    return getFixtureItems()
      .filter((item) => item.status === 'accepted')
      .slice(0, 6)
  if (scenario === 'quiet')
    // Nothing changed in the last months and no issue applies: Home's two empty states.
    return getFixtureItems()
      .filter((item) => item.kind !== 'issue')
      .map((item) => ({ ...item, updatedAt: '2026-05-01T09:00:00.000Z' }))
  if (scenario === 'definition-gone') {
    // The items that rely on the definition the read no longer lists get the flag the sync
    // gives them (CON-210).
    return getFixtureItems().map((item) =>
      item.status === 'accepted' && item.scope.metrics.includes(GONE_METRIC)
        ? { ...item, checkFlag: 'source_missing' as const }
        : item,
    )
  }
  return getFixtureItems()
}

/** The metric whose definition the `definition-gone` scenario's read no longer lists. */
const GONE_METRIC = GONE_DEFINITION_REF.slice(GONE_DEFINITION_REF.lastIndexOf('.') + 1)

/**
 * The catalogue over the scenario's items: in `definition-gone` with one definition gone, in
 * `no-model-url` with the model folder's address setting off.
 */
async function scenarioCatalogue() {
  const { mockCatalogue, vocabulary, FIXTURE_TODAY } = await fixtures()
  return mockCatalogue(await scenarioItems(), {
    vocabulary,
    today: FIXTURE_TODAY,
    gone: mockScenario() === 'definition-gone' ? [GONE_DEFINITION_REF] : [],
    ...(mockScenario() === 'term-in-one-view' ? { termRefs: firstViewRefs } : {}),
    ...(mockScenario() === 'no-model-url' ? { modelUrl: null } : {}),
  })
}

let libraryCalls = 0

// Favourites and recent items stay in this browser, as they do with the http binding.
const personal = browserPersonalLists('cl.mock.')

/** A plausible history from what the fixture item knows: its versions, dates and people. */
function historyOf(
  item: ContextItem,
  versionDays: (item: ContextItem) => { version: number; proposed: string; accepted: string }[],
): HistoryEntry[] {
  const entries: HistoryEntry[] = versionDays(item).flatMap(({ version, proposed, accepted }) => [
    { version, event: 'proposed', date: proposed, personId: item.proposerId },
    { version, event: 'accepted', date: accepted, personId: item.ownerId },
  ])
  if (item.status === 'retired') {
    entries.push({
      version: item.version,
      event: 'retired',
      date: item.updatedAt.slice(0, 10),
      personId: item.ownerId,
    })
  }
  return entries.reverse()
}

/**
 * One shared proposal, review and edition world for every mock binding in this page, so a
 * contributor's proposal shows in an owner's queue when the person changes. It opens on Maria's
 * demo week (mock-demo-proposals.ts), except in a first run, where nothing has been written yet.
 */
let sharedWorkflow: Promise<MockWorkflow> | undefined
export function mockWorkflow(): Promise<MockWorkflow> {
  sharedWorkflow ??= Promise.all([fixtures(), gapFixtures()]).then(
    ([
      {
        areas,
        people,
        vocabulary,
        roleGrants,
        getFixtureItems,
        versionDays,
        FIXTURE_TODAY,
        mockTestQuestions,
      },
      { gapTopics, gapFixtures: gaps, GAP_MINIMUM_COUNT },
    ]) => {
      const firstRun = mockScenario() === 'empty'
      const workflow = createMockWorkflow({
        today: FIXTURE_TODAY,
        areas,
        people,
        vocabulary,
        items: getFixtureItems,
        approvers: roleGrants.approvers,
        administrators: roleGrants.administrators,
        auditors: roleGrants.auditors,
        versionDays,
        ...(mockScenario() === 'term-in-one-view' ? { termRefs: firstViewRefs } : {}),
        ...(firstRun
          ? {}
          : {
              startsAt: demoStartsAt(FIXTURE_TODAY),
              gaps: { topics: gapTopics, gaps, minimum: GAP_MINIMUM_COUNT },
              testQuestions: mockTestQuestions,
              ratings: demoRatings(FIXTURE_TODAY),
              appDays: demoAppDays(FIXTURE_TODAY),
            }),
      })
      if (!firstRun) {
        seedDemoProposals(workflow, FIXTURE_TODAY)
        seedDemoGaps(workflow)
        seedDemoAgentDrafts(workflow)
      }
      if (mockScenario() === 'own-proposals') seedOwnTerms(workflow)
      exposeMockWorld(workflow)
      return workflow
    },
  )
  return sharedWorkflow
}

export type MockApiOptions = {
  /** Who is signed in. Read on every call; the default follows the `cl.mock-person` key. */
  personId?: () => string
  /** The world to act in; the default is the one this page shares. */
  workflow?: () => Promise<MockWorkflow>
}

/**
 * The mock binding, acting as one person. A person who signs out stays signed out until the page
 * reloads; the `signed-out` scenario starts that way.
 */
export function createMockApi({
  personId = mockPersonId,
  workflow = mockWorkflow,
}: MockApiOptions = {}): ContextApi {
  let signedOut = false
  /** Who the local sign-in chose on this page, over the `signed-out` scenario and `personId`. */
  let signedInAs: string | null = null
  const guard = () => {
    if (signedInAs === null && (signedOut || mockScenario() === 'signed-out'))
      throw new ApiError('signed-out', refusals.signedOut, { status: 401 })
  }
  const who = () => signedInAs ?? personId()
  /** Runs a step of the workflow as the signed-in person, after the simulated latency. */
  const act = async <T>(step: (person: ReturnType<MockWorkflow['as']>) => T): Promise<T> => {
    await delay(null)
    guard()
    return step((await workflow()).as(who()))
  }
  // The library as the live edition serves it: retiring, rechecking and going back change it.
  const served = async (items: readonly ContextItem[]) => (await workflow()).liveItems(items)
  const reads = withGuard(readsApi(served), guard)
  return {
    ...reads,
    getServedReviews: (ids) =>
      ids.length ? act((person) => person.servedReviews(ids)) : Promise.resolve([]),
    listAreas: () =>
      act((person) => {
        if (mockScenario() === 'areas-error')
          throw new ApiError('unavailable', "We couldn't load the domains. Try again in a minute.")
        return mockScenario() === 'no-areas' ? [] : person.listAreas()
      }),
    getSession: () => act((person) => person.session()),
    async signOut() {
      await act(() => undefined)
      signedOut = true
      signedInAs = null
    },
    // The local sign-in offers the fixture people, by the address the demo seed gives them, with
    // the roles each holds now and the domains of those roles.
    async listSignInPeople() {
      const world = await workflow()
      const areas = world.as(DEFAULT_MOCK_PERSON).listAreas()
      return delay(
        mockPeople.map((person) => {
          const { roles, assignments } = world.as(person.id).session().person.permissions
          return {
            email: `${person.id}@example.test`,
            name: person.name,
            initials: person.initials,
            roles,
            assignments: assignments
              .flatMap(({ role, areaId }) => {
                const area = areas.find((a) => a.id === areaId)
                return area
                  ? [{ role, area: { id: area.id, name: area.name, label: area.label } }]
                  : []
              })
              .sort((a, b) => a.area.name.localeCompare(b.area.name, 'en')),
          }
        }),
      )
    },
    async signIn(email) {
      await delay(null)
      const person = mockPeople.find((p) => `${p.id}@example.test` === email.toLowerCase())
      if (!person) throw new ApiError('signed-out', refusals.signedOut, { status: 401 })
      signedInAs = person.id
      signedOut = false
      return (await workflow()).as(person.id).session()
    },
    ...createMockConnections(
      guard,
      () => delay(undefined),
      (connection) => act((person) => person.connectApp(connection)),
    ),
    listConnections: () =>
      act((person) => (mockScenario() === 'empty' ? [] : person.listConnections())),
    disconnectApp: (input) => act((person) => person.disconnectApp(input)),
    listProposals: (params) => act((person) => person.listProposals(params)),
    getProposal: (id) => act((person) => orNull(() => person.getProposal(id))),
    previewProposal: (input) => act((person) => person.previewProposal(input)),
    getProposalOverlap: (id) => act((person) => person.getProposalOverlap(id)),
    createProposal: (input) => act((person) => person.createProposal(input)),
    saveDraft: (input) => act((person) => person.saveDraft(input)),
    submitProposal: (input) => act((person) => person.submitProposal(input)),
    withdrawProposal: (input) => act((person) => person.withdrawProposal(input)),
    discardDraft: (input) => act((person) => person.discardDraft(input)),
    commentOnProposal: (input) => act((person) => person.commentOnProposal(input)),
    claimProposal: (input) => act((person) => person.claimProposal(input)),
    handOverProposal: (input) => act((person) => person.handOverProposal(input)),
    listProposalEvents: (id) => act((person) => orNull(() => person.listProposalEvents(id)) ?? []),
    listProposalTests: (id) => act((person) => person.listProposalTests(id)),
    attachProposalTest: (input) =>
      act((person) => person.attachProposalTest(valid(proposalTestInputSchema, input))),
    detachProposalTest: (input) =>
      act((person) => person.detachProposalTest(valid(proposalTestInputSchema, input))),
    listReviewQueue: (params) => act((person) => person.listReviewQueue(params)),
    getReview: (id) => act((person) => orNull(() => person.getReview(id))),
    runChecks: (id) => act((person) => person.runChecks(id)),
    editReview: (input) => act((person) => person.editReview(input)),
    decide: (input) => act((person) => person.decide(input)),
    planDecisions: (input) =>
      act((person) => person.planDecisions(valid(bulkPlanInputSchema, input))),
    decideMany: (input) => act((person) => person.decideMany(valid(bulkDecideSchema, input))),
    // The fixture's people have readable ids, not the service's: as a hand-over, unchecked.
    assignProposals: (input) => act((person) => person.assignProposals(input)),
    listTermCandidates: () => act((person) => person.listTermCandidates()),
    proposeTerms: (input) => act((person) => person.proposeTerms(valid(termBatchSchema, input))),
    decideTermBatch: (input) =>
      act((person) => person.decideTermBatch(valid(decideTermBatchSchema, input))),
    listEditions: (params) => act((person) => person.listEditions(params)),
    rollbackEdition: (input) => act((person) => person.rollbackEdition(input)),
    previewRollback: (label) => act((person) => editionsRead(() => person.previewRollback(label))),
    diffEdition: (input) => act((person) => person.diffEdition(input)),
    exportEdition: (label) => act((person) => person.exportEdition(label)),
    compareEditions: (input = {}) =>
      act((person) => editionsRead(() => person.compareEditions(input))),
    compareEditionItem: (input) => act((person) => person.compareEditionItem(input)),
    editionFeed: (input = {}) => act((person) => editionsRead(() => person.editionFeed(input))),
    listStops: () => act((person) => person.listStops()),
    setStop: (input) => act((person) => person.setStop(input)),
    retireItem: (input) => act((person) => person.retireItem(input)),
    proposeRetirement: (input) => act((person) => person.proposeRetirement(input)),
    recheckItem: (input) => act((person) => person.recheckItem(input)),
    listBin: () => act((person) => person.listBin()),
    getBinItem: (id) => act((person) => orNull(() => person.getBinItem(id))),
    previewBin: (input) => act((person) => person.previewBin(valid(binItemsSchema, input))),
    moveToBin: (input) => act((person) => person.moveToBin(valid(binMoveSchema, input))),
    previewRescue: (input) =>
      act((person) => person.previewRescue(valid(binRescuePreviewInputSchema, input))),
    restoreFromBin: (input) =>
      act((person) => person.restoreFromBin(valid(binRestoreSchema, input))),
    listGaps: (params) =>
      act((person) => {
        if (mockScenario() === 'error') throw new Error('The gaps service did not answer')
        return person.listGaps(params)
      }),
    getGap: (id) => act((person) => orNull(() => person.getGap(id))),
    setGapStatus: (input) => act((person) => person.setGapStatus(input)),
    addGapNote: (input) => act((person) => person.addGapNote(input)),
    linkGapTest: (input) => act((person) => person.linkGapTest(input)),
    unlinkGapTest: (input) => act((person) => person.unlinkGapTest(input)),
    startDraftFromGap: (input) => act((person) => person.startDraftFromGap(input)),
    reportGap: (input) => act((person) => person.reportGap(valid(gapReportInputSchema, input))),
    getTopicCounts: (params) => act((person) => person.getTopicCounts(params)),
    getWeeklyCalls: (params) =>
      act((person) => {
        if (mockScenario() === 'error') throw new Error('The gaps service did not answer')
        return person.getWeeklyCalls(params)
      }),
    searchScope: (input) => act((person) => person.searchScope(input)),
    matchScope: (input) => act((person) => person.matchScope(input)),
    describeScope: (keys) => act((person) => person.describeScope(keys)),
    getEvalRun: (id) => act((person) => orNull(() => person.getEvalRun(id))),
    listTestQuestions: (params) => act((person) => person.listTestQuestions(params)),
    saveTestQuestion: (input) => act((person) => person.saveTestQuestion(input)),
    setAsideTestQuestion: (input) => act((person) => person.setAsideTestQuestion(input)),
    importTestQuestions: (input) => act((person) => person.importTestQuestions(input)),
    exportTestQuestions: (params) => act((person) => person.exportTestQuestions(params)),
    listEvalRuns: (params) => act((person) => person.listEvalRuns(params)),
    estimateEvalRun: (params) => act((person) => person.estimateEvalRun(params)),
    startEvalRun: (input) => act((person) => person.startEvalRun(input)),
    approveEvalRun: (input) => act((person) => person.approveEvalRun(input)),
    cancelEvalRun: (input) => act((person) => person.cancelEvalRun(input)),
    resumeEvalRun: (input) => act((person) => person.resumeEvalRun(input)),
    getEvalTranscript: (id) => act((person) => orNull(() => person.getEvalTranscript(id))),
    getRetrievalLatest: (params) => act((person) => person.getRetrievalLatest(params)),
    getRetrievalEdition: (params) => act((person) => person.getRetrievalEdition(params)),
    getRetrievalTrend: (params) => act((person) => person.getRetrievalTrend(params)),
    getQualityHistory: (params) => act((person) => person.getQualityHistory(params)),
    compareRuns: (params) => act((person) => person.compareRuns(params)),
    getFeedbackCounts: (params) => act((person) => person.getFeedbackCounts(params)),
    getRatingCounts: (params) => act((person) => person.getRatingCounts(params)),
    getAppFamilyCounts: (params) => act((person) => person.getAppFamilyCounts(params)),
    getUpkeep: (params) => act((person) => person.getUpkeep(params)),
    getUntested: (params) => act((person) => person.getUntested(params)),
    getFixNext: (params) => act((person) => person.getFixNext(params)),
    compareQuestion: (params) => act((person) => person.compareQuestion(params)),
    getQuestionHistory: (params) => act((person) => person.getQuestionHistory(params)),
    listTools: () => act((person) => gatewayRead(() => person.listTools())),
    setTool: (input) => act((person) => person.setTool(input)),
    listClients: () => act((person) => gatewayRead(() => person.listClients())),
    saveClient: (input) => act((person) => person.saveClient(input)),
    getTraffic: (params) => act((person) => gatewayRead(() => person.getTraffic(params))),
    listAiConnections: () =>
      act((person) =>
        gatewayRead(() => (mockScenario() === 'empty' ? [] : person.listAiConnections())),
      ),
    disconnectAiConnection: (input) => act((person) => person.disconnectAiConnection(input)),
    disconnectPersonAiConnections: (input) =>
      act((person) => person.disconnectPersonAiConnections(input)),
    listSettings: () => act((person) => settingsRead(() => person.listSettings())),
    getSettingHistory: (key) => act((person) => person.getSettingHistory(key)),
    setSetting: (input) => act((person) => person.setSetting(input)),
    searchPeople: (params) =>
      act((person) => settingsRead(() => person.searchPeople(valid(peopleSearchSchema, params)))),
    getPersonSheet: (id) => act((person) => orNull(() => person.getPersonSheet(id))),
    listGrants: () => act((person) => settingsRead(() => person.listGrants())),
    applyGrants: (input) => act((person) => person.applyGrants(input)),
    getArea: (id) => act((person) => orNull(() => person.getArea(id))),
    createArea: (input) => act((person) => person.createArea(input)),
    updateArea: (input) => act((person) => person.updateArea(input)),
    describeArea: (input) => act((person) => person.describeArea(input)),
    getAreaRemoval: (id) => act((person) => orNull(() => person.getAreaRemoval(id))),
    removeArea: (input) => act((person) => person.removeArea(input)),
    listArchivedAreas: () => act((person) => settingsRead(() => person.listArchivedAreas())),
    restoreArea: (input) => act((person) => person.restoreArea(input)),
    getOperations: () => act((person) => settingsRead(() => person.getOperations())),
    runJob: (input) => act((person) => person.runJob(input)),
    listSourceTypes: () => act((person) => settingsRead(() => person.listSourceTypes())),
    getSourceSettings: (id) => act((person) => orNull(() => person.getSourceSettings(id))),
    addSource: (input) => act((person) => person.addSource(valid(addSourceSchema, input))),
    updateSource: (input) => act((person) => person.updateSource(valid(updateSourceSchema, input))),
    testSource: (input) => act((person) => person.testSource(valid(testSourceSchema, input))),
    searchAudit: (params) => act((person) => settingsRead(() => person.searchAudit(params))),
    exportAudit: (params) => act((person) => person.exportAudit(params)),
    verifyAudit: () => act((person) => person.verifyAudit()),
    importItems: (input) => act((person) => person.importItems(input)),
    getConnectInfo: () => act((person) => gatewayRead(() => person.getConnectInfo())),
    tryIt: (input) =>
      act((person) => gatewayRead(() => person.tryIt(valid(tryItInputSchema, input)))),
    readTryItQuestion: (input) =>
      act((person) =>
        gatewayRead(() => person.readTryItQuestion(valid(tryItReadInputSchema, input))),
      ),
    // The scripted assistant answers at the mock's latency, one part at a time.
    assistantChat: (input, { signal } = {}) =>
      act((person) =>
        mockAssistantTurn(person.assistantReads(), valid(chatInputSchema, input).messages, {
          ...(signal ? { signal } : {}),
          pause: () => delay(undefined),
          mode: assistantMode(),
        }),
      ),
    rateAnswer: (input) => act((person) => person.rateAnswer(valid(ratingInputSchema, input))),
    listInbox: (params = {}) => act((person) => person.listInbox(valid(inboxListSchema, params))),
    markInboxRead: (input) => act((person) => person.markInboxRead(valid(inboxIdsSchema, input))),
    markAllInboxRead: () => act((person) => person.markAllInboxRead()),
    archiveInbox: (input) => act((person) => person.archiveInbox(valid(inboxIdsSchema, input))),
    // The stream opens after the simulated latency and then delivers each event as it happens.
    streamEvents: (options) => act((person) => person.streamEvents(options)),
  }
}

/** The assistant's states a scenario asks for: a limit, a failure part way, a refusal. */
function assistantMode(): MockAssistantMode {
  const scenario = mockScenario()
  if (scenario === 'assistant-limit') return 'limit'
  if (scenario === 'assistant-fails') return 'fails'
  if (scenario === 'assistant-refuses') return 'refuses'
  return 'answer'
}

/** The gateway's lists fail in the `error` scenario, as the library does. */
function gatewayRead<T>(read: () => T): T {
  if (mockScenario() === 'error')
    throw new Error('The gateway settings did not load (request gw-41c2)')
  return read()
}

/** What changed between editions fails in the `error` scenario, as the library does. */
function editionsRead<T>(read: () => T): T {
  if (mockScenario() === 'error')
    throw new Error('The editions service did not answer (request ed-7a3e)')
  return read()
}

/** Settings' lists fail in the `error` scenario, as the library does. */
function settingsRead<T>(read: () => T): T {
  if (mockScenario() === 'error')
    throw new Error('The settings service did not answer (request st-5d10)')
  return read()
}

/** The input checks the service makes before an operation runs (it answers 400 otherwise). */
function valid<T>(schema: { safeParse: (input: unknown) => { success: boolean } }, input: T): T {
  if (!schema.safeParse(input).success)
    throw new ApiError('bad-request', refusals.badRequest, { status: 400 })
  return input
}

/** Null for a 404, as the http binding answers an unknown id. */
function orNull<T>(read: () => T): T | null {
  try {
    return read()
  } catch (error) {
    if (error instanceof ApiError && error.kind === 'not-found') return null
    throw error
  }
}

type ReadMethods = Omit<
  ContextApi,
  | 'getServedReviews'
  | 'getSession'
  | 'signOut'
  | 'listSignInPeople'
  | 'signIn'
  | 'getConnectRequest'
  | 'decideConnectRequest'
  | 'listConnections'
  | 'disconnectApp'
  | 'listProposals'
  | 'getProposal'
  | 'previewProposal'
  | 'getProposalOverlap'
  | 'createProposal'
  | 'saveDraft'
  | 'submitProposal'
  | 'withdrawProposal'
  | 'discardDraft'
  | 'commentOnProposal'
  | 'claimProposal'
  | 'handOverProposal'
  | 'listProposalEvents'
  | 'listProposalTests'
  | 'attachProposalTest'
  | 'detachProposalTest'
  | 'listReviewQueue'
  | 'getReview'
  | 'runChecks'
  | 'editReview'
  | 'decide'
  | 'planDecisions'
  | 'decideMany'
  | 'assignProposals'
  | 'listTermCandidates'
  | 'proposeTerms'
  | 'decideTermBatch'
  | 'listEditions'
  | 'rollbackEdition'
  | 'previewRollback'
  | 'diffEdition'
  | 'exportEdition'
  | 'compareEditions'
  | 'compareEditionItem'
  | 'editionFeed'
  | 'listStops'
  | 'setStop'
  | 'retireItem'
  | 'proposeRetirement'
  | 'recheckItem'
  | 'listBin'
  | 'getBinItem'
  | 'previewBin'
  | 'moveToBin'
  | 'previewRescue'
  | 'restoreFromBin'
  | 'listGaps'
  | 'getGap'
  | 'setGapStatus'
  | 'addGapNote'
  | 'linkGapTest'
  | 'unlinkGapTest'
  | 'startDraftFromGap'
  | 'reportGap'
  | 'getTopicCounts'
  | 'getWeeklyCalls'
  | 'searchScope'
  | 'matchScope'
  | 'describeScope'
  | 'getEvalRun'
  | 'listTestQuestions'
  | 'saveTestQuestion'
  | 'setAsideTestQuestion'
  | 'importTestQuestions'
  | 'exportTestQuestions'
  | 'listEvalRuns'
  | 'estimateEvalRun'
  | 'startEvalRun'
  | 'approveEvalRun'
  | 'cancelEvalRun'
  | 'resumeEvalRun'
  | 'getEvalTranscript'
  | 'getRetrievalLatest'
  | 'getRetrievalEdition'
  | 'getRetrievalTrend'
  | 'getQualityHistory'
  | 'compareRuns'
  | 'getFeedbackCounts'
  | 'getRatingCounts'
  | 'getAppFamilyCounts'
  | 'getUpkeep'
  | 'getUntested'
  | 'getFixNext'
  | 'compareQuestion'
  | 'getQuestionHistory'
  | 'listTools'
  | 'setTool'
  | 'listClients'
  | 'saveClient'
  | 'getTraffic'
  | 'listAiConnections'
  | 'disconnectAiConnection'
  | 'disconnectPersonAiConnections'
  | 'listSettings'
  | 'getSettingHistory'
  | 'setSetting'
  | 'searchPeople'
  | 'getPersonSheet'
  | 'listGrants'
  | 'applyGrants'
  | 'getArea'
  | 'createArea'
  | 'updateArea'
  | 'describeArea'
  | 'getAreaRemoval'
  | 'removeArea'
  | 'listArchivedAreas'
  | 'restoreArea'
  | 'getOperations'
  | 'runJob'
  | 'listSourceTypes'
  | 'getSourceSettings'
  | 'addSource'
  | 'updateSource'
  | 'testSource'
  | 'searchAudit'
  | 'exportAudit'
  | 'verifyAudit'
  | 'importItems'
  | 'getConnectInfo'
  | 'tryIt'
  | 'readTryItQuestion'
  | 'assistantChat'
  | 'rateAnswer'
  | 'listInbox'
  | 'markInboxRead'
  | 'markAllInboxRead'
  | 'archiveInbox'
  | 'streamEvents'
>

/** Library reads refuse a signed-out person as the service does; personal lists stay local. */
function withGuard(methods: ReadMethods, guard: () => void): ReadMethods {
  const local = new Set(['listFavorites', 'setFavorite', 'listRecent', 'recordVisit'])
  return Object.fromEntries(
    Object.entries(methods).map(([name, method]) => [
      name,
      local.has(name)
        ? method
        : async (...args: unknown[]) => {
            guard()
            return (method as (...args: unknown[]) => Promise<unknown>)(...args)
          },
    ]),
  ) as ReadMethods
}

/** The reads, over the fixture items as `served` changes them. */
const readsApi = (
  served: (items: readonly ContextItem[]) => Promise<ContextItem[]>,
): ReadMethods => ({
  async listItems(params: ListItemsParams = {}) {
    const { getFixtureItems, mentions: mentionsTarget } = await fixtures()
    const { q, areaId, kind, mentions, sort = 'updated', limit = 50, offset = 0 } = params
    // The bounds the service enforces (it answers BAD_REQUEST outside them).
    if (!Number.isInteger(limit) || limit < 1 || limit > ITEMS_PAGE_MAX)
      throw new Error(`The page size must be between 1 and ${ITEMS_PAGE_MAX}`)
    if (!Number.isInteger(offset) || offset < 0) throw new Error('The offset must be 0 or more')
    const needle = q?.trim().toLowerCase()
    const matches = (await served(getFixtureItems())).filter(
      (item) =>
        (areaId === undefined || item.areaId === areaId) &&
        (kind === undefined || item.kind === kind) &&
        (mentions === undefined || mentionsTarget(item, mentions)) &&
        (!needle ||
          item.title.toLowerCase().includes(needle) ||
          item.summary.toLowerCase().includes(needle)),
    )
    matches.sort(sorters[sort])
    return delay({
      rows: matches.slice(offset, offset + limit),
      total: matches.length,
      limit,
      offset,
    })
  },
  async getItem(id) {
    const items = await served(await scenarioItems())
    return delay(items.find((item) => item.id === id) ?? null)
  },
  async getItemLinks(id) {
    const { areas, linksOf, vocabulary } = await fixtures()
    return delay(linksOf(await served(await scenarioItems()), id, { areas, vocabulary }))
  },
  async listLibrary() {
    libraryCalls += 1
    const scenario = mockScenario()
    const items = await served(await scenarioItems())
    await delay(null)
    if (scenario === 'error' || (scenario === 'refresh-fails' && libraryCalls > 1)) {
      throw new Error('The library service did not answer (request lib-7f3a)')
    }
    const { FIXTURE_TODAY } = await fixtures()
    return {
      items: items.map(toLibraryItem).sort(byId),
      loadedAt: new Date().toISOString(),
      today: FIXTURE_TODAY,
    }
  },
  async getLibraryFreshness(params) {
    const items = await served(await scenarioItems())
    await delay(null)
    if (mockScenario() === 'error')
      throw new Error('The library service did not answer (request lib-7f3a)')
    const { FIXTURE_TODAY } = await fixtures()
    return mockLibraryFreshness(items, FIXTURE_TODAY, params)
  },
  async getItemHistory(id) {
    const { versionDays } = await fixtures()
    const items = await scenarioItems()
    const item = items.find((candidate) => candidate.id === id)
    return delay(item ? historyOf(item, versionDays) : [])
  },
  async listAreas() {
    const { areas } = await fixtures()
    return delay([...areas].sort(byName))
  },
  async listPeople() {
    const { people } = await fixtures()
    return delay([...people].sort(byName))
  },
  async getVocabulary() {
    const { vocabulary } = await fixtures()
    return delay({
      metrics: [...vocabulary.metrics].sort(byName),
      dimensions: [...vocabulary.dimensions].sort(byName).map((dimension) => ({
        ...dimension,
        values: [...dimension.values].sort(byName),
      })),
    })
  },
  async listCatalogue() {
    const scenario = mockScenario()
    const catalogue = await scenarioCatalogue()
    const listed = await delay(catalogue.list())
    if (scenario === 'error') throw new Error('The catalogue service did not answer')
    if (scenario === 'no-terms')
      return { ...listed, terms: [], coverage: { metrics: 0, withoutDomain: 0 } }
    if (scenario === 'source-down')
      return { ...listed, sources: listed.sources.map((source) => ({ ...source, failing: true })) }
    return listed
  },
  async getCatalogueTerm(kind, id) {
    // The bounds the service enforces (it answers BAD_REQUEST outside them).
    if (!catalogueTermInputSchema.safeParse({ kind, id }).success)
      throw new Error('The kind must be metric or dimension, and the id a vocabulary id')
    const scenario = mockScenario()
    const catalogue = await scenarioCatalogue()
    const term = await delay(catalogue.get(kind, id))
    if (scenario === 'error') throw new Error('The catalogue service did not answer')
    if (scenario === 'source-down' && term?.source)
      return { ...term, source: { ...term.source, failing: true } }
    return term
  },
  async listFavorites() {
    return delay(personal.listFavorites())
  },
  async setFavorite(id, favorite) {
    return delay(personal.setFavorite(id, favorite))
  },
  async listRecent() {
    return delay(personal.listRecent())
  },
  async recordVisit(id) {
    return delay(personal.recordVisit(id))
  },
})

/** The binding the app uses in mock mode: the person in `cl.mock-person`, or Maria. */
export const mockApi: ContextApi = createMockApi()
