import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs, parseEnv } from 'node:util'
import { generateIdentity, identityToRecipient } from 'age-encryption'
import { judgingWords, passRules, type PassRule } from '../src/domain/golden-question.ts'
import {
  formatHeldOut,
  heldOutProblems,
  HeldOutError,
  identityFrom,
  keyVariables,
  noSealedCases,
  parseHeldOut,
  readHeldOutKey,
  seal,
  sealedFile,
  unseal,
} from '../db/seed/held-out.ts'

/*
  `npm run held-out -- <command>`: the key holder's tools for the sealed held-out cases
  (db/seed/held-out.ts, FR-525). Only the key holder runs them, in their own terminal, never a
  coding agent: nothing here prints the key, and only `edit` shows the cases, in the holder's own
  editor.

    keygen [--out <file>]     makes a new key and saves it (default ~/.heed/held-out.key); it says
                              where, and never prints the key
    edit                      opens the cases in your editor ($VISUAL or $EDITOR) from a private
                              temporary file, checks them, seals them again and removes the file
    rotate --new-key <file>   seals the cases with another key, made by keygen
    count                     how many cases are sealed, by type (none while the file is absent)
    eval --area <id> [--real --max-cost-usd <dollars>] [--pass-rule majority|all]
                              runs the area's held-out agent cases through the eval area runner,
                              in memory, and prints counts by type only: no case, answer or
                              transcript is shown or kept (the run records its calls and cost)

  `edit`, `rotate`, `count` and `eval` take the current key from HEED_HELDOUT_KEY_FILE (or
  HEED_HELDOUT_KEY), set for that command only. `--file` names another sealed file (for tests).
  `eval` reads the database and the model keys as `npm run eval` does (.env.local, then the
  environment), but never the held-out key from .env.local: that comes from the command only. It
  uses the scripted mock model unless `--real`, which needs a cost ceiling at or above the
  estimate, shown first. While no sealed file exists, `eval` says that the held-out cases did not
  run and fails nothing; `edit` starts the first one.
*/

const usage =
  'Usage: npm run held-out -- keygen [--out <file>] | edit | rotate --new-key <file> | count | eval --area <id> [--real --max-cost-usd <dollars>] [--pass-rule majority|all]  [--file <sealed file>]'

/** Where keygen saves a key unless told otherwise: outside every repository. */
export const defaultKeyFile = () => join(homedir(), '.heed', 'held-out.key')

const emptySet = `# The held-out cases: agent cases under cases, assistant cases under assistant, each with
# split: held_out. The format is the golden set's (src/domain/golden-set.ts).
cases: []
assistant: []
`

/** Whether git could commit the file: it is in a work tree and not ignored there. */
const committable = (file: string) =>
  spawnSync('git', ['-C', dirname(file), 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
  }).stdout?.trim() === 'true' &&
  spawnSync('git', ['-C', dirname(file), 'check-ignore', '-q', file]).status !== 0

/** Makes a key and saves it, readable by its owner only. Returns the file; never the key. */
export async function keygen(out: string): Promise<string> {
  const file = resolve(out)
  await mkdir(dirname(file), { recursive: true, mode: 0o700 })
  if (committable(file))
    throw new HeldOutError(
      `${file} is in a git repository and not ignored, so it could be committed`,
    )
  const identity = await generateIdentity()
  const recipient = await identityToRecipient(identity)
  const text = `# Heed held-out key (age), created ${new Date().toISOString()}\n# public key: ${recipient}\n${identity}\n`
  try {
    await writeFile(file, text, { mode: 0o600, flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new HeldOutError(`${file} exists already; it is never overwritten`)
    throw error
  }
  return file
}

/** Counts by type, as `count` prints them. */
export function countLine(text: string): string {
  const set = parseHeldOut(text)
  const byType = (cases: { type: string }[]) => {
    const counts = new Map<string, number>()
    for (const c of cases) counts.set(c.type, (counts.get(c.type) ?? 0) + 1)
    return [...counts]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, n]) => `${type} ${n}`)
      .join(', ')
  }
  return `${set.cases.length} agent cases (${byType(set.cases)}) and ${set.assistant.length} assistant cases (${byType(set.assistant)}) are sealed.`
}

export type EditOutcome = 'unchanged' | 'sealed' | 'abandoned'

/**
 * Opens the sealed cases in `editor` from a private temporary file, then seals what it saved.
 * While the text does not fit the format, `retry` decides whether to open it again; the
 * temporary file is removed in every case.
 */
