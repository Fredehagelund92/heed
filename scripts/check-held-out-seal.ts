import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/*
  The guard of the sealed held-out cases (FR-525), run on every pull request
  (.github/workflows/ci.yml, "Held-out seal"): `node scripts/check-held-out-seal.ts <base> [<head>]`.
  No component grades its own change, so a pull request fails when:

  1. it changes the sealed cases, or the code that seals and opens them, together with anything
     under src/ (the code the cases test): such a change goes in a pull request of its own;
  2. it deletes or renames the sealed file;
  3. the sealed file is not an age file, as if its cases were committed in plain text (or merely
     wrapped in the armor), or any file adds an age secret key;
  4. the visible golden set holds a held-out case;
  5. code outside the seal's own files opens the sealed file or reads its key: it names the file,
     the key's variables, the age library or a function that hands out the cases. A runner gets
     counts from heldOutL1 or heldOutArea (db/seed/held-out-runs.ts), which run the cases silenced
     and print nothing but counts.

  No cases are sealed at present: the sealed file and its cases were removed before the public
  repository was cut, and the key holder seals fresh ones with a new key. While the file is absent,
  rules 1 to 3 have nothing to protect and rules 4 and 5 still hold. The first pull request that
  adds the sealed file has nothing sealed before it, so rule 1 starts with the next one. CI runs the base branch's copy of this script, so a pull request cannot
  loosen the guard that judges it. Rule 5 reads words, so it catches the plain ways to open the
  cases, not a determined disguise: that is for review, which the key holder's own pull requests
  get. It needs only git and node: no install.
*/

export const sealedPath = 'db/seed/golden-held-out.age'
export const visiblePath = 'db/seed/golden-set.yml'

/** The seal's own files: the only ones that may open the sealed file, never changed with src/. */
export const sealFiles = [
  sealedPath,
  'db/seed/held-out.ts',
  'db/seed/held-out-runs.ts',
  'scripts/held-out.ts',
  'scripts/check-held-out-seal.ts',
  'tests/server/held-out.test.ts',
  'tests/integration/held-out.test.ts',
  'tests/lint/held-out-seal.test.ts',
]

/** What opens the sealed cases or reads the key, in code. */
const opening = [
  'golden-held-out',
  'HEED_HELDOUT_KEY',
  'age-encryption',
  'readHeldOut',
  'unseal',
  'parseHeldOut',
  'withHeldOut',
  'identityFrom',
  'sealedFile',
  'runHeldOut',
  'checkHeldOut',
]
/** Files that run or configure code: workflows, scripts, package scripts and source. */
const isCode = (path: string) =>
  /\.(?:[cm]?[jt]sx?|sh|py)$/.test(path) || path.startsWith('.github/') || path === 'package.json'

export type Change = { status: string; path: string; from?: string }
export type SealInput = {
  changes: Change[]
  /** Lines each changed file adds, by path. */
  added: Record<string, string[]>
  /** Whether the base had the sealed file. */
  sealedBefore: boolean
  /** The sealed file and the visible set at the head, or null where absent. */
  sealedAfter: string | null
  visibleAfter: string | null
}

/** Whether a file is an age file: the armor around a body that starts with age's header. */
export function isAgeFile(text: string): boolean {
  const armored =
    /^-----BEGIN AGE ENCRYPTED FILE-----\n([A-Za-z0-9+/=\n]+)-----END AGE ENCRYPTED FILE-----\n?$/.exec(
      text,
    )
  return (
    armored !== null &&
    Buffer.from(armored[1]!.replaceAll('\n', ''), 'base64')
      .toString('latin1')
      .startsWith('age-encryption.org/v1\n-> ')
  )
}

const secretKey = /AGE-SECRET-KEY-(?:PQ-)?1[02-9AC-HJ-NP-Z]{20,}/

