import fc from 'fast-check'
import { EditorState, TextSelection } from 'prosemirror-state'
import { redo, undo } from 'prosemirror-history'
import { describe, expect, it } from 'vitest'
import { parseMentions, serializeMentions, type MentionPart } from '@domain/mentions'
import type { LibraryIndex } from '@/api'
import {
  acceptSuggestion,
  clipboardHtml,
  createSummaryState,
  docText,
  docToMarkup,
  findSuggestions,
  findTrigger,
  insertMention,
  markupFromHtml,
  markupToDoc,
  mentionCount,
  mentionToText,
  pasteTransaction,
  selectionMarkup,
  selectionText,
  splitPaste,
} from '@/components/mentions/summary-doc'
import { visibleLength } from '@/components/mentions/summary-input'
import { linkStatuses, mentionSpokenName } from '@/lib/mention-names'
import { insertToken, mentionToken, mentionWords, triggerBefore } from '@/lib/mention-markup'
import {
  addToScope,
  buildMentionTargets,
  removeFromScope,
  scopeKeys,
  searchMentionTargets,
  targetsByKey,
} from '@/lib/mention-targets'
import { areas, vocabulary } from '@/mocks/reference-data'

const library: LibraryIndex = {
  loadedAt: '2026-10-07T00:00:00Z',
  today: '2026-10-07',
  items: [
    {
      id: 'itm_live0001',
      kind: 'event',
      areaId: 'area_sales',
      status: 'accepted',
      version: 1,
      title: 'Norway launch campaign started on 21 September 2025',
      summary: '',
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
      validity: { start: '2025-09-21', end: null },
      reviewDate: null,
      reviewQuestion: 'still_correct',
      checkFlag: null,
      ownerId: 'per_jon',
      proposerId: 'per_maria',
      updatedAt: '2026-10-01T00:00:00Z',
      lastChecked: null,
      trust: 'current',
      chips: [],
      owners: [],
    },
    {
      id: 'itm_gone0001',
      kind: 'note',
      areaId: 'area_marketing',
      status: 'retired',
      version: 2,
      title: 'Norway retired note',
      summary: '',
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
      validity: { start: '2025-01-01', end: null },
      reviewDate: null,
      reviewQuestion: 'still_correct',
      checkFlag: null,
      ownerId: 'per_jon',
      proposerId: 'per_maria',
      updatedAt: '2026-10-01T00:00:00Z',
      lastChecked: null,
      trust: 'ended',
      chips: [],
      owners: [],
    },
  ],
}

const targets = buildMentionTargets({ vocabulary, library, areas })

