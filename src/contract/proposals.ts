import * as z from 'zod/mini'
import { draftSchema } from '../domain/draft.ts'
import { provenanceSchema } from '../domain/provenance.ts'
import { proposalStates } from '../domain/proposal-state.ts'
import {
  claimLevels,
  creationChannels,
  itemKinds,
  personChannels,
  riskLevels,
} from '../domain/item.ts'
import { servedLinkStatuses } from '../domain/links.ts'
import { proposalActions } from '../domain/proposal.ts'
import { limits } from '../domain/proposal-rules.ts'
import { termSchema } from '../domain/vocabulary.ts'

export const findingSchema = z.object({
  code: z.string(),
  field: z.string(),
  message: z.string(),
  severity: z.enum(['error', 'warning']),
})
export const proposalIdSchema = z.strictObject({ id: z.string().check(z.uuid()) })
export const proposalMutationSchema = z.strictObject({
  ...proposalIdSchema.shape,
  revision: z.number().check(z.int(), z.minimum(1)),
})
/**
 * What the proposer says is wrong with the current version, on a change to an item (heed-ux B5):
 * optional plain text, which the reviewer reads as a quote. Empty or null clears it.
 */
const changeReasonSchema = z.nullable(z.string().check(z.maxLength(limits.changeReason)))
export const createProposalSchema = z.strictObject({
  draft: draftSchema,
  reason: z.optional(changeReasonSchema),
  itemId: z.optional(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))),
  derivedFrom: z.optional(z.string().check(z.uuid())),
  channel: z.optional(z.enum(personChannels)),
})
export const proposalRecordSchema = z.object({
  id: z.string(),
  number: z.number(),
  subject: z.enum(['item', 'vocabulary']),
  action: z.enum(proposalActions),
  state: z.enum(proposalStates),
  areaId: z.nullable(z.string()),
  itemId: z.nullable(z.string()),
  itemVersionId: z.nullable(z.string()),
  vocabularyVersionId: z.nullable(z.string()),
  title: z.string(),
  /**
   * Why: a retirement's or re-check's reason, a withdrawal's, or what is wrong with the current
   * version on a change to an item.
   */
  reason: z.nullable(z.string()),
  vocabulary: z.nullable(termSchema),
  /** Who proposed it; null when a content source's read made it (CON-603). */
  proposerId: z.nullable(z.string()),
  channel: z.enum(creationChannels),
  revision: z.number(),
  /** Item form content only; empty for proposals without an item draft. */
  draft: draftSchema,
  /**
   * Where each field came from when an AI agent or the assistant wrote the draft for the person
   * (FR-121, FR-707); null for a draft a person wrote.
   */
  provenance: z.nullable(provenanceSchema),
  /**
   * The agent that sent it for the person (FR-420), by its name when it did; null for anything
   * else.
   */
  agent: z.nullable(z.object({ id: z.string(), name: z.string() })),
  findings: z.array(findingSchema),
  claimedBy: z.nullable(z.string()),
  dueAt: z.nullable(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type ProposalRecord = z.infer<typeof proposalRecordSchema>
export const proposalListResultSchema = z.object({
  rows: z.array(proposalRecordSchema),
  /** Readable proposals matching the filters, before pagination. */
  total: z.number().check(z.int(), z.minimum(0)),
  limit: z.number().check(z.int(), z.minimum(1), z.maximum(100)),
  offset: z.number().check(z.int(), z.minimum(0)),
})
export type ProposalListResult = z.infer<typeof proposalListResultSchema>
export const proposalListSchema = z.strictObject({
  areaId: z.optional(z.string()),
  state: z.optional(z.enum(proposalStates)),
  own: z.optional(z.boolean()),
  /** The changes to one item, such as the open corrections Health offers to attach a test to. */
  itemId: z.optional(z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))),
  limit: z.optional(z.number().check(z.int(), z.minimum(1), z.maximum(100))),
  offset: z.optional(z.number().check(z.int(), z.minimum(0))),
})
export const withdrawSchema = z.strictObject({
  ...proposalMutationSchema.shape,
  reason: z.string().check(z.minLength(1), z.maxLength(500)),
})
/**
 * A test question of the proposal's area attached to its check (FR-524): its results are reported
 * with the change and never block it. Only a development question is ever attached (FR-503).
 */
export const proposalTestSchema = z.object({
  question: z.string(),
  /** A retired or saturated question is no longer checked. */
  active: z.boolean(),
  attachedHour: z.string(),
})
export type ProposalTest = z.infer<typeof proposalTestSchema>
/** A proposal that overlaps: its number, title and kind of context, and where it stands. */
const overlappingProposalSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  kind: z.enum(itemKinds),
  state: z.enum(proposalStates),
})
/** Duplicates and conflicts (FR-109, FR-209): what else covers the same scope and dates. */
export const overlapSchema = z.object({
  /** Accepted items in service. */
  accepted: z.array(z.object({ id: z.string(), title: z.string(), kind: z.enum(itemKinds) })),
  /** The person's own open proposals. */
  ownProposals: z.array(overlappingProposalSchema),
  /**
   * Other people's open proposals that the person reviews: an owner, deputy or approver of
   * their area, or an administrator. Empty for anyone else, who gets only `otherProposalExists`.
   */
  otherProposals: z.array(overlappingProposalSchema),
  /** Whether anyone else has an open proposal that overlaps, including ones not listed. */
  otherProposalExists: z.boolean(),
})

