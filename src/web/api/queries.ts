import {
  infiniteQueryOptions,
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import {
  api,
  type BulkPlanInput,
  type CatalogueTermKind,
  type ContextApi,
  type EditionCompareInput,
  type EditionDiffInput,
  type EditionFeedInput,
  type EditionItemCompareInput,
  type EditionListParams,
  type GapDetail,
  type GapListParams,
  type InboxItem,
  type InboxListParams,
  type InboxPage,
  type LibraryFreshnessParams,
  type ListItemsParams,
  type ProposalListParams,
  type ProposalRecord,
  type PreviewInput,
  type QueueEntry,
  type Review,
  type ReviewProposal,
  type ScopeSearchInput,
  type TryItInput,
  type QueueParams,
  type Session,
  type TopicCountsParams,
  type WeeklyCallsParams,
  type TestQuestionListParams,
  type EvalRunListParams,
  type FixNextParams,
  type QualityAreaParams,
  type QualityCompareParams,
  type QualityHistoryParams,
  type QualityWeeksParams,
  type AppFamilyCountsParams,
  type QuestionCompareParams,
  type QuestionHistoryParams,
  type RetrievalAreaParams,
  type RetrievalTrendParams,
  type AuditSearchParams,
  type PeopleSearchInput,
} from '@/api'
import { expectEchoes } from '@/api/echoes'

/** A comparison of two editions without its page: the two editions and the filters. */
export type EditionChangesFilter = Omit<EditionCompareInput, 'limit' | 'offset'>
/** The editions feed without its cursor: how many a page holds, and where a range stops. */
export type EditionFeedRange = Omit<EditionFeedInput, 'before'>

/** Query keys in one place, so invalidation never depends on a string typed somewhere else. */
export const queryKeys = {
  items: ['items'] as const,
  itemList: (params: ListItemsParams) => ['items', 'list', params] as const,
  item: (id: string) => ['items', 'detail', id] as const,
  itemHistory: (id: string) => ['items', 'history', id] as const,
  servedReviews: (ids: readonly string[]) => ['library', 'reviews', ids] as const,
  itemLinks: (id: string) => ['items', 'links', id] as const,
  library: ['library'] as const,
  libraryFreshness: (params: LibraryFreshnessParams) => ['library', 'freshness', params] as const,
  areas: ['areas'] as const,
  people: ['people'] as const,
  vocabulary: ['vocabulary'] as const,
  scopeSearch: (input: ScopeSearchInput) => ['vocabulary', 'scope-search', input] as const,
  scopeTerms: (keys: readonly string[]) => ['vocabulary', 'scope-terms', keys] as const,
  catalogue: ['catalogue'] as const,
  termCandidates: ['vocabulary', 'candidates'] as const,
  catalogueTerm: (kind: CatalogueTermKind, id: string) => ['catalogue', kind, id] as const,
  session: ['session'] as const,
  signInPeople: ['sign-in-people'] as const,
  connections: ['connections'] as const,
  connectRequest: (id: string) => ['connect-request', id] as const,
  favorites: ['favorites'] as const,
  recent: ['recent'] as const,
  proposals: ['proposals'] as const,
  proposalLists: ['proposals', 'list'] as const,
  proposalList: (params: ProposalListParams) => ['proposals', 'list', params] as const,
  proposal: (id: string) => ['proposals', 'detail', id] as const,
  proposalEvents: (id: string) => ['proposals', 'events', id] as const,
  proposalTests: (id: string) => ['proposals', 'tests', id] as const,
  proposalOverlap: (id: string, revision: number) =>
    ['proposals', 'overlap', id, revision] as const,
  proposalPreview: (input: PreviewInput, revision: number) =>
    ['proposals', 'preview', input, revision] as const,
  review: ['review'] as const,
  reviewQueue: (params: QueueParams) => ['review', 'queue', params] as const,
  reviewOf: (id: string) => ['review', 'detail', id] as const,
  editions: ['editions'] as const,
  editionList: (params: EditionListParams) => ['editions', 'list', params] as const,
  editionDiff: (input: EditionDiffInput) => ['editions', 'diff', input] as const,
  edition: (label: string) => ['editions', 'one', label] as const,
  editionPages: ['editions', 'list', 'pages'] as const,
  editionBeforeDay: (day: string) => ['editions', 'before-day', day] as const,
  editionComparison: (input: EditionCompareInput) => ['editions', 'compare', input] as const,
  editionComparisonPages: (input: EditionChangesFilter) =>
    ['editions', 'compare', 'pages', input] as const,
  editionItemComparison: (input: EditionItemCompareInput) =>
    ['editions', 'compare-item', input] as const,
  editionFeed: (input: EditionFeedInput) => ['editions', 'feed', input] as const,
  editionFeedPages: (input: EditionFeedRange) => ['editions', 'feed', 'pages', input] as const,
  rollbackPreview: (label: string) => ['editions', 'rollback-preview', label] as const,
  stops: ['stops'] as const,
  /** The Bin (administrators): its entries, and a preview of moving items to it. */
  bin: ['bin'] as const,
  binPreview: (ids: readonly string[]) => ['bin', 'preview', ids] as const,
  binItem: (id: string) => ['bin', 'item', id] as const,
  binRescue: (ids: readonly string[], areaId: string) => ['bin', 'rescue', ids, areaId] as const,
  gaps: ['gaps'] as const,
  gapLists: ['gaps', 'list'] as const,
  gapList: (params: GapListParams) => ['gaps', 'list', params] as const,
  gap: (id: string) => ['gaps', 'detail', id] as const,
  topicCounts: (params: TopicCountsParams) => ['gaps', 'topics', params] as const,
  weeklyCalls: (params: WeeklyCallsParams) => ['gaps', 'weekly', params] as const,
  evalRun: (id: string) => ['evals', 'run', id] as const,
  testQuestionLists: ['evals', 'questions'] as const,
  testQuestions: (params: TestQuestionListParams) => ['evals', 'questions', params] as const,
  evalRunLists: ['evals', 'runs'] as const,
  evalRuns: (params: EvalRunListParams) => ['evals', 'runs', params] as const,
  evalTranscript: (id: string) => ['evals', 'transcript', id] as const,
  runEstimate: (area: string) => ['evals', 'estimate', area] as const,
  retrievalTrend: (params: RetrievalTrendParams) => ['evals', 'retrieval', params] as const,
  retrievalLatest: (params: RetrievalAreaParams) => ['evals', 'retrieval-latest', params] as const,
  quality: ['quality'] as const,
  qualityHistory: (params: QualityHistoryParams) => ['quality', 'history', params] as const,
  runComparison: (params: QualityCompareParams) => ['quality', 'compare', params] as const,
  untested: (params: QualityAreaParams) => ['quality', 'untested', params] as const,
  upkeep: (params: QualityWeeksParams) => ['quality', 'upkeep', params] as const,
  ratings: (params: QualityWeeksParams) => ['quality', 'ratings', params] as const,
  apps: (params: AppFamilyCountsParams) => ['quality', 'apps', params] as const,
  fixNext: (params: FixNextParams) => ['quality', 'fix-next', params] as const,
  questionComparison: (params: QuestionCompareParams) =>
    ['quality', 'question', 'compare', params] as const,
  questionHistory: (params: QuestionHistoryParams) =>
    ['quality', 'question', 'history', params] as const,
  tools: ['gateway', 'tools'] as const,
  clients: ['gateway', 'clients'] as const,
  aiConnections: ['gateway', 'connections'] as const,
  connect: ['gateway', 'connect'] as const,
  traffic: (days: number) => ['gateway', 'traffic', days] as const,
  settings: ['settings'] as const,
  settingList: ['settings', 'list'] as const,
  settingHistory: (key: string) => ['settings', 'history', key] as const,
  grants: ['grants'] as const,
  // Under grants, so a role given or removed refreshes the people found and the open sheet.
  peopleSearch: (params: PeopleSearchInput) => ['grants', 'people', params] as const,
  personSheet: (id: string) => ['grants', 'sheet', id] as const,
  areaDetail: (id: string) => ['area-detail', id] as const,
  areaRemoval: (id: string) => ['area-removal', id] as const,
  archivedAreas: ['archived-areas'] as const,
  operations: ['operations'] as const,
  sourceTypes: ['sources', 'types'] as const,
  sourceSettings: (id: string) => ['sources', 'settings', id] as const,
  audit: ['audit'] as const,
  auditPages: (filters: AuditSearchParams) => ['audit', 'pages', filters] as const,
  auditEntry: (seq: number) => ['audit', 'entry', seq] as const,
  auditLatest: (filters: AuditSearchParams) => ['audit', 'latest', filters] as const,
  tryIt: ['try-it'] as const,
  tryItRun: (input: TryItInput) => ['try-it', input] as const,
  tryItReading: (question: string) => ['try-it', 'reading', question] as const,
  inbox: ['inbox'] as const,
  inboxUnread: ['inbox', 'unread'] as const,
  inboxPages: (filter: InboxFilter) => ['inbox', 'pages', filter] as const,
}

export const itemListQuery = (params: ListItemsParams = {}) =>
  queryOptions({ queryKey: queryKeys.itemList(params), queryFn: () => api.listItems(params) })

export const itemQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.item(id), queryFn: () => api.getItem(id) })