describe('mention targets', () => {
  it('builds the keys the markup stores, with prefixes the vocabulary leaves out', () => {
    const keys = new Set(targets.map((target) => target.key))
    for (const key of [
      'metric:orders',
      'dim:market',
      'val:market/norway',
      'item:itm_live0001',
      'area:area_sales',
    ])
      expect(keys).toContain(key)
    expect(targetsByKey(targets).get('val:market/norway')).toMatchObject({
      name: 'Norway',
      detail: 'Market',
      aliases: ['Norge'],
    })
    expect(targetsByKey(targets).get('item:itm_live0001')).toMatchObject({
      kind: 'event',
      detail: 'Event · Sales',
    })
  })

  it('finds a value by its other name and says which one matched', () => {
    const [first] = searchMentionTargets(targets, 'Norge')
    expect(first?.option.key).toBe('val:market/norway')
    expect(first?.alias).toBe('Norge')
    const byName = searchMentionTargets(targets, 'North')
    expect(byName.find((match) => match.option.key === 'val:market/norway')?.alias).toBe(undefined)
  })

  it('puts a name that starts with the words before one that only contains them', () => {
    const metrics = searchMentionTargets(targets, 'cust', { types: ['metric'] })
    expect(metrics.map((match) => match.option.name)).toEqual([
      'Customer lifetime value',
      'Active customers',
      'New customers',
    ])
  })

  it('groups matches in a fixed order and never offers a retired item', () => {
    const matches = searchMentionTargets(targets, 'north')
    const types = matches.map((match) => match.option.type)
    expect(types).toEqual([...types].sort((a, b) => order(a) - order(b)))
    expect(matches.map((match) => match.option.key)).not.toContain('item:itm_gone0001')
    expect(targetsByKey(targets).get('item:itm_gone0001')?.status).toBe('retired')
  })

  it('limits # to dimension values, caps each group and excludes what is chosen', () => {
    expect(
      searchMentionTargets(targets, '', { types: ['val'] }).every(
        (match) => match.option.type === 'val',
      ),
    ).toBe(true)
    const capped = searchMentionTargets(targets, '', { perGroup: 2 })
    // Two of each type, and the one item that is not retired.
    expect(capped.map((match) => match.option.type)).toEqual([
      'metric',
      'metric',
      'val',
      'val',
      'dim',
      'dim',
      'item',
      'area',
      'area',
    ])
    expect(
      searchMentionTargets(targets, 'orders', { exclude: ['metric:orders'] }).map(
        (match) => match.option.key,
      ),
    ).not.toContain('metric:orders')
  })

  it('adds and removes scope in the shape the write path checks', () => {
    let scope = {
      metrics: [] as string[],
      dimensions: [] as string[],
      dimensionValues: [] as Scope['dimensionValues'],
    }
    scope = addToScope(scope, 'metric:units_sold')
    scope = addToScope(scope, 'val:market/norway')
    scope = addToScope(scope, 'val:market/norway')
    scope = addToScope(scope, 'item:itm_live0001')
    expect(scope).toEqual({
      metrics: ['metric:units_sold'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    })
    expect(scopeKeys(scope)).toEqual(['metric:units_sold', 'val:market/norway'])
    expect(removeFromScope(scope, 'val:market/norway').dimensionValues).toEqual([])
  })

  it('reads the state of mentioned targets from the item links', () => {
    const target = (key: string, status: 'current' | 'source_missing') => ({
      field: 'summary' as const,
      position: 0,
      words: 'x',
      target: { type: 'metric' as const, key, name: 'x', status },
    })
    expect(
      linkStatuses({
        mentions: [
          target('metric:orders', 'current'),
          target('metric:units_sold', 'source_missing'),
        ],
      }),
    ).toEqual({ 'metric:orders': 'current', 'metric:units_sold': 'source_missing' })
    expect(linkStatuses(null)).toEqual({})
  })

  it('names a mention with its type and any state that is not current', () => {
    expect(mentionSpokenName('metric', 'Net revenue', 'current')).toBe('Net revenue, metric')
    expect(mentionSpokenName('item', 'Old note', 'retired')).toBe('Old note, fact, archived')
    expect(mentionSpokenName('val', 'Norway', 'source_missing')).toBe(
      'Norway, value, source missing',
    )
  })
})

type Scope = { metrics: string[]; dimensionValues: { dimension: string; value: string }[] }
const order = (type: string) => ['metric', 'val', 'dim', 'item', 'area'].indexOf(type)

describe('the @ trigger and tokens in plain text', () => {
  it.each([
    ['@', { offset: 0, char: '@', query: '' }],
    ['Compare @dep', { offset: 8, char: '@', query: 'dep' }],
    ['Compare @net rev', { offset: 8, char: '@', query: 'net rev' }],
    ['in (#north', { offset: 4, char: '#', query: 'north' }],
  ])('opens on %j', (before, expected) => {
    expect(triggerBefore(before)).toEqual(expected)
  })

  it.each([
    'mail maria@example.test',
    'a lone @ and more',
    'Compare @net  ',
    '@a b c d e',
    'Compare @dep\nnext line',
  ])('stays closed on %j', (before) => {
    expect(triggerBefore(before)).toBeNull()
  })

  it('writes a token with words the markup can hold, and a space after it', () => {
    expect(mentionWords('Review [draft]\nnow')).toBe('Review [draft now')
    expect(mentionToken('Net revenue', 'metric:net_revenue')).toBe(
      '@[Net revenue](metric:net_revenue)',
    )
    expect(insertToken('Use @dep here', { from: 4, to: 8 }, 'Orders', 'metric:orders')).toEqual({
      text: 'Use @[Orders](metric:orders) here',
      caret: 28,
    })
    expect(insertToken('Use @dep', { from: 4, to: 8 }, 'Orders', 'metric:orders')).toEqual({
      text: 'Use @[Orders](metric:orders) ',
      caret: 29,
    })
  })
})

const label = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((value) => !/[\]\r\n]/.test(value) && value.trim().length > 0)
const target = fc.constantFrom(
  'metric:orders',
  'val:market/norway',
  'dim:market',
  'item:itm_live0001',
  'area:area_sales',
)
const part: fc.Arbitrary<MentionPart> = fc.oneof(
  fc
    .string({ maxLength: 30 })
    .filter((text) => !/[\r\n]/.test(text))
    .map((text): MentionPart => ({ kind: 'text', text })),
  fc.record({ kind: fc.constant('mention' as const), label, target }),
)
const markup = fc.array(part, { maxLength: 8 }).map((parts) => serializeMentions(parts))