export async function editSealed(options: {
  identity: string
  file: string
  editor: string
  retry: (problems: string[]) => Promise<boolean>
}): Promise<EditOutcome> {
  const before = existsSync(options.file)
    ? await unseal(readFileSync(options.file, 'utf8'), options.identity)
    : emptySet
  const dir = await mkdtemp(join(tmpdir(), 'heed-held-out-'))
  const buffer = join(dir, 'held-out.yml')
  // Stopped from the terminal, it still removes the decrypted file, then stops as asked.
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const stop = (signal: NodeJS.Signals) => {
    rmSync(dir, { recursive: true, force: true })
    for (const s of signals) process.removeListener(s, stop)
    process.kill(process.pid, signal)
  }
  for (const s of signals) process.once(s, stop)
  try {
    await writeFile(buffer, before, { mode: 0o600 })
    for (;;) {
      // The editor and whatever it starts never get the key.
      const env = { ...process.env }
      for (const name of keyVariables) delete env[name]
      const opened = spawnSync(`${options.editor} "${buffer}"`, {
        shell: true,
        stdio: 'inherit',
        env,
      })
      if (opened.status !== 0) throw new HeldOutError(`The editor (${options.editor}) failed`)
      const after = await readFile(buffer, 'utf8')
      if (after === before) return 'unchanged'
      const problems = heldOutProblems(after)
      if (!problems.length) {
        await writeFile(options.file, await seal(after, options.identity))
        return 'sealed'
      }
      if (!(await options.retry(problems))) return 'abandoned'
    }
  } finally {
    for (const s of signals) process.removeListener(s, stop)
    await rm(dir, { recursive: true, force: true })
  }
}

/** Seals the cases with another key. */
export async function rotateSealed(options: {
  identity: string
  newIdentity: string
  file: string
}): Promise<void> {
  if (options.identity === options.newIdentity)
    throw new HeldOutError('The new key is the current key')
  if (!existsSync(options.file)) throw new HeldOutError('There is no sealed file to seal again')
  const text = await unseal(readFileSync(options.file, 'utf8'), options.identity)
  await writeFile(options.file, await seal(text, options.newIdentity))
}

async function ask(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  try {
    return !/^n/i.test((await rl.question(question)).trim())
  } finally {
    rl.close()
  }
}

