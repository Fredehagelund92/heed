import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { answer, type AnswerBundle } from '../../../src/domain/answer.ts'
import type { EditionBundle } from '../../../src/domain/resolver.ts'
import { extractScope } from '../../../src/domain/scope.ts'
import {
  servedWords,
  termEntry,
  termsIn,
  writtenWords,
  type WrittenTerm,
} from '../../../src/domain/served-terms.ts'
import { namesOf, normalizeName, type Term } from '../../../src/domain/vocabulary.ts'
import { terms } from './fixtures.ts'
import { bundleArb } from './resolver-arbitraries.ts'

/*
  Terms and synonyms people write in Definitions, as agents get them (FR-138; docs/product.md,
  sections 3 and 10). A synonym of a metric or a dimension is read as that definition; a term with
  its own meaning, and a synonym of one, is named with its meaning and never changes what applies
  or the answer state. Only a word that means one thing is served.
*/

const peak = 'aaaaaaaa-0000-4000-8000-000000000001'
const written = (overrides: Partial<WrittenTerm> & Pick<WrittenTerm, 'id' | 'name'>) =>
  ({
    meaning: null,
    sameAs: null,
    areaId: 'finance',
    writtenOn: '2026-10-20',
    writtenAs: 'owner',
    conflict: false,
    ...overrides,
  }) satisfies WrittenTerm
const peakSeason = written({
  id: peak,
  name: 'Peak season',
  meaning: 'The weeks from **1 November** to 24 December.',
})
const busySeason = written({ id: 'syn-busy', name: 'Busy season', sameAs: `term:${peak}` })
const purchases = written({ id: 'syn-purchases', name: 'Purchases', sameAs: 'metric:orders' })
const country = written({
  id: 'syn-country',
  name: 'Country',
  sameAs: 'dim:market',
  areaId: null,
  writtenAs: 'administrator',
})
const all = [peakSeason, busySeason, purchases, country]
const open = { all: false, areas: [] }

describe('the words agents get', () => {
  it('adds a synonym of a metric or a dimension to its other names, and keeps every term', () => {
    const served = servedWords(terms, all, open)
    expect(served.written.map((t) => t.name)).toEqual([
      'Busy season',
      'Country',
      'Peak season',
      'Purchases',
    ])
    const by = new Map(served.vocabulary.map((t) => [t.key, t]))
    expect(by.get('metric:orders')!.aliases).toEqual(['Order amount', 'Purchases'])
    expect(by.get('dim:market')!.aliases).toEqual(['Country'])
    // Nothing else changes, and the vocabulary passed in is left as it was.
    expect(by.get('metric:revenue')).toBe(terms.find((t) => t.key === 'metric:revenue'))
    expect(terms.find((t) => t.key === 'metric:orders')!.aliases).toEqual(['Order amount'])
  })

  it('leaves out a word in conflict, one the vocabulary has, and one two terms share', () => {
    const served = servedWords(
      terms,
      [
        written({ id: 'a', name: 'Sales', meaning: 'Gross', conflict: true }),
        // "Norge" is already Norway's other name, accents and case aside.
        written({ id: 'b', name: 'NORGE', meaning: 'Norway, in Norwegian' }),
        written({ id: 'c', name: 'Revenue', sameAs: 'metric:orders' }),
        written({ id: 'd', name: 'Café', meaning: 'One meaning' }),
        written({ id: 'e', name: 'cafe', meaning: 'Another meaning' }),
        written({ id: 'f', name: 'Kept', meaning: 'Kept' }),
      ],
      open,
    )
    expect(served.written.map((t) => t.id)).toEqual(['f'])
    expect(served.vocabulary).toEqual(terms)
  })

  it('serves a synonym only while what it means is served', () => {
    const served = servedWords(
      terms,
      [
        written({ id: 'gone', name: 'Old orders', sameAs: 'metric:gone' }),
        written({ id: 'value', name: 'Norwegian market', sameAs: 'val:market/norway' }),
        written({ id: 'lost', name: 'Rush', sameAs: `term:${peak}` }),
        busySeason,
        { ...peakSeason, conflict: true },
      ],
      open,
    )
    expect(served.written).toEqual([])
  })

  it('serves nothing of a stopped domain, and nothing at all when every domain is stopped', () => {
    const stopped = servedWords(terms, all, { all: false, areas: ['finance'] })
    expect(stopped.written.map((t) => t.name)).toEqual(['Country'])
    expect(stopped.vocabulary.find((t) => t.key === 'metric:orders')!.aliases).toEqual([
      'Order amount',
    ])
    expect(servedWords(terms, all, { all: true, areas: [] })).toEqual({
      vocabulary: terms,
      written: [],
    })
  })
})

