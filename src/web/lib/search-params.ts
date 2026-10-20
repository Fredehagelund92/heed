import * as z from 'zod/mini'
import { libraryGroups, librarySorts } from '@/lib/library-core'
import { gapOrigins, gapStatuses, gapTypes } from '@domain/gap-kinds'
import { proposalStates } from '@domain/proposal-state'
import { itemKinds, riskLevels } from '@domain/item'
import { editionChangeKinds } from '@domain/edition-changes'
import { isCalendarDate } from '@domain/validity'
import { connectorIdPattern } from '@domain/connector-id'
import { limits } from '@domain/proposal-rules'
import { peopleRoleFilterSchema, peopleSignInFilterSchema } from '../../contract/people-filters.ts'
import { captureQuote } from '@/lib/capture-quote'
import { connectionSorts } from '@/lib/connection-sorts'
import { docSectionIds } from '@/lib/docs-sections'
import {
  adminSections,
  gatewayTabs,
  retiredAdminSections,
  retiredSettingsSections,
  settingsSections,
} from '@/lib/settings-sections'

/**
 * Typed URL search params, one schema per route. Every param is optional so URLs stay clean
 * (no defaults written into the address bar); a screen applies its default when it reads one.
 * An invalid or unknown value is dropped instead of failing the whole route. The router merges
 * what a validator returns over the raw params, so a dropped key is returned as `undefined`:
 * that is what stops the raw, invalid value from leaking into `useSearch()`.
 */
export function lenientSearch<S extends z.ZodMiniObject>(schema: S) {
  return (raw: Record<string, unknown>): z.output<S> => {
    const result = z.safeParse(schema, raw)
    let parsed: Record<string, unknown>
    if (result.success) {
      parsed = result.data
    } else {
      const invalid = new Set(result.error.issues.map((issue) => String(issue.path[0])))
      const retry: Record<string, unknown> = z.parse(
        schema,
        Object.fromEntries(Object.entries(raw).filter(([key]) => !invalid.has(key))),
      )
      parsed = retry
    }
    const dropped = Object.fromEntries(
      Object.keys(raw)
        .filter((key) => !(key in parsed))
        .map((key) => [key, undefined]),
    )
    return { ...dropped, ...parsed } as z.output<S>
  }
}

/**
 * The library's URL state (contract 9.10): the view, the search, filters, sort and grouping, so
 * every list is linkable. Kind and status hold comma separated lists. An item page carries the
 * same params, so its breadcrumb, previous and next and Escape all return to the same list.
 */
export const librarySearchSchema = z.object({
  view: z.optional(z.enum(['mine', 'attention'])),
  q: z.optional(z.string()),
  area: z.optional(z.string()),
  kind: z.optional(
    z
      .string()
      .check(z.regex(/^(event|note|guide|example|issue)(,(event|note|guide|example|issue))*$/)),
  ),
  status: z.optional(
    z
      .string()
      .check(
        z.regex(
          /^(accepted|stale|needs_check|source_missing|active_issue|expired|retired)(,(accepted|stale|needs_check|source_missing|active_issue|expired|retired))*$/,
        ),
      ),
  ),
  /**
   * A metric id, a dimension value as `dimension:value`, or a dimension with any value as
   * `dimension:*`. Set from an item's "where it applies".
   */
  about: z.optional(z.string()),
  sort: z.optional(z.enum(librarySorts)),
  dir: z.optional(z.enum(['asc', 'desc'])),
  group: z.optional(z.enum(libraryGroups)),
  /** Ended issues are left out of the list until this asks for them (requirements 4.4). */
  ended: z.optional(z.enum(['show'])),
  /** Needs a look across every domain; an owner or deputy starts with their own (A8). */
  domains: z.optional(z.enum(['all'])),
})
export type LibrarySearch = z.output<typeof librarySearchSchema>

/** The parts of an item page (the header shows on every one). Read is the default. */
export const itemTabs = ['read', 'source', 'history', 'links'] as const
export type ItemTab = (typeof itemTabs)[number]

/** An item id, as the address carries it to a panel. Anything else is dropped. */
const itemIdParam = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,64}$/))

