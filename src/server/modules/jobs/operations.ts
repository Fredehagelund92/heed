import type { OperationsOverviewView, runnerStates } from '../../../contract/operations.ts'
import type { Database } from '../../db/database.ts'
import { sourceViews, type SourceMember, type SourceView } from '../../../domain/source-views.ts'
import {
  connectorType,
  domainSource,
  overriddenMembers,
  type ConnectorRegistry,
} from '../connectors/index.ts'
import type { ScheduledJob } from './scheduled-job.ts'
import { connectorStatus, jobStatus, type ConnectorStatus, type JobStatus } from './status.ts'

/**
 * The operations view (FR-810): for each scheduled job and each connector, the last success, the
 * last error and the age of its data, plus the job queue and the model spending. It holds no
 * person: spending is summed over people.
 */

export interface QueueCounts {
  queued: number
  active: number
  deferred: number
  failed: number
}

export interface JobOverview {
  name: string
  cron: string
  status: JobStatus
  expectedEverySeconds: number
  registeredAt: Date | null
  lastStartedAt: Date | null
  lastSucceededAt: Date | null
  lastErrorAt: Date | null
  lastError: string | null
  runsOk: number
  runsFailed: number
  /** Null while the job runner is not running. */
  queue: QueueCounts | null
}

export interface ConnectorOverview {
  id: string
  name: string
  type: string
  kind: string
  /** Configured by the server, or by an administrator in Sources. */
  origin: 'server' | 'workspace'
  /** The tool the source reads, as people say it, from its type. */
  tool: string
  /** The administrator settings that belong to the source. */
  settingKeys: string[]
  status: ConnectorStatus
  staleAfterSeconds: number
  lastSuccessAt: Date | null
  ageSeconds: number | null
  sourceVersion: string | null
  lastErrorAt: Date | null
  lastError: string | null
  /** The most recent read, good or not, and the files and views it warned about (CON-504, CON-516). */
  lastRead: { status: 'ok' | 'partial' | 'failed'; at: Date; warnings: SourceWarning[] } | null
  definitions: { current: number; missing: number }
  /** Current metrics by where their domain comes from: Cube, the local override file, or nowhere. */
  domainCoverage: { cube: number; override: number; none: number }
  /** Accepted items flagged because a definition of this source they reference changed or went. */
  flaggedItems: number
  /** Mentions of this source's definitions that changed or went since the item was written. */
  staleLinks: number
  /** What the source holds now, by view (domain/source-views.ts). */
  views: SourceView[]
  /** Members gone from the source with the new id its renames name (CON-512). */
  renames: { from: string; to: string }[]
  /** The newest reads, good or not, newest first. */
  recentReads: SourceRead[]
}

export interface SourceRead {
  at: Date
  status: 'ok' | 'partial' | 'failed'
  durationMs: number | null
  definitionsSeen: number
  warnings: number
  sourceVersion: string | null
}

/** How many reads of each source the overview lists. */
export const recentReadCount = 6

export interface SourceWarning {
  code: string
  target: string
}

export interface SpendOverview {
  /** The current UTC month, `YYYY-MM`. */
  month: string
  monthCostMicros: number
  monthCapMicros: number | null
  todayCostMicros: number
  byFeature: { feature: string; calls: number; costMicros: number }[]
}

export type RunnerState = (typeof runnerStates)[number]

export interface OperationsOverview {
  checkedAt: Date
  runner: RunnerState
  jobs: JobOverview[]
  connectors: ConnectorOverview[]
  spend: SpendOverview
}

interface HeartbeatRow {
  job: string
  registered_at: Date | null
  last_started: Date | null
  last_succeeded: Date | null
  last_error_at: Date | null
  last_error: string | null
  runs_ok: string | null
  runs_failed: string | null
  now: Date
}

export async function readJobs(
  database: Database,
  jobs: ScheduledJob[],
  queues: Map<string, QueueCounts> | null,
): Promise<{ checkedAt: Date; jobs: JobOverview[] }> {
  const rows = await database.query<HeartbeatRow>(
    `select j.job, h.registered_at, h.last_started, h.last_succeeded, h.last_error_at, h.last_error,
       h.runs_ok, h.runs_failed, now() as now
     from unnest($1::text[]) as j(job) left join job_heartbeats h on h.job = j.job`,
    [jobs.map((job) => job.name)],
  )
  const checkedAt = rows[0]?.now ?? (await databaseNow(database))
  const byName = new Map(rows.map((row) => [row.job, row]))
  return {
    checkedAt,
    jobs: jobs.map((job) => {
      const row = byName.get(job.name)
      const times = {
        expectedEverySeconds: job.expectedEverySeconds,
        registeredAt: row?.registered_at ?? null,
        lastSucceededAt: row?.last_succeeded ?? null,
        lastErrorAt: row?.last_error_at ?? null,
      }
      return {
        name: job.name,
        cron: job.cron,
        status: jobStatus(times, checkedAt),
        expectedEverySeconds: job.expectedEverySeconds,
        registeredAt: times.registeredAt,
        lastStartedAt: row?.last_started ?? null,
        lastSucceededAt: times.lastSucceededAt,
        lastErrorAt: times.lastErrorAt,
        lastError: row?.last_error ?? null,
        runsOk: Number(row?.runs_ok ?? 0),
        runsFailed: Number(row?.runs_failed ?? 0),
        queue: queues ? (queues.get(job.name) ?? null) : null,
      }
    }),
  }
}

