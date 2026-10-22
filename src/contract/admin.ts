/**
 * Administration (FR-407, FR-806 to FR-809), item import (FR-120), edition export (NFR-093) and
 * the published item schema (FR-124).
 */
import * as z from 'zod/mini'
import {
  ABOUT_BUSINESS_MAX,
  aboutBusinessLength,
  normalizeAboutBusiness,
} from '../domain/about-business.ts'
import { EDITION_EXPORT_FORMAT } from '../domain/edition-export.ts'
import { ITEM_FILE_MAX_LENGTH } from '../domain/item-file.ts'
import { itemVersionSchema } from '../domain/item-version.ts'
import { areaStates } from '../domain/item.ts'
import { calendarDateSchema } from '../domain/validity.ts'
import { findingSchema } from './proposals.ts'

const reason = z.string().check(z.minLength(1), z.maxLength(500))
const int = (min: number, max: number) => z.number().check(z.int(), z.minimum(min), z.maximum(max))
const days = int(1, 3650)
const micros = int(0, 1_000_000_000_000)
const perMinute = int(1, 10_000)
const toolName = z.string().check(z.regex(/^[a-z_]{1,40}$/))
/**
 * A role's model: a provider from the service's provider registry and a model that provider
 * lists. The service refuses one it cannot serve. What is sent to the model leaves the company to
 * that provider and the model's vendor.
 */
const modelRef = z.strictObject({
  provider: z.string().check(z.regex(/^[a-z][a-z0-9-]{0,39}$/)),
  model: z.string().check(z.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/)),
})

/**
 * Every setting an administrator may change, with the values it accepts. A key outside this
 * list is not changed through the API; adding a setting means adding it here and to a migration.
 */
export const settingSchemas = {
  'privacy.min_count': int(2, 100),
  'retention.delivery_days': days,
  'retention.note_days': days,
  'retention.request_log_days': days,
  'retention.outbox_days': days,
  'gaps.no_item_threshold': z.strictObject({ calls: int(1, 10_000), days: int(1, 365) }),
  'limits.mcp_rate_per_minute': z.record(toolName, perMinute),
  // MCP calls per minute: per person (one token) and per client label, unless the client's own
  // policy sets its rate (FR-408).
  'limits.mcp_requests_per_minute': z.strictObject({ person: perMinute, client: perMinute }),
  // Web API requests per minute: per signed-in person, and per address before sign-in (FR-408).
  'limits.api_rate_per_minute': z.strictObject({ person: perMinute, ip: perMinute }),
  // Gaps a signed-in person reports from Try it or the assistant, per minute (FR-408): tighter
  // than every other request, like report_gap's own limit.
  'limits.gap_reports_per_minute': z.strictObject({ person: perMinute }),
  // Ratings a signed-in person gives the assistant's answers, per minute (FR-408, FR-712), like
  // give_feedback's own limit.
  'limits.assistant_ratings_per_minute': z.strictObject({ person: perMinute }),
  // Drafts that the AI agents of one person may save in a day, and their agent drafts still
  // open, with the draft tool (FR-121).
  'limits.agent_drafts': z.strictObject({ per_day: int(1, 1000), open: int(1, 1000) }),
  // Web searches one person's assistant may run in a day (search_web); 0 switches web search off.
  // The search words leave the company to the model provider and its search partners.
  'limits.web_searches_per_day': int(0, 1000),
  'limits.llm_daily_micros_per_person': micros,
  'limits.llm_monthly_cap_micros': micros,
  'limits.llm_feature_monthly_micros': z.partialRecord(z.enum(['eval', 'assistant']), micros),
  'limits.mentions_per_version': int(0, 50),
  'review.default_days': days,
  // An issue with no end date is asked "Is this still going on?" this many days after it starts.
  'review.open_issue_days': days,
  // Stop switches must reach new requests within 60 seconds (FR-805).
  'serving.max_overlay_age_seconds': int(1, 60),
  'evals.tries': int(1, 20),
  // The majority of the repeats decides a flip, so the count is odd.
  'evals.flip_repeats': int(1, 15).check(z.refine((n) => n % 2 === 1, 'Expected an odd number')),
  'evals.run_budget_micros': micros,
  'models.eval_answer': modelRef,
  // A model, or `different_family`: a judge of another model line than the answering model, from
  // the same provider and vendor. A judge of another vendor is named here.
  'models.judge': z.union([modelRef, z.literal('different_family')]),
  'models.assistant': modelRef,
  // Drafting test questions; no feature uses it yet.
  'models.test_authoring': modelRef,
  // How hard test runs may call a model provider (output test plan, R4 and R5): answers made at
  // once per provider, and requests and tokens a minute per provider and model. A free gateway key
  // takes concurrency 1 and 5 requests a minute. A person's assistant turn is not held back.
  'models.call_limits': z.strictObject({
    concurrency: int(1, 32),
    requests_per_minute: z.optional(int(1, 100_000)),
    tokens_per_minute: z.optional(int(1, 100_000_000)),
  }),
  // The address of the Cube model folder in the Git host's web view, for example
  // `https://github.com/acme/analytics/blob/main/model`. Null (the default) shows no link to a
  // model file. The service never fetches it: the catalogue only builds addresses under it.
  'sources.cube_model_url': z.nullable(
    z.url({ protocol: /^https$/ }).check(
      z.maxLength(500),
      z.refine((value) => {
        // Runs even when the address check failed, so it parses safely.
        const url = URL.parse(value)
        return url !== null && !url.username && !url.password && !url.search && !url.hash
      }, 'Expected an https address without credentials, query or fragment'),
    ),
  ),
  // About our business (domain/about-business.ts): what the company does and the words models
  // misread, as background the assistant and connected agents get, never as evidence. Kept as
  // plain text in Heed's form of it; empty gives them none.
  'business.about': z.string().check(
    z.overwrite(normalizeAboutBusiness),
    z.refine(
      (text) => aboutBusinessLength(text) <= ABOUT_BUSINESS_MAX,
      `Expected at most ${ABOUT_BUSINESS_MAX} characters`,
    ),
  ),
} as const
export type SettingKey = keyof typeof settingSchemas
export const settingKeys = Object.keys(settingSchemas) as SettingKey[]

