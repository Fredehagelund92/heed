/**
 * The one boundary between the new web app (src/app) and its data: `HeedApi`. Two bindings
 * implement it. The mock binding (mock/) answers from the demo world's fixtures and runs its rules
 * in memory, with the scenarios a review needs (a page that loads slowly or fails, being offline, a
 * fresh install). The http binding (http.ts) talks to the Heed service through the API contract
 * (src/contract). `index.ts` picks one; no page knows which.
 *
 * Reads are per screen where a screen joins many sources (a `*Page` read is the one its loading
 * state shows), and shared where many places read the same thing (the session, the workspace, the
 * library). Writes are one operation each. A write that can be taken back answers with an `undo`
 * token, and `undo` puts back exactly what it changed. Both bindings throw `ApiError` (errors.ts).
 */
import type { JSONContent } from '@tiptap/core'
import type { ReactionEmoji } from '@/components/templates/comment-box/types'
import type { FactAction } from '@/lib/bulk'
import type { Definition, DefinitionType, SynonymCheck } from '@/lib/definitions'
import type { Answer, AskedWeek, AskInput, Example, Thread } from '@/model/ask'
import type { Comments, MentionNote, Subject } from '@/model/comments'
import type { DomainId, Fact, Kind, LogEntry, Metric, Sent } from '@/model/items'
import type { Version } from '@/model/history'
import type { InboxCard, Outcome, Waiting } from '@/model/inbox'
import type { Alerts, RuleId } from '@/model/alerts'
import type { FigureView } from '@/model/figures'
import type {
  Activity as ToolActivity,
  ConnectorId,
  CubeView,
  DriveDocument,
  DriveFolder,
  FigureConnection,
  IntegrationState,
} from '@/model/integrations'
import type { Connected, LivePhase } from '@/lib/connect'
import type { Filters, SavedView } from '@/lib/obs-views'
import type { ObsData } from '@/model/observability'
import type { Replay, When } from '@/model/replay'
import type { Domain, Person } from '@/model/people'
import type { Review } from '@/model/review'
import type { SavedQuestion } from '@/model/saved-questions'

/* ---------- session and workspace ---------- */

export type Session = {
  /** Who is signed in, by name; null when nobody is. */
  user: string | null
  /** A new install shows the setup checklist until it is done. */
  install: 'new' | 'normal'
  /** Started as a new install: no demo context or cards, only what this visit adds. */
  fresh: boolean
}

export type Workspace = {
  /** The workspace's name, as an admin set it in General. */
  name: string
  domains: Domain[]
  people: Person[]
  /** What the business is about, in its own words: every agent reads it first. */
  about: string
  /** What Start from the guide fills in: a worked example of that text. */
  aboutTemplate: string
  /** Which steps of a new install's setup checklist are done, by step id (lib/setup.ts). */
  setup: { done: Record<string, boolean> }
}

/** The vocabulary the definitions source names: its metrics, dimensions and the markets agents ask about. */
export type Vocabulary = {
  metrics: Metric[]
  dimensions: { name: string; values: string; definition: string }[]
  /** The values of the Market dimension, each a real country. */
  markets: string[]
}

/** A few quiet lines on what someone did lately. */
export type Activity = { what: string; when: string }

/** The result of a write that can be taken back: pass `undo` to `HeedApi.undo`. */
export type Undoable = { undo: string }

/* ---------- the library ---------- */

/** Every context item the person may read, with what this visit did to them. */
export type Library = {
  items: Fact[]
  /** Items published this visit, and when, in words: the item says so on its page. */
  published: Record<string, string>
  /** Items the person opened, in the peek or on their page: only these can be marked checked together. */
  viewed: Record<string, boolean>
  /** Changes made to many items at once, newest first. */
  log: LogEntry[]
}

/**
 * What search everywhere (the command palette) finds for some words, grouped, each group best
 * match first and a few long: context, definitions, domains and people.
 */
export type SearchHits = {
  items: { id: string; title: string; kind: Kind; domain: DomainId }[]
  definitions: { name: string; type: DefinitionType; sameAs?: string; sourceNames: string[] }[]
  domains: { id: DomainId; name: string }[]
  people: { name: string }[]
}

/* ---------- the Inbox and the review ---------- */

