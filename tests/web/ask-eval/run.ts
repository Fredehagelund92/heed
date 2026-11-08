import { gradeTurn, type GradeContext } from './graders.ts'
import { FIXED_FACTS, JUDGE_RULES, type Verdicts } from './judge.ts'
import { report, scoreCase, type Report } from './score.ts'
import type { Answerer, CaseRun, Chat, EvalCase, Reader, Reply } from './types.ts'

/*
  A run of the harness: every case, k times, through one answerer, each message answered before the
  next is sent, each reply graded as it comes. The world it runs in is passed in: who the readers
  are, what each may read and see, whether a message was stored, what has been spent, and the judge,
  so the same run reads today's main on the demo week, a future agent, or a fake in a unit test.
*/

export type ReaderWorld = Pick<GradeContext, 'readable' | 'unreadable' | 'topics'>

export type RunWorld = {
  reader: (name: string) => Promise<Reader>
  known: (name: string) => Promise<ReaderWorld>
  /** The judge's verdicts on a reply a model wrote, or null for a judge error; absent with no judge. */
  judge?: (input: {
    said: string[]
    earlier: string[]
    evidence: string[]
    reply: string
  }) => Promise<Verdicts | null>
  /** Which of these messages are in the store: called before and after the run. */
  stored?: (messages: readonly string[]) => Promise<Set<string>>
  /** Whether the run must stop before the next case: a spending ceiling. */
  spent?: () => Promise<boolean>
  /** Hears each try of a case once it is graded, so a run that dies keeps what it had. */
  done?: (run: CaseRun) => Promise<void>
}

export type Outcome = {
  report: Report
  runs: CaseRun[]
  held: ReadonlySet<string>
  /** Stopped before every case ran, at the ceiling. */
  incomplete: boolean
  judgeErrors: number
}

/** A message sent, and once more after a pause if nothing came back. */
async function sendTwice(chat: Chat, message: string): Promise<Reply> {
  try {
    return await chat.send(message)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 2_000))
    return chat.send(message)
  }
}

async function runCase(world: RunWorld, answerer: Answerer, c: EvalCase, n: number) {
  const known = await world.known(c.as)
  const chat = answerer.open(await world.reader(c.as))
  const turns: CaseRun['turns'] = []
  const said: string[] = []
  let judgeErrors = 0
  for (const turn of c.turns) {
    said.push(turn.ask)
    let reply: Reply
    try {
      reply = await sendTwice(chat, turn.ask)
    } catch (error) {
      // No reply is no quality result: the try ends here, unanswered, and says why.
      const why = error instanceof Error ? error.message : String(error)
      return { run: { id: c.id, try: n, turns, unanswered: why }, judgeErrors }
    }
    const ctx: GradeContext = {
      ...known,
      said: [...said],
      earlier: turns.map((t) => t.reply),
      fixed: FIXED_FACTS,
    }
    const grade = gradeTurn(turn, reply, ctx)
    if (world.judge && reply.modelWords) {
      const verdicts = await world.judge({
        said: [...said],
        earlier: ctx.earlier.map((r) => r.text),
        evidence: evidenceOf(reply, ctx),
        reply: reply.text,
      })
      if (!verdicts) judgeErrors++
      // A sentence copied from what the answerer read is that source speaking: a line code wrote,
      // an item's own words. The judge's quote of one is no finding, as for the code's own graders.
      const read = evidenceOf(reply, ctx).join('\n')
      for (const rule of JUDGE_RULES) {
        const found = (verdicts?.[rule] ?? []).filter((s) => !read.includes(s.trim()))
        if (found.length)
          grade.breaches[rule] = [
            ...(grade.breaches[rule] ?? []),
            ...found.map((s) => `${JUDGE_MARK}${s.slice(0, 120)}"`),
          ]
      }
    }
    turns.push({ ask: turn.ask, reply, grade })
  }
  return { run: { id: c.id, try: n, turns }, judgeErrors }
}

/** How a judge's finding reads among a turn's breaches. */
export const JUDGE_MARK = 'judge: "'

const caseOf = (cases: readonly EvalCase[], run: CaseRun) => cases.find((c) => c.id === run.id)!

/** What the answerer read for a reply, and the text of each item it cites. */
export const evidenceOf = (reply: Reply, ctx: Pick<GradeContext, 'readable'>) => [
  ...reply.evidence,
  ...reply.sources.flatMap((id) => {
    const item = ctx.readable.get(id)
    return item ? [item.text] : []
  }),
]

export async function evaluate(
  world: RunWorld,
  answerer: Answerer,
  cases: readonly EvalCase[],
  options: {
    tries: number
    held: ReadonlySet<string>
    concurrency?: number
    /** Tries an earlier run of the same cases finished: kept, and not asked again. */
    prior?: readonly CaseRun[]
  },
): Promise<Outcome> {
  const messages = cases.flatMap((c) => c.turns.map((t) => t.ask))
  const before = (await world.stored?.(messages)) ?? new Set<string>()
  const prior = (options.prior ?? []).filter((r) => cases.some((c) => c.id === r.id))
  const runs: CaseRun[] = [...prior]
  let incomplete = false
  let judgeErrors = 0
  // Every try of every case, a few chats at a time; none starts once the ceiling is reached.
  const queue = Array.from({ length: options.tries }, (_, n) => cases.map((c) => ({ c, n })))
    .flat()
    .filter(({ c, n }) => !prior.some((r) => r.id === c.id && r.try === n))
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (await world.spent?.()) {
        incomplete = true
        queue.length = 0
        return
      }
      const done = await runCase(world, answerer, next.c, next.n)
      runs.push(done.run)
      judgeErrors += done.judgeErrors
      await world.done?.(done.run)
    }
  }
  await Promise.all(Array.from({ length: options.concurrency ?? 1 }, worker))
  runs.sort(
    (a, b) => a.try - b.try || cases.indexOf(caseOf(cases, a)) - cases.indexOf(caseOf(cases, b)),
  )
  // A question's words are kept nowhere: what is in the store after the run and was not before.
  const after = (await world.stored?.(messages)) ?? new Set<string>()
  for (const run of runs)
    for (const t of run.turns) {
      const m = storedKey(t.ask)
      if (after.has(m) && !before.has(m)) t.grade.breaches.stored = ['its words are in the store']
    }
  const scores = cases.map((c) =>
    scoreCase(
      c,
      runs.filter((r) => r.id === c.id),
      options.held.has(c.id),
    ),
  )
  return {
    report: report(answerer.name, scores),
    runs,
    held: options.held,
    incomplete,
    judgeErrors,
  }
}

/** How a message is looked for in the store: lower case, trimmed. */
export const storedKey = (message: string) => message.toLowerCase().trim()

/** The run as JSON: open cases with their turns, held-back ones only in the report's counts. */
export const asJson = (o: Outcome) => ({
  report: o.report,
  incomplete: o.incomplete,
  judgeErrors: o.judgeErrors,
  runs: o.runs
    .filter((r) => !o.held.has(r.id))
    .map((r) => ({
      id: r.id,
      try: r.try,
      turns: r.turns.map((t) => ({ ask: t.ask, ...t.grade, reply: t.reply })),
    })),
})
