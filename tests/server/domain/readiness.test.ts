import { describe, expect, it } from 'vitest'
import { claimCheck } from '../../../src/domain/claim-check.ts'
import { docDiff, type DocSide } from '../../../src/domain/doc-diff.ts'
import {
  needsCare,
  readiness,
  readinessWords,
  readTimeMs,
  relationWords,
  type ReadinessInput,
} from '../../../src/domain/readiness.ts'

/*
  The Ready line (design contract, section 5.3), with the publish rules it decides: only a clash
  with no answer holds Publish (FR-225), and only plain changes go out with "Publish the N you've
  read" (FR-226). The cases follow the mockup's review tests (apps/mockup/src/data/review.test.ts).
*/

const side = (patch: Partial<DocSide> = {}): DocSide => ({
  kind: 'note',
  title: 'Online sales to Norway stopped on 4 August 2026',
  summary: 'There are no stores in Norway, so the webshop was the only way to buy there.',
  body: null,
  where: ['Orders', 'Norway'],
  validFrom: '2026-08-04',
  validUntil: null,
  reviewDate: '2026-12-01',
  sources: [{ url: 'https://news.example/norway', quote: 'Online sales stopped on 4 August.' }],
  notToConclude: 'cause not proven',
  ...patch,
})
const input = (
  patch: Partial<ReadinessInput> & { diff: ReadinessInput['diff'] },
): ReadinessInput => ({
  drafted: false,
  claims: null,
  clash: null,
  withdrawn: false,
  synced: false,
  ...patch,
})
const edit = (patch: Partial<DocSide>) => docDiff(side(), side(patch))
const words = (i: ReadinessInput) => readinessWords(readiness(i), { diff: i.diff })

