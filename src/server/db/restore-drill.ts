import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import pg from 'pg'
import { contentDigest, editionDigest } from '../../domain/canonical.ts'
import { itemVersionDigests } from '../../domain/item-version.ts'
import { termDigestContent, type Term } from '../../domain/vocabulary.ts'
import { readVersions } from '../modules/proposals/index.ts'
import type { Queryable } from './database.ts'
import { identifier } from './roles.ts'

/**
 * The restore drill (NFR-044, NFR-045): back up a Heed database with pg_dump, restore it into a
 * new scratch database with pg_restore, and prove the copy is the same database:
 *
 * 1. every table holds the same rows (count and fingerprint) and every sequence the same value,
 *    read from the snapshot the dump was taken from;
 * 2. every sealed edition's digest recomputes to the stored one, both with the database's own
 *    `edition_content_digest` and, independently, in TypeScript from the restored service rows;
 * 3. every item and vocabulary version served by any edition recomputes to its stored content
 *    digest from its restored content, through the same canonical JSON the write path uses;
 * 4. the history log's hash chain verifies, both with `audit_verify()` and with the drill's own
 *    copy of the chain rule, and ends on the same hash as the source.
 *
 * The scratch database is dropped afterwards unless `keep` is set. Nothing is written to the
 * source: it is read in one read-only snapshot.
 */

const run = promisify(execFile)

export interface DrillOptions {
  /** The database to back up, as its owner or a superuser. */
  sourceUrl: string
  /** Keep the restored copy for inspection instead of dropping it. */
  keep?: boolean
  /** Directories of `pg_dump` and `pg_restore`; by default they come from PATH. */
  binDir?: string
  /**
   * Runs between the restore and the checks, against the restored copy. Tests use it to tamper
   * with the copy and prove the drill notices.
   */
  afterRestore?: (restored: pg.Client) => Promise<void>
}

export interface TableCheck {
  table: string
  sourceRows: number
  restoredRows: number
  same: boolean
}

export interface EditionCheck {
  label: string
  stored: string
  /** `edition_content_digest` in the restored database. */
  database: string
  /** Recomputed in TypeScript from the restored service rows. */
  recomputed: string
  same: boolean
}

export interface DrillReport {
  source: string
  scratch: string
  kept: boolean
  dumpBytes: number
  timings: { dumpMs: number; restoreMs: number; checkMs: number; totalMs: number }
  tables: TableCheck[]
  sequences: { name: string; same: boolean }[]
  editions: EditionCheck[]
  versions: { items: number; terms: number; itemMismatches: string[]; termMismatches: string[] }
  audit: {
    rows: number
    firstBadSeq: string | null
    recomputedBad: string[]
    sourceHead: string | null
    restoredHead: string | null
  }
  problems: string[]
  ok: boolean
}

interface Snapshot {
  tables: Map<string, { rows: number; fingerprint: string }>
  sequences: Map<string, string>
  auditHead: string | null
}

/** Base tables and partitioned parents outside the system schemas; partitions count in their parent. */
const tablesQuery = `select format('%I.%I', n.nspname, c.relname) as name from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p') and not c.relispartition
    and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
  order by 1`

const sequencesQuery = `select format('%I.%I', schemaname, sequencename) as name,
  coalesce(last_value::text, 'unset') as value from pg_sequences
  where schemaname not in ('pg_catalog', 'information_schema') order by 1`

const auditHeadQuery = `select encode(hash, 'hex') as hash from audit_log order by seq desc limit 1`

async function snapshot(client: pg.Client): Promise<Snapshot> {
  const tables = new Map<string, { rows: number; fingerprint: string }>()
  for (const { name } of (await client.query<{ name: string }>(tablesQuery)).rows) {
    // The fingerprint orders rows by their text in the C collation, so it does not depend on
    // physical order, which a restore changes.
    const [row] = (
      await client.query<{ rows: number; fingerprint: string }>(
        `select count(*)::int as rows,
           md5(coalesce(string_agg(t::text, E'\\n' order by t::text collate "C"), '')) as fingerprint
         from ${name} t`,
      )
    ).rows
    tables.set(name, row!)
  }
  const sequences = new Map(
    (await client.query<{ name: string; value: string }>(sequencesQuery)).rows.map((row) => [
      row.name,
      row.value,
    ]),
  )
  const [head] = (await client.query<{ hash: string }>(auditHeadQuery)).rows
  return { tables, sequences, auditHead: head?.hash ?? null }
}

function databaseUrl(url: string, database: string): string {
  const next = new URL(url)
  next.pathname = '/' + encodeURIComponent(database)
  return next.href
}

