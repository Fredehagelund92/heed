import { writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { LoopBlock, LoopTurn } from '@contract/answer'
import type { Answer } from '@/model/ask'
import {
  scriptedLoopChoice,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../../src/server/modules/answer/index.ts'
import { askWorld } from './ask-world.ts'

/*
  The shapes of Ask's loop answers on the demo week (FR-349, FR-718 to FR-720), through the real
  service and the browser's own binding, each turn's words scripted as a model would write them:
  typed mentions of what the reads named, references to the reads' numbers, citations, a short
  list, a list of a read's items, and an overview of the Inbox and of the records. What the page
  draws is code's, from the reads, and these hold it: every chip a read named, every count a read's
  own, every row a read's item, an overview's total its groups' sum. With LOOP_SHAPES_OUT set, the
  turns are written there as the mock's examples (src/web/api/mock/data/loop-examples.json).
*/

const JON = 'Jon Abara'
type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter(isObj) : [])

/** What the scripted model has read this turn, by tool: the last read of each, and its ref. */
const readOf = (prompt: ScriptedPrompt, tool: string) => {
  const found = [...prompt.results].reverse().find((r) => r.toolName === tool)
  const value = isObj(found?.value) ? found.value : {}
  return { ...value, ref: typeof value.ref === 'string' ? value.ref : 'r0' } as Obj & { ref: string }
}
const mention = (id: unknown) => `[@${String(id)}]`

/** One case: the question, who asks, the reads, then the words written from what they returned. */
type Case = {
  id: string
  question: string
  calls: ScriptedStep['calls']
  write: (p: ScriptedPrompt) => ScriptedStep
}

const cases: Case[] = [
  {
    id: 'loop-checked',
    question: "Why is the last day of Germany's orders always low?",
    calls: [
      {
        toolName: 'get_context',
        input: { about: 'orders in Germany', from: '2026-10-01', to: '2026-10-23' },
      },
    ],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const item = arr(r.items)[0]!
      const about = (r.read as Obj).about as string[]
      return {
        text: `The payment files for ${mention(about[1])} reach the source tool the morning after, so the last day of ${mention(about[0])} is always short [${String(item.id)}].`,
      }
    },
  },
  {
    id: 'loop-missing',
    question: 'Give me all about orders in poland',
    calls: [
      { toolName: 'get_context', input: { about: 'orders in Poland', widen: { without: 'values' } } },
    ],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const about = (r.read as Obj).about as string[]
      return { text: `Nothing written covers ${mention(about[0])} in ${mention(about[1])}.` }
    },
  },
  {
    id: 'loop-conflict',
    question: 'Does net revenue in Spain include VAT?',
    calls: [{ toolName: 'get_context', input: { about: 'net revenue in Spain' } }],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const [a, b] = arr(r.items)
      return {
        text: `Two items disagree. One in ${mention(a!.domainId)} says it includes VAT [${String(a!.id)}]; one in ${mention(b!.domainId)} says it excludes VAT [${String(b!.id)}].`,
      }
    },
  },
  {
    id: 'loop-stale',
    question: 'What happened with price promotions in Italy?',
    calls: [{ toolName: 'find_context', input: { words: 'price promotions Italy' } }],
    write: (p) => {
      const r = readOf(p, 'find_context')
      const item = arr(r.items).find((i) => i.outOfDate) ?? arr(r.items)[0]!
      return {
        text: `The regulator paused price promotions in ${mention((item.about as string[]).find((x) => x.startsWith('value:')))}, so discount cost there dropped to near zero [${String(item.id)}]. The item was last checked on [#${r.ref}.items.${arr(r.items).indexOf(item)}.checked.date].`,
      }
    },
  },
  {
    id: 'loop-list',
    question: 'List the events in Sales',
    calls: [{ toolName: 'records', input: { kinds: ['event'], domain: 'Sales', status: ['live', 'due'] } }],
    write: (p) => {
      const r = readOf(p, 'records')
      return {
        text: `${mention((arr(r.items)[0]?.domainId as string) ?? 'domain:area_sales')} has [#${r.ref}.count] of [#${r.ref}.outOf].\n\n[list:${r.ref}]`,
      }
    },
  },
  {
    id: 'loop-long',
    question: 'What should I know about orders in Norway?',
    calls: [{ toolName: 'get_context', input: { about: 'orders in Norway' } }],
    write: (p) => {
      const r = readOf(p, 'get_context')
      const items = arr(r.items)
      const about = (r.read as Obj).about as string[]
      const pair = items.filter((i) => (i.disagreesWith as string[]).length)
      const lines = items.slice(0, 3).map((i) => `- ${String(i.title)} [${String(i.id)}]`)
      return {
        text: `[#${r.ref}.items.length] items apply to ${mention(about[0])} in ${mention(about[1])}${pair.length ? ', and two of them disagree' : ''}:\n${lines.join('\n')}`,
      }
    },
  },
  {
    id: 'loop-overview',
    question: 'what do i need to handle?',
    calls: [{ toolName: 'inbox', input: { limit: 25 } }],
    write: (p) => ({
      calls: [{ toolName: 'show_overview', input: { from: readOf(p, 'inbox').ref } }],
    }),
  },
  {
    id: 'loop-overview-due',
    question: 'What is out of date?',
    calls: [{ toolName: 'records', input: { status: ['due'], group_by: 'domain', show: 'list' } }],
    write: (p) => ({
      calls: [{ toolName: 'show_overview', input: { from: readOf(p, 'records').ref } }],
    }),
  },
  {
    id: 'loop-overview-domain',
    question: 'How does Sales stand?',
    calls: [{ toolName: 'records', input: { domain: 'Sales', group_by: 'status', show: 'list' } }],
    write: (p) => ({
      calls: [{ toolName: 'show_overview', input: { from: readOf(p, 'records').ref } }],
    }),
  },
  {
    id: 'loop-question',
    question: 'When did the payment provider switch?',
    calls: [{ toolName: 'find_context', input: { words: 'payment provider switch' } }],
    write: () => ({
      calls: [
        {
          toolName: 'ask_back',
          input: { question: 'Which switch do you mean?', choices: ['In France', 'In Spain'] },
        },
      ],
    }),
  },
]

