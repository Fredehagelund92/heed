import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  sealedPath,
  sealProblems,
  visiblePath,
  type SealInput,
} from '../../scripts/check-held-out-seal.ts'

/*
  The held-out seal's guard (FR-525) is only worth having if it fails a change it should. Each
  rule is shown failing on its own, then the script is run on a real git history.
*/

/** An armored file with the body given: age's header, or anything else. */
const armor = (body: string) =>
  `-----BEGIN AGE ENCRYPTED FILE-----\n${Buffer.from(body).toString('base64')}\n-----END AGE ENCRYPTED FILE-----\n`
const armored = armor('age-encryption.org/v1\n-> X25519 abc\n--- x\n')
const input = (over: Partial<SealInput> = {}): SealInput => ({
  changes: [],
  added: {},
  sealedBefore: true,
  sealedAfter: armored,
  visibleAfter: 'cases:\n  - id: gs-visible\n    split: development\n',
  ...over,
})
const modified = (...paths: string[]) => paths.map((path) => ({ status: 'M', path }))

describe('the held-out seal', () => {
  it('passes a change to src/ alone, and a change to the sealed cases alone', () => {
    expect(
      sealProblems(input({ changes: modified('src/server/modules/assistant/prompt.ts') })),
    ).toEqual([])
    expect(sealProblems(input({ changes: modified(sealedPath) }))).toEqual([])
  })

  it('fails a change to the sealed cases or their code together with src/', () => {
    for (const seal of [sealedPath, 'db/seed/held-out.ts', 'scripts/check-held-out-seal.ts']) {
      const [problem, ...rest] = sealProblems(
        input({ changes: modified(seal, 'src/server/modules/assistant/tools.ts') }),
      )
      expect(rest).toEqual([])
      expect(problem).toMatch(/together with src\/ \(src\/server\/modules\/assistant\/tools\.ts\)/)
      expect(problem).toContain(seal)
    }
    // A move into src/ counts as a change under src/.
    expect(
      sealProblems(
        input({
          changes: [
            ...modified(sealedPath),
            { status: 'R100', path: 'src/x.ts', from: 'docs/x.ts' },
          ],
        }),
      ),
    ).toHaveLength(1)
  })

  it('lets the change that first adds the sealed file touch src/', () => {
    expect(
      sealProblems(
        input({
          sealedBefore: false,
          changes: modified(sealedPath, 'src/server/run-assistant-evals.ts'),
        }),
      ),
    ).toEqual([])
  })

  it('fails deleting or moving the sealed file', () => {
    expect(
      sealProblems(input({ sealedAfter: null, changes: [{ status: 'D', path: sealedPath }] })),
    ).toEqual([expect.stringMatching(/deletes or moves db\/seed\/golden-held-out\.age/)])
    expect(
      sealProblems(
        input({
          sealedAfter: null,
          changes: [{ status: 'R090', path: 'db/x.age', from: sealedPath }],
        }),
      ),
    ).toEqual([expect.stringMatching(/deletes or moves/)])
  })

  it('fails a sealed file that is not an age file, even in the armor, and a committed key', () => {
    const plain = 'cases:\n  - id: gs-held\n    split: held_out\n'
    for (const sealedAfter of [plain, armor(plain)])
      expect(sealProblems(input({ sealedAfter }))).toEqual([
        expect.stringMatching(/is not an age file/),
      ])
    // Built here, so no key-shaped text is in this file.
    const key = ['AGE', 'SECRET', 'KEY', `1${'Q'.repeat(58)}`].join('-')
    expect(
      sealProblems(
        input({ changes: modified('docs/notes.md'), added: { 'docs/notes.md': [key] } }),
      ),
    ).toEqual(['docs/notes.md adds an age secret key: a key is never committed.'])
  })

  it('fails a held-out case in the visible golden set', () => {
    expect(
      sealProblems(input({ visibleAfter: 'cases:\n  - id: gs-held\n    split: held_out\n' })),
    ).toEqual([expect.stringMatching(/golden-set\.yml holds a held-out case/)])
  })

  it('fails code outside the seal that opens the sealed cases or reads their key', () => {
    const opens = [
      "import { readHeldOut } from '../../db/seed/held-out.ts'",
      'const key = process.env.HEED_HELDOUT_KEY_FILE',
      "readFileSync('db/seed/golden-held-out.age')",
      "import { Decrypter } from 'age-encryption'",
      'await runHeldOut((held) => held.cases, run)',
      'await checkHeldOut(set, checks)',
    ]
    for (const line of opens)
      expect(
        sealProblems(
          input({
            changes: modified('tests/server/sneaky.test.ts'),
            added: { 'tests/server/sneaky.test.ts': [line] },
          }),
        ),
        line,
      ).toEqual([
        expect.stringMatching(/^tests\/server\/sneaky\.test\.ts opens the sealed held-out cases/),
      ])
    // The eval area runner gets the held-out questions only from heldOutArea: code that reads
    // the sealed cases itself to hand them to runWithheld fails, wherever it is.
    expect(
      sealProblems(
        input({
          changes: modified('src/server/run-evals.ts'),
          added: {
            'src/server/run-evals.ts': [
              'const held = await readHeldOut(identity)',
              'await runWithheld(database, deps, { questions: held.cases.map(toQuestion) })',
            ],
          },
        }),
      ),
    ).toEqual([expect.stringMatching(/^src\/server\/run-evals\.ts opens .*\(readHeldOut\)/)])
    // A workflow that hands CI the key, and an npm script that decrypts, fail too.
    for (const path of ['.github/workflows/ci.yml', 'package.json'])
      expect(
        sealProblems(
          input({ changes: modified(path), added: { [path]: ['  HEED_HELDOUT_KEY: x'] } }),
        ),
      ).toHaveLength(1)
  })

  it('lets package.json declare the age library, but not run it in a script', () => {
    const declared = { 'package.json': ['    "age-encryption": "0.3.1",'] }
    expect(sealProblems(input({ changes: modified('package.json'), added: declared }))).toEqual([])
    const script = { 'package.json': ['    "peek": "node -e \\"import(\'age-encryption\')\\"",'] }
    expect(sealProblems(input({ changes: modified('package.json'), added: script }))).toHaveLength(
      1,
    )
  })

  it('lets a runner take counts, the seal open the cases, and the docs name the key', () => {
    const counts = [
      "import { heldOutArea, heldOutL1 } from '../../db/seed/held-out-runs.ts'",
      "console.log(formatHeldOut('agent cases', await heldOutL1(tx)))",
      // The eval area runner's held-out path: counts by type, the cases opened by the seal.
      "console.log(formatHeldOut('area cases', await heldOutArea(database, deps, options)))",
    ]
    expect(
      sealProblems(
        input({
          changes: modified(
            'tests/integration/golden-set.test.ts',
            'db/seed/held-out.ts',
            'README.md',
          ),
          added: {
            'tests/integration/golden-set.test.ts': counts,
            'db/seed/held-out.ts': ['const decrypter = new Decrypter() // age-encryption'],
            'README.md': [
              'Set HEED_HELDOUT_KEY_FILE for one command; it opens golden-held-out.age.',
            ],
          },
        }),
      ),
    ).toEqual([])
  })
})