async function currentKey(): Promise<string> {
  const identity = await readHeldOutKey()
  if (!identity)
    throw new HeldOutError(
      'Give the current key for this command only: HEED_HELDOUT_KEY_FILE=<key file> npm run held-out -- ...',
    )
  return identity
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`

/**
 * The service's settings for `eval`: .env.local where it exists, then the environment, as
 * `npm run eval` reads them. A held-out key in .env.local is left out: it only ever comes from
 * the command's own environment.
 */
function evalEnvironment(real: boolean): Record<string, string | undefined> {
  const local = existsSync('.env.local') ? parseEnv(readFileSync('.env.local', 'utf8')) : {}
  for (const name of keyVariables) Reflect.deleteProperty(local, name)
  return { ...local, ...process.env, MODELS: real ? 'live' : 'mock' }
}

/** `eval`: the area's held-out agent cases through the eval area runner, counts only. */
async function evalArea(options: {
  area: string
  real: boolean
  ceiling: string | undefined
  rule: PassRule
  file: string
}): Promise<number> {
  // Loaded here only: keygen, edit, rotate and count start without the database and model code.
  const [
    { heldOutArea, planHeldOutArea },
    { systemClock },
    { ConfigError, loadConfig },
    { createDatabase },
    { modelsFor, readEvalSettings },
    { checkModelSettings, createModelPort, ModelConfigError, readModelSettings, startCreditsCheck },
    { createLogger },
  ] = await Promise.all([
    import('../db/seed/held-out-runs.ts'),
    import('../src/server/clock.ts'),
    import('../src/server/config/env.ts'),
    import('../src/server/db/database.ts'),
    import('../src/server/modules/evals/index.ts'),
    import('../src/server/modules/models/index.ts'),
    import('../src/server/observability/logger.ts'),
  ])
  let config
  try {
    config = loadConfig(evalEnvironment(options.real))
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    return 1
  }
  const database = createDatabase(config.databaseUrl, createLogger({ level: 'silent' }))
  const controller = new AbortController()
  const interrupt = () => controller.abort(new Error('Stopped from the command line'))
  process.once('SIGINT', interrupt)
  try {
    const deps = {
      port: createModelPort({ mode: config.models, env: config.modelEnv }),
      clock: systemClock(config.fixedToday),
    }
    let recipients, providers
    try {
      checkModelSettings(deps.port, await readModelSettings(database))
      const models = modelsFor(deps.port, await readEvalSettings(database))
      recipients = [...new Set([models.answer.recipients, models.judge.recipients])].join('; ')
      providers = [models.answer.provider, models.judge.provider]
    } catch (error) {
      if (!(error instanceof ModelConfigError)) throw error
      console.error(error.message)
      return 1
    }
    const plan = await planHeldOutArea(database, deps, options.area, process.env, options.file)
    if (!plan.ran) {
      console.log(`Held-out area cases (${options.area}): not run. ${plan.reason}`)
      // No sealed file is a state, not a failure; a missing key is the key holder's mistake.
      return plan.reason === noSealedCases ? 0 : 1
    }
    console.log(
      `Held-out area ${options.area}, edition ${plan.edition ?? 'none'}: ${plan.cases} agent cases, ` +
        `${plan.runnable} of them in the test question format. Estimated cost ${usd(plan.estimate)}.`,
    )
    if (!plan.edition) {
      console.error('There is no live edition yet.')
      return 1
    }
    const ceiling =
      options.ceiling === undefined ? null : Math.round(Number(options.ceiling) * 1_000_000)
    if (ceiling !== null && !(ceiling >= 0)) {
      console.error(usage)
      return 2
    }
    if (options.real && !(ceiling !== null && ceiling >= plan.estimate)) {
      console.error(
        `A real-model run sends the held-out cases out of the company to ${recipients} and costs money. Run again with --max-cost-usd ${(plan.estimate / 1_000_000).toFixed(2)} or more.`,
      )
      return 1
    }
    const credits = options.real ? await startCreditsCheck(deps.port, database, providers) : null
    const run = await heldOutArea(
      database,
      deps,
      {
        area: options.area,
        person: null,
        ceilingMicros: ceiling,
        passRule: options.rule,
        signal: controller.signal,
      },
      process.env,
      options.file,
    )
    console.log(formatHeldOut(`area cases (${options.area})`, run))
    if (run.runId) {
      console.log(judgingWords(run.judging, 'answers'))
      console.log(
        `Run ${run.runId} (recorded without their words): ${run.state}${run.stopped ? ` (${run.stopped})` : ''}. Cost ${usd(run.costMicros)}${ceiling !== null ? ` of a ${usd(ceiling)} ceiling` : ''}.`,
      )
    }
    for (const line of (await credits?.finish(run.runId ? [run.runId] : [])) ?? [])
      console.log(line)
    // 0: every case ran and passed; 2: the run stopped before every answer was made; 1: otherwise.
    if (run.state === 'incomplete') return 2
    return run.ran && run.counts.failed === 0 && run.counts.skipped === 0 ? 0 : 1
  } finally {
    process.off('SIGINT', interrupt)
    await database.close()
  }
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      'new-key': { type: 'string' },
      file: { type: 'string' },
      area: { type: 'string' },
      real: { type: 'boolean', default: false },
      'max-cost-usd': { type: 'string' },
      'pass-rule': { type: 'string' },
    },
  })
  const file = values.file ? resolve(values.file) : fileURLToPath(sealedFile)
  const shown = values.file ?? 'db/seed/golden-held-out.age'
  const commit = `Commit only ${shown}, in a pull request that changes nothing under src/.`
  switch (positionals.length === 1 ? positionals[0] : undefined) {
    case 'keygen': {
      const saved = await keygen(values.out ?? defaultKeyFile())
      console.log(
        `Saved a new held-out key to ${saved} (readable by you only). The key was not printed.\n` +
          `Give it to one command at a time: HEED_HELDOUT_KEY_FILE=${saved} npm run held-out -- count\n` +
          "Never put it in a shell profile, a .env file, CI or a coding agent's environment.",
      )
      return 0
    }
    case 'edit': {
      const identity = await currentKey()
      const outcome = await editSealed({
        identity,
        file,
        editor: process.env.VISUAL || process.env.EDITOR || 'vi',
        retry: async (problems) => {
          console.error(`The cases do not fit the format:\n  ${problems.join('\n  ')}`)
          return ask('Open them again to fix this? [Y/n] ')
        },
      })
      if (outcome === 'unchanged') console.log('No change: the sealed file is as it was.')
      else if (outcome === 'abandoned') {
        console.error('Nothing was sealed: the sealed file is as it was.')
        return 1
      } else
        console.log(`${countLine(await unseal(readFileSync(file, 'utf8'), identity))}\n${commit}`)
      return 0
    }
    case 'rotate': {
      if (!values['new-key']) break
      const newIdentity = identityFrom(await readFile(values['new-key'], 'utf8'))
      await rotateSealed({ identity: await currentKey(), newIdentity, file })
      console.log(
        `Sealed ${shown} with the key in ${values['new-key']}: the old key no longer opens it.\n` +
          `Use HEED_HELDOUT_KEY_FILE=${values['new-key']} from now on. ${commit}\n` +
          'Delete the old key once that pull request is merged.',
      )
      return 0
    }
    case 'count':
      console.log(
        existsSync(file)
          ? countLine(await unseal(readFileSync(file, 'utf8'), await currentKey()))
          : `No held-out cases are sealed: ${shown} is absent.`,
      )
      return 0
    case 'eval': {
      const rule = values['pass-rule'] ?? 'majority'
      if (!values.area || !passRules.includes(rule as PassRule)) break
      return evalArea({
        area: values.area,
        real: values.real,
        ceiling: values['max-cost-usd'],
        rule: rule as PassRule,
        file,
      })
    }
  }
  console.error(usage)
  return 2
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = await main()
  } catch (error) {
    if (!(error instanceof HeldOutError)) throw error
    console.error(error.message)
    process.exitCode = 1
  }
}
