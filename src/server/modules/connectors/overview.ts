import { ORPCError } from '@orpc/client'
import type {
  PauseSourceInput,
  SourceActivity,
  SourceHealth,
  SourceReadEntry,
  SourceRow,
} from '../../../contract/sources.ts'
import { durationSeconds } from '../../../domain/connector-manifest.ts'
import { durationText, scheduleSeconds } from '../../../domain/source-schedule.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason, recordAudit } from '../admin/index.ts'
import type { RegisteredConnector } from './platform.ts'
import { connectorType } from './registry.ts'

/*
  The sources as Settings › Integrations shows them (CON-104, CON-115): every source, the server's
  own and those an admin added, with how it is, when it was read and is read next, and what it
  holds; a source's activity, for its page; and Pause reading. Read in the admin's request, from
  what the reads kept: a source's reads (`connector_snapshots`), the definitions of a definitions
  source and the documents of a content source (`connector_documents`), never a document's text
  and never a secret.
*/

/** What a source's connector says of it: its tool, its kind, how often it is read, its cap. */
type Manifested = {
  tool: string
  kind: 'definitions' | 'content'
  schedule: { default: string; minimum: string }
  draftsPerDay: number | null
}

/** A source of a type this build has no manifest for (the demo) is read every hour. */
const hourly = { default: 'PT1H', minimum: 'PT1H' }

/** The most reads a source's page lists. */
const READS_SHOWN = 20
/** The most documents a source's page lists. */
const DOCUMENTS_SHOWN = 20

/** A read's warnings that say the source's key was refused, or is missing: it needs a new one. */
const KEY_REFUSED = new Set(['unauthorized', 'secret_missing'])

interface SourceRowData {
  id: string
  kind: 'definition_source' | 'context_source'
  type: string
  name: string
  origin: 'workspace' | 'server'
  enabled: boolean
  own_seconds: number | null
  stale_seconds: number
  next_read_at: Date | null
  due: boolean
  failures: number
  created_at: Date
}

interface ReadRow {
  id: string
  connector_id: string
  at: Date
  status: 'ok' | 'partial' | 'failed'
  duration_ms: number | null
  definitions_seen: number
  documents_seen: number
  suggested: number
  replaced: number
  withdrawn: number
  waiting: number
  skipped: number
  marked: number
  added: number
  gone: number
  warnings: { code: string; count: number }[]
  first: boolean
}

/** A read and what it did, by the kind of its source. */
const readColumns = `s.id::text, s.connector_id, s.fetched_at as at, s.status::text as status, s.duration_ms,
  s.definitions_seen, s.documents_seen, s.suggested, s.replaced, s.withdrawn, s.waiting, s.skipped,
  coalesce((select jsonb_agg(jsonb_build_object('code', w.code, 'count', w.n) order by w.code)
     from (select x->>'code' as code, count(*)::int as n from jsonb_array_elements(s.warnings) x
            where x ? 'code' group by 1) w), '[]') as warnings,
  coalesce(s.id = (select f.id from connector_snapshots f where f.connector_id = s.connector_id
           and f.status <> 'failed' order by f.fetched_at, f.id limit 1), false) as first`

/** For a definitions read: the definitions it marked, of them those it found first, and those gone. */
const definitionCounts = `,
  (select count(*) from definition_marks m where m.snapshot_id = s.id)::int as marked,
  (select count(*) from definitions d where d.first_seen_snapshot = s.id)::int as added,
  (select count(*) from definitions d where d.missing_since_snapshot = s.id)::int as gone`

function entryOf(row: ReadRow, kind: Manifested['kind']): SourceReadEntry {
  return {
    id: row.id,
    at: row.at.toISOString(),
    status: row.status,
    first: row.first,
    durationMs: row.duration_ms,
    definitions:
      kind === 'definitions' && row.status !== 'failed'
        ? {
            seen: row.definitions_seen,
            added: row.added,
            changed: Math.max(row.marked - row.added, 0),
            gone: row.gone,
          }
        : null,
    documents:
      kind === 'content' && row.status !== 'failed'
        ? {
            seen: row.documents_seen,
            suggested: row.suggested,
            replaced: row.replaced,
            withdrawn: row.withdrawn,
            waiting: row.waiting,
            skipped: row.skipped,
          }
        : null,
    warnings: row.warnings,
  }
}

