import { describe, expect, it } from 'vitest'
import type { ContextItem } from '@domain/item'
import { itemConditions } from '@domain/item-conditions'
import { asksForALook, isEndedIssue, itemDisplayStatus, needsALook } from '@domain/status'
import { versionRows } from '@/components/item/history-table'
import { dayRange, itemState, type StateContext } from '@/lib/item-state'
import { validateItemSearch, validateLibrarySearch } from '@/lib/search-params'

const TODAY = '2026-10-07'

const base: ContextItem = {
  id: 'itm_testtest',
  kind: 'note',
  areaId: 'area_commercial',
  status: 'accepted',
  version: 2,
  title: 'Net revenue excludes test accounts',
  summary: 'Net revenue excludes test accounts.',
  references: [],
  scope: { metrics: ['net_revenue'], dimensions: [], dimensionValues: [] },
  validity: { start: '2026-05-14', end: null },
  reviewDate: '2027-01-13',
  reviewQuestion: 'still_correct',
  evidence: [],
  checkFlag: null,
  claimLevel: 'fact_only',
  riskLevel: 'normal',
  notToConclude: 'cause not proven',
  audience: { kind: 'everyone' },
  ownerId: 'per_jon',
  changeMarks: {},
  createdVia: 'form',
  proposerId: 'per_maria',
  createdAt: '2026-05-14T08:00:00Z',
  updatedAt: '2026-05-20T08:00:00Z',
}

const context: StateContext = {
  today: TODAY,
  ownerName: 'Jon Abara',
  areaName: 'Commercial',
  retired: null,
}

const issue = (validity: ContextItem['validity'], reviewDate: string | null): ContextItem => ({
  ...base,
  kind: 'issue',
  validity,
  reviewDate,
  reviewQuestion: validity.end === null ? 'still_going_on' : 'still_correct',
})

describe('every condition that is true of an item', () => {
  it('keeps the source flag beside an ended lifecycle, where the list shows only Ended', () => {
    const ended = {
      ...base,
      validity: { start: '2026-04-06', end: '2026-05-11' },
      checkFlag: 'source_missing' as const,
    }
    expect(itemDisplayStatus(ended, TODAY)).toBe('expired')
    expect(itemConditions(ended, TODAY)).toEqual({
      lifecycle: 'ended',
      warnings: ['source_missing'],
    })
  })

  it('lists a source flag before a passed review date, and drops the review once ended', () => {
    expect(
      itemConditions({ ...base, checkFlag: 'needs_check', reviewDate: '2026-10-01' }, TODAY),
    ).toEqual({ lifecycle: 'accepted', warnings: ['needs_check', 'stale'] })
    expect(
      itemConditions(
        { ...base, validity: { start: '2026-01-01', end: '2026-09-01' }, reviewDate: '2026-08-01' },
        TODAY,
      ).warnings,
    ).toEqual([])
  })

  it('gives a retired item no warnings: it is never delivered', () => {
    expect(itemConditions({ ...base, status: 'retired', checkFlag: 'needs_check' }, TODAY)).toEqual(
      { lifecycle: 'retired', warnings: [] },
    )
  })

  it('reads an issue as active while it applies and resolved once its last day passed', () => {
    const open = issue({ start: '2026-10-02', end: null }, '2026-10-16')
    const ending = issue({ start: '2026-09-29', end: '2026-10-11' }, null)
    const ended = issue({ start: '2026-08-03', end: '2026-08-15' }, null)
    expect(itemConditions(open, TODAY).lifecycle).toBe('active_issue')
    expect(itemConditions(ending, TODAY).lifecycle).toBe('active_issue')
    expect(itemConditions(ended, TODAY).lifecycle).toBe('resolved_issue')
    expect(itemDisplayStatus(open, TODAY)).toBe('active_issue')
    expect(itemDisplayStatus(ended, TODAY)).toBe('expired')
    expect(isEndedIssue(ended, TODAY)).toBe(true)
    expect(isEndedIssue(open, TODAY)).toBe(false)
    expect(isEndedIssue({ ...ended, kind: 'event' }, TODAY)).toBe(false)
  })

  it('shows an active issue in the warning tone without putting it in Needs a look', () => {
    expect(asksForALook('active_issue')).toBe(true)
    expect(needsALook('active_issue')).toBe(false)
    expect(asksForALook('accepted')).toBe(false)
  })
})

