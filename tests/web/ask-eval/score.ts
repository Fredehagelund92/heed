import {
  classNames,
  PROMISES,
  promiseNames,
  type AskPromise,
  type CaseClass,
  type CaseRun,
  type EvalCase,
} from './types.ts'

/*
  A run scored: each case over its k tries, then by class and by promise. A promise is zero
  tolerance, so a case keeps it only when every turn of every try does (pass^k); what a case must
  say is usefulness, reported as pass@1 (the share of tries that said it) and pass^k. The held-back
  cases are scored the same way and reported only as counts: no id, no question, no reply.
*/

export type CaseScore = {
  id: string
  class: CaseClass
  held: boolean
  tries: number
  /** Tries that broke no promise and missed nothing. */
  passed: number
  /** Tries that broke no promise. */
  kept: number
  /** Tries that missed nothing of the case. */
  useful: number
  /** Each promise, with the tries that broke it. */
  broke: Partial<Record<AskPromise, number>>
  /** Tries the answerer gave no reply in. */
  unanswered: number
}

const brokeIn = (run: CaseRun) =>
  new Set(run.turns.flatMap((t) => Object.keys(t.grade.breaches) as AskPromise[]))
const missedIn = (run: CaseRun) => !!run.unanswered || run.turns.some((t) => t.grade.misses.length)

export function scoreCase(c: EvalCase, runs: readonly CaseRun[], held: boolean): CaseScore {
  const broke: CaseScore['broke'] = {}
  let passed = 0
  let kept = 0
  let useful = 0
  for (const run of runs) {
    const promises = brokeIn(run)
    for (const p of promises) broke[p] = (broke[p] ?? 0) + 1
    const ok = !missedIn(run)
    if (!promises.size) kept++
    if (ok) useful++
    if (!promises.size && ok) passed++
  }
  const unanswered = runs.filter((r) => r.unanswered).length
  return {
    id: c.id,
    class: c.class,
    held,
    tries: runs.length,
    passed,
    kept,
    useful,
    broke,
    unanswered,
  }
}

export type Tally = {
  cases: number
  /** Mean share of tries that passed. */
  pass1: number
  /** Cases that passed every try. */
  passK: number
  /** Cases that broke no promise in any try. */
  keptK: number
  /** Cases that said what they must in every try. */
  usefulK: number
}

const tally = (scores: readonly CaseScore[]): Tally => ({
  cases: scores.length,
  pass1: scores.length ? scores.reduce((s, c) => s + c.passed / c.tries, 0) / scores.length : 0,
  passK: scores.filter((c) => c.passed === c.tries).length,
  keptK: scores.filter((c) => c.kept === c.tries).length,
  usefulK: scores.filter((c) => c.useful === c.tries).length,
})

export type Report = {
  answerer: string
  tries: number
  /** Cases the run stopped before. */
  notRun: number
  /** Tries, open and held back, in which the answerer gave no reply: no quality result. */
  unanswered: number
  all: Tally
  byClass: Partial<Record<CaseClass, Tally>>
  /** Each promise: the cases that broke it in any try, and the tries that did. */
  byPromise: Record<AskPromise, { cases: number; tries: number; ids: string[] }>
  held: { all: Tally; byPromise: Record<AskPromise, number> }
}

export function report(answerer: string, all: readonly CaseScore[]): Report {
  // A case a run stopped before (a spending ceiling) is no score at all.
  const scores = all.filter((s) => s.tries)
  const open = scores.filter((s) => !s.held)
  const back = scores.filter((s) => s.held)
  const byClass: Report['byClass'] = {}
  for (const k of Object.keys(classNames) as CaseClass[]) {
    const of = open.filter((s) => s.class === k)
    if (of.length) byClass[k] = tally(of)
  }
  const byPromise = Object.fromEntries(
    PROMISES.map((p) => {
      const broke = open.filter((s) => s.broke[p])
      return [
        p,
        {
          cases: broke.length,
          tries: broke.reduce((n, s) => n + s.broke[p]!, 0),
          ids: broke.map((s) => s.id),
        },
      ]
    }),
  ) as Report['byPromise']
  return {
    answerer,
    tries: Math.max(0, ...scores.map((s) => s.tries)),
    notRun: all.length - scores.length,
    unanswered: scores.reduce((n, s) => n + s.unanswered, 0),
    all: tally(open),
    byClass,
    byPromise,
    held: {
      all: tally(back),
      byPromise: Object.fromEntries(
        PROMISES.map((p) => [p, back.filter((s) => s.broke[p]).length]),
      ) as Record<AskPromise, number>,
    },
  }
}

const pct = (n: number) => `${Math.round(n * 100)}%`
const row = (cells: readonly (string | number)[]) => `| ${cells.join(' | ')} |`

/** The report in plain text: what `npm run eval:ask-harness` prints. */
export function printReport(r: Report): string {
  const k = r.tries
  const head = ['Class', 'Cases', 'pass@1', `pass^${k}`, `promises kept ^${k}`, `says ^${k}`]
  const line = (name: string, t: Tally) =>
    row([name, t.cases, pct(t.pass1), t.passK, t.keptK, t.usefulK])
  return [
    `Ask evaluation: ${r.answerer}, ${k} tr${k === 1 ? 'y' : 'ies'} a case`,
    '',
    row(head),
    row(head.map(() => '---')),
    ...Object.entries(r.byClass).map(([c, t]) => line(`${c} ${classNames[c as CaseClass]}`, t)),
    line('All development cases', r.all),
    ...(r.notRun ? ['', `Not run: ${r.notRun} cases, after the run stopped at its ceiling.`] : []),
    ...(r.unanswered
      ? [
          '',
          `Unanswered: ${r.unanswered} tries got no reply, twice; each counts as missing what it must say.`,
        ]
      : []),
    '',
    row(['Promise', 'Cases broken', 'Tries broken', `Kept ^${k}`]),
    row(['---', '---', '---', '---']),
    ...PROMISES.map((p) =>
      row([
        promiseNames[p],
        r.byPromise[p].cases,
        r.byPromise[p].tries,
        `${r.all.cases - r.byPromise[p].cases} of ${r.all.cases}`,
      ]),
    ),
    '',
    `Held back: ${r.held.all.passK} of ${r.held.all.cases} pass every try, ${r.held.all.keptK} keep every promise, ${r.held.all.usefulK} say what they must. Promises broken: ${
      PROMISES.filter((p) => r.held.byPromise[p])
        .map((p) => `${p} ${r.held.byPromise[p]}`)
        .join(', ') || 'none'
    }.`,
  ].join('\n')
}
