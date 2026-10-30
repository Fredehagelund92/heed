import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { armor, Decrypter, Encrypter, identityToRecipient } from 'age-encryption'
import { parse, YAMLParseError } from 'yaml'
import * as z from 'zod/mini'
import { goldenCaseSchema, type GoldenCase, type GoldenSet } from '../../src/domain/golden-set.ts'

/*
  The sealed held-out cases of the golden set (output test plan, "How it stays honest"; FR-525).
  Nobody who changes Heed's prompts, tool descriptions or scoring may read a held-out case, so
  they are not in golden-set.yml: they are in golden-held-out.age, encrypted with age to one key
  that only its holder has. The file is committed; the key never is, and it reaches a command
  only through HEED_HELDOUT_KEY (the key itself) or HEED_HELDOUT_KEY_FILE (a file holding it),
  set for that one command. Nothing here looks for a key anywhere else.

  There are no sealed cases at present: the file is absent until the key holder seals fresh cases
  with a new key (`npm run held-out -- edit`). Without it, every runner says plainly that the
  held-out cases did not run, counts none and fails nothing.

  Only the seal's own files open the sealed file (`sealFiles` in scripts/check-held-out-seal.ts,
  which fails a change that opens it anywhere else). A runner gets the held-out results from
  held-out-runs.ts, which runs them through runHeldOut, and a whole-set check goes through
  checkHeldOut: both run silenced and give back counts and check names, never a case's words,
  expectations or a transcript.
*/

/** The sealed file, in the repository next to the visible golden set. */
export const sealedFile = new URL('./golden-held-out.age', import.meta.url)

/** What a command reads the key from: the key itself, or a file that holds it. */
export const keyVariables = ['HEED_HELDOUT_KEY', 'HEED_HELDOUT_KEY_FILE'] as const

/** Why the held-out part did not run without a key, as every runner says it. */
export const noKey = `No held-out key was given (${keyVariables.join(' or ')}), so the held-out cases did not run: only the visible ones did.`

/** Why the held-out part did not run without a sealed file, as every runner says it. */
export const noSealedCases =
  'There are no sealed held-out cases (db/seed/golden-held-out.age is absent), so the held-out cases did not run: only the visible ones did.'

/** A held-out failure whose message never quotes a case. */
export class HeldOutError extends Error {
  override name = 'HeldOutError'
}

/** The decrypted file: agent cases, every one held out. */
export const heldOutSetSchema = z
  .strictObject({
    cases: z.array(goldenCaseSchema),
  })
  .check(
    z.refine((s) => s.cases.every((c) => c.split === 'held_out'), {
      message: 'Every sealed case is held out: give it split: held_out',
    }),
  )
export type HeldOutSet = z.infer<typeof heldOutSetSchema>

const identityPattern = /^AGE-SECRET-KEY-(?:PQ-)?1[02-9AC-HJ-NP-Z]+$/

/** Whether this command was given a key, without reading it. */
export const heldOutKeyGiven = (env: NodeJS.ProcessEnv = process.env) =>
  keyVariables.some((name) => Boolean(env[name]))

/**
 * Why the held-out cases cannot run here, without reading the key or the file: there is no
 * sealed file, or no key was given. Null when both are there.
 */
export function heldOutUnavailable(
  env: NodeJS.ProcessEnv = process.env,
  file: URL | string = sealedFile,
): string | null {
  if (!existsSync(file)) return noSealedCases
  return heldOutKeyGiven(env) ? null : noKey
}

/**
 * The age identity from a key file's text: the one line that is not a comment, as age-keygen
 * and `npm run held-out -- keygen` write it.
 */
export function identityFrom(text: string): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
  if (lines.length !== 1 || !identityPattern.test(lines[0]!))
    throw new HeldOutError('The held-out key is not an age secret key (AGE-SECRET-KEY-1...)')
  return lines[0]!
}