const settingKey = z.string().check(z.regex(/^[a-z_]+(\.[a-z_]+)*$/), z.maxLength(100))
export const settingSchema = z.object({
  key: z.string(),
  version: z.number(),
  value: z.unknown(),
  changedAt: z.string(),
  changedBy: z.nullable(z.string()),
  reason: z.nullable(z.string()),
  /** False for a stored key that the API does not change (no schema in `settingSchemas`). */
  editable: z.boolean(),
})
export type Setting = z.infer<typeof settingSchema>
export const settingKeyInputSchema = z.strictObject({ key: settingKey })
export const setSettingSchema = z.strictObject({
  key: settingKey,
  /** The version you read; a newer one is a conflict. */
  version: int(1, 1_000_000),
  value: z.unknown(),
  reason,
})

export const toolSwitchSchema = z.object({
  tool: z.string(),
  enabled: z.boolean(),
  updatedAt: z.string(),
})
export const setToolSchema = z.strictObject({ tool: toolName, enabled: z.boolean(), reason })

/** Why tool names that a setting or an agent's tools name are refused: we have no such tools. */
export const unknownToolsMessage = (tools: readonly string[]) =>
  `There's no tool called ${new Intl.ListFormat('en-GB', { type: 'disjunction' }).format(tools)}. Check the name, then try again.`

const clientLabel = z.string().check(z.regex(/^[a-z0-9_.-]{1,40}$/))
export const clientPolicySchema = z.object({
  label: z.string(),
  displayName: z.string(),
  /** Null: every switched-on tool. */
  toolsAllowed: z.nullable(z.array(z.string())),
  ratePerMinute: z.nullable(z.number()),
  maxResponseBytes: z.nullable(z.number()),
  enabled: z.boolean(),
})
export type ClientPolicy = z.infer<typeof clientPolicySchema>
export const saveClientSchema = z.strictObject({
  label: clientLabel,
  displayName: z.string().check(z.minLength(1), z.maxLength(100)),
  toolsAllowed: z.nullable(z.array(toolName).check(z.maxLength(50))),
  ratePerMinute: z.nullable(perMinute),
  // The gateway answers at most 100,000 bytes to any client.
  maxResponseBytes: z.nullable(int(1_000, 100_000)),
  enabled: z.boolean(),
  reason,
})

