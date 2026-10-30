import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateIdentity } from 'age-encryption'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { stringify } from 'yaml'
import { loadGoldenSet } from '../../db/seed/golden-set.ts'
import {
  checkHeldOut,
  formatHeldOut,
  heldOutKeyGiven,
  heldOutProblems,
  heldOutUnavailable,
  noKey,
  noSealedCases,
  readHeldOut,
  readHeldOutKey,
  runHeldOut,
  seal,
  unseal,
  withHeldOut,
} from '../../db/seed/held-out.ts'
import { countLine, editSealed, keygen, rotateSealed } from '../../scripts/held-out.ts'
import { goldenSetChecks } from './domain/golden-checks.ts'

/*
  The sealed held-out cases (FR-525). Every key here is a throwaway one, made in the test: the key
  holder's real key never reaches a test, a worker or CI. The last block opens the real sealed
  file, and runs only where it exists and the key holder gives the key.
*/

const dir = mkdtempSync(join(tmpdir(), 'heed-held-out-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
let files = 0
const file = (text: string, name = `file-${++files}`) => {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}

/** A marker in a held-out case's words, which must never be printed or reported. */
const canary = 'CANARY7F3A'
const visible = loadGoldenSet()
const agentCase = {
  ...visible.cases[0]!,
  id: 'gs-test-held-agent',
  split: 'held_out' as const,
  wordings: visible.cases[0]!.wordings.map((w) => ({ ...w, text: `${w.text} ${canary}` })),
}
// A second held-out case, of another type than the first.
const otherCase = {
  ...visible.cases.find((c) => c.type !== visible.cases[0]!.type)!,
  id: 'gs-test-held-other',
  split: 'held_out' as const,
}
const heldText = stringify({ cases: [agentCase, otherCase] })
const key = () => generateIdentity()
const keyFile = async (identity?: string) =>
  file(`# a throwaway key\n# public key: none\n${identity ?? (await key())}\n`)

describe('the held-out key', () => {
  it('is read only from the two variables, inline or from a file with comments', async () => {
    const identity = await key()
    expect(heldOutKeyGiven({})).toBe(false)
    expect(await readHeldOutKey({})).toBeNull()
    expect(await readHeldOutKey({ HEED_HELDOUT_KEY: identity })).toBe(identity)
    expect(await readHeldOutKey({ HEED_HELDOUT_KEY_FILE: await keyFile(identity) })).toBe(identity)
    expect(heldOutKeyGiven({ HEED_HELDOUT_KEY_FILE: 'x' })).toBe(true)
  })

  it('refuses both at once, a key that is not one and a missing file, without echoing them', async () => {
    const identity = await key()
    await expect(
      readHeldOutKey({ HEED_HELDOUT_KEY: identity, HEED_HELDOUT_KEY_FILE: 'x' }),
    ).rejects.toThrow(/not both/)
    const wrong = `${identity.slice(0, -4)}oops`
    const refused = await readHeldOutKey({ HEED_HELDOUT_KEY: wrong }).catch((e: Error) => e)
    expect(refused).toBeInstanceOf(Error)
    expect((refused as Error).message).toMatch(/not an age secret key/)
    expect((refused as Error).message).not.toContain(wrong.slice(15))
    await expect(readHeldOutKey({ HEED_HELDOUT_KEY_FILE: join(dir, 'none') })).rejects.toThrow(
      /names no readable file/,
    )
  })
})

describe('the sealed file', () => {
  it('opens with its key only, and shows nothing of the cases without it', async () => {
    const identity = await key()
    const sealed = await seal(heldText, identity)
    expect(sealed).toMatch(/^-----BEGIN AGE ENCRYPTED FILE-----\n/)
    expect(sealed).not.toContain(canary)
    expect(await unseal(sealed, identity)).toBe(heldText)
    const held = await readHeldOut(identity, file(sealed))
    expect(held.cases.map((c) => c.id)).toEqual(['gs-test-held-agent', 'gs-test-held-other'])
    const refused = await unseal(sealed, await key()).catch((e: Error) => e.message)
    expect(refused).toMatch(/does not open the sealed file/)
  })

  it('seals only held-out cases in the format, and names a problem by its place, not its value', async () => {
    const identity = await key()
    const development = stringify({ cases: [{ ...agentCase, split: 'development' }] })
    await expect(seal(development, identity)).rejects.toThrow(/Every sealed case is held out/)
    const broken = stringify({ cases: [{ ...agentCase, area: `${canary} area` }] })
    const problems = heldOutProblems(broken)
    expect(problems).toEqual([expect.stringMatching(/^cases\.0\.area: /)])
    expect(problems.join()).not.toContain(canary)
    expect(heldOutProblems(`cases: [\n  ${canary}: {`)).toEqual([
      expect.stringMatching(/^Not valid YAML at line \d+$/),
    ])
  })

  it('adds the held-out cases to the visible set, never under a visible id', () => {
    const whole = withHeldOut(visible, { cases: [agentCase, otherCase] })
    expect(whole.cases).toHaveLength(visible.cases.length + 2)
    expect(() =>
      withHeldOut(visible, { cases: [{ ...agentCase, id: visible.cases[1]!.id }] }),
    ).toThrow(/has the id of another case/)
  })
})

describe('a held-out run', () => {
  const sealedWith = async () => {
    const identity = await key()
    return {
      env: { HEED_HELDOUT_KEY: identity },
      path: file(await seal(heldText, identity)),
    }
  }

  it('runs nothing without a key, and says so', async () => {
    const { path } = await sealedWith()
    const run = vi.fn()
    const result = await runHeldOut((held) => held.cases, run, {}, path)
    expect(result).toEqual({ ran: false, reason: noKey })
    expect(run).not.toHaveBeenCalled()
    expect(formatHeldOut('agent cases', result)).toBe(`Held-out agent cases: not run. ${noKey}`)
    expect(noKey).toMatch(/only the visible ones did/)
  })

  it('runs nothing without a sealed file, even with a key, and fails nothing', async () => {
    const env = { HEED_HELDOUT_KEY: await key() }
    const absent = join(dir, 'no-sealed-file.age')
    const run = vi.fn()
    const result = await runHeldOut((held) => held.cases, run, env, absent)
    expect(result).toEqual({ ran: false, reason: noSealedCases })
    expect(run).not.toHaveBeenCalled()
    expect(await checkHeldOut(visible, {}, env, absent)).toEqual({
      ran: false,
      reason: noSealedCases,
    })
    expect(heldOutUnavailable(env, absent)).toBe(noSealedCases)
    expect(formatHeldOut('agent cases', result)).toBe(
      `Held-out agent cases: not run. ${noSealedCases}`,
    )
    expect(noSealedCases).toMatch(/did not run: only the visible ones did/)
  })

  it('counts results by type: passed, failed, and skipped when the runner gave none', async () => {
    const { env, path } = await sealedWith()
    const result = await runHeldOut(
      (held) => held.cases,
      () => Promise.resolve([{ id: 'gs-test-held-agent', passed: false }]),
      env,
      path,
    )
    expect(result).toEqual({
      ran: true,
      counts: {
        passed: 0,
        failed: 1,
        skipped: 1,
        byType: {
          [agentCase.type]: { passed: 0, failed: 1, skipped: 0 },
          [otherCase.type]: { passed: 0, failed: 0, skipped: 1 },
        },
      },
    })
    expect(formatHeldOut('cases', result)).toBe(
      `Held-out cases: 0 passed, 1 failed, 1 skipped of 2 (${[
        `${agentCase.type} 0 passed, 1 failed`,
        `${otherCase.type} 0 passed, 0 failed, 1 skipped`,
      ]
        .sort()
        .join('; ')}).`,
    )
  })

  it('prints nothing while the cases run, and keeps a failure’s message back', async () => {
    const { env, path } = await sealedWith()
    const printed: string[] = []
    const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => {
      printed.push(a.join(' '))
    })
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk))
      return true
    })
    try {
      await runHeldOut(
        (held) => held.cases,
        (cases) => {
          console.log(cases[0]!.wordings[0]!.text)
          console.error(JSON.stringify(cases))
          process.stdout.write(cases[0]!.wordings[0]!.text)
          process.stderr.write(cases[0]!.wordings[0]!.text)
          return Promise.resolve(cases.map((c) => ({ id: c.id, passed: true })))
        },
        env,
        path,
      )
      const failure = await runHeldOut(
        (held) => held.cases,
        (cases) => Promise.reject(new TypeError(`Expected ${cases[0]!.wordings[0]!.text}`)),
        env,
        path,
      ).catch((e: Error) => e.message)
      expect(failure).toMatch(/failed with TypeError; its message is withheld/)
      expect(failure).not.toContain(canary)
      console.log('after')
    } finally {
      log.mockRestore()
      write.mockRestore()
    }
    expect(printed.join('\n')).not.toContain(canary)
    expect(printed).toContain('after')
  })

  it('reports whole-set checks by name only', async () => {
    const { env, path } = await sealedWith()
    const result = await checkHeldOut(
      visible,
      {
        'has the held-out agent case': (whole) =>
          expect(whole.cases.some((c) => c.id === agentCase.id)).toBe(true),
        'names no canary': (whole) => expect(JSON.stringify(whole)).not.toContain(canary),
      },
      env,
      path,
    )
    expect(result).toEqual({ ran: true, failed: ['names no canary'] })
  })
})