/**
 * The library route: the list's params, and the item open in the docked panel with the panel's
 * tab, so a panel is linkable and Back closes it. The panel and its tab are not part of the list
 * (lib/list-memory.ts leaves them out), so opening an item never changes the list's position.
 */
export const libraryRouteSearchSchema = z.object({
  ...librarySearchSchema.shape,
  panel: z.optional(itemIdParam),
  tab: z.optional(z.enum(['source', 'history', 'links'])),
})
export const validateLibrarySearch = lenientSearch(libraryRouteSearchSchema)
export type LibraryRouteSearch = z.output<typeof libraryRouteSearchSchema>

/**
 * An item page carries the list it was opened from (so the breadcrumb, previous and next and
 * Escape return to it) and the tab it shows, so a link or Back opens the same part.
 */
export const itemSearchSchema = z.object({
  ...librarySearchSchema.shape,
  tab: z.optional(z.enum(['source', 'history', 'links'])),
})
export const validateItemSearch = lenientSearch(itemSearchSchema)
export type ItemSearch = z.output<typeof itemSearchSchema>

/**
 * The catalogue's URL state: the view chip (`kind`), the search, the filters and the order, so
 * every list is linkable. It opens grouped by domain; `order=az` is A to Z with a Domain column.
 * `area` is an area id, or `none` for the terms with no domain.
 */
export const catalogueSearchSchema = z.object({
  kind: z.optional(z.enum(['metric', 'dimension'])),
  q: z.optional(z.string()),
  status: z.optional(
    z
      .string()
      .check(
        z.regex(
          /^(gone|changed|active_issues|no_context|not_linked|in_sync)(,(gone|changed|active_issues|no_context|not_linked|in_sync))*$/,
        ),
      ),
  ),
  area: z.optional(z.string()),
  order: z.optional(z.enum(['az'])),
  /** The term open in the docked panel, by its vocabulary key (`metric:orders`, `dim:market`). */
  panel: z.optional(z.string().check(z.regex(/^(metric|dim):[a-z0-9_]{1,64}$/))),
  /** The panel's tab; Overview when left out. */
  tab: z.optional(z.enum(['context', 'source'])),
})
export const validateCatalogueSearch = lenientSearch(catalogueSearchSchema)
export type CatalogueSearch = z.output<typeof catalogueSearchSchema>

/**
 * A term page opens on Overview; the tab it shows lives in the address, so a link keeps it. A
 * dimension's page may name one of its values, which its Values list picks out (a value chip's
 * link).
 */
export const termSearchSchema = z.object({
  tab: z.optional(z.enum(['context', 'source'])),
  value: z.optional(z.string().check(z.regex(/^[a-z0-9_]{1,64}$/))),
})
export const validateTermSearch = lenientSearch(termSearchSchema)
export type TermSearch = z.output<typeof termSearchSchema>

/** The tabs of a proposal in the docked panel: review mode's, then status mode's own. */
export const proposalPanelTabs = [
  'changes',
  'checks',
  'overlaps',
  'activity',
  'fields',
  'preview',
] as const
export type ProposalPanelTab = (typeof proposalPanelTabs)[number]

/**
 * The Proposals page: the view (To review, Source checks, Mine), the search and the filters. A
 * view that is not built yet opens Mine (lib/proposals.ts).
 */
export const proposalsSearchSchema = z.object({
  view: z.optional(z.enum(['review', 'checks', 'mine'])),
  q: z.optional(z.string()),
  state: z.optional(z.enum(proposalStates)),
  area: z.optional(z.string()),
  /** To review: one risk level. */
  risk: z.optional(z.enum(riskLevels)),
  /** To review: who holds the proposal (lib/review.ts, `claimFilters`). */
  claimed: z.optional(z.enum(['me', 'others', 'nobody'])),
  /** The proposal open in the docked panel. */
  panel: z.optional(z.string().check(z.uuid())),
  /**
   * The panel's tab. A proposal under review opens on Changes, one in status mode on Activity;
   * a tab the open proposal does not have falls back to its first.
   */
  tab: z.optional(z.enum(proposalPanelTabs)),
})
export const validateProposalsSearch = lenientSearch(proposalsSearchSchema)
export type ProposalsSearch = z.output<typeof proposalsSearchSchema>

