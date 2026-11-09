import { describe, expect, it } from 'vitest'
import type { LoopRun, LoopTurn } from '../../src/contract/answer.ts'
import { dimensionHue, dimensionOf, nounId, termKeyOf } from '../../src/domain/ask-nouns.ts'
import {
  enumeration,
  wordsOf,
  type WordsContext,
} from '../../src/server/modules/answer/loop-body.ts'
import { overviewTurn, turnOf, type MadeRead } from '../../src/server/modules/answer/index.ts'

/*
  What code writes of an answer of Ask's loop from the model's words and the reads (FR-720), on a
  workspace that is not the demo's: its metric is Tickets closed, its dimensions Team and Sprint,
  its domain Support. Nothing here is about markets: a typed mention is checked against what a
  read named, a number against what a read holds, a list against what a read listed, and the
  evidence (the closest written, the owners, the definition, an overview) is the reads' own.
*/

const names = [
  { id: 'metric:tickets_closed', name: 'Tickets closed', of: null, type: null },
  { id: 'value:team/platform', name: 'Platform', of: 'Team', type: 'string' },
  { id: 'value:team/billing', name: 'Billing', of: 'Team', type: 'string' },
  { id: 'value:sprint/s41', name: 'Sprint 41', of: 'Sprint', type: 'time' },
  { id: 'domain:area_support', name: 'Support', of: null, type: null },
  { id: 'person:p_ada', name: 'Ada Okafor', of: null, type: null },
]
const outOf = { count: 12, of: 'published context items you may read' }
const row = (id: string, about: string[], extra: Record<string, unknown> = {}) => ({
  id,
  title: `Item ${id}`,
  summary: `What ${id} says.`,
  kind: 'rule',
  domain: 'Support',
  domainId: 'domain:area_support',
  about,
  checked: { role: 'the owner of Support', date: '2026-10-02' },
  outOfDate: null,
  ...extra,
})
/** A look-up of Tickets closed for Billing: what applies, what is nearby, who owns it. */
const lookup = (
  state: string,
  items: object[],
  nearby: { id: string; about: string[] }[] = [],
): MadeRead => ({
  tool: 'get_context',
  ref: 'r1',
  input: { about: 'tickets closed by billing' },
  result: {
    state,
    read: {
      words: 'tickets closed by billing',
      names: ['Tickets closed', 'Billing'],
      about: ['metric:tickets_closed', 'value:team/billing'],
      period: 'any date',
      assumedToday: false,
    },
    items,
    nearby: nearby.map((n) => ({
      ...n,
      title: `Item ${n.id}`,
      kind: 'rule',
      why: 'it applies to other values of a dimension the subject names',
      reason: 'values',
      domainId: 'domain:area_support',
    })),
    uncovered: [],
    wider: null,
    owners: [
      {
        domain: 'Support',
        owners: ['Ada Okafor'],
        id: 'domain:area_support',
        people: ['person:p_ada'],
      },
    ],
    searched: [
      {
        words: 'tickets closed by billing',
        names: ['Tickets closed', 'Billing'],
        about: [],
        period: 'any date',
        kinds: ['event', 'warning', 'rule', 'guide'],
        domain: null,
        without: null,
        found: items.length,
      },
    ],
    outOf,
    more: 0,
    names,
    ids: [...items.map((i) => (i as { id: string }).id), ...nearby.map((n) => n.id)],
  },
})

const ctxOf = (made: MadeRead[]): WordsContext => {
  const t = turnOf('x', made, [])
  return {
    nouns: new Map(t.nouns.map((n) => [n.id, n])),
    known: new Set(made.flatMap((m) => (m.result as { ids: string[] }).ids)),
    reads: made.map((m) => ({ ref: m.ref!, tool: m.tool, result: m.result })),
    digits: new Set(JSON.stringify(made.map((m) => m.result)).match(/\d+/g) ?? []),
    items: new Map(),
  }
}
const runs = (t: Pick<LoopTurn, 'body'>) =>
  t.body.flatMap((b): LoopRun[] => (b.t === 'p' ? b.runs : b.t === 'ul' ? b.items.flat() : []))