interface ConnectorRow {
  id: string
  name: string
  type: string
  kind: string
  origin: 'server' | 'workspace'
  enabled: boolean
  stale_after_seconds: string
  created_at: Date
  last_success_at: Date | null
  source_version: string | null
  last_error_at: Date | null
  last_error: string | null
  last_read: { status: 'ok' | 'partial' | 'failed'; at: string; warnings: SourceWarning[] } | null
  current: number
  missing: number
  coverage: { cube: number; override: number; none: number }
  flagged_items: number
  stale_links: number
  now: Date
}

export async function readConnectors(database: Database): Promise<ConnectorOverview[]> {
  // A partial snapshot still brought data (CON-504), so it counts towards the age of the data.
  const rows = await database.query<ConnectorRow>(
    `select c.id, c.name, c.type, c.kind::text as kind, c.origin, c.enabled, extract(epoch from c.stale_after) as stale_after_seconds,
       c.created_at, good.fetched_at as last_success_at, good.source_version,
       bad.fetched_at as last_error_at, bad.error as last_error, now() as now,
       (select json_build_object('status', s.status, 'at', s.fetched_at, 'warnings', s.warnings)
          from connector_snapshots s where s.connector_id = c.id
          order by s.fetched_at desc limit 1) as last_read,
       defs.current, defs.missing,
       json_build_object('cube', defs.cube, 'override', defs.override, 'none', defs.none) as coverage,
       (select count(distinct l.id)::int from v_overlay_on o
          join v_item_list l on l.id = o.item_id and l.status = 'accepted'
            and cl_audience_allows(l.audience_groups)
          join item_version_refs r on r.version_id = l.version_id
          join definitions d on d.ref = r.definition_ref
         where o.kind = 'flag_on' and d.connector_id = c.id
           and (d.missing_since_snapshot is not null or d.change_mark <> r.change_mark)) as flagged_items,
       (select count(*)::int from v_stale_links x join definitions d on d.ref = x.definition_ref
         where d.connector_id = c.id and x.status in ('source_changed', 'source_missing')) as stale_links
     from connectors c
     left join lateral (
       select count(*) filter (where d.missing_since_snapshot is null)::int as current,
              count(*) filter (where d.missing_since_snapshot is not null)::int as missing,
              count(*) filter (where m.metric and m.source = 'cube')::int as cube,
              count(*) filter (where m.metric and m.source = 'override')::int as override,
              count(*) filter (where m.metric and m.source = 'none')::int as none
         from definitions d ${overriddenMembers}
         cross join lateral (select d.kind = 'metric' and d.missing_since_snapshot is null as metric,
           ${domainSource} as source) m
        where d.connector_id = c.id) defs on true
     left join lateral (select fetched_at, source_version from connector_snapshots s
       where s.connector_id = c.id and s.status in ('ok', 'partial')
       order by fetched_at desc limit 1) good on true
     left join lateral (select fetched_at, error from connector_snapshots s
       where s.connector_id = c.id and s.status = 'failed'
       order by fetched_at desc limit 1) bad on true
    where c.removed_at is null
     order by c.id`,
  )
  const members = await database.query<SourceMember & { connectorId: string }>(
    `select d.connector_id as "connectorId", d.name, d.kind::text as kind, d.area_hint as "areaHint",
       d.model_file as "modelFile", ${domainSource} = 'override' as "fromServer"
     from definitions d ${overriddenMembers} where d.missing_since_snapshot is null`,
  )
  const renames = await database.query<{ connector_id: string; from: string; to: string }>(
    `select connector_id, ref as "from", renamed_to as "to" from definitions
      where missing_since_snapshot is not null and renamed_to is not null
      order by ref collate "C"`,
  )
  const reads = await database.query<{
    connector_id: string
    at: Date
    status: 'ok' | 'partial' | 'failed'
    duration_ms: number | null
    definitions_seen: number
    warnings: number
    source_version: string | null
  }>(
    `select connector_id, fetched_at as at, status::text as status, duration_ms, definitions_seen,
       (select count(*) from jsonb_array_elements(warnings) w
         where w ->> 'code' <> 'domain_override')::int as warnings, source_version
     from (select s.*, row_number() over (partition by s.connector_id order by s.fetched_at desc) as n
             from connector_snapshots s) s
     where n <= $1 order by connector_id, fetched_at desc`,
    [recentReadCount],
  )
  return rows.map((row) => {
    const type = connectorType(row.type, row.name)
    const times = {
      enabled: row.enabled,
      staleAfterSeconds: Number(row.stale_after_seconds),
      createdAt: row.created_at,
      lastSuccessAt: row.last_success_at,
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      kind: row.kind,
      origin: row.origin,
      tool: type.tool,
      // A type's settings belong to the source the server's configuration selects.
      settingKeys: row.origin === 'server' ? [...type.settingKeys] : [],
      status: connectorStatus(times, row.now),
      staleAfterSeconds: times.staleAfterSeconds,
      lastSuccessAt: row.last_success_at,
      ageSeconds: row.last_success_at
        ? Math.max(0, Math.floor((row.now.getTime() - row.last_success_at.getTime()) / 1000))
        : null,
      sourceVersion: row.source_version,
      lastErrorAt: row.last_error_at,
      lastError: row.last_error,
      lastRead: row.last_read && { ...row.last_read, at: new Date(row.last_read.at) },
      definitions: { current: row.current, missing: row.missing },
      domainCoverage: row.coverage,
      flaggedItems: row.flagged_items,
      staleLinks: row.stale_links,
      views: sourceViews(members.filter((member) => member.connectorId === row.id)),
      renames: renames
        .filter((rename) => rename.connector_id === row.id)
        .map(({ from, to }) => ({ from, to })),
      recentReads: reads
        .filter((read) => read.connector_id === row.id)
        .map((read) => ({
          at: read.at,
          status: read.status,
          durationMs: read.duration_ms,
          definitionsSeen: read.definitions_seen,
          warnings: read.warnings,
          sourceVersion: read.source_version,
        })),
    }
  })
}