describe("the key holder's commands (npm run held-out)", () => {
  const script = fileURLToPath(new URL('../../scripts/held-out.ts', import.meta.url))
  const cleanEnv = () => {
    const env = { ...process.env }
    delete env.HEED_HELDOUT_KEY
    delete env.HEED_HELDOUT_KEY_FILE
    return env
  }
  const cli = (args: string[], env: NodeJS.ProcessEnv) =>
    spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, cwd: dir })

  /** A scripted editor: records the file it was given and its mode, then edits it. */
  const editor = file(
    `import { appendFileSync, readFileSync, statSync, writeFileSync } from 'node:fs'
const [mode, log, buffer] = process.argv.slice(2)
const keyed = Boolean(process.env.HEED_HELDOUT_KEY || process.env.HEED_HELDOUT_KEY_FILE)
appendFileSync(log, [buffer, (statSync(buffer).mode & 0o777).toString(8), keyed].join(' ') + '\\n')
const text = readFileSync(buffer, 'utf8')
if (mode === 'retitle') writeFileSync(buffer, text.replaceAll('${canary}', 'EDITED'))
if (mode === 'break') writeFileSync(buffer, text.replace('split: held_out', 'split: development'))
`,
    'editor.mjs',
  )
  const editorCommand = (mode: string, log: string) =>
    `"${process.execPath}" "${editor}" ${mode} "${log}"`

  it(
    'eval needs an area and a known pass rule, and refuses without running anything',
    { timeout: 30_000 },
    () => {
      for (const args of [['eval'], ['eval', '--area', 'area_commercial', '--pass-rule', 'some']]) {
        const refused = cli(args, cleanEnv())
        expect(refused.status).toBe(2)
        expect(refused.stderr).toMatch(/^Usage: npm run held-out -- .*eval --area <id>/)
      }
    },
  )

  it(
    'keygen starts without loading the database, model or eval modules',
    { timeout: 30_000 },
    () => {
      const log = join(dir, 'resolved.log')
      const hook = file(
        `import { appendFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
registerHooks({
  resolve(specifier, context, next) {
    const result = next(specifier, context)
    appendFileSync(${JSON.stringify(log)}, result.url + '\\n')
    return result
  },
})
`,
        'resolve-log.mjs',
      )
      const out = join(dir, 'lazy-keys', 'held-out.key')
      const made = spawnSync(process.execPath, ['--import', hook, script, 'keygen', '--out', out], {
        encoding: 'utf8',
        env: cleanEnv(),
        cwd: dir,
      })
      expect(made.status, made.stderr).toBe(0)
      const resolved = readFileSync(log, 'utf8')
      expect(resolved).toContain('scripts/held-out.ts')
      expect(resolved).not.toMatch(/src\/server\/(modules\/(evals|models)|db)\//)
    },
  )

  it(
    'keygen saves a key for its owner only, says where, and never prints it',
    { timeout: 30_000 },
    async () => {
      const out = join(dir, 'keys', 'held-out.key')
      const made = cli(['keygen', '--out', out], cleanEnv())
      expect(made.status, made.stderr).toBe(0)
      expect(made.stdout).toContain(`Saved a new held-out key to ${out}`)
      const text = readFileSync(out, 'utf8')
      const identity = text.trim().split('\n').at(-1)!
      expect(identity).toMatch(/^AGE-SECRET-KEY-1/)
      expect(made.stdout + made.stderr).not.toContain(identity)
      expect(made.stdout + made.stderr).not.toMatch(/AGE-SECRET-KEY/)
      expect(statSync(out).mode & 0o777).toBe(0o600)
      expect(await readHeldOutKey({ HEED_HELDOUT_KEY_FILE: out })).toBe(identity)
      const again = cli(['keygen', '--out', out], cleanEnv())
      expect(again.status).toBe(1)
      expect(again.stderr).toMatch(/exists already; it is never overwritten/)
    },
  )

  it('keygen refuses a place in a repository where git could commit the key', async () => {
    const repo = mkdtempSync(join(dir, 'repo-'))
    spawnSync('git', ['-C', repo, 'init', '-q'])
    await expect(keygen(join(repo, 'held-out.key'))).rejects.toThrow(/could be committed/)
    writeFileSync(join(repo, '.gitignore'), '*.key\n')
    expect(await keygen(join(repo, 'held-out.key'))).toBe(join(repo, 'held-out.key'))
  })

  it('edit opens the cases in a private file, seals what was saved and removes the file', async () => {
    const identity = await key()
    const sealed = file(await seal(heldText, identity))
    const log = join(dir, 'editor.log')
    const outcome = await editSealed({
      identity,
      file: sealed,
      editor: editorCommand('retitle', log),
      retry: () => Promise.resolve(false),
    })
    expect(outcome).toBe('sealed')
    const text = await unseal(readFileSync(sealed, 'utf8'), identity)
    expect(text).not.toContain(canary)
    expect(text).toContain('EDITED')
    const [buffer, mode, keyed] = readFileSync(log, 'utf8').trim().split(' ')
    expect(mode).toBe('600')
    expect(keyed).toBe('false')
    expect(() => statSync(buffer!)).toThrow()
    expect(
      readdirSync(tmpdir()).some(
        (name) => buffer!.includes(name) && name.startsWith('heed-held-out-'),
      ),
    ).toBe(false)
  })

  it('edit leaves the sealed file as it was when nothing changed or the text does not fit', async () => {
    const identity = await key()
    const before = await seal(heldText, identity)
    const sealed = file(before)
    const log = join(dir, 'editor-2.log')
    expect(
      await editSealed({
        identity,
        file: sealed,
        editor: editorCommand('same', log),
        retry: () => Promise.resolve(false),
      }),
    ).toBe('unchanged')
    const asked: string[][] = []
    expect(
      await editSealed({
        identity,
        file: sealed,
        editor: editorCommand('break', log),
        retry: (problems) => {
          asked.push(problems)
          return Promise.resolve(asked.length < 2)
        },
      }),
    ).toBe('abandoned')
    // Opened again once, then given up: the problem named by place, the file untouched.
    expect(asked).toHaveLength(2)
    expect(asked[0]).toEqual([expect.stringMatching(/Every sealed case is held out/)])
    expect(readFileSync(sealed, 'utf8')).toBe(before)
  })

  it('rotate seals the cases with a new key, which the old one no longer opens', async () => {
    const identity = await key()
    const next = await key()
    const sealed = file(await seal(heldText, identity))
    await expect(rotateSealed({ identity, newIdentity: identity, file: sealed })).rejects.toThrow(
      /is the current key/,
    )
    await rotateSealed({ identity, newIdentity: next, file: sealed })
    expect(await unseal(readFileSync(sealed, 'utf8'), next)).toBe(heldText)
    await expect(unseal(readFileSync(sealed, 'utf8'), identity)).rejects.toThrow()
  })

  it(
    'runs end to end: count, edit and rotate as docs/evaluations.md gives them',
    { timeout: 60_000 },
    async () => {
      const identity = await key()
      const current = await keyFile(identity)
      const sealed = file(await seal(heldText, identity))
      const env = { ...cleanEnv(), HEED_HELDOUT_KEY_FILE: current }
      const counted = cli(['count', '--file', sealed], env)
      expect(counted.stdout.trim()).toBe(countLine(heldText))
      expect(counted.stdout).toMatch(/^2 agent cases \(.*\) are sealed\.$/m)
      expect(cli(['count', '--file', sealed], cleanEnv()).stderr).toMatch(/Give the current key/)
      const absent = cli(['count', '--file', join(dir, 'none.age')], env)
      expect(absent.status).toBe(0)
      expect(absent.stdout).toMatch(/^No held-out cases are sealed: .*none\.age is absent\.$/m)
      const edited = cli(['edit', '--file', sealed], {
        ...env,
        VISUAL: '',
        EDITOR: editorCommand('retitle', join(dir, 'editor-3.log')),
      })
      expect(edited.status, edited.stderr).toBe(0)
      expect(edited.stdout).toMatch(
        /are sealed\.\nCommit only .*, in a pull request that changes nothing under src\//,
      )
      expect(edited.stdout + edited.stderr).not.toContain('EDITED')
      // The editor ran without the key the command was given.
      expect(readFileSync(join(dir, 'editor-3.log'), 'utf8').trim().split(' ')[2]).toBe('false')
      const next = join(dir, 'next.key')
      expect(cli(['keygen', '--out', next], cleanEnv()).status).toBe(0)
      const rotated = cli(['rotate', '--new-key', next, '--file', sealed], env)
      expect(rotated.status, rotated.stderr).toBe(0)
      expect(
        cli(['count', '--file', sealed], { ...cleanEnv(), HEED_HELDOUT_KEY_FILE: next }).status,
      ).toBe(0)
      expect(cli(['count', '--file', sealed], env).stderr).toMatch(/does not open the sealed file/)
    },
  )
})

describe('the whole golden set, with the sealed held-out cases', () => {
  it('passes every check of the golden set, reported by name only', async (context) => {
    const unavailable = heldOutUnavailable()
    if (unavailable) context.skip(unavailable)
    const result = await checkHeldOut(visible, goldenSetChecks)
    expect(result).toEqual({ ran: true, failed: [] })
  })
})