/** libpq takes the URL as is, including an `options=-c role=...` parameter. */
export async function pgTool(
  name: 'pg_dump' | 'pg_restore',
  binDir: string | undefined,
  args: string[],
) {
  const file = binDir ? join(binDir, name) : name
  try {
    await run(file, args, { maxBuffer: 16 * 1024 * 1024 })
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim()
    throw new Error(`${name} failed${stderr ? `: ${stderr}` : ''}`, { cause: error })
  }
}

const queryable = (client: pg.Client): Queryable => ({
  async query<Row extends pg.QueryResultRow>(text: string, values?: unknown[]) {
    return (await client.query<Row>(text, values)).rows
  },
})

async function checkEditions(client: pg.Client): Promise<EditionCheck[]> {
  const editions = (
    await client.query<{ seq: string; label: string; stored: string; database: string }>(
      `select seq::text, label, encode(digest, 'hex') as stored,
         encode(edition_content_digest(seq), 'hex') as database
       from editions where sealed_at is not null order by seq`,
    )
  ).rows
  const lines = await client.query<{ seq: string; kind: string; key: string; value: string }>(
    `select e.seq::text, 'item' as kind, s.item_id as key, encode(v.content_digest, 'hex') as value
       from editions e join item_version_service s on s.editions @> e.seq
       join item_versions v on v.id = s.version_id where e.sealed_at is not null
     union all
     select e.seq::text, 'vocab', s.term_key, encode(v.content_digest, 'hex')
       from editions e join vocab_term_service s on s.editions @> e.seq
       join vocab_term_versions v on v.id = s.version_id where e.sealed_at is not null
     union all
     select e.seq::text, 'area', s.area_id, s.state::text
       from editions e join area_state_service s on s.editions @> e.seq where e.sealed_at is not null
     union all
     select e.seq::text, 'domain', s.term_key, s.area_id
       from editions e join source_domain_service s on s.editions @> e.seq where e.sealed_at is not null`,
  )
  const content = new Map<
    string,
    {
      items: { id: string; digest: string }[]
      vocabulary: { key: string; digest: string }[]
      areas: { id: string; state: 'not_started' | 'starting' | 'live' | 'paused' }[]
      domains: { key: string; areaId: string }[]
    }
  >()
  for (const line of lines.rows) {
    const entry = content.get(line.seq) ?? { items: [], vocabulary: [], areas: [], domains: [] }
    if (line.kind === 'item') entry.items.push({ id: line.key, digest: line.value })
    else if (line.kind === 'vocab') entry.vocabulary.push({ key: line.key, digest: line.value })
    else if (line.kind === 'domain') entry.domains.push({ key: line.key, areaId: line.value })
    else entry.areas.push({ id: line.key, state: line.value as 'live' })
    content.set(line.seq, entry)
  }
  const checks: EditionCheck[] = []
  for (const edition of editions) {
    const recomputed = await editionDigest(
      content.get(edition.seq) ?? { items: [], vocabulary: [], areas: [], domains: [] },
    ).catch(() => 'invalid')
    checks.push({
      label: edition.label,
      stored: edition.stored,
      database: edition.database,
      recomputed,
      same: edition.stored === edition.database && edition.stored === recomputed,
    })
  }
  return checks
}

async function checkVersions(client: pg.Client): Promise<DrillReport['versions']> {
  const ids = (
    await client.query<{ id: string }>(
      `select distinct s.version_id::text as id from item_version_service s
       where exists (select 1 from editions e where e.sealed_at is not null and s.editions @> e.seq)`,
    )
  ).rows.map((row) => row.id)
  const itemMismatches: string[] = []
  // The same reader and digest rule the write path uses, in batches to bound memory.
  for (let start = 0; start < ids.length; start += 500) {
    for (const stored of await readVersions(queryable(client), ids.slice(start, start + 500))) {
      const computed = await itemVersionDigests(stored.version).then(
        (digests) => digests.content,
        () => null,
      )
      if (computed !== stored.digest) itemMismatches.push(`${stored.itemId} v${stored.versionNo}`)
    }
  }
  const terms = (
    await client.query<{
      key: string
      kind: Term['kind']
      parentKey: string | null
      name: string
      aliases: string[]
      areaId: string | null
      definitionRefs: string[]
      digest: string
      versionNo: number
    }>(
      `select distinct on (v.id) s.term_key as key, t.kind::text as kind, t.parent_key as "parentKey",
         v.name, v.aliases, v.area_id as "areaId",
         coalesce((select array_agg(r.definition_ref order by r.definition_ref collate "C")
                     from vocab_term_refs r where r.version_id = v.id), '{}') as "definitionRefs",
         encode(v.content_digest, 'hex') as digest, v.version_no as "versionNo"
       from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
       join vocab_terms t on t.key = s.term_key
       where exists (select 1 from editions e where e.sealed_at is not null and s.editions @> e.seq)`,
    )
  ).rows
  const termMismatches: string[] = []
  for (const { digest, versionNo, ...term } of terms)
    if ((await contentDigest(termDigestContent(term))) !== digest)
      termMismatches.push(`${term.key} v${versionNo}`)
  return { items: ids.length, terms: terms.length, itemMismatches, termMismatches }
}