describe('the nouns, by the ids a typed mention writes', () => {
  it('maps the vocabulary keys one to one, a value always with its dimension', () => {
    expect(nounId('dim:team')).toBe('dimension:team')
    expect(nounId('val:team/billing')).toBe('value:team/billing')
    expect(termKeyOf('value:team/billing')).toBe('val:team/billing')
    expect(dimensionOf('value:sprint/s41')).toBe('dimension:sprint')
    // A hue from the id, the same every time, for any workspace's dimension.
    expect(dimensionHue('dimension:team')).toBe(dimensionHue('dimension:team'))
    expect(dimensionHue('dimension:team')).not.toBe(dimensionHue('dimension:sprint'))
  })
})

describe("the model's words, checked against the reads", () => {
  const made = [
    lookup('grounded', [row('itm_aaaa1111', ['metric:tickets_closed', 'value:team/billing'])]),
  ]

  it('does not number an item that only a dropped sentence cited', () => {
    const two = [
      lookup('grounded', [
        row('itm_aaaa1111', ['metric:tickets_closed']),
        row('itm_bbbb2222', ['value:team/billing']),
      ]),
    ]
    const cited: string[] = []
    wordsOf(
      'Tickets closed [itm_bbbb2222] and [#r9.outOf] more. Billing is fine [itm_aaaa1111].',
      ctxOf(two),
      cited,
    )
    expect(cited).toEqual(['itm_aaaa1111'])
  })

  it('draws a mention a read named as its noun, and one no read named as plain words, flagged', () => {
    const t = turnOf(
      '[@metric:tickets_closed] for [@value:team/billing] count reopened tickets once [itm_aaaa1111]. [@value:team/mobile] is not read.',
      made,
      [],
    )
    expect(runs(t).filter((r) => r.t === 'noun')).toEqual([
      { t: 'noun', id: 'metric:tickets_closed' },
      { t: 'noun', id: 'value:team/billing' },
    ])
    expect(t.text).toBe(
      'Tickets closed for Billing count reopened tickets once [1]. Mobile is not read.',
    )
    expect(t.checks).toContainEqual({ kind: 'mention', words: 'value:team/mobile' })
    // A definition's id in a mark is no source and no noun: it is left out, never its name.
    expect(turnOf('Billing counts once [metric:tickets_closed].', made, []).text).toBe(
      'Billing counts once.',
    )
    // A mention whose id no read named, but whose words a read's noun is, shows that name.
    expect(turnOf('Owned by [@person:ada_okafor].', made, []).text).toBe('Owned by Ada Okafor.')
    // Every noun the page may draw is one a read named, with its dimension.
    expect(t.nouns.find((n) => n.id === 'value:team/billing')?.of).toEqual({
      id: 'dimension:team',
      name: 'Team',
    })
    expect(t.nouns.map((n) => n.id)).toContain('dimension:team')
  })

  it('fills a number from its read, and leaves out the sentence whose number no read holds', () => {
    const t = turnOf(
      'Of [#r1.outOf], [#r1.items.length] apply. It was checked on [#r1.items.0.checked.date]. It closed [#r1.tickets] tickets.',
      made,
      [],
    )
    expect(runs(t).filter((r) => r.t === 'count' || r.t === 'date')).toEqual([
      { t: 'count', value: '12', of: 'published context items you may read' },
      { t: 'count', value: '1', of: null },
      { t: 'date', day: '2026-10-02' },
    ])
    expect(t.text).toBe(
      'Of 12 published context items you may read, 1 apply. It was checked on 2 October 2026.',
    )
    expect(t.checks).toEqual([{ kind: 'number', words: '[#r1.tickets]' }])
  })

  it("flags a digit no read gave, as the model's own count", () => {
    const t = turnOf('Billing closed 57 tickets [itm_aaaa1111].', made, [])
    expect(t.checks).toContainEqual({ kind: 'digits', words: '57' })
  })

  it('draws lines that start with a dash as a list, each with its own citation', () => {
    const two = [
      lookup('grounded', [
        row('itm_aaaa1111', ['value:team/billing']),
        row('itm_bbbb2222', ['value:team/platform']),
      ]),
    ]
    const t = turnOf(
      'Two rules apply:\n- Reopened tickets count once [itm_aaaa1111]\n- Merged tickets count as one [itm_bbbb2222]',
      two,
      [],
    )
    expect(t.body.map((b) => b.t)).toEqual(['p', 'ul'])
    const ul = t.body[1]
    expect(ul?.t === 'ul' && ul.items.map((i) => i.filter((r) => r.t === 'cite'))).toEqual([
      [{ t: 'cite', n: 1 }],
      [{ t: 'cite', n: 2 }],
    ])
    expect(t.text).toBe(
      'Two rules apply:\n\n- Reopened tickets count once [1]\n- Merged tickets count as one [2]',
    )
  })

  it("draws a read's items as rows when the words ask for its list, each cited", () => {
    const two = [
      lookup('grounded', [
        row('itm_aaaa1111', ['value:team/billing']),
        row('itm_bbbb2222', ['value:sprint/s41'], { outOfDate: 'its check date has passed' }),
      ]),
    ]
    const t = turnOf('[#r1.items.length] apply.\n\n[list:r1]', two, [])
    expect(t.body[1]).toEqual({ t: 'list', rows: ['itm_aaaa1111', 'itm_bbbb2222'], more: 0 })
    expect(t.sources).toEqual(['itm_aaaa1111', 'itm_bbbb2222'])
    expect(t.items.map((i) => [i.id, i.status, i.n])).toEqual([
      ['itm_aaaa1111', 'live', 1],
      ['itm_bbbb2222', 'due', 2],
    ])
    // A list of a read that holds no items is left out, and said.
    expect(turnOf('[list:r9]', two, []).checks).toEqual([{ kind: 'list', words: '[list:r9]' }])
  })

  it('turns a long enumeration after a colon into a list, and flags one with no colon', () => {
    expect(
      enumeration('They cover: reopened tickets, merged tickets, spam and duplicates.'),
    ).toEqual({
      lead: 'They cover:',
      items: ['reopened tickets', 'merged tickets', 'spam', 'duplicates'],
    })
    expect(enumeration('They cover: reopened and merged tickets.')).toBeNull()
    // A clause after a colon is no list: its commas and its and stay in the sentence.
    expect(
      enumeration(
        'What is written: it counts the value of completed and paid tickets in the help desk at the end of the day, with merged tickets and spam left out, as Cube defines it.',
      ),
    ).toBeNull()
    const t = turnOf(
      'Billing has rules on reopened tickets, merged tickets, spam, duplicates, macros, tags and bots [itm_aaaa1111].',
      made,
      [],
    )
    expect(t.checks.map((c) => c.kind)).toContain('enumeration')
  })

  it('flags citations piled at the end of a sentence', () => {
    const three = [
      lookup('grounded', [
        row('itm_aaaa1111', []),
        row('itm_bbbb2222', []),
        row('itm_cccc3333', []),
      ]),
    ]
    const t = turnOf('Three rules apply [itm_aaaa1111][itm_bbbb2222][itm_cccc3333].', three, [])
    expect(t.checks.map((c) => c.kind)).toContain('piled')
    expect(t.sources).toHaveLength(3)
  })

  it('keeps the words of a sentence with no mark as they are', () => {
    const w = wordsOf('Ask reads as you.', ctxOf(made))
    expect(w.body).toEqual([{ t: 'p', runs: [{ t: 'text', text: 'Ask reads as you.' }] }])
    expect(w.checks).toEqual([])
  })

  it('reads a typed id with no @ as its mention where the words need it, and a kind written twice', () => {
    // A person, or a noun with words after it in its clause, is that mention.
    expect(turnOf('Billing is owned by [person:p_ada] and no one else.', made, []).text).toBe(
      'Billing is owned by Ada Okafor and no one else.',
    )
    expect(turnOf('It is owned by [person:p_ada].', made, []).text).toBe(
      'It is owned by Ada Okafor.',
    )
    expect(turnOf('[metric:tickets_closed] has a rule [itm_aaaa1111].', made, []).text).toBe(
      'Tickets closed has a rule [1].',
    )
    // Named already in the sentence, it is the name again, left out.
    expect(turnOf('Ada Okafor [person:p_ada] owns it.', made, []).text).toBe('Ada Okafor owns it.')
    const twice = turnOf('It sits in [@domain:domain:area_support].', made, [])
    expect(runs(twice)).toContainEqual({ t: 'noun', id: 'domain:area_support' })
    expect(twice.checks).toEqual([])
  })
})

