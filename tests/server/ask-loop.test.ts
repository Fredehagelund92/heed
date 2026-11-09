import { describe, expect, it } from 'vitest'
import type { LookupEvent, LoopTurn } from '../../src/contract/answer.ts'
import type { Database } from '../../src/server/db/database.ts'
import {
  askLoop,
  loopSystem,
  readLines,
  scriptedLoopChoice,
  turnOf,
  type AskTools,
  type LoopDeps,
  type MadeRead,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../src/server/modules/answer/index.ts'

/*
  Ask's loop without a database (FR-718 to FR-720): what code writes from the reads (the citations
  checked against the ids the reads returned, the answer state, the footer and what was read), and
  the loop itself on a scripted model: its step and time limits, a model that fails, one question
  back, the chat's earlier reads made again, and one connection at a time. The loop on the real
  service is tests/web/integration/ask-loop.test.ts; the pool, ask-loop-pool.test.ts.
*/

const outOf = { count: 21, of: 'published context items you may read' }
const searched = (words: string, found: number) => ({
  words,
  names: [],
  period: 'any date',
  kinds: ['event', 'warning', 'rule', 'guide'],
  domain: null,
  without: null,
  found,
})
const item = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: `Item ${id}`,
  summary: `What ${id} says.`,
  outOfDate: null,
  ...extra,
})
const get = (
  state: string,
  items: object[],
  nearby: string[] = [],
  ids = [...items.map((i) => (i as { id: string }).id), ...nearby],
): MadeRead => ({
  tool: 'get_context',
  input: { about: 'orders in Poland' },
  result: {
    state,
    read: { words: 'orders in Poland', names: ['Orders', 'Poland'], period: 'any date' },
    items,
    nearby: nearby.map((id) => ({ id, title: `Item ${id}`, kind: 'warning', why: 'other values' })),
    wider: null,
    searched: [searched('orders in Poland', items.length)],
    outOf,
    more: 0,
    ids,
  },
})
const find = (items: (object & { match: string })[], everyWord: number): MadeRead => ({
  tool: 'find_context',
  input: { words: 'payment provider' },
  result: {
    found: items.length,
    everyWord,
    items,
    definitions: [
      { id: 'metric:orders', name: 'Orders', words: 'Paid orders.', source: 'Cube (orders)' },
    ],
    searched: [searched('payment provider', everyWord)],
    outOf,
    more: 2,
    ids: [...items.map((i) => (i as unknown as { id: string }).id), 'metric:orders'],
  },
})
const records = (ids: string[]): MadeRead => ({
  tool: 'records',
  input: { about: ['Norway'] },
  result: {
    count: ids.length,
    outOf: { count: 23, of: 'context items you may read' },
    counted: `${ids.length} of 23 context items you may read`,
    items: ids.map((id) => item(id)),
    more: 0,
    ids,
  },
})

