import { describe, expect, it } from 'vitest'
import type { AnswerResult, Asked } from '@contract/answer'
import {
  answerOf,
  askedWeekOf,
  createChatShelf,
  dayOf,
  examplesOf,
  linksOf,
  lookupFields,
  namesOf,
  type Shelf,
} from '@/api/http-ask'

const vocabulary = {
  metrics: [{ id: 'orders', name: 'Orders', group: 'Payments' }],
  dimensions: [
    {
      id: 'market',
      name: 'Market',
      values: [
        { id: 'norway', name: 'Norway', aliases: [] },
        { id: 'spain', name: 'Spain', aliases: [] },
      ],
    },
  ],
}
const names = namesOf(vocabulary)

const item = (
  id: string,
  summary: string,
  patch: Partial<AnswerResult['items'][number]> = {},
): AnswerResult['items'][number] => ({
  id,
  version: 1,
  areaId: 'area_sales',
  kind: 'event',
  title: summary,
  summary,
  validity: { start: '2026-08-04', end: null },
  match: 'exact',
  unverified: false,
  unverifiedReason: null,
  restrictions: [],
  conflictsWith: [],
  quote: null,
  notToConclude: null,
  ...patch,
})

const norway = {
  metrics: ['metric:orders'],
  filters: { 'dim:market': ['val:market/norway'] },
  window: { start: '2026-08-01', end: '2026-09-01' },
}

const result = (patch: Partial<AnswerResult> = {}): AnswerResult => ({
  target: { kind: 'live' },
  edition: '2026-10-20.1',
  status: 'matched',
  state: 'grounded',
  scope: norway,
  dates: null,
  assumed: null,
  issues: [],
  items: [],
  leftOut: [],
  leftOutMore: 0,
  forAnotherGroup: 0,
  uncovered: { metrics: [], values: [] },
  say: '1 context item applies to Orders in Norway in August 2026. Only that was checked.',
  next: null,
  steps: [],
  ms: 1,
  ...patch,
})

