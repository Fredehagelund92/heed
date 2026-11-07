import { describe, expect, it } from 'vitest'
import { loadGoldenSet } from '../../../db/seed/golden-set.ts'
import { monthWords, readDates, whatHeedReads } from '../../../src/domain/dates.ts'
import { anyDate, shiftDate } from '../../../src/domain/validity.ts'
import { normalizeName } from '../../../src/domain/vocabulary.ts'

/*
  The date reader behind get_context, find_context, report and Ask (stage 0 of the composer, the
  captain's option B, 14 October 2026). Before it, get_facts read "this year" and "last quarter"
  as today and asked for dates on "in 2026". A named period is the whole
  period, a "this" period runs to today, a "last" one is the last complete one, and a day, month
  or quarter without a year is the latest one that has started. Every phrase is read on the golden
  set's as-of day, Wednesday 7 October 2026, and on another day, Sunday 3 January 2027, so nothing
  counts from a fixed calendar.
*/

const read = (text: string, today: string) => readDates(normalizeName(text), today)
/** The inclusive days and the reads-as phrase a text is read as. */
const days = (text: string, today: string) => {
  const result = read(text, today)
  return result.status === 'read'
    ? [result.window.start, shiftDate(result.window.end!, -1), result.readsAs]
    : result.status
}