export async function readSpend(database: Database): Promise<SpendOverview> {
  const [totals] = await database.query<{
    month: string
    today_micros: string
    cap_micros: string | null
  }>(
    `select to_char(now() at time zone 'UTC', 'YYYY-MM') as month,
       (select coalesce(sum(cost_micros), 0) from llm_spend_daily
         where day = (now() at time zone 'UTC')::date) as today_micros,
       (select value #>> '{}' from settings_current
         where key = 'limits.llm_monthly_cap_micros') as cap_micros`,
  )
  // A feature's spend is kept per provider; the overview adds the providers up.
  const features = await database.query<{ feature: string; calls: string; cost_micros: string }>(
    `select feature, sum(calls) as calls, sum(cost_micros) as cost_micros from llm_spend_monthly
     where month = date_trunc('month', now() at time zone 'UTC')::date group by feature order by feature`,
  )
  const byFeature = features.map((row) => ({
    feature: row.feature,
    calls: Number(row.calls),
    costMicros: Number(row.cost_micros),
  }))
  return {
    month: totals!.month,
    monthCostMicros: byFeature.reduce((sum, row) => sum + row.costMicros, 0),
    monthCapMicros: totals!.cap_micros === null ? null : Number(totals!.cap_micros),
    todayCostMicros: Number(totals!.today_micros),
    byFeature,
  }
}

async function databaseNow(database: Database): Promise<Date> {
  const [row] = await database.query<{ now: Date }>('select now() as now')
  return row!.now
}

/**
 * The overview as the API answers it: every time as ISO 8601 in UTC, and how this server reads
 * each source, from the sources it was given (none when it reads none of them).
 */
export function operationsView(
  overview: OperationsOverview,
  sources?: Pick<ConnectorRegistry, 'list'>,
): OperationsOverviewView {
  const iso = (time: Date | null) => time && time.toISOString()
  const reading = new Map(sources?.list().map((source) => [source.id, source]))
  return {
    ...overview,
    checkedAt: overview.checkedAt.toISOString(),
    jobs: overview.jobs.map((job) => ({
      ...job,
      registeredAt: iso(job.registeredAt),
      lastStartedAt: iso(job.lastStartedAt),
      lastSucceededAt: iso(job.lastSucceededAt),
      lastErrorAt: iso(job.lastErrorAt),
    })),
    connectors: overview.connectors.map((connector) => {
      const source = reading.get(connector.id)
      return {
        ...connector,
        server:
          source && source.type === connector.type && connector.origin === 'server'
            ? { settings: source.serverSettings.map((setting) => ({ ...setting })) }
            : null,
        lastSuccessAt: iso(connector.lastSuccessAt),
        lastErrorAt: iso(connector.lastErrorAt),
        lastRead: connector.lastRead && {
          ...connector.lastRead,
          at: connector.lastRead.at.toISOString(),
        },
        recentReads: connector.recentReads.map((read) => ({
          ...read,
          at: read.at.toISOString(),
        })),
      }
    }),
  }
}
