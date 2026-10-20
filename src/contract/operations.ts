/**
 * The operations view (FR-810): for each scheduled job and each connector, the last success, the
 * last error and the age of its data, plus the job queue and the model spending. It holds no
 * person: spending is summed over people. Times are ISO 8601 in UTC.
 */
import * as z from 'zod/mini'

const time = z.string()

/** What each status means is in src/server/modules/jobs/status.ts. */
export const jobStatuses = ['ok', 'waiting', 'failing', 'overdue'] as const
export const connectorStatuses = ['ok', 'waiting', 'stale', 'disabled'] as const
export const runnerStates = ['starting', 'running', 'stopped'] as const

const queueCountsSchema = z.object({
  queued: z.number(),
  active: z.number(),
  deferred: z.number(),
  failed: z.number(),
})

export const jobOverviewSchema = z.object({
  name: z.string(),
  cron: z.string(),
  status: z.enum(jobStatuses),
  expectedEverySeconds: z.number(),
  registeredAt: z.nullable(time),
  lastStartedAt: z.nullable(time),
  lastSucceededAt: z.nullable(time),
  lastErrorAt: z.nullable(time),
  lastError: z.nullable(z.string()),
  runsOk: z.number(),
  runsFailed: z.number(),
  /** Null while the job runner is not running. */
  queue: z.nullable(queueCountsSchema),
})

/**
 * What a definition source warns about in a read, with the file, view or member it names (the
 * connector contract, docs/connectors.md): a file it skipped or could not read, a view without a
 * domain or with one that is not a domain id, a domain taken from the server's list, a rename
 * that does not apply, and a member another source already reads. The rest say why a read
 * failed before anything was read, naming the repository, its ref, its folder or the secret:
 * the address could not be reached, the token was refused, no repository or ref is there, the
 * folder is not in it, the secret is not in the store, or the fetch failed otherwise. An
 * interface 3 connector's read may also fail because it sent what the contract does not allow or
 * took longer than its limit, and is in part when it sent more records than its limit; its own
 * warnings are namespaced (`<connector>.<code>`) and worded in its manifest.
 */
export const sourceWarningCodes = [
  'unsupported_file',
  'unreadable_file',
  'invalid_domain',
  'missing_domain',
  'domain_override',
  'invalid_rename',
  'taken',
  'private_address',
  'unreachable',
  'unauthorized',
  'not_found',
  'ref_not_found',
  'folder_missing',
  'secret_missing',
  'fetch_failed',
  'compiler_unavailable',
  'no_model_files',
  'compile_error',
  'compile_timeout',
  'invalid_output',
  'timed_out',
  'too_many_records',
] as const
export type SourceWarningCode = (typeof sourceWarningCodes)[number]

/**
 * Where a source is configured: by whoever runs the server (its environment), or by an
 * administrator in Administration › Sources, stored in the database.
 */
export const sourceOrigins = ['server', 'workspace'] as const

/**
 * What a source reads from the server's own configuration, which only whoever runs the server
 * sets: the model folder, the file of domain names and the file of renamed members.
 */
export const sourceServerSettingKeys = ['model_folder', 'domain_overrides', 'renames'] as const
export type SourceServerSettingKey = (typeof sourceServerSettingKeys)[number]

const sourceWarningSchema = z.object({ code: z.string(), target: z.string() })
export const connectorOverviewSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  /** What the source is: `definition_source` says which metrics and dimensions exist. */
  kind: z.string(),
  /** Configured by the server (read only here) or by an administrator (changed in Sources). */
  origin: z.enum(sourceOrigins),
  /** The tool the source reads, as people say it ("Cube"), for the words on screen. */
  tool: z.string(),
  /** The administrator settings that belong to the source, by key (FR-809). */
  settingKeys: z.array(z.string()),
  /**
   * How this server reads the source, from its own configuration (read only here); null when
   * this server does not read it, as when the source was read by another server or by the seed.
   */
  server: z.nullable(
    z.object({
      settings: z.array(
        z.object({
          key: z.enum(sourceServerSettingKeys),
          /** The environment variable that sets it. */
          variable: z.string(),
          /** A path on the server; null when it is not set. Never a secret. */
          value: z.nullable(z.string()),
        }),
      ),
    }),
  ),
  status: z.enum(connectorStatuses),
  staleAfterSeconds: z.number(),
  lastSuccessAt: z.nullable(time),
  ageSeconds: z.nullable(z.number()),
  sourceVersion: z.nullable(z.string()),
  lastErrorAt: z.nullable(time),
  lastError: z.nullable(z.string()),
  /** The most recent read, good or not, and the files and views it warned about (CON-504, CON-516). */
  lastRead: z.nullable(
    z.object({
      status: z.enum(['ok', 'partial', 'failed']),
      at: time,
      warnings: z.array(sourceWarningSchema),
    }),
  ),
  definitions: z.object({ current: z.number(), missing: z.number() }),
  /** Current metrics by where their domain comes from: Cube, the local override file, or nowhere. */
  domainCoverage: z.object({ cube: z.number(), override: z.number(), none: z.number() }),
  /** Accepted items flagged because a definition of this source they reference changed or went. */
  flaggedItems: z.number(),
  /** Mentions of this source's definitions that changed or went since the item was written. */
  staleLinks: z.number(),
  /**
   * What the source holds now, by view: the part of a member's name before its last dot
   * (`payments` of `payments.orders`). Members without one are in no view. By name.
   */
  views: z.array(
    z.object({
      name: z.string(),
      metrics: z.number(),
      dimensions: z.number(),
      /** The domains its current members belong to, the most members first. */
      domains: z.array(z.string()),
      /** Its metrics without a domain (CON-516). */
      withoutDomain: z.number(),
      /** Its members whose domain comes from the server's list rather than the model. */
      fromServer: z.number(),
      /** The model file that defines it, relative to the model folder; null when none. */
      modelFile: z.nullable(z.string()),
    }),
  ),
  /** Members gone from the source with the new id the server's renames name (CON-512). */
  renames: z.array(z.object({ from: z.string(), to: z.string() })),
  /** The newest reads, good or not, newest first: at most 6. */
  recentReads: z.array(
    z.object({
      at: time,
      status: z.enum(['ok', 'partial', 'failed']),
      durationMs: z.nullable(z.number()),
      definitionsSeen: z.number(),
      /** Warnings that ask for a look; information, such as a server-given domain, is not one. */
      warnings: z.number(),
      sourceVersion: z.nullable(z.string()),
    }),
  ),
})

export const operationsOverviewSchema = z.object({
  checkedAt: time,
  runner: z.enum(runnerStates),
  jobs: z.array(jobOverviewSchema),
  connectors: z.array(connectorOverviewSchema),
  spend: z.object({
    /** The current UTC month, `YYYY-MM`. */
    month: z.string(),
    monthCostMicros: z.number(),
    monthCapMicros: z.nullable(z.number()),
    todayCostMicros: z.number(),
    byFeature: z.array(
      z.object({ feature: z.string(), calls: z.number(), costMicros: z.number() }),
    ),
  }),
})
export type OperationsOverviewView = z.infer<typeof operationsOverviewSchema>

export const runJobInputSchema = z.strictObject({
  job: z.string().check(z.regex(/^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)*$/), z.maxLength(80)),
})
export const runJobSchema = z.object({
  job: z.string(),
  status: z.literal('queued'),
  /** The queued run's id in the job queue. */
  id: z.string(),
})