export const trafficInputSchema = z.strictObject({
  /** The last this many days, counted in whole hours back from the current hour. */
  days: z._default(int(1, 90), 7),
})
const trafficCountsSchema = z.object({
  calls: z.number(),
  ok: z.number(),
  errors: z.number(),
  /** Tool calls whose arguments the tool could not read: a model's mistake, not Heed's error. */
  invalidInput: z.number(),
  rateLimited: z.number(),
  /** Refused: a wrong host or origin, a missing scope, a client switched off or a tool it may not call. */
  forbidden: z.number(),
  /** Refused for want of a valid token. */
  unauthorized: z.number(),
  /** Over the calls that recorded a duration; null when none did. */
  medianMs: z.nullable(z.number()),
  p95Ms: z.nullable(z.number()),
  /** The bytes answered, summed. */
  bytes: z.number(),
})
/**
 * MCP traffic by client and tool, from the request log (FR-410). The log holds no person, so
 * neither does this: a client is its label, which every person's app of that kind shares. The
 * kind of agent is counted apart, by the week, small counts hidden (the quality read `apps`).
 */
export const trafficSummarySchema = z.object({
  /** The first hour counted, inclusive, and the hour after the last; ISO 8601 in UTC. */
  from: z.string(),
  to: z.string(),
  /** `retention.request_log_days`: older hours are no longer in the log. */
  retentionDays: z.number(),
  total: z.object({ ...trafficCountsSchema.shape, lastHour: z.nullable(z.string()) }),
  /** One row per client and tool that was called, most calls first. */
  rows: z.array(
    z.object({
      /** `unknown` for a call refused before a token named its client. */
      client: z.string(),
      /** The client's display name from its policy; null for a label without one. */
      clientName: z.nullable(z.string()),
      /** `protocol` for a call that is not a tool call, such as starting a session or listing tools. */
      tool: z.string(),
      ...trafficCountsSchema.shape,
      /** The latest hour with a call. */
      lastHour: z.string(),
    }),
  ),
})
export type TrafficSummary = z.infer<typeof trafficSummarySchema>

const auditFilters = {
  action: z.optional(z.string().check(z.regex(/^[a-z_]+(\.[a-z_]+)?$/), z.maxLength(80))),
  actorId: z.optional(z.string().check(z.uuid())),
  areaId: z.optional(z.string().check(z.maxLength(40))),
  subjectType: z.optional(z.string().check(z.maxLength(40))),
  subjectId: z.optional(z.string().check(z.maxLength(200))),
  /** The id of the request that wrote the entry, as its log lines and `x-request-id` carry it. */
  requestId: z.optional(z.string().check(z.uuid())),
  /** The batch id the role changes of one step share (FR-804). */
  batchId: z.optional(z.string().check(z.uuid())),
  /** First UTC day, inclusive. */
  from: z.optional(calendarDateSchema),
  /** Last UTC day, inclusive. */
  to: z.optional(calendarDateSchema),
}
export const auditSearchSchema = z.strictObject({
  ...auditFilters,
  /** Entries older than this sequence number: the `next` of the page before. */
  before: z.optional(int(1, Number.MAX_SAFE_INTEGER)),
  limit: z.optional(int(1, 200)),
})
export const auditEntrySchema = z.object({
  seq: z.number(),
  at: z.string(),
  actorId: z.nullable(z.string()),
  actorName: z.nullable(z.string()),
  actorKind: z.enum(['person', 'system', 'service']),
  action: z.string(),
  areaId: z.nullable(z.string()),
  subjectType: z.nullable(z.string()),
  subjectId: z.nullable(z.string()),
  /** The request that wrote the entry; null for a scheduled job or other work outside a request. */
  requestId: z.nullable(z.string()),
  details: z.record(z.string(), z.unknown()),
  hash: z.string(),
  /**
   * For the log's own screen, not part of the entry: a proposal's number, and a proposal's or an
   * item's title, while the reader may see the subject (row security decides). Exports leave
   * them out.
   */
  subjectNumber: z.optional(z.nullable(z.number())),
  subjectTitle: z.optional(z.nullable(z.string())),
  /** The step a role change was part of; the entries of one step share it. Null otherwise. */
  batchId: z.nullable(z.string()),
  /** Why, as the person gave it for a role change; null when they gave none. */
  reason: z.nullable(z.string()),
  /** Where a role change came from: `named` is a person naming another in Heed. */
  source: z.nullable(z.enum(['named'])),
})
export type AuditEntry = z.infer<typeof auditEntrySchema>
export const auditPageSchema = z.object({
  entries: z.array(auditEntrySchema),
  next: z.nullable(z.number()),
})
export const auditExportInputSchema = z.strictObject({
  ...auditFilters,
  format: z._default(z.enum(['jsonl', 'csv']), 'jsonl'),
  /** Entries newer than this sequence number: the `next` of the export before. */
  after: z.optional(int(0, Number.MAX_SAFE_INTEGER)),
  limit: z.optional(int(1, 10_000)),
})
export const auditChainSchema = z.object({
  /** True when every entry's hash follows from its content and the entry before (FR-806). */
  verified: z.boolean(),
  firstBadSeq: z.nullable(z.number()),
})
export const auditExportSchema = z.object({
  format: z.enum(['jsonl', 'csv']),
  content: z.string(),
  count: z.number(),
  /** Pass as `after` for the rest; null when this export reached the end. */
  next: z.nullable(z.number()),
  chain: auditChainSchema,
})