describe('the lifecycle in plain words, the detail under the validity chip', () => {
  it('reads a standing fact as applying since its date, ongoing, with its next check', () => {
    expect(itemState(base, context).lifecycle).toEqual({
      key: 'accepted',
      title: 'Accepted',
      line: 'It applies from 14 May 2026 and is still going on. Agents get it when a question is about it. The owner checks it again by 13 January 2027, in 98 days.',
    })
  })

  it('drops "Agents get it" when a warning is also true', () => {
    const state = itemState({ ...base, checkFlag: 'needs_check' }, context)
    expect(state.lifecycle.line).not.toContain('Agents get it when')
  })

  it('says an active issue applies until its last day, or is still happening', () => {
    const ending = itemState(issue({ start: '2026-09-29', end: '2026-10-11' }, null), context)
    expect(ending.lifecycle.line).toBe(
      'It started on 29 September 2026 and applies until 10 October 2026, in 3 days. Agents warn about it in answers about that time.',
    )
    const open = itemState(issue({ start: '2026-10-02', end: null }, '2026-10-16'), context)
    expect(open.lifecycle.line).toContain('is still going on')
    expect(open.lifecycle.line).toContain(
      "The owner asks whether it's still going on by 16 October 2026, in 9 days.",
    )
  })

  it('says when the check of an open issue was due once it has passed', () => {
    const state = itemState(issue({ start: '2026-09-15', end: null }, '2026-09-29'), context)
    expect(state.lifecycle.title).toBe('Active issue')
    expect(state.lifecycle.line).toContain('The check was due 8 days ago, on 29 September 2026.')
  })

  it('reads a resolved issue as resolved on its last day and kept for its period', () => {
    const state = itemState(issue({ start: '2026-08-03', end: '2026-08-15' }, null), context)
    expect(state.lifecycle).toEqual({
      key: 'resolved_issue',
      title: 'Resolved',
      line: 'Resolved on 14 August 2026. It applied 3 to 14 August 2026, so agents get it only for questions about that period.',
    })
  })

  it('shows the last valid day, never the exclusive stored end, on a resolved issue', () => {
    const resolved = itemState(issue({ start: '2026-09-06', end: '2026-09-23' }, null), context)
    expect(resolved.lifecycle.line).toBe(
      'Resolved on 22 September 2026. It applied 6 to 22 September 2026, so agents get it only for questions about that period.',
    )
    const ended = itemState(
      { ...base, validity: { start: '2026-09-06', end: '2026-09-23' } },
      context,
    )
    expect(ended.lifecycle.line).toContain('on 22 September 2026.')
  })

  it('names the one day of a one-day resolved issue once', () => {
    const state = itemState(issue({ start: '2026-09-10', end: '2026-09-11' }, null), context)
    expect(state.lifecycle.line).toBe(
      'Resolved on 10 September 2026. It applied on 10 September 2026, so agents get it only for questions about that period.',
    )
  })

  it('says how long ago a fact ended and who archived one', () => {
    const ended = itemState(
      { ...base, validity: { start: '2026-04-06', end: '2026-05-11' } },
      context,
    )
    expect(ended.lifecycle.line).toBe(
      'It ended 150 days ago, on 10 May 2026. Agents get it only for questions about that period.',
    )
    const retired = itemState(
      { ...base, status: 'retired' },
      { ...context, retired: { by: 'Jon Abara', date: '2026-09-01' } },
    )
    expect(retired.lifecycle.line).toBe(
      "Jon Abara archived it on 1 September 2026. It stays in the history, and agents don't get it.",
    )
  })

  it('says a period in the future has not started and is used only for dates from then on', () => {
    const future = itemState({ ...base, validity: { start: '2026-11-01', end: null } }, context)
    expect(future.lifecycle).toEqual({
      key: 'future',
      title: 'Not started yet',
      line: 'It applies from 1 November 2026, in 25 days. Agents get it only for questions about dates from then on. The owner checks it by 13 January 2027.',
    })
    const bounded = itemState(
      { ...base, validity: { start: '2026-11-01', end: '2026-12-01' }, reviewDate: null },
      context,
    )
    expect(bounded.lifecycle.line).toBe(
      'It applies from 1 November 2026, in 25 days, until 30 November 2026. Agents get it only for questions about dates from then on.',
    )
    const laterIssue = itemState(issue({ start: '2026-10-20', end: null }, '2026-11-03'), context)
    expect(laterIssue.lifecycle.key).toBe('future')
  })

  it('writes a short range with the year once', () => {
    expect(dayRange('2026-08-03', '2026-08-14')).toBe('3 to 14 Aug 2026')
    expect(dayRange('2026-04-06', '2026-05-10')).toBe('6 Apr to 10 May 2026')
    expect(dayRange('2025-12-30', '2026-01-02')).toBe('30 Dec 2025 to 2 Jan 2026')
  })
})

