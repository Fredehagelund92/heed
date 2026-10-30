import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { api, type HeedApi, type HeedApiMethod } from '@/api'
import {
  isPageRead,
  type ObsPageInput,
  type ObsSummaryInput,
  type ScopeSearchInput,
} from '@/api/client'
import type { AskInput } from '@/model/ask'
import type { FigureAsk } from '@/model/figures'

// Reads and writes as the screens use them: one query factory per read, keyed in one place, and
// one table of what each write makes stale. A screen never names a cache itself.

/** Query keys in one place: the read's method first, then its input. */
export const queryKeys = {
  session: ['getSession'] as const,
  signInPeople: ['listSignInPeople'] as const,
  signInMethod: ['getSignInMethod'] as const,
  invite: ['readInvite'] as const,
  workspace: ['getWorkspace'] as const,
  vocabulary: ['getVocabulary'] as const,
  activity: (name: string) => ['getActivity', name] as const,
  library: ['getLibrary'] as const,
  search: (q: string) => ['searchAll', q] as const,
  scopeSearch: (input: ScopeSearchInput) => ['searchScope', input] as const,
  scopeSearches: ['searchScope'] as const,
  contextPage: ['contextPage'] as const,
  itemPage: (id: string) => ['itemPage', id] as const,
  itemPages: ['itemPage'] as const,
  itemHistory: (id: string) => ['getItemHistory', id] as const,
  itemHistories: ['getItemHistory'] as const,
  related: (id: string) => ['getRelated', id] as const,
  relateds: ['getRelated'] as const,
  draftFromText: (text: string) => ['draftFromText', text] as const,
  comments: ['getComments'] as const,
  definitions: ['getDefinitions'] as const,
  definitionsPage: ['definitionsPage'] as const,
  definitionPage: (name: string) => ['definitionPage', name.toLowerCase()] as const,
  definitionPages: ['definitionPage'] as const,
  definitionHistory: (name: string) => ['getDefinitionHistory', name.toLowerCase()] as const,
  definitionHistories: ['getDefinitionHistory'] as const,
  inbox: ['getInbox'] as const,
  inboxPage: ['inboxPage'] as const,
  reviews: ['getReviews'] as const,
  savedQuestions: ['getSavedQuestions'] as const,
  savedCheck: ['getSavedCheck'] as const,
  alerts: ['getAlerts'] as const,
  savedViews: ['getSavedViews'] as const,
  settings: ['getSettings'] as const,
  advancedPage: ['advancedPage'] as const,
  integrations: ['getIntegrations'] as const,
  integrationsPage: ['integrationsPage'] as const,
  integrationPage: (id: string) => ['integrationPage', id] as const,
  integrationPages: ['integrationPage'] as const,
  connectForm: (id: string) => ['connectForm', id] as const,
  connectForms: ['connectForm'] as const,
  figure: (asked: FigureAsk) => ['readFigure', asked] as const,
  figures: ['readFigure'] as const,
  agentConnections: ['listAgentConnections'] as const,
  connectReview: ['getConnectReview'] as const,
  connectRequest: ['getConnectRequest'] as const,
  observabilityPage: (input: ObsPageInput) => ['observabilityPage', input] as const,
  observabilityPages: ['observabilityPage'] as const,
  observabilitySummary: (input: ObsSummaryInput) => ['observabilitySummary', input] as const,
  replay: (topic: string, when: string) => ['replayTopic', topic, when] as const,
  replays: ['replayTopic'] as const,
  readQuestion: (question: string) => ['readQuestion', question] as const,
  ask: (input: AskInput) => ['ask', input] as const,
  asks: ['ask'] as const,
  askExamples: ['getAskExamples'] as const,
  askedWeek: ['askedThisWeek'] as const,
  chats: ['listChats'] as const,
  myReports: ['getMyReports'] as const,
}

export const sessionQuery = () =>
  queryOptions({ queryKey: queryKeys.session, queryFn: () => api.getSession() })

/** How this workspace signs people in: the picker, or the company's provider. */
export const signInMethodQuery = () =>
  queryOptions({
    queryKey: queryKeys.signInMethod,
    queryFn: () => api.getSignInMethod(),
    staleTime: Infinity,
  })