export const itemHistoryQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.itemHistory(id), queryFn: () => api.getItemHistory(id) })

/**
 * How the served version of each item was reviewed, for the review stamp (FR-326). The ids are
 * read in id order, so the same facts share one cache whatever order a page lists them in. It
 * sits under the library's key, so a decision that changes the library refreshes it too.
 */
export const servedReviewsQuery = (ids: readonly string[]) => {
  const sorted = [...new Set(ids)].sort()
  return queryOptions({
    queryKey: queryKeys.servedReviews(sorted),
    queryFn: () => api.getServedReviews(sorted),
    enabled: sorted.length > 0,
  })
}

/** What an item mentions and which items mention it (the item page's Links tab). */
export const itemLinksQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.itemLinks(id), queryFn: () => api.getItemLinks(id) })

/**
 * The whole library as one cached index. The list, the search field, the quick switcher and
 * previous and next on an item page all read this one cache, so moving between them is instant.
 */
export const libraryQuery = () =>
  queryOptions({
    queryKey: queryKeys.library,
    queryFn: () => api.listLibrary(),
    staleTime: 5 * 60_000,
  })

/**
 * How much of the library was current today and a week at a time before (Home's freshness).
 * Under the library's key, so whatever refreshes the library refreshes it too.
 */
export const libraryFreshnessQuery = (params: LibraryFreshnessParams = {}) =>
  queryOptions({
    queryKey: queryKeys.libraryFreshness(params),
    queryFn: () => api.getLibraryFreshness(params),
    staleTime: 5 * 60_000,
  })

export const areasQuery = () =>
  queryOptions({ queryKey: queryKeys.areas, queryFn: () => api.listAreas(), staleTime: Infinity })

export const peopleQuery = () =>
  queryOptions({ queryKey: queryKeys.people, queryFn: () => api.listPeople(), staleTime: Infinity })

export const vocabularyQuery = () =>
  queryOptions({
    queryKey: queryKeys.vocabulary,
    queryFn: () => api.getVocabulary(),
    staleTime: Infinity,
  })

/** The source's members that are not terms yet, each as the term to propose (administrators). */
export const termCandidatesQuery = () =>
  queryOptions({ queryKey: queryKeys.termCandidates, queryFn: () => api.listTermCandidates() })

/**
 * A page of the "Where it applies" search (FR-107). Kept a little while, so typing back to
 * earlier words is instant; recent terms move up within half a minute.
 */
export const scopeSearchQuery = (input: ScopeSearchInput) =>
  queryOptions({
    queryKey: queryKeys.scopeSearch(input),
    queryFn: () => api.searchScope(input),
    staleTime: 30_000,
  })

/** The names of a scope's keys, for its chips. */
export const scopeTermsQuery = (keys: readonly string[]) =>
  queryOptions({
    queryKey: queryKeys.scopeTerms(keys),
    queryFn: () => api.describeScope([...keys]),
    staleTime: 5 * 60_000,
  })

/** The catalogue of metrics and dimensions (FR-136). */
export const catalogueQuery = () =>
  queryOptions({ queryKey: queryKeys.catalogue, queryFn: () => api.listCatalogue() })

/**
 * One metric or dimension of the catalogue; null for an unknown one. Stale at once, so a term
 * page reads it again at every visit: the copy of the source's description is refreshed at every
 * read (CON-207), and the page shows the cached one while it does.
 */
export const catalogueTermQuery = (kind: CatalogueTermKind, id: string) =>
  queryOptions({
    queryKey: queryKeys.catalogueTerm(kind, id),
    queryFn: () => api.getCatalogueTerm(kind, id),
    staleTime: 0,
  })