async function checkAudit(client: pg.Client) {
  const [rows] = (await client.query<{ n: number }>('select count(*)::int as n from audit_log'))
    .rows
  const [bad] = (
    await client.query<{ seq: string }>('select first_bad_seq::text as seq from audit_verify()')
  ).rows
  // The chain rule of the audit_log trigger, with its batch, reason and source columns,
  // written out here so that a restored copy cannot vouch for itself through a changed function.
  // Timestamps hash as UTC text, as the trigger wrote them.
  await client.query('begin')
  try {
    await client.query("set local timezone = 'UTC'")
    const recomputed = (
      await client.query<{ seq: string }>(
        `select a.seq::text from (select *, lag(hash) over (order by seq) as expect_prev from audit_log) a
         where a.prev_hash is distinct from a.expect_prev
            or a.hash <> sha256(coalesce(a.prev_hash, '\\x'::bytea) || convert_to(concat_ws('|', a.at, a.actor_id,
                 a.actor_kind, a.action, a.area_id, a.subject_type, a.subject_id, a.request_id, a.details::text,
                 case when coalesce(a.batch_id::text, a.reason, a.source) is not null
                      then jsonb_build_object('batch', a.batch_id, 'reason', a.reason, 'source', a.source)::text end), 'UTF8'))
         order by a.seq`,
      )
    ).rows.map((row) => row.seq)
    return { rows: rows!.n, firstBadSeq: bad?.seq ?? null, recomputedBad: recomputed }
  } finally {
    await client.query('commit')
  }
}