/** How a source is: paused, asked to read now, its key refused, its last read failed, or fine. */
function healthOf(
  row: Pick<SourceRowData, 'enabled' | 'due'>,
  last: SourceReadEntry | null,
): SourceHealth {
  if (!row.enabled) return 'paused'
  if (row.due) return 'reading'
  if (last?.status !== 'failed') return 'healthy'
  return last.warnings.some((warning) => KEY_REFUSED.has(warning.code)) ? 'reauth' : 'failed'
}

/** The groups of a definitions source's copy (a Cube view: its members' names up to the last dot). */
interface GroupRow {
  connector_id: string
  name: string
  metrics: number
  dimensions: number
  domain: string | null
}

const groupsQuery = (where: string) =>
  `select d.connector_id, d.grp as name,
     count(*) filter (where d.kind = 'metric')::int as metrics,
     count(*) filter (where d.kind = 'dimension')::int as dimensions,
     (array_agg(a.id order by a.id) filter (where a.id is not null))[1] as domain
   from (select connector_id, kind, area_hint, coalesce(substring(name from '^(.*)\\.[^.]*$'), '') as grp
           from definitions
          where missing_since_snapshot is null and kind in ('metric', 'dimension') and ${where}) d
   left join areas a on a.id = d.area_hint and a.archived_at is null
   group by d.connector_id, d.grp
   order by d.connector_id, d.grp`

