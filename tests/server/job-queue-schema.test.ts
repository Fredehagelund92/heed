import { readFile } from 'node:fs/promises'
import { getConstructionPlans } from 'pg-boss'
import { expect, it } from 'vitest'
import { migrationDirectory } from '../../src/server/db/migrate.ts'

/**
 * The vendored queue schema, the first part of the baseline migration, must be exactly what the
 * installed pg-boss would create.
 */

function statements(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => !line.startsWith('--') && !/^\s*(BEGIN|COMMIT);$/.test(line))
    .join('\n')
    .trim()
}

it('matches the schema the installed pg-boss creates', async () => {
  const baseline = await readFile(new URL('0001_baseline.sql', migrationDirectory), 'utf8')
  const vendored = /^-- The job queue: begin\n([\s\S]*)^-- The job queue: end$/m.exec(baseline)?.[1]
  expect(vendored).toBeDefined()
  expect(statements(vendored!)).toBe(statements(getConstructionPlans('pgboss')))
})