/** The Inbox's cards and what was decided on them. A new install has none. */
export type Inbox = {
  /** Every card, each with the person whose Inbox it lands in. */
  cards: InboxCard[]
  /** Suggestions people sent that wait on an owner. */
  waiting: Waiting[]
  /** Suggestions sent from the editor this visit, waiting for an owner. */
  sent: Sent[]
  done: Record<string, Outcome>
  /** Cards the person has opened, in the quick view or the review: the unread dot goes. */
  opened: Record<string, boolean>
  /**
   * Suggestions the person has read in the review: the end of the change was on screen for a few
   * seconds, or they marked it read. Only these can be published together.
   */
  reviewed: Record<string, boolean>
  /**
   * This week's questions from agents, as counts: no question text, no names. A count under the
   * minimum is null, and so is what most questions that found nothing were about.
   */
  week: {
    asked: number | null
    found: number | null
    nothing: number | null
    mostAbout: string | null
  }
  /** The comments that mention the person and that they haven't read, with what they hang on. */
  mentions: (MentionNote & { title: string })[]
}

/** Where the last check of the saved questions stands: running (so far `checked` of them), or failed. */
export type SavedCheck = { run: 'idle' | 'running' | 'failed'; checked: number }

/** The workspace's switches an admin sets in Settings and on an integration's page. */
export type Settings = {
  /** Let agents follow links (get_related). */
  links: boolean
  /** Whether Ask shows figures, per figure-capable integration: off until an admin turns it on. */
  figures: Partial<Record<ConnectorId, boolean>>
  /** Who answers for each integration's data, by name. */
  contacts: Partial<Record<ConnectorId, string>>
  /** The integrations connected. */
  connected: ConnectorId[]
}

/** What the integrations read: Cube's views, the Drive folders and documents, each tool's activity. */
export type Integrations = {
  /** A sync's state, for the integrations' pages. */
  state: IntegrationState
  cubeViews: CubeView[]
  driveFolders: DriveFolder[]
  driveDocuments: DriveDocument[]
  activity: { cube: ToolActivity[]; drive: ToolActivity[] }
  /** How each figure-capable integration is reached. */
  figureConnections: Partial<Record<ConnectorId, FigureConnection>>
  /** What the warehouse has tables for. It answers none of them: no metric's definition comes from it. */
  warehouseHas: string[]
}

/** How a suggestion that overlaps a live item relates to it, as the owner chose. */
export type Relation = 'replaces' | 'disagree' | 'unrelated'

/** A context item's page: the item and its versions, newest first. */
export type ItemPage = { item: Fact; history: Version[] }

/**
 * A change to many items at once: what it does, their edits, the drafts it deletes, and its line in
 * History. Where it moves them, the kind it gives them and the owner it adds or sets are named
 * too, so a binding that makes the change itself need not read them back from the edits.
 */
export type BulkChange = {
  action: FactAction
  /** Change domain: where to. */
  domain?: DomainId
  /** Change kind: to what. */
  kind?: Kind
  /** Add or change owner: who, by name. */
  person?: string
  patches: Record<string, Partial<Fact>>
  remove: string[]
  entry: LogEntry
}

export interface HeedApi {
  // Session and workspace
  getSession: () => Promise<Session>
  /** The people the demo's sign-in offers, by name. Needs no session. */
  listSignInPeople: () => Promise<string[]>
  /** Signs in as one of them; `fresh` starts as a new install. */
  signIn: (input: { name: string; fresh: boolean }) => Promise<Session>
  signOut: () => Promise<void>
  getWorkspace: () => Promise<Workspace>
  getVocabulary: () => Promise<Vocabulary>
  /** What someone did lately: the context they checked. */
  getActivity: (input: { name: string }) => Promise<Activity[]>
  setAbout: (input: { text: string }) => Promise<void>
  completeSetupStep: (input: { step: string }) => Promise<void>

  // Domains and people
  updateDomain: (input: {
    id: DomainId
    name?: string
    owners?: string[]
    text?: string
  }) => Promise<void>
  /** A new domain; its id is made from the name. */
  addDomain: (input: { name: string; owners: string[]; text?: string }) => Promise<{ id: DomainId }>
  removeDomain: (input: { id: DomainId }) => Promise<void>
  /** Makes someone an owner of a domain, or not. A domain always keeps one owner: `last` refuses. */
  setOwner: (input: {
    name: string
    domain: DomainId
    own: boolean
  }) => Promise<{ done: true } | { done: false; last: true }>
  setAdmin: (input: { name: string; admin: boolean }) => Promise<void>
  /** Invites people by address: a member or an admin, owners of the chosen domains from the start. */
  invite: (input: { emails: string[]; admin: boolean; owns: DomainId[] }) => Promise<void>
  /**
   * Takes back an invite or removes someone, unless they own a domain alone: those domains come
   * back instead, to hand over first.
   */
  removePerson: (input: {
    name: string
  }) => Promise<({ removed: true } & Undoable) | { removed: false; alone: DomainId[] }>