describe('the words of a text that a person defined', () => {
  const served = servedWords(terms, all, open)
  const find = (text: string) => termsIn(text, served.vocabulary, served.written)

  it('finds each meaning once, in the order the text has it, by the first words that name it', () => {
    const uses = find('Did the busy season, or Peak Season itself, change purchases in Norway?')
    expect(uses.map((u) => [u.word, u.term.name, u.means.name])).toEqual([
      ['busy season', 'Busy season', 'Peak season'],
      ['Purchases'.toLowerCase(), 'Purchases', 'Orders'],
    ])
  })

  it('reads a plural, and whole words only', () => {
    expect(find('Orders in past peak seasons').map((u) => u.word)).toEqual(['peak seasons'])
    expect(find('Repurchases and countryside')).toEqual([])
  })

  it('lets a name of the vocabulary that holds the same place win', () => {
    const vocabulary: Term[] = [
      ...terms,
      { ...terms[1]!, key: 'metric:active_customers', name: 'Active customers', aliases: [] },
    ]
    const active = written({ id: 'active', name: 'Active', meaning: 'Bought in 90 days.' })
    expect(termsIn('Active customers in Spain', vocabulary, [active])).toEqual([])
    expect(termsIn('Who is active in Spain?', vocabulary, [active]).map((u) => u.word)).toEqual([
      'active',
    ])
  })

  it('names five terms at most', () => {
    const many = Array.from({ length: 7 }, (_, n) =>
      written({ id: `t${n}`, name: `Word${n}`, meaning: `Meaning ${n}` }),
    )
    const text = many.map((t) => t.name).join(' and ')
    expect(termsIn(text, terms, many).map((u) => u.term.id)).toEqual(['t0', 't1', 't2', 't3', 't4'])
  })

  it('gives a term as written, by role and day, and a synonym of a metric as that metric', () => {
    const names = {
      domain: (id: string) => (id === 'finance' ? 'Finance' : id),
      url: (name: string) => `/definitions/${encodeURIComponent(name)}`,
    }
    const [busy, bought] = find('busy season purchases')
    expect(termEntry(busy!, names)).toEqual({
      word: 'busy season',
      name: 'Peak season',
      kind: 'term',
      synonym: true,
      meaning: 'The weeks from **1 November** to 24 December.',
      domain: 'Finance',
      written: { role: 'the owner of Finance', date: '2026-10-20' },
      url: '/definitions/Peak%20season',
    })
    expect(termEntry(bought!, names)).toEqual({
      word: 'purchases',
      name: 'Orders',
      kind: 'metric',
      synonym: true,
      domain: 'Finance',
      written: { role: 'the owner of Finance', date: '2026-10-20' },
      url: '/definitions/Orders',
    })
    const [market] = termsIn('by country', served.vocabulary, served.written)
    expect(termEntry(market!, names)).toMatchObject({
      name: 'Market',
      kind: 'dimension',
      written: { role: 'an admin', date: '2026-10-20' },
    })
    expect(termEntry(find('peak season')[0]!, names)).not.toHaveProperty('synonym')
    expect(writtenWords('2026-10-20', 'the owner of Finance')).toBe(
      'Written 20 Oct 2026 by the owner of Finance, in Definitions.',
    )
  })
})

// Words around a term in a question, and words that are neither these nor a name of the
// fixture's vocabulary, in letters only.
const fillers = ['orders', 'in', 'norway', 'the', 'by', 'and', '2026']
const freshWord = fc
  .stringMatching(/^[a-z]{3,9}( [a-z]{3,9})?$/)
  .filter(
    (w) =>
      !w.split(' ').some((part) => fillers.includes(part)) &&
      !terms.flatMap(namesOf).some((name) => name.includes(w) || w.includes(name)),
  )
const writtenArb = fc
  .uniqueArray(freshWord, { minLength: 1, maxLength: 6, selector: normalizeName })
  .chain((words) =>
    fc.tuple(
      ...words.map((name, n) =>
        fc
          .record({
            sameAs: fc.constantFrom(
              null,
              'metric:orders',
              'metric:revenue',
              'dim:market',
              'val:market/norway',
              'metric:gone',
            ),
            conflict: fc.boolean(),
            areaId: fc.constantFrom('finance', null, 'other'),
          })
          .map(({ sameAs, conflict, areaId }): WrittenTerm => ({
            id: `t${n}`,
            name,
            meaning: sameAs === null ? `Meaning of ${name}` : null,
            sameAs,
            areaId,
            writtenOn: '2026-10-20',
            writtenAs: 'owner',
            conflict,
          })),
      ),
    ),
  )

