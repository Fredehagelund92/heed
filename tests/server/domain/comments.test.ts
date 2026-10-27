import { describe, expect, it } from 'vitest'
import {
  cleanComment,
  commentFromText,
  mentionedPeople,
  parseSubject,
  plainOf,
  reactionEmoji,
  reactionMeaning,
  subjectName,
  subjectPattern,
  unseenReply,
  type CommentNode,
} from '../../../src/domain/comments.ts'

const jon = '00000000-0000-4000-8000-000000000002'
const ines = '00000000-0000-4000-8000-000000000007'
const doc = (...content: CommentNode[]): CommentNode => ({ type: 'doc', content })
const p = (...content: CommentNode[]): CommentNode => ({ type: 'paragraph', content })
const t = (text: string, ...marks: string[]): CommentNode => ({
  type: 'text',
  text,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
})
const at = (id: string, label: string): CommentNode => ({
  type: 'mention',
  attrs: { id: `person:${id}`, label },
})

describe('the five reactions', () => {
  it('are five, each with one meaning', () => {
    expect(reactionEmoji).toEqual(['👍', '👀', '✅', '🤔', '🙏'])
    expect(Object.values(reactionMeaning)).toEqual([
      'Agree',
      'Looking',
      'Done',
      'Not sure',
      'Thanks',
    ])
  })
})

describe('what a comment hangs on', () => {
  it('reads a suggestion and a context item by the names the app uses', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e'
    expect(parseSubject(`review:${id}`)).toEqual({ kind: 'proposal', id })
    expect(parseSubject('context:itm_norway01')).toEqual({ kind: 'item', id: 'itm_norway01' })
    expect(subjectName({ kind: 'item', id: 'itm_norway01' })).toBe('context:itm_norway01')
    for (const name of ['review:sug-ines', 'context:norway', 'item:itm_norway01', 'context:', ''])
      expect(parseSubject(name), name).toBeNull()
    expect(subjectPattern.test(`review:${id}`)).toBe(true)
    expect(subjectPattern.test('context:itm_norway01 ')).toBe(false)
  })
})