describe('the validity chip: the period it applies', () => {
  const chip = (item: ContextItem, extra: Partial<StateContext> = {}) =>
    itemState(item, { ...context, ...extra }).chip
  const words = (item: ContextItem) => {
    const { label, tail } = chip(item)
    return `${label}${tail}`
  }

  it('shows the start of a standing fact with no end, still going on', () => {
    expect(chip(base)).toEqual({
      key: 'applies_since',
      label: 'From 14 May 2026',
      tail: ', still going on',
      soon: false,
      quiet: false,
    })
  })

  it('shows the last valid day of an end, and turns soon within 30 days', () => {
    expect(chip({ ...base, validity: { start: '2026-05-14', end: '2026-12-01' } })).toEqual({
      key: 'applies_until',
      label: 'Until 30 November 2026',
      tail: '',
      soon: false,
      quiet: false,
    })
    expect(chip({ ...base, validity: { start: '2026-05-14', end: '2026-10-26' } })).toEqual({
      key: 'applies_until',
      label: 'Until 25 October 2026',
      tail: ', in 18 days',
      soon: true,
      quiet: false,
    })
    expect(words({ ...base, validity: { start: '2026-05-14', end: '2026-10-08' } })).toBe(
      'Until 7 October 2026, today',
    )
    expect(chip({ ...base, validity: { start: '2026-05-14', end: '2026-11-07' } }).soon).toBe(true)
    expect(chip({ ...base, validity: { start: '2026-05-14', end: '2026-11-08' } }).soon).toBe(false)
  })

  it('says an active issue is active until its last day, or since its start', () => {
    expect(chip(issue({ start: '2026-09-29', end: '2026-10-11' }, null))).toEqual({
      key: 'active_until',
      label: 'Active until 10 October 2026',
      tail: ', in 3 days',
      soon: true,
      quiet: false,
    })
    expect(chip(issue({ start: '2026-10-02', end: null }, '2026-10-16'))).toEqual({
      key: 'active_since',
      label: 'Active since 2 October 2026',
      tail: '',
      soon: false,
      quiet: false,
    })
  })

  it('mutes a period that is over: ended, resolved and archived', () => {
    expect(chip({ ...base, validity: { start: '2024-04-08', end: '2024-05-14' } })).toEqual({
      key: 'ended',
      label: 'Applied 8 April to 13 May 2024',
      tail: '',
      soon: false,
      quiet: true,
    })
    expect(words(issue({ start: '2026-08-03', end: '2026-08-15' }, null))).toBe(
      'Resolved, applied 3 to 14 August 2026',
    )
    expect(words(issue({ start: '2026-09-10', end: '2026-09-11' }, null))).toBe(
      'Resolved, applied on 10 September 2026',
    )
    expect(
      chip({ ...base, status: 'retired' }, { retired: { by: 'Jon Abara', date: '2024-07-05' } }),
    ).toEqual({ key: 'retired', label: 'Archived 5 July 2024', tail: '', soon: false, quiet: true })
    expect(chip({ ...base, status: 'retired' }).label).toBe('Archived')
  })

  it('says when a period in the future starts', () => {
    expect(chip({ ...base, validity: { start: '2026-11-01', end: null } })).toEqual({
      key: 'future',
      label: 'Starts 1 November 2026',
      tail: ', in 25 days',
      soon: false,
      quiet: false,
    })
  })
})

