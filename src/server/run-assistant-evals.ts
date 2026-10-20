import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { parseArgs } from 'node:util'
import { formatHeldOut, HeldOutError } from '../../db/seed/held-out.ts'
import { heldOutAssistant, planHeldOutAssistant } from '../../db/seed/held-out-runs.ts'
import { loadGoldenSet } from '../../db/seed/golden-set.ts'
import { judgingWords, passRules, type PassRule } from '../domain/golden-question.ts'
import { systemClock } from './clock.ts'
import { ConfigError, loadConfig } from './config/env.ts'
import { createDatabase } from './db/database.ts'
import {
  assistantCases,
  goldenAssistantCases,
  planAssistantCases,
  runAssistantCases,
} from './modules/assistant/index.ts'
import { CEILING_MARGIN } from './modules/evals/index.ts'
import {
  checkModelSettings,
  createModelPort,
  ModelConfigError,
  readModelSettings,
  startCreditsCheck,
} from './modules/models/index.ts'
import { createLogger } from './observability/logger.ts'

/**
 * `npm run eval:assistant -- --as <email>`: the assistant's own test cases (FR-710) against the
 * live edition, as that person, with the scripted mock model. Each case is tried three times
 * (`--tries`), each try a fresh conversation of one or more turns; the majority decides, or every
 * try with `--pass-rule all` (pass^k). The judge model (`models.judge`) grades the rubrics of a
 * turn. Every try is kept whole in the database (assistant_case_tries); `--out <file>` also writes
 * the report with every transcript as JSON.
 *
 * A real-model run is always an explicit act (plan section 3.3): `--real` uses the provider and
 * model of `models.assistant`, needs the provider's key in .env.local and a cost ceiling at or
 * above the estimate, which is shown first. The ceiling holds for the whole run: no call starts
 * once it is spent, and a try starts only while there is room for it with a margin. Mock and real
 * runs are recorded as separate kinds, so their results are reported apart. Only demo content
 * belongs in the database.
 *
 * `--golden` runs the golden set's assistant cases (db/seed/golden-set.yml) instead: definitions,
 * conversations of several turns checked turn by turn, and the companion's turns, each on its
 * as-of day, on a database with the golden library live; `--type` keeps the cases of one type.
 * When the held-out key is given (README, "The sealed held-out cases"), the sealed held-out cases
 * run after them as a run of their own, within the same ceiling, and are reported as counts by
 * type only: never their words, expectations or transcripts, on screen, in `--out` or in the
 * database. Without the key the command says they did not run. `--case` runs visible cases only.
 * `--dry-run` shows what a run would make and cost, and makes nothing.
 *
 * Code checks the tone of every answer (assistant/tone.ts): the specification's words, the
 * machinery, long sentences, a menu for a thank-you and the product's name where nobody asked;
 * the run also fails when its answers together fall short of the voice review's bars.
 *
 * `--about-business off` runs the turns without About our business in the turn context (the
 * administrator's background text, domain/about-business.ts); `on`, the default, runs them as
 * people have it. The run records its arm and the text's digest, so two runs of the same cases,
 * such as `--golden --type industry`, show what the background adds.
 */

const usage =
  'Usage: npm run eval:assistant -- --as <email> [--golden [--type <type>]...] [--case <id>]... [--tries <n>] [--pass-rule majority|all] [--about-business on|off] [--out <file>] [--dry-run] [--real --max-cost-usd <dollars>]'