describe('the periods a question names', () => {
  const golden = '2026-10-07'
  const sunday = '2027-01-03'
  it.each([
    // A bare year, and a month and year: the whole period, said when it runs past today.
    [
      'in 2026',
      [
        '2026-01-01',
        '2026-12-31',
        '1 Jan to 31 Dec 2026 (the whole year, including the days after today; UTC)',
      ],
      ['2026-01-01', '2026-12-31', '1 Jan to 31 Dec 2026 (UTC)'],
    ],
    [
      '2025',
      ['2025-01-01', '2025-12-31', '1 Jan to 31 Dec 2025 (UTC)'],
      ['2025-01-01', '2025-12-31', '1 Jan to 31 Dec 2025 (UTC)'],
    ],
    [
      'September 2026',
      ['2026-09-01', '2026-09-30', '1-30 Sep 2026 (UTC)'],
      ['2026-09-01', '2026-09-30', '1-30 Sep 2026 (UTC)'],
    ],
    [
      'October 2026',
      [
        '2026-10-01',
        '2026-10-31',
        '1-31 Oct 2026 (the whole month, including the days after today; UTC)',
      ],
      ['2026-10-01', '2026-10-31', '1-31 Oct 2026 (UTC)'],
    ],
    // The periods named from today: "this" runs to today, "last" is the last complete one.
    [
      'this year',
      ['2026-01-01', '2026-10-07', '1 Jan to 7 Oct 2026 (this year so far; UTC)'],
      ['2027-01-01', '2027-01-03', '1-3 Jan 2027 (this year so far; UTC)'],
    ],
    [
      'last year',
      ['2025-01-01', '2025-12-31', '1 Jan to 31 Dec 2025 (last year; UTC)'],
      ['2026-01-01', '2026-12-31', '1 Jan to 31 Dec 2026 (last year; UTC)'],
    ],
    [
      'this quarter',
      ['2026-10-01', '2026-10-07', '1-7 Oct 2026 (this quarter so far; UTC)'],
      ['2027-01-01', '2027-01-03', '1-3 Jan 2027 (this quarter so far; UTC)'],
    ],
    [
      'last quarter',
      ['2026-07-01', '2026-09-30', '1 Jul to 30 Sep 2026 (last quarter, Q3 2026; UTC)'],
      ['2026-10-01', '2026-12-31', '1 Oct to 31 Dec 2026 (last quarter, Q4 2026; UTC)'],
    ],
    [
      'Q1 2026',
      ['2026-01-01', '2026-03-31', '1 Jan to 31 Mar 2026 (UTC)'],
      ['2026-01-01', '2026-03-31', '1 Jan to 31 Mar 2026 (UTC)'],
    ],
    [
      'the first quarter of 2025',
      ['2025-01-01', '2025-03-31', '1 Jan to 31 Mar 2025 (UTC)'],
      ['2025-01-01', '2025-03-31', '1 Jan to 31 Mar 2025 (UTC)'],
    ],
    [
      'year to date',
      ['2026-01-01', '2026-10-07', '1 Jan to 7 Oct 2026 (year to date; UTC)'],
      ['2027-01-01', '2027-01-03', '1-3 Jan 2027 (year to date; UTC)'],
    ],
    [
      'YTD',
      ['2026-01-01', '2026-10-07', '1 Jan to 7 Oct 2026 (year to date; UTC)'],
      ['2027-01-01', '2027-01-03', '1-3 Jan 2027 (year to date; UTC)'],
    ],
    [
      'last week',
      ['2026-09-28', '2026-10-04', '28 Sep to 4 Oct 2026 (last week, Monday to Sunday; UTC)'],
      ['2026-12-21', '2026-12-27', '21-27 Dec 2026 (last week, Monday to Sunday; UTC)'],
    ],
    [
      'last month',
      ['2026-09-01', '2026-09-30', '1-30 Sep 2026 (last month; UTC)'],
      ['2026-12-01', '2026-12-31', '1-31 Dec 2026 (last month; UTC)'],
    ],
    [
      'this week',
      ['2026-10-05', '2026-10-07', '5-7 Oct 2026 (this week so far; UTC)'],
      ['2026-12-28', '2027-01-03', '28 Dec 2026 to 3 Jan 2027 (this week so far; UTC)'],
    ],
    [
      'next month',
      ['2026-11-01', '2026-11-30', '1-30 Nov 2026 (next month; UTC)'],
      ['2027-02-01', '2027-02-28', '1-28 Feb 2027 (next month; UTC)'],
    ],
    // The days back to today: "this past week" is the 7 days to today, as the golden case reads it.
    [
      'this past week',
      ['2026-10-01', '2026-10-07', '1-7 Oct 2026 (the 7 days to today; UTC)'],
      ['2026-12-28', '2027-01-03', '28 Dec 2026 to 3 Jan 2027 (the 7 days to today; UTC)'],
    ],
    [
      'over the last week',
      ['2026-10-01', '2026-10-07', '1-7 Oct 2026 (the 7 days to today; UTC)'],
      ['2026-12-28', '2027-01-03', '28 Dec 2026 to 3 Jan 2027 (the 7 days to today; UTC)'],
    ],
    [
      'the last 30 days',
      ['2026-09-08', '2026-10-07', '8 Sep to 7 Oct 2026 (the 30 days to today; UTC)'],
      ['2026-12-05', '2027-01-03', '5 Dec 2026 to 3 Jan 2027 (the 30 days to today; UTC)'],
    ],
    [
      'the last two days',
      ['2026-10-06', '2026-10-07', '6-7 Oct 2026 (the 2 days to today; UTC)'],
      ['2027-01-02', '2027-01-03', '2-3 Jan 2027 (the 2 days to today; UTC)'],
    ],
    [
      'the past 3 months',
      ['2026-07-08', '2026-10-07', '8 Jul to 7 Oct 2026 (the 3 months to today; UTC)'],
      ['2026-10-04', '2027-01-03', '4 Oct 2026 to 3 Jan 2027 (the 3 months to today; UTC)'],
    ],
    [
      'yesterday',
      ['2026-10-06', '2026-10-06', '6 Oct 2026 (yesterday; UTC)'],
      ['2027-01-02', '2027-01-02', '2 Jan 2027 (yesterday; UTC)'],
    ],
    // Ranges, with a year given on one side counting for the other.
    [
      '1 Jan to 30 Sep',
      ['2026-01-01', '2026-09-30', '1 Jan to 30 Sep 2026 (year not given, so 2026; UTC)'],
      ['2027-01-01', '2027-09-30', '1 Jan to 30 Sep 2027 (year not given, so 2027; UTC)'],
    ],
    [
      'from March to May 2026',
      ['2026-03-01', '2026-05-31', '1 Mar to 31 May 2026 (UTC)'],
      ['2026-03-01', '2026-05-31', '1 Mar to 31 May 2026 (UTC)'],
    ],
    [
      'from 1 to 7 October 2026',
      ['2026-10-01', '2026-10-07', '1-7 Oct 2026 (UTC)'],
      ['2026-10-01', '2026-10-07', '1-7 Oct 2026 (UTC)'],
    ],
    [
      'on 6 and 7 October',
      ['2026-10-06', '2026-10-07', '6-7 Oct 2026 (year not given, so 2026; UTC)'],
      ['2026-10-06', '2026-10-07', '6-7 Oct 2026 (year not given, so 2026; UTC)'],
    ],
    [
      '1 Dec to 15 Jan',
      ['2025-12-01', '2026-01-15', '1 Dec 2025 to 15 Jan 2026 (year not given, so 2025; UTC)'],
      ['2026-12-01', '2027-01-15', '1 Dec 2026 to 15 Jan 2027 (year not given, so 2026; UTC)'],
    ],
    [
      'between February 2025 and April 2025',
      ['2025-02-01', '2025-04-30', '1 Feb to 30 Apr 2025 (UTC)'],
      ['2025-02-01', '2025-04-30', '1 Feb to 30 Apr 2025 (UTC)'],
    ],
    [
      '2026-08-04 to 2026-08-10',
      ['2026-08-04', '2026-08-10', '4-10 Aug 2026 (UTC)'],
      ['2026-08-04', '2026-08-10', '4-10 Aug 2026 (UTC)'],
    ],
    [
      'from 1 August 2026 to today',
      ['2026-08-01', '2026-10-07', '1 Aug to 7 Oct 2026 (to today; UTC)'],
      ['2026-08-01', '2027-01-03', '1 Aug 2026 to 3 Jan 2027 (to today; UTC)'],
    ],
    [
      'since 1 September 2026',
      ['2026-09-01', '2026-10-07', '1 Sep to 7 Oct 2026 (to today; UTC)'],
      ['2026-09-01', '2027-01-03', '1 Sep 2026 to 3 Jan 2027 (to today; UTC)'],
    ],
    [
      'so far in October 2026',
      ['2026-10-01', '2026-10-07', '1-7 Oct 2026 (so far; UTC)'],
      ['2026-10-01', '2026-10-31', '1-31 Oct 2026 (UTC)'],
    ],
    // A day, month or quarter without a year is the latest one that has started.
    [
      'in August',
      ['2026-08-01', '2026-08-31', '1-31 Aug 2026 (year not given, so 2026; UTC)'],
      ['2026-08-01', '2026-08-31', '1-31 Aug 2026 (year not given, so 2026; UTC)'],
    ],
    [
      'in December',
      ['2025-12-01', '2025-12-31', '1-31 Dec 2025 (year not given, so 2025; UTC)'],
      ['2026-12-01', '2026-12-31', '1-31 Dec 2026 (year not given, so 2026; UTC)'],
    ],
    [
      'in May',
      ['2026-05-01', '2026-05-31', '1-31 May 2026 (year not given, so 2026; UTC)'],
      ['2026-05-01', '2026-05-31', '1-31 May 2026 (year not given, so 2026; UTC)'],
    ],
    [
      'in Q3',
      ['2026-07-01', '2026-09-30', '1 Jul to 30 Sep 2026 (year not given, so 2026; UTC)'],
      ['2026-07-01', '2026-09-30', '1 Jul to 30 Sep 2026 (year not given, so 2026; UTC)'],
    ],
    [
      'on 18 September',
      ['2026-09-18', '2026-09-18', '18 Sep 2026 (year not given, so 2026; UTC)'],
      ['2026-09-18', '2026-09-18', '18 Sep 2026 (year not given, so 2026; UTC)'],
    ],
    [
      'the whole of September 2026',
      ['2026-09-01', '2026-09-30', '1-30 Sep 2026 (UTC)'],
      ['2026-09-01', '2026-09-30', '1-30 Sep 2026 (UTC)'],
    ],
  ])('reads %s', (text, onGolden, onSunday) => {
    expect(days(text, golden)).toEqual(onGolden)
    expect(days(text, sunday)).toEqual(onSunday)
  })

  it('reads the period a comparison is about, not the months it compares with', () => {
    // A seed test question: the definition changed in March 2025, the item that must be given.
    expect(
      days('Can I compare net revenue in Canada in March 2025 with the months before?', golden),
    ).toEqual(days('March 2025', golden))
  })

  it('reads the same period in a whole question, wherever it sits', () => {
    expect(days('What was net revenue in Norway in 2026?', golden)).toEqual(days('2026', golden))
    expect(days('Orders, last quarter, for the United Kingdom', golden)).toEqual(
      days('last quarter', golden),
    )
    // The same period named twice is one period.
    expect(days('August 2026: how did August 2026 go?', golden)).toEqual(
      days('August 2026', golden),
    )
  })

  it('says the time zone the days are counted in', () => {
    expect(readDates('this year', golden, { timeZone: 'Europe/Copenhagen' })).toMatchObject({
      readsAs: '1 Jan to 7 Oct 2026 (this year so far; Europe/Copenhagen)',
    })
  })

  it.each([
    'how may orders change',
    'orders over 2000 euros',
    'what is going on right now',
    'has the definition changed recently',
    'how is it doing so far',
    'over how many days do we credit revenue',
    'sometime',
    'how did the weekend discount do',
    'what did the summer campaign change',
  ])('reads no dates in %s', (text) => {
    expect(read(text, golden)).toEqual({ status: 'none' })
  })
})

