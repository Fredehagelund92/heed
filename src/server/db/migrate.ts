import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import type pg from 'pg'

export const migrationDirectory = new URL('../../../db/migrations/', import.meta.url)

/**
 * Why a sorted list of migration files cannot run, if it cannot: every name is NNNN_snake_case.sql,
 * the numbers run from 0001 without a gap, and no two files share one.
 */
export function migrationFilesProblem(files: readonly string[]): string | undefined {
  const invalid = files.find((name) => !/^\d{4}_[a-z0-9_]+\.sql$/.test(name))
  if (invalid) return `Migration file ${invalid} must be named NNNN_snake_case.sql`
  for (const [index, name] of files.entries()) {
    const previous = files[index - 1]
    const expected = previous ? Number(previous.slice(0, 4)) + 1 : 1
    const number = Number(name.slice(0, 4))
    if (previous && number === expected - 1)
      return `Migration files ${previous} and ${name} share a number; renumber the newer one after the last migration`
    if (number !== expected)
      return `Migration file ${name} must be numbered ${String(expected).padStart(4, '0')}: numbers run from 0001 without a gap`
  }
  return undefined
}

/** The file that names the last migration (db/README.md, "Adding a migration"). */
export const latestMigrationFile = new URL('latest.txt', migrationDirectory)

/**
 * The new names for a branch's own migrations after it is rebased onto `base`: the files `base`
 * has keep their names, and the branch's files (the ones `base` lacks) follow its last one, in
 * their current order. An error when the branch lacks a file `base` has, since it is not rebased
 * yet.
 */
export function renumberedMigrations(
  base: readonly string[],
  local: readonly string[],
): { renames: [from: string, to: string][]; files: string[] } {
  const missing = base.find((name) => !local.includes(name))
  if (missing) throw new Error(`${missing} is on the base branch but not here: rebase first`)
  const own = local.filter((name) => !base.includes(name)).sort()
  const last = base.reduce((highest, name) => Math.max(highest, Number(name.slice(0, 4))), 0)
  const renames = own
    .map((name, index): [string, string] => [
      name,
      `${String(last + 1 + index).padStart(4, '0')}${name.slice(4)}`,
    ])
    .filter(([from, to]) => from !== to)
  const renamed = new Map(renames)
  const files = [...base, ...own.map((name) => renamed.get(name) ?? name)].sort()
  return { renames, files }
}

export async function migrate(client: pg.Client, directory: URL = migrationDirectory) {
  await client.query("select pg_advisory_lock(hashtextextended('heed.migrations', 0))")
  try {
    await client.query(`create table if not exists schema_migrations (
      name text primary key, checksum text not null, applied_at timestamptz not null default now())`)
    const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()
    const problem = migrationFilesProblem(files)
    if (problem) throw new Error(problem)
    const applied = await client.query<{ name: string; checksum: string }>(
      'select name, checksum from schema_migrations order by name',
    )
    const migrations = await Promise.all(
      files.map(async (name) => {
        const sql = await readFile(new URL(name, directory), 'utf8')
        return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') }
      }),
    )
    // A database whose history starts elsewhere was made by other migrations, such as those
    // 0001_baseline.sql replaced, and no file here can bring it up to date.
    const first = applied.rows[0]
    if (first && first.name !== migrations[0]?.name) {
      throw new Error(
        `Migration history starts at ${first.name}, not ${migrations[0]?.name ?? 'any file here'}: the database was made by other migrations and cannot be upgraded; make a new one (db/README.md)`,
      )
    }
    // The applied files must be the first files, in order and unchanged.
    for (const [index, row] of applied.rows.entries()) {
      const file = migrations[index]
      // A migration renumbered after another took its number on main, applied from its branch
      // under the old number: its order differs from main's, so no file here can repair it.
      const renumbered = migrations.find(
        (other) => other.name !== row.name && other.name.slice(4) === row.name.slice(4),
      )
      if (file?.name !== row.name && renumbered) {
        throw new Error(
          `Migration ${row.name} is now ${renumbered.name}: the database applied it under its old number and cannot be upgraded; make a new one (db/README.md)`,
        )
      }
      if (file?.name !== row.name || file.checksum !== row.checksum) {
        throw new Error(
          `Migration history differs at ${row.name}; restore the applied file and add a new migration`,
        )
      }
    }
    const pending = migrations.slice(applied.rows.length)
    for (const file of pending) {
      await client.query('begin')
      try {
        await client.query(file.sql)
        await client.query('insert into schema_migrations (name, checksum) values ($1, $2)', [
          file.name,
          file.checksum,
        ])
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        throw new Error(`Migration ${file.name} failed`, { cause: error })
      }
    }
    return pending.length
  } finally {
    await client.query("select pg_advisory_unlock(hashtextextended('heed.migrations', 0))")
  }
}