describe('the check date, quiet text beside the chip', () => {
  const next = (item: ContextItem) => itemState(item, context).nextCheck

  it('shows the check date, with the days left within 30 days', () => {
    expect(next(base)).toBe('Check again by 13 January 2027')
    expect(next(issue({ start: '2026-10-02', end: null }, '2026-10-16'))).toBe(
      'Check again by 16 October 2026, in 9 days',
    )
    expect(next({ ...base, reviewDate: TODAY })).toBe('Check again by 7 October 2026, today')
  })

  it('says when the check was due once it has passed', () => {
    expect(next({ ...base, reviewDate: '2026-09-04' })).toBe('Check was due 4 September 2026')
  })

  it('is left out with no review date, and once the item no longer applies', () => {
    expect(next({ ...base, reviewDate: null })).toBeNull()
    expect(next({ ...base, validity: { start: '2026-04-06', end: '2026-05-11' } })).toBeNull()
    expect(next(issue({ start: '2026-08-03', end: '2026-08-15' }, '2026-08-20'))).toBeNull()
    expect(next({ ...base, status: 'retired' })).toBeNull()
  })
})

describe('the note line: what agents do and who acts', () => {
  const note = (item: ContextItem, extra: Partial<StateContext> = {}) =>
    itemState(item, { ...context, ...extra }).note

  it('is left out while nothing asks for a look, an active issue included', () => {
    expect(note(base)).toBeNull()
    expect(note(issue({ start: '2026-10-02', end: null }, '2026-10-16'))).toBeNull()
    expect(note({ ...base, status: 'retired', checkFlag: 'source_missing' })).toBeNull()
  })

  it('says agents are told a flagged fact may be out of date until the owner checks it', () => {
    expect(note({ ...base, checkFlag: 'source_missing' })).toBe(
      'Agents are told it may be out of date until Jon Abara checks it.',
    )
    expect(note({ ...base, checkFlag: 'needs_check', reviewDate: '2026-10-01' })).toBe(
      'Agents are told it may be out of date until Jon Abara checks it.',
    )
  })

  it('warns that agents may not get a high-risk fact', () => {
    expect(note({ ...base, checkFlag: 'source_missing', riskLevel: 'high' })).toBe(
      'Agents may not get it until Jon Abara checks it.',
    )
  })

  it('asks for a re-check of an overdue item, and an open issue whether it is still going on', () => {
    expect(note({ ...base, reviewDate: '2026-09-04' })).toBe(
      'Agents are told it may be out of date until Jon Abara checks it again.',
    )
    const stillGoing = itemState(issue({ start: '2026-09-15', end: null }, '2026-09-29'), context)
    expect(stillGoing.note).toBe(
      "Agents are told it may be out of date until Jon Abara confirms it's still going on.",
    )
    expect(stillGoing.stillGoingOn).toBe(true)
    expect(itemState({ ...base, reviewDate: '2026-09-04' }, context).stillGoingOn).toBe(false)
  })

  it('names the owner of the domain when the owner is not known', () => {
    expect(note({ ...base, checkFlag: 'source_missing' }, { ownerName: null })).toBe(
      'Agents are told it may be out of date until the owner of Commercial checks it.',
    )
    expect(
      note({ ...base, checkFlag: 'source_missing' }, { ownerName: null, areaName: null }),
    ).toBe('Agents are told it may be out of date until the owner checks it.')
  })

  it('keeps an ended fact’s source flag, which agents still see for its period', () => {
    expect(
      note({
        ...base,
        validity: { start: '2026-04-06', end: '2026-05-11' },
        checkFlag: 'needs_check',
      }),
    ).toBe('Agents are told it may be out of date until Jon Abara checks it.')
  })

  it('tells the Source tab what a source flag means', () => {
    expect(itemState({ ...base, checkFlag: 'source_missing' }, context).source).toEqual({
      flag: 'source_missing',
      what: 'Something this fact is about is gone from its source.',
    })
    expect(itemState({ ...base, reviewDate: '2026-09-04' }, context).source).toBeNull()
  })
})

