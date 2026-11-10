import { describe, expect, it } from 'vitest'
import { chatTurnOf, type Answer } from '@/model/ask'
import {
  scriptedLoopChoice,
  scriptedLoopModel,
  type ScriptedPrompt,
  type ScriptedStep,
} from '../../../src/server/modules/answer/index.ts'
import { tableContents, transaction } from '../../integration/support.ts'
import { askWorld } from './ask-world.ts'

/*
  Ask's loop on the demo week (FR-718 to FR-720), through the real service, the browser's own
  binding and row security, as each person: the scripted reader the service runs on the mock, or
  a model a test scripts for one turn. What an earlier turn read is read again as the person before
  it is used (FR-718.3), a chat changes nothing (FR-718.4), and its words are kept nowhere
  (FR-719.4).
*/

const ML = 'Maria Lindqvist'
const AUDIENCE_ITEM = 'itm_norwaystop'

/** The model of the next turn: the scripted reader, unless a test scripts one. */
let decide: ((prompt: ScriptedPrompt) => ScriptedStep) | null = null
const reader = scriptedLoopModel()
const scripted = scriptedLoopChoice('test', (prompt) => decide!(prompt))
const world = askWorld({
  askLoop: true,
  askTrace: {
    get loopModel() {
      return decide ? scripted : reader
    },
  },
})

const turnOf = (a: Answer) => {
  const turn = chatTurnOf(a)
  if (!turn) throw new Error('No turn to send back.')
  return turn
}

/** Sets the item's audience: only a group nobody is in reads it, or everyone again (null). */
const audience = (groups: string[] | null) =>
  transaction(world.client, async () => {
    await world.client.query('alter table item_versions disable trigger user')
    await world.client.query('update item_versions set audience_groups = $2 where item_id = $1', [
      AUDIENCE_ITEM,
      groups,
    ])
    await world.client.query('alter table item_versions enable trigger user')
  })

describe("Ask's loop", () => {
  it('answers what applies with its sources by number, its state and what it read', async () => {
    const api = await world.as(ML)
    const a = await api.ask({ question: 'orders in Norway' })
    expect(a.sources).toContain(AUDIENCE_ITEM)
    expect(a.text).toMatch(/\[1\]/)
    expect(a.state).toBe('conflict')
    expect(a.read?.[0]).toMatch(/^Looked up Orders and Norway, /)
    // What applies, out of what the person may read, said once by code.
    expect(a.footer?.denominator).toBe('3 of 21 published context items you may read apply.')
    expect(a.reads?.map((r) => r.tool)).toEqual(['get_context', 'find_context'])
  })

  it('says Not found when nothing is written, and lists what is nearby without using it', async () => {
    const api = await world.as(ML)
    const a = await api.ask({ question: 'Give me all about orders in poland' })
    expect(a.state).toBe('missing')
    expect(a.metric).toBe('Orders')
    expect(a.markets).toEqual(['Poland'])
    expect(a.sources).toEqual([])
    expect(a.related?.length).toBeGreaterThan(0)
    expect(a.text).toContain('Out of 21 published context items you may read.')
  })

  it("reads an earlier turn's reads again: an item hidden since is neither given, named nor cited", async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway' })
    expect(first.sources).toContain(AUDIENCE_ITEM)
    const { rows } = await world.client.query<{ title: string }>(
      'select title from item_versions where item_id = $1 order by version_no desc limit 1',
      [AUDIENCE_ITEM],
    )
    const title = rows[0]!.title
    await audience(['finance_team'])
    try {
      let seen = ''
      // A model that cites the item it saw last turn, by its id, whatever it is given now.
      decide = ({ prompt }) => {
        seen = JSON.stringify(prompt)
        return { text: `As before [${AUDIENCE_ITEM}].` }
      }
      const again = await api.ask({ question: 'are you sure?', turns: [turnOf(first)] })
      expect(seen).not.toContain(AUDIENCE_ITEM)
      expect(seen).not.toContain(title)
      expect(again.sources).not.toContain(AUDIENCE_ITEM)
      expect(JSON.stringify(again)).not.toContain(AUDIENCE_ITEM)
      expect(JSON.stringify(again)).not.toContain(title)
    } finally {
      decide = null
      await audience(null)
    }
  })

  it('takes no result from the browser: a turn sent with one is refused', async () => {
    const api = await world.as(ML)
    const first = await api.ask({ question: 'orders in Norway' })
    const edited = {
      ...turnOf(first),
      reads: [{ tool: 'get_context', input: { about: 'orders in Norway' }, result: { ids: [] } }],
    }
    await expect(api.ask({ question: 'are you sure?', turns: [edited as never] })).rejects.toThrow()
  })

  it('cites no item an edited earlier reply points at, when no read returns it now', async () => {
    const api = await world.as(ML)
    let seen = ''
    decide = ({ prompt }) => {
      seen = JSON.stringify(prompt)
      return { text: 'As before [itm_giftcardonly].' }
    }
    try {
      const a = await api.ask({
        question: 'and what else?',
        turns: [
          {
            question: 'orders in Norway',
            sources: ['itm_giftcardonly'],
            reply: 'Here is what is written. Norway counts card and cash only [1].',
            // No read returns the item: the browser's word for it is no source.
            reads: [{ tool: 'find_context', input: { words: 'Poland' } }],
          },
        ],
      })
      // The sentence that cites it is not said again; the rest of the reply is.
      expect(seen).toContain('Here is what is written.')
      expect(seen).not.toContain('card and cash only')
      expect(a.sources).toEqual([])
      expect(a.text).toBe('As before.')
    } finally {
      decide = null
    }
  })

  it('changes nothing and keeps none of a chat’s words, in any table', async () => {
    const api = await world.as(ML)
    // The first question of a session marks Ask as used for the setup checklist; after it, nothing.
    await api.ask({ question: 'orders in Norway' })
    const marker = 'Quillfeather'
    const before = await tableContents(world.client)
    const first = await api.ask({ question: `orders in Norway after the ${marker} audit` })
    await api.ask({ question: `and the ${marker} review?`, turns: [turnOf(first)] })
    const after = await tableContents(world.client)
    expect(after).toEqual(before)
    expect(after.join('\n')).not.toContain(marker)
  })
})