/** What an invite link's token opens, for the sign-in screen. */
export const inviteQuery = (token: string) =>
  queryOptions({
    queryKey: [...queryKeys.invite, token],
    queryFn: () => api.readInvite({ token }),
    staleTime: Infinity,
    retry: false,
  })

export const signInPeopleQuery = () =>
  queryOptions({
    queryKey: queryKeys.signInPeople,
    queryFn: () => api.listSignInPeople(),
    staleTime: Infinity,
  })

/** The workspace: its name, domains, people, what the business is about, the setup checklist. */
export const workspaceQuery = () =>
  queryOptions({ queryKey: queryKeys.workspace, queryFn: () => api.getWorkspace() })

export const vocabularyQuery = () =>
  queryOptions({
    queryKey: queryKeys.vocabulary,
    queryFn: () => api.getVocabulary(),
    staleTime: Infinity,
  })

export const activityQuery = (name: string) =>
  queryOptions({ queryKey: queryKeys.activity(name), queryFn: () => api.getActivity({ name }) })

/** Every context item the person may read, and what this visit did to them. */
export const libraryQuery = () =>
  queryOptions({ queryKey: queryKeys.library, queryFn: () => api.getLibrary() })

/**
 * Search everywhere for some words. Each search reads afresh when it is shown again, so a change
 * made since shows; nothing else needs to invalidate it.
 */
export const searchQuery = (q: string) =>
  queryOptions({
    queryKey: queryKeys.search(q),
    queryFn: () => api.searchAll({ q }),
    enabled: q.trim() !== '',
  })

/**
 * The "Applies to" picker's search. A page stays fresh for a minute, so typing back and forth
 * reads it once; a publish or a suggestion refreshes it, as the recent terms change then.
 */
export const scopeSearchQuery = (input: ScopeSearchInput) =>
  queryOptions({
    queryKey: queryKeys.scopeSearch(input),
    queryFn: () => api.searchScope(input),
    staleTime: 60_000,
  })

export const contextPageQuery = () =>
  queryOptions({ queryKey: queryKeys.contextPage, queryFn: () => api.contextPage() })

export const itemPageQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.itemPage(id), queryFn: () => api.itemPage({ id }) })

export const itemHistoryQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.itemHistory(id), queryFn: () => api.getItemHistory({ id }) })

/** What an agent can follow from an item or a definition, as Related shows it. */
export const relatedQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.related(id), queryFn: () => api.getRelated({ id }) })

export const commentsQuery = () =>
  queryOptions({ queryKey: queryKeys.comments, queryFn: () => api.getComments() })

export const definitionsQuery = () =>
  queryOptions({ queryKey: queryKeys.definitions, queryFn: () => api.getDefinitions() })

export const definitionsPageQuery = () =>
  queryOptions({ queryKey: queryKeys.definitionsPage, queryFn: () => api.definitionsPage() })

export const definitionPageQuery = (name: string) =>
  queryOptions({
    queryKey: queryKeys.definitionPage(name),
    queryFn: () => api.definitionPage({ name }),
  })

export const definitionHistoryQuery = (name: string) =>
  queryOptions({
    queryKey: queryKeys.definitionHistory(name),
    queryFn: () => api.getDefinitionHistory({ name }),
  })

export const inboxQuery = () =>
  queryOptions({ queryKey: queryKeys.inbox, queryFn: () => api.getInbox() })

export const inboxPageQuery = () =>
  queryOptions({ queryKey: queryKeys.inboxPage, queryFn: () => api.inboxPage() })

export const reviewsQuery = () =>
  queryOptions({ queryKey: queryKeys.reviews, queryFn: () => api.getReviews() })

export const settingsQuery = () =>
  queryOptions({ queryKey: queryKeys.settings, queryFn: () => api.getSettings() })

/** Settings, Advanced's own read. */
export const advancedPageQuery = () =>
  queryOptions({ queryKey: queryKeys.advancedPage, queryFn: () => api.advancedPage() })

export const integrationsQuery = () =>
  queryOptions({ queryKey: queryKeys.integrations, queryFn: () => api.getIntegrations() })

/**
 * While a tool waits for its read (Read again), its row and its page ask again every few seconds,
 * so Reading ends when the read does.
 */