  // The library
  getLibrary: () => Promise<Library>
  /** Search everywhere: what the words find, a few of each. Nothing for words that are only spaces. */
  searchAll: (input: { q: string }) => Promise<SearchHits>
  /** The Context page's list: every item, drafts included. */
  contextPage: () => Promise<Fact[]>
  /** A context item's page; null for an unknown id. */
  itemPage: (input: { id: string }) => Promise<ItemPage | null>
  /** An item's versions, newest first. */
  getItemHistory: (input: { id: string }) => Promise<Version[]>
  /**
   * Brings the words of an earlier version (`v`, as its history numbers it) back as a new draft,
   * for an owner of its domain or an admin. What agents get does not change until it is published.
   */
  restoreAsDraft: (input: { id: string; v: number }) => Promise<{ id: string }>
  /** The person opened an item. */
  markViewed: (input: { id: string }) => Promise<void>
  /** Changes some of an item's fields in place, as its owner: a check that it is still true. */
  editItem: (input: { id: string; patch: Partial<Fact> }) => Promise<void>
  /**
   * Publishes an item as its owner: changes to an existing item, or a new one, which gets its id.
   * `relations` says how it relates to each live item it overlaps, by that item's id, as the
   * owner answered in the editor. `gap` is the Not found card it answers; `setup` says it is the
   * setup checklist's first item.
   */
  saveItem: (input: {
    fact: Fact
    isNew: boolean
    relations?: Record<string, Relation>
    gap?: string
    setup?: boolean
  }) => Promise<{ id: string }>
  /** A draft made from pasted text or a link: every field filled in, for the writer to check. */
  draftFromText: (input: { text: string }) => Promise<Fact>
  /**
   * Changes many items at once, with its line in History. It acts on every row it can; `failed`
   * names the rows a failure left unchanged, to try again.
   */
  applyBulk: (input: BulkChange) => Promise<{ done: string[]; failed: string[] } & Undoable>
  /**
   * A suggestion sent from the editor to the owners: `fact` is the version it suggests. It waits,
   * visibly, until they decide.
   */
  sendSuggestion: (input: { sent: Omit<Sent, 'id'>; fact: Fact }) => Promise<{ id: string }>
  withdrawSuggestion: (input: { id: string }) => Promise<void>
  /** Takes back exactly what one write changed, and nothing done since. */
  undo: (input: { token: string }) => Promise<void>

  // Comments and reactions, by what they hang on. Agents never read any of it.
  getComments: () => Promise<Comments>
  postComment: (input: {
    subject: Subject
    content: JSONContent
    parentId?: string
    /** The note a suggestion was returned with. */
    returned?: boolean
  }) => Promise<{ id: string }>
  reactToComment: (input: { subject: Subject; id: string; emoji: ReactionEmoji }) => Promise<void>
  reactToSubject: (input: { subject: Subject; emoji: ReactionEmoji }) => Promise<void>
  editComment: (input: { subject: Subject; id: string; content: JSONContent }) => Promise<void>
  removeComment: (input: { subject: Subject; id: string }) => Promise<void>
  /** The person opened the thread: a new reply's marker goes. */
  markThreadSeen: (input: { subject: Subject }) => Promise<void>
  /** The person read the comments that mention them there: their Inbox marker goes. */
  markMentionSeen: (input: { subject: Subject }) => Promise<void>

  // Definitions: synced metrics and dimensions, and the terms and synonyms written here
  getDefinitions: () => Promise<Definition[]>
  /** The Definitions page's list. */
  definitionsPage: () => Promise<Definition[]>
  /** A definition's versions, newest first: a term's edits, a synced one's changes from its tool. */
  getDefinitionHistory: (input: { name: string }) => Promise<Version[]>
  /** A definition's page; null for an unknown name. */
  definitionPage: (input: { name: string }) => Promise<Definition | null>
  /** Saves a term; a renamed one replaces the old entry. Synced definitions are never saved here. */
  saveTerm: (input: { previous?: string; term: Definition }) => Promise<void>
  /** Another name for a definition, refused when the word already means something. */
  addSynonym: (input: {
    target: string
    word: string
  }) => Promise<{ ok: true; created: boolean } | Exclude<SynonymCheck, { ok: true }>>
  /** Removes a synonym: the term only existed to point at its definition. */
  removeTerm: (input: { name: string }) => Promise<Undoable>
  /** Deletes terms, with the synonyms that only pointed at them, and says so in Settings, Advanced. */
  deleteTerms: (input: { names: string[]; entry: LogEntry }) => Promise<Undoable>
  moveTerms: (input: { names: string[]; domain: DomainId }) => Promise<Undoable>

