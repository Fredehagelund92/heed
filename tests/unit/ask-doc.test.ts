import fc from 'fast-check'
import { periods } from '@domain/dates'
import { TextSelection, type EditorState, type Transaction } from 'prosemirror-state'
import { redo, undo } from 'prosemirror-history'
import { describe, expect, it } from 'vitest'
import type { TryItReading } from '@/api'
import {
  acceptOffer,
  chipToText,
  chipsOf,
  clipboardHtml,
  createAskState,
  datesChipOf,
  docDraft,
  draftFromHtml,
  draftToDoc,
  insertChip,
  mapOffers,
  offersOf,
  pasteTransaction,
  removeChip,
  selectionDraft,
  setDates,
  type Offer,
} from '@/components/assistant/ask-doc'
import { quickPeriods, wordsFor } from '@/components/assistant/ask-dates'
import {
  CHIP_MARK,
  datesOf,
  datesTarget,
  draftReading,
  draftText,
  textDraft,
  type AskDraft,
} from '@/lib/ask-draft'
import { draftTagged } from '@/lib/ask-reads'
import { findTrigger } from '@/components/mentions/summary-doc'

/*
  The Ask composer's question as a document (Heed composer, stage 2): words and chips round trip,
  Heed reads the words the chips leave, words it read are offered as chips and never made one by
  themselves, a question has one period, paste is plain, and undo takes back exactly one chip edit.
*/

const today = '2026-10-07'
const netRevenue: AskDraft = [
  { kind: 'text', text: 'what was ' },
  { kind: 'mention', target: 'metric:net_revenue', label: 'net revenue' },
  { kind: 'text', text: ' in ' },
  { kind: 'mention', target: 'val:market/united_kingdom', label: 'United Kingdom' },
  { kind: 'text', text: ' in ' },
  { kind: 'mention', target: datesTarget('2026-01-01', '2026-12-31'), label: '2026' },
  { kind: 'text', text: '?' },
]

const reading = (overrides: Partial<TryItReading> = {}): TryItReading => ({
  about: [],
  from: null,
  to: null,
  dates: null,
  ambiguous: [],
  dates_problem: null,
  today,
  spans: [],
  ...overrides,
})

const apply = (state: EditorState, tr: Transaction | null) => (tr ? state.apply(tr) : state)
/** An offer of the words where they are in the question, as a reading gives it. */
function offerOf(state: EditorState, words: string, offer: Partial<Offer>): Offer {
  const at = state.doc.textBetween(1, state.doc.content.size - 1, '\n', CHIP_MARK).indexOf(words)
  return { from: 1 + at, to: 1 + at + words.length, words, keys: [], dates: null, ...offer }
}
const caret = (state: EditorState, pos: number) =>
  state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)))

/** Drafts of words, line breaks and chips of terms and dates, as the store holds them. */
const draft = fc
  .array(
    fc.oneof(
      fc
        .string({ minLength: 1, maxLength: 12 })
        .filter((text) => !text.includes(CHIP_MARK))
        .map((text) => ({ kind: 'text' as const, text: text.replace(/\r/g, '') })),
      fc.constantFrom(
        { kind: 'mention' as const, target: 'metric:orders', label: 'orders' },
        { kind: 'mention' as const, target: 'val:market/united_kingdom', label: 'United Kingdom' },
        { kind: 'mention' as const, target: 'dim:market', label: 'market' },
        { kind: 'mention' as const, target: datesTarget('2026-07-01', '2026-09-30'), label: 'Q3' },
      ),
    ),
    { maxLength: 8 },
  )
  // Adjacent words are one part, as the editor gives them back.
  .map((parts) =>
    parts.reduce<AskDraft>((merged, part) => {
      const last = merged.at(-1)
      return part.kind === 'text' && last?.kind === 'text'
        ? [...merged.slice(0, -1), { kind: 'text', text: last.text + part.text }]
        : [...merged, part]
    }, []),
  )