describe('what code writes from the reads', () => {
  it('numbers the citations a read returned, and drops the ones no read returned', () => {
    const t = turnOf(
      'Germany lags [itm_germany01]. Also [itm_unknown1, itm_france001]. And [metric:orders].',
      [
        find(
          [
            { ...item('itm_germany01'), match: 'all' },
            { ...item('itm_france001'), match: 'all' },
          ],
          2,
        ),
      ],
      [],
    )
    expect(t.text).toBe('Germany lags [1]. Also [2]. And.')
    expect(t.sources).toEqual(['itm_germany01', 'itm_france001'])
    // A definition's id is no source, and the question asks nothing a definition adds to.
    expect(t.definitions).toEqual([])
  })

  it('cites an id the words name bare, when a read returned it', () => {
    const t = turnOf(
      'The due item, itm_germany01, is past its date.',
      [find([{ ...item('itm_germany01'), match: 'all' }], 1)],
      [],
    )
    expect(t.text).toBe('The due item, [1], is past its date.')
    expect(t.sources).toEqual(['itm_germany01'])
  })

  it('takes the state from the read about the subject: Not found, its nearby items listed and not used', () => {
    // The subject read found nothing; the words cite items it gave as nearby, and items a search
    // matched on some of its words only.
    const t = turnOf(
      'Nothing is written about orders in Poland. Germany lags (by a day [itm_germany01]) and France switched [itm_france001].',
      [
        get('missing', [], ['itm_germany01', 'itm_norway001']),
        find([{ ...item('itm_france001'), match: 'some' }], 0),
      ],
      [],
    )
    expect(t.state).toBe('missing')
    expect(t.sources).toEqual([])
    expect(t.text).toBe(
      'Nothing is written about orders in Poland. Germany lags (by a day) and France switched.',
    )
    expect(t.nearby).toEqual(['itm_germany01', 'itm_france001', 'itm_norway001'])
  })

  it('takes what the cited items are when a search found what the subject read did not', () => {
    const t = turnOf(
      'France moved on 12 May [itm_france001] and on 21 May [itm_france002].',
      [
        get('missing', []),
        find(
          [
            { ...item('itm_france001'), match: 'all' },
            { ...item('itm_france002', { outOfDate: 'its check date has passed' }), match: 'all' },
          ],
          2,
        ),
      ],
      [],
    )
    expect(t.state).toBe('stale')
    expect(t.sources).toEqual(['itm_france001', 'itm_france002'])
    expect(t.footer.stale).toBe(
      '“Item itm_france002” may be out of date: its check date has passed.',
    )
  })

  it("takes the subject read's state when the words cite what it found", () => {
    const t = turnOf(
      'Two items disagree [itm_norway001] [itm_norway002].',
      [
        get('conflict', [
          item('itm_norway001', { disagreesWith: ['itm_norway002'] }),
          item('itm_norway002', { disagreesWith: ['itm_norway001'] }),
        ]),
      ],
      [],
    )
    expect(t.state).toBe('conflict')
    // The two that disagree, as the read marks them, for the page to name.
    expect(t.conflict).toEqual(['itm_norway001', 'itm_norway002'])
  })

  it('uses a search that matched some words when no read was about the subject', () => {
    const t = turnOf(
      'The switch [itm_france001].',
      [find([{ ...item('itm_france001'), match: 'some' }], 0)],
      [],
    )
    expect(t.state).toBe('grounded')
    expect(t.sources).toEqual(['itm_france001'])
  })

  it('gives an answer from the records no state, with its items as sources', () => {
    const made = [records(['itm_norway001', 'itm_norway002']), get('missing', [])]
    const listed = turnOf('Nine items [itm_norway001] [itm_norway002].', made, [])
    expect(listed.state).toBeNull()
    expect(listed.sources).toEqual(['itm_norway001', 'itm_norway002'])
    expect(turnOf('Nine items are about Norway.', made, []).state).toBeNull()
    expect(listed.footer.denominator).toBe('Counted 2 of 23 context items you may read.')
  })

  it('gives a turn that read nothing no state, and Not found after a search that found nothing', () => {
    expect(turnOf('I cannot answer that.', [], []).state).toBeNull()
    expect(turnOf('Nothing is written.', [find([], 0)], []).state).toBe('missing')
  })

  it('writes what was read and the footer from the reads, never from the words', () => {
    const made = [get('missing', [], ['itm_germany01']), find([], 0)]
    expect(readLines(made)).toEqual([
      'Looked up Orders and Poland, any date: 0 items apply, 1 nearby item does not.',
      'Searched “payment provider”, any date: 0 found.',
    ])
    const t = turnOf('Nothing.', made, [])
    expect(t.footer).toEqual({
      denominator: '0 of 21 published context items you may read apply.',
      notSeen: 'The reads found 2 items more than they listed for Ask.',
      stale: null,
    })
  })

  it('cites an id an earlier read returned, made again this turn', () => {
    const earlier = [find([{ ...item('itm_germany01'), match: 'all' }], 1)]
    const t = turnOf('As before, Germany lags [itm_germany01].', [], earlier)
    expect(t.sources).toEqual(['itm_germany01'])
    // Read nothing of its own: it is about the reads it cites, made again.
    expect(t.state).toBe('grounded')
    expect(turnOf('I cannot answer that.', [], earlier).state).toBeNull()
  })
})