/*
  The reply of get_facts for a draft, as proposals.preview returns it (FR-108, FR-214): the
  same reply an agent would get if the draft were accepted. The field names are the MCP tool's.
*/
const replyStatuses = [
  'matched',
  'conflict',
  'no_match',
  'need_more_detail',
  'check_failed',
] as const
const replyLinkSchema = z.object({
  rel: z.string(),
  target: z.object({
    type: z.string(),
    id: z.string(),
    label: z.string(),
    status: z.enum(servedLinkStatuses),
    area: z.optional(z.string()),
    source_ref: z.optional(z.string()),
    replaced_by: z.optional(z.string()),
    renamed_to: z.optional(z.string()),
  }),
})
export const replyItemSchema = z.object({
  id: z.string(),
  version: z.number(),
  edition: z.string(),
  kind: z.enum(itemKinds),
  title: z.string(),
  summary: z.string(),
  body: z.optional(z.string()),
  /** The stored, half-open window: `end` is the day after the last day (NFR-048). */
  validity: z.object({ start: z.string(), end: z.nullable(z.string()) }),
  claim_level: z.enum(claimLevels),
  risk: z.enum(riskLevels),
  /** `unverified` when a definition changed or the review date passed; the agent says so. */
  freshness: z.enum(['verified', 'unverified']),
  unverified_reason: z.optional(z.string()),
  evidence: z.array(z.object({ url: z.string(), quote: z.string(), read_on: z.string() })),
  /** What the contributor said this does not mean (FR-104), when they wrote more than the default. */
  not_to_conclude: z.optional(z.string()),
  /** Who looks after it, as roles: the domain's team and "the owner of Commercial", never a person (FR-326). */
  owner: z.object({ team: z.nullable(z.string()), role: z.string() }),
  /**
   * How it was reviewed before it was served (FR-326): the day it was accepted, the role that
   * accepted it ("the owner of Commercial", never a person) and the edition that first served
   * this version. Absent for a version not accepted yet, such as a draft in a preview.
   */
  reviewed: z.optional(
    z.object({ accepted_on: z.string(), accepted_by: z.string(), in_edition: z.string() }),
  ),
  links: z.array(replyLinkSchema),
  match: z.enum(['exact', 'partial']),
  /** The asked metrics it is about, by name, when a reply is about more than one metric. */
  about: z.optional(z.array(z.string())),
  /** "Applies to market: Norway only." for a partial match. */
  applies_note: z.optional(z.string()),
  /** Delivered items this one conflicts with. */
  conflicts_with: z.optional(z.array(z.string())),
  /** Its page in Heed (FR-347): on the web app's address, or a path on it without one. */
  url: z.optional(z.string()),
})
/**
 * What a metric means, for a definition question (FR-338): the source's own words (at most 500
 * characters), where they come from, and what Heed adds. The same as find_facts gives.
 */
export const replyDefinitionSchema = z.object({
  term: z.string(),
  named: z.enum(['exactly', 'in part']),
  named_note: z.optional(z.string()),
  key: z.string(),
  kind: z.enum(['metric', 'metric group', 'dimension']),
  other_names: z.optional(z.array(z.string())),
  group: z.optional(z.string()),
  domain: z.optional(z.string()),
  definition: z.nullable(z.string()),
  /** `source` (a definition source read through Sources), `library` or `none`. */
  origin: z.enum(['source', 'library', 'none']),
  origin_words: z.string(),
  source: z.optional(
    z.object({
      tool: z.string(),
      name: z.string(),
      ref: z.string(),
      title: z.optional(z.string()),
      state: z.enum(['current', 'changed', 'missing']),
    }),
  ),
  /** Heed's notes and guides about it, when the source gives no words. */
  library: z.optional(
    z.array(z.object({ id: z.string(), kind: z.string(), title: z.string(), summary: z.string() })),
  ),
  heed_adds: z.string(),
})
export const replyCheckReportSchema = z.object({
  status: z.enum(replyStatuses),
  matched: z.number(),
  withheld: z.number(),
  links_withheld: z.number(),
  /** Items or links were left out to fit the size limit. */
  cut: z.boolean(),
  cut_ids: z.array(z.string()),
  checked: z.array(z.string()),
  statements: z.array(z.string()),
})
export const previewReplySchema = z.object({
  /** The sentences for the status that an agent may repeat to the person as they stand (FR-344). */
  say: z.optional(z.string()),
  /** The step the agent takes next with this reply: for it, not the person (FR-344). */
  next: z.optional(z.string()),
  status: z.enum(replyStatuses),
  /** Absent only when the checks could not run (`check_failed`). */
  edition: z.optional(z.string()),
  overlay: z.optional(z.string()),
  tool_schema_digest: z.optional(z.string()),
  delivery_id: z.optional(z.string()),
  scope_used: z.optional(
    z.nullable(
      z.object({
        metrics: z.array(z.string()),
        filters: z.record(z.string(), z.array(z.string())),
        window: z.object({ start: z.string(), end: z.nullable(z.string()) }),
      }),
    ),
  ),
  /**
   * The day Heed read a question at because it gave no dates: today, a UTC day, with a sentence
   * for the person. Present whenever the reply used it.
   */
  assumed_date: z.optional(
    z.object({
      date: z.string(),
      time_zone: z.literal('UTC'),
      reason: z.literal('no date given'),
      sentence: z.string(),
    }),
  ),
  /**
   * The domains of the asked metrics, with what their owners wrote about them (FR-813): the
   * summary line, and the description unless the reply is concise.
   */
  domains: z.optional(
    z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        summary: z.optional(z.string()),
        description: z.optional(z.string()),
      }),
    ),
  ),
  /** For a question about what a metric means: its definition, before the items. */
  definitions: z.optional(z.array(replyDefinitionSchema)),
  items: z.optional(z.array(replyItemSchema)),
  /** What the question could mean, when it needs more detail. */
  options: z.optional(
    z.array(z.object({ field: z.string(), input: z.string(), options: z.array(z.string()) })),
  ),
  check_report: replyCheckReportSchema,
  instructions: z.optional(z.string()),
})
