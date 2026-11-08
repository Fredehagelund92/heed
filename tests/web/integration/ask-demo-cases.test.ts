import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { HeedApi } from '@/api/client'
import { chatTurnOf, type Answer } from '@/model/ask'
import { parsePlan } from '../../../src/domain/ask-plan.ts'
import type { DroppedSentence } from '../../../src/domain/answer-words.ts'
import { demoCases, heldIds, type DemoCase } from '../../../src/server/modules/answer/index.ts'
import { recordsText } from '../../../src/server/modules/answer/plan-cases.ts'
import { createModelPort } from '../../../src/server/modules/models/index.ts'
import { askWorld } from './ask-world.ts'

/*
  The burned cases on the demo week, through the real service, each as the person it names: what
  plan-world.ts cannot show, since a hidden count or "my domain" depends on who asks. In every build
  they replay the plans of the last real run, with no model, so a change to a read shows here; with
  ASK_LIVE=1 and the model's key in this process they ask the real model, record what it wrote, log
  every sentence the check left out, and write a report to ASK_LIVE_OUT.

  The cases still failing are listed, so the list only shrinks: these are gates Ask failed, and
  steps 3 and 4 of the plan (one typed query, a model-led reply) are what the rest wait for.
*/

const plansFile = new URL(
  '../../../src/server/modules/answer/recorded-demo-plans.json',
  import.meta.url,
)
const live = process.env.ASK_LIVE === '1'
const tries = Number(process.env.ASK_LIVE_TRIES ?? 1)
const recorded: Record<string, string> =
  !live && existsSync(plansFile)
    ? (JSON.parse(readFileSync(plansFile, 'utf8')) as { plans: Record<string, string> }).plans
    : {}
const written: Record<string, string> = {}
const dropped: DroppedSentence[] = []

const world = askWorld({
  ...(live
    ? {
        models: createModelPort({ mode: 'live', env: process.env }),
        assistant: { provider: 'vercel-gateway', model: 'anthropic/claude-haiku-5.5' },
      }
    : {}),
  askTrace: live
    ? {
        onPlan: (prompt, text) => void (written[prompt] = text),
        onDropped: (sentences) => void dropped.push(...sentences),
      }
    : {
        planner: (input, check) => {
          const text = recorded[input.prompt]
          if (text === undefined) return Promise.resolve(null)
          const checked = check(parsePlan(text))
          return Promise.resolve(checked.ok ? checked.plan : 'missed')
        },
      },
})

/** The answer as a person reads it, in plain lines: what `must` and `refuse` are read against. */
function rendered(a: Answer, titles: ReadonlyMap<string, string>): string {
  return [
    a.limit?.sentence,
    ...(a.records ? recordsText(a.records) : [a.text]),
    ...(a.definitions ?? []).flatMap((d) => [d.name, d.words ?? '']),
    ...a.sources.map((id) => titles.get(id) ?? id),
    ...(a.reading?.facts ?? []),
    a.reading?.left ? `Not answered here: ${a.reading.left}` : null,
    a.footer?.denominator,
    a.footer?.notSeen,
    a.footer?.stale,
  ]
    .filter(Boolean)
    .join('\n')
}

const readOf = (a: Answer) => (a.reply ? 'reply' : a.records ? 'records' : 'reads')

/** What is wrong with what a case got, by kind: how it was read, its state, what it must say. */
function problems(c: DemoCase, a: Answer, text: string) {
  const e = c.expect
  const said = (p: string | RegExp) => (typeof p === 'string' ? text.includes(p) : p.test(text))
  return {
    read: [
      ...(e.read && readOf(a) !== e.read ? [`read as ${readOf(a)}, not ${e.read}`] : []),
      ...(e.state !== undefined && a.state !== e.state ? [`state ${a.state}, not ${e.state}`] : []),
    ],
    must: (e.must ?? []).filter((p) => !said(p)).map((p) => `does not say ${String(p)}`),
    refuse: (e.refuse ?? []).filter(said).map((p) => `says ${String(p)}`),
  }
}

async function ask(api: HeedApi, c: DemoCase) {
  const turn = c.setup ? chatTurnOf(await api.ask({ question: c.setup })) : undefined
  return api.ask({ question: c.question, ...(turn ? { turns: [turn] } : {}) })
}

const held = heldIds()
const open = demoCases.filter((c) => !held.has(c.id))
const back = demoCases.filter((c) => held.has(c.id))

/** The cases that fail with the last real run's plans and no model's words. */
const failingToday: readonly string[] = [
  'F04',
  'F05',
  'F19',
  'F24',
  'F25',
  'F28',
  'F30',
  'FP04',
  'G13',
  'G15',
  'G25',
  'G29',
  'GP05',
]

const runCases = async (cases: readonly DemoCase[]) => {
  const out: { c: DemoCase; bad: ReturnType<typeof problems>; text: string }[] = []
  for (const c of cases) {
    const api = await world.as(c.as)
    const { items } = await api.getLibrary()
    const titles = new Map(items.map((f) => [f.id, f.title]))
    const a = await ask(api, c)
    const text = rendered(a, titles)
    out.push({ c, bad: problems(c, a, text), text })
  }
  return out
}
const passed = (r: { bad: ReturnType<typeof problems> }) =>
  !r.bad.read.length && !r.bad.must.length && !r.bad.refuse.length

describe.runIf(!live)('the burned cases, on the plans of the last real run', () => {
  it('fail only where they are listed', async () => {
    const got = await runCases(open)
    const failing = got.filter((r) => !passed(r))
    expect(failing.map((r) => r.c.id)).toEqual([...failingToday])
  }, 300_000)

  it('held back: counts only', async () => {
    const got = await runCases(back)
    console.log(`Held back on the demo week: ${got.filter(passed).length} of ${got.length}`)
    expect(got).toHaveLength(back.length)
  }, 120_000)
})

describe.runIf(live)('the burned cases, on the real model', () => {
  it('reports by class', async () => {
    const report: Record<string, unknown>[] = []
    for (let n = 0; n < tries; n++)
      for (const r of await runCases(demoCases))
        report.push({
          id: held.has(r.c.id) ? null : r.c.id,
          held: held.has(r.c.id),
          try: n,
          class: r.c.class,
          read: !r.bad.read.length,
          must: !r.bad.must.length,
          refuse: !r.bad.refuse.length,
          ...(held.has(r.c.id) ? {} : { bad: r.bad, text: r.text }),
        })
    writeFileSync(process.env.ASK_LIVE_OUT!, JSON.stringify({ report, dropped }, null, 1))
    if (process.env.ASK_LIVE_RECORD)
      writeFileSync(plansFile, `${JSON.stringify({ plans: written }, null, 2)}\n`)
  }, 1_800_000)
})
