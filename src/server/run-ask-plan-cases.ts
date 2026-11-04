import { parseArgs } from 'node:util'
import { checkWords, wordsSystem } from '../domain/answer-words.ts'
import { parsePlan } from '../domain/ask-plan.ts'
import { plannerInputOf, type Planner } from '../domain/ask-route.ts'
import { ConfigError, loadConfig } from './config/env.ts'
import { writeFile } from 'node:fs/promises'
import { createDatabase } from './db/database.ts'
import {
  askForPlan,
  askForWords,
  classOf,
  engineDigest,
  GATE_BUDGETS,
  gatePasses,
  plannerDigest,
  PLAN_MAX_TOKENS,
  PLAN_TODAY,
  planAreas,
  planBundle,
  planCases,
  planProblems,
  readWordsModel,
  recordedPlansFile,
  runPlanCases,
  scoreRun,
  scriptedPlan,
  stewardCases,
  wordsInputOf,
  type PlanCase,
  type PlanOutcome,
} from './modules/answer/index.ts'
import {
  checkModelSettings,
  conversationRetry,
  costMicros,
  createCallMeter,
  createModelPort,
  ModelConfigError,
  readModelSettings,
  type MeteredCall,
  type ModelChoice,
} from './modules/models/index.ts'
import { createLogger } from './observability/logger.ts'

/**
 * `npm run eval:ask-plan`: the planner cases (FR-710, FR-719), with the scripted planner. `--real`
 * runs them with the provider and model of `models.assistant` instead, and asks it for the words
 * of each planned answer too, as Ask would: that sends the cases' made-up questions and items to
 * that provider and costs money, so it needs the provider's key in .env.local and
 * `--max-cost-usd` at or above the estimate, shown first, and records the spend in the ledger as
 * an evaluation's. It reports each case, how many were read the way they should be, the planner's
 * time (p50 and p90), and what the planner and the words cost per planned question. Mock and real
 * runs print which they were, so their results are reported apart. `--case <id>` runs some cases
 * only (with the cases they follow). `--gate` scores the run against the release gate of Ask's
 * promises (FR-720), and with `--real` asks each case three times, seven when it flips, the
 * majority deciding; `--record` keeps the plans of a real run for every build to replay.
 */

const usage =
  'Usage: npm run eval:ask-plan -- [--case <id>]... [--gate] [--real --max-cost-usd <dollars> [--record]]'
