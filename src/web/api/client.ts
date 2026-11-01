/**
 * The one boundary between the web app (src/web) and its data: `HeedApi`. Two bindings
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
import type { ConnectRequest } from '@contract/connections'
import type { AgentToolName } from '@domain/agents'
import type { ScopeSearchResult } from '@contract/scope'
import type { ReactionEmoji } from '@/components/templates/comment-box/types'
import type { FactAction } from '@/lib/bulk'
import type { Definition, DefinitionType, SynonymCheck } from '@/lib/definitions'
import type { Link } from '@/lib/links'
import type { Answer, AskedWeek, AskInput, Example, SentReport, Thread } from '@/model/ask'
import type { CommentAnchor, Comments, MentionNote, Subject } from '@/model/comments'
import type { DomainId, Fact, Kind, LogEntry, Metric, Sent } from '@/model/items'
import type { Version } from '@/model/history'
import type { Conflict, ConflictDecision, ConflictRow, SettleConflict } from '@/model/conflicts'
import type { InboxCard, Outcome, Waiting } from '@/model/inbox'
import type { Alerts, RuleId } from '@/model/alerts'
import type { FigureAsk, FigureReport, FigureTry, FigureView } from '@/model/figures'
import type {
  ConnectChoice,
  ConnectedSource,
  ConnectForm,
  ConnectorId,
  ConnectTest,
  ConnectValues,
  FigureConnection,
  IntegrationsView,
  SourcePage,
} from '@/model/integrations'
import type { Connected, LivePhase } from '@/lib/connect'
import type { AutoPublish, DomainPolicies, Policy } from '@/lib/policies'
import type { Filters, SavedView } from '@/lib/obs-views'
import type { ObsData, Range } from '@/model/observability'
import type {
  Period,
  Snapshot,
  SnapshotItem,
  SummaryData,
  SummaryPeriod,
} from '@/model/obs-summary'
import type { Replay, When } from '@/model/replay'
import type { Domain, Person } from '@/model/people'
import type { Relation, Review } from '@/model/review'
import type { SettingGroup } from '@/model/settings'
import type { SavedQuestion } from '@/model/saved-questions'

/* ---------- session and workspace ---------- */

export type { ConnectRequest }

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

/** What the "Applies to" picker asks: words, and inside one dimension a page of its values. */
export type ScopeSearchInput = { q: string; dimension?: string; cursor?: string; limit?: number }
/** What it finds, as the service answers it. */
export type ScopeSearch = ScopeSearchResult
export type ScopeHit = ScopeSearchResult['metrics'][number]

/** A few quiet lines on what someone did lately. */
export type Activity = { what: string; when: string }

/** What an Observability page reads: its page, its range, and a domain or a kind of agent. */
export type ObsPageInput = { section: string; range: Range; domain?: DomainId; agent?: string }
/** What Summary reads: the last whole month or quarter, and a domain. */
export type ObsSummaryInput = { period: SummaryPeriod; domain?: DomainId }

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

/**
 * Where the check of the saved questions stands: running (so far `checked` of `total`), failed
 * after `checked` of `total`, or idle; when they were last checked; and the last eight weeks.
 */
export type SavedCheck = {
  run: 'idle' | 'running' | 'failed'
  checked: number
  total: number
  /** When they were last checked, as a page says it ("Today, 09:41"); null before the first check. */
  checkedAt: string | null
  /** The last eight weeks, oldest first: how many answered as saved at the end of each, of how many. */
  trend: { labels: string[]; same: number[]; total: number[] }
}

/** The workspace's switches an admin sets in Settings and on an integration's page. */
export type Settings = {
  /**
   * The address agents connect to, the MCP server's: the prompt and every agent's steps name it.
   * Null where this workspace serves no agents.
   */
  mcpAddress: string | null
  /** Let agents follow links (get_related). */
  links: boolean
  /** Which of the other tools agents may call, by name: on unless an admin switched it off. */
  tools: Record<string, boolean>
  /**
   * Pause sharing, for an emergency: agents get no context at all, or none of one domain's.
   * `domain` is the domain paused, or null.
   */
  pause: { all: boolean; domain: DomainId | null }
  /** Whether Ask shows figures, per figure-capable integration: off until an admin turns it on. */
  figures: Partial<Record<ConnectorId, boolean>>
  /** Who answers for each integration's data, by name. */
  contacts: Partial<Record<ConnectorId, string>>
  /** The integrations connected. */
  connected: ConnectorId[]
}

/** What the figures read: how each figure-capable integration is reached, its second connection. */
export type Integrations = {
  /** How each figure-capable integration is reached. */
  figureConnections: Partial<Record<ConnectorId, FigureConnection>>
}