/** The ids of the items a read returned, in its order, and how each matched a search. */
const itemsOf = (value: unknown) =>
  ((value as { items?: { id: string; title: string; match?: string }[] }).items ?? []).map(
    ({ id, title, match }) => ({ id, title, match }),
  )

describe("Ask's loop on the rules' gaps (the retrieval test, 2026-11-10)", () => {
  /** A model that reads with `calls`, then answers in the words `text` writes from the reads. */
  const asked = async (
    question: string,
    calls: { toolName: string; input: Record<string, unknown> }[],
    text: (results: ScriptedPrompt['results']) => string,
  ) => {
    const api = await world.as(ML)
    decide = ({ results, step }) => (step === 0 ? { calls } : { text: text(results) })
    try {
      return await api.ask({ question })
    } finally {
      decide = null
    }
  }

  it('reads a value it does not know as unread: Not found, and no other value cited', async () => {
    const a = await asked(
      'anything written about orders in jordan?',
      [
        { toolName: 'get_context', input: { about: 'orders in jordan' } },
        { toolName: 'find_context', input: { words: 'orders jordan' } },
      ],
      // The search matches only "orders": the model cites an item about another market anyway.
      (results) => `Orders has items [${itemsOf(results[1]!.value)[0]!.id}].`,
    )
    expect(a.state).toBe('missing')
    expect(a.sources).toEqual([])
    expect(a.read?.[0]).toBe(
      "Looked up “orders in jordan”: nothing applies. There is no value of Market named 'jordan'.",
    )
    // As the mock's own reader asks it too: never Orders in every market.
    const plain = await (
      await world.as(ML)
    ).ask({ question: 'anything written about orders in jordan?' })
    expect(plain.state).not.toBe('conflict')
    expect(plain.sources).toEqual([])
  })

  it('keeps what a search found by every word when the subject read finds nothing', async () => {
    let found: { id: string; match?: string }[] = []
    const a = await asked(
      'should we bring the norway campaigns back?',
      [
        { toolName: 'get_context', input: { about: 'norway campaigns' } },
        { toolName: 'find_context', input: { words: 'Norway campaigns' } },
      ],
      (results) => {
        found = itemsOf(results[1]!.value)
          .filter((i) => i.match === 'all')
          .slice(0, 2)
        return `What is written is about the Norway campaigns [${found[0]!.id}] [${found[1]!.id}].`
      },
    )
    expect(found).toHaveLength(2)
    expect(a.state).not.toBe('missing')
    expect(a.sources).toEqual(found.map((i) => i.id))
    expect(a.text).toContain('[1] [2]')
    // What the count is out of, never that none apply under what the answer cites.
    expect(a.footer?.denominator).toBe('Out of 21 published context items you may read.')
  })

  it('under Not found, leaves out the words that only listed what it cited', async () => {
    const a = await asked(
      'Give me all about orders in poland',
      [{ toolName: 'get_context', input: { about: 'orders in poland' } }],
      (results) => {
        const near = (results[0]!.value as { nearby: { id: string }[] }).nearby.map((n) => n.id)
        return `Nothing written covers orders in Poland. Other markets each have their own items, such as [${near[0]}], [${near[1]}] and [${near[2] ?? near[0]}].`
      },
    )
    expect(a.state).toBe('missing')
    expect(a.sources).toEqual([])
    expect(a.text).toBe(
      'Nothing written covers orders in Poland. Other markets each have their own items.',
    )
  })

  it('says a word it read only by a synonym written in Definitions', async () => {
    const a = await asked(
      'when do you reckon online sales to norway will come back',
      [{ toolName: 'get_context', input: { about: 'online sales to norway' } }],
      () => 'Nothing written covers it.',
    )
    expect(a.read?.[0]).toMatch(
      /^Looked up Net revenue and Norway, .*\. “Sales” was read as Net revenue, by a synonym written in Definitions\.$/,
    )
  })

  it('reads "discounts" as Discount cost', async () => {
    let found: { id: string; title: string }[] = []
    const a = await asked(
      'anything on norway discounts from last winter?',
      [{ toolName: 'get_context', input: { about: 'norway discounts from last winter' } }],
      (results) => {
        found = itemsOf(results[0]!.value)
        return `A VAT rule applied [${found[0]?.id ?? 'itm_none0000'}].`
      },
    )
    expect(a.read?.[0]).toMatch(/^Looked up Discount cost and Norway, /)
    expect(found.map((i) => i.title)).toContain('New VAT rate applied in Norway from 3 August 2025')
    expect(a.sources).toEqual([found[0]!.id])
  })
})