/**
 * The signed-in person, their roles and the change token. Read once per page load: roles change
 * rarely, and the service checks them again on every change.
 */
export const sessionQuery = () =>
  queryOptions({
    queryKey: queryKeys.session,
    queryFn: () => api.getSession(),
    staleTime: Infinity,
  })

/** Who the local sign-in offers (the dev identity connector). Needs no session. */
export const signInPeopleQuery = () =>
  queryOptions({
    queryKey: queryKeys.signInPeople,
    queryFn: () => api.listSignInPeople(),
    staleTime: Infinity,
  })

/**
 * The AI app sign-in this browser started, for the consent screen; null when it ended or another
 * browser started it. Read fresh every time: it can be answered or end at any moment.
 */
export const connectRequestQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.connectRequest(id),
    queryFn: () => api.getConnectRequest(id),
    staleTime: 0,
    gcTime: 0,
  })

/** The AI apps connected as the signed-in person. */
export const connectionsQuery = () =>
  queryOptions({ queryKey: queryKeys.connections, queryFn: () => api.listConnections() })

/** The signed-in person with their permissions: the session's person, from the same cache. */
export const currentUserQuery = () =>
  queryOptions({
    ...sessionQuery(),
    select: (session: Session) => session.person,
  })

export const favoritesQuery = () =>
  queryOptions({ queryKey: queryKeys.favorites, queryFn: () => api.listFavorites() })

export const recentQuery = () =>
  queryOptions({ queryKey: queryKeys.recent, queryFn: () => api.listRecent() })

/**
 * Adds or removes a favourite. Optimistic, because it is reversible and personal (contract 9.3):
 * the star and the sidebar change at once and roll back if the server refuses.
 */
export function useSetFavorite() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, favorite }: { id: string; favorite: boolean }) =>
      api.setFavorite(id, favorite),
    onMutate: async ({ id, favorite }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.favorites })
      const previous = queryClient.getQueryData<string[]>(queryKeys.favorites)
      const rest = (previous ?? []).filter((existing) => existing !== id)
      queryClient.setQueryData(queryKeys.favorites, favorite ? [...rest, id] : rest)
      return { previous }
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKeys.favorites, context?.previous)
    },
    onSuccess: (favorites) => queryClient.setQueryData(queryKeys.favorites, favorites),
  })
}

/** Records that the person opened an item, so it leads the quick switcher next time. */
export function useRecordVisit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.recordVisit(id),
    onMutate: (id) => {
      const previous = queryClient.getQueryData<string[]>(queryKeys.recent) ?? []
      queryClient.setQueryData(queryKeys.recent, [
        id,
        ...previous.filter((existing) => existing !== id),
      ])
    },
    onSuccess: (recent) => queryClient.setQueryData(queryKeys.recent, recent),
  })
}

/** Every proposal the person may see, drafts included: a draft nobody wants is discarded. */
export const proposalListQuery = (params: ProposalListParams = {}) =>
  queryOptions({
    queryKey: queryKeys.proposalList(params),
    queryFn: () => api.listProposals(params),
  })

export const proposalQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.proposal(id), queryFn: () => api.getProposal(id) })

export const proposalOverlapQuery = (id: string, revision: number) =>
  queryOptions({
    queryKey: queryKeys.proposalOverlap(id, revision),
    queryFn: () => api.getProposalOverlap(id),
  })

export const proposalPreviewQuery = (input: PreviewInput, revision: number) =>
  queryOptions({
    queryKey: queryKeys.proposalPreview(input, revision),
    queryFn: () => api.previewProposal(input),
    retry: false,
  })

export const proposalEventsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.proposalEvents(id),
    queryFn: () => api.listProposalEvents(id),
  })

/** The test questions attached to a proposal's check (FR-524). */
export const proposalTestsQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.proposalTests(id),
    queryFn: () => api.listProposalTests(id),
  })

/** A page of the To review queue: the service answers at most 100 (gap G2: no total). */
export const REVIEW_QUEUE_PAGE = { limit: 100 } as const

export const reviewQueueQuery = (params: QueueParams = {}) =>
  queryOptions({
    queryKey: queryKeys.reviewQueue(params),
    queryFn: () => api.listReviewQueue(params),
  })

/**
 * What one decision for several proposals would do to each (FR-223), read when the dialog that
 * asks for the reason opens; never kept, since the queue moves on.
 */
export const bulkPlanQuery = (input: BulkPlanInput) =>
  queryOptions({
    queryKey: ['review', 'plan', input] as const,
    queryFn: () => api.planDecisions(input),
    staleTime: 0,
    gcTime: 0,
  })

export const reviewQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.reviewOf(id), queryFn: () => api.getReview(id) })

/** An answer test run: its results and flips (the review screen's "Test questions affected"). */
export const evalRunQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.evalRun(id), queryFn: () => api.getEvalRun(id) })

/** The test questions of an area, for their wording on the review screen. */
export const testQuestionsQuery = (params: TestQuestionListParams = {}) =>
  queryOptions({
    queryKey: queryKeys.testQuestions(params),
    queryFn: () => api.listTestQuestions(params),
    staleTime: 5 * 60_000,
  })

// The Quality page (Quality design, direction C): scores, comparisons and work, for owners,
// deputies and administrators over the areas they maintain.

/** Weekly runs, newest first: rates, held-out measures, retrieval and cost per run. */
export const qualityHistoryQuery = (params: QualityHistoryParams = {}) =>
  queryOptions({
    queryKey: queryKeys.qualityHistory(params),
    queryFn: () => api.getQualityHistory(params),
  })

/** Two runs of an area compared: what got better, what got worse, and the sign test. */
export const runComparisonQuery = (params: QualityCompareParams) =>
  queryOptions({
    queryKey: queryKeys.runComparison(params),
    queryFn: () => api.compareRuns(params),
    // Two finished runs never change.
    staleTime: Infinity,
  })

/** Live items no active test question names, per area. */
export const untestedQuery = (params: QualityAreaParams = {}) =>
  queryOptions({ queryKey: queryKeys.untested(params), queryFn: () => api.getUntested(params) })

/** Items past review and proposals accepted, per week and area. */
export const upkeepQuery = (params: QualityWeeksParams = {}) =>
  queryOptions({ queryKey: queryKeys.upkeep(params), queryFn: () => api.getUpkeep(params) })