/** The parts of a proposal's status page. Activity is the default. */
export const proposalTabs = ['activity', 'fields', 'preview'] as const
export type ProposalTab = (typeof proposalTabs)[number]

export const proposalSearchSchema = z.object({
  compare: z.optional(z.enum(['fields', 'text'])),
  tab: z.optional(z.enum(['fields', 'preview'])),
})
export const validateProposalSearch = lenientSearch(proposalSearchSchema)
export type ProposalSearch = z.output<typeof proposalSearchSchema>

/** A scope key an address carries: `metric:<id>`, `dim:<id>` (any value) or `val:<dimension>/<value>`. */
const scopeKey =
  '(?:metric:[a-z0-9_.-]{1,64}|dim:[a-z0-9_.-]{1,64}|val:[a-z0-9_.-]{1,64}/[a-z0-9_.-]{1,64})'
/** Scope keys, comma separated: what Try it asked about, or what a new draft starts with. */
const scopeKeys = z.string().check(z.regex(new RegExp(`^${scopeKey}(?:,${scopeKey})*$`)))
const calendarDay = z.string().check(z.refine(isCalendarDate, 'Expected a calendar date'))

/**
 * Add context: the draft being written, or, for a new one, what to start it with: a metric (a
 * term page's "Add context about Orders"), by its vocabulary id, or the scope keys and the first
 * day that Try it asked about. A draft started from a gap names the month people asked about
 * (`asked`, YYYY-MM), as a hint for its dates. A capture link (lib/capture.ts) names the page a
 * person was reading (`evidence_url`, http or https only) and the sentence they selected on it
 * (`quote`, cleaned and cut to a quote's length; a number is a sentence too, as the router reads
 * `quote=2026` as one).
 */
export const contextSearchSchema = z.object({
  draft: z.optional(z.string().check(z.uuid())),
  asked: z.optional(z.string().check(z.regex(/^\d{4}-(?:0[1-9]|1[0-2])$/))),
  metric: z.optional(z.string().check(z.regex(/^[a-z0-9_]{1,64}$/))),
  about: z.optional(scopeKeys),
  from: z.optional(calendarDay),
  evidence_url: z.optional(
    z.string().check(z.maxLength(limits.url), z.url({ protocol: /^https?$/ })),
  ),
  quote: z.optional(
    z.pipe(
      z.union([z.string(), z.number()]),
      z.transform((raw) => captureQuote(String(raw)) || undefined),
    ),
  ),
})
export const validateContextSearch = lenientSearch(contextSearchSchema)

/**
 * The Gaps page: the view (the gaps, or the topic counts), the search, the filters in the API's
 * own statuses and types, and the gap open in the docked panel, so every state is linkable.
 */
export const gapsSearchSchema = z.object({
  view: z.optional(z.enum(['gaps', 'topics'])),
  q: z.optional(z.string()),
  area: z.optional(z.string()),
  status: z.optional(z.enum(gapStatuses)),
  type: z.optional(z.enum(gapTypes)),
  origin: z.optional(z.enum(gapOrigins)),
  gap: z.optional(z.string().check(z.uuid())),
})
export const validateGapsSearch = lenientSearch(gapsSearchSchema)
export type GapsSearch = z.output<typeof gapsSearchSchema>

/** An edition number, `2026-10-07.2`. */
export const editionLabelPattern = /^\d{4}-\d{2}-\d{2}\.\d+$/

/**
 * The Editions page (Editions design, slice S3): the feed, or the table; the edition open in the
 * docked panel, so an open edition is a link and Back closes it; and the table's page.
 */
export const editionsSearchSchema = z.object({
  /** The table of editions; the feed has no param. */
  view: z.optional(z.enum(['table'])),
  /** The edition open in the docked panel; none when left out. */
  edition: z.optional(z.string().check(z.regex(editionLabelPattern))),
  /** The panel's tab: its details; what changed is the default. */
  tab: z.optional(z.enum(['details'])),
  /** The page of the table, from 2 (the first page has no param). An old link with one opens the table. */
  page: z.optional(z.number().check(z.int(), z.minimum(2), z.maximum(10_000))),
})
export type EditionsSearch = z.output<typeof editionsSearchSchema>
export const validateEditionsSearch = lenientSearch(editionsSearchSchema)

