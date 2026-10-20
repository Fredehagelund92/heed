import { notifyManager } from '@tanstack/react-query'
import { renderHook, act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  DISCARD_TITLES_SHOWN,
  discardedWords,
  discardFailureWords,
  discardWords,
  keptRows,
  markDiscarding,
  useDiscarding,
} from '@/lib/discarding'

/*
  Drafts on their way out: discarded from a list, they leave every list and count at once, and
  come back when the step is undone or the service refuses. The confirmation and the toasts say
  it in plain words.
*/

/** The query cache's notifications run on the next tick; a release waits for them. */
const flush = () => new Promise<void>((resolve) => notifyManager.schedule(resolve))

describe('drafts on their way out', () => {
  it('leaves the marked drafts out until the mark is released', async () => {
    const { result } = renderHook(() => useDiscarding())
    expect(result.current.size).toBe(0)
    let release = () => {}
    act(() => {
      release = markDiscarding(['a', 'b'])
    })
    expect([...result.current]).toEqual(['a', 'b'])
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(keptRows(rows, result.current)).toEqual([{ id: 'c' }])
    await act(async () => {
      release()
      await flush()
    })
    expect(result.current.size).toBe(0)
    expect(keptRows(rows, result.current)).toEqual(rows)
  })

  it('keeps a newer mark of the same draft when an older one is released', async () => {
    const { result } = renderHook(() => useDiscarding())
    let first = () => {}
    let second = () => {}
    act(() => {
      first = markDiscarding(['a'])
      second = markDiscarding(['a'])
    })
    await act(async () => {
      first()
      first()
      await flush()
    })
    expect(result.current.has('a')).toBe(true)
    await act(async () => {
      second()
      await flush()
    })
    expect(result.current.has('a')).toBe(false)
  })
})

describe('the words of a discard', () => {
  it('asks about one draft as the draft page does', () => {
    expect(discardWords(['Discount cost in Spain'])).toEqual({
      title: 'Discard this draft?',
      effect: "Nobody else has seen it. You can undo for a few seconds, then it's gone for good.",
      action: 'Discard draft',
      shown: ['Discount cost in Spain'],
      more: 0,
    })
  })

  it('names how many, the first few titles and how many more', () => {
    const titles = ['One', 'Two', 'Three', 'Four', 'Five']
    const words = discardWords(titles)
    expect(words.title).toBe('Discard 5 drafts?')
    expect(words.action).toBe('Discard 5 drafts')
    expect(words.effect).toMatch(/^Nobody else has seen them\. .* they're gone for good\.$/)
    expect(words.shown).toEqual(titles.slice(0, DISCARD_TITLES_SHOWN))
    expect(words.more).toBe(2)
  })

  it('holds the step behind Undo with how many went', () => {
    expect(discardedWords(1)).toBe('Draft discarded')
    expect(discardedWords(3)).toBe('3 drafts discarded')
  })

  it('says nothing more when every draft went', () => {
    expect(discardFailureWords(3, [])).toBeNull()
  })

  it('names the first draft that stayed, why, and that the rest are still there', () => {
    expect(
      discardFailureWords(3, [
        { title: 'Churn rule', message: "We didn't get an answer. Try again" },
      ]),
    ).toEqual({
      title: '2 of 3 drafts discarded',
      description: "Churn rule: We didn't get an answer. Try again. It's still in your drafts.",
    })
    expect(
      discardFailureWords(3, [
        { title: 'Churn rule', message: 'It was sent for review in the meantime.' },
        { title: 'Discount cost', message: "You can't discard it" },
      ]),
    ).toEqual({
      title: '1 of 3 drafts discarded',
      description:
        "Churn rule: It was sent for review in the meantime. And 1 more. They're still in your drafts.",
    })
    expect(discardFailureWords(1, [{ title: 'Churn rule', message: 'No' }])?.title).toBe(
      "The draft wasn't discarded",
    )
    expect(
      discardFailureWords(2, [
        { title: 'A', message: 'No' },
        { title: 'B', message: 'No' },
      ])?.title,
    ).toBe("The drafts weren't discarded")
  })
})