describe("Ask's answer from the engine", () => {
  it('names what was asked, gives each source its first sentence and number, and carries its quote', () => {
    const a = answerOf(
      result({
        items: [
          item('itm_a', 'Online sales stopped on 4 August 2026. Parcels still arrived.', {
            quote: 'Held at the border from 4 August 2026.',
            notToConclude: 'Fewer orders do not mean fewer customers.',
          }),
        ],
      }),
      'Why did orders in Norway drop in August?',
      names,
    )
    expect(a).toMatchObject({
      metric: 'Orders',
      markets: ['Norway'],
      dates: '1 to 31 Aug 2026',
      state: 'grounded',
      sources: ['itm_a'],
      said: '1 context item applies to Orders in Norway in August 2026. Only that was checked.',
      cited: {
        itm_a: {
          quote: 'Held at the border from 4 August 2026.',
          dontConclude: 'Fewer orders do not mean fewer customers.',
        },
      },
    })
    // A question about why something moved is told the cause is not in the context.
    expect(a.text).toBe(
      "Online sales stopped on 4 August 2026. [1] The context doesn't say what caused it.",
    )
    expect(
      answerOf(
        result({ items: [item('itm_a', 'Online sales stopped.')] }),
        'What should I know about Orders in Norway?',
        names,
      ).text,
    ).toBe('Online sales stopped. [1]')
  })

  it("takes a real model's words when the service sent them, and keeps the engine's state, note and sources", () => {
    const stale = result({
      state: 'stale',
      items: [
        item('itm_a', 'Returns count refunds.', {
          unverified: true,
          unverifiedReason: 'past_review_date',
        }),
      ],
    })
    const written = 'Returns count only refunds that reached the bank [1].'
    const a = answerOf(stale, 'Returns in Norway?', names, {}, written)
    expect(a).toMatchObject({
      text: written,
      state: 'stale',
      sources: ['itm_a'],
      note: 'Based on 1 context item that may be out of date: its check date passed.',
    })
    // With nothing given, there are no model words to take.
    expect(answerOf(result({ state: 'missing' }), 'Orders?', names, {}, written).text).not.toBe(
      written,
    )
  })

  it('says no dates when the engine assumed today, and keeps the asker’s chips', () => {
    const scope = [{ id: 'market:Norway', label: 'Norway' }]
    const a = answerOf(
      result({ assumed: { date: '2026-10-23', time_zone: 'UTC', reason: 'no date given' } }),
      'Orders in Norway?',
      names,
      { scope },
    )
    expect(a.dates).toBeUndefined()
    expect(a.scope).toEqual(scope)
  })

  it('keeps both sides of a conflict, and says Partial for the markets with nothing', () => {
    const conflict = answerOf(
      result({
        state: 'conflict',
        items: [item('itm_a', 'Counts store credit.'), item('itm_b', 'Card and cash only.')],
      }),
      'Do Norway orders include gift cards?',
      names,
    )
    expect(conflict.text).toBe(
      'Counts store credit. [1] Card and cash only. [2] Both are kept until an owner chooses.',
    )
    const partial = answerOf(
      result({
        state: 'partial',
        scope: { ...norway, filters: { 'dim:market': ['val:market/norway', 'val:market/spain'] } },
        uncovered: { metrics: [], values: ['val:market/spain'] },
        items: [item('itm_a', 'Online sales stopped.')],
      }),
      'Orders in Norway and Spain?',
      names,
    )
    expect(partial.note).toBe("There's context for Norway and nothing for Spain.")
  })

  it('names the items that disagree, not every item a conflict gives', () => {
    // The customs stop applies too, first, but disagrees with nothing: an owner chooses between
    // the other two.
    const a = answerOf(
      result({
        state: 'conflict',
        items: [
          item('itm_stop', 'Online sales stopped.'),
          item('itm_card', 'Card and cash only.', { conflictsWith: ['itm_credit'] }),
          item('itm_credit', 'Counts store credit.'),
        ],
      }),
      'Orders in Norway?',
      names,
    )
    expect(a.conflict).toEqual(['itm_card', 'itm_credit'])
    // A link to an item the answer does not give names nobody here.
    const alone = answerOf(
      result({
        state: 'conflict',
        items: [item('itm_card', 'Card and cash only.', { conflictsWith: ['itm_elsewhere'] })],
      }),
      'Orders in Norway?',
      names,
    )
    expect(alone.conflict).toEqual([])
  })

  it('says a question the engine could not read was not looked up, with its reason and no answer state', () => {
    const unread = (say: string) =>
      answerOf(
        result({ state: 'missing', status: 'need_more_detail', scope: null, say }),
        'give me context created in last 24 hours?',
        names,
      )
    const a = unread(
      'Nothing was looked up yet. The question needs a metric or a market, such as Active customers, Average order value or Churn rate.',
    )
    // Not found would tell the person that nobody wrote anything down, which nobody checked.
    expect(a.state).toBeNull()
    expect(a.sources).toEqual([])
    expect(a.text).toBe(
      'The question needs a metric or a market, such as Active customers, Average order value or Churn rate.',
    )
    expect(a.said).toMatch(/^Nothing was looked up yet\. /)
    // Whatever the engine could not read, its reason is what the answer says.
    expect(unread(`Nothing was looked up yet. There's no domain called "Salse".`).text).toBe(
      `There's no domain called "Salse".`,
    )
  })

  it('says what nothing is written for, and gives Not checked no words', () => {
    const missing = answerOf(result({ state: 'missing', status: 'no_match' }), 'Orders?', names)
    expect(missing.state).toBe('missing')
    expect(missing.text).toBe(
      "Nobody has written down anything about Orders in Norway, 1 to 31 Aug 2026. That doesn't mean there's no explanation, only that none is written down yet.",
    )
    const failed = answerOf(result({ state: 'failed', status: 'check_failed' }), 'Orders?', names)
    expect(failed.text).toBe('')
    expect(failed.note).toMatch(/^The check couldn't run just now/)
  })

  it('says why an item may be out of date, and what was left out', () => {
    const a = answerOf(
      result({
        state: 'stale',
        items: [
          item('itm_a', 'Returns count refunds.', {
            unverified: true,
            unverifiedReason: 'past_review_date',
          }),
        ],
        leftOut: [
          { id: 'itm_x', reason: 'values', kind: 'note', title: 'Germany lags', replacedBy: null },
        ],
        forAnotherGroup: 2,
      }),
      'Returns in Norway?',
      names,
    )
    expect(a.note).toBe('Based on 1 context item that may be out of date: its check date passed.')
    expect(a.leftOut).toBe(
      '1 context item for another market or value (Germany lags), 2 context items for another group.',
    )
  })
})

const asked: Asked = {
  week: '2026-10-19',
  rows: [
    {
      title: 'Orders in Norway',
      area: 'area_sales',
      scope: { ...norway, window: { start: '2026-10-01', end: '2026-11-01' } },
      months: ['2026-10-01'],
      count: null,
      atLeast: 24,
      state: 'grounded',
      items: 2,
      gap: null,
    },
    {
      title: 'Orders in Spain',
      area: 'area_sales',
      scope: {
        ...norway,
        filters: { 'dim:market': ['val:market/spain'] },
        window: { start: '2026-10-01', end: '2026-11-01' },
      },
      months: ['2026-10-01'],
      count: 12,
      atLeast: 12,
      state: 'missing',
      items: 0,
      gap: { card: 'gap:7c0a', draft: '01a17d14-ec57' },
    },
  ],
  hidden: null,
  asked: 142,
  askedAtLeast: 136,
  starters: [{ title: 'Orders in Norway', scope: norway }],
}

describe('Asked this week from the service', () => {
  it('asks each row as a question, shows a total that would give a month away as at least, and leads an owner to the draft', () => {
    const week = askedWeekOf(asked, names)
    expect(week).toMatchObject({ asked: 142, hidden: 0 })
    expect(week.rows[0]).toMatchObject({
      title: 'Orders in Norway',
      question: 'What should I know about Orders in Norway?',
      count: '24+',
      times: 24,
      state: 'grounded',
      sources: 2,
      topic: { metric: 'Orders', where: 'Norway', domain: 'area_sales', month: '2026-10' },
    })
    expect(week.rows[0]!.next).toBeUndefined()
    expect(week.rows[1]!.next).toEqual({
      label: 'Write it',
      href: '/context/new?gap=01a17d14-ec57',
    })
    expect(
      askedWeekOf(
        { ...asked, rows: [{ ...asked.rows[1]!, gap: { card: 'gap:7c0a', draft: null } }] },
        names,
      ).rows[0]!.next,
    ).toEqual({ label: 'Open the card', href: '/inbox?card=gap%3A7c0a' })
  })

  it('is empty while nothing is shared with agents', () => {
    expect(askedWeekOf(null, names)).toEqual({ rows: [], hidden: 0, asked: 0 })
    expect(examplesOf(null)).toEqual([])
  })

  it('offers the rows and then the starters as questions, each with the scope it asks', () => {
    const examples = examplesOf(asked)
    expect(examples.map((e) => [e.question, e.starter ?? false])).toEqual([
      ['What should I know about Orders in Norway?', false],
      ['What should I know about Orders in Spain?', false],
      ['What should I know about Orders in Norway?', true],
    ])
    expect(lookupFields(examples[0]!.scope)).toEqual({
      metrics: ['metric:orders'],
      dimension_filters: [{ dimension: 'dim:market', values: ['val:market/norway'] }],
      window: { from: '2026-10-01', to: '2026-10-31' },
    })
  })
})

describe("the person's chats in the browser", () => {
  const memory = (): Shelf & { data: Map<string, string> } => {
    const data = new Map<string, string>()
    return { data, get: (k) => data.get(k) ?? null, set: (k, v) => void data.set(k, v) }
  }

  it('keeps each person their own chats, newest first, and puts a deleted one back once', () => {
    let now = Date.parse('2026-10-23T09:00:00')
    const shelf = memory()
    const chats = createChatShelf(shelf, () => now)
    chats.add('per_jon', 'c1', 'First?', 'It says one thing.')
    now += 60_000
    chats.add('per_jon', 'c2', 'Second?', '')
    chats.add('per_ines', 'c3', 'Hers?', '')
    expect(chats.list('per_jon').map((t) => t.id)).toEqual(['c2', 'c1'])
    expect(chats.list('per_ines').map((t) => t.id)).toEqual(['c3'])
    chats.rename('per_jon', 'c1', 'Renamed')
    const { undo } = chats.remove('per_jon', 'c1')
    expect(chats.list('per_jon').map((t) => t.id)).toEqual(['c2'])
    expect(chats.undo(undo)).toBe(true)
    expect(chats.undo(undo)).toBe(false)
    expect(chats.list('per_jon').find((t) => t.id === 'c1')).toMatchObject({
      title: 'Renamed',
      preview: 'It says one thing.',
      day: 'Today',
      time: '09:00',
    })
    expect(chats.undo('a-decision-token')).toBe(false)
  })

  it('reads a shelf it cannot parse as no chats', () => {
    const shelf = memory()
    shelf.set('heed.ask.chats.per_jon', '{not json')
    expect(createChatShelf(shelf).list('per_jon')).toEqual([])
  })

  it('groups chats by day: today and yesterday by the clock, earlier by date', () => {
    const now = Date.parse('2026-10-23T09:00:00')
    expect(dayOf(Date.parse('2026-10-23T08:05:00'), now)).toEqual({ day: 'Today', time: '08:05' })
    expect(dayOf(Date.parse('2026-10-22T16:30:00'), now)).toEqual({
      day: 'Yesterday',
      time: '16:30',
    })
    expect(dayOf(Date.parse('2026-10-19T11:00:00'), now)).toEqual({
      day: 'Earlier',
      time: '19 Oct',
    })
  })
})

describe('the links an answer followed', () => {
  it('names each end as a mention does, with what the agent read there', () => {
    const links = linksOf(
      result({
        links: {
          on: true,
          followed: [
            {
              from: 'itm_norway_stop',
              rel: 'mentions',
              to: {
                type: 'term',
                id: 'term:0190a0a0-0000-7000-8000-00000000000e',
                label: 'Webshop',
                areaId: 'area_sales',
                read: 'Orders placed on **our site**.',
                sameAs: null,
              },
            },
          ],
          notFollowed: [
            {
              from: 'itm_norway_stop',
              rel: 'conflicts_with',
              to: { type: 'item', id: 'itm_kh4llvi9', label: 'the old switch', status: 'retired' },
            },
          ],
        },
      }),
    )
    expect(links).toEqual({
      on: true,
      followed: [
        {
          from: { id: 'itm_norway_stop', title: '' },
          rel: 'mentions',
          to: { id: 'term:Webshop', label: 'Webshop' },
          read: 'Orders placed on our site.',
        },
      ],
      notFollowed: [
        {
          from: { id: 'itm_norway_stop', title: '' },
          rel: 'disagrees',
          to: { id: 'context:itm_kh4llvi9', label: 'the old switch' },
        },
      ],
    })
  })

  it('says nothing of links for an answer that carries none', () => {
    expect(linksOf(result())).toBeUndefined()
    expect(answerOf(result(), 'Orders?', namesOf(vocabulary)).links).toBeUndefined()
  })
})
