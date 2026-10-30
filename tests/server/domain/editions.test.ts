import { describe, expect, it } from 'vitest'
import { changeSentence, noChanges, type SentenceInput } from '../../../src/domain/editions.ts'

const counts = (changes: Partial<ReturnType<typeof noChanges>>) => ({ ...noChanges(), ...changes })
const edition = (input: Partial<SentenceInput>): SentenceInput => ({
  reason: 'proposal_accepted',
  counts: noChanges(),
  areas: [],
  vocabulary: 0,
  ...input,
})

describe('the sentence of an edition', () => {
  it('names one item, who proposed and accepted it, and why', () => {
    expect(
      changeSentence(
        edition({
          counts: counts({ added: 1 }),
          only: { title: 'Norway closure' },
          areas: ['Finance'],
          proposer: 'Maria Lindqvist',
          actor: 'Jon Abara',
          why: 'Checked against the law',
        }),
      ),
    ).toBe(
      '"Norway closure" was added to Finance. Proposed by Maria Lindqvist, accepted by Jon Abara. Why: Checked against the law.',
    )
  })

  it('says each kind of change in plain words', () => {
    const one = (change: keyof ReturnType<typeof noChanges>, reason: string) =>
      changeSentence(
        edition({
          reason,
          counts: counts({ [change]: 1 }),
          only: { title: 'Fee' },
          areas: ['Payments'],
          actor: 'Jon',
        }),
      )
    expect(one('changed', 'proposal_accepted')).toBe('"Fee" changed in Payments. Accepted by Jon.')
    expect(one('checked', 'source_rechecked')).toBe(
      '"Fee" in Payments was checked and is still correct. Checked by Jon.',
    )
    expect(one('resaved', 'proposal_accepted')).toBe(
      '"Fee" in Payments was saved again, nothing different. Accepted by Jon.',
    )
    expect(one('retired', 'item_retired')).toBe('"Fee" in Payments was archived. Archived by Jon.')
    expect(one('added', 'item_restored')).toBe(
      '"Fee" was added to Payments. Restored from the Bin by Jon.',
    )
    expect(one('removed', 'rollback')).toBe(
      'Agents no longer get "Fee" in Payments. Jon went back to an earlier edition.',
    )
  })

  it('counts several items by kind and lists up to three areas by name', () => {
    expect(
      changeSentence(
        edition({
          reason: 'rollback',
          restores: '2026-10-07.2',
          counts: counts({ added: 1, changed: 4, retired: 2 }),
          areas: ['Commercial', 'Finance', 'Payments'],
          actor: 'Demo Administrator',
          why: 'Wrong caveat went out.',
        }),
      ),
    ).toBe(
      '7 facts in Commercial, Finance and Payments: 1 added, 4 changed, 2 archived. Demo Administrator went back to edition 2026-10-07.2. Why: Wrong caveat went out.',
    )
    expect(
      changeSentence(
        edition({ counts: counts({ changed: 2 }), areas: ['A', 'B', 'C', 'D'], actor: 'Jon' }),
      ),
    ).toBe('2 facts in 4 domains (changed). Accepted by Jon.')
  })

  it('says when the proposer accepted their own change, and falls back to the service', () => {
    const same = edition({
      counts: counts({ added: 1 }),
      only: { title: 'Fee' },
      areas: ['Payments'],
      proposer: 'Jon',
      actor: 'Jon',
    })
    expect(changeSentence(same)).toBe('"Fee" was added to Payments. Proposed and accepted by Jon.')
    expect(changeSentence({ ...same, proposer: null, actor: null })).toBe(
      '"Fee" was added to Payments. Accepted automatically.',
    )
  })

  it('names vocabulary and area changes, and an edition that changed nothing', () => {
    expect(
      changeSentence(
        edition({
          reason: 'area_state_changed',
          actor: 'Ann',
          why: 'Start checks pass',
        }),
      ),
    ).toBe(
      'A domain was switched on or off, before agents got every domain. Changed by Ann. Why: Start checks pass.',
    )
    expect(
      changeSentence(edition({ reason: 'vocabulary_changed', vocabulary: 2400, actor: 'Ann' })),
    ).toBe('2,400 names changed. Accepted by Ann.')
    expect(
      changeSentence(
        edition({
          counts: counts({ added: 1 }),
          only: { title: 'Fee' },
          areas: ['Payments'],
          withheld: 2,
          actor: 'Ann',
        }),
      ),
    ).toBe(
      '"Fee" was added to Payments; 2 facts that only some groups see changed. Accepted by Ann.',
    )
    expect(changeSentence(edition({ reason: 'bootstrap' }))).toBe(
      'Nothing different. The first edition.',
    )
  })

  it('says how many editions a comparison spans, with no who or why', () => {
    expect(
      changeSentence({
        reason: null,
        counts: counts({ added: 1, changed: 4, checked: 1, retired: 1 }),
        areas: ['Finance'],
        vocabulary: 0,
        editions: 10,
        why: 'ignored',
      }),
    ).toBe(
      '7 facts in Finance: 1 added, 4 changed, 1 checked and still correct, 1 archived. Across 10 editions.',
    )
  })
})