describe('properties', () => {
  it('serves each word once, never a vocabulary name, a conflict or a stopped domain', () => {
    fc.assert(
      fc.property(writtenArb, fc.subarray(['finance', 'other']), (list, areas) => {
        const served = servedWords(terms, list, { all: false, areas })
        const words = served.written.map((t) => normalizeName(t.name))
        expect(new Set(words).size).toBe(words.length)
        const taken = new Set(terms.flatMap(namesOf))
        for (const term of served.written) {
          expect(term.conflict).toBe(false)
          expect(taken.has(normalizeName(term.name))).toBe(false)
          expect(term.areaId === null || !areas.includes(term.areaId)).toBe(true)
        }
        // A synonym that is served names a metric or a dimension; nothing else gains a name.
        for (const [before, after] of served.vocabulary.map((t, i) => [terms[i]!, t] as const)) {
          const added = after.aliases.slice(before.aliases.length)
          expect(after.aliases.slice(0, before.aliases.length)).toEqual(before.aliases)
          expect(added).toEqual(
            served.written.filter((t) => t.sameAs === before.key).map((t) => t.name),
          )
          if (added.length) expect(['metric', 'dimension']).toContain(before.kind)
        }
      }),
    )
  })

  it('reads a question in a synonym as the question in the name it stands for', () => {
    fc.assert(
      fc.property(
        writtenArb,
        fc.constantFrom('Orders', 'Revenue'),
        fc.constantFrom('', ' in Norway', ' in Spain', ' by market'),
        fc.constantFrom('in August 2026', 'last week', ''),
        (list, metric, where, when) => {
          const served = servedWords(terms, list, open)
          const key = `metric:${metric.toLowerCase()}`
          const synonym = served.written.find((t) => t.sameAs === key)
          if (!synonym) return
          const ask = (name: string) => `Why did ${name}${where} drop ${when}?`
          expect(extractScope(ask(synonym.name), served.vocabulary, '2026-10-07')).toEqual(
            extractScope(ask(metric), served.vocabulary, '2026-10-07'),
          )
        },
      ),
    )
  })

  it('never changes what applies or the answer state with a term of its own meaning', () => {
    fc.assert(
      fc.property(
        bundleArb,
        writtenArb,
        fc.constantFrom('Orders in Norway', 'Revenue in Spain', 'Orders by market', 'Payments'),
        (edition: EditionBundle, list, asked) => {
          const own = list.map((t) => ({ ...t, meaning: `Meaning of ${t.name}`, sameAs: null }))
          const served = servedWords(terms, own, open)
          // A term of its own meaning is no name of the vocabulary: it reads nothing new.
          expect(served.vocabulary).toEqual(terms)
          const question = `${asked} ${own.map((t) => t.name).join(' ')} in August 2026`
          const as = (vocabulary: readonly Term[]): AnswerBundle => ({
            ...edition,
            terms: vocabulary,
            items: edition.items.map((item) => ({ ...item, kind: 'event', title: item.id })),
          })
          const before = answer(as(terms), { question }, { today: '2026-08-15', maxItems: 20 })
          const after = answer(
            as(served.vocabulary),
            { question },
            { today: '2026-08-15', maxItems: 20 },
          )
          expect(after.state).toBe(before.state)
          expect(after.items.map((i) => i.id)).toEqual(before.items.map((i) => i.id))
          expect(termsIn(question, served.vocabulary, served.written).length).toBe(
            Math.min(served.written.length, 5),
          )
        },
      ),
      { numRuns: 60 },
    )
  })

  it('finds a served word wherever it is put, and never a word that is not served', () => {
    fc.assert(
      fc.property(
        writtenArb,
        fc.array(fc.constantFrom(...fillers), { maxLength: 6 }),
        fc.nat(),
        (list, filler, at) => {
          const served = servedWords(terms, list, open)
          const pick = served.written[at % Math.max(served.written.length, 1)]
          const words: string[] = [...filler]
          if (pick) words.splice(at % (words.length + 1), 0, pick.name.toUpperCase())
          const uses = termsIn(words.join(' '), served.vocabulary, served.written)
          const ids = new Set(served.written.map((t) => t.id))
          for (const use of uses) expect(ids.has(use.term.id)).toBe(true)
          if (pick) expect(uses.map((u) => u.term.id)).toContain(pick.id)
          else expect(uses).toEqual([])
        },
      ),
    )
  })
})
