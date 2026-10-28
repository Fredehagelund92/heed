/**
 * The context item model, following docs/requirements.md section 4.1 ("Item" and "Item version").
 * Pure definitions: no input or output, no React. The server will import this same file later,
 * so the web app, the API and the published JSON Schema (FR-124) share one definition.
 *
 * `zod/mini` keeps the browser bundle small. The web app validates URL search params with it,
 * and fixtures are validated against it in tests.
 */
import * as z from 'zod/mini'
import { limits } from './proposal-rules.ts'

/**
 * The five kinds of item (requirements, section 2.1 "Kind"). An `event` is a standing fact: it
 * starts on a date and usually has no end. An `issue` is temporary: while it lasts it is a live
 * warning, and once it ends it is history, delivered only for questions about its own period.
 */
export const itemKinds = ['note', 'event', 'guide', 'example', 'issue'] as const
export type ItemKind = (typeof itemKinds)[number]

/**
 * What an owner is asked when an item's review date passes (FR-127, FR-135). An issue with no
 * end date asks whether it is still going on; every other item asks whether it is still correct.
 */
export const reviewQuestions = ['still_correct', 'still_going_on'] as const
export type ReviewQuestion = (typeof reviewQuestions)[number]

/** The words of each review question, for a page that shows it. */
export const reviewQuestionWords: Record<ReviewQuestion, string> = {
  still_correct: 'Is this still correct?',
  still_going_on: 'Is this still going on?',
}

export function reviewQuestion(item: {
  kind: ItemKind
  validity: { end: string | null }
}): ReviewQuestion {
  return item.kind === 'issue' && item.validity.end === null ? 'still_going_on' : 'still_correct'
}

export const riskLevels = ['low', 'normal', 'high'] as const
export type RiskLevel = (typeof riskLevels)[number]

/** `fact_only`: a fact is documented, no cause is proven. `effect_stated`: a named authority states the effect. */
export const claimLevels = ['fact_only', 'effect_stated'] as const
export type ClaimLevel = (typeof claimLevels)[number]

/** How an item version was created (FR-103). `source`: a content source's read, not a person (CON-603). */
export const creationChannels = [
  'form',
  'assistant',
  'chat',
  'command_line',
  'mcp',
  'import',
  'source',
] as const
export type CreationChannel = (typeof creationChannels)[number]
/** The channels a person writes through: every one but a content source's read. */
export const personChannels = [
  'form',
  'assistant',
  'chat',
  'command_line',
  'mcp',
  'import',
] as const satisfies readonly CreationChannel[]

/** An accepted item is served. A retired item stays in history and is never served. */
export const itemStatuses = ['accepted', 'retired'] as const
export type ItemStatus = (typeof itemStatuses)[number]

/**
 * A mark a connector sets on an item when a definition it refers to changes (`needs_check`,
 * CON-209) or disappears (`source_missing`, CON-210). An owner clears it by recording
 * "checked, still correct" (CON-211).
 */
export const checkFlags = ['needs_check', 'source_missing'] as const
export type CheckFlag = (typeof checkFlags)[number]

/**
 * The states a domain had in editions sealed before every domain was served (14 Oct 2026). Domains
 * no longer have one; these stay only because those editions' digests and exports name them.
 */
export const areaStates = ['not_started', 'starting', 'live', 'paused'] as const
export type AreaState = (typeof areaStates)[number]

/** The most characters of a domain's summary line, shown in lists and pickers. */
export const AREA_SUMMARY_MAX = 160
/** The most characters of a domain's description: plain text with light markdown. */
export const AREA_DESCRIPTION_MAX = 1500

/**
 * The ring of domain hues an area is labelled with (contract 6.1, 6.13): eight names, one
 * lightness and chroma recipe, no red and no amber, because those two mean danger and warning.
 * `--hue-<name>-*` in the web app's tokens.css holds the four colours of each.
 */
export const domainHues = [
  'teal',
  'sky',
  'indigo',
  'violet',
  'pink',
  'lime',
  'stone',
  'gray',
] as const
export type DomainHue = (typeof domainHues)[number]

/** Maximum length of an item summary (FR-118), from src/domain/proposal-attributes.ts. */
export const SUMMARY_MAX_LENGTH = limits.summary

const isoDate = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date like 2026-08-04'))

/**
 * What an item is about: metrics, dimension values and dimensions with any value (section 2.1
 * "Scope"). A dimension in `dimensions` reads "market: any value" (FR-126).
 */
export const scopeSchema = z.object({
  metrics: z.array(z.string()),
  dimensions: z._default(z.array(z.string()), []),
  dimensionValues: z.array(z.object({ dimension: z.string(), value: z.string() })),
})
export type Scope = z.infer<typeof scopeSchema>