/**
 * What changed between two editions (Editions design, slice S2): the two editions, the view,
 * the filters and the item open in the docked panel, so a comparison is a link. Since and Until
 * are the person's words for the earlier and the later edition; left out, the page compares the
 * live edition with the one before it and writes both numbers into the address.
 */
export const editionCompareSearchSchema = z.object({
  since: z.optional(z.string().check(z.regex(editionLabelPattern))),
  until: z.optional(z.string().check(z.regex(editionLabelPattern))),
  /** "Edition by edition"; the overall result has no param. */
  view: z.optional(z.enum(['steps'])),
  change: z.optional(z.enum(editionChangeKinds)),
  area: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))),
  kind: z.optional(z.enum(itemKinds)),
  risk: z.optional(z.enum(riskLevels)),
  /** The item open in the docked panel. */
  item: z.optional(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))),
  /** Edition by edition: the edition whose change of the open item the panel shows. */
  step: z.optional(z.string().check(z.regex(editionLabelPattern))),
  /** The panel's tab: the editions that changed the item; what changed is the default. */
  tab: z.optional(z.enum(['steps'])),
})
export type EditionCompareSearch = z.output<typeof editionCompareSearchSchema>
export const validateEditionCompareSearch = lenientSearch(editionCompareSearchSchema)

/**
 * The retired Evals and releases screen's address (Quality design, section 0): its tabs moved to
 * Editions, the Workbench (Quality then) and Areas, and an old link is sent to where its tab went.
 */
export const evalsSearchSchema = z.object({
  ...editionsSearchSchema.shape,
  tab: z.optional(z.enum(['editions', 'evals', 'areas'])),
})
export const validateEvalsSearch = lenientSearch(evalsSearchSchema)

/** How many days of MCP traffic the Activity tab counts. A week is the default. */
export const trafficDays = [1, 7, 30, 90] as const

/** The days the Activity tab counts; a week when left out. */
const trafficDaysParam = z.optional(z.union(trafficDays.map((days) => z.literal(days))))

/**
 * The retired MCP and gateway page's address: its tab and the days its Activity tab counted. An
 * old link lands on Administration's MCP and gateway section with them.
 */
export const mcpSearchSchema = z.object({
  tab: z.optional(z.enum(gatewayTabs)),
  days: trafficDaysParam,
})
export type McpSearch = z.output<typeof mcpSearchSchema>
export const validateMcpSearch = lenientSearch(mcpSearchSchema)

/**
 * What a section of Administration keeps in the address: the setting open in the docked panel
 * (Limits), and the history log's filters and the entry open in its panel.
 */
const sectionParams = {
  /** A setting open in the panel, by key. */
  setting: z.optional(z.string().check(z.regex(/^[a-z_]+(\.[a-z_]+)*$/), z.maxLength(100))),
  /** The history log: an action family, a person, an area, the first and last day, a step. */
  action: z.optional(z.string().check(z.regex(/^[a-z_]+(\.[a-z_]+)?$/), z.maxLength(80))),
  actor: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
  area: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))),
  from: z.optional(z.string().check(z.refine(isCalendarDate))),
  to: z.optional(z.string().check(z.refine(isCalendarDate))),
  /** The role changes made in one step, by the batch id their entries share. */
  batch: z.optional(z.string().check(z.uuid())),
  /** An entry of the history log open in the panel, by its number. */
  entry: z.optional(z.number().check(z.int(), z.minimum(1))),
  /** People: the words searched, a role, who is active or gone, and when they last signed in. */
  q: z.optional(z.string().check(z.maxLength(200))),
  role: z.optional(peopleRoleFilterSchema),
  status: z.optional(z.enum(['active', 'left', 'all'])),
  signedIn: z.optional(peopleSignInFilterSchema),
  /** The person whose sheet is open in the panel, by id. */
  person: z.optional(z.string().check(z.minLength(1), z.maxLength(64))),
}

/**
 * Settings, a person's own (navigation decision, 12 October 2026): the section, Profile and
 * appearance by default. The sections Administration took over are still read, with their
 * params, so an old link is sent on to where its section went (routes/settings.tsx).
 */
