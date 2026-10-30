import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { loadGoldenSet } from '../../db/seed/golden-set.ts'
import { goldenQuestionSchema, questionFileSchema } from '../../src/domain/golden-question.ts'
import { toQuestion } from '../../src/domain/golden-set.ts'
import { offlineFindings, readItemFile } from '../../src/domain/item-file.ts'
import { provenanceFlags } from '../../src/domain/provenance.ts'

/*
  The templates in docs/templates: what a person copies and fills in, so each worked example must
  pass as it stands. The item examples are about the demo data only; the test questions of
  the development split are golden set cases in the open format, kept equal to the cases they come
  from, and the held-out example is no golden case, as the held-out cases are sealed (FR-525).
*/

const read = (name: string) =>
  parse(readFileSync(new URL(`../../docs/templates/${name}`, import.meta.url), 'utf8')) as unknown

describe('the item template', () => {
  const file = readItemFile(read('items.yaml'))

  it('holds three new items that pass every check made without the service', () => {
    expect(file.error).toBeNull()
    expect(file.entries).toHaveLength(3)
    for (const entry of file.entries) {
      expect(entry.itemId).toBeNull()
      expect(offlineFindings(entry)).toEqual([])
    }
    expect(new Set(file.entries.map((entry) => entry.draft?.kind))).toEqual(
      new Set(['note', 'issue', 'event']),
    )
  })

  it('is about the demo data only, and labelled an example', () => {
    for (const { draft } of file.entries) {
      expect(draft?.title).toMatch(/^Example: /)
      const scope = draft!.scope!
      for (const key of [
        ...scope.metrics,
        ...scope.dimensions,
        ...scope.dimensionValues.flatMap((row) => [row.dimension, row.value]),
      ])
        expect(['metric:orders', 'metric:units_sold', 'dim:market']).toContain(
          key.startsWith('val:market/') ? 'dim:market' : key,
        )
    }
  })
})

describe('the regulatory event template', () => {
  const file = readItemFile(read('regulatory-event.yaml'))

  it('holds one new event that passes every check made without the service', () => {
    expect(file.error).toBeNull()
    expect(file.entries).toHaveLength(1)
    const [entry] = file.entries
    expect(entry!.itemId).toBeNull()
    expect(offlineFindings(entry!)).toEqual([])
  })

  it('records a regulation as a fact, high risk, reviewed at its own deadline, not as advice', () => {
    const draft = file.entries[0]!.draft!
    expect(draft).toMatchObject({
      kind: 'event',
      riskLevel: 'high',
      claimLevel: 'fact_only',
      validity: { start: '2026-09-25', end: null },
      // The provisional measure's own deadline, not the 90-day default.
      reviewDate: '2026-11-23',
    })
    expect(draft.notToConclude).toMatch(/not legal advice/i)
    expect(draft.notToConclude).toMatch(/provisional/i)
    // The official text first, quoted word for word.
    expect(draft.evidence![0]!.url).toMatch(/^https:\/\/customs\.example\//)
    expect(draft.evidence![0]!.quote).toMatch(/^Art\. 1\. Parcels/)
    // Its words point the owner at the risk level.
    expect(provenanceFlags(draft).find((flag) => flag.code === 'may_be_high_risk')).toBeDefined()
  })
})

describe('the test question template', () => {
  const document = questionFileSchema.parse(read('test-questions.yaml'))
  const entries = Array.isArray(document) ? document : document.questions
  const golden = loadGoldenSet()

  it('holds three valid questions: one held out, one that expects no item', () => {
    const questions = entries.map((entry) => goldenQuestionSchema.parse(entry))
    expect(questions).toHaveLength(3)
    expect(questions.filter((q) => q.split === 'held_out')).toHaveLength(1)
    expect(questions.some((q) => q.expected.status === 'no_match')).toBe(true)
  })

  it('gives each example exactly as its golden set case reads in the open format', () => {
    for (const entry of entries) {
      const question = goldenQuestionSchema.parse(entry)
      const source = golden.cases.find((c) => c.id === question.id)
      if (question.split === 'held_out') {
        expect(source, question.id).toBeUndefined()
        continue
      }
      expect(source, question.id).toBeDefined()
      expect(question).toEqual(goldenQuestionSchema.parse(toQuestion(source!)))
    }
  })
})