export type { Relation } from '@/model/review'

/** Settings, Advanced: what an admin reads there, for the day someone needs it. */
export type Advanced = {
  /** Every tuning setting, read only, in groups: its value in words and who changed it last. */
  settings: SettingGroup[]
  /** Drafts and terms deleted for good, newest first, each with who, when and its domain. */
  deleted: { key: string; title: string; hint: string; domain: DomainId | null }[]
  /** The history log's latest entries, newest first. `href` opens what an entry names. */
  history: { key: string; when: string; who: string; what: string; href?: string }[]
  /** What runs on its own: each job, when it last ran and how it went; null when unread. */
  jobs: { key: string; job: string; href?: string; last: string; result: string }[] | null
  /** The latest sealed editions, newest first. */
  editions: { label: string; sealed: string; change: string }[]
}

/** A file for the person to save: its name and its text. */
export type Exported = { name: string; type: string; content: string }

/** A context item's page: the item and its versions, newest first. */
export type ItemPage = { item: Fact; history: Version[] }

/**
 * Related: what an agent can follow from a context item or a definition with get_related, one
 * step, as people see it. The links in the text both ways and the owners' relations, in the order
 * agents follow them, and whether agents follow links now (the switch in Agents and access).
 */
export type Related = { links: Link[]; following: boolean }

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

/**
 * How this workspace signs people in: the person picker (a demo, or development), or the company's
 * OpenID Connect provider, by its name, with the address that starts a sign-in.
 */
export type SignInMethod = { kind: 'picker' } | { kind: 'oidc'; name: string; start: string }

/** What an open invite's link says on the sign-in screen: the domains by name, read signed out. */
export type InviteNote = { email: string; admin: boolean; domains: string[] }

/**
 * What inviting did: a link for each address invited (sent to them by whoever invites, while
 * Heed sends no email), and each address left out, with why.
 */
export type Invited = {
  links: { email: string; link: string }[]
  skipped: { email: string; why: 'member' | 'pending' | 'removed' }[]
}

export interface HeedApi {
  // Session and workspace
  getSession: () => Promise<Session>
  /** How people sign in here. Needs no session. */
  getSignInMethod: () => Promise<SignInMethod>
  /** What an invite link's token opens, or null for a link that opens no invite. Needs no session. */
  readInvite: (input: { token: string }) => Promise<InviteNote | null>
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
  invite: (input: { emails: string[]; admin: boolean; owns: DomainId[] }) => Promise<Invited>
  /** Sends an invite again: a new link, and the old one stops working. */
  resendInvite: (input: { name: string }) => Promise<{ link: string }>
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
  /**
   * The "Applies to" picker's search (FR-107), on the server: a dimension can hold thousands of
   * values, so nothing loads them all. No words: the person's recent terms. Words: a few metrics
   * and, per dimension, the dimension itself, how many values match and the first few. Inside one
   * `dimension` (`dim:campaign`): a page of its values from `cursor`.
   */
  searchScope: (input: ScopeSearchInput) => Promise<ScopeSearch>
  /** The Context page's list: every item, drafts included. */
  contextPage: () => Promise<Fact[]>
  /** A context item's page; null for an unknown id. */
  itemPage: (input: { id: string }) => Promise<ItemPage | null>
  /** An item's versions, newest first. */
  getItemHistory: (input: { id: string }) => Promise<Version[]>
  /** What an agent can follow from here: `id` names an item or a definition as a mention does. */
  getRelated: (input: { id: string }) => Promise<Related>
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

  // Conflicts (FR-220): two items an owner said disagree, read side by side and settled with a reason.
  /** The pairs the person may read, most asked first; `mine`: one of the two is in a domain they own. */
  conflicts: (input: { whose: 'mine' | 'all' }) => Promise<ConflictRow[]>
  /** One pair, holder first, in either order of ids; null when the two no longer disagree. */
  conflict: (input: { holderId: string; otherId: string }) => Promise<Conflict | null>
  /** Keeps one (the other is archived), keeps both, or removes the flag, with a reason. */
  settleConflict: (input: SettleConflict) => Promise<Undoable & { decision: ConflictDecision }>
  /** Suggests to an item's owners that it is archived, with a reason; it waits in their Inbox (FR-112). */
  suggestArchiving: (input: { id: string; reason: string }) => Promise<void>

