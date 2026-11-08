import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parsePlan } from '../../../src/domain/ask-plan.ts'
import {
  scriptedLoopModel,
  type AskTrace,
  type MadeRead,
} from '../../../src/server/modules/answer/index.ts'
import { createModelPort } from '../../../src/server/modules/models/index.ts'
import { evalCases } from '../ask-eval/cases.ts'
import { itemText, type ReadableItem, type TopicCount } from '../ask-eval/graders.ts'
import { heldOf } from '../ask-eval/held.ts'
import { agreement, judge, judgeDigest, printAgreement, type Verdicts } from '../ask-eval/judge.ts'
import { judgeSet } from '../ask-eval/judge-set.ts'
import { recordingModel, replayingModel } from '../ask-eval/loop-steps.ts'
import { asJson, evaluate, storedKey, type ReaderWorld, type RunWorld } from '../ask-eval/run.ts'
import { printReport, type Report } from '../ask-eval/score.ts'
import type { CaseRun } from '../ask-eval/types.ts'
import { evidenceOfReads, loopAnswerer, mainAnswerer, replayed } from './ask-answerers.ts'
import { ADMIN, disclosure } from './ask-disclosure.ts'
import { askWorld } from './ask-world.ts'

/*
  Ask's evaluation harness on the demo week (docs/evaluations.md): every case through the real
  service, as the person it names, graded by code on every promise, for one answerer: today's main
  (the router, the planner and the words) or Ask's loop (one model on the read tools). In every
  build it runs the answerer once a case on what the model said in the last real run, with no
  model (the main's plans, the loop's steps), and holds its failures to the lists it is given, so
  they only shrink. With ASK_EVAL_REAL=1 (`npm run eval:ask-harness -- --real`) it measures the
  judge against its labels, asks the real model three times a case, has the judge read every reply
  a model wrote, stops before ASK_EVAL_MAX_MICROS is spent, and writes the report to ASK_EVAL_OUT;
  with ASK_EVAL_RECORD=1 it keeps what the model said and the judge's verdicts the builds replay.
  The held-back cases are only ever counts.
*/

export type Answering = {
  answerer: 'main' | 'loop'
  /** What it breaks in every build, by promise, and the open cases that miss what they must say. */
  brokenToday: Partial<Record<keyof Report['byPromise'], string[]>>
  missingToday: readonly string[]
  /** The held-back cases that pass every try in every build: a count. */
  heldPassingToday: number
}

const MODEL = { provider: 'vercel-gateway', model: 'anthropic/claude-haiku-5.5' }

/**
 * A real run's journal, one line as each try of a case is graded, with what the model said in it
 * and what was spent so far, so a run that dies keeps what it paid for. ASK_EVAL_RESUME names the
 * journal of a run to go on with: its tries, its recordings, its judge's labels and its spend
 * carry over. `plans` holds the main's plans, or the loop's steps.
 */
type JournalLine =
  | { type: 'start'; creditsMicros: number | null }
  | { type: 'judge set'; verdicts: Record<string, Verdicts | null>; spentMicros: number }
  | { type: 'run'; run: CaseRun; plans: Record<string, string>; spentMicros: number }