const { values } = parseArgs({
  options: {
    as: { type: 'string' },
    case: { type: 'string', multiple: true },
    golden: { type: 'boolean', default: false },
    type: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean', default: false },
    tries: { type: 'string' },
    'pass-rule': { type: 'string' },
    out: { type: 'string' },
    real: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
    'about-business': { type: 'string' },
  },
})
const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`

async function main() {
  const tries = Number(values.tries ?? 3)
  const rule = values['pass-rule'] ?? 'majority'
  const about = values['about-business'] ?? 'on'
  if (
    (about !== 'on' && about !== 'off') ||
    !values.as ||
    !Number.isInteger(tries) ||
    tries < 1 ||
    tries > 20 ||
    !passRules.includes(rule as PassRule) ||
    (values.type?.length && !values.golden)
  ) {
    console.error(usage)
    return 2
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
  try {
    const models = createModelPort({ mode: config.models, env: config.modelEnv })
    const [person] = await database.query<{ id: string }>(
      'select id::text from people where email=$1 and deactivated_at is null and erased_at is null',
      [values.as.toLowerCase()],
    )
    if (!person) {
      console.error(`No active person with the email ${values.as}. Sign in once first.`)
      return 1
    }
    const only = values.case?.length ? values.case : null
    const types = values.type?.length ? values.type : null
    const cases = values.golden
      ? goldenAssistantCases(
          loadGoldenSet().assistant.filter((c) => !types || types.includes(c.type)),
        )
      : assistantCases
    const clock = systemClock(config.fixedToday)
    const aboutBusiness = about === 'on'
    let plan
    try {
      checkModelSettings(models, await readModelSettings(database))
      plan = await planAssistantCases(
        { database, models, clock, aboutBusiness },
        { personId: person.id, cases, tries, ...(only ? { only } : {}) },
      )
    } catch (error) {
      if (!(error instanceof ModelConfigError)) throw error
      console.error(error.message)
      return 1
    }
    const { model: choice, judgeModel: judge, estimate } = plan
    if (!plan.cases.length) {
      console.error('No case matches. Check --case and --type.')
      return 2
    }
    const turns = plan.cases.reduce((sum, c) => sum + 1 + (c.then?.length ?? 0), 0)
    console.log(
      `Model ${choice.id}, judged by ${judge.id}. ${plan.cases.length} cases (${turns} turns), ${tries} tries each. Estimated cost ${usd(estimate)}.`,
    )
    console.log(
      plan.aboutBusiness.arm === 'off'
        ? 'About our business: left out of the turn context (--about-business off).'
        : plan.aboutBusiness.digest
          ? `About our business: in the turn context, ${plan.aboutBusiness.characters} characters.`
          : 'About our business: on, but its text is empty, so the turns get none.',
    )
    // The sealed held-out cases run with --golden, unless --case names visible ones.
    const heldOut = values.golden && !only
    const heldOutPlan = heldOut
      ? await planHeldOutAssistant(
          { database, models, clock },
          { personId: person.id, tries, types },
        )
      : null
    if (heldOutPlan?.ran)
      console.log(
        `Held-out assistant cases: ${heldOutPlan.cases} more, ${heldOutPlan.skipped} of them cannot run here. Estimated cost ${usd(heldOutPlan.estimate)}.`,
      )
    const total = estimate + (heldOutPlan?.ran ? heldOutPlan.estimate : 0)
    if (plan.skipped.size)
      console.log(
        `${plan.skipped.size} of them cannot run here and are skipped: ${[...plan.skipped].map(([id, why]) => `${id} (${why})`).join('; ')}.`,
      )
    if (values['dry-run']) {
      for (const c of plan.cases) {
        const micros = plan.estimates.get(c.id)
        console.log(
          `${c.id}\t${1 + (c.then?.length ?? 0)} turn(s)\t${micros === undefined ? 'skipped' : usd(micros)}`,
        )
      }
      if (heldOutPlan && !heldOutPlan.ran)
        console.log(formatHeldOut('assistant cases', heldOutPlan))
      console.log('Dry run: no model was called and nothing was recorded.')
      return 0
    }
    const ceiling =
      values['max-cost-usd'] === undefined ? null : Number(values['max-cost-usd']) * 1_000_000
    if (values.real && !(ceiling !== null && ceiling >= total)) {
      const recipients = [...new Set([choice.recipients, judge.recipients])].join('; ')
      console.error(
        `A real-model run sends local items out of the company to ${recipients} and costs money. Run again with --max-cost-usd ${(total / 1_000_000).toFixed(2)} or more.`,
      )
      return 1
    }
    if (ceiling !== null)
      console.log(
        `Ceiling ${usd(ceiling)}: no try starts unless what was spent, plus ${CEILING_MARGIN} times its estimate, stays within it.`,
      )
    const credits = values.real
      ? await startCreditsCheck(models, database, [choice.provider, judge.provider])
      : null
    const report = await runAssistantCases(
      {
        database,
        clock,
        models,
        logger,
        approvalSecret: randomBytes(32),
        aboutBusiness,
      },
      {
        personId: person.id,
        tries,
        passRule: rule as PassRule,
        ceilingMicros: ceiling,
        cases,
        ...(only ? { only } : {}),
      },
    )
    for (const result of report.results) {
      const timing = result.tries
        .map((t) => t.turns[0]?.firstSentenceMs)
        .filter((ms): ms is number => typeof ms === 'number')
      const first = timing.length
        ? `, first sentence in ${Math.round(timing.reduce((a, b) => a + b, 0) / timing.length)} ms`
        : ''
      console.log(
        `${result.verdict}\t${result.id}\t${result.passes} of ${result.tries.length} tries passed${first}` +
          `${result.problems.length ? `\t${result.problems.join('; ')}` : ''}`,
      )
    }
    const { judgePassedCodeFailed, codePassedJudgeFailed } = report.agreement
    if (judgePassedCodeFailed.length || codePassedJudgeFailed.length)
      console.log(
        `Judge against code: the judge passed what code failed in ${judgePassedCodeFailed.join(', ') || 'no case'}; ` +
          `code passed what the judge failed in ${codePassedJudgeFailed.join(', ') || 'no case'}.`,
      )
    console.log(judgingWords(report.judging, 'turns'))
    // How the answers read together (the voice review, section 7.5): every answer's own tone
    // problems are in its case's problems above.
    const { tone } = report
    console.log(
      `Tone: ${tone.answers} answers. Sentences average ${tone.meanSentenceWords} words (bar 16), the longest ${tone.longestSentenceWords} (bar 30). ${tone.personal} say "you" or "I"; ${tone.flagged} have a tone problem.${tone.shortfalls.length ? ` Short of the bar: ${tone.shortfalls.join('; ')}.` : ''}`,
    )
    if (values.out) {
      await writeFile(values.out, `${JSON.stringify(report, null, 2)}\n`)
      console.log(
        `Wrote the report with every transcript to ${values.out}${heldOut ? ' (the visible cases only)' : ''}.`,
      )
    }
    console.log(
      `Run ${report.runId} (${report.kind}, About our business ${report.aboutBusiness.arm}): ${report.state}${report.stopped ? ` (${report.stopped})` : ''}. ` +
        `${report.passed} passed, ${report.failed} failed, ${report.skipped} skipped. Cost ${usd(report.costMicros)}.`,
    )
    const runs = report.runId ? [report.runId] : []
    let heldOutFailed = false
    if (heldOutPlan && !heldOutPlan.ran) console.log(formatHeldOut('assistant cases', heldOutPlan))
    else if (heldOutPlan?.ran) {
      // Within what the visible run left of the ceiling.
      const left = ceiling === null ? null : Math.max(0, ceiling - report.costMicros)
      const held = await heldOutAssistant(
        { database, clock, models, logger, approvalSecret: randomBytes(32), aboutBusiness },
        { personId: person.id, tries, passRule: rule as PassRule, ceilingMicros: left, types },
      )
      console.log(
        `${formatHeldOut('assistant cases', held)} Run ${held.runId} (recorded without their words), cost ${usd(held.costMicros)}.`,
      )
      heldOutFailed = held.ran && held.counts.failed > 0
      if (held.runId) runs.push(held.runId)
    }
    for (const line of (await credits?.finish(runs)) ?? []) console.log(line)
    if (report.state === 'incomplete') return 2
    return report.failed || heldOutFailed || report.tone.shortfalls.length ? 1 : 0
  } finally {
    await database.close()
  }
}

try {
  process.exitCode = await main()
} catch (error) {
  // A held-out failure says what went wrong without quoting a case: no stack to print.
  if (!(error instanceof HeldOutError)) throw error
  console.error(error.message)
  process.exitCode = 1
}
