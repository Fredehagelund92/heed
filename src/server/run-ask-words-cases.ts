import { parseArgs } from 'node:util'
import { wordsPrompt, wordsSystem } from '../domain/answer-words.ts'
import { ConfigError, loadConfig } from './config/env.ts'
import { createDatabase } from './db/database.ts'
import { askForWords, readWordsModel, wordsCases, wordsProblems } from './modules/answer/index.ts'
import {
  checkModelSettings,
  conversationRetry,
  costMicros,
  createCallMeter,
  createModelPort,
  ModelConfigError,
  readModelSettings,
  scriptedWordsModel,
  type ModelChoice,
} from './modules/models/index.ts'
import { createLogger } from './observability/logger.ts'

/**
 * `npm run eval:ask-words`: the test cases of Ask's words (FR-710), with the scripted mock model.
 * `--real` runs them with the provider and model of `models.assistant` instead, which sends the
 * cases' made-up questions and items to that provider and costs money: it needs the provider's
 * key in .env.local and `--max-cost-usd` at or above the estimate, shown first, and records the
 * spend in the ledger as an evaluation's. Mock and real runs print which they were, so their
 * results are reported apart. `--case <id>` runs some cases only.
 */

const usage = 'Usage: npm run eval:ask-words -- [--case <id>]... [--real --max-cost-usd <dollars>]'
const { values } = parseArgs({
  options: {
    case: { type: 'string', multiple: true },
    real: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
  },
})
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`
const tokens = (text: string) => Math.ceil(text.length / 4)

async function main() {
  const cases = wordsCases.filter((c) => !values.case?.length || values.case.includes(c.id))
  if (!cases.length) {
    console.error(`No case matches. ${usage}`)
    return 2
  }
  if (!values.real) {
    console.log(`Ask's words, ${cases.length} cases, with the scripted mock model.`)
    return report(cases, scriptedWordsModel())
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
    const estimate = cases.reduce(
      (sum, c) =>
        sum +
        costMicros(choice.prices, {
          inputTokens: tokens(wordsSystem) + tokens(wordsPrompt(c.input)),
          outputTokens: 400,
          cacheReadTokens: 0,
        }),
      0,
    )
    const ceiling = Number(values['max-cost-usd'] ?? Number.NaN) * 1_000_000
    console.log(
      `Ask's words, ${cases.length} cases, with ${choice.id}. Estimated cost ${usd(estimate)}.`,
    )
    if (!(ceiling >= estimate)) {
      console.error(
        `A real-model run sends the cases to ${choice.recipients} and costs money. Run again with --max-cost-usd ${(estimate / 1_000_000).toFixed(2)} or more.`,
      )
      return 1
    }
    const meter = createCallMeter({
      database,
      feature: 'eval',
      person: null,
      limits: null,
      retry: conversationRetry,
    })
    const code = await report(cases, meter.wrap(choice, { role: 'assistant' }))
    await meter.settled()
    return code
  } finally {
    await database.close()
  }
}

async function report(cases: typeof wordsCases, choice: ModelChoice): Promise<number> {
  let failed = 0
  for (const c of cases) {
    const reply = await askForWords(choice, c.input).catch((error: unknown) => {
      console.error(`${c.id}: the model failed (${error instanceof Error ? error.name : 'error'})`)
      return null
    })
    const text = reply?.text ?? null
    const problems = [
      ...(reply && reply.finishReason !== 'stop'
        ? [`did not finish (${reply.finishReason}, ${reply.reasoningTokens} reasoning tokens)`]
        : []),
      ...wordsProblems(c, text),
    ]
    if (problems.length) failed++
    console.log(`${problems.length ? 'FAIL' : 'pass'}\t${c.id}\t${problems.join('; ') || text}`)
  }
  console.log(`${cases.length - failed} of ${cases.length} cases passed.`)
  return failed ? 1 : 0
}

process.exitCode = await main()