/** The dates when an item applies. The end date is not included (requirements, Appendix A, C08). */
export const validitySchema = z.object({
  start: isoDate,
  end: z.nullable(isoDate),
})
export type Validity = z.infer<typeof validitySchema>

/** A link and a short quote. Never a copy of the source (FR-116). */
export const evidenceSchema = z.object({
  url: z.string(),
  quote: z.string(),
  date: isoDate,
})
export type Evidence = z.infer<typeof evidenceSchema>

/** Who can receive an item (section 2.1 "Audience"). */
export const audienceSchema = z.union([
  z.object({ kind: z.literal('everyone') }),
  z.object({ kind: z.literal('groups'), groups: z.array(z.string()) }),
])
export type Audience = z.infer<typeof audienceSchema>

/**
 * The groups a reader belongs to while groups are parked: none. No identity carries a group yet,
 * so every read path passes this, and an item for a group is for nobody (NFR-029: closed).
 */
export const noGroups: readonly string[] = []

/**
 * The one audience rule (FR-128, NFR-029) every read path applies: an item is for everyone, or
 * for a reader in one of its groups. An item a reader may not receive counts as absent, and so do
 * its title, its words, its id and the proposals about it. The database applies the same rule
 * (`cl_audience_allows`, 0083) in its row security and its read models.
 */
export function audienceAllows(audience: Audience, groups: readonly string[]): boolean {
  return audience.kind === 'everyone' || audience.groups.some((group) => groups.includes(group))
}

/**
 * One item as the library shows it: the stable id, its area, and the current accepted version.
 * Older versions live in history and are not part of this view.
 */
export const itemSchema = z.object({
  id: z.string(),
  kind: z.enum(itemKinds),
  areaId: z.string(),
  status: z.enum(itemStatuses),
  /** Version number of this saved state. Old versions never change. */
  version: z.number().check(z.int(), z.minimum(1)),
  title: z.string().check(z.minLength(1)),
  summary: z.string().check(z.maxLength(SUMMARY_MAX_LENGTH)),
  /** Optional plain-text body (Markdown). Guides use it; the web form offers a plain text field (FR-119). */
  body: z.optional(z.string()),
  /**
   * The summary and body as written, with typed mentions as `@[words](target)` tokens
   * (src/domain/mentions.ts). Present only when the text mentions something; the plain
   * `summary` and `body` are what people and agents read.
   */
  summaryMarkup: z.optional(z.string()),
  bodyMarkup: z.optional(z.string()),
  /** Stable names of metrics or dimensions in another tool, for example `semlayer:orders.total_orders`. */
  references: z.array(z.string()),
  scope: scopeSchema,
  validity: validitySchema,
  /** Required when the item has no end date (FR-127). */
  reviewDate: z.nullable(isoDate),
  /** What the owner is asked when the review date passes (`reviewQuestion`). */
  reviewQuestion: z.enum(reviewQuestions),
  evidence: z.array(evidenceSchema),
  /** Set when a referenced definition changed or disappeared (CON-209, CON-210). */
  checkFlag: z.nullable(z.enum(checkFlags)),
  claimLevel: z.enum(claimLevels),
  riskLevel: z.enum(riskLevels),
  /**
   * What the contributor said not to conclude (FR-104), as stored: "cause not proven" when they
   * said nothing else. A suggested change starts from it.
   */
  notToConclude: z.string(),
  audience: audienceSchema,
  ownerId: z.string(),
  /** Short codes computed from definitions. A changed definition changes the code (section 2.1 "Change mark"). */
  changeMarks: z.record(z.string(), z.string()),
  createdVia: z.enum(creationChannels),
  /** Who proposed it; null for an item a content source's read made (CON-603). */
  proposerId: z.nullable(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ContextItem = z.infer<typeof itemSchema>

export const areaSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** One line on what the domain is, for lists and pickers; empty until someone writes it. */
  summary: z.string(),
  /** What the domain is and what kind of data it holds, in light markdown; may be empty. */
  description: z.string(),
  /** Its owners now, longest-serving first; empty until one is assigned. */
  ownerIds: z.array(z.string()),
  /** The area's hue on the ring of domain hues. */
  label: z.enum(domainHues),
  /** One more with every edit of the area; an edit of what it is names the one it read. */
  revision: z.number(),
  /** The sandbox, the built-in demo domain (FR-811): agents never get it, and it is never deleted. */
  demo: z.boolean(),
})
export type Area = z.infer<typeof areaSchema>

export const personSchema = z.object({
  id: z.string(),
  name: z.string(),
  initials: z.string(),
})
export type Person = z.infer<typeof personSchema>

/** The governed lists the pickers are limited to (FR-107). */
export const vocabularySchema = z.object({
  metrics: z.array(z.object({ id: z.string(), name: z.string(), group: z.string() })),
  dimensions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      values: z.array(z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()) })),
    }),
  ),
})
export type Vocabulary = z.infer<typeof vocabularySchema>
