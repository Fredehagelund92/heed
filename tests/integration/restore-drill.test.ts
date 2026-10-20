import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'
import { bulkSeed } from '../../db/seed/bulk.ts'
import { identifier } from '../../src/server/db/roles.ts'
import { restoreDrill, type DrillReport } from '../../src/server/db/restore-drill.ts'
import { generateItems } from '../../src/web/mocks/items.ts'
import { testDatabase, transaction } from './support.ts'

/**
 * The restore drill (NFR-044, NFR-045): pg_dump, pg_restore into a scratch database, and the
 * proof that rows, edition digests, content digests and the history log's chain recompute
 * identically. Needs pg_dump and pg_restore of PostgreSQL 18 on PATH, as CI installs them.
 */
const { client, url } = testDatabase()
const run = promisify(execFile)

async function seeded() {
  await client.query('reset role')
  await bulkSeed(client, generateItems(200))
  // History log rows chain through the trigger, as role grants and decisions write them.
  await transaction(client, async () => {
    for (const action of ['role.granted', 'setting.changed', 'edition.rollback'])
      await client.query(
        `insert into audit_log (actor_kind, action, subject_type, subject_id, details)
         values ('system', $1, 'test', $2, $3)`,
        [action, action, JSON.stringify({ reason: `drill ${action}`, at: '2026-10-08' })],
      )
  })
}

async function exists(name: string) {
  const rows = await client.query('select 1 from pg_database where datname = $1', [name])
  return rows.rowCount === 1
}

it(
  'backs up, restores and recomputes everything identically, through the npm script',
  { timeout: 120_000 },
  async () => {
    await seeded()
    const { stdout } = await run(
      process.execPath,
      ['src/server/run-restore-drill.ts', '--source', url, '--json'],
      { maxBuffer: 64 * 1024 * 1024 },
    )
    const report = JSON.parse(stdout) as DrillReport
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
    const editions = await client.query<{ n: number }>(
      'select count(*)::int as n from editions where sealed_at is not null',
    )
    expect(report.editions).toHaveLength(editions.rows[0]!.n)
    expect(report.editions.length).toBeGreaterThan(10)
    for (const edition of report.editions) {
      expect(edition.database).toBe(edition.stored)
      expect(edition.recomputed).toBe(edition.stored)
    }
    expect(report.versions.items).toBeGreaterThan(200)
    expect(report.versions.terms).toBeGreaterThan(10)
    expect(report.audit).toMatchObject({ rows: 3, firstBadSeq: null, recomputedBad: [] })
    expect(report.audit.restoredHead).toBe(report.audit.sourceHead)
    const tables = new Map(report.tables.map((t) => [t.table, t]))
    for (const table of [
      'public.item_versions',
      'public.editions',
      'public.audit_log',
      'pgboss.version',
    ])
      expect(tables.get(table)?.same, table).toBe(true)
    expect(tables.get('public.item_versions')!.restoredRows).toBe(report.versions.items)
    expect(await exists(report.scratch)).toBe(false)
  },
)

it(
  'reports every kind of difference in a copy that does not match',
  { timeout: 120_000 },
  async () => {
    const report = await restoreDrill({
      sourceUrl: url,
      async afterRestore(copy) {
        // What a bad restore or a tampered backup looks like: an extra row, a changed version,
        // a forged edition digest, an edited history entry.
        await copy.query(`begin;
        alter table item_versions disable trigger user;
        alter table editions disable trigger user;
        alter table audit_log disable trigger user;
        update item_versions set summary = summary || ' (changed)'
          where id = (select version_id from item_version_service order by item_id limit 1);
        update editions set digest = sha256('forged') where seq = (select max(seq) from editions);
        update audit_log set details = '{"reason":"rewritten"}' where seq = (select min(seq) from audit_log);
        insert into areas (id, name) values ('ghost', 'Ghost');
        commit`)
      },
    })
    expect(report.ok).toBe(false)
    const problems = report.problems.join('\n')
    expect(problems).toMatch(/^table public\.item_versions: /m)
    expect(problems).toMatch(/^table public\.editions: /m)
    expect(problems).toMatch(/^table public\.audit_log: /m)
    expect(problems).toMatch(/^table public\.areas: \d+ rows before, \d+ after/m)
    expect(problems).toMatch(/^item version itm_\w+ v\d+ does not give its stored digest$/m)
    expect(problems).toMatch(/^edition \d{4}-\d{2}-\d{2}\.\d+: stored [0-9a-f]{64}, database /m)
    expect(problems).toMatch(/^audit_verify\(\) reports row \d+$/m)
    expect(problems).toMatch(/^history log row \d+ breaks the hash chain$/m)
    expect(report.editions.filter((e) => !e.same)).toHaveLength(1)
    expect(await exists(report.scratch)).toBe(false)
  },
)

it(
  'keeps the copy on request, and fails before creating anything without pg_dump',
  { timeout: 120_000 },
  async () => {
    const kept = await restoreDrill({ sourceUrl: url, keep: true })
    try {
      expect(kept.ok).toBe(true)
      expect(await exists(kept.scratch)).toBe(true)
    } finally {
      expect(kept.scratch).toMatch(/^context_layer_test_\d+_[a-f0-9]+_[a-f0-9]+_drill_[a-f0-9]{8}$/)
      await client.query(`drop database if exists ${identifier(kept.scratch)} with (force)`)
    }
    // Only this source's scratch databases: other tests share the cluster and create their own.
    const scratches = async () =>
      (
        await client.query<{ name: string }>(
          `select datname as name from pg_database where starts_with(datname, $1) order by 1`,
          [`${new URL(url).pathname.slice(1, 49)}_drill_`],
        )
      ).rows
    const before = await scratches()
    await expect(restoreDrill({ sourceUrl: url, binDir: '/nonexistent' })).rejects.toThrow(
      /^pg_dump failed/,
    )
    expect(await scratches()).toEqual(before)
  },
)