  // The Inbox and the review
  getInbox: () => Promise<Inbox>
  /** The Inbox page's own read. */
  inboxPage: () => Promise<Inbox>
  getReviews: () => Promise<Review[]>
  /** The person opened these cards. */
  markOpened: (input: { ids: string[] }) => Promise<void>
  /** The person read this suggestion in the review. */
  markReviewed: (input: { id: string }) => Promise<void>
  /** A decision on a card in the Inbox, with the change it makes to its item, if any. */
  decideCard: (input: { card: string; outcome: string; patch?: Partial<Fact> }) => Promise<Undoable>
  /** A card closed without a decision of its own (a report that is not a problem). */
  completeCard: (input: { card: string; outcome: string }) => Promise<Undoable>
  /** Publishes a suggestion; `saveQuestion` also saves a Not found draft's question. */
  publishReview: (input: {
    id: string
    relation?: Relation | null
    saveQuestion?: boolean
  }) => Promise<Undoable>
  /** Publishes the ready suggestions the person has read, each as one Publish would. */
  publishReviews: (input: { ids: string[] }) => Promise<Undoable>
  /** Archives the item a retirement suggests archiving. */
  archiveReview: (input: { id: string }) => Promise<Undoable>
  /** Closes a suggestion its sender withdrew: nothing changes. */
  closeReview: (input: { id: string }) => Promise<Undoable>
  /** Returns a suggestion with a note, which becomes the first comment. */
  returnReview: (input: { id: string; note: JSONContent }) => Promise<Undoable>

  // Ask
  /** What a question is read as, the way get_context reads it, with no model: a metric and markets. */
  readQuestion: (input: { question: string }) => Promise<{ metric: string; markets: string[] }>
  /** The answer Ask gives: from checked context, the way an agent gets it, with its state. */
  ask: (input: AskInput) => Promise<Answer>
  /** What agents asked about most this week, each topic with the state Ask gives it now. */
  askedThisWeek: () => Promise<AskedWeek>
  /** The curated example questions, one for each state an answer can have. */
  getAskExamples: () => Promise<Example[]>
  /** The person's chats under Ask, newest first. */
  listChats: () => Promise<Thread[]>
  saveChat: (input: { id: string; question: string }) => Promise<void>
  renameChat: (input: { id: string; title: string }) => Promise<void>
  deleteChat: (input: { id: string }) => Promise<Undoable>

  // Observability: what agents asked and how it was answered, as scopes and counts only
  getObservability: () => Promise<ObsData>
  /** An Observability page's own read: `section` is the page (overview, questions, and so on). */
  observabilityPage: (input: { section: string }) => Promise<ObsData>
  /** The views people saved on Questions, beyond the five every workspace starts with. */
  getSavedViews: () => Promise<SavedView[]>
  saveView: (input: { name: string; filters: Filters }) => Promise<{ id: string }>
  removeView: (input: { id: string }) => Promise<void>
  /** A topic run again, step by step, on what agents get now or got before the last publish. */
  replayTopic: (input: { topic: string; when: When }) => Promise<Replay | null>

  // Alerts: rules that raise Inbox cards
  getAlerts: () => Promise<Alerts>
  /** An admin turns a rule on or off for everyone. */
  setAlertRule: (input: { id: RuleId; on: boolean }) => Promise<void>
  /** An owner mutes a rule for their domains: its cards stop reaching them, not anyone else. */
  muteAlert: (input: { id: RuleId; domains: DomainId[]; muted: boolean }) => Promise<void>
  setAlertThreshold: (input: { id: RuleId; value: string }) => Promise<void>