describe('the history, one row per version', () => {
  it('folds the events of a version into one row, newest first', () => {
    const rows = versionRows(
      [
        { version: 2, event: 'retired', date: '2026-09-01', personId: 'per_jon' },
        { version: 2, event: 'accepted', date: '2026-06-01', personId: 'per_jon' },
        { version: 2, event: 'proposed', date: '2026-05-30', personId: 'per_maria' },
        { version: 1, event: 'accepted', date: '2026-05-01', personId: 'per_jon' },
      ],
      (id) => (id === 'per_jon' ? 'Jon Abara' : 'Maria Lindqvist'),
    )
    expect(rows).toEqual([
      {
        version: 2,
        proposed: { by: 'Maria Lindqvist', date: '2026-05-30' },
        accepted: { by: 'Jon Abara', date: '2026-06-01' },
        retired: { by: 'Jon Abara', date: '2026-09-01' },
        binned: null,
        restored: null,
      },
      {
        version: 1,
        proposed: null,
        accepted: { by: 'Jon Abara', date: '2026-05-01' },
        retired: null,
        binned: null,
        restored: null,
      },
    ])
  })

  it('shows the latest stay of a version in the Bin', () => {
    const [row] = versionRows(
      [
        { version: 1, event: 'restored', date: '2026-10-09', personId: 'per_ravi' },
        { version: 1, event: 'binned', date: '2026-10-08', personId: 'per_ravi' },
        { version: 1, event: 'restored', date: '2026-10-02', personId: 'per_jon' },
        { version: 1, event: 'binned', date: '2026-10-01', personId: 'per_jon' },
        { version: 1, event: 'accepted', date: '2026-05-01', personId: 'per_jon' },
      ],
      (id) => (id === 'per_jon' ? 'Jon Abara' : 'Ravi Shah'),
    )
    expect(row).toMatchObject({
      binned: { by: 'Ravi Shah', date: '2026-10-08' },
      restored: { by: 'Ravi Shah', date: '2026-10-09' },
    })
  })
})

describe('item and library search params', () => {
  it('accepts the issue kind, the active issue status and the ended issues filter', () => {
    expect(validateLibrarySearch({ kind: 'issue', status: 'active_issue', ended: 'show' })).toEqual(
      {
        kind: 'issue',
        status: 'active_issue',
        ended: 'show',
      },
    )
    expect(validateLibrarySearch({ ended: 'yes' }).ended).toBeUndefined()
  })

  it('keeps the tab of an item page and the list it came from', () => {
    expect(validateItemSearch({ tab: 'source', view: 'attention' })).toEqual({
      tab: 'source',
      view: 'attention',
    })
    expect(validateItemSearch({ tab: 'read' }).tab).toBeUndefined()
    expect(validateItemSearch({ tab: 'diff' }).tab).toBeUndefined()
  })
})
