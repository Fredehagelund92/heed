import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

/*
  Ask's evaluation harness from the command line (docs/evaluations.md, "Ask's evaluation
  harness"). With no flags it runs today's main on the demo week on the last real plans, with no
  model, as every build does, and prints the report; --answerer loop runs Ask's loop instead, on
  the last real run's steps. With --real it asks the real model through the Vercel gateway: the
  judge's agreement with its labels first (--no-judge-set leaves it out), then every case three
  times, each reply a model wrote read by the judge, stopping before --max-cost-usd is spent. It
  runs in a database of its own, copied from the test template, so it never reads or writes
  another one.

    npm run eval:ask-harness [-- --answerer loop]
    npm run eval:ask-harness -- --real --max-cost-usd 0.50 [--answerer loop] [--tries 3] [--record]
      [--no-judge-set] [--cases C1,K04] [--out report.json] [--resume earlier-report.json.jsonl]
    npm run eval:ask-harness -- --replay earlier-report.json.jsonl [--answerer loop]

  --record keeps the plans (the loop's steps) and the judge's verdicts the builds replay. A real run journals each
  graded try next to its report (<out>.jsonl), with what it has spent; --resume goes on with such a
  run, asking only what it had not, and counts its spend against the same ceiling; --replay grades
  such a run's replies and judge findings again with no model, after a grader changes. The key is read
  from the environment (VERCEL_AI_GATEWAY_API_KEY) and never printed.
*/

const { values } = parseArgs({
  options: {
    real: { type: 'boolean', default: false },
    'max-cost-usd': { type: 'string' },
    tries: { type: 'string' },
    record: { type: 'boolean', default: false },
    cases: { type: 'string' },
    out: { type: 'string' },
    resume: { type: 'string' },
    replay: { type: 'string' },
    answerer: { type: 'string', default: 'main' },
    'no-judge-set': { type: 'boolean', default: false },
  },
})

const fail = (message: string): never => {
  console.error(message)
  process.exit(2)
}

const env: Record<string, string> = {}
if (values.real) {
  const usd = Number(values['max-cost-usd'])
  if (!values['max-cost-usd'] || !Number.isFinite(usd) || usd <= 0)
    fail('A real run needs --max-cost-usd, the most it may spend in US dollars.')
  if (!process.env.VERCEL_AI_GATEWAY_API_KEY)
    fail('A real run needs VERCEL_AI_GATEWAY_API_KEY in the environment.')
  env.ASK_EVAL_REAL = '1'
  env.ASK_EVAL_MAX_MICROS = String(Math.round(usd * 1e6))
}
if (values.tries) env.ASK_EVAL_TRIES = values.tries
if (values.record) env.ASK_EVAL_RECORD = '1'
if (values.cases) env.ASK_EVAL_CASES = values.cases
if (values.resume) env.ASK_EVAL_RESUME = values.resume
if (values.replay) env.ASK_EVAL_REPLAY = values.replay
if (values['no-judge-set']) env.ASK_EVAL_JUDGE_SET = '0'
if (values.answerer !== 'main' && values.answerer !== 'loop')
  fail("--answerer is main (the router, the planner and the words) or loop (Ask's loop).")
const out = values.out ?? join(mkdtempSync(join(tmpdir(), 'ask-eval-')), 'report.json')
env.ASK_EVAL_OUT = out

const run = spawnSync(
  'npx',
  [
    'vitest',
    'run',
    '--project',
    'integration',
    values.answerer === 'loop'
      ? 'tests/web/integration/ask-eval-loop.test.ts'
      : 'tests/web/integration/ask-eval.test.ts',
    '--hookTimeout=600000',
  ],
  { stdio: 'inherit', env: { ...process.env, ...env } },
)

try {
  const written = JSON.parse(readFileSync(out, 'utf8')) as { text?: string }
  if (written.text) console.log(`\n${written.text}`)
  console.log(`\nThe whole run, open cases only: ${out}`)
} catch {
  console.error('The run wrote no report.')
}
process.exit(run.status ?? 1)