describe('the instructions', () => {
  it('say who is asking by what is theirs only, and name no case', () => {
    const system = loopSystem('2026-10-23', { admin: false, owns: ['Sales'] })
    expect(system).toContain('Today is Friday, 23 October 2026 (UTC).')
    expect(system).toContain('They own the domain Sales.')
    // No example of a question, and no market or metric of the demo.
    expect(system).not.toMatch(/Poland|Norway|Orders|are you sure|"/i)
  })
})

/* ---------- the loop on a scripted model ---------- */

/** A database that counts the transactions open at once, each taking a moment. */
function countingDatabase() {
  const seen = { open: 0, most: 0, made: 0 }
  const database: Database = {
    ping: () => Promise.resolve(),
    query: () => Promise.resolve([]),
    close: () => Promise.resolve(),
    async transaction(_person, work) {
      seen.open++
      seen.made++
      seen.most = Math.max(seen.most, seen.open)
      try {
        await new Promise((done) => setTimeout(done, 10))
        return await work({ query: () => Promise.resolve([]) })
      } finally {
        seen.open--
      }
    },
  }
  return { database, seen }
}

/** Tools that answer each read from `results`, and keep what they were asked. */
function fakeTools(results: (name: string, input: unknown) => unknown = () => ({ ids: [] })) {
  const asked: { name: string; input: unknown }[] = []
  const tools = {
    run: (name: string, input: unknown) => {
      asked.push({ name, input })
      return Promise.resolve(results(name, input))
    },
    ai: () => ({}),
  } as unknown as AskTools
  return { tools, asked }
}

async function turnWith(
  decide: (prompt: ScriptedPrompt) => ScriptedStep,
  options: Partial<LoopDeps> & { turns?: Parameters<typeof askLoop>[1]['turns'] } = {},
) {
  const { database, seen } = countingDatabase()
  const { tools, asked } = fakeTools(
    (name, input) =>
      ({
        get_context: get('missing', [], ['itm_germany01']).result,
        find_context: find([{ ...item('itm_germany01'), match: 'all' }], 1).result,
        read_context: { found: false, item: null, nothing: 'none', ids: [] },
      })[name] ?? { input, ids: [] },
  )
  const errors: unknown[] = []
  const events: LookupEvent[] = []
  const { turns, ...rest } = options
  for await (const event of askLoop(
    {
      database,
      person: 'p1',
      toolsIn: () => tools,
      model: scriptedLoopChoice('test', decide),
      limits: null,
      asker: { admin: false, owns: [] },
      today: '2026-10-23',
      steps: 6,
      timeoutMs: 5_000,
      onError: (e) => errors.push(e),
      ...rest,
    },
    { question: 'what is written?', ...(turns ? { turns } : {}) },
  ))
    events.push(event)
  const turn = events.findLast((e) => e.type === 'turn')?.turn as LoopTurn
  return { turn, events, seen, asked, errors }
}

describe("Ask's loop on a scripted model", () => {
  it('reads, then answers, saying what each read does as it starts', async () => {
    const { turn, events } = await turnWith(({ results }) =>
      results.length
        ? { text: 'Germany lags [itm_germany01].' }
        : { calls: [{ toolName: 'find_context', input: { words: 'germany' } }] },
    )
    // Each read as it starts, then once done, with what it found: by code, from the read.
    expect(events.filter((e) => e.type === 'progress')).toEqual([
      {
        type: 'progress',
        working: 'Searching the context for “germany”…',
        steps: [
          { runs: [{ t: 'text', text: 'Searching the context for “germany”…' }], done: false },
        ],
        nouns: [],
      },
      {
        type: 'progress',
        working: 'Writing the answer…',
        steps: [
          {
            runs: [{ t: 'text', text: 'Searched “payment provider”, any date: 1 found' }],
            done: true,
          },
        ],
        nouns: [],
      },
    ])
    expect(turn).toMatchObject({ kind: 'answer', sources: ['itm_germany01'], state: 'grounded' })
    expect(turn.reads).toEqual([{ tool: 'find_context', input: { words: 'germany', limit: 10 } }])
  })

  it('makes the reads of one step one after the other: one connection at a time', async () => {
    const { seen, asked } = await turnWith(({ results }) =>
      results.length
        ? { text: 'Done.' }
        : {
            calls: [
              { toolName: 'get_context', input: { about: 'a' } },
              { toolName: 'find_context', input: { words: 'b' } },
              { toolName: 'read_context', input: { id: 'itm_germany01' } },
            ],
          },
    )
    expect(asked.map((a) => a.name)).toEqual(['get_context', 'find_context', 'read_context'])
    expect(seen.most).toBe(1)
  })

  it('stops at its step limit, the last step with no reads, and shows only a fixed sentence', async () => {
    const reads: boolean[] = []
    const { turn } = await turnWith(
      ({ canRead }) => {
        reads.push(canRead)
        // A model that keeps reading, even when told it may not.
        return { calls: [{ toolName: 'find_context', input: { words: 'more' } }] }
      },
      { steps: 3 },
    )
    expect(reads).toEqual([true, true, false])
    expect(turn).toMatchObject({ kind: 'stopped', stopped: 'steps', sources: [], state: null })
    expect(turn.read.length).toBeGreaterThan(0)
    expect(turn.read.join(' ')).toContain('Searched')
    expect(turn.reads).toEqual([])
    expect(turn.subject).toBeNull()
    expect(turn.text).toBe(
      'Ask stopped at its limit of 3 steps before it had an answer, so nothing it wrote is shown.',
    )
  })

  it('stops at its time limit, and shows nothing the model wrote', async () => {
    const { turn } = await turnWith(() => ({ text: 'Too late [itm_germany01].', delay: 2_000 }), {
      timeoutMs: 100,
    })
    expect(turn).toMatchObject({ kind: 'stopped', stopped: 'time', sources: [] })
    expect(turn.text).toContain('time limit')
  })

  it('says its model failed, in a fixed sentence, and logs only the failure', async () => {
    const { turn, errors } = await turnWith(() => ({ fail: true }))
    expect(turn).toMatchObject({ kind: 'stopped', stopped: 'model' })
    expect(turn.text).toBe("Ask's model did not answer just now, so nothing is shown.")
    expect(errors).toHaveLength(1)
  })

  it('asks one question back, with the readings as choices and no state', async () => {
    const { turn } = await turnWith(() => ({
      calls: [
        {
          toolName: 'ask_back',
          input: { question: 'Which switch do you mean?', choices: ['France', 'Spain'] },
        },
      ],
    }))
    expect(turn).toMatchObject({
      kind: 'question',
      text: 'Which switch do you mean?',
      choices: ['France', 'Spain'],
      state: null,
    })
  })

  it("reads the chat's earlier reads again, as the person, now, before the model sees them", async () => {
    let seenChat = ''
    const { asked, turn } = await turnWith(
      ({ prompt }) => {
        seenChat = JSON.stringify(prompt)
        return { text: 'Still nothing, as before [itm_germany01].' }
      },
      {
        turns: [
          {
            question: 'orders in poland',
            sources: ['itm_germany01', 'itm_hidden0001'],
            // An earlier reply that cites an item a read returns now, and one it does not.
            reply: 'Nothing on Poland. Germany lags [1]. Another item [2] said more.',
            reads: [{ tool: 'get_context', input: { about: 'orders in poland' } }],
          },
        ],
      },
    )
    expect(asked[0]).toEqual({ name: 'get_context', input: { about: 'orders in poland' } })
    // The model reads the earlier reply with its marks as the ids the reads give now, without the
    // sentence that cites an item no read returns now.
    expect(seenChat).toContain('Nothing on Poland. Germany lags [itm_germany01].')
    expect(seenChat).not.toContain('said more')
    expect(seenChat).not.toContain('itm_hidden0001')
    // The earlier read, made again, gives the item only as nearby to a subject with nothing written.
    expect(turn).toMatchObject({ sources: [], state: 'missing', nearby: ['itm_germany01'] })
  })
})