const READING_POLL_MS = 3_000

/** Settings › Integrations: the tools connected, and what can be connected. */
export const integrationsPageQuery = () =>
  queryOptions({
    queryKey: queryKeys.integrationsPage,
    queryFn: () => api.integrationsPage(),
    refetchInterval: (query) =>
      query.state.data?.sources.some((s) => s.health === 'reading') ? READING_POLL_MS : false,
  })

/** One connected tool's page. */
export const integrationPageQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.integrationPage(id),
    queryFn: () => api.integrationPage({ id }),
    refetchInterval: (query) =>
      query.state.data?.source.health === 'reading' ? READING_POLL_MS : false,
  })

/** The connect flow's form: a tool to connect, or one connected whose settings change. */
export const connectFormQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.connectForm(id), queryFn: () => api.connectForm({ id }) })

export const figureQuery = (asked: FigureAsk) =>
  queryOptions({ queryKey: queryKeys.figure(asked), queryFn: () => api.readFigure(asked) })

export const agentConnectionsQuery = () =>
  queryOptions({
    queryKey: queryKeys.agentConnections,
    queryFn: () => api.listAgentConnections(),
  })

export const connectReviewQuery = () =>
  queryOptions({ queryKey: queryKeys.connectReview, queryFn: () => api.getConnectReview() })

/**
 * An agent's sign-in waiting for the person's answer, for the consent page: read once while the
 * page is open, and forgotten when it closes, since an answer ends it.
 */