/** Every rule the change breaks, in words; none when it passes. */
export function sealProblems(input: SealInput): string[] {
  const problems: string[] = []
  const paths = input.changes.flatMap((c) => [c.path, ...(c.from ? [c.from] : [])])
  const seal = [...new Set(paths.filter((p) => sealFiles.includes(p)))]
  const src = paths.filter((p) => p.startsWith('src/'))
  if (input.sealedBefore && seal.length && src.length)
    problems.push(
      `It changes the sealed held-out cases or their code (${seal.join(', ')}) together with src/ (${src.slice(0, 3).join(', ')}${src.length > 3 ? ', ...' : ''}). No component grades its own change: put the held-out change in a pull request of its own.`,
    )
  for (const c of input.changes)
    if ((c.from ?? c.path) === sealedPath && (c.status.startsWith('D') || c.status.startsWith('R')))
      problems.push(`It deletes or moves ${sealedPath}, which holds the sealed held-out cases.`)
  if (input.sealedAfter !== null && !isAgeFile(input.sealedAfter))
    problems.push(
      `${sealedPath} is not an age file: sealed cases are never committed in plain text.`,
    )
  for (const [path, lines] of Object.entries(input.added))
    if (lines.some((line) => secretKey.test(line)))
      problems.push(`${path} adds an age secret key: a key is never committed.`)
  if (input.visibleAfter !== null && /^\s*split:\s*held_out\b/m.test(input.visibleAfter))
    problems.push(
      `${visiblePath} holds a held-out case: held-out cases are sealed (npm run held-out -- edit).`,
    )
  for (const [path, lines] of Object.entries(input.added)) {
    if (sealFiles.includes(path) || !isCode(path)) continue
    // Declaring the age library as a dependency opens nothing; a package script that uses it does.
    const code = lines.filter(
      (line) => path !== 'package.json' || !/^\s*"age-encryption": "[^"]*",?$/.test(line),
    )
    const named = opening.filter((word) => code.some((line) => line.includes(word)))
    if (named.length)
      problems.push(
        `${path} opens the sealed held-out cases or reads their key (${named.join(', ')}). Only the seal's own files may; a runner gets counts from heldOutL1 or heldOutArea.`,
      )
  }
  return problems
}

const git = (args: string[]) => {
  const run = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
  if (run.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${run.stderr.trim()}`)
  return run.stdout
}
const show = (rev: string, path: string) => {
  const run = spawnSync('git', ['show', `${rev}:${path}`], { encoding: 'utf8' })
  return run.status === 0 ? run.stdout : null
}

/** What sealProblems reads, from git: the change from `base` to `head`. */
export function readChange(base: string, head: string): SealInput {
  // NUL-separated, so a path is never quoted or escaped, however it is spelt.
  const fields = git(['diff', '--name-status', '-z', '-M', base, head]).split('\0')
  const changes: Change[] = []
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++]!
    if (/^[RC]/.test(status)) changes.push({ status, from: fields[i++]!, path: fields[i++]! })
    else changes.push({ status, path: fields[i++]! })
  }
  // Each file's added lines from its own diff, read as text even when git thinks it binary.
  const added: Record<string, string[]> = {}
  for (const c of changes) {
    if (c.status.startsWith('D')) continue
    const diff = git([
      '--literal-pathspecs',
      'diff',
      '-U0',
      '--no-color',
      '--no-ext-diff',
      '--text',
      '-M',
      base,
      head,
      '--',
      ...(c.from ? [c.from] : []),
      c.path,
    ])
    let hunk = false
    for (const line of diff.split('\n')) {
      if (line.startsWith('@@')) hunk = true
      else if (hunk && line.startsWith('+')) (added[c.path] ??= []).push(line.slice(1))
    }
  }
  return {
    changes,
    added,
    sealedBefore: show(base, sealedPath) !== null,
    sealedAfter: show(head, sealedPath),
    visibleAfter: show(head, visiblePath),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head = 'HEAD'] = process.argv.slice(2)
  if (!base) {
    console.error('Usage: node scripts/check-held-out-seal.ts <base> [<head>]')
    process.exitCode = 2
  } else {
    const problems = sealProblems(readChange(base, head))
    if (problems.length) {
      console.error(`The held-out seal (FR-525) refuses this change:\n- ${problems.join('\n- ')}`)
      process.exitCode = 1
    } else console.log('The held-out seal holds: no rule of FR-525 is broken.')
  }
}
