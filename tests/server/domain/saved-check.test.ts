import { describe, expect, it } from 'vitest'
import {
  answerText,
  compareSaved,
  expectWords,
  savedWhy,
  triggerOfEdition,
  type SavedAnswer,
  type SavedItem,
} from '../../../src/domain/saved-check.ts'

const item = (
  id: string,
  summary = `What ${id} says.`,
  unverified: SavedItem['unverified'] = null,
) => ({
  id,
  title: `Item ${id}`,
  summary,
  unverified,
})
const answer = (
  state: SavedAnswer['state'],
  items: SavedItem[],
  say = 'Checked.',
): SavedAnswer => ({
  state,
  items,
  say,
})

describe('the free check compares what agents get now with what a question should keep getting', () => {
  const saved = answer('grounded', [item('a'), item('b')])

  it('the same state, items and sentences: Same', () => {
    expect(compareSaved(saved, answer('grounded', [item('b'), item('a')]), ['a', 'b'])).toEqual({
      result: 'same',
      reason: 'same',
    })
    // How the reply words it besides is not what it checks.
    expect(
      compareSaved(saved, answer('grounded', [item('a'), item('b')], 'Other words.'), ['a']),
    ).toEqual({
      result: 'same',
      reason: 'same',
    })
  })

  it('new words, other items or a better answer: Changed', () => {
    expect(
      compareSaved(saved, answer('grounded', [item('a', 'New words.'), item('b')]), ['a']),
    ).toEqual({
      result: 'changed',
      reason: 'words',
    })
    expect(
      compareSaved(saved, answer('grounded', [item('a'), item('b'), item('c')]), ['a']),
    ).toEqual({
      result: 'changed',
      reason: 'items',
    })
    // An item the person left out of what it should answer from may go.
    expect(compareSaved(saved, answer('grounded', [item('a')]), ['a'])).toEqual({
      result: 'changed',
      reason: 'items',
    })
    expect(compareSaved(answer('missing', []), answer('partial', [item('a')]), [])).toEqual({
      result: 'changed',
      reason: 'better',
    })
  })

  it('a worse answer, an expected item gone, or an item now out of date: Needs a look', () => {
    for (const state of ['partial', 'stale', 'conflict', 'missing', 'failed'] as const)
      expect(compareSaved(saved, answer(state, [item('a'), item('b')]), []).result, state).toBe(
        'look',
      )
    expect(compareSaved(saved, answer('grounded', [item('a')]), ['a', 'b'])).toEqual({
      result: 'look',
      reason: 'gone',
    })
    const partial = answer('partial', [item('a')])
    expect(
      compareSaved(partial, answer('partial', [item('a', undefined, 'past_review_date')]), ['a']),
    ).toEqual({ result: 'look', reason: 'worse' })
    // Out of date when saved already: not new.
    const old = answer('partial', [item('a', undefined, 'past_review_date')])
    expect(compareSaved(old, old, ['a']).result).toBe('same')
  })
})

describe('the words of a result', () => {
  const saved = answer('grounded', [item('a')])
  const why = (
    reason: Parameters<typeof savedWhy>[0]['reason'],
    now: SavedAnswer,
    expect: string[] = ['a'],
  ) => savedWhy({ reason, saved, now, expect })

  it('say why in a sentence, as Quality and the review show it', () => {
    expect(why('same', saved)).toBe('Same items, same sentence.')
    expect(why('words', answer('grounded', [item('a', 'New.')]))).toBe(
      'The sentence agents get has new words. Still based on checked context.',
    )
    expect(why('worse', answer('missing', [], 'Not found.'))).toBe(
      'Used to answer from 1 item. Now it says nothing is written down.',
    )
    expect(why('worse', answer('partial', [item('a', undefined, 'past_review_date')]))).toBe(
      'The item it answers from has a check date that passed.',
    )
    expect(why('worse', answer('conflict', [item('a'), item('c')]))).toBe(
      'It was Checked when saved. Now it is Conflict.',
    )
    expect(why('gone', answer('grounded', []))).toBe(
      'An item it should answer from is no longer in the answer.',
    )
    expect(
      savedWhy({ reason: 'better', saved: answer('missing', []), now: saved, expect: [] }),
    ).toBe('It was Not found when saved. Now it is Checked.')
  })

  it('before and now read as the sentences agents get, or what a person hears', () => {
    expect(answerText(answer('grounded', [item('a', 'One.'), item('b', 'Two.')]))).toBe('One. Two.')
    expect(answerText(answer('missing', [], 'Not found. Nothing is written about this yet.'))).toBe(
      'Not found. Nothing is written about this yet.',
    )
  })

  it('what it should keep getting, from the items kept', () => {
    expect(expectWords(answer('grounded', [item('a'), item('b')]), ['a'])).toBe(
      'Checked, from Item a.',
    )
    expect(expectWords(answer('missing', []), [])).toBe('Not found, until someone writes it.')
  })

  it('names what started a check after an edition', () => {
    expect(triggerOfEdition('proposal_accepted')).toBe('publish')
    expect(triggerOfEdition('item_retired')).toBe('archive')
    expect(triggerOfEdition('decision_undone')).toBe('restore')
    expect(triggerOfEdition('vocabulary_changed')).toBe('sync')
  })
})