/** The assistant's ratings per verdict, week and area, small counts hidden (FR-712). */
export const ratingCountsQuery = (params: QualityWeeksParams = {}) =>
  queryOptions({
    queryKey: queryKeys.ratings(params),
    queryFn: () => api.getRatingCounts(params),
  })

/** How the AI apps that called the MCP server fared, per family and week, small counts hidden. */
export const appFamilyCountsQuery = (params: AppFamilyCountsParams = {}) =>
  queryOptions({
    queryKey: queryKeys.apps(params),
    queryFn: () => api.getAppFamilyCounts(params),
  })

/** The ranked list of what to fix next, with its reasons. */
export const fixNextQuery = (params: FixNextParams = {}) =>
  queryOptions({ queryKey: queryKeys.fixNext(params), queryFn: () => api.getFixNext(params) })

/** One test question across two runs, try by try, for the Workbench's question record. */
export const questionComparisonQuery = (params: QuestionCompareParams) =>
  queryOptions({
    queryKey: queryKeys.questionComparison(params),
    queryFn: () => api.compareQuestion(params),
    // Finished runs and sealed editions never change.
    staleTime: Infinity,
  })

/** One test question's verdicts in recent runs and its retrieval result per edition. */
export const questionHistoryQuery = (params: QuestionHistoryParams) =>
  queryOptions({
    queryKey: queryKeys.questionHistory(params),
    queryFn: () => api.getQuestionHistory(params),
  })

/** The retrieval pass of every edition (no model), newest first. */
export const retrievalTrendQuery = (params: RetrievalTrendParams = {}) =>
  queryOptions({
    queryKey: queryKeys.retrievalTrend(params),
    queryFn: () => api.getRetrievalTrend(params),
  })

/** The newest retrieval pass of the live edition, with each question's result. */
export const retrievalLatestQuery = (params: RetrievalAreaParams = {}) =>
  queryOptions({
    queryKey: queryKeys.retrievalLatest(params),
    queryFn: () => api.getRetrievalLatest(params),
  })

/** Answer test runs, newest first. */
export const evalRunsQuery = (params: EvalRunListParams = {}) =>
  queryOptions({ queryKey: queryKeys.evalRuns(params), queryFn: () => api.listEvalRuns(params) })

/** One try's transcript: a finished try never changes. */
export const evalTranscriptQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.evalTranscript(id),
    queryFn: () => api.getEvalTranscript(id),
    staleTime: Infinity,
  })

/** What a full run of an area would cost now: read again each time the dialog opens. */
export const runEstimateQuery = (area: string) =>
  queryOptions({
    queryKey: queryKeys.runEstimate(area),
    queryFn: () => api.estimateEvalRun({ id: area }),
    staleTime: 0,
  })

export const editionListQuery = (params: EditionListParams = {}) =>
  queryOptions({ queryKey: queryKeys.editionList(params), queryFn: () => api.listEditions(params) })

/** Editions a page of the list holds at most (the service's limit). */
export const EDITIONS_PAGE_MAX = 100

/**
 * One edition by its number, or null. The service has no read for one edition, so this pages
 * through the list, newest first; a recent edition is on the first page. Labels start with the
 * day, so the search stops at the first page that is older than the edition.
 */
export const editionQuery = (label: string) =>
  queryOptions({
    queryKey: queryKeys.edition(label),
    queryFn: async () => {
      const day = label.slice(0, 10)
      for (let offset = 0; ; offset += EDITIONS_PAGE_MAX) {
        const page = await api.listEditions({ limit: EDITIONS_PAGE_MAX, offset })
        const found = page.find((edition) => edition.label === label)
        if (found) return found
        const oldest = page.at(-1)
        if (page.length < EDITIONS_PAGE_MAX || !oldest || oldest.label.slice(0, 10) < day)
          return null
      }
    },
  })

/** What changed in an edition: a sealed edition never changes, so its answer is kept. */
export const editionDiffQuery = (input: EditionDiffInput) =>
  queryOptions({
    queryKey: queryKeys.editionDiff(input),
    queryFn: () => api.diffEdition(input),
    staleTime: Infinity,
  })

/** How often the stop switches are read again: a stop reaches agents within 60 seconds (FR-805). */
export const STOPS_REFRESH_MS = 60_000

/** The stop switches that are on, for the banner every signed-in person sees. */
export const stopsQuery = () =>
  queryOptions({
    queryKey: queryKeys.stops,
    queryFn: () => api.listStops(),
    refetchInterval: STOPS_REFRESH_MS,
  })

/** Items in the Bin, newest first. Administrators only. */
export const binQuery = () =>
  queryOptions({ queryKey: queryKeys.bin, queryFn: () => api.listBin() })

/** One item in the Bin, to read before restoring it. Administrators only. */
export const binItemQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.binItem(id), queryFn: () => api.getBinItem(id) })

/** What moving items to the Bin would do, read when the dialog opens, never from a cache. */
export const binPreviewQuery = (ids: readonly string[]) =>
  queryOptions({
    queryKey: queryKeys.binPreview(ids),
    queryFn: () => api.previewBin({ ids: [...ids] }),
    staleTime: 0,
    gcTime: 0,
  })

/**
 * What restoring items of a deleted domain into `areaId` would change in each (FR-814), read
 * when a domain is chosen, never from a cache.
 */
export const binRescueQuery = (ids: readonly string[], areaId: string) =>
  queryOptions({
    queryKey: queryKeys.binRescue(ids, areaId),
    queryFn: () => api.previewRescue({ ids: [...ids], areaId }),
    staleTime: 0,
    gcTime: 0,
  })

/** Gaps the person may see, open first (FR-604 to FR-609). */
export const gapListQuery = (params: GapListParams = {}) =>
  queryOptions({ queryKey: queryKeys.gapList(params), queryFn: () => api.listGaps(params) })

/** One gap with its notes when the person may read them; null when they cannot see it. */
export const gapQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.gap(id), queryFn: () => api.getGap(id) })

/** Calls per topic and week, with the privacy minimum the counts were hidden by (FR-614). */
export const topicCountsQuery = (params: TopicCountsParams = {}) =>
  queryOptions({
    queryKey: queryKeys.topicCounts(params),
    queryFn: () => api.getTopicCounts(params),
  })