const { values } = parseArgs({
  options: {
    case: { type: 'string', multiple: true },
    real: { type: 'boolean', default: false },
    gate: { type: 'boolean', default: false },
    record: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
  },
})
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`
/** A call's cost is a few hundred micro-dollars: said as micro-dollars. */
const micro = (micros: number) => `${Math.round(micros)} micro-dollars`
const tokens = (text: string) => Math.ceil(text.length / 4)
const percentile = (sorted: readonly number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]! : 0

async function main() {
  const cases = [...planCases, ...stewardCases].filter(
    (c) => !values.case?.length || values.case.includes(c.id),
  )
  if (!cases.length) {
    console.error(`No case matches. ${usage}`)
    return 2
  }
  if (!values.real) {
    console.log(`Ask's planner, ${cases.length} cases, with the scripted planner.`)
    const got = await runPlanCases(cases, scriptedPlan)
    const code = report(cases, got, null)
    return values.gate ? gate(cases, [got], null, 'scripted') : code
  }
  let config
  try {
    config = loadConfig({ ...process.env, MODELS: 'live' })
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    return 1
  }
  const database = createDatabase(config.databaseUrl, createLogger({ level: 'warn' }))
  try {
    const models = createModelPort({ mode: config.models, env: config.modelEnv })
    let choice: ModelChoice
    try {
      checkModelSettings(models, await readModelSettings(database))
      choice = await readWordsModel(database, models)
    } catch (error) {
      if (!(error instanceof ModelConfigError)) throw error
      console.error(error.message)
      return 1
    }
    const bundle = { ...planBundle, areas: planAreas }
    // Every planner call, and the words of each planned answer: at most the output limits.
    const tries = values.gate ? 3 : 1
    const estimate =
      tries *
      cases.reduce((sum, c) => {
        const input = plannerInputOf(bundle, c.question, [], PLAN_TODAY)
        const plan = costMicros(choice.prices, {
          inputTokens: tokens(input.system) + tokens(input.vocabulary) + tokens(input.prompt),
          outputTokens: PLAN_MAX_TOKENS,
          cacheReadTokens: 0,
        })
        const words = costMicros(choice.prices, {
          inputTokens: tokens(wordsSystem) + 700,
          outputTokens: 400,
          cacheReadTokens: 0,
        })
        return sum + plan + words
      }, 0)
    const ceiling = Number(values['max-cost-usd'] ?? Number.NaN) * 1_000_000
    console.log(
      `Ask's planner, ${cases.length} cases, with ${choice.id}. Estimated cost ${usd(estimate)}.`,
    )
    if (!(ceiling >= estimate)) {
      console.error(
        `A real-model run sends the cases to ${choice.recipients} and costs money. Run again with --max-cost-usd ${(estimate / 1_000_000).toFixed(2)} or more.`,
      )
      return 1
    }
    const calls: MeteredCall[] = []
    const meter = createCallMeter({
      database,
      feature: 'eval',
      person: null,
      limits: null,
      retry: conversationRetry,
      onCall: (call) => calls.push(call),
    })
    const metered = meter.wrap(choice, { role: 'assistant' })
    const timing: number[] = []
    const planCost: number[] = []
    const planTokens: PlanTokens[] = []
    const plans = new Map<string, string>()
    const planner: Planner = async (input, check) => {
      const at = performance.now()
      const before = calls.length
      const reply = await askForPlan(metered, input).catch((error: unknown) => {
        console.error(`the planner failed (${error instanceof Error ? error.name : 'error'})`)
        return null
      })
      timing.push(performance.now() - at)
      await meter.settled()
      const made = calls.slice(before)
      planCost.push(made.reduce((t, c) => t + c.costMicros, 0))
      planTokens.push({
        input: made.reduce((t, c) => t + c.inputTokens + c.cacheWriteTokens, 0),
        cached: made.reduce((t, c) => t + c.cacheReadTokens, 0),
        output: made.reduce((t, c) => t + c.outputTokens, 0),
      })
      if (!reply) return 'missed'
      plans.set(input.prompt, reply.text)
      const checked = check(parsePlan(reply.text))
      if (!checked.ok) console.log(`\tthe plan failed the check: ${checked.why}`)
      return checked.ok ? checked.plan : 'missed'
    }
    const got = await runPlanCases(cases, planner)
    const runs = [got]
    if (values.gate) {
      runs.push(await runPlanCases(cases, planner), await runPlanCases(cases, planner))
      // A case that flips is asked until seven tries decide.
      const flips = flipped(cases, runs)
      if (flips.length) for (let i = 0; i < 4; i++) runs.push(await runPlanCases(flips, planner))
    }
    if (values.record) {
      const recorded = {
        digest: plannerDigest(choice.id),
        model: choice.id,
        plans: Object.fromEntries(plans),
      }
      await writeFile(recordedPlansFile, `${JSON.stringify(recorded, null, 2)}\n`)
      console.log(`Recorded ${plans.size} plans.`)
    }
    // The words of each planned answer with items, as Ask asks for them, held to Ask's check.
    const wordsCost: number[] = []
    let wordsFailed = 0
    for (const [id, outcome] of got) {
      if (outcome.routed.kind !== 'reads' || !outcome.routed.planned.answer.items.length) continue
      const planned = outcome.routed.planned
      const input = wordsInputOf(cases.find((c) => c.id === id)?.question ?? id, {
        ...planned.answer,
        target: { kind: 'live' },
        reading: planned.reading,
      })
      const before = calls.length
      const reply = await askForWords(metered, input).catch(() => null)
      await meter.settled()
      wordsCost.push(calls.slice(before).reduce((t, c) => t + c.costMicros, 0))
      const checked = reply
        ? checkWords(reply.text, input)
        : { ok: false as const, why: 'no words' }
      if (!checked.ok) wordsFailed++
      console.log(
        `words\t${id}\t${checked.ok ? 'pass' : `FAIL ${checked.why}`}\t${reply?.text.replace(/\s+/g, ' ') ?? ''}`,
      )
    }
    const code = report(cases, got, {
      timing,
      planCost,
      planTokens,
      wordsCost,
      wordsFailed,
      spent: meter.costMicros,
    })
    await meter.settled()
    return values.gate ? gate(cases, runs, { timing, planCost }, choice.id) : code
  } finally {
    await database.close()
  }
}

/** The plan a run read a case as, to compare tries. */
const planOf = (outcome: PlanOutcome) => {
  const r = outcome.routed
  return JSON.stringify(
    r.kind === 'reads'
      ? r.planned.reads.map((read) => read.kind)
      : r.kind === 'records'
        ? r.found.type === 'records'
          ? [r.found.ask.intent, r.found.ask.audit?.facets]
          : 'refused'
        : r.kind === 'reply'
          ? r.reply.kind
          : 'rules',
  )
}

const flipped = (cases: readonly PlanCase[], runs: readonly ReadonlyMap<string, PlanOutcome>[]) =>
  cases.filter((c) => new Set(runs.map((run) => planOf(run.get(c.id)!))).size > 1)