describe('dates Heed cannot read', () => {
  const golden = '2026-10-07'
  const reads =
    'The dates that can be read: a day (7 Oct 2026), a range of days (1-30 Sep 2026), a month (September 2026), a quarter (Q3 2026), a year (2026), this, last or next week, month, quarter or year, year to date, and the last 30 days. Ask with one of these, or pass window with from and to.'

  it.each([
    ['since the launch', 'since the launch'],
    ['around the summer', 'around the summer'],
    ['the past few days', 'past few days'],
    ['two weeks ago', 'two weeks ago'],
    ['during the first week of October', 'first week of october'],
    ['from early 2024 up to today', 'early 2024 up to today'],
    ['earlier this year', 'earlier this year'],
    ['the end of 2026', 'end of 2026'],
    ['mid-September', 'mid-september'],
    ['this weekend', 'this weekend'],
    ['H1 2026', 'h1 2026'],
    ['in summer 2025', 'summer 2025'],
    ['2026-02-30', '2026-02-30'],
    ['30 February 2026', '30 february 2026'],
    ['the last 0 days', 'last 0 days'],
    ['from 30 Sep 2026 to 1 Jan 2026', 'from 30 sep 2026 to 1 jan 2026'],
    ['12/10/2026', '12/10/2026'],
    ['revenue on 10/12/2026', '10/12/2026'],
    ['10.12.2026', '10.12.2026'],
    ['12-10-2026', '12-10-2026'],
    ['revenue 10-12-2026', '10-12-2026'],
    ['2026/10/12', '2026/10/12'],
  ])('never replaces %s, and says what it reads', (text, words) => {
    expect(read(text, golden)).toEqual({
      status: 'unreadable',
      spans: expect.any(Array) as unknown,
      message: `'${words}' cannot be read as dates. ${reads}`,
    })
  })

  it('asks for one period when a question names more than one', () => {
    expect(read('orders 2025 vs 2026', golden)).toMatchObject({
      status: 'unreadable',
      message:
        "The question names more than one period ('2025' and '2026'), and one is read at a time. Ask about one, or pass window with from and to for the days that cover them.",
    })
  })

  it('counts its examples from today', () => {
    expect(whatHeedReads('2027-01-03')).toBe(
      'The dates that can be read: a day (3 Jan 2027), a range of days (1-31 Dec 2026), a month (December 2026), a quarter (Q4 2026), a year (2027), this, last or next week, month, quarter or year, year to date, and the last 30 days. Ask with one of these, or pass window with from and to.',
    )
  })
})