describe('the summary document', () => {
  it('round trips markup through the editor without changing a character', () => {
    fc.assert(
      fc.property(markup, (written) => {
        expect(docToMarkup(markupToDoc(written))).toBe(written)
        expect(docText(markupToDoc(written))).toBe(parseMentions(written).text)
      }),
      { numRuns: 300 },
    )
  })

  it('counts visible characters: a mention counts as its words', () => {
    const written = 'Compare @[Net revenue](metric:net_revenue) and \\@ signs.'
    expect(visibleLength(written)).toBe('Compare Net revenue and @ signs.'.length)
    expect(visibleLength('æøå 😀')).toBe(5)
  })

  it('loses nothing over 100 paste and undo cycles', () => {
    const paste = fc.oneof(
      fc.string({ maxLength: 40 }).map((text) => ({ text })),
      markup.map((written) => ({ text: parseMentions(written).text, markup: written })),
    )
    fc.assert(
      fc.property(
        markup,
        fc.array(fc.tuple(paste, fc.nat(), fc.nat()), { minLength: 100, maxLength: 100 }),
        (written, cycles) => {
          let state = createSummaryState(written)
          const before = docToMarkup(state.doc)
          for (const [clip, a, b] of cycles) {
            const size = state.doc.content.size - 1
            const from = 1 + (a % size)
            const to = Math.min(size, from + (b % 6))
            state = state.apply(
              state.tr.setSelection(TextSelection.create(state.doc, from, Math.max(from, to))),
            )
            const tr = pasteTransaction(state, clip)
            // An empty paste changes nothing and adds nothing to undo.
            if (!tr.docChanged) continue
            const pasted = state.apply(tr)
            state = pasted
            undo(state, (tr) => (state = state.apply(tr)))
            expect(docToMarkup(state.doc)).toBe(before)
            redo(state, (tr) => (state = state.apply(tr)))
            expect(docToMarkup(state.doc)).toBe(docToMarkup(pasted.doc))
            undo(state, (tr) => (state = state.apply(tr)))
          }
          expect(docToMarkup(state.doc)).toBe(before)
        },
      ),
      { numRuns: 20 },
    )
  })

  it('pastes plain: a token in pasted text stays text, a line break becomes a space', () => {
    let state = createSummaryState('')
    state = state.apply(pasteTransaction(state, { text: 'Mail @[Orders](metric:orders)\nnow' }))
    expect(mentionCount(state.doc)).toBe(0)
    expect(docText(state.doc)).toBe('Mail @[Orders](metric:orders) now')
    expect(docToMarkup(state.doc)).toBe('Mail \\@[Orders](metric:orders) now')
  })

  it('keeps chips through a copy and paste inside the field', () => {
    let state = createSummaryState('In @[Norway](val:market/norway) today')
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 1, 6)))
    expect(selectionText(state)).toBe('In Norway ')
    const copied = selectionMarkup(state)
    expect(copied).toBe('In @[Norway](val:market/norway) ')
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)))
    state = state.apply(pasteTransaction(state, { text: 'ignored', markup: copied }))
    expect(mentionCount(state.doc)).toBe(2)
  })

  it('carries the markup in clipboard HTML, escaped, and reads it back', () => {
    const written = 'A <b> & "quote" @[Norway](val:market/norway)'
    const html = clipboardHtml(parseMentions(written).text, written)
    expect(html).not.toContain('<b>')
    expect(markupFromHtml(`<meta charset="utf-8">${html}`)).toBe(written)
    expect(markupFromHtml('<p>Copied from elsewhere</p>')).toBeUndefined()
  })

  it('finds the trigger before the caret, also right after a chip', () => {
    const at = (written: string) => {
      const state = createSummaryState(written)
      return findTrigger(state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc))))
    }
    expect(at('Compare @dep')).toEqual({ from: 9, to: 13, char: '@', query: 'dep' })
    expect(at('@[Norway](val:market/norway) #so')).toMatchObject({ char: '#', query: 'so' })
    expect(at('mail maria@example')).toBeNull()
  })

  it('replaces the trigger with a chip and a space, and turns a chip back into its words', () => {
    let state = createSummaryState('Compare @dep')
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)))
    const trigger = findTrigger(state)!
    state = state.apply(insertMention(state, trigger, { key: 'metric:orders', name: 'Orders' }))
    expect(docToMarkup(state.doc)).toBe('Compare @[Orders](metric:orders) ')
    expect(state.selection.from).toBe(state.doc.content.size - 1)
    state = state.apply(mentionToText(state, 9)!)
    expect(docToMarkup(state.doc)).toBe('Compare Orders ')
    expect(mentionCount(state.doc)).toBe(0)
  })

  it('suggests recognised words, longest name first, and never mentions by itself', () => {
    const doc = markupToDoc('Net revenue fell in Norge; see @[Orders](metric:orders).')
    const found = findSuggestions(doc, targets)
    expect(found.map((suggestion) => [suggestion.words, suggestion.option.key])).toEqual([
      ['Net revenue', 'metric:net_revenue'],
      ['Norge', 'val:market/norway'],
    ])
    expect(mentionCount(doc)).toBe(1)
    const state = EditorState.create({ doc })
    const accepted = state.apply(acceptSuggestion(state, found[1]!))
    expect(docToMarkup(accepted.doc)).toContain('@[Norge](val:market/norway)')
  })
})

describe('a paste longer than the summary', () => {
  const sentence = 'The partner stopped sending reports on 2 September.'
  it('fits as it is when it is short enough', () => {
    expect(splitPaste(sentence, 280)).toBeNull()
  })
  it('keeps what fits up to a sentence end and hands on the rest', () => {
    expect(splitPaste(`${sentence} ${sentence} Then more.`, 110)).toEqual({
      head: `${sentence} ${sentence}`,
      rest: 'Then more.',
    })
  })
  it('stops at a paragraph break and keeps the rest of the paragraphs as they were', () => {
    expect(splitPaste(`First line without a stop\n\n## Steps\n\n1. One`, 30)).toEqual({
      head: 'First line without a stop',
      rest: '## Steps\n\n1. One',
    })
  })
  it('splits between words when no sentence ends in reach', () => {
    expect(splitPaste('one two three four five', 9)).toEqual({
      head: 'one two',
      rest: 'three four five',
    })
  })
})