/** Agent calls per week over every topic, each total hidden below the minimum (FR-614). */
export const weeklyCallsQuery = (params: WeeklyCallsParams = {}) =>
  queryOptions({
    queryKey: queryKeys.weeklyCalls(params),
    queryFn: () => api.getWeeklyCalls(params),
  })
/** The MCP tools and whether each is on (FR-407). Administrators only. */
export const toolsQuery = () =>
  queryOptions({ queryKey: queryKeys.tools, queryFn: () => api.listTools() })

/** The clients that may connect, with their tools, limits and switch (FR-408). */
export const clientsQuery = () =>
  queryOptions({ queryKey: queryKeys.clients, queryFn: () => api.listClients() })

/** Every person's open AI app connections (FR-403). Administrators only. */
export const aiConnectionsQuery = () =>
  queryOptions({ queryKey: queryKeys.aiConnections, queryFn: () => api.listAiConnections() })

/** MCP calls by client and tool over the last days (FR-410). Administrators only. */
export const trafficQuery = (days: number) =>
  queryOptions({ queryKey: queryKeys.traffic(days), queryFn: () => api.getTraffic({ days }) })

/** Every setting's current version (FR-809). Administrators only. */
export const settingsQuery = () =>
  queryOptions({ queryKey: queryKeys.settingList, queryFn: () => api.listSettings() })

/** Every version of one setting, newest first. */
export const settingHistoryQuery = (key: string) =>
  queryOptions({
    queryKey: queryKeys.settingHistory(key),
    queryFn: () => api.getSettingHistory(key),
  })

/** Who holds which global role and area role (FR-804). Administrators only. */
export const grantsQuery = () =>
  queryOptions({ queryKey: queryKeys.grants, queryFn: () => api.listGrants() })

/** How many people a page of the People page shows, and a picker offers. */
export const PEOPLE_PAGE = 50
export const PICKER_PEOPLE = 20

/** The People page: people the filters match, a page at a time (people and roles, slice 1). */
export const peoplePagesQuery = (filters: Omit<PeopleSearchInput, 'offset' | 'limit'>) =>
  infiniteQueryOptions({
    queryKey: queryKeys.peopleSearch({ ...filters, limit: PEOPLE_PAGE }),
    queryFn: ({ pageParam }) =>
      api.searchPeople({
        ...filters,
        limit: PEOPLE_PAGE,
        ...(pageParam ? { offset: pageParam } : {}),
      }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.next,
    placeholderData: keepPreviousData,
  })

/**
 * A person picker's options for the words typed: active people only unless the picker finds
 * leavers too (the history log's person filter), the best matches first.
 */
export const personPickerQuery = (q: string, status: 'active' | 'all' = 'active') =>
  queryOptions({
    queryKey: queryKeys.peopleSearch({ q, status, limit: PICKER_PEOPLE }),
    queryFn: () => api.searchPeople({ q, status, limit: PICKER_PEOPLE }),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })

/** A person's sheet: their roles, each since when and from whom, and every change to them. */
export const personSheetQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.personSheet(id), queryFn: () => api.getPersonSheet(id) })

/** One area as settings edits it, with its revision; null for an unknown id. */
export const areaDetailQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.areaDetail(id), queryFn: () => api.getArea(id) })

/** What removing an area would do, read fresh each time the dialog opens (FR-814). */
export const areaRemovalQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.areaRemoval(id),
    queryFn: () => api.getAreaRemoval(id),
    staleTime: 0,
  })

/** The archived areas, which an administrator may restore. */
export const archivedAreasQuery = () =>
  queryOptions({ queryKey: queryKeys.archivedAreas, queryFn: () => api.listArchivedAreas() })

/** How often the operations view is read again while it is open. */
export const OPERATIONS_REFRESH_MS = 30_000

/** The scheduled jobs, the connectors, the job queue and the spending (FR-810). */
export const operationsQuery = () =>
  queryOptions({
    queryKey: queryKeys.operations,
    queryFn: () => api.getOperations(),
    refetchInterval: OPERATIONS_REFRESH_MS,
  })

/** How many entries of the history log a page holds. */
export const AUDIT_PAGE = 50

/** The history log, newest first, a page at a time, for the filters given (FR-808). */
export const auditPagesQuery = (filters: AuditSearchParams) =>
  infiniteQueryOptions({
    queryKey: queryKeys.auditPages(filters),
    queryFn: ({ pageParam }) =>
      api.searchAudit({
        ...filters,
        limit: AUDIT_PAGE,
        ...(pageParam === null ? {} : { before: pageParam }),
      }),
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.next,
  })

/** One entry of the history log, by its number; null when there is none. */
export const auditEntryQuery = (seq: number) =>
  queryOptions({
    queryKey: queryKeys.auditEntry(seq),
    queryFn: async () =>
      (await api.searchAudit({ before: seq + 1, limit: 1 })).entries.find(
        (entry) => entry.seq === seq,
      ) ?? null,
  })

/** The newest entry of the history log for some filters, or null when there is none. */
export const latestAuditQuery = (filters: AuditSearchParams) =>
  queryOptions({
    queryKey: queryKeys.auditLatest(filters),
    queryFn: async () => (await api.searchAudit({ ...filters, limit: 1 })).entries[0] ?? null,
  })

/** Connect your AI: the address, the tools on and the clients that may connect. Everyone. */
export const connectQuery = () =>
  queryOptions({ queryKey: queryKeys.connect, queryFn: () => api.getConnectInfo() })

/**
 * What an agent would get for a scope on the live edition. A publish, a rollback or a stop
 * changes it, so those make it stale (`afterPublish`, `setStop`).
 */
export const tryItQuery = (input: TryItInput) =>
  queryOptions({ queryKey: queryKeys.tryItRun(input), queryFn: () => api.tryIt(input) })

/**
 * A question in Home's field read as a scope (FR-602). Held in memory while the field shows it and
 * dropped as soon as nothing reads it, so no question outlives the list.
 */
export const tryItReadingQuery = (question: string) =>
  queryOptions({
    queryKey: queryKeys.tryItReading(question),
    queryFn: () => api.readTryItQuestion({ question }),
    staleTime: Infinity,
    gcTime: 0,
  })

export type InboxFilter = NonNullable<InboxListParams['filter']>

/** How many inbox items a page of the notifications list holds. */
export const INBOX_PAGE = 20

/** The bell's read of the inbox: the unread count and the newest unread notification. */
export type InboxUnread = { unread: number; latest: InboxItem | null }

