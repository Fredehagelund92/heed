import { readdir } from 'node:fs/promises'
import { expect, it } from 'vitest'
import { migrationDirectory, migrationFilesProblem } from '../../src/server/db/migrate.ts'

/**
 * Each migration takes the next number, so the runner's order is the order they were merged in.
 * Two branches that both took one would sort by the rest of the name, and a database migrated
 * between their merges would be refused. The runner refuses such a set too; this test says so
 * before anything needs a database.
 */

const files = async () =>
  (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()

it('numbers every migration once, from 0001 without a gap', async () => {
  expect(migrationFilesProblem(await files())).toBeUndefined()
})

it('starts from the baseline', async () => {
  expect((await files())[0]).toBe('0001_baseline.sql')
})

it('refuses a shared, skipped or missing first number', () => {
  expect(migrationFilesProblem(['0001_a.sql', '0002_b.sql', '0002_c.sql'])).toBe(
    'Migration files 0002_b.sql and 0002_c.sql share a number; renumber the newer one after the last migration',
  )
  expect(migrationFilesProblem(['0001_a.sql', '0003_b.sql'])).toBe(
    'Migration file 0003_b.sql must be numbered 0002: numbers run from 0001 without a gap',
  )
  expect(migrationFilesProblem(['0002_a.sql'])).toBe(
    'Migration file 0002_a.sql must be numbered 0001: numbers run from 0001 without a gap',
  )
  expect(migrationFilesProblem(['0001-a.sql'])).toBe(
    'Migration file 0001-a.sql must be named NNNN_snake_case.sql',
  )
})