export const itemImportSchema = z.strictObject({
  /** A YAML or JSON item file (src/domain/item-file.ts). */
  content: z.string().check(z.minLength(1), z.maxLength(ITEM_FILE_MAX_LENGTH)),
  /** A dry run checks every entry and changes nothing. */
  dryRun: z._default(z.boolean(), true),
  /** Submit the proposals for review; false keeps them as drafts. */
  submit: z._default(z.boolean(), true),
  /** The file name, kept with the import batch. */
  sourceName: z.optional(z.string().check(z.minLength(1), z.maxLength(200))),
})
export const importEntryReportSchema = z.object({
  index: z.number(),
  itemId: z.nullable(z.string()),
  title: z.nullable(z.string()),
  /** `unchanged`: the entry equals the live version, so no proposal is made. */
  action: z.enum(['create', 'change', 'unchanged']),
  proposalId: z.nullable(z.string()),
  findings: z.array(findingSchema),
})
export const itemImportReportSchema = z.object({
  /** True when the proposals were made; nothing is made while any entry has an error. */
  applied: z.boolean(),
  batchId: z.nullable(z.string()),
  /** A problem with the file itself, before any entry. */
  error: z.nullable(z.string()),
  entries: z.array(importEntryReportSchema),
  counts: z.object({
    create: z.number(),
    change: z.number(),
    unchanged: z.number(),
    errors: z.number(),
  }),
})
export type ItemImportReport = z.infer<typeof itemImportReportSchema>

const editionLabel = z.string().check(z.regex(/^\d{4}-\d{2}-\d{2}\.\d+$/))
export const editionExportInputSchema = z.strictObject({ label: editionLabel })
const digest = z.string().check(z.regex(/^[0-9a-f]{64}$/))
export const editionExportSchema = z.object({
  format: z.literal(EDITION_EXPORT_FORMAT),
  edition: z.object({
    seq: z.number(),
    label: z.string(),
    reason: z.string(),
    note: z.nullable(z.string()),
    restores: z.nullable(z.string()),
    createdAt: z.string(),
    sealedAt: z.string(),
  }),
  digest,
  items: z.array(
    z.object({ id: z.string(), version: z.number(), digest, ...itemVersionSchema.shape }),
  ),
  withheld: z.array(z.object({ id: z.string(), digest })),
  vocabulary: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['metric', 'metric_group', 'dimension', 'dimension_value']),
      parentKey: z.nullable(z.string()),
      name: z.string(),
      aliases: z.array(z.string()),
      areaId: z.nullable(z.string()),
      definitionRefs: z.array(z.string()),
      digest,
    }),
  ),
  areas: z.array(z.object({ id: z.string(), state: z.enum(areaStates) })),
  /** The domains the definition source gave terms in the edition; with the vocabulary's areas, its area map. */
  domains: z.optional(z.array(z.object({ key: z.string(), areaId: z.string() }))),
})

export const jsonSchemaDocument = z.record(z.string(), z.unknown())
