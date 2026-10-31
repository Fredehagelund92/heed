// Adds a migration, or renumbers this branch's migrations after a rebase (db/README.md, "Adding a
// migration"). Numbers run from 0001 without a gap, so two branches that each add one take the
// same number; db/migrations/latest.txt names the last one, so the second branch to merge gets a
// merge conflict instead of a main that refuses to migrate.
//
//   npm run db:new-migration -- <snake_case_name>   adds the next file, empty, and names it last
//   npm run db:renumber [-- <base>]                 after a rebase onto <base> (default origin/main):
//                                                   moves this branch's files after its last one
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  latestMigrationFile,
  migrationDirectory,
  migrationFilesProblem,
  renumberedMigrations,
} from '../src/server/db/migrate.ts'

const git = (...args: string[]) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    cwd: fileURLToPath(new URL('..', import.meta.url)),
  })

/** The tracked files whose text names `name`; git grep exits 1 when there are none. */
function filesNaming(name: string): string[] {
  try {
    return git('grep', '-l', '-F', name).split('\n').filter(Boolean)
  } catch (error) {
    if ((error as { status?: number }).status === 1) return []
    throw error
  }
}

const sqlFiles = () =>
  readdirSync(migrationDirectory)
    .filter((name) => name.endsWith('.sql'))
    .sort()

function writeLatest(files: readonly string[]) {
  const problem = migrationFilesProblem(files)
  if (problem) throw new Error(problem)
  writeFileSync(latestMigrationFile, `${files.at(-1)}\n`)
}

const [command, argument] = process.argv.slice(2)

if (command === 'new') {
  if (!argument || !/^[a-z0-9_]+$/.test(argument))
    throw new Error('Name the migration in snake_case: npm run db:new-migration -- add_some_table')
  const files = sqlFiles()
  const name = `${String(files.length + 1).padStart(4, '0')}_${argument}.sql`
  writeFileSync(new URL(name, migrationDirectory), `-- ${argument.replaceAll('_', ' ')}\n`)
  writeLatest([...files, name])
  console.log(`wrote db/migrations/${name}`)
} else if (command === 'renumber') {
  const base = argument ?? 'origin/main'
  const baseFiles = git('ls-tree', '--name-only', `${base}:db/migrations`)
    .split('\n')
    .filter((name) => name.endsWith('.sql'))
  const { renames, files } = renumberedMigrations(baseFiles, sqlFiles())
  for (const [from, to] of renames) {
    git('mv', `db/migrations/${from}`, `db/migrations/${to}`)
    // Comments and docs that name the file follow it.
    const naming = filesNaming(from)
    for (const path of naming) {
      const file = new URL(`../${path}`, import.meta.url)
      writeFileSync(file, readFileSync(file, 'utf8').replaceAll(from, to))
      git('add', path)
    }
    console.log(`renamed ${from} to ${to}${naming.length ? ` (and in ${naming.join(', ')})` : ''}`)
  }
  writeLatest(files)
  git('add', 'db/migrations/latest.txt')
  console.log(`db/migrations/latest.txt names ${files.at(-1)}`)
} else {
  throw new Error('Usage: node scripts/migrations.ts new <name> | renumber [<base>]')
}
