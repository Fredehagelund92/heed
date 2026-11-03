import { parseArgs } from 'node:util'
import { checkWords, wordsSystem } from '../domain/answer-words.ts'
import { parsePlan } from '../domain/ask-plan.ts'
import { plannerInputOf, type Planner } from '../domain/ask-route.ts'
import { ConfigError, loadConfig } from './config/env.ts'
import { createDatabase } from './db/database.ts'
import {
  askForPlan,
  askForWords,
  PLAN_MAX_TOKENS,
  PLAN_TODAY,
  planAreas,
  planBundle,
  planCases,
  planProblems,
  readWordsModel,
  runPlanCases,
  scriptedPlan,
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
 * only (with the cases they follow).
 */

const usage = 'Usage: npm run eval:ask-plan -- [--case <id>]... [--real --max-cost-usd <dollars>]'
const { values } = parseArgs({
  options: {
    case: { type: 'string', multiple: true },
    real: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
  },
})
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`
const tokens = (text: string) => Math.ceil(text.length / 4)
const percentile = (sorted: readonly number[], p: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]! : 0

async function main() {
  const cases = planCases.filter((c) => !values.case?.length || values.case.includes(c.id))
  if (!cases.length) {
    console.error(`No case matches. ${usage}`)
    return 2
  }
  if (!values.real) {
    console.log(`Ask's planner, ${cases.length} cases, with the scripted planner.`)
    return report(cases, await runPlanCases(cases, scriptedPlan), null)
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
    const estimate = cases.reduce((sum, c) => {
      const input = plannerInputOf(bundle, c.question, null, PLAN_TODAY)
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
    const planner: Planner = async (input, check) => {
      const at = performance.now()
      const before = calls.length
      const reply = await askForPlan(metered, input).catch((error: unknown) => {
        console.error(`the planner failed (${error instanceof Error ? error.name : 'error'})`)
        return null
      })
      timing.push(performance.now() - at)
      await meter.settled()
      planCost.push(calls.slice(before).reduce((t, c) => t + c.costMicros, 0))
      if (!reply) return null
      const checked = check(parsePlan(reply.text))
      if (!checked.ok) console.log(`\tthe plan failed the check: ${checked.why}`)
      return checked.ok ? checked.plan : null
    }
    const got = await runPlanCases(cases, planner)
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
      wordsCost,
      wordsFailed,
      spent: meter.costMicros,
    })
    await meter.settled()
    return code
  } finally {
    await database.close()
  }
}

type Measured = {
  timing: number[]
  planCost: number[]
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
      `Planner: ${measured.timing.length} calls, p50 ${Math.round(percentile(sorted, 0.5))} ms, p90 ${Math.round(percentile(sorted, 0.9))} ms, ${usd(mean(measured.planCost))} a call.`,
    )
    console.log(
      `Words: ${measured.wordsCost.length} calls, ${measured.wordsFailed} failed the check, ${usd(mean(measured.wordsCost))} a call.`,
    )
    console.log(
      `A planned question: about ${usd(mean(measured.planCost) + mean(measured.wordsCost))}. Spent ${usd(measured.spent)} in all.`,
    )
  }
  return failed ? 1 : 0
}

process.exitCode = await main()
