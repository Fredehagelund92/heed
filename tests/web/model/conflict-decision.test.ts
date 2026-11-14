import { describe, expect, it } from 'vitest'
import {
  decide,
  reading,
  type DecisionEvent,
  type DecisionState,
  type Pending,
} from '@/model/conflict-decision'

// One row of the conflict decision's transition table per test: the box carries the versions it
// was opened on, and a newer one of either holds the decision until the person has seen it.

type S = DecisionState<string>
type E = DecisionEvent<string>

const KEY = 'itm_a.itm_b'
const both: Pending = { how: 'kept_both' }
const v11 = { holder: 1, other: 1 }
const v12 = { holder: 1, other: 2 }

const run = (state: S, ...events: E[]) => events.reduce<S>((s, e) => decide(s, e), state)
const open: E = { type: 'open', pending: both, versions: v11, online: true }
const confirming: S = { kind: 'confirming', key: KEY, pending: both, seen: v11, failure: null }
const sending: S = { kind: 'sending', key: KEY, pending: both, seen: v11 }
const read = (versions = v11, notConflict = true): E => ({
  type: 'read',
  key: KEY,
  versions,
  notConflict,
})

describe('the conflict decision', () => {
  it('opens a box on the versions it shows', () => {
    expect(run(reading(KEY), open)).toEqual(confirming)
  })

  it('opens nothing offline, while sending, or while one of the two changed', () => {
    const offline: E = { ...open, online: false }
    expect(run(reading(KEY), offline)).toEqual(reading(KEY))
    expect(decide(sending, open)).toBe(sending)
    const stale: S = { kind: 'stale', key: KEY }
    expect(decide(stale, open)).toBe(stale)
  })

  it('a read with the versions the box showed leaves it open', () => {
    expect(decide(confirming, read())).toBe(confirming)
  })

  it('a read with a newer version of either closes the box: one of the two changed', () => {
    expect(decide(confirming, read(v12))).toEqual({ kind: 'stale', key: KEY })
    expect(decide(confirming, read({ holder: 2, other: 1 }))).toEqual({ kind: 'stale', key: KEY })
  })

  it('a read while reading changes nothing: the page shows what it read', () => {
    expect(decide(reading(KEY), read(v12))).toEqual(reading(KEY))
  })

  it('a read of another pair is not this one', () => {
    expect(decide(confirming, { ...read(v12), key: 'itm_c.itm_d' } as E)).toBe(confirming)
  })

  it('confirm sends the versions the box was opened on', () => {
    expect(decide(confirming, { type: 'confirm', online: true })).toEqual(sending)
    expect(decide(confirming, { type: 'confirm', online: false })).toBe(confirming)
  })

  it('cancel closes the box, but not while it is being sent', () => {
    expect(decide(confirming, { type: 'cancel' })).toEqual(reading(KEY))
    expect(decide(sending, { type: 'cancel' })).toBe(sending)
  })

  it('a failed send opens the box again with its words and the versions it showed', () => {
    expect(decide(sending, { type: 'failed', key: KEY, failure: "Couldn't keep both." })).toEqual({
      ...confirming,
      failure: "Couldn't keep both.",
    })
  })

  it('the service refusing a stale version says one of the two changed', () => {
    expect(decide(sending, { type: 'refused', key: KEY })).toEqual({ kind: 'stale', key: KEY })
  })

  it('ok settles with the outcome, or reads again when there is none to show', () => {
    expect(decide(sending, { type: 'ok', key: KEY, done: 'kept both' })).toEqual({
      kind: 'settled',
      key: KEY,
      done: 'kept both',
    })
    expect(decide(sending, { type: 'ok', key: KEY, done: null })).toEqual(reading(KEY))
  })

  it('an answer for another pair is not this one', () => {
    expect(decide(sending, { type: 'ok', key: 'itm_c.itm_d', done: 'x' })).toBe(sending)
    expect(decide(sending, { type: 'failed', key: 'itm_c.itm_d', failure: 'x' })).toBe(sending)
    expect(decide(sending, { type: 'refused', key: 'itm_c.itm_d' })).toBe(sending)
  })

  it('Show what changed goes back to reading', () => {
    expect(decide({ kind: 'stale', key: KEY }, { type: 'seenChange' })).toEqual(reading(KEY))
  })

  it('finish ends the outcome', () => {
    expect(decide({ kind: 'settled', key: KEY, done: 'x' }, { type: 'finish' })).toEqual(
      reading(KEY),
    )
  })

  it('another pair starts clean', () => {
    expect(decide(sending, { type: 'pair', key: 'itm_c.itm_d' })).toEqual(reading('itm_c.itm_d'))
    expect(decide(sending, { type: 'pair', key: KEY })).toBe(sending)
  })

  it('a box to open on arrival opens on the first read, when Not a conflict may be done', () => {
    expect(run(reading(KEY, 'not_conflict'), read())).toEqual({
      kind: 'confirming',
      key: KEY,
      pending: { how: 'not_conflict' },
      seen: v11,
      failure: null,
    })
    expect(run(reading(KEY, 'not_conflict'), read(v11, false))).toEqual(reading(KEY))
    // Once only: after Cancel, a later read does not open it again.
    expect(run(reading(KEY, 'not_conflict'), read(), { type: 'cancel' }, read())).toEqual(
      reading(KEY),
    )
  })
})