describe('the guard on a git history', () => {
  const root = mkdtempSync(join(tmpdir(), 'heed-seal-guard-'))
  const script = fileURLToPath(new URL('../../scripts/check-held-out-seal.ts', import.meta.url))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => {
    const run = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })
    expect(run.status, run.stderr).toBe(0)
    return run.stdout.trim()
  }
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), text)
  }
  const commit = (message: string) => {
    git('add', '-A')
    git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  const guard = (base: string, head: string) =>
    spawnSync(process.execPath, [script, base, head], { cwd: root, encoding: 'utf8' })

  it('passes a change to src/ alone and fails one that also changes the sealed file', () => {
    git('init', '-q')
    write(sealedPath, armored)
    write(visiblePath, 'cases: []\n')
    write('src/server/prompt.ts', 'export const prompt = 1\n')
    const base = commit('base')
    write('src/server/prompt.ts', 'export const prompt = 2\n')
    const alone = commit('src alone')
    const passed = guard(base, alone)
    expect(passed.status).toBe(0)
    expect(passed.stdout).toMatch(/The held-out seal holds/)
    write(sealedPath, armor('age-encryption.org/v1\n-> X25519 abd\n--- x\n'))
    write('src/server/prompt.ts', 'export const prompt = 3\n')
    const both = commit('both')
    const failed = guard(alone, both)
    expect(failed.status).toBe(1)
    expect(failed.stderr).toMatch(/refuses this change:\n- It changes the sealed held-out cases/)
  })

  it('reads a file whose name git would quote, and an added line that starts like a header', () => {
    const before = git('rev-parse', 'HEAD')
    write('tests/sneaky "quoted" ü.ts', "++ 'x'\nreadFileSync('db/seed/golden-held-out.age')\n")
    write('tests/plain.ts', '+++ b/README.md readHeldOut\n')
    const sneaky = commit('sneaky')
    const failed = guard(before, sneaky)
    expect(failed.status).toBe(1)
    expect(failed.stderr).toContain('tests/sneaky "quoted" ü.ts opens the sealed held-out cases')
    expect(failed.stderr).toContain(
      'tests/plain.ts opens the sealed held-out cases or reads their key (readHeldOut)',
    )
  })
})