export const settingsSearchSchema = z.object({
  section: z.optional(z.enum([...settingsSections, ...retiredSettingsSections])),
  ...sectionParams,
})
export type SettingsSearch = z.output<typeof settingsSearchSchema>
export const validateSettingsSearch = lenientSearch(settingsSearchSchema)

/** The docs home, or one section's own pages (`?section=`, the end of a help page's trail). */
export const docsSearchSchema = z.object({
  section: z.optional(z.enum(docSectionIds)),
})
export type DocsSearch = z.output<typeof docsSearchSchema>
export const validateDocsSearch = lenientSearch(docsSearchSchema)

/**
 * Administration (navigation decision, 12 October 2026): the section, the first the person may
 * open by default; what the section keeps in the address; the source open in Sources; and MCP and
 * gateway's tab and the days its Activity tab counts.
 */
export const adminSearchSchema = z.object({
  section: z.optional(z.enum([...adminSections, ...retiredAdminSections])),
  ...sectionParams,
  /** A source's page in Sources, by the connector's id. */
  source: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_-]{1,39}$/))),
  /** Sources' list of connectors to add a source of. */
  add: z.optional(z.boolean()),
  /** The connector chosen there, whose form is open. */
  connector: z.optional(z.string().check(z.maxLength(64), z.regex(connectorIdPattern))),
  /** A source's page with the form to change its settings. */
  edit: z.optional(z.boolean()),
  /** A source's page with its members to propose as vocabulary terms. */
  terms: z.optional(z.boolean()),
  /** That page for values only, with this dimension's list open: `dim:market`. */
  values: z.optional(z.string().check(z.regex(/^dim:[a-z0-9_]+$/))),
  tab: z.optional(z.enum(gatewayTabs)),
  days: trafficDaysParam,
  /** MCP and gateway's Connections: what the list sorts by and which way; last used first by default. */
  sort: z.optional(z.enum(connectionSorts)),
  dir: z.optional(z.enum(['asc', 'desc'])),
})
export type AdminSearch = z.output<typeof adminSearchSchema>
export const validateAdminSearch = lenientSearch(adminSearchSchema)

/**
 * Where to go back to after signing in again. Only a path on this site is kept, never another
 * address, so the link cannot send a person elsewhere. Long enough for a capture link: a page
 * address and a 500 character sentence, both percent-encoded, so the filled-in source survives
 * signing in.
 */
export const signedOutSearchSchema = z.object({
  from: z.optional(z.string().check(z.regex(/^\/(?!\/)/), z.maxLength(16_000))),
})
export const validateSignedOutSearch = lenientSearch(signedOutSearchSchema)

/** The AI app sign-in the consent page answers: the opaque handle the login server sent. */
export const connectApproveSearchSchema = z.object({
  request: z.optional(z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/))),
})
export const validateConnectApproveSearch = lenientSearch(connectApproveSearchSchema)

/** Home's table tab (Home P). Recently changed is the default and leaves the address clean. */
export const homeSearchSchema = z.object({
  tab: z.optional(z.enum(['issues', 'topics'])),
})
export type HomeSearch = z.output<typeof homeSearchSchema>
export const validateHomeSearch = lenientSearch(homeSearchSchema)

/** The tabs of a domain, a test question and a run in Quality's docked panel. */
export const qualityPanelTabs = ['overview', 'questions', 'runs', 'changes', 'results'] as const
export type QualityPanelTab = (typeof qualityPanelTabs)[number]

/**
 * The Quality page (Quality design, direction C): the view (the domain health grid with Fix next,
 * the test questions or the runs), the search and the domain, and what is open in the docked
 * panel: a domain, a question or a run, by a prefixed id, so every state is linkable. A run's
 * comparison names the run it is compared with, and its results the try whose transcript shows.
 */
