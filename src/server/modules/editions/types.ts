import type { ClaimLevel, ItemKind } from '../../../domain/item.ts'
import type { EditionBundle, ResolverItem } from '../../../domain/resolver.ts'
import type { LinkTerm, RawLink, RetiredItem } from '../../../domain/links.ts'
import type { ServedReview } from '../../../domain/served-review.ts'
import type { WrittenTerm } from '../../../domain/served-terms.ts'

export type ServingItem = ResolverItem & {
  kind: ItemKind
  title: string
  claim: ClaimLevel
  /** The team that owns the item's domain. Served context names the owner as a role, never a person (FR-326). */
  owner: { team: string | null }
  /** How this version was accepted, and the edition that first served it; null for a candidate not yet accepted. */
  review: ServedReview | null
  evidence: { url: string; quote: string; read_on: string }[]
  /** What the contributor said not to conclude (FR-104); "cause not proven" by default. */
  notToConclude: string
}
export type { DefinitionState, RawLink } from '../../../domain/links.ts'
/**
 * What a definition source says about a term, as Heed last read it: the source's own words
 * (never a calculation, CON-207) and the tool it reads. Null words when the source gives none.
 * A definition the source limits to groups has none of this (CON-509, groups are parked).
 */
export type SourceDefinition = {
  ref: string
  title: string | null
  description: string | null
  /** The tool the source reads, in words: "Cube". */
  tool: string
  /** The source's name in Administration › Sources. */
  source: string
}
/**
 * A vocabulary term with the state of its definition, for link statuses (FR-333), and what its
 * definition source says, when Heed holds a definition for it.
 */
export type ServingTerm = LinkTerm & { described?: SourceDefinition | null }
export type ServingBundle = Omit<EditionBundle, 'items'> & {
  seq: string
  items: ServingItem[]
  /** The vocabulary, with each served synonym of a metric or a dimension among its other names. */
  terms: ServingTerm[]
  /** The terms and synonyms people wrote that agents get (src/domain/served-terms.ts). */
  written: WrittenTerm[]
  links: RawLink[]
  /** Every domain Heed has, with what its owner wrote about it (summary and description). */
  areas: { id: string; name: string; team: string | null; summary: string; description: string }[]
  refMarks: Record<string, Record<string, string>>
  retired: RetiredItem[]
}
export type ClientPolicy = {
  client_label: string
  tools_allowed: string[] | null
  rate_per_minute: number | null
  max_response_bytes: number | null
  enabled: boolean
}
export type ServingPolicy = {
  client: ClientPolicy | null
  tools: string[]
  /** Requests per minute per client for a tool, from `limits.mcp_rate_per_minute`. */
  limits: Record<string, number>
  /** Requests per minute per person and per client, from `limits.mcp_requests_per_minute`. */
  rates: McpRates
  /**
   * What the server instructions end with: About our business as an administrator wrote it
   * (`business.about`), background and never evidence. Empty when there is none.
   */
  about: string
}
export type McpRates = { person: number; client: number }
export interface EditionSource {
  bundle(edition?: string): Promise<ServingBundle>
  policy(client: string): Promise<ServingPolicy>
}