let current: Case | undefined
const world = askWorld({
  askLoop: true,
  askTrace: {
    loopModel: scriptedLoopChoice('shapes', (prompt) =>
      prompt.step === 0 ? { calls: current!.calls } : current!.write(prompt),
    ),
  },
})

const turns: Record<string, Answer> = {}
const ask = async (c: Case) => {
  current = c
  const api = await world.as(JON)
  const answer = await api.ask({ question: c.question })
  turns[c.id] = answer
  return answer.loop!
}
const runsOf = (body: readonly LoopBlock[]) =>
  body.flatMap((b) => (b.t === 'p' ? b.runs : b.t === 'ul' ? b.items.flat() : []))

describe("Ask's loop answers, as the page draws them", () => {
  it('draws each noun as a chip a read named, and each citation as a source', async () => {
    const loop = await ask(cases[0]!)
    const nouns = runsOf(loop.body).filter((r) => r.t === 'noun')
    expect(nouns.length).toBeGreaterThan(1)
    for (const n of nouns) expect(loop.nouns.map((x) => x.id)).toContain(n.id)
    expect(runsOf(loop.body).some((r) => r.t === 'cite')).toBe(true)
    expect(loop.state).toBe('grounded')
    expect(loop.subject?.assumedToday).toBe(false)
    expect(loop.checks).toEqual([])
    // The plain words keep the names and the numbered citations the graders read.
    expect(loop.text).toMatch(/Orders/)
    expect(loop.text).toMatch(/\[1\]/)
  })

  it('lists what is written nearest a Not found, counted by the dimension it narrowed', async () => {
    const loop = await ask(cases[1]!)
    expect(loop.state).toBe('missing')
    expect(loop.sources).toEqual([])
    const by = loop.closest?.by
    expect(by).toMatch(/^dimension:/)
    // Each count is by code from the items listed, for a value of that dimension the question did not name.
    const items = new Map(loop.items.map((i) => [i.id, i]))
    for (const c of loop.closest!.counts) {
      expect(loop.subject?.about).not.toContain(c.id)
      const named = loop.closest!.items.filter((id) => items.get(id)?.about.includes(c.id))
      expect(named.length).toBe(c.count)
    }
    expect(new Set(loop.closest!.items).size).toBe(loop.closest!.items.length)
    expect(loop.owners.length).toBeGreaterThan(0)
    expect(loop.footer.denominator).toMatch(/^0 of \d+ /)
  })

  it('gives Conflict when two applying items an owner marked as disagreeing are in two domains', async () => {
    const loop = await ask(cases[2]!)
    expect(loop.state).toBe('conflict')
    expect(loop.conflict).toHaveLength(2)
    const domains = loop.items.filter((i) => loop.conflict.includes(i.id)).map((i) => i.domain)
    expect(new Set(domains).size).toBe(2)
  })

  it('fills a number reference from its read, and marks an item that may be out of date', async () => {
    const loop = await ask(cases[3]!)
    expect(runsOf(loop.body).some((r) => r.t === 'date')).toBe(true)
    expect(loop.state).toBe('stale')
    expect(loop.items.some((i) => i.status === 'due')).toBe(true)
  })

  it("draws a read's items as rows when the words ask for its list", async () => {
    const loop = await ask(cases[4]!)
    const list = loop.body.find((b) => b.t === 'list')
    expect(list?.t === 'list' && list.rows.length).toBeGreaterThan(0)
    const counts = runsOf(loop.body).filter((r) => r.t === 'count')
    expect(counts.length).toBe(2)
    expect(counts[1]?.t === 'count' && counts[1].of).toMatch(/context items/)
    expect(loop.text).toMatch(/^- /m)
  })

  it("draws the model's short list as a list, each line with its own citation", async () => {
    const loop = await ask(cases[5]!)
    const ul = loop.body.find((b) => b.t === 'ul')
    expect(ul?.t === 'ul' && ul.items.length).toBeGreaterThanOrEqual(2)
    if (ul?.t === 'ul') for (const line of ul.items) expect(line.some((r) => r.t === 'cite')).toBe(true)
  })

  it('answers what needs the person as an overview of their Inbox: groups, counts and rows by code', async () => {
    const loop = await ask(cases[6]!)
    const o = loop.overview!
    expect(o.from).toBe('inbox')
    expect(o.total).toBe(o.groups.reduce((n, g) => n + g.count, 0))
    expect(o.groups.length).toBeGreaterThan(2)
    for (const g of o.groups) expect(g.rows.length + g.more).toBe(g.count)
    expect(loop.state).toBeNull()
    // A row about an item the person may read cites it.
    const items = new Set(o.groups.flatMap((g) => g.rows.flatMap((r) => r.item ?? [])))
    expect(items.size).toBe(loop.sources.length)
  })

  it('answers what is out of date as an overview of the records, by domain', async () => {
    const loop = await ask(cases[7]!)
    const o = loop.overview!
    expect(o.from).toBe('records')
    expect(o.by).toBe('domain')
    expect(o.total).toBe(o.groups.reduce((n, g) => n + g.count, 0))
    // Each row says why it is due, and its day is the one that says it.
    for (const row of o.groups.flatMap((g) => g.rows))
      expect(row.status).toMatch(/^its (check date passed|definition changed|source is missing)$/)
    expect(loop.footer.denominator).toBeNull()
  })

  it("answers how a domain stands as an overview of its records, what needs a check first", async () => {
    const loop = await ask(cases[8]!)
    const o = loop.overview!
    expect(o.by).toBe('status')
    expect(o.groups[0]?.key).toBe('due')
  })

  it('asks one question back with its choices and no state', async () => {
    const loop = await ask(cases[9]!)
    expect(loop.kind).toBe('question')
    expect(loop.state).toBeNull()
    expect(loop.choices).toEqual(['In France', 'In Spain'])
  })

  it('writes the examples the mock shows, when asked to', () => {
    const out = process.env.LOOP_SHAPES_OUT
    if (!out) return
    const examples = Object.fromEntries(
      Object.entries(turns).map(([id, a]) => [id, { question: a.question, turn: a.loop as LoopTurn }]),
    )
    writeFileSync(out, `${JSON.stringify(examples, null, 2)}\n`)
  })
})
