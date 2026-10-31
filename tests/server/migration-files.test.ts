import { readdir, readFile } from 'node:fs/promises'
import { expect, it } from 'vitest'
import {
  latestMigrationFile,
  migrationDirectory,
  migrationFilesProblem,
  renumberedMigrations,
} from '../../src/server/db/migrate.ts'

/**
 * Each migration takes the next number, so the runner's order is the order they were merged in.
 * Two branches that both took one would sort by the rest of the name, and a database migrated
 * between their merges would be refused. The runner refuses such a set too; this test says so
 * before anything needs a database. db/migrations/latest.txt names the last file, so two branches
 * that each add one change the same line and the second to merge has to rebase and renumber
 * (`npm run db:renumber`) before it can.
 */

const files = async () =>
  (await readdir(migrationDirectory)).filter((name) => name.endsWith('.sql')).sort()

it('numbers every migration once, from 0001 without a gap', async () => {
  expect(migrationFilesProblem(await files())).toBeUndefined()
})

it('names the last migration in db/migrations/latest.txt (run `npm run db:renumber`)', async () => {
  expect(await readFile(latestMigrationFile, 'utf8')).toBe(`${(await files()).at(-1)}\n`)
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

it("moves a branch's own migrations after the base branch's last one, in their order", () => {
  expect(
    renumberedMigrations(
      ['0001_a.sql', '0002_b.sql', '0003_main.sql'],
      ['0001_a.sql', '0002_b.sql', '0003_main.sql', '0003_mine.sql', '0004_more.sql'],
    ),
  ).toEqual({
    renames: [
      ['0003_mine.sql', '0004_mine.sql'],
      ['0004_more.sql', '0005_more.sql'],
    ],
    files: ['0001_a.sql', '0002_b.sql', '0003_main.sql', '0004_mine.sql', '0005_more.sql'],
  })
  expect(renumberedMigrations(['0001_a.sql'], ['0001_a.sql', '0002_b.sql'])).toEqual({
    renames: [],
    files: ['0001_a.sql', '0002_b.sql'],
  })
  expect(() => renumberedMigrations(['0001_a.sql', '0002_b.sql'], ['0001_a.sql'])).toThrow(
    '0002_b.sql is on the base branch but not here: rebase first',
  )
})