/** The key this command was given, or null. Never echoes what it read. */
export async function readHeldOutKey(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const [inline, file] = keyVariables.map((name) => env[name] || undefined)
  if (inline && file) throw new HeldOutError(`Set ${keyVariables.join(' or ')}, not both`)
  if (inline) return identityFrom(inline)
  if (!file) return null
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new HeldOutError(`HEED_HELDOUT_KEY_FILE names no readable file: ${file}`)
  }
  return identityFrom(text)
}

/** The decrypted text of a sealed file. */
export async function unseal(armored: string, identity: string): Promise<string> {
  const decrypter = new Decrypter()
  decrypter.addIdentity(identity)
  try {
    return await decrypter.decrypt(armor.decode(armored), 'text')
  } catch (error) {
    throw new HeldOutError(
      `The key does not open the sealed file (${error instanceof Error ? error.message : 'unreadable'})`,
    )
  }
}

/** Where a text fails the held-out format: paths and rules only, never the values. */
export function heldOutProblems(text: string): string[] {
  let value: unknown
  try {
    value = parse(text)
  } catch (error) {
    const line = error instanceof YAMLParseError ? error.linePos?.[0]?.line : undefined
    return [`Not valid YAML${line ? ` at line ${line}` : ''}`]
  }
  const parsed = heldOutSetSchema.safeParse(value)
  return parsed.success
    ? []
    : parsed.error.issues.map((i) => `${i.path.join('.') || '(top)'}: ${i.message}`)
}

/** The cases a decrypted text holds, checked against the format. */
export function parseHeldOut(text: string): HeldOutSet {
  const problems = heldOutProblems(text)
  if (problems.length)
    throw new HeldOutError(`The sealed file does not fit the format: ${problems.join('; ')}`)
  return heldOutSetSchema.parse(parse(text))
}

/** A text of held-out cases, checked and encrypted to the key, as the armored file holds it. */
export async function seal(text: string, identity: string): Promise<string> {
  parseHeldOut(text)
  const encrypter = new Encrypter()
  encrypter.addRecipient(await identityToRecipient(identity))
  return armor.encode(await encrypter.encrypt(text))
}

/**
 * The key that opens the sealed file, or why the held-out cases do not run: there is no sealed
 * file, or no key was given.
 */
export async function openingKey(
  env: NodeJS.ProcessEnv = process.env,
  file: URL | string = sealedFile,
): Promise<{ ran: true; identity: string } | { ran: false; reason: string }> {
  const reason = heldOutUnavailable(env, file)
  return reason ? { ran: false, reason } : { ran: true, identity: (await readHeldOutKey(env))! }
}

/** The sealed cases, opened with the key. */
export async function readHeldOut(identity: string, file: URL | string = sealedFile) {
  return parseHeldOut(await unseal(readFileSync(file, 'utf8'), identity))
}

/** The whole golden set: the visible cases and the held-out ones. An id is used once. */
export function withHeldOut(visible: GoldenSet, held: HeldOutSet): GoldenSet {
  const ids = [...visible.cases, ...held.cases].map((c) => c.id)
  if (new Set(ids).size !== ids.length)
    throw new HeldOutError('A held-out case has the id of another case')
  return {
    ...visible,
    cases: [...visible.cases, ...held.cases],
  }
}

/** Puts back what a property was: its own value, or none, so its prototype's shows again. */
function restore(target: object, key: string, own: PropertyDescriptor | undefined) {
  if (own) Object.defineProperty(target, key, own)
  else Reflect.deleteProperty(target, key)
}

/**
 * Runs `work` with nothing printed: console and both standard streams are muted, so code given a
 * held-out case cannot show it, and a failure is reported by its kind alone.
 */
