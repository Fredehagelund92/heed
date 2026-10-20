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