describe('the Ready line', () => {
  it('says a new number or date is not checked only when no source came with it', () => {
    const dates = input({ diff: edit({ validUntil: '2026-08-27' }) })
    expect(readiness(dates)).toMatchObject({ state: 'unsourced', ok: false, bulk: false })
    expect(words(dates)).toEqual({
      title: 'Ready, not checked against a source',
      text: 'Nothing compares 26 August 2026 with a source. Check it, or return it with a note.',
    })
    const sourced = input({
      diff: edit({
        summary:
          'There are no stores in Norway, so the webshop was the only way to buy there from 3 May 2026.',
        sources: [
          { url: 'https://news.example/norway-update', quote: 'Online sales stopped on 4 August.' },
        ],
      }),
    })
    expect(readiness(sourced)).toMatchObject({ state: 'link', ok: true, bulk: false })
    expect(words(sourced).text).toMatch(/new source page/)
  })

  it('is plainly ready where the words are the same, and those go out with the ones read', () => {
    const layout = input({
      diff: edit({
        summary: 'There are no stores in Norway, so the webshop was **the only way to buy there**.',
      }),
    })
    expect(readiness(layout)).toMatchObject({ state: 'layout', ok: true, bulk: true })
    expect(words(layout).text).toBe('The words are the same; only the layout changes.')
    const link = input({
      diff: edit({
        sources: [
          { url: 'https://news.example/moved', quote: 'Online sales stopped on 4 August.' },
        ],
      }),
    })
    expect(readiness(link)).toMatchObject({ state: 'link', ok: true, bulk: false })
    expect(words(link).text).toBe(
      'The words are the same. Open the new page to check it says the same thing.',
    )
    const reworded = input({
      diff: edit({ summary: 'The webshop was the only way to buy in Norway: it has no stores.' }),
    })
    expect(readiness(reworded)).toMatchObject({ state: 'ready', ok: true, bulk: true })
  })

  it('never calls a change complete, whatever it is', () => {
    for (const i of [
      input({ diff: edit({ validUntil: '2026-08-27' }) }),
      input({ diff: docDiff(null, side()) }),
      input({ diff: edit({ title: 'Online sales to Norway stopped' }) }),
    ])
      expect(JSON.stringify(words(i))).not.toMatch(/complete/i)
  })

  it('counts the claims to check, and lets them be published anyway', () => {
    const claims = claimCheck(
      'Poland orders arrive up to two days late from the payment provider since 14 October 2026.',
      'Settlement files for Polish card payments are delivered within 48 hours from 14 October 2026.',
    )
    const agent = input({ diff: docDiff(null, side()), claims })
    const r = readiness(agent)
    expect(r).toMatchObject({
      state: 'claims',
      ok: false,
      bulk: false,
      publishable: true,
      claimsToCheck: 2,
    })
    expect(needsCare(r)).toBe(true)
    expect(readinessWords(r).title).toBe('Ready, with 2 claims to check')
    // Every claim the same: nothing to check, and it reads as ready.
    const plain = readiness(input({ diff: docDiff(null, side()), claims: [] }))
    expect(plain).toMatchObject({ state: 'ready', claimsToCheck: 0 })
    expect(needsCare(plain)).toBe(false)
  })

  it('holds Publish for a clash until the owner says how they relate, and never sends it in bulk', () => {
    const clash = input({
      diff: docDiff(null, side()),
      clash: { itemId: 'itm_gift', relation: null },
    })
    expect(readiness(clash)).toMatchObject({
      state: 'clash',
      ok: false,
      publishable: false,
      bulk: false,
    })
    expect(readinessWords(readiness(clash))).toEqual({
      title: 'Not ready: choose how they relate',
      text: 'Publish waits until you say how this relates to the live item.',
    })
    // Several live items: each needs its own answer, and the line says so.
    expect(readinessWords(readiness(clash), { clashes: 3 }).text).toBe(
      'Publish waits until you say how this relates to each of the 3 live items.',
    )
    for (const relation of ['replaces', 'disagrees', 'unrelated'] as const) {
      const answered = readiness({ ...clash, clash: { itemId: 'itm_gift', relation } })
      expect(answered).toMatchObject({
        state: 'related',
        ok: true,
        publishable: true,
        bulk: false,
        relation,
      })
      expect(readinessWords(answered).text).toBe(relationWords[relation].hint)
      expect(needsCare(answered)).toBe(true)
    }
  })

  it('reads a draft for a Not found card as a draft to check, before anything else', () => {
    const drafted = input({
      diff: docDiff(null, side()),
      drafted: true,
      claims: claimCheck('Orders fell.', 'Orders rose.'),
      clash: { itemId: 'itm_x', relation: null },
    })
    expect(readiness(drafted)).toMatchObject({
      state: 'draft',
      ok: false,
      bulk: false,
      publishable: false,
    })
    expect(readinessWords(readiness(drafted)).title).toBe('A draft to check')
  })

  it('reads a retirement, and one its writer took back in the comments', () => {
    const retire = input({ diff: docDiff(side(), null) })
    expect(readiness(retire)).toMatchObject({ state: 'archive', ok: true, bulk: false })
    const withdrawn = readiness({ ...retire, withdrawn: true })
    expect(withdrawn).toMatchObject({
      state: 'withdrawn',
      ok: false,
      bulk: false,
      publishable: true,
    })
    expect(readinessWords(withdrawn, { withdrawnBy: 'Lars Dahl' }).title).toBe(
      'Withdrawn by Lars Dahl',
    )
  })

  it('takes a suggestion from a document read as ready, as the document says it', () => {
    const synced = input({ diff: docDiff(null, side()), synced: true })
    expect(readiness(synced)).toMatchObject({ state: 'synced', ok: true, bulk: true })
  })
})

describe('how long a change is read', () => {
  it('asks a longer change to stay on screen longer, within bounds', () => {
    expect(readTimeMs('12 to 26 May 2026')).toBe(1500)
    expect(readTimeMs('x'.repeat(250))).toBe(4000)
    expect(readTimeMs('x'.repeat(5000))).toBe(8000)
  })
})