/** The release gate over a run, or over several tries of it, by class. */
function gate(
  cases: readonly PlanCase[],
  runs: readonly ReadonlyMap<string, PlanOutcome>[],
  measured: { timing: number[]; planCost: number[] } | null,
  by: string,
): number {
  // The majority of a case's tries decides.
  const decided = new Map(
    cases.map((c) => {
      const tries = runs.flatMap((run) => run.get(c.id) ?? [])
      const votes = new Map<string, PlanOutcome[]>()
      for (const t of tries) votes.set(planOf(t), [...(votes.get(planOf(t)) ?? []), t])
      const most = [...votes.values()].sort((a, b) => b.length - a.length)[0]!
      return [c.id, most[0]!] as const
    }),
  )
  const score = scoreRun(cases, decided)
  console.log(`\nThe release gate of Ask's promises, on ${by}.`)
  for (const cls of ['R', 'S', 'D', 'A', 'X', 'earlier'] as const) {
    const of = cases.filter((c) => classOf(c) === cls)
    if (!of.length) continue
    const s = scoreRun(of, decided)
    console.log(`${cls}\t${s.read}/${s.cases} read\t${s.complete}/${s.cases} complete`)
  }
  console.log(
    `All\t${score.read}/${score.cases} read (${Math.round((score.read / score.cases) * 100)}%)\t${score.complete}/${score.cases} complete (${Math.round((score.complete / score.cases) * 100)}%)`,
  )
  for (const [rule, ids] of Object.entries(score.zero))
    console.log(`Zero: ${rule}: ${ids.length ? ids.join(', ') : 'none'}`)
  console.log(`get_context digest: ${engineDigest(cases)}`)
  const same = runs.length > 1 ? cases.length - flipped(cases, runs).length : cases.length
  const sameShare = same / cases.length
  console.log(`Same plan on every try: ${same}/${cases.length} (${Math.round(sameShare * 100)}%)`)
  const rules = cases.filter((c) => c.expect.route !== 'planner' && !c.with)
  const calledFor = rules.filter((c) => decided.get(c.id)!.calls > 0)
  console.log(`Rule-read questions: ${rules.length}, ${calledFor.length} called the planner`)
  if (measured) {
    const sorted = [...measured.timing].sort((a, b) => a - b)
    const cost = [...measured.planCost].sort((a, b) => a - b)
    console.log(
      `Planner: p50 ${Math.round(percentile(sorted, 0.5))} ms, p90 ${Math.round(percentile(sorted, 0.9))} ms; ${micro(percentile(cost, 0.5))} p50 a call; budget ${micro(GATE_BUDGETS.R.micros)} for a planned analysis`,
    )
  }
  const passes = gatePasses(score) && sameShare >= 0.9 && !calledFor.length
  console.log(passes ? 'The gate passes.' : 'THE GATE FAILS.')
  return passes ? 0 : 1
}

/** What one planner call used, in tokens: input read in full, read from the cache, and written. */
type PlanTokens = { input: number; cached: number; output: number }

type Measured = {
  timing: number[]
  planCost: number[]
  planTokens: PlanTokens[]
  wordsCost: number[]
  wordsFailed: number
  spent: number
}

function report(
  cases: readonly PlanCase[],
  got: ReadonlyMap<string, PlanOutcome>,
  measured: Measured | null,
): number {
  let failed = 0
  let routed = 0
  for (const c of cases) {
    const outcome = got.get(c.id)!
    const problems = planProblems(c, outcome)
    if (outcome.route === c.expect.route) routed++
    if (problems.length) failed++
    console.log(
      `${problems.length ? 'FAIL' : 'pass'}\t${c.id}\t${problems.join('; ') || outcome.routed.kind}`,
    )
  }
  const share = Math.round((routed / cases.length) * 100)
  console.log(
    `${cases.length - failed} of ${cases.length} cases passed; ${share}% read as they should be.`,
  )
  if (measured) {
    const sorted = [...measured.timing].sort((a, b) => a - b)
    const mean = (xs: readonly number[]) =>
      xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : 0
    console.log(
      `Planner: ${measured.timing.length} calls, p50 ${Math.round(percentile(sorted, 0.5))} ms, p90 ${Math.round(percentile(sorted, 0.9))} ms, ${micro(mean(measured.planCost))} a call.`,
    )
    const used = (part: keyof PlanTokens) =>
      Math.round(mean(measured.planTokens.map((t) => t[part])))
    console.log(
      `Planner tokens a call: ${used('input')} input, ${used('cached')} from the cache, ${used('output')} output.`,
    )
    console.log(
      `Words: ${measured.wordsCost.length} calls, ${measured.wordsFailed} failed the check, ${micro(mean(measured.wordsCost))} a call.`,
    )
    console.log(
      `A planned question: about ${micro(mean(measured.planCost) + mean(measured.wordsCost))}. Spent ${usd(measured.spent)} in all.`,
    )
  }
  return failed ? 1 : 0
}

process.exitCode = await main()