  // Settings, integrations and agents
  getSettings: () => Promise<Settings>
  setLinks: (input: { on: boolean }) => Promise<void>
  setFigures: (input: { source: ConnectorId; on: boolean }) => Promise<void>
  setDataContact: (input: { source: ConnectorId; name: string }) => Promise<void>
  connectIntegration: (input: { id: ConnectorId; setup?: boolean }) => Promise<void>
  disconnectIntegration: (input: { id: ConnectorId }) => Promise<void>
  getIntegrations: () => Promise<Integrations>
  /** What an answer shows of the data: one figure line, a link into the tool, or why there is none. */
  readFigure: (input: {
    metric: string
    markets: string[]
    dates?: string
    state: string
  }) => Promise<FigureView | null>
  /** The agents connected, newest sign-in first. */
  listAgentConnections: () => Promise<Connected[]>
  revokeAgentConnection: (input: { agent: string; who: string }) => Promise<void>
  /**
   * Whether an agent signed in since a wait began (`since`, ms): the live line asks every few
   * seconds. Connected names the agent as it reported itself.
   */
  checkConnect: (input: {
    since: number
    agent: string
  }) => Promise<{ state: 'waiting' | 'connected' | 'declined'; agent?: string }>
  /** The live line's state a review address shows (the mock's ?connect=); null otherwise. */
  getConnectReview: () => Promise<LivePhase | null>

  // Saved questions
  getSavedQuestions: () => Promise<SavedQuestion[]>
  /** Where the check of every saved question stands. */
  getSavedCheck: () => Promise<SavedCheck>
  saveQuestion: (input: {
    question: Omit<SavedQuestion, 'result' | 'why' | 'when' | 'id'>
  }) => Promise<{ id: string } & Undoable>
  removeSavedQuestion: (input: { id: string }) => Promise<void>
  /** Keep the new answer: what it says now becomes what it should say. */
  keepNewAnswer: (input: { id: string }) => Promise<Undoable>
}

/** Every method of `HeedApi`, once. The compiler checks the list is complete. */
export const heedApiMethods = [
  'getSession',
  'listSignInPeople',
  'signIn',
  'signOut',
  'getWorkspace',
  'getVocabulary',
  'getActivity',
  'setAbout',
  'completeSetupStep',
  'updateDomain',
  'addDomain',
  'removeDomain',
  'setOwner',
  'setAdmin',
  'invite',
  'removePerson',
  'getLibrary',
  'searchAll',
  'contextPage',
  'itemPage',
  'getItemHistory',
  'restoreAsDraft',
  'markViewed',
  'editItem',
  'draftFromText',
  'saveItem',
  'applyBulk',
  'sendSuggestion',
  'withdrawSuggestion',
  'undo',
  'getComments',
  'postComment',
  'reactToComment',
  'reactToSubject',
  'editComment',
  'removeComment',
  'markThreadSeen',
  'markMentionSeen',
  'getDefinitions',
  'definitionsPage',
  'definitionPage',
  'getDefinitionHistory',
  'saveTerm',
  'addSynonym',
  'removeTerm',
  'deleteTerms',
  'moveTerms',
  'getInbox',
  'inboxPage',
  'getReviews',
  'markOpened',
  'markReviewed',
  'decideCard',
  'completeCard',
  'publishReview',
  'publishReviews',
  'archiveReview',
  'closeReview',
  'returnReview',
  'readQuestion',
  'ask',
  'askedThisWeek',
  'getAskExamples',
  'listChats',
  'saveChat',
  'renameChat',
  'deleteChat',
  'getObservability',
  'observabilityPage',
  'replayTopic',
  'getSavedViews',
  'saveView',
  'removeView',
  'getAlerts',
  'setAlertRule',
  'muteAlert',
  'setAlertThreshold',
  'getSettings',
  'setLinks',
  'setFigures',
  'setDataContact',
  'connectIntegration',
  'disconnectIntegration',
  'getIntegrations',
  'readFigure',
  'listAgentConnections',
  'revokeAgentConnection',
  'checkConnect',
  'getConnectReview',
  'getSavedQuestions',
  'getSavedCheck',
  'saveQuestion',
  'removeSavedQuestion',
  'keepNewAnswer',
] as const satisfies readonly (keyof HeedApi)[]

type Missing = Exclude<keyof HeedApi, (typeof heedApiMethods)[number]>
/** Fails to compile while a method of HeedApi is not in the list above. */
const complete: [Missing] extends [never] ? true : Missing = true
void complete

export type HeedApiMethod = (typeof heedApiMethods)[number]

/**
 * The reads a screen's loading state shows (Loadable). Only these wait or fail for a page in the
 * mock's scenarios; the shared reads every screen needs (the session, the workspace, the library)
 * load once, before the app is drawn.
 */
export const pageReads = [
  'contextPage',
  'itemPage',
  'definitionsPage',
  'definitionPage',
  'getDefinitionHistory',
  'inboxPage',
  'observabilityPage',
] as const satisfies readonly HeedApiMethod[]

export type PageRead = (typeof pageReads)[number]

export const isPageRead = (method: string): method is PageRead =>
  (pageReads as readonly string[]).includes(method)
