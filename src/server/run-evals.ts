import { randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { judgingWords, passRules, type PassRule } from '../domain/golden-question.ts'
import { systemClock } from './clock.ts'
import { ConfigError, loadConfig } from './config/env.ts'
import { createDatabase, type Queryable } from './db/database.ts'
import {
  CEILING_MARGIN,
  createEvalsService,
  modelsFor,
  queueAreaRun,
  readEvalSettings,
  resumeRun,
  workEvaluations,
} from './modules/evals/index.ts'
import {
  checkModelSettings,
  createModelPort,
  ModelConfigError,
  readModelSettings,
  startCreditsCheck,
} from './modules/models/index.ts'
import { createLogger } from './observability/logger.ts'

/**
 * `npm run eval -- --area <id>`: the full test set of an area on the live edition, now. With
 * `--links`, a links run instead: every question with get_related off and on, to see whether
 * following links helps (FR-523). It uses the scripted mock model. A real-model run is always an
 * explicit act (plan section 3.3): `--real` uses the providers and models of the `models.*`
 * settings, needs each provider's key in .env.local and a cost ceiling at or above the estimate,
 * which is shown first (FR-516). The ceiling holds for the whole run: no call starts once the run
 * spent it, and an answer starts only while what was spent, plus a margin for every answer in
 * flight, leaves room. `--pass-rule all` counts a wording only when every try passes (pass^k).
 * A question with its own as-of day (a golden question's) is asked on that day, the others on the
 * run's (`CL_FIXED_TODAY` or today), and the command says which day each was asked on.
 *
 * The command holds the run while it works it, so the service never works it too. A run that
 * stops before every answer is made (the provider kept failing, a cap or the ceiling was reached,
 * or Ctrl-C) ends incomplete; `--resume <run id>` makes only the missing answers. Only demo
 * content belongs in the local database. A real-model run ends by setting what the ledger recorded
 * for it against each provider's own counter of what the key used, where the provider keeps one.
 */

const usage =
  'Usage: npm run eval -- (--area <domain id> [--links] | --resume <run id>) [--pass-rule majority|all] [--real --max-cost-usd <dollars>]'
const { values } = parseArgs({
  options: {
    area: { type: 'string' },
    resume: { type: 'string' },
    real: { type: 'boolean', default: false },
    links: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
    'pass-rule': { type: 'string' },
  },
})
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

async function main() {
  if (!values.area === !values.resume || (values.resume && !uuid.test(values.resume))) {
    console.error(usage)
    return 1
  }
  const rule = values['pass-rule'] ?? 'majority'
  if (!passRules.includes(rule as PassRule)) {
    console.error(usage)
    return 1
  }
  let config
  try {
    config = loadConfig({ ...process.env, MODELS: values.real ? 'live' : 'mock' })
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    return 1
  }
  const logger = createLogger({ level: 'warn' })
  const database = createDatabase(config.databaseUrl, logger)
  const worker = `cli-${randomUUID()}`
  // Ctrl-C stops the run after the answers in flight; it ends incomplete and can be resumed.
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
    const ceiling =
      values['max-cost-usd'] === undefined ? null : Number(values['max-cost-usd']) * 1_000_000
    if (ceiling !== null && !(ceiling >= 0)) {
      console.error(usage)
      return 1
    }
    const refusal = (needed: number) =>
      `A real-model run sends the local items and test questions out of the company to ${recipients} and costs money. Run again with --max-cost-usd ${(needed / 1_000_000).toFixed(2)} or more.`
    let runId: string
    if (values.resume) {
      const id = values.resume
      const [run] = await database.query<{
        state: string
        spent: string
        estimated: string
        model_id: string
        judge_model_id: string | null
      }>(
        'select state::text,actual_cost_micros::text as spent,estimated_cost_micros::text as estimated,model_id,judge_model_id from eval_runs where id=$1',
        [id],
      )
      if (!run) {
        console.error(`There is no evaluation run ${id}.`)
        return 1
      }
      if (run.state !== 'incomplete') {
        console.error(`Run ${id} is ${run.state}; only an incomplete run is resumed.`)
        return 1
      }
      const now = modelsFor(deps.port, await readEvalSettings(database))
      if (now.answer.id !== run.model_id || now.judge.id !== run.judge_model_id) {
        console.error(
          `Run ${id} was planned for ${run.model_id} judged by ${run.judge_model_id ?? 'unknown'}, but this command would use ${now.answer.id} judged by ${now.judge.id}. Resume it with --real and --max-cost-usd if it is a real-model run, or after restoring the models.* settings; it is left as it was.`,
        )
        return 1
      }
      console.log(
        `Run ${id} spent ${usd(Number(run.spent))} of an estimated ${usd(Number(run.estimated))}.`,
      )
      // The ceiling is the whole run's: what it spent so far counts against it.
      if (values.real && !(ceiling !== null && ceiling > Number(run.spent))) {
        console.error(refusal(Number(run.spent) + Number(run.estimated)))
        return 1
      }
      await database.transaction(null, async (tx) => {
        await resumeRun(tx, id, ceiling === null ? {} : { costCeilingMicros: ceiling })
        await hold(tx, id, worker)
      })
      runId = id
    } else {
      const area = values.area!
      const kind = values.links ? 'links' : 'full'
      const estimate = await database.transaction(null, (tx) =>
        createEvalsService(tx, deps).runs.estimate(area, kind),
      )
      console.log(
        `Domain ${area}, edition ${estimate.edition ?? 'none'}: ${plural(estimate.questions, 'question')}` +
          ` (${estimate.setAside} set aside), ${plural(estimate.cells, 'cell')}, ${estimate.cached} cached.`,
      )
      console.log(`Model ${estimate.modelId}. Estimated cost ${usd(estimate.costMicros)}.`)
      if (!estimate.edition) {
        console.error('There is no live edition yet.')
        return 1
      }
      if (values.real && !(ceiling !== null && ceiling >= estimate.costMicros)) {
        console.error(refusal(estimate.costMicros))
        return 1
      }
      if (ceiling !== null)
        console.log(
          `Ceiling ${usd(ceiling)}: no answer starts unless what was spent, plus ${CEILING_MARGIN} times an answer's estimate for each answer in flight, stays within it.`,
        )
      const run = await database.transaction(null, async (tx) => {
        const queued = await queueAreaRun(tx, deps, area, kind, false, undefined, {
          passRule: rule as PassRule,
          costCeilingMicros: ceiling,
        })
        if (!queued) return null
        // The ceiling given on the command line is the approval for this run (FR-516). The
        // command holds the run from the start, so the service's job never works it as well.
        if (queued.state === 'awaiting_approval' || queued.state === 'queued')
          await hold(tx, queued.id, worker)
        return queued
      })
      if (!run) return 1
      runId = run.id
    }
    // The day each question is asked on: its own as-of day (a golden question's), or the run's.
    const days = await database.query<{ day: string | null; own: boolean; n: number }>(
      `select q->>'asOf' as day,r.body ? 'as_of' as own,count(*)::int as n
         from eval_runs e cross join jsonb_array_elements(e.summary->'plan'->'questions') q
         join golden_question_revisions r on r.question_id=q->>'id' and r.revision=(q->>'revision')::int
        where e.id=$1 group by 1,2 order by 2 desc,1`,
      [runId],
    )
    for (const { day, own, n } of days)
      console.log(
        own
          ? `Asked as of ${day}: ${plural(n, 'question')} on ${n === 1 ? 'its' : 'their'} own as-of day.`
          : `Asked as of ${day ?? deps.clock.today()}: ${plural(n, 'question')} without an as-of day, on the run's day${config.fixedToday ? ' (CL_FIXED_TODAY)' : ''}.`,
      )
    const credits = values.real ? await startCreditsCheck(deps.port, database, providers) : null
    await workEvaluations(database, deps, {
      only: runId,
      worker,
      deadline: Date.now() + 2 * 60 * 60 * 1000,
      signal: controller.signal,
      logger,
    })
    // Started here with no person, so read back as the operator: a person's view shows only the
    // runs they requested or maintain, and this one has no requester.
    const result = await database.transaction(null, (tx) =>
      createEvalsService(tx, deps, 'operator').runs.get(runId),
    )
    const links = result.links
    for (const q of result.results)
      console.log(
        links
          ? `${q.baseline ?? 'not run'} -> ${q.candidate ?? 'not run'}\t${q.id}`
          : `${q.baseline ?? 'not run'}\t${q.id}`,
      )
    if (links) {
      for (const [side, arm] of Object.entries(links.arms))
        console.log(
          `get_related ${side === 'baseline' ? 'off' : 'on'}: ${plural(arm.answers, 'answer')}; ` +
            `per answer ${arm.calls} tool calls on average and ${usd(arm.costMicros)}; ` +
            `${plural(arm.causeClaims, 'cause claim')}.`,
        )
      console.log(
        links.gain
          ? `Links helped: ${links.gained.join(', ')} passed only with get_related on.`
          : `No gain from links (gained ${links.gained.length}, lost ${links.lost.length}); keep get_related off.`,
      )
    }
    const agreement = result.agreement?.candidate ?? result.agreement?.baseline
    if (agreement) {
      const listed = (ids: string[]) => (ids.length ? `: ${ids.join(', ')}` : '')
      console.log(
        `Judge against code checks, ${plural(agreement.questions, 'question')} compared: ` +
          `the judge passed ${agreement.judgePassedCodeFailed.length} the code failed${listed(agreement.judgePassedCodeFailed)}; ` +
          `the code passed ${agreement.codePassedJudgeFailed.length} the judge failed${listed(agreement.codePassedJudgeFailed)}. ` +
          `Tries: ${agreement.tries.judgePassedCodeFailed} and ${agreement.tries.codePassedJudgeFailed} of ${agreement.tries.compared}.`,
      )
    }
    console.log(judgingWords(result.judging, 'answers'))
    const [calls] = await database.query<{
      n: number
      throttled: number
      failed: number
      tokens_in: string
      cache_read: string
      cache_write: string
      tokens_out: string
      cost: string
    }>(
      `select count(*)::int as n,count(*) filter (where outcome='throttled')::int as throttled,
              count(*) filter (where outcome in ('failed','aborted'))::int as failed,
              coalesce(sum(tokens_in),0)::text as tokens_in,coalesce(sum(cache_read),0)::text as cache_read,
              coalesce(sum(cache_write),0)::text as cache_write,coalesce(sum(tokens_out),0)::text as tokens_out,
              coalesce(sum(cost_micros),0)::text as cost
         from model_calls where run_id=$1`,
      [runId],
    )
    if (calls?.n)
      console.log(
        `Model calls: ${calls.n} (${calls.throttled} refused for a rate limit, ${calls.failed} failed or cut short); ` +
          `${calls.tokens_in} tokens in (${calls.cache_read} read from the prompt cache, ${calls.cache_write} written to it), ` +
          `${calls.tokens_out} out; ${usd(Number(calls.cost))}.`,
      )
    for (const line of (await credits?.finish([runId])) ?? []) console.log(line)
    const card = result.scorecard
    const run = result.run
    console.log(
      `Run ${runId}: ${run.state}${run.failure ? ` (${run.failure})` : ''}. ` +
        (card ? `${card.passed} passed, ${card.failed} failed, ${card.noAnswer} no answer. ` : '') +
        `Cost ${usd(run.actualCostMicros)}` +
        (run.costCeilingMicros !== null ? ` of a ${usd(run.costCeilingMicros)} ceiling.` : '.'),
    )
    if (run.state === 'incomplete')
      console.log(
        `Resume it with: npm run eval -- --resume ${runId}${values.real ? ' --real --max-cost-usd <dollars>' : ''}`,
      )
    // 0: finished with nothing failing; 2: incomplete, resumable; 1: anything else.
    if (run.state === 'incomplete') return 2
    return run.state === 'finished' && !card?.failed ? 0 : 1
  } finally {
    process.off('SIGINT', interrupt)
    await database.close()
  }
}

/** Queues the run under this command's lease, so no other worker takes it. */
async function hold(tx: Queryable, id: string, worker: string) {
  await tx.query(
    `update eval_runs set state='queued',worker=$2,lease_until=now()+interval '5 minutes' where id=$1`,
    [id, worker],
  )
}

process.exitCode = await main()