describe('the words as the page shows them, beside the evidence', () => {
  const made = [
    lookup('grounded', [row('itm_aaaa1111', ['metric:tickets_closed', 'value:team/billing'])]),
  ]

  it('draws a mention on the words that already give its name, not again after them', () => {
    const t = turnOf(
      'Nothing covers tickets closed for Billing. The Tickets closed metric is in Support, and nothing applies to the Billing team [@metric:tickets_closed] [@value:team/billing].',
      made,
      [],
    )
    expect(t.body).toEqual([
      {
        t: 'p',
        runs: [
          { t: 'text', text: 'Nothing covers tickets closed for Billing. The ' },
          { t: 'noun', id: 'metric:tickets_closed' },
          { t: 'text', text: ' metric is in Support, and nothing applies to the ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: ' team.' },
        ],
      },
    ])
    // What is graded, and what the chat sends back, keep the words as the model wrote them.
    expect(t.text).toContain('the Billing team Tickets closed Billing.')
    expect(t.said).toContain('the Billing team [@metric:tickets_closed] [@value:team/billing].')
  })

  it('draws a mention after its own name on the name, and leaves one inside a clause where it is', () => {
    const t = turnOf(
      'Ada Okafor [@person:p_ada] owns [@metric:tickets_closed], and [@metric:tickets_closed] for Billing counts once.',
      made,
      [],
    )
    expect(runs(t)).toEqual([
      { t: 'noun', id: 'person:p_ada' },
      { t: 'text', text: ' owns ' },
      { t: 'noun', id: 'metric:tickets_closed' },
      { t: 'text', text: ', and ' },
      { t: 'noun', id: 'metric:tickets_closed' },
      { t: 'text', text: ' for Billing counts once.' },
    ])
  })

  it('leaves out, under Not found, a list of the items the closest written show, and its lead', () => {
    const nearby = [
      { id: 'itm_pppp1111', about: ['metric:tickets_closed', 'value:team/platform'] },
      { id: 'itm_qqqq1111', about: ['metric:tickets_closed', 'value:sprint/s41'] },
    ]
    const t = turnOf(
      'Nothing written covers [@metric:tickets_closed] for [@value:team/billing]. The nearest items are about other teams:\n- Platform closes merged tickets once [itm_pppp1111]\n- Sprint 41 ran a day short [itm_qqqq1111]\n\nThat is all [itm_pppp1111].',
      [lookup('missing', [], nearby)],
      [],
    )
    expect(t.state).toBe('missing')
    expect(t.closest?.items).toEqual(['itm_pppp1111', 'itm_qqqq1111'])
    expect(t.body).toEqual([
      {
        t: 'p',
        runs: [
          { t: 'text', text: 'Nothing written covers ' },
          { t: 'noun', id: 'metric:tickets_closed' },
          { t: 'text', text: ' for ' },
          { t: 'noun', id: 'value:team/billing' },
          { t: 'text', text: '.' },
        ],
      },
      // Nothing cited under Not found is a source.
      { t: 'p', runs: [{ t: 'text', text: 'That is all.' }] },
    ])
    // The graded words keep the list; the chat's copy keeps what each line cited, by id.
    expect(t.text).toContain('- Platform closes merged tickets once')
    expect(t.said).toContain('- Platform closes merged tickets once [itm_pppp1111]')
  })
})

describe('the evidence, by code from the reads', () => {
  it('lists the closest written to a Not found, counted by each other value of the dimension it narrowed', () => {
    const t = turnOf(
      'Nothing written covers [@metric:tickets_closed] for [@value:team/billing].',
      [
        lookup(
          'missing',
          [],
          [
            { id: 'itm_pppp1111', about: ['metric:tickets_closed', 'value:team/platform'] },
            {
              id: 'itm_pppp2222',
              about: ['metric:tickets_closed', 'value:team/platform', 'value:sprint/s41'],
            },
            { id: 'itm_qqqq1111', about: ['metric:tickets_closed', 'value:sprint/s41'] },
          ],
        ),
      ],
      [],
    )
    expect(t.state).toBe('missing')
    expect(t.closest).toEqual({
      by: 'dimension:team',
      counts: [{ id: 'value:team/platform', count: 2 }],
      items: ['itm_pppp1111', 'itm_pppp2222', 'itm_qqqq1111'],
    })
    expect(t.owners).toEqual([{ domain: 'domain:area_support', people: ['person:p_ada'] }])
    expect(t.footer.denominator).toBe('0 of 12 published context items you may read apply.')
    expect(JSON.stringify(t)).not.toMatch(/market/i)
  })

  it('shows a definition only when the question turns on a word of it, marked, or asks what it is', () => {
    const withDefinition: MadeRead[] = [
      ...[lookup('grounded', [row('itm_aaaa1111', ['metric:tickets_closed'])])],
      {
        tool: 'definitions',
        ref: 'r2',
        input: { names: ['Tickets closed'] },
        result: {
          definitions: [
            {
              id: 'metric:tickets_closed',
              name: 'Tickets closed',
              kind: 'metric',
              words: 'Tickets marked solved in the help desk, reopened ones counted once.',
              from: 'Cube (support.tickets_closed)',
            },
          ],
          names,
          ids: ['metric:tickets_closed'],
        },
      },
    ]
    const turnsOn = turnOf(
      'It counts them once [itm_aaaa1111].',
      withDefinition,
      [],
      'Are reopened tickets in tickets closed?',
    )
    expect(turnsOn.definitions).toEqual([
      expect.objectContaining({ id: 'metric:tickets_closed', mark: 'reopened', tool: 'Cube' }),
    ])
    const asks = turnOf(
      'It counts them once [itm_aaaa1111].',
      withDefinition,
      [],
      'What does tickets closed mean?',
    )
    expect(asks.definitions).toHaveLength(1)
    expect(asks.definitions[0]?.mark).toBeUndefined()
    // Not when the question turns on nothing in it, and never when the words already say it.
    expect(
      turnOf('It counts once [itm_aaaa1111].', withDefinition, [], 'Why did tickets closed drop?')
        .definitions,
    ).toEqual([])
    expect(
      turnOf(
        'Tickets marked solved in the help desk, reopened ones counted once [itm_aaaa1111].',
        withDefinition,
        [],
        'What does tickets closed mean?',
      ).definitions,
    ).toEqual([])
  })
})

describe('an overview, by code from the read the model named', () => {
  const card = (id: string, group: string, item: string | null = null) => ({
    id,
    group,
    title: `Card ${id}`,
    domain: 'Support',
    domainId: 'domain:area_support',
    item,
    about: ['value:team/billing'],
    status: 'its check date passed',
    date: '2026-10-20',
  })
  const inbox: MadeRead = {
    tool: 'inbox',
    ref: 'r1',
    input: { limit: 10 },
    result: {
      count: 4,
      groupsAdd: 5,
      differs:
        '1 mention is on a card’s own thread, so the Inbox counts it with that card: 4 cards, while the groups add up to 5.',
      order: "the Inbox's own order: what needs you first",
      groups: [
        {
          group: 'mention',
          name: 'Mentioned you',
          count: 1,
          cards: [card('c1', 'mention')],
          more: 0,
        },
        {
          group: 'check',
          name: 'Due for a check',
          count: 3,
          cards: [card('c2', 'check', 'itm_aaaa1111'), card('c3', 'check', 'itm_bbbb2222')],
          more: 1,
        },
        {
          group: 'suggestion',
          name: 'Suggestions',
          count: 1,
          cards: [card('c4', 'suggestion')],
          more: 0,
        },
      ],
      note: '',
      names,
      ids: ['c1', 'c2', 'itm_aaaa1111', 'c3', 'itm_bbbb2222', 'c4'],
    },
  }

  it("totals its groups, says the page's own count and why when it differs, and cites each row's item", () => {
    const t = overviewTurn('what do I need to handle?', { from: 'r1' }, [inbox], [])!
    const o = t.overview!
    expect(o.total).toBe(5)
    expect(o.page).toEqual({ count: 4, why: expect.stringMatching(/own thread/) as string })
    expect(o.groups.map((g) => [g.key, g.count, g.rows.length, g.more])).toEqual([
      ['mention', 1, 1, 0],
      ['check', 3, 2, 1],
      ['suggestion', 1, 1, 0],
    ])
    expect(t.sources).toEqual(['itm_aaaa1111', 'itm_bbbb2222'])
    expect(t.state).toBeNull()
    expect(t.text.split('\n')[0]).toBe('5 cards wait on you in your Inbox, in 3 groups.')
  })

  it('shows only the groups asked for, and a closing line only when it carries a fact', () => {
    const some = overviewTurn(
      'what is due?',
      { from: 'r1', groups: ['check'], note: '[@domain:area_support] owns them all.' },
      [inbox],
      [],
    )!
    expect(some.overview?.groups.map((g) => g.key)).toEqual(['check'])
    expect(some.overview?.page).toBeNull()
    expect(some.overview?.note?.some((r) => r.t === 'noun')).toBe(true)
    const filler = overviewTurn(
      'what is due?',
      { from: 'r1', note: 'That is all for now.' },
      [inbox],
      [],
    )!
    expect(filler.overview?.note).toBeNull()
    expect(filler.checks).toContainEqual({ kind: 'note', words: 'That is all for now.' })
    // A read with no groups has no overview.
    expect(overviewTurn('x', { from: 'r2' }, [inbox], [])).toBeNull()
  })

  it('numbers the rows that cite an item once across the answer, in reading order, one number an item', () => {
    // The same item behind a card due for a check and a suggestion, and a card about no item.
    const twice: MadeRead = {
      ...inbox,
      result: {
        ...(inbox.result as object),
        ids: ['c1', 'c2', 'itm_bbbb2222', 'c3', 'itm_aaaa1111', 'c4', 'c5', 'itm_cccc3333'],
        groups: [
          {
            group: 'mention',
            name: 'Mentioned you',
            count: 1,
            cards: [card('c1', 'mention')],
            more: 0,
          },
          {
            group: 'check',
            name: 'Due for a check',
            count: 2,
            cards: [card('c2', 'check', 'itm_bbbb2222'), card('c3', 'check', 'itm_aaaa1111')],
            more: 0,
          },
          {
            group: 'suggestion',
            name: 'Suggestions',
            count: 2,
            cards: [
              card('c4', 'suggestion', 'itm_aaaa1111'),
              card('c5', 'suggestion', 'itm_cccc3333'),
            ],
            more: 0,
          },
        ],
      },
    }
    const t = overviewTurn('what do I need to handle?', { from: 'r1' }, [twice], [])!
    const numberOf = (id: string | null) => (id ? t.sources.indexOf(id) + 1 : null)
    expect(t.overview!.groups.map((g) => g.rows.map((r) => numberOf(r.item)))).toEqual([
      [null],
      [1, 2],
      [2, 3],
    ])
    // Each number is one item, and every item a row cites is one of the answer's sources.
    expect(t.sources).toEqual(['itm_bbbb2222', 'itm_aaaa1111', 'itm_cccc3333'])
    expect(t.items.filter((i) => i.n).map((i) => [i.n, i.id])).toEqual([
      [1, 'itm_bbbb2222'],
      [2, 'itm_aaaa1111'],
      [3, 'itm_cccc3333'],
    ])
  })
})