export const connectRequestQuery = (id: string) =>
  queryOptions({
    queryKey: [...queryKeys.connectRequest, id],
    queryFn: () => api.getConnectRequest({ id }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })

export const savedViewsQuery = () =>
  queryOptions({ queryKey: queryKeys.savedViews, queryFn: () => api.getSavedViews() })

export const alertsQuery = () =>
  queryOptions({ queryKey: queryKeys.alerts, queryFn: () => api.getAlerts() })

export const savedCheckQuery = () =>
  queryOptions({ queryKey: queryKeys.savedCheck, queryFn: () => api.getSavedCheck() })

/** Ask's answer to a question, from the context as it is now. */
export const askQuery = (input: AskInput) =>
  queryOptions({ queryKey: queryKeys.ask(input), queryFn: () => api.ask(input) })

export const askedWeekQuery = () =>
  queryOptions({ queryKey: queryKeys.askedWeek, queryFn: () => api.askedThisWeek() })

export const askExamplesQuery = () =>
  queryOptions({
    queryKey: queryKeys.askExamples,
    queryFn: () => api.getAskExamples(),
    staleTime: Infinity,
  })

export const chatsQuery = () =>
  queryOptions({ queryKey: queryKeys.chats, queryFn: () => api.listChats() })

/** The person's own reports from Ask, with what the owners did after each. */
export const myReportsQuery = () =>
  queryOptions({ queryKey: queryKeys.myReports, queryFn: () => api.getMyReports() })

/** What a question is read as: the same words always read the same, so it is kept. */
export const readQuestionQuery = (question: string) =>
  queryOptions({
    queryKey: queryKeys.readQuestion(question),
    queryFn: () => api.readQuestion({ question }),
    staleTime: Infinity,
  })

export const observabilityPageQuery = (input: ObsPageInput) =>
  queryOptions({
    queryKey: queryKeys.observabilityPage(input),
    queryFn: () => api.observabilityPage(input),
  })

export const observabilitySummaryQuery = (input: ObsSummaryInput) =>
  queryOptions({
    queryKey: queryKeys.observabilitySummary(input),
    queryFn: () => api.observabilitySummary(input),
  })

export const replayQuery = (topic: string, when: 'now' | 'before') =>
  queryOptions({
    queryKey: queryKeys.replay(topic, when),
    queryFn: () => api.replayTopic({ topic, when }),
  })

export const savedQuestionsQuery = () =>
  queryOptions({ queryKey: queryKeys.savedQuestions, queryFn: () => api.getSavedQuestions() })

/** A draft made from pasted text: a read, as it changes nothing until the writer publishes it. */
export const draftFromTextQuery = (text: string) =>
  queryOptions({
    queryKey: queryKeys.draftFromText(text),
    queryFn: () => api.draftFromText({ text }),
    staleTime: Infinity,
  })

/* ---------- the shared reads, loaded before the app is drawn ---------- */

/**
 * The shared reads the screens of a signed-in person use; the shell waits for them once
 * (App.tsx), so a screen reads them from the cache and never waits. Each screen's own load is a
 * page read instead (`*Page`), which its loading state shows.
 */
export const sharedQueries = () => [
  workspaceQuery(),
  vocabularyQuery(),
  libraryQuery(),
  commentsQuery(),
  definitionsQuery(),
  inboxQuery(),
  reviewsQuery(),
  savedQuestionsQuery(),
  alertsQuery(),
  savedViewsQuery(),
  askExamplesQuery(),
  chatsQuery(),
  settingsQuery(),
  integrationsQuery(),
  agentConnectionsQuery(),
  connectReviewQuery(),
]

export const useSession = () => useSuspenseQuery(sessionQuery()).data
/** The workspace, from the cache the shell filled. */
export const useWorkspace = () => useSuspenseQuery(workspaceQuery()).data
/** The library, from the cache the shell filled. */
export const useLibrary = () => useSuspenseQuery(libraryQuery()).data
export const useVocabulary = () => useSuspenseQuery(vocabularyQuery()).data
export const useComments = () => useSuspenseQuery(commentsQuery()).data
export const useDefinitions = () => useSuspenseQuery(definitionsQuery()).data
export const useInbox = () => useSuspenseQuery(inboxQuery()).data
export const useReviews = () => useSuspenseQuery(reviewsQuery()).data
export const useSavedQuestions = () => useSuspenseQuery(savedQuestionsQuery()).data
export const useAlerts = () => useSuspenseQuery(alertsQuery()).data
export const useSavedViews = () => useSuspenseQuery(savedViewsQuery()).data
export const useAskExamples = () => useSuspenseQuery(askExamplesQuery()).data
export const useChats = () => useSuspenseQuery(chatsQuery()).data
export const useSettings = () => useSuspenseQuery(settingsQuery()).data
export const useIntegrations = () => useSuspenseQuery(integrationsQuery()).data
export const useAgentConnections = () => useSuspenseQuery(agentConnectionsQuery()).data

/* ---------- writes ---------- */

type Method<K extends HeedApiMethod> = HeedApi[K]
/** The reads: every other method is a write. */
type Read =
  | 'getSession'
  | 'listSignInPeople'
  | 'getWorkspace'
  | 'getVocabulary'
  | 'getActivity'
  | 'getSignInMethod'
  | 'readInvite'
  | 'getLibrary'
  | 'searchAll'
  | 'searchScope'
  | 'contextPage'
  | 'itemPage'
  | 'getItemHistory'
  | 'getRelated'
  | 'draftFromText'
  | 'getComments'
  | 'getDefinitions'
  | 'definitionsPage'
  | 'definitionPage'
  | 'getDefinitionHistory'
  | 'getInbox'
  | 'inboxPage'
  | 'getReviews'
  | 'getSavedQuestions'
  | 'getSavedCheck'
  | 'getAlerts'
  | 'getSavedViews'
  | 'readQuestion'
  | 'ask'
  | 'getAskExamples'
  | 'askedThisWeek'
  | 'listChats'
  | 'getMyReports'
  | 'getSettings'
  | 'advancedPage'
  | 'getIntegrations'
  | 'integrationsPage'
  | 'integrationPage'
  | 'connectForm'
  | 'testIntegration'
  | 'readFigure'
  | 'tryFigure'
  | 'listAgentConnections'
  | 'checkConnect'
  | 'getConnectReview'
  | 'getConnectRequest'
  | 'observabilityPage'
  | 'observabilitySummary'
  | 'replayTopic'
export type WriteOperation = Exclude<HeedApiMethod, Read>
export type WriteInput<K extends WriteOperation> = Parameters<Method<K>>[0]
export type WriteResult<K extends WriteOperation> = Awaited<ReturnType<Method<K>>>

/** Everything cached: what a sign-in, a sign-out or an Undo may have changed. */
const everything: QueryKey[] = [[]]
/** What a change to the workspace makes stale: its people and domains, and who owns what. */
const workspace: QueryKey[] = [queryKeys.workspace]
/** What a change to context items makes stale: every read of them. */
const items: QueryKey[] = [
  queryKeys.library,
  queryKeys.contextPage,
  queryKeys.itemPages,
  queryKeys.itemHistories,
  queryKeys.relateds,
  queryKeys.replays,
  queryKeys.asks,
  queryKeys.chats,
  queryKeys.askedWeek,
  // What an owner did to an item is a report's outcome.
  queryKeys.myReports,
]
/** What a change to comments makes stale: the threads, and the Inbox's mentions. */
const comments: QueryKey[] = [queryKeys.comments, queryKeys.inbox, queryKeys.inboxPage]
const definitions: QueryKey[] = [
  queryKeys.definitions,
  queryKeys.definitionsPage,
  queryKeys.definitionPages,
  queryKeys.definitionHistories,
  queryKeys.relateds,
  // A synonym changes how a question is read.
  queryKeys.asks,
  queryKeys.chats,
  queryKeys.askedWeek,
]
const inbox: QueryKey[] = [queryKeys.inbox, queryKeys.inboxPage, queryKeys.myReports]
/** What a change to a connected tool makes stale: its row, its page, and its connect form. */
const integrations: QueryKey[] = [
  queryKeys.integrationsPage,
  queryKeys.integrationPages,
  queryKeys.connectForms,
]
/** What a decision on a suggestion makes stale: the Inbox, the items it changed, the saved questions. */
const decision: QueryKey[] = [...inbox, ...items, queryKeys.savedQuestions, queryKeys.comments]

/**
 * What each write makes stale. A screen never names caches itself: a write goes through
 * `useApiWrite`, which refreshes these after the binding answers.
 */
export const invalidations: {
  [K in WriteOperation]: (input: WriteInput<K>, result: WriteResult<K>) => QueryKey[]
} = {
  signIn: () => everything,
  // Only the session: the shell then closes. Every read refetched while it is still open would be
  // 401 requests from a signed-out browser, and they count against the service's per-address limit.
  signOut: () => [queryKeys.session],
  setAbout: () => workspace,
  // A finished checklist ends the new install.
  completeSetupStep: () => [...workspace, queryKeys.session],
  updateDomain: () => workspace,
  addDomain: () => workspace,
  removeDomain: () => [...workspace, ...items],
  setOwner: () => workspace,
  setAdmin: () => workspace,
  invite: () => workspace,
  resendInvite: () => workspace,
  removePerson: () => workspace,
  markViewed: () => [queryKeys.library],
  editItem: () => items,
  restoreAsDraft: () => items,
  // A published item may answer a Not found card, and be the setup checklist's first item.
  saveItem: () => [...items, ...inbox, ...workspace, queryKeys.session, queryKeys.scopeSearches],
  applyBulk: () => [...items, queryKeys.advancedPage],
  sendSuggestion: () => [...inbox, queryKeys.scopeSearches],
  withdrawSuggestion: () => inbox,
  undo: () => everything,
  postComment: () => comments,
  reactToComment: () => [queryKeys.comments],
  reactToSubject: () => [queryKeys.comments],
  editComment: () => comments,
  removeComment: () => comments,
  // The suggestion's review reads whether its sender took it back.
  withdrawWithComment: () => [...comments, queryKeys.reviews],
  resolveComment: () => [queryKeys.comments],
  markThreadSeen: () => [queryKeys.comments],
  markMentionSeen: () => comments,
  saveTerm: () => definitions,
  addSynonym: () => definitions,
  removeTerm: () => definitions,
  deleteTerms: () => [...definitions, queryKeys.library, queryKeys.advancedPage],
  moveTerms: () => definitions,
  markOpened: () => inbox,
  markReviewed: () => inbox,
  decideCard: () => [...inbox, ...items],
  completeCard: () => inbox,
  publishReview: () => decision,
  publishReviews: () => decision,
  archiveReview: () => decision,
  closeReview: () => inbox,
  returnReview: () => [...inbox, ...comments],
  saveQuestion: () => [queryKeys.savedQuestions],
  removeSavedQuestion: () => [queryKeys.savedQuestions],
  keepNewAnswer: () => [queryKeys.savedQuestions],
  checkSavedQuestions: () => [queryKeys.savedQuestions, queryKeys.savedCheck],
  setAlertRule: () => [queryKeys.alerts],
  saveView: () => [queryKeys.savedViews],
  saveChat: () => [queryKeys.chats],
  reportAnswer: () => [queryKeys.myReports, ...inbox],
  // Related says whether agents follow links.
  setLinks: () => [queryKeys.settings, queryKeys.relateds],
  setTool: () => [queryKeys.settings],
  setPause: () => [queryKeys.settings, queryKeys.advancedPage],
  // A new key is listed on Connected agents; the history log notes it.
  createAccessKey: () => [queryKeys.agentConnections, queryKeys.advancedPage],
  // Checking and exporting change nothing.
  checkHistory: () => [],
  exportHistory: () => [],
  exportContext: () => [],
  setFigures: () => [queryKeys.settings, queryKeys.figures, queryKeys.integrations],
  setDataContact: () => [queryKeys.settings, queryKeys.figures, queryKeys.integrations],
  setFigureConnection: () => [queryKeys.settings, queryKeys.figures, queryKeys.integrations],
  // Connecting the definitions tool can be the setup checklist's last step.
  connectIntegration: () => [queryKeys.settings, ...integrations, ...workspace, queryKeys.session],
  changeIntegration: () => integrations,
  // A content tool's open suggestions leave the Inbox with it.
  disconnectIntegration: () => [queryKeys.settings, ...integrations, ...inbox],
  readIntegration: () => integrations,
  pauseIntegration: () => [...integrations, queryKeys.advancedPage],
  revokeAgentConnection: () => [queryKeys.agentConnections, queryKeys.advancedPage],
  // A yes adds a connected agent; the page then leaves for the agent.
  answerConnectRequest: () => [queryKeys.agentConnections],
  renameChat: () => [queryKeys.chats],
  deleteChat: () => [queryKeys.chats],
  removeView: () => [queryKeys.savedViews],
  muteAlert: () => [queryKeys.alerts],
  setAlertThreshold: () => [queryKeys.alerts],
}

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

/** Marks every cache a write made stale, so open screens fetch them again. */
export async function invalidateAfter<K extends WriteOperation>(
  queryClient: QueryClient,
  operation: K,
  input: WriteInput<K>,
  result: WriteResult<K>,
) {
  const keys = coveringKeys(invalidations[operation](input, result))
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

/** Calls a write and refreshes what it made stale; its pending and failed states are the mutation's. */
export function useApiWrite<K extends WriteOperation>(operation: K) {
  const queryClient = useQueryClient()
  return useMutation<WriteResult<K>, Error, WriteInput<K>>({
    mutationKey: ['write', operation],
    mutationFn: (input) =>
      (api[operation] as (input: WriteInput<K>) => Promise<WriteResult<K>>)(input),
    onSuccess: (result, input) => invalidateAfter(queryClient, operation, input, result),
  })
}

/**
 * A write outside a mutation's own state, for a handler that does several in a row (an Undo, a
 * mark as read): it refreshes what each makes stale.
 */
export function useWrite() {
  const queryClient = useQueryClient()
  return async <K extends WriteOperation>(
    operation: K,
    input: WriteInput<K>,
  ): Promise<WriteResult<K>> => {
    const result = await (api[operation] as (input: WriteInput<K>) => Promise<WriteResult<K>>)(
      input,
    )
    await invalidateAfter(queryClient, operation, input, result)
    return result
  }
}

/**
 * Refreshes what a write made stale, for a screen that called the binding itself and shows the
 * outcome first (rows that leave, then the list without them).
 */
export function useRefreshAfter() {
  const queryClient = useQueryClient()
  return <K extends WriteOperation>(operation: K, input: WriteInput<K>, result: WriteResult<K>) =>
    invalidateAfter(queryClient, operation, input, result)
}

/** The page reads (a screen's own load): what a review flag that sets a fault starts again. */
export const isPageQuery = (key: QueryKey) => typeof key[0] === 'string' && isPageRead(key[0])
