import { describe, expect, it } from 'vitest'
import {
  ANSWER_LINES,
  answerStates,
  replyStatus,
  replyStatuses,
  resolverStatusOf,
  stateOfStatus,
  stateWords,
} from '../../../src/domain/answer-state.ts'
import { statusRules, statusRuleWords } from '../../../src/domain/mcp-text.ts'

/*
  The six answer states (FR-349), as docs/product.md section 6 and the Heed v1 mockup's
  ANSWER_LINES give them: one list, the same words for agents and people.
*/
describe('the answer lines', () => {
  it('are the six states, with the labels and sentences of the product page', () => {
    expect(ANSWER_LINES.map((line) => line.state)).toEqual([...answerStates])
    expect(
      Object.fromEntries(ANSWER_LINES.map((line) => [line.state, [line.label, line.sentence]])),
    ).toEqual({
      grounded: ['Checked', 'This is written down and checked.'],
      partial: ['Partial', 'Only part of this is written down.'],
      missing: ['Not found', 'Nothing is written about this yet.'],
      conflict: ['Conflict', 'Two items say different things.'],
      stale: ['Outdated', 'Some of this may be old.'],
      failed: ['Not checked', 'The check did not run.'],
    })
    // One or two plain words, and something to do for each.
    for (const line of ANSWER_LINES) {
      expect(line.label.split(' ').length, line.state).toBeLessThanOrEqual(2)
      expect(line.todo.length, line.state).toBeGreaterThan(0)
    }
  })

  it('map one to one to the statuses an agent reads, with need_more_detail as no state', () => {
    expect(new Set(ANSWER_LINES.map((line) => line.status)).size).toBe(6)
    for (const line of ANSWER_LINES) expect(stateOfStatus(line.status)).toBe(line.state)
    expect(stateOfStatus('need_more_detail')).toBeNull()
    expect([...ANSWER_LINES.map((line) => line.status), 'need_more_detail'].sort()).toEqual(
      [...replyStatuses].sort(),
    )
  })

  it('are said first, the label and, but for Checked, its sentence', () => {
    expect(stateWords('grounded')).toBe('Checked.')
    expect(stateWords('missing')).toBe('Not found. Nothing is written about this yet.')
  })

  it('are taught to agents by status and label, in the one text the skill file repeats', () => {
    expect(statusRules.map((rule) => rule.status)).toEqual([
      ...ANSWER_LINES.map((line) => line.status),
      'need_more_detail',
    ])
    expect(statusRuleWords(statusRules[0]!)).toBe(
      'matched (Checked): use the items and keep each not_to_conclude.',
    )
    expect(statusRuleWords(statusRules.at(-1)!)).toMatch(/^need_more_detail: /)
  })
})

describe('a reply status', () => {
  const exact = { match: 'exact' as const, unverified: false }
  const part = { match: 'partial' as const, unverified: false }
  const old = { match: 'exact' as const, unverified: true }

  it('keeps what the resolver found when it found no match', () => {
    for (const status of ['no_match', 'conflict', 'need_more_detail', 'check_failed'] as const)
      expect(replyStatus({ status, items: [old] })).toBe(status)
  })

  it('is Partial when part of the question has nothing written for it', () => {
    expect(replyStatus({ status: 'matched', items: [part, part] })).toBe('partial')
    expect(replyStatus({ status: 'matched', items: [exact], uncovered: true })).toBe('partial')
    // An item that covers part of it beside one that covers all of it is Checked.
    expect(replyStatus({ status: 'matched', items: [exact, part] })).toBe('matched')
  })

  it('is Partial when the dates were assumed, ahead of Outdated and Checked', () => {
    expect(replyStatus({ status: 'matched', items: [exact], assumed: true })).toBe('partial')
    expect(replyStatus({ status: 'matched', items: [old], assumed: true })).toBe('partial')
    expect(replyStatus({ status: 'conflict', items: [exact], assumed: true })).toBe('conflict')
    expect(replyStatus({ status: 'no_match', items: [], assumed: true })).toBe('no_match')
  })

  it('is Outdated when an item may be out of date, after Partial, as the mockup orders them', () => {
    expect(replyStatus({ status: 'matched', items: [exact, old] })).toBe('stale')
    expect(replyStatus({ status: 'matched', items: [part, { ...part, unverified: true }] })).toBe(
      'partial',
    )
    expect(replyStatus({ status: 'matched', items: [exact] })).toBe('matched')
  })

  it('reads back as what the resolver found, for a test question and the request log', () => {
    expect(resolverStatusOf('partial')).toBe('matched')
    expect(resolverStatusOf('stale')).toBe('matched')
    expect(resolverStatusOf('no_match')).toBe('no_match')
  })
})
