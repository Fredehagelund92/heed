import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateIdentity } from 'age-encryption'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { stringify } from 'yaml'
import { loadGoldenSet } from '../../db/seed/golden-set.ts'
import { formatHeldOut, seal } from '../../db/seed/held-out.ts'
import {
  heldOutArea,
  heldOutAssistant,
  planHeldOutArea,
  planHeldOutAssistant,
} from '../../db/seed/held-out-runs.ts'
import { systemClock } from '../../src/server/clock.ts'
import { createModelPort } from '../../src/server/modules/models/index.ts'
import { createLogger } from '../../src/server/observability/logger.ts'
import { apiDatabase, testDatabase } from './support.ts'

/*
  Held-out runs (FR-525) through the real runners and database, with the scripted mock model and a
  throwaway key made here. The assistant run and the eval area run count their cases by type and
  keep none of their words: no turn, answer, problem, verdict, cell or transcript, ids that say
  nothing, and no line of output.
*/

const { client, url } = testDatabase({ seeded: true })
const database = apiDatabase(url)
const dir = mkdtempSync(join(tmpdir(), 'heed-held-out-run-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const canary = 'CANARY9C2E'
const golden = loadGoldenSet()
// A visible case that names no item, so it runs on the demo library, made held out.
const source = golden.assistant.find(
  (c) => c.turns.length === 1 && !c.turns[0]!.expect.cites && !/\bitm_/.test(c.turns[0]!.say),
)!
const held = {
  ...source,
  id: 'test-held-out-run',
  split: 'held_out' as const,
  turns: source.turns.map((t) => ({ ...t, say: `${t.say} ${canary}` })),
}
// Agent cases of one area, made held out, with the canary in every text: one the eval runner
// asks, and a conversation, which is the assistant runner's, so it is skipped.
const area = 'area_commercial'
const marked = (id: string, from: string) => {
  const c = golden.cases.find((g) => g.id === from)!
  return {
    ...c,
    id,
    area,
    split: 'held_out' as const,
    wordings: c.wordings.map((w) => ({ ...w, text: `${w.text} ${canary}` })),
    answer: { ...c.answer, caveat: `${c.answer.caveat ?? 'No caveat'} ${canary}` },
    rubrics: [...c.rubrics, `Says "${canary}"`],
    source: `${c.source} ${canary}`,
    notes: canary,
    ...(c.turns ? { turns: c.turns.map((t) => ({ ...t, text: `${t.text} ${canary}` })) } : {}),
  }
}
const agentCases = [
  marked('test-held-out-area', 'gs-baseline-orders-united-kingdom'),
  marked('test-held-out-talk', 'gs-conversation-orders-and-spain'),
]
let areaFile: string
let env: NodeJS.ProcessEnv
let file: string
let person: string

beforeAll(async () => {
  const identity = await generateIdentity()
  env = { HEED_HELDOUT_KEY: identity }
  file = join(dir, 'golden-held-out.age')
  writeFileSync(file, await seal(stringify({ cases: [], assistant: [held] }), identity))
  areaFile = join(dir, 'golden-held-out-area.age')
  writeFileSync(areaFile, await seal(stringify({ cases: agentCases, assistant: [] }), identity))
  const [row] = (
    await client.query<{ id: string }>(
      'select id::text from people where deactivated_at is null order by id limit 1',
    )
  ).rows
  person = row!.id
})

it('runs the held-out assistant cases, counts them and keeps none of their words', async () => {
  const deps = {
    database,
    clock: systemClock('2026-10-08'),
    models: createModelPort({ mode: 'mock' }),
  }
  const plan = await planHeldOutAssistant(deps, { personId: person, tries: 1 }, env, file)
  expect(plan).toMatchObject({ ran: true, cases: 1, skipped: 0 })

  const run = await heldOutAssistant(
    {
      ...deps,
      logger: createLogger({ level: 'silent' }),
      approvalSecret: randomBytes(32),
    },
    { personId: person, tries: 1 },
    env,
    file,
  )
  expect(run.ran).toBe(true)
  if (!run.ran) return
  expect(run.counts.passed + run.counts.failed).toBe(1)
  expect(Object.keys(run.counts.byType)).toEqual([held.type])
  expect(formatHeldOut('assistant cases', run)).not.toContain(canary)

  const tries = await client.query<{
    case_id: string
    turns: unknown
    problems: unknown
    verdict: unknown
  }>('select case_id,turns,problems,verdict from assistant_case_tries where run_id=$1', [run.runId])
  expect(tries.rows).toEqual([{ case_id: 'held-out-1', turns: [], problems: [], verdict: null }])
  const [record] = (
    await client.query<{ summary: { heldOut?: boolean }; text: string }>(
      'select summary, row_to_json(r)::text as text from eval_runs r where id=$1',
      [run.runId],
    )
  ).rows
  expect(record!.summary.heldOut).toBe(true)
  for (const text of [record!.text, JSON.stringify(tries.rows)]) {
    expect(text).not.toContain(canary)
    expect(text).not.toContain(held.id)
  }
})

it('runs nothing without the key, and says so', async () => {
  const deps = {
    database,
    clock: systemClock('2026-10-08'),
    models: createModelPort({ mode: 'mock' }),
  }
  expect(await planHeldOutAssistant(deps, { personId: person }, {}, file)).toMatchObject({
    ran: false,
  })
})

/** Every row of every table of the database, as text. */
async function everyRow(): Promise<string> {
  const tables = await client.query<{ name: string }>(
    `select format('%I.%I', table_schema, table_name) as name from information_schema.tables
      where table_schema not in ('pg_catalog','information_schema') and table_type='BASE TABLE'`,
  )
  const texts: string[] = []
  for (const { name } of tables.rows) {
    const rows = await client.query<{ t: string | null }>(
      `select string_agg(x::text, ' ') as t from ${name} x`,
    )
    texts.push(rows.rows[0]?.t ?? '')
  }
  return texts.join('\n')
}

it('runs the held-out cases of an area through the eval runner, counts them and keeps none of their words', async () => {
  const deps = { port: createModelPort({ mode: 'mock' }), clock: systemClock('2026-10-08') }
  expect(await planHeldOutArea(database, deps, area, env, areaFile)).toMatchObject({
    ran: true,
    cases: 2,
    runnable: 1,
  })
  const run = await heldOutArea(
    database,
    deps,
    { area, person: null, ceilingMicros: null, signal: new AbortController().signal },
    env,
    areaFile,
  )
  expect(run.ran).toBe(true)
  if (!run.ran) return
  // The baseline case ran (its planted rubric fails it); the conversation was skipped.
  expect(run.counts).toMatchObject({ passed: 0, failed: 1, skipped: 1 })
  expect(Object.keys(run.counts.byType).sort()).toEqual(['baseline', 'conversation'])
  expect(run.state).toBe('finished')
  expect(run.judging.judged).toBeGreaterThan(0)
  const line = formatHeldOut(`area cases (${area})`, run)
  expect(line).toBe(
    `Held-out area cases (${area}): 0 passed, 1 failed, 1 skipped of 2 (baseline 0 passed, 1 failed; conversation 0 passed, 0 failed, 1 skipped).`,
  )
  const [record] = (
    await client.query<{ kind: string; area_id: string | null; cells: number }>(
      `select kind::text,area_id,(select count(*)::int from eval_cells where run_id=r.id) as cells
         from eval_runs r where id=$1`,
      [run.runId],
    )
  ).rows
  expect(record).toEqual({ kind: 'held_out', area_id: null, cells: 0 })
  const rows = await everyRow()
  for (const word of [canary, 'test-held-out-area', 'test-held-out-talk'])
    expect(rows).not.toContain(word)
})

it('runs nothing for an area without the key, and says so', async () => {
  const deps = { port: createModelPort({ mode: 'mock' }), clock: systemClock('2026-10-08') }
  expect(await planHeldOutArea(database, deps, area, {}, areaFile)).toMatchObject({ ran: false })
  const run = await heldOutArea(
    database,
    deps,
    { area, person: null, ceilingMicros: null, signal: new AbortController().signal },
    {},
    areaFile,
  )
  expect(run).toMatchObject({ ran: false, runId: null })
})

/** The same, without a database either: the command must find it in .env.local. */
const withoutDatabase = () => {
  const own = withoutKey()
  delete own.DATABASE_URL
  return own
}
/** The environment of this process without a held-out key. */
const withoutKey = () => {
  const own = { ...process.env }
  delete own.HEED_HELDOUT_KEY
  delete own.HEED_HELDOUT_KEY_FILE
  return own
}

it("prints counts by type only from the key holder's command (npm run held-out -- eval)", () => {
  const keyLine = `HEED_HELDOUT_KEY=${env.HEED_HELDOUT_KEY!}`
  const command = (key: NodeJS.ProcessEnv) =>
    spawnSync(
      process.execPath,
      ['scripts/held-out.ts', 'eval', '--area', area, '--file', areaFile],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          ...key,
          DATABASE_URL: url,
          CL_FIXED_TODAY: '2026-10-08',
          LOG_LEVEL: 'silent',
        },
        timeout: 240_000,
      },
    )
  const ran = command(env)
  expect(ran.stderr).toBe('')
  expect(ran.stdout).toMatch(
    new RegExp(
      `^Held-out area ${area}, edition \\S+: 2 agent cases, 1 of them in the test question format\\. Estimated cost \\$0\\.00\\.$`,
      'm',
    ),
  )
  expect(ran.stdout).toMatch(
    /^Held-out area cases \(area_commercial\): 0 passed, 1 failed, 1 skipped of 2 /m,
  )
  expect(ran.stdout).toMatch(/^Judge errors: 0 of \d+ judged answers \(0\.0%\)\.$/m)
  expect(ran.stdout).toMatch(
    /^Run [0-9a-f-]{36} \(recorded without their words\): finished\. Cost \$0\.00\.$/m,
  )
  for (const word of [canary, 'test-held-out-area'])
    expect(ran.stdout + ran.stderr).not.toContain(word)
  // A failed or skipped case is not a clean run.
  expect(ran.status).toBe(1)
  // The database may come from .env.local, as for npm run eval; the held-out key never does.
  const local = mkdtempSync(join(dir, 'cwd-'))
  writeFileSync(join(local, '.env.local'), `DATABASE_URL=${url}\n${keyLine}\n`)
  const fromFile = spawnSync(
    process.execPath,
    [join(process.cwd(), 'scripts/held-out.ts'), 'eval', '--area', area, '--file', areaFile],
    {
      encoding: 'utf8',
      cwd: local,
      env: { ...withoutDatabase(), CL_FIXED_TODAY: '2026-10-08', LOG_LEVEL: 'silent' },
      timeout: 240_000,
    },
  )
  expect(fromFile.stdout).toMatch(
    /^Held-out area cases \(area_commercial\): not run\. No held-out key was given/m,
  )
  const none = command({ HEED_HELDOUT_KEY: '', HEED_HELDOUT_KEY_FILE: '' })
  expect(none.stdout).toMatch(
    /^Held-out area cases \(area_commercial\): not run\. No held-out key was given/m,
  )
  expect(none.status).toBe(1)
  // No sealed file is a state, not a failure: the command says the cases did not run.
  const absent = spawnSync(
    process.execPath,
    ['scripts/held-out.ts', 'eval', '--area', area, '--file', join(dir, 'none.age')],
    {
      encoding: 'utf8',
      env: { ...process.env, ...env, DATABASE_URL: url, LOG_LEVEL: 'silent' },
      timeout: 240_000,
    },
  )
  expect(absent.stdout).toMatch(
    /^Held-out area cases \(area_commercial\): not run\. There are no sealed held-out cases/m,
  )
  expect(absent.status).toBe(0)
}, 300_000)