export function createSourceOverview({
  connector,
}: {
  /** A source's connector, by its type. */
  connector: (type: string) => RegisteredConnector | undefined
}) {
  const manifested = (row: Pick<SourceRowData, 'type' | 'name' | 'kind'>): Manifested => {
    const manifest = connector(row.type)?.manifest
    if (manifest)
      return {
        tool: manifest.tool,
        kind: manifest.kind,
        schedule: manifest.schedule,
        draftsPerDay: manifest.limits.draftsPerDay ?? null,
      }
    return {
      tool: connectorType(row.type, row.name).tool,
      kind: row.kind === 'context_source' ? 'content' : 'definitions',
      schedule: hourly,
      draftsPerDay: null,
    }
  }

  async function sourceRow(tx: Queryable, id: string): Promise<SourceRowData | null> {
    const [row] = await tx.query<SourceRowData>(
      `select id, kind::text as kind, type, name, origin, enabled,
              extract(epoch from schedule)::int as own_seconds,
              extract(epoch from stale_after)::int as stale_seconds, next_read_at,
              (next_read_at is not null and next_read_at <= now()) as due, failures, created_at
         from connectors where id = $1 and removed_at is null`,
      [id],
    )
    return row ?? null
  }

  return {
    /** Every source, the server's own first, each with how it is and what it holds; none disconnected. */
    async list(tx: Queryable): Promise<SourceRow[]> {
      const rows = await tx.query<SourceRowData>(
        `select id, kind::text as kind, type, name, origin, enabled,
                extract(epoch from schedule)::int as own_seconds,
              extract(epoch from stale_after)::int as stale_seconds, next_read_at,
                (next_read_at is not null and next_read_at <= now()) as due, failures, created_at
           from connectors where removed_at is null order by origin = 'workspace', created_at, id`,
      )
      if (!rows.length) return []
      const ids = rows.map((row) => row.id)
      // One query at a time: they share the request's transaction.
      const lasts = await tx.query<ReadRow>(
        `select ${readColumns}${definitionCounts}
             from unnest($1::text[]) c(id)
             cross join lateral (select * from connector_snapshots x where x.connector_id = c.id
                                  order by x.fetched_at desc, x.id desc limit 1) s`,
        [ids],
      )
      const goods = await tx.query<{ connector_id: string; at: Date }>(
        `select connector_id, max(fetched_at) as at from connector_snapshots
            where connector_id = any($1) and status <> 'failed' group by connector_id`,
        [ids],
      )
      const groups = await tx.query<GroupRow>(groupsQuery('connector_id = any($1)'), [ids])
      // The live items a change to one of the source's definitions flagged (CON-209).
      const flagged = await tx.query<{ connector_id: string; items: number }>(
        `select d.connector_id, count(distinct o.item_id)::int as items
             from v_overlay_on o join v_item_list l on l.id = o.item_id
             join item_version_refs r on r.version_id = l.version_id
             join definitions d on d.ref = r.definition_ref
            where o.kind = 'flag_on' and l.status = 'accepted' and cl_audience_allows(l.audience_groups)
              and d.connector_id = any($1)
            group by d.connector_id`,
        [ids],
      )
      const documents = await tx.query<{
        source_id: string
        held: number
        waiting: number
        waiting_domains: number
        made_today: number
      }>(
        `select c.id as source_id,
             (select count(*) from connector_documents x
               where x.source_id = c.id and x.state <> 'gone')::int as held,
             (select count(*) from proposals p
               where p.source_id = c.id and p.state in ('submitted', 'in_review'))::int as waiting,
             (select count(distinct p.area_id) from proposals p
               where p.source_id = c.id and p.state in ('submitted', 'in_review'))::int as waiting_domains,
             -- As the content pipeline counts its cap (CON-607): over the last 24 hours.
             (select count(*) from proposals p
               where p.source_id = c.id and p.created_at > now() - interval '24 hours')::int as made_today
             from connectors c where c.id = any($1) and c.kind = 'context_source'`,
        [ids],
      )
      const added = await tx.query<{ subject_id: string; name: string | null }>(
        `select distinct on (a.subject_id) a.subject_id, p.display_name as name
             from audit_log a left join people p on p.id = a.actor_id
            where a.action = 'source.added' and a.subject_type = 'source' and a.subject_id = any($1)
            order by a.subject_id, a.seq desc`,
        [ids],
      )
      const lastOf = new Map(lasts.map((read) => [read.connector_id, read]))
      const goodOf = new Map(goods.map((good) => [good.connector_id, good.at]))
      const flaggedOf = new Map(flagged.map((f) => [f.connector_id, f.items]))
      const documentsOf = new Map(documents.map((d) => [d.source_id, d]))
      const addedBy = new Map(added.map((a) => [a.subject_id, a.name]))
      return rows.map((row): SourceRow => {
        const manifest = manifested(row)
        const lastRow = lastOf.get(row.id)
        const last = lastRow ? entryOf(lastRow, manifest.kind) : null
        const period = scheduleSeconds(row.own_seconds, {
          defaultSeconds: durationSeconds(manifest.schedule.default),
          minimumSeconds: durationSeconds(manifest.schedule.minimum),
        })
        const own = groups.filter((group) => group.connector_id === row.id)
        const named = own.filter((group) => group.name !== '')
        const content = documentsOf.get(row.id)
        return {
          id: row.id,
          type: row.type,
          tool: manifest.tool,
          kind: manifest.kind,
          name: row.name,
          origin: row.origin,
          health: healthOf(row, last),
          schedule: durationText(period),
          staleAfter: durationText(row.stale_seconds),
          nextReadAt: row.enabled ? (row.next_read_at?.toISOString() ?? null) : null,
          lastRead: last,
          lastGoodAt: goodOf.get(row.id)?.toISOString() ?? null,
          failures: row.failures,
          definitions:
            manifest.kind === 'definitions'
              ? {
                  metrics: own.reduce((n, group) => n + group.metrics, 0),
                  dimensions: own.reduce((n, group) => n + group.dimensions, 0),
                  groups: named.length,
                  groupsWithoutDomain: named.filter((group) => group.domain === null).length,
                  flagged: flaggedOf.get(row.id) ?? 0,
                }
              : null,
          documents:
            manifest.kind === 'content'
              ? {
                  held: content?.held ?? 0,
                  waiting: content?.waiting ?? 0,
                  waitingDomains: content?.waiting_domains ?? 0,
                  madeToday: content?.made_today ?? 0,
                  perDay: manifest.draftsPerDay ?? 0,
                }
              : null,
          addedAt: row.origin === 'workspace' ? row.created_at.toISOString() : null,
          addedBy: row.origin === 'workspace' ? (addedBy.get(row.id) ?? null) : null,
        }
      })
    },

    /**
     * One source's activity: its reads, newest first; what it reads, each part with its domain;
     * and a content source's documents read most recently. Null for no such source.
     */
    async activity(tx: Queryable, id: string): Promise<SourceActivity | null> {
      const row = await sourceRow(tx, id)
      if (!row) return null
      const { kind } = manifested(row)
      const reads = await tx.query<ReadRow>(
        `select ${readColumns}${kind === 'definitions' ? definitionCounts : ', 0 as marked, 0 as added, 0 as gone'}
           from connector_snapshots s where s.connector_id = $1
          order by s.fetched_at desc, s.id desc limit ${READS_SHOWN}`,
        [id],
      )
      if (kind === 'definitions') {
        const groups = await tx.query<GroupRow>(groupsQuery('connector_id = $1'), [id])
        return {
          reads: reads.map((read) => entryOf(read, kind)),
          groups: groups
            .filter((group) => group.name !== '')
            .map(({ name, metrics, dimensions, domain }) => ({
              name,
              metrics,
              dimensions,
              domain,
            })),
          scopes: [],
          documents: [],
        }
      }
      const scopes = await tx.query<{
        id: string
        title: string
        domain: string
        documents: number
      }>(
        `select s->>'id' as id, s->>'title' as title, s->>'domain' as domain,
                  (select count(*) from connector_documents x
                    where x.source_id = c.id and x.scope = s->>'id' and x.state <> 'gone')::int as documents
             from connectors c cross join lateral jsonb_array_elements(c.scopes) with ordinality as e(s, n)
            where c.id = $1 order by e.n`,
        [id],
      )
      const documents = await tx.query<SourceActivity['documents'][number] & { readAt: Date }>(
        `select x.title, x.link,
                  coalesce((select s->>'title' from jsonb_array_elements(c.scopes) s
                             where s->>'id' = x.scope limit 1), x.scope) as scope,
                  coalesce(p.area_id, (select s->>'domain' from jsonb_array_elements(c.scopes) s
                                        where s->>'id' = x.scope limit 1)) as domain,
                  case when x.state = 'gone' then 'gone'
                       when x.state = 'skipped' then 'skipped'
                       when x.state = 'waiting' then 'held'
                       else case p.state when 'accepted' then 'published'
                                         when 'changes_requested' then 'returned'
                                         when 'rejected' then 'declined'
                                         when 'withdrawn' then 'withdrawn'
                                         else 'suggested' end end as state,
                  x.skip_reason as "skipReason", x.last_seen_at as "readAt",
                  case when x.state = 'drafted' then p.id::text end as "proposalId",
                  case when x.state = 'drafted' and p.state in ('accepted', 'changes_requested', 'rejected')
                       then (select pe.display_name from decisions d join people pe on pe.id = d.decided_by
                              where d.proposal_id = p.id order by d.decided_at desc limit 1) end as "decidedBy"
             from connector_documents x join connectors c on c.id = x.source_id
             left join proposals p on p.id = x.proposal_id
            where x.source_id = $1
            order by x.last_seen_at desc, x.title limit ${DOCUMENTS_SHOWN}`,
        [id],
      )
      return {
        reads: reads.map((read) => entryOf(read, kind)),
        groups: [],
        scopes,
        documents: documents.map((document) => ({
          ...document,
          readAt: document.readAt.toISOString(),
        })),
      }
    },

    /**
     * Pauses reading a source, or lets it go on: the job leaves a paused source out, and Read
     * again refuses it. Kept in the history log, with why, when it changes anything. A source
     * resumed past its next read is read at the job's next turn.
     */
    async pause(tx: Queryable, input: PauseSourceInput): Promise<{ id: string; paused: boolean }> {
      plainReason(input.reason)
      const [row] = await tx.query<{ enabled: boolean }>(
        'select enabled from connectors where id = $1 and removed_at is null for update',
        [input.id],
      )
      if (!row) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this source." })
      if (row.enabled === input.paused) {
        await tx.query('update connectors set enabled = $2 where id = $1', [
          input.id,
          !input.paused,
        ])
        await recordAudit(tx, {
          action: input.paused ? 'source.paused' : 'source.resumed',
          subjectType: 'source',
          subjectId: input.id,
          details: { reason: input.reason },
        })
      }
      return { id: input.id, paused: input.paused }
    },
  }
}

export type SourceOverview = ReturnType<typeof createSourceOverview>