/**
 * The unread count for the bell, and the newest unread notification, which the bell announces
 * when it arrives. Live updates keep it current (live.ts); it reads one item, so the bell costs
 * almost nothing while the list stays unloaded until the person opens it.
 */
export const inboxUnreadQuery = () =>
  queryOptions({
    queryKey: queryKeys.inboxUnread,
    queryFn: async (): Promise<InboxUnread> => {
      const page = await api.listInbox({ filter: 'unread', limit: 1 })
      return { unread: page.unread, latest: page.items[0] ?? null }
    },
  })

/** The notifications list, newest first, a page at a time: the inbox, or what was archived. */
export const inboxPagesQuery = (filter: InboxFilter) =>
  infiniteQueryOptions({
    queryKey: queryKeys.inboxPages(filter),
    queryFn: ({ pageParam }) =>
      api.listInbox({
        filter,
        limit: INBOX_PAGE,
        ...(pageParam === null ? {} : { before: pageParam }),
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (page: InboxPage) => page.nextBefore,
  })

/** The changes a screen can make through `useApiWrite`. */
export type WriteOperation =
  | 'createProposal'
  | 'saveDraft'
  | 'submitProposal'
  | 'withdrawProposal'
  | 'discardDraft'
  | 'commentOnProposal'
  | 'claimProposal'
  | 'handOverProposal'
  | 'runChecks'
  | 'editReview'
  | 'decide'
  | 'decideMany'
  | 'assignProposals'
  | 'rollbackEdition'
  | 'setStop'
  | 'retireItem'
  | 'proposeRetirement'
  | 'recheckItem'
  | 'moveToBin'
  | 'restoreFromBin'
  | 'setGapStatus'
  | 'addGapNote'
  | 'linkGapTest'
  | 'unlinkGapTest'
  | 'startDraftFromGap'
  | 'attachProposalTest'
  | 'detachProposalTest'
  | 'reportGap'
  | 'rateAnswer'
  | 'setTool'
  | 'saveClient'
  | 'decideConnectRequest'
  | 'disconnectApp'
  | 'disconnectAiConnection'
  | 'disconnectPersonAiConnections'
  | 'saveTestQuestion'
  | 'setAsideTestQuestion'
  | 'importTestQuestions'
  | 'startEvalRun'
  | 'approveEvalRun'
  | 'cancelEvalRun'
  | 'resumeEvalRun'
  | 'setSetting'
  | 'applyGrants'
  | 'createArea'
  | 'updateArea'
  | 'describeArea'
  | 'removeArea'
  | 'restoreArea'
  | 'runJob'
  | 'addSource'
  | 'updateSource'
  | 'testSource'
  | 'importItems'
  | 'proposeTerms'
  | 'decideTermBatch'

type WriteInput<K extends WriteOperation> = Parameters<ContextApi[K]>[0]
type WriteResult<K extends WriteOperation> = Awaited<ReturnType<ContextApi[K]>>

/** What a new edition makes stale: the editions, and the library it serves. */
export const afterPublish: QueryKey[] = [
  queryKeys.editions,
  // An edition may change the vocabulary: the scope picker and the catalogue read it.
  queryKeys.vocabulary,
  queryKeys.tryIt,
  queryKeys.areas,
  ['area-start-checks'],
  queryKeys.library,
  queryKeys.items,
  queryKeys.catalogue,
]

/** What an area role makes stale: who looks after each area, and what the person may do. */
const afterAssignment: QueryKey[] = [
  queryKeys.grants,
  queryKeys.areas,
  ['area-detail'],
  ['area-start-checks'],
  queryKeys.session,
  queryKeys.review,
  queryKeys.audit,
]

/** What else a change to one proposal makes stale: the lists, its events and its review. */
const aroundProposal = (id: string): QueryKey[] => [
  queryKeys.proposalLists,
  queryKeys.proposalEvents(id),
  queryKeys.reviewOf(id),
]

/**
 * What each change makes stale. A screen never names caches itself: a change goes through
 * `useApiWrite`, which refreshes these after the service answers. A change that answers with the
 * proposal also writes it into the proposal's cache at once (`useApiWrite`), so an autosave does
 * not fetch what it was just told.
 */
export const invalidations: {
  [K in WriteOperation]: (input: WriteInput<K>, result: WriteResult<K>) => QueryKey[]
} = {
  createProposal: () => [queryKeys.proposalLists],
  saveDraft: (input) => [queryKeys.proposalLists, queryKeys.reviewOf(input.id)],
  submitProposal: (input) => [...aroundProposal(input.id), queryKeys.review],
  withdrawProposal: (input) => [...aroundProposal(input.id), queryKeys.review],
  discardDraft: (input) => [queryKeys.proposal(input.id), ...aroundProposal(input.id)],
  commentOnProposal: (input) => [queryKeys.proposalEvents(input.id), queryKeys.reviewOf(input.id)],
  claimProposal: (input) => [...aroundProposal(input.id), queryKeys.review],
  handOverProposal: (input) => [...aroundProposal(input.id), queryKeys.review],
  runChecks: (id) => [queryKeys.proposalEvents(id), queryKeys.reviewOf(id)],
  // The risk and the area sort and filter the queue; the writer's draft follows the change.
  editReview: (input) => [
    queryKeys.proposal(input.id),
    ...aroundProposal(input.id),
    queryKeys.review,
  ],
  // The proposal, its lists and the queue; what an accept published follows (`refreshLater`).
  decide: (input) => [queryKeys.proposal(input.id), ...aroundProposal(input.id), queryKeys.review],
  // Going back and the stop switch are kept in the history log, which the live card reads.
  rollbackEdition: () => [...afterPublish, queryKeys.audit],
  setStop: () => [queryKeys.stops, queryKeys.tryIt, queryKeys.audit],
  retireItem: () => afterPublish,
  proposeRetirement: () => [queryKeys.proposals, queryKeys.review],
  recheckItem: (_input, result) => [
    queryKeys.proposals,
    queryKeys.review,
    ...(result.edition ? afterPublish : []),
  ],
  // The library, its counts and the catalogue lose or regain the items whatever was published;
  // the history log keeps each move.
  moveToBin: () => [...afterPublish, queryKeys.bin, queryKeys.audit],
  // An item restored into another domain opens a proposal there (FR-814).
  restoreFromBin: (_input, result) => [
    ...afterPublish,
    queryKeys.bin,
    queryKeys.audit,
    ...(result.proposals.length ? [queryKeys.proposals, queryKeys.review] : []),
  ],
  setGapStatus: (input) => [queryKeys.gapLists, queryKeys.gap(input.id)],
  addGapNote: (input) => [queryKeys.gap(input.id)],
  // Only the gap's record shows its tests; the lists show its status.
  linkGapTest: (input) => [queryKeys.gap(input.id)],
  unlinkGapTest: (input) => [queryKeys.gap(input.id)],
  // The gap now has a draft, and the person a new proposal.
  startDraftFromGap: (input) => [
    queryKeys.gapLists,
    queryKeys.gap(input.id),
    queryKeys.proposalLists,
  ],
  // The proposal's tests, and the gate that reports them on its review.
  attachProposalTest: (input) => [queryKeys.proposalTests(input.id), queryKeys.reviewOf(input.id)],
  detachProposalTest: (input) => [queryKeys.proposalTests(input.id), queryKeys.reviewOf(input.id)],
  // A new gap, or one more report on a gap, shows on the Gaps page.
  reportGap: (_input, report) => [queryKeys.gapLists, queryKeys.gap(report.id)],
  // One more rating in Health's counts.
  rateAnswer: () => [['quality', 'ratings']],
  setTool: () => [queryKeys.tools, queryKeys.connect],
  saveClient: () => [queryKeys.clients, queryKeys.connect],
  decideConnectRequest: (input) => [
    queryKeys.connections,
    queryKeys.connectRequest(input.id),
    queryKeys.aiConnections,
  ],
  disconnectApp: () => [queryKeys.connections, queryKeys.aiConnections],
  // An administrator's disconnect also ends their own app when it is theirs, and is in the log.
  disconnectAiConnection: () => [queryKeys.aiConnections, queryKeys.connections, queryKeys.audit],
  disconnectPersonAiConnections: () => [
    queryKeys.aiConnections,
    queryKeys.connections,
    queryKeys.audit,
  ],
  // A question's wording, expected items or set-aside changes the lists, the untested items and
  // the Fix next list.
  saveTestQuestion: () => [queryKeys.testQuestionLists, queryKeys.quality],
  setAsideTestQuestion: () => [queryKeys.testQuestionLists, queryKeys.quality],
  importTestQuestions: (_input, report) =>
    report.applied ? [queryKeys.testQuestionLists, queryKeys.quality] : [],
  // A run that has finished (the mock's do at once) may have verified the domain's resolved gaps
  // and given their tests a newest result. One still running refreshes them when it ends, through
  // the live stream (`eval.scorecard`, `gap.verified`), so the start does not wait on the gaps.
  startEvalRun: (_input, run) => [
    queryKeys.evalRunLists,
    queryKeys.quality,
    ...(run.state === 'finished' ? [queryKeys.gaps] : []),
  ],
  approveEvalRun: (input) => [queryKeys.evalRunLists, queryKeys.evalRun(input.id)],
  cancelEvalRun: (input) => [queryKeys.evalRunLists, queryKeys.evalRun(input.id)],
  resumeEvalRun: (input) => [queryKeys.evalRunLists, queryKeys.evalRun(input.id)],
  // A new version shows in the list and the history; the log has a new entry. A rate or a
  // retention period changes what the traffic summary says about itself.
  setSetting: (input) => [
    queryKeys.settings,
    queryKeys.audit,
    ...(input.key === 'retention.request_log_days' ? [['gateway', 'traffic']] : []),
  ],
  // A role changes what the person may do: the session (when it is the person's own), the
  // areas' owners, the area details and the log.
  applyGrants: (input) =>
    input.changes.some((change) => 'areaId' in change)
      ? afterAssignment
      : [queryKeys.grants, queryKeys.session, queryKeys.audit],
  // A domain created with its team changes who looks after it, as an area role does.
  createArea: (input) => (input.team ? afterAssignment : [queryKeys.areas, queryKeys.audit]),
  updateArea: (input) => [queryKeys.areas, queryKeys.areaDetail(input.id), queryKeys.audit],
  // What a domain is shows in pickers, on its record and in Administration.
  describeArea: (input) => [queryKeys.areas, queryKeys.areaDetail(input.id), queryKeys.audit],
  // A domain removed or restored leaves or joins every list and picker, with its team's roles.
  // Deleting moves the items to the Bin, retires the terms and withdraws the open proposals, in
  // one edition; restoring serves the terms again.
  removeArea: () => [
    ...afterAssignment,
    ...afterPublish,
    queryKeys.archivedAreas,
    ['area-removal'],
    queryKeys.bin,
    queryKeys.proposals,
  ],
  restoreArea: () => [
    ...afterAssignment,
    ...afterPublish,
    queryKeys.archivedAreas,
    ['area-removal'],
    queryKeys.bin,
    queryKeys.proposals,
  ],
  runJob: () => [queryKeys.operations],
  // A source added or changed is on the list and its page at once; the log has a new entry.
  addSource: () => [queryKeys.operations, queryKeys.audit],
  // A test keeps nothing and changes nothing.
  testSource: () => [],
  updateSource: (input) => [
    queryKeys.operations,
    queryKeys.sourceSettings(input.id),
    queryKeys.audit,
    queryKeys.catalogue,
  ],
  // An applied import made proposals; a dry run changed nothing.
  importItems: (_input, report) =>
    report.applied ? [queryKeys.proposals, queryKeys.review, queryKeys.audit] : [],
  // Proposed terms wait in the queue and leave the members to propose.
  proposeTerms: () => [queryKeys.proposals, queryKeys.review, queryKeys.termCandidates],
  // A bulk step changes each proposal it decided or assigned and the queue; what an accept
  // published follows (`refreshLater`).
  decideMany: (input) => [
    queryKeys.proposals,
    queryKeys.review,
    ...input.proposals.flatMap((target) => [
      queryKeys.proposal(target.id),
      queryKeys.proposalEvents(target.id),
    ]),
  ],
  assignProposals: (input) => [
    queryKeys.proposals,
    queryKeys.review,
    ...input.proposals.map((target) => queryKeys.proposalEvents(target.id)),
  ],
  decideTermBatch: () => [queryKeys.proposals, queryKeys.review, queryKeys.termCandidates],
}

/**
 * What a decision makes stale beyond the proposal and the queue: an accept that published changes
 * the editions, the library, the catalogue and the vocabulary. They are refreshed once the
 * proposal and the queue are, in the background, so a decision never waits for the largest reads
 * and they never queue in front of the ones the screen shows.
 */
export const refreshLater: {
  [K in WriteOperation]?: (input: WriteInput<K>, result: WriteResult<K>) => QueryKey[]
} = {
  decide: (_input, result) => (result.edition ? afterPublish : []),
  decideMany: (_input, result) => (result.editions.length ? afterPublish : []),
  decideTermBatch: (_input, result) => (result.edition ? afterPublish : []),
}

/**
 * The changes whose screen shows the outcome at once (lib/deciding.ts): the change is done when
 * the service answers, and the caches refresh behind it instead of before it.
 */
const shownAtOnce: ReadonlySet<WriteOperation> = new Set<WriteOperation>([
  'decide',
  'decideMany',
  'decideTermBatch',
])

const waitsForDecision = (state: ReviewProposal['state']) =>
  state === 'submitted' || state === 'in_review'

/**
 * Writes the service's answer to a decision into the caches that show it at once: the proposal's
 * review takes its new state, and the To review queue loses what was decided. A proposal that
 * still waits (a high-risk accept before the approver's) stays in the queue with its new state.
 */
function settleDecided(queryClient: QueryClient, decided: readonly ReviewProposal[]) {
  if (!decided.length) return
  const byId = new Map(decided.map((proposal) => [proposal.id, proposal]))
  for (const proposal of decided)
    queryClient.setQueryData<Review>(queryKeys.reviewOf(proposal.id), (review) =>
      review ? { ...review, proposal: { ...review.proposal, ...proposal } } : review,
    )
  queryClient.setQueriesData<QueueEntry[]>({ queryKey: [...queryKeys.review, 'queue'] }, (rows) =>
    rows?.flatMap((row) => {
      const answer = byId.get(row.id)
      if (!answer) return [row]
      return waitsForDecision(answer.state) ? [{ ...row, ...answer }] : []
    }),
  )
}

/** The proposals a decision answered with, by operation. */
function decidedBy(operation: WriteOperation, result: unknown): ReviewProposal[] {
  if (operation === 'decide') return [(result as WriteResult<'decide'>).proposal]
  if (operation === 'decideMany') return (result as WriteResult<'decideMany'>).proposals
  if (operation === 'decideTermBatch') return (result as WriteResult<'decideTermBatch'>).proposals
  return []
}

/** The editions a decision published, by operation. */
function publishedBy(operation: WriteOperation, result: unknown): string[] {
  if (operation === 'decide') return [(result as WriteResult<'decide'>).edition?.label ?? []].flat()
  if (operation === 'decideMany')
    return (result as WriteResult<'decideMany'>).editions.map((edition) => edition.label)
  if (operation === 'decideTermBatch')
    return [(result as WriteResult<'decideTermBatch'>).edition?.label ?? []].flat()
  return []
}

const isProposalRecord = (value: unknown): value is ProposalRecord =>
  typeof value === 'object' &&
  value !== null &&
  'draft' in value &&
  'revision' in value &&
  'id' in value

const isGapDetail = (value: unknown): value is GapDetail =>
  typeof value === 'object' &&
  value !== null &&
  'canManage' in value &&
  'notes' in value &&
  'id' in value

/** Whether `key` starts with every part of `prefix`: invalidating the prefix refreshes it too. */
const startsWith = (key: QueryKey, prefix: QueryKey) =>
  prefix.length <= key.length &&
  prefix.every((part, index) => JSON.stringify(part) === JSON.stringify(key[index]))

/**
 * The keys without those another key of the list covers, so each cache is fetched once: a second
 * invalidation of a cache in flight would cancel its read and send it again.
 */
export function coveringKeys(keys: readonly QueryKey[]): QueryKey[] {
  return keys.filter(
    (key, index) =>
      !keys.some(
        (other, at) =>
          at !== index && startsWith(key, other) && (other.length < key.length || at < index),
      ),
  )
}

/** Marks every cache a change made stale, so open screens fetch them again. */
export async function invalidateAfter<K extends WriteOperation>(
  queryClient: QueryClient,
  operation: K,
  input: WriteInput<K>,
  result: WriteResult<K>,
) {
  const keys = coveringKeys(invalidations[operation](input, result))
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
  // Nothing waits for these: they start once the screen has what it shows.
  const later = coveringKeys(refreshLater[operation]?.(input, result) ?? [])
  void Promise.all(later.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/**
 * A change confirmed by the service (contract 9.3): the screen shows a pending state while it
 * runs, and the caches it touched refresh after it. A decision is shown at once instead
 * (lib/deciding.ts): it is done when the service answers, and its caches refresh behind it. A
 * failure is an `ApiError`; retrying the same input reuses its retry key, so a change whose
 * answer was lost is applied once.
 */
export function useApiWrite<K extends WriteOperation>(operation: K) {
  const queryClient = useQueryClient()
  return useMutation<WriteResult<K>, Error, WriteInput<K>>({
    mutationKey: ['write', operation],
    mutationFn: (input) =>
      (api[operation] as (input: WriteInput<K>) => Promise<WriteResult<K>>)(input),
    onSuccess: async (result, input) => {
      if (isProposalRecord(result)) queryClient.setQueryData(queryKeys.proposal(result.id), result)
      if (isGapDetail(result)) queryClient.setQueryData(queryKeys.gap(result.id), result)
      const decided = decidedBy(operation, result)
      settleDecided(queryClient, decided)
      // The live stream announces this change too; what it would refresh is refreshed here.
      expectEchoes(queryClient, {
        proposals: decided.map((proposal) => proposal.id),
        editions: publishedBy(operation, result),
      })
      const refreshed = invalidateAfter(queryClient, operation, input, result)
      if (!shownAtOnce.has(operation)) await refreshed
    },
  })
}

/**
 * Signs in through the local sign-in. Everything cached belongs to whoever was signed in before,
 * so it is forgotten, and the new session takes its place (which the screen that asked reads).
 */
export function useSignIn() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['write', 'signIn'],
    mutationFn: (email: string) => api.signIn(email),
    onSuccess: (session) => {
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' })
      queryClient.setQueryData(queryKeys.session, session)
    },
  })
}

/** Signs out, forgets everything cached for the person and opens the signed-out page. */
export function useSignOut(onSignedOut: () => Promise<unknown>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['write', 'signOut'],
    mutationFn: () => api.signOut(),
    onSuccess: async () => {
      await onSignedOut()
      queryClient.clear()
    },
  })
}
