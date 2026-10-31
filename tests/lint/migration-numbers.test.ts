import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { migrationNumberProblems } from '../../scripts/check-migration-numbers.ts'

/*
  CI's early check of migration numbers (scripts/check-migration-numbers.ts) fails a pull request
  that took a number its base branch already has, before any database starts. Each rule is shown
  failing on its own, then the script is run on a real git history.
*/

const renumber = 'Rebase onto the base branch and run `npm run db:renumber`'
const base = ['0001_baseline.sql', '0002_people.sql']

describe('the migration numbers of a change', () => {
  it('pass the next number, and no new migration at all', () => {
    expect(migrationNumberProblems(base, [...base, '0003_mine.sql'])).toEqual([])
    expect(migrationNumberProblems(base, base)).toEqual([])
  })

  it('fail a new migration that takes a number the base branch already has', () => {
    const problems = migrationNumberProblems(base, [...base, '0002_mine.sql'])
    expect(problems).toEqual([
      expect.stringMatching(
        /^db\/migrations\/0002_mine\.sql takes number 0002, which the base branch already gives 0002_people\.sql\. /,
      ),
    ])
    expect(problems[0]).toContain(renumber)
  })

  it('fail two new migrations that share a number', () => {
    expect(migrationNumberProblems(base, [...base, '0003_a.sql', '0003_b.sql'])).toEqual([
      expect.stringMatching(/^0003_a\.sql and 0003_b\.sql share number 0003\. Rebase/),
    ])
  })

  it('fail renaming or deleting a migration the base branch has', () => {
    expect(migrationNumberProblems(base, ['0001_baseline.sql', '0002_persons.sql'])).toEqual([
      expect.stringMatching(/^db\/migrations\/0002_people\.sql is on the base branch but not/),
    ])
  })

  it('fail a db/migrations/latest.txt that does not name the last file', () => {
    const head = [...base, '0003_mine.sql']
    expect(migrationNumberProblems(base, head, '0003_mine.sql\n')).toEqual([])
    expect(migrationNumberProblems(base, head, '0002_people.sql\n')).toEqual([
      'db/migrations/latest.txt names 0002_people.sql, but the last migration is 0003_mine.sql. Run `npm run db:renumber`, which writes it.',
    ])
  })

  it('fail a gap or a badly named file', () => {
    expect(migrationNumberProblems(base, [...base, '0004_mine.sql'])).toEqual([
      expect.stringMatching(/^Migration file 0004_mine\.sql must be numbered 0003/),
    ])
    expect(migrationNumberProblems(base, [...base, '0003-mine.sql'])).toEqual([
      expect.stringMatching(/^Migration file 0003-mine\.sql must be named NNNN_snake_case\.sql/),
    ])
  })
})

describe('the check on a real git history', () => {
  const root = mkdtempSync(join(tmpdir(), 'heed-migration-numbers-'))
  const script = fileURLToPath(new URL('../../scripts/check-migration-numbers.ts', import.meta.url))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => {
    const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    return run.stdout.trim()
  }
  const add = (name: string) => {
    mkdirSync(join(root, 'db/migrations'), { recursive: true })
    writeFileSync(join(root, 'db/migrations', name), `-- ${name}\n`)
  }
  const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@example.com']
  const commit = (message: string) => {
    git('add', '-A')
    git(...identity, 'commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  const check = (from: string, to: string) =>
    spawnSync(process.execPath, [script, from, to], { cwd: root, encoding: 'utf8' })

  it('passes a clean number and fails one the base branch took first', () => {
    git('init', '-q', '-b', 'main')
    add('0001_baseline.sql')
    add('0002_people.sql')
    const main = commit('main')
    git('checkout', '-q', '-b', 'mine')
    add('0003_mine.sql')
    const clean = check(main, commit('mine'))
    expect(clean.status, clean.stderr).toBe(0)
    expect(clean.stdout).toMatch(/^Migration numbers: every file has its own number/)

    // Another pull request took 0003 first. The commit CI tests merges this branch into main, as
    // GitHub does for a pull request or a merge queue entry; its first parent is main.
    git('checkout', '-q', 'main')
    add('0003_theirs.sql')
    const theirs = commit('theirs')
    git(...identity, 'merge', '-q', '--no-ff', '-m', 'merge', 'mine')
    const clash = check(theirs, 'HEAD')
    expect(clash.status).toBe(1)
    expect(clash.stderr).toMatch(
      /do not fit:\n- db\/migrations\/0003_mine\.sql takes number 0003, which the base branch already gives 0003_theirs\.sql\. Rebase onto the base branch and run `npm run db:renumber`/,
    )
  })

  it('fails a latest.txt that names a file before the last', () => {
    const before = git('rev-parse', 'HEAD')
    writeFileSync(join(root, 'db/migrations/latest.txt'), '0002_people.sql\n')
    const stale = check(before, commit('stale latest.txt'))
    expect(stale.status).toBe(1)
    expect(stale.stderr).toMatch(/latest\.txt names 0002_people\.sql, but the last migration is/)
  })
})