export function askEvalSuite(side: Answering) {
  const real = process.env.ASK_EVAL_REAL === '1'
  const tries = Number(process.env.ASK_EVAL_TRIES ?? (real ? 3 : 1))
  const ceiling = Number(process.env.ASK_EVAL_MAX_MICROS ?? 0)
  const only = process.env.ASK_EVAL_CASES?.split(',').filter(Boolean)
  const loop = side.answerer === 'loop'

  const plansFile = new URL(
    loop ? './ask-eval-loop-steps.json' : './ask-eval-plans.json',
    import.meta.url,
  )
  const demoPlansFile = new URL(
    '../../../src/server/modules/answer/recorded-demo-plans.json',
    import.meta.url,
  )
  const verdictsFile = new URL('../ask-eval/judge-verdicts.json', import.meta.url)
  const plansIn = (file: URL): Record<string, string> =>
    existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as { plans: Record<string, string> }).plans
      : {}
  const recorded = real
    ? {}
    : loop
      ? plansIn(plansFile)
      : { ...plansIn(demoPlansFile), ...plansIn(plansFile) }
  const written: Record<string, string> = {}

  const journal = process.env.ASK_EVAL_OUT ? `${process.env.ASK_EVAL_OUT}.jsonl` : undefined
  const resumed: JournalLine[] = process.env.ASK_EVAL_RESUME
    ? readFileSync(process.env.ASK_EVAL_RESUME, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as JournalLine)
    : []
  const write = (line: JournalLine) => {
    if (journal && real) appendFileSync(journal, `${JSON.stringify(line)}\n`)
  }
  // An unanswered try is no result: going on asks it again.
  const resumedRuns = resumed.flatMap((l) => (l.type === 'run' && !l.run.unanswered ? [l.run] : []))
  const resumedLabels = resumed.findLast((l) => l.type === 'judge set')
  /** What the run being resumed had spent, by its own meter. */
  const spentBefore = resumed.reduce(
    (n, l) => ('spentMicros' in l ? Math.max(n, l.spentMicros) : n),
    0,
  )
  for (const l of resumed) if (l.type === 'run') Object.assign(written, l.plans)

  const models = real ? createModelPort({ mode: 'live', env: process.env }) : undefined
  // The reads of the loop's last turn, and the chat's earlier reads made again: what it read.
  let lastReads: { made: readonly MadeRead[]; earlier: readonly MadeRead[] } = {
    made: [],
    earlier: [],
  }
  // The steps a build takes that no real run recorded: the scripted reader's.
  const missed = { steps: 0 }
  const askTrace: AskTrace = loop
    ? {
        loopModel: models
          ? recordingModel(models.choose('assistant', MODEL), written)
          : replayingModel(recorded, scriptedLoopModel(), missed),
        onLoopTurn: (made, earlier) => void (lastReads = { made, earlier }),
      }
    : real
      ? { onPlan: (prompt, text) => void (written[prompt] ??= text) }
      : {
          planner: (input, check) => {
            const text = recorded[input.prompt]
            if (text === undefined) return Promise.resolve(null)
            const checked = check(parsePlan(text))
            return Promise.resolve(checked.ok ? checked.plan : 'missed')
          },
        }
  const world = askWorld({
    ...(models ? { models, assistant: MODEL } : {}),
    askTrace,
    ...(loop ? { askLoop: true } : {}),
  })
  const answerer = loop
    ? loopAnswerer(
        () => evidenceOfReads([...lastReads.made, ...lastReads.earlier]),
        () => void (lastReads = { made: [], earlier: [] }),
      )
    : mainAnswerer
  const { expectedRows } = disclosure((name) => world.as(name))

  const readers = new Map<string, Promise<ReaderWorld>>()

  /** What the graders know of a person: what they may read, and what they may see of each topic. */
  const known = (name: string) => {
    const cached = readers.get(name)
    if (cached) return cached
    const made = (async (): Promise<ReaderWorld> => {
      const mine = await (await world.as(name)).contextPage()
      const all = await (await world.as(ADMIN)).contextPage()
      const readable = new Map<string, ReadableItem>(
        mine.map((f) => [f.id, { title: f.title, text: itemText(f), status: f.status }]),
      )
      const titles = new Set(mine.map((f) => f.title))
      const unreadable = all
        .filter((f) => !readable.has(f.id) && !titles.has(f.title))
        .map((f) => f.title)
      const topics: TopicCount[] = [...(await expectedRows(name))].map(([title, cell]) => {
        const n = cell ? (cell.count ?? cell.atLeast) : 0
        const listed = !!cell && n >= 5
        return { title, shown: listed ? n : null, floor: listed && cell.count === null }
      })
      return { readable, unreadable, topics }
    })()
    readers.set(name, made)
    return made
  }

  /** What the service's meter has spent in this run's database since the run began, in micros. */
  let seeded: number | undefined
  const spentByService = async () => {
    const { rows } = await world.client.query<{ micros: string }>(
      'select coalesce(sum(cost_micros), 0) as micros from llm_spend_monthly',
    )
    // The demo week's own history of spend is there before the run.
    seeded ??= Number(rows[0]!.micros)
    return Number(rows[0]!.micros) - seeded
  }

  /**
   * Which messages are in any table: a question's words are kept nowhere (FR-602). Only messages
   * of 12 characters or more are looked for, so a short one does not match by chance.
   */
  async function stored(messages: readonly string[]): Promise<Set<string>> {
    const wanted = [...new Set(messages.map(storedKey))].filter((m) => m.length >= 12)
    const { rows: tables } = await world.client.query<{ name: string }>(
      `select format('%I.%I', table_schema, table_name) as name from information_schema.tables
        where table_type = 'BASE TABLE' and table_schema not in ('pg_catalog', 'information_schema')`,
    )
    const found = new Set<string>()
    for (const { name } of tables) {
      const { rows } = await world.client.query<{ m: string }>(
        `select m from unnest($1::text[]) m
          where exists (select 1 from ${name} r where strpos(lower(r::text), m) > 0)`,
        [wanted],
      )
      for (const { m } of rows) found.add(m)
    }
    return found
  }

  const judgeChoice = models?.choose('judge', MODEL)
  let judgeMicros = 0
  const journaled = new Set<string>(Object.keys(written))
  /** Everything this run and the one it resumes have spent: the service's meter and the judge's. */
  const spentSoFar = async () => spentBefore + (await spentByService()) + judgeMicros

  const runWorld: RunWorld = {
    reader: async (name) => ({ name, api: await world.as(name) }),
    known,
    stored,
    ...(judgeChoice
      ? {
          judge: async (input) => {
            const { verdicts, micros } = await judge(judgeChoice, input)
            judgeMicros += micros
            return verdicts
          },
          spent: async () => (await spentSoFar()) >= ceiling,
          done: async (run) => {
            const plans = Object.fromEntries(
              Object.entries(written).filter(([p]) => !journaled.has(p)),
            )
            for (const p of Object.keys(plans)) journaled.add(p)
            write({ type: 'run', run, plans, spentMicros: await spentSoFar() })
          },
        }
      : {}),
  }

  const cases = only ? evalCases.filter((c) => only.includes(c.id)) : evalCases
  const held = heldOf(evalCases)

  /**
   * ASK_EVAL_REPLAY names a real run's journal: its replies and its judge's findings are graded
   * again on the demo week, with no model, so a change to a grader reads a real run at no cost.
   */
  const replay = process.env.ASK_EVAL_REPLAY

  describe.runIf(!!replay)('the evaluation harness, grading a real run again', () => {
    it('reports by class and by promise', async () => {
      const lines = readFileSync(replay!, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as JournalLine)
      const runs = lines.flatMap((l) => (l.type === 'run' && !l.run.unanswered ? [l.run] : []))
      const { answerer: again, judged } = replayed(
        `${answerer.name}, as recorded`,
        runs,
        (id) => evalCases.find((c) => c.id === id)!.as,
      )
      const outcome = await evaluate(
        { ...runWorld, judge: (input) => Promise.resolve(judged(input.reply)) },
        again,
        cases,
        {
          tries: Math.max(...runs.map((r) => r.try)) + 1,
          held,
        },
      )
      const text = printReport(outcome.report)
      console.log(text)
      writeFileSync(
        process.env.ASK_EVAL_OUT!,
        JSON.stringify({ text, ...asJson(outcome) }, null, 1),
      )
    }, 600_000)
  })

  describe.runIf(!real && !replay)(
    `the evaluation harness, on ${answerer.name} with the last real ${loop ? 'steps' : 'plans'}`,
    () => {
      it('fails only where it is listed', async () => {
        const outcome = await evaluate(runWorld, answerer, cases, { tries, held })
        const text = [
          printReport(outcome.report),
          ...(loop
            ? [
                `${missed.steps} steps were not recorded by a real run: the scripted reader took them.`,
              ]
            : []),
        ].join('\n\n')
        console.log(text)
        if (process.env.ASK_EVAL_OUT)
          writeFileSync(
            process.env.ASK_EVAL_OUT,
            JSON.stringify({ text, ...asJson(outcome) }, null, 1),
          )
        if (only) return
        for (const [p, { ids }] of Object.entries(outcome.report.byPromise))
          expect(ids, p).toEqual(side.brokenToday[p as keyof Report['byPromise']] ?? [])
        expect(
          outcome.runs
            .filter((r) => !held.has(r.id) && r.turns.some((t) => t.grade.misses.length))
            .map((r) => r.id),
        ).toEqual(side.missingToday)
        expect(outcome.report.held.all.passK).toBe(side.heldPassingToday)
      }, 600_000)
    },
  )

  describe.runIf(real)('the evaluation harness, on the real model', () => {
    let measured = ''
    let labelled: Record<string, Verdicts | null> = {}

    let creditsAtStart: number | null = null

    it('measures the judge against its labels', async () => {
      await spentByService()
      // The gateway's own counter of what the key used: another use of the key moves it too.
      creditsAtStart = await models!.creditsUsed(MODEL.provider).catch(() => null)
      write({ type: 'start', creditsMicros: creditsAtStart })
      // A run that goes on with another keeps its tries in this journal too, so this one is whole.
      resumedRuns.forEach((run, i) =>
        write({ type: 'run', run, plans: i ? {} : { ...written }, spentMicros: spentBefore }),
      )
      const verdicts = new Map<string, Verdicts | null>(
        resumedLabels?.type === 'judge set' ? Object.entries(resumedLabels.verdicts) : [],
      )
      // The judge's labelled set is measured once a run; ASK_EVAL_JUDGE_SET=0 leaves it out.
      if (process.env.ASK_EVAL_JUDGE_SET !== '0')
        for (const example of judgeSet) {
          if (verdicts.has(example.id)) continue
          const { verdicts: v, micros } = await judge(judgeChoice!, example)
          judgeMicros += micros
          verdicts.set(example.id, v)
        }
      write({
        type: 'judge set',
        verdicts: Object.fromEntries(verdicts),
        spentMicros: await spentSoFar(),
      })
      labelled = Object.fromEntries(verdicts)
      measured = verdicts.size
        ? `The judge against its ${judgeSet.length} labelled replies:\n${printAgreement(agreement(judgeSet, verdicts))}`
        : 'The judge was not measured against its labels in this run.'
      console.log(measured)
      if (process.env.ASK_EVAL_RECORD && verdicts.size)
        writeFileSync(
          verdictsFile,
          `${JSON.stringify(
            {
              digest: judgeDigest(MODEL.model, judgeSet),
              model: MODEL.model,
              verdicts: Object.fromEntries(verdicts),
            },
            null,
            2,
          )}\n`,
        )
    }, 600_000)

    it('reports by class and by promise', async () => {
      if (!ceiling) throw new Error('A real run needs ASK_EVAL_MAX_MICROS.')
      // One chat at a time: the loop's reads of a reply are the last ones it heard, and today's
      // main deadlocks the service's pool with as many live chats at once as it has connections
      // (a look-up holds one for its whole request while its planner opens a second).
      const outcome = await evaluate(runWorld, answerer, cases, {
        tries,
        held,
        prior: resumedRuns,
      })
      const spent = await spentSoFar()
      const credits = await models!.creditsUsed(MODEL.provider).catch(() => null)
      const text = [
        measured,
        printReport(outcome.report),
        `Spent ${(spent / 1e6).toFixed(4)} USD by the meters (this process's judge ${(judgeMicros / 1e6).toFixed(4)}${spentBefore ? `, the run it resumes ${(spentBefore / 1e6).toFixed(4)}` : ''}); the gateway's counter moved ${credits !== null && creditsAtStart !== null ? `${((credits - creditsAtStart) / 1e6).toFixed(4)} USD in this process` : 'by an unknown amount'}. ${outcome.judgeErrors} judge errors${outcome.incomplete ? '. Stopped at the ceiling: the run is incomplete' : ''}.`,
      ].join('\n\n')
      console.log(text)
      writeFileSync(
        process.env.ASK_EVAL_OUT!,
        JSON.stringify(
          {
            text,
            ...asJson(outcome),
            judgeSet: labelled,
            spentMicros: { all: spent, judge: judgeMicros },
          },
          null,
          1,
        ),
      )
      if (process.env.ASK_EVAL_RECORD)
        writeFileSync(plansFile, `${JSON.stringify({ plans: written }, null, 2)}\n`)
    }, 10_800_000)
  })
}
