import { describe, expect, it } from 'vitest'
import { holdLine, readinessOf, SUMMARY_LIMIT } from '@/model/editor-readiness'

// One answer to "can it go yet?" for the button, the footer and the side panel of both editors.
// Before it, each of them worked it out alone: a red "Summary 369 of 280" sat beside a green
// "Ready", and the side panel said "Ready" when nothing had changed.

const clear = { missing: [] }

describe('readinessOf', () => {
  it('is ready when nothing is in the way', () => {
    expect(readinessOf(clear)).toEqual({ state: 'ready' })
    expect(holdLine(readinessOf(clear))).toBe('')
  })

  it('names what is still to fill in', () => {
    const r = readinessOf({ missing: ['a title', 'where it applies'] })
    expect(r).toEqual({ state: 'missing', missing: ['a title', 'where it applies'] })
    // Each editor says the parts its own way: a list, or two with "and".
    expect(holdLine(r)).toBe('Add a title, where it applies first.')
    expect(holdLine(r, ' and ')).toBe('Add a title and where it applies first.')
  })

  it('is not ready while the link in Source is not one the service can open', () => {
    const r = readinessOf({ ...clear, badLink: true, tooLong: true })
    expect(r).toEqual({ state: 'bad-link' })
    expect(holdLine(r)).toBe('Fix the link in Source first.')
  })

  it('is not ready when the first paragraph is longer than agents read', () => {
    const r = readinessOf({ ...clear, tooLong: true })
    expect(r).toEqual({ state: 'too-long' })
    expect(holdLine(r)).toBe(`Shorten the first paragraph to ${SUMMARY_LIMIT} characters first.`)
  })

  it('is not ready when nothing has changed', () => {
    const r = readinessOf({ ...clear, unchanged: true })
    expect(r).toEqual({ state: 'unchanged' })
    expect(holdLine(r)).toBe('Nothing has changed yet.')
  })

  it('is not ready while an overlap is unanswered, and says which', () => {
    const r = readinessOf({ ...clear, unanswered: 'Returns exclude test accounts' })
    expect(r).toEqual({ state: 'unanswered', title: 'Returns exclude test accounts' })
    expect(holdLine(r)).toBe('Say how this relates to “Returns exclude test accounts” first.')
  })

  it('gives the reason a word is taken as it is', () => {
    const r = readinessOf({ ...clear, taken: 'Gross sales already means something.' })
    expect(r).toEqual({ state: 'taken', reason: 'Gross sales already means something.' })
    expect(holdLine(r)).toBe('Gross sales already means something.')
  })

  it('says the first thing in the way, in the order a person would fix it', () => {
    const everything = {
      missing: ['a title'],
      taken: 'taken',
      tooLong: true,
      unchanged: true,
      unanswered: 'X',
    }
    expect(readinessOf(everything).state).toBe('missing')
    expect(readinessOf({ ...everything, missing: [] }).state).toBe('taken')
    expect(readinessOf({ ...everything, missing: [], taken: '' }).state).toBe('too-long')
    expect(readinessOf({ ...everything, missing: [], taken: '', tooLong: false }).state).toBe(
      'unchanged',
    )
    expect(
      readinessOf({ ...everything, missing: [], taken: '', tooLong: false, unchanged: false })
        .state,
    ).toBe('unanswered')
  })

  it('keeps a long summary from reading as ready, wherever it is asked', () => {
    // The button's line and the footer's state come from the same answer.
    const r = readinessOf({ missing: [], tooLong: true, unchanged: false })
    expect(r.state).not.toBe('ready')
    expect(holdLine(r)).not.toBe('')
  })
})