describe('the Ask composer’s draft', () => {
  it('reads as a sentence, and Heed reads only the words the chips leave', () => {
    expect(draftText(netRevenue)).toBe('what was net revenue in United Kingdom in 2026?')
    expect(draftReading(netRevenue)).toBe(`what was ${CHIP_MARK} in ${CHIP_MARK} in ${CHIP_MARK}?`)
    // Each chip is one place, so a place in the words Heed read is a place in the paragraph.
    expect(draftReading(netRevenue).length).toBe(draftToDoc(netRevenue).firstChild!.content.size)
  })

  it('names the scope of its chips, the dates of the last dates chip', () => {
    expect(draftTagged(netRevenue)).toEqual({
      scope: {
        metrics: ['metric:net_revenue'],
        dimensions: [],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/united_kingdom' }],
      },
      from: '2026-01-01',
      to: '2026-12-31',
      about: [],
    })
    expect(draftTagged(textDraft('just words'))).toBeNull()
    expect(datesOf('metric:orders')).toBeNull()
    expect(datesOf(datesTarget('2026-07-01', '2026-09-30'))).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    })
  })

  it('round trips through the editor without changing a character', () => {
    fc.assert(
      fc.property(draft, (written) => {
        expect(docDraft(draftToDoc(written))).toEqual(written)
      }),
      { numRuns: 300 },
    )
  })
})

