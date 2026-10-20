import { ORPCError } from '@orpc/client'
import type * as z from 'zod/mini'
import type {
  AuditEntry,
  auditExportInputSchema,
  auditSearchSchema,
} from '../../../contract/admin.ts'
import { canonicalJson } from '../../../domain/canonical.ts'
import { textFindings } from '../../../domain/draft.ts'
import type { Queryable } from '../../db/database.ts'

/** A reason is stored in the history log for good, so it must not hold sensitive text. */
export function plainReason(reason: string) {
  const findings = textFindings(reason, 'reason')
  if (findings.length)
    throw new ORPCError('UNPROCESSABLE_CONTENT', {
      message: 'Remove the email address, phone number or secret from the reason.',
      data: { findings },
    })
}

/** An administrator action, named for the signed-in person (FR-807). */
export async function recordAudit(
  tx: Queryable,
  entry: {
    action: string
    subjectType: string
    subjectId: string
    areaId?: string | null
    details: Record<string, unknown>
  },
) {
  await tx.query(
    `insert into audit_log(actor_id,actor_kind,action,area_id,subject_type,subject_id,details)
     values(cl_person(),'person',$1,$2,$3,$4,$5)`,
    [
      entry.action,
      entry.areaId ?? null,
      entry.subjectType,
      entry.subjectId,
      JSON.stringify(entry.details),
    ],
  )
}

type Filters = Omit<z.infer<typeof auditSearchSchema>, 'before' | 'limit'>

/** Row security shows the log to administrators and auditors only (0012); filters are exact. */
function where(filters: Filters, values: unknown[]) {
  const clauses: string[] = []
  const add = (sql: string, value: unknown) => {
    values.push(value)
    clauses.push(sql.replace('?', `$${values.length}`))
  }
  if (filters.action)
    if (filters.action.includes('.')) add('a.action=?', filters.action)
    // A bare prefix such as `proposal` matches every proposal action.
    else add("split_part(a.action,'.',1)=?", filters.action)
  if (filters.actorId) add('a.actor_id=?::uuid', filters.actorId)
  if (filters.areaId) add('a.area_id=?', filters.areaId)
  if (filters.subjectType) add('a.subject_type=?', filters.subjectType)
  if (filters.subjectId) add('a.subject_id=?', filters.subjectId)
  if (filters.requestId) add('a.request_id=?', filters.requestId)
  if (filters.batchId) add('a.batch_id=?::uuid', filters.batchId)
  if (filters.from) add("a.at >= (?::date)::timestamp at time zone 'UTC'", filters.from)
  if (filters.to) add("a.at < (?::date + 1)::timestamp at time zone 'UTC'", filters.to)
  return clauses
}

const columns = `a.seq::float8 as seq,to_char(a.at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at,a.actor_id::text as "actorId",
  p.display_name as "actorName",a.actor_kind as "actorKind",a.action,a.area_id as "areaId",
  a.subject_type as "subjectType",a.subject_id as "subjectId",a.request_id as "requestId",a.details,encode(a.hash,'hex') as hash,
  a.batch_id::text as "batchId",a.reason,a.source`
const from = 'from audit_log a left join people p on p.id=a.actor_id'

/*
  What the log's screen shows of an entry's subject: a proposal's number and title, an item's
  title. Read in the reader's transaction, so row security decides: a proposal the reader may
  not see (an auditor and another person's draft) gives neither, and an item gives its title only
  while its current version is served to everyone, as in the library.
*/
const proposalOf = `(case when a.subject_type='proposal' then a.subject_id end)::uuid`
const subjectColumns = `(select pr.number::float8 from proposals pr
    where a.subject_type='proposal' and pr.id=${proposalOf} and pr.discarded_at is null) as "subjectNumber",
  coalesce((select coalesce(v.title,tv.name,pr.draft->>'title') from proposals pr
      left join item_versions v on v.id=pr.item_version_id
      left join vocab_term_versions tv on tv.id=pr.vocab_version_id
      where a.subject_type='proposal' and pr.id=${proposalOf} and pr.discarded_at is null),
    (select l.title from v_item_list l where a.subject_type='item' and l.id=a.subject_id
      and cl_audience_allows(l.audience_groups)
      and exists (select 1 from item_versions v where v.id=l.version_id)),
    -- An item in the Bin is in no read model: its title is the one it had when it moved, for
    -- the administrators who read the Bin.
    (select v.title from item_bin b join item_versions v on v.id=b.version_id
      where a.subject_type='item' and b.item_id=a.subject_id and cl_audience_allows(v.audience_groups)
      order by b.binned_at desc limit 1)) as "subjectTitle"`

/** Newest first, a page at a time; `next` continues where the page ended. */
export async function searchAudit(tx: Queryable, input: z.infer<typeof auditSearchSchema>) {
  const { before, limit = 50, ...filters } = input
  const values: unknown[] = []
  const clauses = where(filters, values)
  if (before !== undefined) {
    values.push(before)
    clauses.push(`a.seq < $${values.length}`)
  }
  values.push(limit + 1)
  const rows = await tx.query<AuditEntry>(
    `select ${columns},${subjectColumns} ${from} ${clauses.length ? 'where ' + clauses.join(' and ') : ''}
     order by a.seq desc limit $${values.length}`,
    values,
  )
  const entries = rows.slice(0, limit)
  return { entries, next: rows.length > limit ? entries.at(-1)!.seq : null }
}

/** FR-806: the first entry whose hash does not follow, or none. */
export async function verifyAudit(tx: Queryable) {
  const [row] = await tx.query<{ seq: number | null }>(
    'select (select first_bad_seq from audit_verify())::float8 as seq',
  )
  const firstBadSeq = row?.seq ?? null
  return { verified: firstBadSeq === null, firstBadSeq }
}

const csvColumns = [
  'seq',
  'at',
  'actorId',
  'actorName',
  'actorKind',
  'action',
  'areaId',
  'subjectType',
  'subjectId',
  'requestId',
  'details',
  'hash',
  'batchId',
  'reason',
  'source',
] as const
function csvCell(value: AuditEntry[(typeof csvColumns)[number]]): string {
  const text =
    value === null || value === undefined
      ? ''
      : typeof value === 'object'
        ? canonicalJson(value)
        : String(value)
  // Quote every cell; a leading formula character is neutralised for spreadsheet programs.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replaceAll('"', '""')}"`
}

/**
 * Oldest first, so exports in a row join up; `next` continues after the last entry. The export
 * reports the chain check of the whole log, which it does not change: a read names nobody (FR-807).
 */
export async function exportAudit(tx: Queryable, input: z.infer<typeof auditExportInputSchema>) {
  const { after, limit = 10_000, format, ...filters } = input
  const values: unknown[] = []
  const clauses = where(filters, values)
  if (after !== undefined) {
    values.push(after)
    clauses.push(`a.seq > $${values.length}`)
  }
  values.push(limit + 1)
  const rows = await tx.query<AuditEntry>(
    `select ${columns} ${from} ${clauses.length ? 'where ' + clauses.join(' and ') : ''}
     order by a.seq limit $${values.length}`,
    values,
  )
  const entries = rows.slice(0, limit)
  const content =
    format === 'csv'
      ? [
          csvColumns.join(','),
          ...entries.map((e) => csvColumns.map((c) => csvCell(e[c])).join(',')),
        ]
          .map((line) => line + '\r\n')
          .join('')
      : entries.map((e) => canonicalJson(e) + '\n').join('')
  return {
    format,
    content,
    count: entries.length,
    next: rows.length > limit ? entries.at(-1)!.seq : null,
    chain: await verifyAudit(tx),
  }
}