  // Comments and reactions, by what they hang on. Agents never read any of it.
  getComments: () => Promise<Comments>
  postComment: (input: {
    subject: Subject
    content: JSONContent
    parentId?: string
    /** The note a suggestion was returned with. */
    returned?: boolean
    /** On a suggestion, the line or field of its source a new thread hangs on. */
    anchor?: CommentAnchor
  }) => Promise<{ id: string }>
  /**
   * Resolves a thread on a line or a field of a suggestion, or opens it again: anyone who may read
   * the suggestion may. It never holds Publish.
   */
  resolveComment: (input: { subject: Subject; id: string; resolved: boolean }) => Promise<void>
  reactToComment: (input: { subject: Subject; id: string; emoji: ReactionEmoji }) => Promise<void>
  reactToSubject: (input: { subject: Subject; emoji: ReactionEmoji }) => Promise<void>
  editComment: (input: { subject: Subject; id: string; content: JSONContent }) => Promise<void>
  removeComment: (input: { subject: Subject; id: string }) => Promise<void>
  /**
   * The person takes back their suggestion to archive with a comment of theirs on it, while it
   * waits, or takes the mark back (`withdrew: false`). Its owners then close it or archive anyway.
   */
  withdrawWithComment: (input: { subject: Subject; id: string; withdrew: boolean }) => Promise<void>
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
  /**
   * Publishes a suggestion. `relations` says how it relates to each live item it overlaps, by that
   * item's id: Publish needs an answer for every one, and each answer acts on its own item only.
   * `saveQuestion` also saves a Not found draft's question.
   */
  publishReview: (input: {
    id: string
    relations?: Record<string, Relation>
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
  /**
   * Tells the owners what is wrong with an answer, with the person's name (FR-622): the question,
   * the part (a source's item id, or `answer` for the answer itself, filed on its first source),
   * what is wrong and, optionally, the correct version and a link. Nothing else of the chat is sent.
   */
  reportAnswer: (input: {
    question: string
    part: string
    sources: string[]
    what: string
    correction?: string
    link?: string
    /**
     * For `part: 'figure'`: the figure that doesn't fit the context item (`sources[0]`), as the
     * answer named it, and who hears: the item's owners, the integration's data contact, or both.
     */
    figure?: FigureReport
  }) => Promise<{ id: string }>
  /** The person's own reports from Ask, newest first, each with what the owners did after it. */
  getMyReports: () => Promise<SentReport[]>

  // Observability: what agents asked and how it was answered, as scopes and counts only
  /**
   * An Observability page's own read for a view: `section` is the page (overview, questions, and
   * so on), with its range, and a domain or a kind of agent. Every count is as the reader may see
   * it: a count under 5 is null, and none gives a hidden one away (FR-614).
   */
  observabilityPage: (input: ObsPageInput) => Promise<ObsData>
  /**
   * Summary's read: the last whole calendar month or quarter against the one before, its weekly
   * trend, what is still open and what changed, every count through one disclosure pass (FR-614).
   */
  observabilitySummary: (input: ObsSummaryInput) => Promise<SummaryData>
  /**
   * Summary's monthly snapshots, the latest month first: every domain's together for an admin, or
   * one domain's for its owners and admins.
   */
  observabilitySnapshots: (input: { domain?: DomainId }) => Promise<SnapshotItem[]>
  /** One snapshot as it was taken; null when there is none, or it counts a domain not owned. */
  observabilitySnapshot: (id: string) => Promise<Snapshot | null>
  /**
   * Admins: take the last whole month's snapshot now, for every domain together and each one,
   * wherever it is not kept yet and agents asked anything, as the nightly job does.
   */
  takeObservabilitySnapshot: () => Promise<{ now: Period; taken: number }>
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
  /** Switches one tool agents call on or off, for every agent. */
  setTool: (input: { name: string; on: boolean }) => Promise<void>
  /**
   * Pauses sharing, or lets it go on: every agent at once (`all`), or one domain at a time
   * (`domain`, null for none). It acts at once and is logged.
   */
  setPause: (input: { all: boolean } | { domain: DomainId | null }) => Promise<void>
  /**
   * A key with a name, for a bot or a scheduled job that can't sign in: shown this once, and kept
   * only as its digest. It reads context and gives feedback, names no person, and is listed on
   * Connected agents by its name until it is revoked. Admins only.
   */
  createAccessKey: (input: { name: string }) => Promise<{ key: string }>
  /** Renames an access key; the history log keeps both names. Admins only. */
  renameAccessKey: (input: { id: string; name: string }) => Promise<void>
  /** Settings, Advanced's own read. */
  advancedPage: () => Promise<Advanced>
  /**
   * Checks the history log's hash chain end to end: whether it is whole, and how many entries it
   * checked when the binding counts them (null when it doesn't).
   */
  checkHistory: () => Promise<{ whole: boolean; entries: number | null }>
  /** The history log as a file, oldest first. */
  exportHistory: () => Promise<Exported>
  /** What agents get now, every context item and term, as one file for a backup or a move. */
  exportContext: () => Promise<Exported>
  setFigures: (input: { source: ConnectorId; on: boolean }) => Promise<void>
  setDataContact: (input: { source: ConnectorId; name: string }) => Promise<void>
  /**
   * Where an integration's figures are read: its data endpoint and a token for it, which is kept
   * in the secret store, sent only to the endpoint's origin and never shown again.
   */
  setFigureConnection: (input: {
    source: ConnectorId
    endpoint: string
    token: string
  }) => Promise<void>
  /**
   * The connect flow's form, by the address's id: a connected tool's settings to change (its
   * page's id), or a tool of the catalog to connect anew; null for neither, or for a tool whoever
   * runs the server connected, whose settings are theirs.
   */
  connectForm: (input: { id: string }) => Promise<ConnectForm | null>
  /**
   * Test connection: the tool's check with the form's settings, and what it may read. It keeps
   * nothing and changes nothing; to change a tool connected, a secret left empty is the stored one.
   */
  testIntegration: (
    input: { connector: ConnectorId; source?: string } & ConnectValues,
  ) => Promise<ConnectTest>
  /**
   * Connects a tool with the form's settings, what was chosen to read with each one's domain, and
   * why (kept in the history log). Nothing is published by a read. `setup`: from the setup
   * checklist, whose last step it is.
   */
  connectIntegration: (
    input: {
      connector: ConnectorId
      chosen: ConnectChoice[]
      reason: string
      setup?: boolean
    } & ConnectValues,
  ) => Promise<ConnectedSource>
  /** Change settings of a connected tool, on the revision its form read; a secret left empty stays. */
  changeIntegration: (
    input: {
      id: string
      revision: number
      chosen: ConnectChoice[]
      reason: string
    } & ConnectValues,
  ) => Promise<void>
  /**
   * Disconnects a tool, by its page's id: it is read no more and its secrets are forgotten; a
   * content tool's open suggestions are withdrawn. What it read, and what owners published, stays.
   */
  disconnectIntegration: (input: { id: string }) => Promise<void>
  getIntegrations: () => Promise<Integrations>
  /** Settings › Integrations: the tools connected, each with how it is, and what can be connected. */
  integrationsPage: () => Promise<IntegrationsView>
  /** One connected tool's page, by its id; null for none connected by that id. */
  integrationPage: (input: { id: string }) => Promise<SourcePage | null>
  /** Read again: the tool is read now, whatever its schedule; its page says Reading until it is. */
  readIntegration: (input: { id: string }) => Promise<void>
  /** Pauses reading a tool, or lets it go on; what was published stays as it is. */
  pauseIntegration: (input: { id: string; paused: boolean }) => Promise<void>
  /** What an answer shows of the data: one figure line, a link into the tool, or why there is none. */
  readFigure: (input: FigureAsk) => Promise<FigureView | null>
  /**
   * Try a figure: one figure read now with the integration's figures settings as they are saved,
   * on or off, so an admin sees the endpoint and its token work. Kept nowhere.
   */
  tryFigure: (input: { source: ConnectorId }) => Promise<FigureTry>
  /**
   * The agents, by name, the last used first (FR-420): an admin sees every agent, anyone else the
   * apps they signed in with.
   */
  listAgentConnections: () => Promise<Connected[]>
  /**
   * Switches one tool on or off for one agent. It acts at the agent's next request and never widens
   * what a person allowed; an access key never gets suggest_context. Admins only.
   */
  setAgentTool: (input: { id: string; tool: AgentToolName; on: boolean }) => Promise<void>
  /** Ends an agent at once: every connection of an app, or an access key. Anyone their own apps. */
  revokeAgent: (input: { id: string }) => Promise<void>
  /**
   * Publishing without review (FR-421): whether an admin switched it on for the workspace, and how
   * many policies are on. Admins only.
   */
  getAutoPublish: () => Promise<AutoPublish>
  /** An admin switches it on or off for the workspace. Off ends every policy at once. */
  setAutoPublish: (input: { on: boolean }) => Promise<{ ended: number }>
  /**
   * One domain's policies, whether the workspace allows them, whether the signed-in person may set
   * one there, and the apps that suggested to it lately.
   */
  getDomainPolicies: (input: { domain: DomainId }) => Promise<DomainPolicies>
  /**
   * An owner of the domain lets one app publish low-risk new items there without
   * review, as their own decision, up to a daily cap. It replaces the app's policy there.
   */
  setAgentPolicy: (input: {
    agentId: string
    domain: DomainId
    perDay: number
    reason: string
  }) => Promise<Policy>
  /**
   * Turns a policy off at once. Whoever set it, an owner of the domain, an admin and the person the
   * agent works for may. `from` says where, for the history log.
   */
  endAgentPolicy: (input: { id: string; from: 'agents' | 'domain' }) => Promise<void>
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
  /**
   * An agent's sign-in that this browser started, for the consent page (FR-403): which agent asks
   * and what it may do. Null once it was answered, ran out, or was started in another browser.
   */
  getConnectRequest: (input: { id: string }) => Promise<ConnectRequest | null>
  /** The person's answer on the consent page: where the browser goes back to the agent. */
  answerConnectRequest: (input: { id: string; allow: boolean }) => Promise<{ redirectTo: string }>

  // Saved questions
  getSavedQuestions: () => Promise<SavedQuestion[]>
  /** Where the check of every saved question stands. */
  getSavedCheck: () => Promise<SavedCheck>
  /**
   * Check now: every saved question the person manages, or one domain's, answered again on what
   * agents get, with no model; it publishes nothing. While it runs, getSavedCheck counts how far it
   * got. Gives back how many it checked.
   */
  checkSavedQuestions: (input: { domain?: DomainId }) => Promise<{ checked: number }>
  saveQuestion: (input: {
    question: Omit<SavedQuestion, 'result' | 'why' | 'when' | 'id'>
    /** The items it should answer from; left out, every item it answers from now. */
    from?: string[]
    /** Where it is saved from: an answer in Ask (the default), a Not found draft, or typed in Quality. */
    origin?: 'ask' | 'gap' | 'typed'
  }) => Promise<{ id: string } & Undoable>
  removeSavedQuestion: (input: { id: string }) => Promise<void>
  /** Keep the new answer: what it says now becomes what it should say. */
  keepNewAnswer: (input: { id: string }) => Promise<Undoable>
}

/** Every method of `HeedApi`, once. The compiler checks the list is complete. */
export const heedApiMethods = [
  'getSession',
  'getSignInMethod',
  'readInvite',
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
  'resendInvite',
  'removePerson',
  'getLibrary',
  'searchAll',
  'searchScope',
  'contextPage',
  'itemPage',
  'getItemHistory',
  'getRelated',
  'restoreAsDraft',
  'markViewed',
  'editItem',
  'draftFromText',
  'saveItem',
  'applyBulk',
  'sendSuggestion',
  'withdrawSuggestion',
  'undo',
  'conflicts',
  'conflict',
  'settleConflict',
  'suggestArchiving',
  'getComments',
  'postComment',
  'reactToComment',
  'reactToSubject',
  'editComment',
  'removeComment',
  'withdrawWithComment',
  'resolveComment',
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
  'reportAnswer',
  'getMyReports',
  'observabilityPage',
  'observabilitySummary',
  'observabilitySnapshots',
  'observabilitySnapshot',
  'takeObservabilitySnapshot',
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
  'setTool',
  'setPause',
  'createAccessKey',
  'renameAccessKey',
  'advancedPage',
  'checkHistory',
  'exportHistory',
  'exportContext',
  'setFigures',
  'setDataContact',
  'setFigureConnection',
  'connectForm',
  'testIntegration',
  'connectIntegration',
  'changeIntegration',
  'disconnectIntegration',
  'getIntegrations',
  'integrationsPage',
  'integrationPage',
  'readIntegration',
  'pauseIntegration',
  'readFigure',
  'tryFigure',
  'listAgentConnections',
  'setAgentTool',
  'revokeAgent',
  'getAutoPublish',
  'setAutoPublish',
  'getDomainPolicies',
  'setAgentPolicy',
  'endAgentPolicy',
  'checkConnect',
  'getConnectReview',
  'getConnectRequest',
  'answerConnectRequest',
  'getSavedQuestions',
  'getSavedCheck',
  'checkSavedQuestions',
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
  'conflicts',
  'conflict',
  'definitionsPage',
  'definitionPage',
  'getDefinitionHistory',
  'inboxPage',
  'observabilityPage',
  'observabilitySummary',
  'observabilitySnapshots',
  'observabilitySnapshot',
  'advancedPage',
  'integrationsPage',
  'integrationPage',
  'connectForm',
] as const satisfies readonly HeedApiMethod[]

export type PageRead = (typeof pageReads)[number]

export const isPageRead = (method: string): method is PageRead =>
  (pageReads as readonly string[]).includes(method)