describe('the Ask composer’s editor document', () => {
  it('puts a picked term in as a chip with a space, removes it whole, or turns it into words', () => {
    let state = createAskState(textDraft('orders in @united'))
    state = caret(state, state.doc.content.size - 1)
    const trigger = findTrigger(state)
    expect(trigger).toMatchObject({ char: '@', query: 'united' })
    state = apply(state, insertChip(state, trigger!, 'val:market/united_kingdom', 'United Kingdom'))
    expect(draftText(docDraft(state.doc))).toBe('orders in United Kingdom ')
    const chip = chipsOf(state.doc)[0]!
    expect(chip).toMatchObject({ target: 'val:market/united_kingdom', label: 'United Kingdom' })
    expect(draftText(docDraft(apply(state, chipToText(state, chip.pos)).doc))).toBe(
      'orders in United Kingdom ',
    )
    expect(chipsOf(apply(state, chipToText(state, chip.pos)).doc)).toEqual([])
    expect(draftText(docDraft(apply(state, removeChip(state, chip.pos)).doc))).toBe('orders in  ')
  })

  it('offers what Heed read where it is in the words, and never what a chip took', () => {
    // Spaces before the words move every place; the service read the words trimmed.
    const written: AskDraft = [
      { kind: 'text', text: '  what was net revenue in ' },
      { kind: 'mention', target: 'val:market/united_kingdom', label: 'United Kingdom' },
      { kind: 'text', text: ' in 2026?' },
    ]
    const state = createAskState(written)
    const read = draftReading(written)
    const offers = offersOf(
      state.doc,
      reading({
        from: '2026-01-01',
        to: '2026-12-31',
        spans: [
          { start: 9, end: 20, keys: ['metric:net_revenue'], dates: false },
          // A stale span over the chip is never offered.
          { start: 24, end: 25, keys: ['val:market/united_kingdom'], dates: false },
          { start: 29, end: 33, keys: [], dates: true },
        ],
      }),
      read,
    )
    expect(offers).toEqual([
      { from: 12, to: 23, words: 'net revenue', keys: ['metric:net_revenue'], dates: null },
      {
        from: 32,
        to: 36,
        words: '2026',
        keys: [],
        dates: { from: '2026-01-01', to: '2026-12-31' },
      },
    ])
    // Dates Heed cannot read are not offered as a chip.
    expect(
      offersOf(
        state.doc,
        reading({ spans: [{ start: 29, end: 33, keys: [], dates: true }] }),
        read,
      ),
    ).toEqual([])
  })

  it('keeps offers in place as words change around them, and drops one whose words changed', () => {
    let state = createAskState(textDraft('net revenue in 2026'))
    const read = draftReading(docDraft(state.doc))
    const offers = offersOf(
      state.doc,
      reading({
        from: '2026-01-01',
        to: '2026-12-31',
        spans: [
          { start: 0, end: 11, keys: ['metric:net_revenue'], dates: false },
          { start: 15, end: 19, keys: [], dates: true },
        ],
      }),
      read,
    )
    const typed = state.tr.insertText('what was ', 1)
    state = state.apply(typed)
    const moved = mapOffers(state.doc, offers, typed.mapping)
    expect(moved.map((offer) => [offer.from, offer.words])).toEqual([
      [10, 'net revenue'],
      [25, '2026'],
    ])
    const changed = state.tr.insertText('7', 28)
    state = state.apply(changed)
    expect(mapOffers(state.doc, moved, changed.mapping).map((offer) => offer.words)).toEqual([
      'net revenue',
    ])
  })

  it('makes an offer a chip that keeps the words, one undo step, and a question keeps one period', () => {
    let state = createAskState(textDraft('revenue in 2026 or last quarter'))
    state = caret(state, state.doc.content.size - 1)
    const read = draftReading(docDraft(state.doc))
    const [revenue, year] = offersOf(
      state.doc,
      reading({
        from: '2026-01-01',
        to: '2026-12-31',
        spans: [
          { start: 0, end: 7, keys: ['metric:gross_sales', 'metric:net_revenue'], dates: false },
          { start: 11, end: 15, keys: [], dates: true },
          { start: 19, end: 31, keys: [], dates: true },
        ],
      }),
      read,
    )
    // Words that name two terms take the one chosen; nothing is chosen for them.
    expect(acceptOffer(state, revenue!)).toBeNull()
    const chosen = acceptOffer(state, revenue!, 'metric:net_revenue')!
    state = state.apply(chosen)
    // The other offers move with the words, as the editor maps them through each edit.
    const [moved] = mapOffers(state.doc, [year!], chosen.mapping)
    state = apply(state, acceptOffer(state, moved!))
    expect(docDraft(state.doc)).toEqual([
      { kind: 'mention', target: 'metric:net_revenue', label: 'revenue' },
      { kind: 'text', text: ' in ' },
      { kind: 'mention', target: datesTarget('2026-01-01', '2026-12-31'), label: '2026' },
      { kind: 'text', text: ' or last quarter' },
    ])
    // The caret stays where the person was typing, at the end.
    expect(state.selection.from).toBe(state.doc.content.size - 1)
    // A second period takes the place of the first, which goes back to its words.
    const before = state
    const lastQuarter = { from: '2026-07-01', to: '2026-09-30' }
    state = apply(state, acceptOffer(state, offerOf(state, 'last quarter', { dates: lastQuarter })))
    expect(draftText(docDraft(state.doc))).toBe('revenue in 2026 or last quarter')
    expect(chipsOf(state.doc).map((chip) => chip.label)).toEqual(['revenue', 'last quarter'])
    expect(datesOf(datesChipOf(state.doc)!.target)).toEqual({
      from: '2026-07-01',
      to: '2026-09-30',
    })
    undo(state, (tr) => (state = state.apply(tr)))
    expect(docDraft(state.doc)).toEqual(docDraft(before.doc))
  })

  it('sets the dates on the dates chip, or puts one at the caret, its words those of the days', () => {
    let state = caret(createAskState(textDraft('orders ')), 8)
    state = apply(state, setDates(state, { from: today, to: today }, 'today', null))
    expect(draftText(docDraft(state.doc))).toBe('orders today ')
    const at = datesChipOf(state.doc)!.pos
    state = apply(
      state,
      setDates(
        state,
        quickPeriods(today)[4]!.days,
        wordsFor(quickPeriods(today)[4]!.days, today),
        at,
      ),
    )
    expect(datesChipOf(state.doc)).toMatchObject({
      target: datesTarget('2026-07-01', '2026-09-30'),
      label: 'last quarter',
    })
    // Days no quick period names read as the days.
    expect(wordsFor({ from: '2026-08-04', to: '2026-08-20' }, today)).toBe('4 to 20 Aug 2026')
    expect(wordsFor({ from: '2026-01-01', to: '2026-12-31' }, today)).toBe('2026')
  })

  it('counts the quick periods as get_context counts the periods people name', () => {
    const days = fc.date({
      min: new Date('2000-01-01'),
      max: new Date('2099-12-31'),
      noInvalidDate: true,
    })
    fc.assert(
      fc.property(days, (date) => {
        const day = date.toISOString().slice(0, 10)
        const named = periods(day)
        const quick = Object.fromEntries(
          quickPeriods(day).map((period) => [period.words, period.days]),
        )
        expect(quick['this month so far']).toEqual(named.thisMonth)
        expect(quick['last month']).toEqual(named.lastMonth)
        expect(quick['this quarter so far']).toEqual(named.thisQuarter)
        expect(quick['last quarter']).toEqual(named.lastQuarter)
        expect(quick[`${day.slice(0, 4)} so far`]).toEqual(named.thisYear)
        expect(quick['last year']).toEqual(named.lastYear)
      }),
      { numRuns: 500 },
    )
  })

  it('pastes plain: words and line breaks only, never a chip from elsewhere', () => {
    let state = createAskState([])
    state = state.apply(
      pasteTransaction(state, { text: 'Orders <b>in</b>\r\nUnited Kingdom @[x](metric:orders)' }),
    )
    expect(chipsOf(state.doc)).toEqual([])
    expect(draftText(docDraft(state.doc))).toBe(
      'Orders <b>in</b>\nUnited Kingdom @[x](metric:orders)',
    )
  })

  it('keeps chips through a copy and paste inside the question, and reads nothing else as one', () => {
    let state = createAskState(netRevenue)
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 10, 16)))
    const copied = selectionDraft(state)
    expect(draftText(copied)).toBe('net revenue in United Kingdom')
    const html = clipboardHtml(draftText(copied), copied)
    expect(html).not.toContain('<b>')
    expect(draftFromHtml(`<meta charset="utf-8">${html}`)).toEqual(copied)
    expect(draftFromHtml('<p>Copied from elsewhere</p>')).toBeUndefined()
    // A target that is not a term or a period is words.
    const forged = `<span data-heed-ask="${JSON.stringify([
      { kind: 'mention', target: 'javascript:alert(1)', label: 'x' },
      { kind: 'text', text: 'ok' },
    ]).replace(/"/g, '&quot;')}">x</span>`
    expect(draftFromHtml(forged)).toEqual([{ kind: 'text', text: 'ok' }])
    // An accepted item and a domain are chips too: the picker offers them.
    const entities = [
      { kind: 'mention', target: 'item:itm_a1b2c3d4', label: 'Orders excludes test accounts' },
      { kind: 'mention', target: 'area:commercial', label: 'Commercial' },
      { kind: 'mention', target: 'person:ana', label: 'Ana' },
    ]
    expect(
      draftFromHtml(clipboardHtml('x', entities as Parameters<typeof clipboardHtml>[1])),
    ).toEqual(entities.slice(0, 2))
    state = state.apply(state.tr.setSelection(TextSelection.atEnd(state.doc)))
    state = state.apply(pasteTransaction(state, { text: 'ignored', draft: copied }))
    expect(chipsOf(state.doc)).toHaveLength(5)
  })

  it('loses nothing over 100 paste and undo cycles', () => {
    const paste = fc.oneof(
      fc.string({ maxLength: 40 }).map((text) => ({ text })),
      draft.map((parts) => ({ text: draftText(parts), draft: parts })),
    )
    fc.assert(
      fc.property(
        draft,
        fc.array(fc.tuple(paste, fc.nat(), fc.nat()), { minLength: 100, maxLength: 100 }),
        (written, cycles) => {
          let state = createAskState(written)
          const before = docDraft(state.doc)
          for (const [clip, a, b] of cycles) {
            const size = state.doc.content.size - 1
            const from = 1 + (a % size)
            const to = Math.min(size, from + (b % 6))
            state = state.apply(
              state.tr.setSelection(TextSelection.create(state.doc, from, Math.max(from, to))),
            )
            const tr = pasteTransaction(state, clip)
            if (!tr.docChanged) continue
            const pasted = state.apply(tr)
            state = pasted
            undo(state, (tr) => (state = state.apply(tr)))
            expect(docDraft(state.doc)).toEqual(before)
            redo(state, (tr) => (state = state.apply(tr)))
            expect(docDraft(state.doc)).toEqual(docDraft(pasted.doc))
            undo(state, (tr) => (state = state.apply(tr)))
          }
          expect(docDraft(state.doc)).toEqual(before)
        },
      ),
      { numRuns: 20 },
    )
  })
})
