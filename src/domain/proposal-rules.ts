/*
  The rules about a proposal's attributes that the app's first load needs: the limits every
  schema, the form and the agent tool check, and the provenance table (the marks, and the
  attributes that carry one). Part of the attribute table in ./proposal-attributes.ts, which
  re-exports it; kept apart only so the first load does not carry the whole table. A leaf
  module: it imports nothing, so every schema can import it.
*/

/** Lengths and counts, in characters (code points) unless a comment says otherwise. */
export const limits = {
  title: 200,
  /** What agents read first (FR-118). */
  summary: 280,
  body: 20_000,
  notToConclude: 2000,
  /** A sentence copied from the source, never a copy of it (FR-116). */
  quote: 500,
  url: 2000,
  areaId: 100,
  ownerId: 100,
  reference: 500,
  claimAuthority: 200,
  claimQuote: 500,
  mentions: 50,
  /** What is wrong with the current version, on a change to an item (heed-ux B5); UTF-16 units. */
  changeReason: 500,
} as const

/** What not to conclude, when the contributor says nothing else (FR-104). */
export const defaultNotToConclude = 'cause not proven'

/**
 * What the contributor wrote must not be concluded, or null for the default or nothing. The
 * default says what the claim level already says, so only the contributor's own words are served.
 */
export function ownCaveat(text: string | null | undefined): string | null {
  const caveat = text?.trim() ?? ''
  return caveat && caveat.toLowerCase() !== defaultNotToConclude ? caveat : null
}

/**
 * What a draft may hold while it is incomplete: a draft saves what was typed, and the format
 * check names what is too long (FR-110). Looser than `limits` on purpose; in UTF-16 units.
 */
export const draftStorageLimits = {
  summary: 20_000,
  body: 40_000,
  date: 10,
} as const

/** Bounds of the agent tool's own inputs, which no attribute has (FR-603: never a transcript). */
export const toolInputLimits = {
  /** What the person wants recorded, in their words or a short summary of them. */
  text: 2000,
  /** Evidence rows an agent may pass in one call. */
  evidence: 5,
  /** A metric, dimension or value name. */
  name: 160,
  /** Names in one scope list. */
  names: 10,
  /** Values of one dimension. */
  values: 50,
} as const

/**
 * Where a field of a draft that an agent or the assistant wrote came from (FR-121, FR-707):
 * `derived`: Heed worked it out exactly. `default`: the documented default (FR-104 to FR-106).
 * `prefilled`: the agent suggested it, and the person must confirm it. `confirmed`: the agent
 * suggested it or asked, and the person answered or confirmed it in their agent. `not_inferred`:
 * left for people; Heed never fills it from what an agent says.
 */
export const fieldMarks = ['derived', 'default', 'prefilled', 'confirmed', 'not_inferred'] as const
export type FieldMark = (typeof fieldMarks)[number]

/**
 * The attributes that carry a provenance mark, in the form's reading order (the order of the
 * marks a person reads); `summary` and `body` stand for their markup too. The parity tests check
 * that each is an attribute of ./proposal-attributes.ts with marks to carry.
 */
export const markedFields = [
  'kind',
  'areaId',
  'ownerId',
  'title',
  'summary',
  'body',
  'scope',
  'validity',
  'reviewDate',
  'evidence',
  'references',
  'changeMarks',
  'claimLevel',
  'riskLevel',
  'audience',
  'notToConclude',
  'replaces',
  'conflicts',
] as const
export type MarkedField = (typeof markedFields)[number]