describe('a comment as it is kept', () => {
  it('keeps paragraphs, lists, bold, italic, code, breaks and mentions of people', () => {
    const body = doc(
      p(t('Check '), t('this', 'bold'), t(' with '), at(jon, 'Jon Abara')),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p(t('one', 'italic', 'code'))] }],
      },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [p(t('three'))] }],
      },
      p(t('a'), { type: 'hardBreak' }, t('b')),
    )
    expect(cleanComment(body)).toEqual({ doc: body })
  })

  it('leaves out what the comment box never uses, and the same mark twice', () => {
    const messy = {
      type: 'doc',
      attrs: { lang: 'en' },
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'left' },
          content: [
            {
              type: 'text',
              text: 'Hi',
              marks: [{ type: 'bold', attrs: { x: 1 } }, { type: 'bold' }],
            },
            {
              type: 'mention',
              attrs: { id: `person:${jon}`, label: 'Jon', mentionSuggestionChar: '@' },
            },
          ],
        },
        { type: 'orderedList', attrs: { start: 1, type: null }, content: [] },
      ],
    }
    expect(cleanComment(messy)).toEqual({
      doc: doc(p(t('Hi', 'bold'), at(jon, 'Jon')), { type: 'orderedList' }),
    })
  })

  it('refuses anything else, with the reason in plain words', () => {
    const refused: [unknown, RegExp][] = [
      [null, /not a document/],
      ['Hello', /not a document/],
      [{ type: 'paragraph' }, /not a document/],
      [doc(), /Write a comment/],
      [doc(p(t('   '))), /Write a comment/],
      [doc({ type: 'heading', content: [t('Big')] }), /paragraphs, lists/],
      [doc(p({ type: 'image' })), /paragraphs, lists/],
      [doc(p(t('x', 'link'))), /bold, italic and code/],
      [doc(p(t(''))), /empty/],
      [doc(p({ type: 'mention', attrs: { id: 'metric:orders', label: 'Orders' } })), /people only/],
      [doc(p({ type: 'mention', attrs: { id: 'person:Jon Abara', label: 'Jon' } })), /people only/],
      [doc(p({ type: 'mention', attrs: { id: `person:${jon}`, label: ' ' } })), /name/],
      [doc(p(t('x'.repeat(2001)))), /at most 2000/],
      [{ type: 'doc', content: 'text' }, /not a document/],
    ]
    for (const [body, reason] of refused) {
      const result = cleanComment(body)
      expect(result, JSON.stringify(body)).toHaveProperty('problem')
      expect((result as { problem: string }).problem, JSON.stringify(body)).toMatch(reason)
    }
    // Lists nested past the limit, and documents past the node limit.
    let deep: CommentNode = p(t('deep'))
    for (let i = 0; i < 10; i++)
      deep = { type: 'bulletList', content: [{ type: 'listItem', content: [deep] }] }
    expect(cleanComment(doc(deep))).toEqual({ problem: 'This comment nests too deeply.' })
    expect(cleanComment(doc(...Array.from({ length: 700 }, () => p(t('a')))))).toEqual({
      problem: 'This comment is too long.',
    })
    const crowd = Array.from({ length: 21 }, (_, i) =>
      at(`00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, `P${i}`),
    )
    expect(cleanComment(doc(p(...crowd)))).toEqual({
      problem: 'A comment mentions at most 20 people.',
    })
  })
})

describe('reading a comment', () => {
  it('as one line of words, mentions as @Name, and the people it mentions once each', () => {
    const body = doc(p(t('Ask '), at(jon, 'Jon Abara'), t(' and '), at(ines, 'Ines')), {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [p(t('then '), at(jon, 'Jon'))] }],
    })
    expect(plainOf(body)).toBe('Ask @Jon Abara and @Ines then @Jon')
    expect(mentionedPeople(body)).toEqual([jon, ines])
  })

  it('makes a comment of plain words, a paragraph for each block and a break for each line', () => {
    expect(commentFromText('  Which markets?\n\nAnd since when?\nAsk Finance.  ')).toEqual(
      doc(
        p(t('Which markets?')),
        p(t('And since when?'), { type: 'hardBreak' }, t('Ask Finance.')),
      ),
    )
    expect(cleanComment(commentFromText('Which markets?'))).toEqual({
      doc: doc(p(t('Which markets?'))),
    })
  })
})

describe('a reply that is new to someone', () => {
  const entry = (authorId: string, at: string, deleted = false) => ({ authorId, at, deleted })

  it('is the newest by someone else since they last wrote or opened the thread', () => {
    const thread = [
      entry(jon, '2026-10-08T09:00:00Z'),
      entry(ines, '2026-10-08T10:00:00Z'),
      entry(ines, '2026-10-08T11:00:00Z'),
    ]
    expect(unseenReply(thread, jon, { seenAt: null, sender: false })).toBe(thread[2])
    expect(unseenReply(thread, jon, { seenAt: '2026-10-08T10:30:00Z', sender: false })).toBe(
      thread[2],
    )
    expect(unseenReply(thread, jon, { seenAt: '2026-10-08T11:00:00Z', sender: false })).toBeNull()
    // Writing in the thread is reading it.
    expect(
      unseenReply([...thread, entry(jon, '2026-10-08T12:00:00Z')], jon, {
        seenAt: null,
        sender: false,
      }),
    ).toBeNull()
    // Times compare as times, whatever their offset.
    expect(
      unseenReply(
        [entry(jon, '2026-10-08T09:00:00+00:00'), entry(ines, '2026-10-08T10:30:00+02:00')],
        jon,
        {
          seenAt: null,
          sender: false,
        },
      ),
    ).toBeNull()
  })

  it('is for those who take part: who wrote in it, or who sent the suggestion', () => {
    const thread = [entry(ines, '2026-10-08T10:00:00Z')]
    expect(unseenReply(thread, jon, { seenAt: null, sender: false })).toBeNull()
    expect(unseenReply(thread, jon, { seenAt: null, sender: true })).toBe(thread[0])
    expect(
      unseenReply([entry(ines, '2026-10-08T10:00:00Z', true)], jon, { seenAt: null, sender: true }),
    ).toBeNull()
  })
})