describe('where the dates are', () => {
  it('gives the place of each period, and reads no date where a name is', () => {
    const text = 'orders in q3 2026 for norway'
    expect(readDates(text, '2026-10-07')).toMatchObject({
      status: 'read',
      spans: [{ start: 10, end: 17 }],
    })
    // A name that took "q3" leaves "2026" alone: the year is read, never the name.
    const taken = new Set(Array.from({ length: 2 }, (_, i) => 10 + i))
    expect(readDates(text, '2026-10-07', { taken })).toMatchObject({
      status: 'read',
      window: { start: '2026-01-01', end: '2027-01-01' },
      spans: [{ start: 13, end: 17 }],
    })
  })
})

describe('the golden set', () => {
  // Every visible case whose precise wording writes its days out reads as the case's own window.
  const cases = loadGoldenSet().cases.flatMap((c) =>
    c.wordings
      .filter((w) => w.kind === 'precise' && /\d/.test(w.text) && c.scope?.window)
      .map((w) => [c.id, w.text, c.as_of, c.scope!.window!] as const),
  )
  it('has precise wordings with written days', () => expect(cases.length).toBeGreaterThan(20))
  it.each(cases)('%s reads its window', (_id, text, asOf, window) => {
    const result = read(text, asOf)
    expect(result).toMatchObject({ status: 'read' })
    if (result.status === 'read')
      expect([result.window.start, shiftDate(result.window.end!, -1)]).toEqual([
        window.from,
        window.to,
      ])
  })
})

