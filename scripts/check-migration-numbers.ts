import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { migrationFilesProblem } from '../src/server/db/migrate.ts'

/*
  The migration numbers of a change, checked before any database starts (.github/workflows/ci.yml,
  "Migration numbers"): `node scripts/check-migration-numbers.ts <base> [<head>]`. In CI the base
  is the first parent of the commit under test, which is the base branch for a pull request and
  the queue ahead for a merge queue entry. A change fails when:

  1. a migration it adds takes a number the base already gives another file, as when two pull
     requests each took the next number and the other merged first;
  2. two of its files share a number;
  3. it renames or deletes a migration the base has, which a database that applied it refuses;
  4. otherwise, the numbers do not run from 0001 without a gap (migrationFilesProblem);
  5. db/migrations/latest.txt does not name the last file, as when a pull request that adds one
     merges after another that changed latest.txt.

  It needs only git and node: no install, so it fails within seconds.
*/

const renumber =
  'Rebase onto the base branch and run `npm run db:renumber` (docs/development.md, "Generated files and rebasing").'

const number = (name: string) => name.slice(0, 4)

/**
 * Why the migration files `head` holds cannot follow the ones `base` holds, if they cannot.
 * `latest` is the text of head's db/migrations/latest.txt, or null where it has none.
 */
export function migrationNumberProblems(
  base: readonly string[],
  head: readonly string[],
  latest: string | null = null,
): string[] {
  const problems: string[] = []
  const added = head.filter((name) => !base.includes(name))
  for (const name of added) {
    // A file the change renamed is reported as a rename, below.
    const taken = base.find((other) => number(other) === number(name) && head.includes(other))
    if (taken)
      problems.push(
        `db/migrations/${name} takes number ${number(name)}, which the base branch already gives ${taken}. ${renumber}`,
      )
  }
  const shared = new Map<string, string[]>()
  for (const name of head) shared.set(number(name), [...(shared.get(number(name)) ?? []), name])
  for (const [prefix, names] of shared) {
    // A clash with the base is reported once, above.
    if (names.length > 1 && names.filter((name) => base.includes(name)).length !== 1)
      problems.push(`${names.join(' and ')} share number ${prefix}. ${renumber}`)
  }
  for (const name of base.filter((name) => !head.includes(name)))
    problems.push(
      `db/migrations/${name} is on the base branch but not in this change. Rebase if the branch is behind; otherwise keep the file as it is, since a database that applied it refuses a renamed or missing one, and add a new migration instead.`,
    )
  if (problems.length === 0) {
    const problem = migrationFilesProblem([...head].sort())
    if (problem) problems.push(`${problem}. ${renumber}`)
  }
  const last = [...head].sort().at(-1)
  if (latest !== null && last && latest !== `${last}\n`)
    problems.push(
      `db/migrations/latest.txt names ${latest.trim() || 'nothing'}, but the last migration is ${last}. Run \`npm run db:renumber\`, which writes it.`,
    )
  return problems
}

/** The text of db/migrations/latest.txt in `rev`, or null where it has none. */
export function latestAt(rev: string): string | null {
  const run = spawnSync('git', ['show', `${rev}:db/migrations/latest.txt`], { encoding: 'utf8' })
  return run.status === 0 ? run.stdout : null
}

/** The migration files in `rev`, by name. */
export function migrationFilesAt(rev: string): string[] {
  const run = spawnSync('git', ['ls-tree', '-z', '--name-only', rev, 'db/migrations/'], {
    encoding: 'utf8',
  })
  if (run.status !== 0) throw new Error(`git ls-tree ${rev} failed: ${run.stderr.trim()}`)
  return run.stdout
    .split('\0')
    .filter((path) => path.endsWith('.sql'))
    .map((path) => path.slice('db/migrations/'.length))
    .sort()
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head = 'HEAD'] = process.argv.slice(2)
  if (!base) {
    console.error('Usage: node scripts/check-migration-numbers.ts <base> [<head>]')
    process.exitCode = 2
  } else {
    const problems = migrationNumberProblems(
      migrationFilesAt(base),
      migrationFilesAt(head),
      latestAt(head),
    )
    if (problems.length) {
      console.error(`The migrations of this change do not fit:\n- ${problems.join('\n- ')}`)
      process.exitCode = 1
    } else
      console.log(
        'Migration numbers: every file has its own number, after the base branch, and latest.txt names the last.',
      )
  }
}
