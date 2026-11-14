import * as React from 'react'
import {
  queryOptions,
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import type { SourceRead } from '@domain/source-state'
import { api, type HeedApi, type HeedApiMethod } from '@/api'
import {
  isPageRead,
  type readMethods,
  type Library,
  type ObsFilterView,
  type ObsPageInput,
  type ObsValuesInput,
  type ScopeSearchInput,
} from '@/api/client'
import { reportSignedOut } from '@/api/query-client'
import type { AskInput } from '@/model/ask'
import type { FigureAsk } from '@/model/figures'
import type { Source } from '@/model/integrations'

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
  conflicts: (whose: 'mine' | 'all') => ['conflicts', whose] as const,
  conflictLists: ['conflicts'] as const,
  conflict: (key: string) => ['conflict', key] as const,
  conflictPairs: ['conflict'] as const,
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
  names: ['getNames'] as const,
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
  integrationLeftOut: (id: string, readsAll: boolean, views: readonly string[]) =>
    ['integrationLeftOut', id, readsAll, [...views].sort()] as const,
  connectForms: ['connectForm'] as const,
  figure: (asked: FigureAsk) => ['readFigure', asked] as const,
  figures: ['readFigure'] as const,
  agentConnections: ['listAgentConnections'] as const,
  autoPublish: ['getAutoPublish'] as const,
  domainPolicies: (domain: string) => ['getDomainPolicies', domain] as const,
  allDomainPolicies: ['getDomainPolicies'] as const,
  connectReview: ['getConnectReview'] as const,
  connectRequest: ['getConnectRequest'] as const,
  observabilityPage: (input: ObsPageInput) => ['observabilityPage', input] as const,
  observabilityPages: ['observabilityPage'] as const,
  obsDimensions: (input: ObsFilterView) => ['obsDimensions', input] as const,
  obsDimensionLists: ['obsDimensions'] as const,
  obsValues: (input: ObsValuesInput) => ['obsValues', input] as const,
  obsValueLists: ['obsValues'] as const,
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

/** The Conflicts list, mine or all. */
export const conflictsQuery = (whose: 'mine' | 'all') =>
  queryOptions({ queryKey: queryKeys.conflicts(whose), queryFn: () => api.conflicts({ whose }) })

/** One pair, by its address `holderId.otherId`. */
export const conflictQuery = (key: string) => {
  const [holderId = '', otherId = ''] = key.split('.')
  return queryOptions({
    queryKey: queryKeys.conflict(key),
    queryFn: () => api.conflict({ holderId, otherId }),
  })
}

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

export const namesQuery = () =>
  queryOptions({ queryKey: queryKeys.names, queryFn: () => api.getNames() })
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
 * While a tool waits for its read (queued, or being read), its row and its page ask again every
 * few seconds, so Queued and Reading end when the read does.
 */
const READING_POLL_MS = 3_000
/** A queued read waits for the job's next turn, up to five minutes: no need to ask as often. */
const QUEUED_POLL_MS = 10_000
/** A tool's pending read; none while it is paused. */
const readOf = (source: Source | undefined) =>
  source?.state.intent === 'active' ? source.state.read : null
const pollFor = (reads: readonly (SourceRead | null | undefined)[]) =>
  reads.includes('reading') ? READING_POLL_MS : reads.includes('queued') ? QUEUED_POLL_MS : false

/** Settings › Integrations: the tools connected, and what can be connected. */
export const integrationsPageQuery = () =>
  queryOptions({
    queryKey: queryKeys.integrationsPage,
    queryFn: () => api.integrationsPage(),
    refetchInterval: (query) => pollFor(query.state.data?.sources.map(readOf) ?? []),
  })

/** One connected tool's page. */
export const integrationPageQuery = (id: string) =>
  queryOptions({
    queryKey: queryKeys.integrationPage(id),
    queryFn: () => api.integrationPage({ id }),
    refetchInterval: (query) => pollFor([readOf(query.state.data?.source)]),
  })

/** The connect flow's form: a tool to connect, or one connected whose settings change. */
export const connectFormQuery = (id: string) =>
  queryOptions({ queryKey: queryKeys.connectForm(id), queryFn: () => api.connectForm({ id }) })

/** What a change of the views a definitions tool reads would stop reading; it changes nothing. */
export const integrationLeftOutQuery = (id: string, readsAll: boolean, views: readonly string[]) =>
  queryOptions({
    queryKey: queryKeys.integrationLeftOut(id, readsAll, views),
    queryFn: () => api.integrationLeftOut({ id, readsAll, views: [...views] }),
  })

export const figureQuery = (asked: FigureAsk) =>
  queryOptions({ queryKey: queryKeys.figure(asked), queryFn: () => api.readFigure(asked) })

export const agentConnectionsQuery = () =>
  queryOptions({
    queryKey: queryKeys.agentConnections,
    queryFn: () => api.listAgentConnections(),
  })

/** Publishing without review: the workspace switch, for an admin (FR-421). */
export const autoPublishQuery = () =>
  queryOptions({ queryKey: queryKeys.autoPublish, queryFn: () => api.getAutoPublish() })

/** One domain's policies to publish without review, and the apps one may be for. */
export const domainPoliciesQuery = (domain: string) =>
  queryOptions({
    queryKey: queryKeys.domainPolicies(domain),
    queryFn: () => api.getDomainPolicies({ domain }),
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

/** Overview's filter, its first step: the dimensions, for a view and its filters. */
export const obsDimensionsQuery = (input: ObsFilterView) =>
  queryOptions({
    queryKey: queryKeys.obsDimensions(input),
    queryFn: () => api.obsDimensions(input),
  })

/** Its second step: a page of a dimension's values, or the words in every dimension. */
export const obsValuesQuery = (input: ObsValuesInput) =>
  queryOptions({
    queryKey: queryKeys.obsValues(input),
    queryFn: () => api.obsValues(input),
  })

/**
 * A dimension's first page of values, counted without its own filter (so a tick reads nothing
 * again): one read for its facet and the picker's step, so whichever opens second has them at once.
 */
export const dimensionValuesQuery = (
  view: ObsFilterView,
  dimension: string,
  q = '',
  sort: ObsValuesInput['sort'] = 'asked',
) =>
  obsValuesQuery({
    ...view,
    filters: view.filters.filter((f) => f.key !== dimension),
    dimension,
    q,
    sort,
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

/**
 * Inside the dock, the shared reads are what the shell holds: opening a panel reads none of them
 * again. Each new observer of a read older than staleTime would otherwise fetch it once more, so a
 * quick view sent a dozen reads it does not need ahead of its own. The page behind keeps them as
 * fresh as before: a write refreshes what it changed, and so does the tab coming back.
 */
export const InDock = React.createContext(false)

/** A shared read's options as a place reads it: in the dock, without fetching it on mount. */
export const sharedReadIn = <O extends object>(options: O, inDock: boolean): O =>
  inDock ? { ...options, refetchOnMount: false } : options

const useSharedRead = <O extends object>(options: O): O =>
  sharedReadIn(options, React.useContext(InDock))

export const useSession = () => useSuspenseQuery(useSharedRead(sessionQuery())).data
/** The workspace, from the cache the shell filled. */
export const useWorkspace = () => useSuspenseQuery(useSharedRead(workspaceQuery())).data
/** The library, from the cache the shell filled. */
export const useLibrary = () => useSuspenseQuery(useSharedRead(libraryQuery())).data
export const useVocabulary = () => useSuspenseQuery(useSharedRead(vocabularyQuery())).data
export const useComments = () => useSuspenseQuery(useSharedRead(commentsQuery())).data
export const useDefinitions = () => useSuspenseQuery(useSharedRead(definitionsQuery())).data
export const useInbox = () => useSuspenseQuery(useSharedRead(inboxQuery())).data
export const useReviews = () => useSuspenseQuery(useSharedRead(reviewsQuery())).data
export const useSavedQuestions = () => useSuspenseQuery(useSharedRead(savedQuestionsQuery())).data
export const useAlerts = () => useSuspenseQuery(useSharedRead(alertsQuery())).data
export const useSavedViews = () => useSuspenseQuery(useSharedRead(savedViewsQuery())).data
export const useAskExamples = () => useSuspenseQuery(useSharedRead(askExamplesQuery())).data
export const useChats = () => useSuspenseQuery(useSharedRead(chatsQuery())).data
export const useSettings = () => useSuspenseQuery(useSharedRead(settingsQuery())).data
export const useIntegrations = () => useSuspenseQuery(useSharedRead(integrationsQuery())).data
export const useAgentConnections = () =>
  useSuspenseQuery(useSharedRead(agentConnectionsQuery())).data

/* ---------- writes ---------- */

type Method<K extends HeedApiMethod> = HeedApi[K]
type Read = (typeof readMethods)[number]
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
  // A change to an item may start or end a conflict, or bring a kept pair back.
  queryKeys.conflictLists,
  queryKeys.conflictPairs,
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
/**
 * What a new live version of an item makes stale besides the items: the reviews, since a suggestion
 * written against the version before is stale now (src/domain/suggestion-standing.ts).
 */
const live: QueryKey[] = [...items, queryKeys.reviews]
/** What a decision on a suggestion makes stale: the Inbox, the items it changed, the saved questions. */
const decision: QueryKey[] = [...inbox, ...live, queryKeys.savedQuestions, queryKeys.comments]

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
  revokeInvite: () => workspace,
  removePerson: () => workspace,
  // Set in place (`inPlace`): opening an item changes nothing else the library holds.
  markViewed: () => [],
  editItem: () => items,
  restoreAsDraft: () => items,
  // A published item may answer a Not found card, and be the setup checklist's first item.
  saveItem: () => [...live, ...inbox, ...workspace, queryKeys.session, queryKeys.scopeSearches],
  applyBulk: () => [...live, queryKeys.advancedPage],
  sendSuggestion: () => [...inbox, queryKeys.scopeSearches],
  withdrawSuggestion: () => inbox,
  undo: () => everything,
  // Settling archives an item, publishes a version or keeps both: the items, the Inbox's alert and
  // the comment that tells the other owners all move.
  settleConflict: () => [...live, ...inbox, ...comments, queryKeys.savedQuestions],
  suggestArchiving: () => inbox,
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
  // The first names start the vocabulary: every page reads it.
  decideNames: () => everything,
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
  setTool: () => [queryKeys.settings, queryKeys.agentConnections, queryKeys.allDomainPolicies],
  setPause: () => [queryKeys.settings, queryKeys.advancedPage],
  // A new key is listed on Connected agents; the history log notes it.
  createAccessKey: () => [queryKeys.agentConnections, queryKeys.advancedPage],
  renameAccessKey: () => [queryKeys.agentConnections, queryKeys.advancedPage],
  // suggest_context off pauses the agent's policies.
  setAgentTool: () => [
    queryKeys.agentConnections,
    queryKeys.advancedPage,
    queryKeys.allDomainPolicies,
  ],
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
  // A paused tool's figures are held in Ask, and back once it is resumed.
  pauseIntegration: () => [
    ...integrations,
    queryKeys.integrations,
    queryKeys.figures,
    queryKeys.advancedPage,
  ],
  // A revoked app's policies end with it.
  revokeAgent: () => [
    queryKeys.agentConnections,
    queryKeys.advancedPage,
    queryKeys.autoPublish,
    queryKeys.allDomainPolicies,
  ],
  // Publishing without review: Agents and access, the domain pages and the history log show it.
  setAutoPublish: () => [
    queryKeys.autoPublish,
    queryKeys.agentConnections,
    queryKeys.allDomainPolicies,
    queryKeys.advancedPage,
  ],
  setAgentPolicy: () => [
    queryKeys.autoPublish,
    queryKeys.agentConnections,
    queryKeys.allDomainPolicies,
    queryKeys.advancedPage,
  ],
  endAgentPolicy: () => [
    queryKeys.autoPublish,
    queryKeys.agentConnections,
    queryKeys.allDomainPolicies,
    queryKeys.advancedPage,
  ],
  // A yes adds a connected agent; the page then leaves for the agent.
  answerConnectRequest: () => [queryKeys.agentConnections],
  renameChat: () => [queryKeys.chats],
  deleteChat: () => [queryKeys.chats],
  removeView: () => [queryKeys.savedViews],
  pinDimensions: () => [queryKeys.obsDimensionLists, queryKeys.settings, queryKeys.advancedPage],
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

/**
 * What a write changes that the app can say itself, set in its cache in place of reading the
 * whole cache again. Opening an item marks it opened; read again, the library is five requests.
 */
const inPlace: {
  [K in WriteOperation]?: (queryClient: QueryClient, input: WriteInput<K>) => void
} = {
  markViewed: (queryClient, { id }) =>
    queryClient.setQueryData<Library>(queryKeys.library, (library) =>
      library && !library.viewed[id]
        ? { ...library, viewed: { ...library.viewed, [id]: true } }
        : library,
    ),
}

/** Marks every cache a write made stale, so open screens fetch them again. */
export async function invalidateAfter<K extends WriteOperation>(
  queryClient: QueryClient,
  operation: K,
  input: WriteInput<K>,
  result: WriteResult<K>,
) {
  // Someone else now: a read still under way for the last person must not land in the new one's
  // cache, and what was read for them is not shown again. The sign-in page's own reads stay.
  if (operation === 'signIn') {
    await queryClient.cancelQueries()
    queryClient.removeQueries({ type: 'inactive' })
  }
  inPlace[operation]?.(queryClient, input)
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
    let result: WriteResult<K>
    try {
      result = await (api[operation] as (input: WriteInput<K>) => Promise<WriteResult<K>>)(input)
    } catch (error) {
      reportSignedOut(queryClient, error)
      throw error
    }
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