export const qualitySearchSchema = z.object({
  view: z.optional(z.enum(['questions', 'runs'])),
  q: z.optional(z.string()),
  area: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))),
  panel: z.optional(
    z
      .string()
      .check(
        z.regex(
          /^(domain:[a-z][a-z0-9_]{1,39}|question:[a-z0-9][a-z0-9-]{2,80}|run:[0-9a-f-]{36})$/,
        ),
      ),
  ),
  tab: z.optional(z.enum(qualityPanelTabs)),
  against: z.optional(z.string().check(z.regex(/^[0-9a-f-]{36}$/))),
  cell: z.optional(z.string().check(z.regex(/^[0-9a-f-]{36}$/))),
})
export const validateQualitySearch = lenientSearch(qualitySearchSchema)
export type QualitySearch = z.output<typeof qualitySearchSchema>

export const workbenchTabs = [
  'evidence',
  'result',
  'history',
  'overview',
  'questions',
  'runs',
  'changes',
  'results',
  'team',
] as const
export type WorkbenchTab = (typeof workbenchTabs)[number]

/** The work list's views; All, in Fix next order, is the default and has no param. */
export const workbenchViews = ['worse', 'gaps', 'upkeep', 'questions', 'runs'] as const
export type WorkbenchView = (typeof workbenchViews)[number]

const runId = z.string().check(z.regex(/^[0-9a-f-]{36}$/))

/**
 * The Workbench (Workbench plan, 3.3): the domain, the work list's view, its search and the Gaps
 * view's filters, the record that is open, by kind and id (`question:net-revenue-month-to-date`),
 * and its tab; the run a comparison is read from and the run it is compared with, by run id (two
 * runs can share an edition, so an edition label would not name one); the try whose transcript
 * shows; and the compare focus. The gap filters are read only with `view=gaps`, and an unknown
 * tab falls back to the record kind's first (`workbenchTab`).
 */
export const workbenchSearchSchema = z.object({
  area: z.optional(z.string().check(z.regex(/^[a-z][a-z0-9_]{1,39}$/))),
  view: z.optional(z.enum(workbenchViews)),
  q: z.optional(z.string()),
  status: z.optional(z.enum(gapStatuses)),
  type: z.optional(z.enum(gapTypes)),
  origin: z.optional(z.enum(gapOrigins)),
  open: z.optional(
    z
      .string()
      .check(
        z.regex(
          /^(domain:[a-z][a-z0-9_]{1,39}|question:[a-z0-9][a-z0-9-]{2,80}|gap:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|item:itm_[a-z0-9]{8,16}|run:[0-9a-f-]{36})$/,
        ),
      ),
  ),
  tab: z.optional(z.enum(workbenchTabs)),
  run: z.optional(runId),
  against: z.optional(runId),
  cell: z.optional(runId),
  mode: z.optional(z.enum(['compare'])),
})
export const validateWorkbenchSearch = lenientSearch(workbenchSearchSchema)
export type WorkbenchSearch = z.output<typeof workbenchSearchSchema>

/**
 * The Try it page: the scope's keys (`about`) and its first and last day. They are the scope last
 * asked, so the reply under them is the one a link shows. A fact opens in the docked panel as in
 * the library (`panel`, and `tab` for its Source, History or Links). Its old second tab, Connect
 * your AI (`tab=connect`), is a setting of the person's own now; a link to it is sent there.
 */
export const tryItSearchSchema = z.object({
  tab: z.optional(z.enum(['agent', 'connect', 'source', 'history', 'links'])),
  about: z.optional(scopeKeys),
  from: z.optional(calendarDay),
  to: z.optional(calendarDay),
  /** The fact open in the docked panel, as in the library, and the panel's tab (Read when left out). */
  panel: z.optional(itemIdParam),
})
export type TryItSearch = z.output<typeof tryItSearchSchema>
export const validateTryItSearch = lenientSearch(tryItSearchSchema)

/**
 * The assistant's page: the scope Ask and What an agent would get share, in the same params as
 * Try it's, so a scope moves between the two pages as it is. The conversation is never in the
 * address: the service keeps none, and a link must not carry a question (FR-602, FR-603).
 */
export const assistantSearchSchema = z.object({
  about: z.optional(scopeKeys),
  from: z.optional(calendarDay),
  to: z.optional(calendarDay),
})
export type AssistantSearch = z.output<typeof assistantSearchSchema>
export const validateAssistantSearch = lenientSearch(assistantSearchSchema)