async function silenced<T>(work: () => Promise<T>): Promise<T> {
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table'] as const
  const streams = [process.stdout, process.stderr]
  const saved = methods.map((m) => Object.getOwnPropertyDescriptor(console, m))
  const writes = streams.map((stream) => Object.getOwnPropertyDescriptor(stream, 'write'))
  for (const m of methods) console[m] = () => {}
  for (const stream of streams) stream.write = () => true
  try {
    return await work()
  } catch (error) {
    throw new HeldOutError(
      `The held-out run failed with ${error instanceof Error ? error.name : 'an error'}; its message is withheld, as it could quote a held-out case.`,
    )
  } finally {
    methods.forEach((m, i) => restore(console, m, saved[i]))
    streams.forEach((stream, i) => restore(stream, 'write', writes[i]))
  }
}

export type Tally = { passed: number; failed: number; skipped: number }
export type HeldOutCounts = Tally & { byType: Record<string, Tally> }
/** What a held-out run gives back: counts by type, or why it did not run. */
export type HeldOutRun = { ran: false; reason: string } | { ran: true; counts: HeldOutCounts }

/** One case's result as a runner has it; a case it gives nothing for counts as skipped. */
export type HeldOutResult = { id: string; passed: boolean | null }

/**
 * Runs the held-out cases `pick` chooses through `run`, silenced, and counts the results by type.
 * Without a key it runs nothing and says why.
 */
export async function runHeldOut<C extends GoldenCase>(
  pick: (held: HeldOutSet) => readonly C[],
  run: (cases: readonly C[]) => Promise<readonly HeldOutResult[]>,
  env: NodeJS.ProcessEnv = process.env,
  file: URL | string = sealedFile,
): Promise<HeldOutRun> {
  const opened = await openingKey(env, file)
  if (!opened.ran) return opened
  const cases = pick(await readHeldOut(opened.identity, file))
  const results = new Map((await silenced(() => run(cases))).map((r) => [r.id, r.passed]))
  const counts: HeldOutCounts = { passed: 0, failed: 0, skipped: 0, byType: {} }
  for (const c of cases) {
    const passed = results.get(c.id)
    const outcome = passed === true ? 'passed' : passed === false ? 'failed' : 'skipped'
    const tally = (counts.byType[c.type] ??= { passed: 0, failed: 0, skipped: 0 })
    tally[outcome]++
    counts[outcome]++
  }
  return { ran: true, counts }
}

/** What held-out checks give back: the names of the checks that failed, or why none ran. */
export type HeldOutChecks = { ran: false; reason: string } | { ran: true; failed: string[] }

/**
 * Runs each named check on the whole golden set (the visible cases and the held-out ones),
 * silenced. A check throws to fail; only its name comes back.
 */
export async function checkHeldOut(
  visible: GoldenSet,
  checks: Record<string, (whole: GoldenSet) => void>,
  env: NodeJS.ProcessEnv = process.env,
  file: URL | string = sealedFile,
): Promise<HeldOutChecks> {
  const opened = await openingKey(env, file)
  if (!opened.ran) return opened
  const whole = withHeldOut(visible, await readHeldOut(opened.identity, file))
  const failed = await silenced(() =>
    Promise.resolve(
      Object.entries(checks).flatMap(([name, check]) => {
        try {
          check(whole)
          return []
        } catch {
          return [name]
        }
      }),
    ),
  )
  return { ran: true, failed }
}

const tally = (t: Tally) =>
  [`${t.passed} passed`, `${t.failed} failed`, ...(t.skipped ? [`${t.skipped} skipped`] : [])].join(
    ', ',
  )

/** A held-out run in one line: totals, then by type. Counts only. */
export function formatHeldOut(label: string, run: HeldOutRun): string {
  if (!run.ran) return `Held-out ${label}: not run. ${run.reason}`
  const { counts } = run
  const types = Object.entries(counts.byType)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, t]) => `${type} ${tally(t)}`)
    .join('; ')
  return `Held-out ${label}: ${tally(counts)} of ${counts.passed + counts.failed + counts.skipped} (${types}).`
}