describe('a month in words', () => {
  it('names the month of a day in full, with its year', () => {
    expect(monthWords('2026-10-01')).toBe('October 2026')
    expect(monthWords('2027-01-31')).toBe('January 2027')
  })
})

// Fix round 3: Ask reads dates as people write them. A loose date is resolved against today and
// said in how it was read, and nothing a person writes stops the question.
describe('loose dates, as Ask reads them', () => {
  const today = '2026-10-23'
  const read = (text: string) => {
    const got = readDates(text, today, { loose: true })
    if (got.status !== 'read') throw new Error(`${text} read as ${got.status}`)
    return [got.window.start, shiftDate(got.window.end!, -1)]
  }

  it.each([
    ['in august', '2026-08-01', '2026-08-31'],
    ['in may', '2026-05-01', '2026-05-31'],
    ['in december', '2025-12-01', '2025-12-31'],
    ['early august', '2026-08-01', '2026-08-10'],
    ['mid-august', '2026-08-11', '2026-08-20'],
    ['late august', '2026-08-21', '2026-08-31'],
    ['the end of last quarter', '2026-08-30', '2026-09-30'],
    ['the start of q3', '2026-07-01', '2026-07-30'],
    ['first week of august', '2026-08-01', '2026-08-07'],
    ['the last week of september', '2026-09-24', '2026-09-30'],
    ['the first half of 2026', '2026-01-01', '2026-06-30'],
    ['second half of last year', '2025-07-01', '2025-12-31'],
    ['h1', '2026-01-01', '2026-06-30'],
    ['h2 last year', '2025-07-01', '2025-12-31'],
    ['last summer', '2026-06-01', '2026-08-31'],
    ['this summer', '2026-06-01', '2026-08-31'],
    ['last winter', '2025-12-01', '2026-02-28'],
    ['this winter', '2026-12-01', '2027-02-28'],
    ['next spring', '2027-03-01', '2027-05-31'],
    ['autumn 2025', '2025-09-01', '2025-11-30'],
    ['last year', '2025-01-01', '2025-12-31'],
    ['last quarter', '2026-07-01', '2026-09-30'],
    ['august last year', '2025-08-01', '2025-08-31'],
    ['q3 last year', '2025-07-01', '2025-09-30'],
    ['last august', '2026-08-01', '2026-08-31'],
    ['this time last year', '2025-10-01', '2025-10-31'],
    ['two weeks ago', '2026-10-05', '2026-10-11'],
    ['a month ago', '2026-09-01', '2026-09-30'],
    ['3 days ago', '2026-10-20', '2026-10-20'],
    ['a few days ago', '2026-10-19', '2026-10-21'],
    ['the past few days', '2026-10-21', '2026-10-23'],
    ['the last couple of weeks', '2026-10-10', '2026-10-23'],
    ['recent months', '2026-07-24', '2026-10-23'],
    ['last fortnight', '2026-10-10', '2026-10-23'],
    ['last weekend', '2026-10-17', '2026-10-18'],
    ['this weekend', '2026-10-24', '2026-10-25'],
    ['last tuesday', '2026-10-20', '2026-10-20'],
    ['earlier this year', '2026-01-01', '2026-10-22'],
    ['later this month', '2026-10-24', '2026-10-31'],
    ['the month before last', '2026-08-01', '2026-08-31'],
    ['the week of 5 october', '2026-10-05', '2026-10-11'],
    ['last fiscal year', '2025-01-01', '2025-12-31'],
    ['fy26', '2026-01-01', '2026-12-31'],
    ['12/10/2026', '2026-10-12', '2026-10-12'],
    ['since last summer', '2026-06-01', '2026-10-23'],
    ['after the summer', '2026-09-01', '2026-10-23'],
    ['before august', anyDate.start, '2026-07-31'],
    ['until last month', anyDate.start, '2026-08-31'],
    ['by the end of the year', anyDate.start, '2026-12-31'],
    ['around august', '2026-08-01', '2026-08-31'],
    ['august and september', '2026-08-01', '2026-09-30'],
    ['august vs september', '2026-08-01', '2026-09-30'],
    ['last year and this year', '2025-01-01', '2026-10-23'],
  ])('reads "%s"', (text, from, to) => {
    expect(read(text)).toEqual([from, to])
  })

  it.each([
    'since the launch',
    'a while ago',
    '31 february',
    'around christmas',
    'before the rebrand',
    'after the migration',
    'in h3',
  ])('never fails on "%s"', (text) => {
    const got = readDates(text, today, { loose: true })
    expect(got.status).not.toBe('unreadable')
  })

  it('names what it could not place, and reads every date', () => {
    const got = readDates('since the launch', today, { loose: true })
    expect(got).toMatchObject({ status: 'read', window: anyDate, unplaced: ['since the launch'] })
    if (got.status === 'read') expect(got.readsAs).toContain("could not place 'since the launch'")
  })

  it('says the resolved days and the words they came from', () => {
    const got = readDates('last summer', today, { loose: true })
    if (got.status !== 'read') throw new Error('read')
    expect(got.readsAs).toBe('1 Jun to 31 Aug 2026 (last summer, June to August; UTC)')
  })

  it.each(['orders fall in norway', 'the spring sale in spain', 'what may change', 'winter coats'])(
    'finds no date in "%s"',
    (text) => {
      expect(readDates(text, today, { loose: true }).status).toBe('none')
    },
  )

  it.each([
    'what caused the fall in orders in norway',
    'what do we know about orders by month',
    'orders by week',
    'orders by year',
  ])('finds no date in "%s"', (text) => {
    expect(readDates(text, today, { loose: true }).status).toBe('none')
  })

  it.each(['orders by the end of the year', 'start of the month', 'in the fall'])(
    'still reads "%s"',
    (text) => {
      expect(readDates(text, today, { loose: true }).status).toBe('read')
    },
  )

  it('names what follows "the week before" instead of dropping it', () => {
    const got = readDates('the week before the launch', today, { loose: true })
    expect(got).toMatchObject({
      status: 'read',
      window: anyDate,
      unplaced: ['the week before the launch'],
    })
    const pair = readDates('last week against the week before', today, { loose: true })
    expect(pair).toMatchObject({ status: 'read' })
    if (pair.status === 'read') expect(pair.unplaced).toBeUndefined()
  })

  describe('with today Monday 2 November 2026', () => {
    const monday = '2026-11-02'
    const window = (text: string) => {
      const got = readDates(text, monday, { loose: true })
      if (got.status !== 'read') throw new Error(`${text} read as ${got.status}`)
      return [got.window.start, shiftDate(got.window.end!, -1)]
    }

    it.each([
      ['next weekend', ['2026-11-14', '2026-11-15']],
      ['this friday', ['2026-11-06', '2026-11-06']],
      ['next monday', ['2026-11-09', '2026-11-09']],
      ['last friday', ['2026-10-30', '2026-10-30']],
      ['second half of last week', ['2026-10-29', '2026-11-01']],
    ])('reads "%s"', (text, days) => {
      expect(window(text)).toEqual(days)
    })

    it.each(['orders by the month', 'orders by the week', 'during the fall in orders'])(
      'finds no date in "%s"',
      (text) => {
        expect(readDates(text, monday, { loose: true }).status).toBe('none')
      },
    )

    it.each([
      ['by year end', '2026-12-31'],
      ['by quarter end', '2026-12-31'],
      ['by month end', '2026-11-30'],
      ['by the end of this year', '2026-12-31'],
    ])('reads "%s" up to %s', (text, last) => {
      const got = readDates(text, monday, { loose: true })
      if (got.status !== 'read') throw new Error(text)
      expect(shiftDate(got.window.end!, -1)).toBe(last)
      expect(got.readsAs).toMatch(/^up to /)
    })

    it.each(['the week before christmas', 'since the fall', 'after the fall'])(
      'names the words of "%s" it cannot place',
      (text) => {
        expect(readDates(text, monday, { loose: true })).toMatchObject({
          status: 'read',
          unplaced: [text],
        })
      },
    )

    it.each(['the year-end report', 'a quarter-end rush'])('finds no date in "%s"', (text) => {
      expect(readDates(text, monday, { loose: true }).status).toBe('none')
    })

    it('says up to for a loose read of one side, and not for a strict one', () => {
      const got = readDates('before august', monday, { loose: true })
      if (got.status !== 'read') throw new Error('read')
      expect(got.readsAs).toBe('up to 31 Jul 2026 (before august; UTC)')
    })

    it('never fails on a fiscal year it cannot place', () => {
      const got = readDates('what was added in fy 0000', monday, { loose: true })
      expect(got).toMatchObject({ status: 'read', unplaced: ['fy 0000'] })
    })
  })

  it('is off for agents: get_context keeps the strict reader', () => {
    for (const text of ['early august', 'last summer', 'two weeks ago'])
      expect(readDates(text, today).status).toBe('unreadable')
  })
})
