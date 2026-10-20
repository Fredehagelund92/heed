import { describe, expect, it } from 'vitest'
import { changesSince, dayChanges, editionChanges, feedDays } from '@/lib/edition-feed'
import { validateEditionsSearch } from '@/lib/search-params'

/*
  The Editions page as a feed (Editions design, slice S3), as the page reads it: the editions by
  day, the links into What changed from an edition, since it and over a day, and the address.
*/

const entry = (label: string) => ({ edition: { label } })

describe('the feed by day', () => {
  it('groups the editions by the day in their numbers, newest first, and keeps their order', () => {
    const days = feedDays(
      ['2026-10-07.2', '2026-10-07.1', '2026-10-03.1', '2026-10-01.3', '2026-10-01.1'].map(entry),
    )
    expect(days.map((day) => [day.day, day.entries.map((one) => one.edition.label)])).toEqual([
      ['2026-10-07', ['2026-10-07.2', '2026-10-07.1']],
      ['2026-10-03', ['2026-10-03.1']],
      ['2026-10-01', ['2026-10-01.3', '2026-10-01.1']],
    ])
  })

  it('knows the edition before each day, until the feed has not read it', () => {
    const days = feedDays(['2026-10-07.2', '2026-10-07.1', '2026-10-03.1'].map(entry))
    expect(days.map((day) => day.before?.edition.label)).toEqual(['2026-10-03.1', undefined])
  })

  it('has no day for no editions', () => {
    expect(feedDays([])).toEqual([])
  })
})

describe('the ways into What changed', () => {
  it('opens one edition against the one before it, and since an edition up to the live one', () => {
    expect(editionChanges('2026-10-07.1')).toEqual({ until: '2026-10-07.1' })
    expect(changesSince('2026-10-03.1')).toEqual({ since: '2026-10-03.1' })
  })

  it('opens a day from the edition before it to its newest edition', () => {
    const [week, day] = feedDays(['2026-10-07.2', '2026-10-07.1', '2026-10-03.1'].map(entry))
    expect(dayChanges(week!)).toEqual({ since: '2026-10-03.1', until: '2026-10-07.2' })
    // The edition before is not read yet: one edition is still its own change.
    expect(dayChanges(day!)).toEqual({ until: '2026-10-03.1' })
  })

  it('has no range for a day of several editions whose edition before is not read yet', () => {
    const [day] = feedDays(['2026-10-01.3', '2026-10-01.1'].map(entry))
    expect(dayChanges(day!)).toBeNull()
  })
})

describe('the address of the Editions page', () => {
  it('keeps the table, the open edition and the page, and drops anything else', () => {
    expect(validateEditionsSearch({ view: 'table', edition: '2026-10-07.2', page: 3 })).toEqual({
      view: 'table',
      edition: '2026-10-07.2',
      page: 3,
    })
    expect(validateEditionsSearch({ view: 'feed', edition: 'latest' })).toEqual({
      view: undefined,
      edition: undefined,
    })
  })
})