export async function restoreDrill(options: DrillOptions): Promise<DrillReport> {
  const started = performance.now()
  const sourceName = decodeURIComponent(new URL(options.sourceUrl).pathname.slice(1))
  const scratch = `${sourceName.slice(0, 48)}_drill_${randomBytes(4).toString('hex')}`
  const scratchUrl = databaseUrl(options.sourceUrl, scratch)
  const maintenance = new pg.Client({
    connectionString: databaseUrl(options.sourceUrl, 'postgres'),
  })
  const source = new pg.Client({ connectionString: options.sourceUrl })
  const directory = await mkdtemp(join(tmpdir(), 'heed-drill-'))
  const dumpFile = join(directory, 'heed.dump')
  let created = false
  let restored: pg.Client | undefined
  try {
    await source.connect()
    await maintenance.connect()

    // One read-only snapshot: the dump and the reference numbers see exactly the same data.
    await source.query('begin isolation level repeatable read read only')
    const [{ id }] = (await source.query<{ id: string }>('select pg_export_snapshot() as id'))
      .rows as [{ id: string }]
    const reference = await snapshot(source)
    const [{ owner }] = (
      await source.query<{ owner: string }>(
        'select pg_get_userbyid(datdba) as owner from pg_database where datname = current_database()',
      )
    ).rows as [{ owner: string }]
    const dumpStarted = performance.now()
    await pgTool('pg_dump', options.binDir, [
      '--format=custom',
      `--snapshot=${id}`,
      `--file=${dumpFile}`,
      `--dbname=${options.sourceUrl}`,
    ])
    const dumpMs = performance.now() - dumpStarted
    await source.query('commit')
    const dumpBytes = (await stat(dumpFile)).size

    const restoreStarted = performance.now()
    await maintenance.query(
      `create database ${identifier(scratch)} owner ${identifier(owner)} template template0`,
    )
    created = true
    await pgTool('pg_restore', options.binDir, [
      '--exit-on-error',
      '--single-transaction',
      `--dbname=${scratchUrl}`,
      dumpFile,
    ])
    const restoreMs = performance.now() - restoreStarted

    restored = new pg.Client({ connectionString: scratchUrl })
    await restored.connect()
    await options.afterRestore?.(restored)
    const checkStarted = performance.now()
    const copy = await snapshot(restored)
    const tables: TableCheck[] = [...new Set([...reference.tables.keys(), ...copy.tables.keys()])]
      .sort()
      .map((table) => {
        const before = reference.tables.get(table)
        const after = copy.tables.get(table)
        return {
          table,
          sourceRows: before?.rows ?? -1,
          restoredRows: after?.rows ?? -1,
          same:
            before !== undefined && after !== undefined && before.fingerprint === after.fingerprint,
        }
      })
    const sequences = [...new Set([...reference.sequences.keys(), ...copy.sequences.keys()])]
      .sort()
      .map((name) => ({
        name,
        same: reference.sequences.get(name) === copy.sequences.get(name),
      }))
    const editions = await checkEditions(restored)
    const versions = await checkVersions(restored)
    const chain = await checkAudit(restored)
    const audit = { ...chain, sourceHead: reference.auditHead, restoredHead: copy.auditHead }
    const checkMs = performance.now() - checkStarted

    const problems = [
      ...tables
        .filter((t) => !t.same)
        .map(
          (t) =>
            `table ${t.table}: ${t.sourceRows} rows before, ${t.restoredRows} after, or different content`,
        ),
      ...sequences.filter((s) => !s.same).map((s) => `sequence ${s.name} differs`),
      ...editions
        .filter((e) => !e.same)
        .map(
          (e) =>
            `edition ${e.label}: stored ${e.stored}, database ${e.database}, recomputed ${e.recomputed}`,
        ),
      ...versions.itemMismatches.map((v) => `item version ${v} does not give its stored digest`),
      ...versions.termMismatches.map(
        (v) => `vocabulary version ${v} does not give its stored digest`,
      ),
      ...(audit.firstBadSeq === null ? [] : [`audit_verify() reports row ${audit.firstBadSeq}`]),
      ...audit.recomputedBad.map((seq) => `history log row ${seq} breaks the hash chain`),
      ...(audit.sourceHead === audit.restoredHead
        ? []
        : ['the history log ends on a different hash than the source']),
    ]
    return {
      source: sourceName,
      scratch,
      kept: options.keep === true,
      dumpBytes,
      timings: {
        dumpMs: Math.round(dumpMs),
        restoreMs: Math.round(restoreMs),
        checkMs: Math.round(checkMs),
        totalMs: Math.round(performance.now() - started),
      },
      tables,
      sequences,
      editions,
      versions,
      audit,
      problems,
      ok: problems.length === 0,
    }
  } finally {
    await restored?.end()
    await source.end().catch(() => undefined)
    if (created && !options.keep) {
      // Only the copy this run created, by its exact name.
      await maintenance.query(`drop database if exists ${identifier(scratch)} with (force)`)
    }
    await maintenance.end().catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
}

/** A short plain-text summary of a drill for the terminal. */
export function describeDrill(report: DrillReport): string {
  const rows = report.tables.reduce((sum, t) => sum + t.sourceRows, 0)
  const lines = [
    `Restore drill of ${report.source} into ${report.scratch}${report.kept ? ' (kept)' : ' (dropped)'}`,
    `  dump ${(report.dumpBytes / 1024).toFixed(0)} KiB in ${report.timings.dumpMs} ms, restore ${report.timings.restoreMs} ms, checks ${report.timings.checkMs} ms, total ${report.timings.totalMs} ms`,
    `  tables: ${report.tables.filter((t) => t.same).length} of ${report.tables.length} identical (${rows} rows); sequences: ${report.sequences.filter((s) => s.same).length} of ${report.sequences.length}`,
    `  editions: ${report.editions.filter((e) => e.same).length} of ${report.editions.length} digests recompute to the stored digest`,
    `  versions: ${report.versions.items - report.versions.itemMismatches.length} of ${report.versions.items} items and ${report.versions.terms - report.versions.termMismatches.length} of ${report.versions.terms} terms recompute to their content digest`,
    `  history log: ${report.audit.rows} rows, chain ${report.audit.firstBadSeq === null && !report.audit.recomputedBad.length ? 'verifies' : 'BROKEN'}, head ${report.audit.sourceHead === report.audit.restoredHead ? 'matches the source' : 'DIFFERS from the source'}`,
  ]
  if (report.problems.length) {
    lines.push(`FAILED: ${report.problems.length} problems`)
    for (const problem of report.problems.slice(0, 50)) lines.push(`  - ${problem}`)
    if (report.problems.length > 50) lines.push(`  ... and ${report.problems.length - 50} more`)
  } else lines.push('PASSED')
  return lines.join('\n')
}
