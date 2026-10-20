import { describe, expect, it } from 'vitest'
import {
  itemJsonSchema,
  itemVersionDigests,
  itemVersionSchema,
  type ItemVersion,
} from '../../../src/domain/item-version.ts'
import { proposalSchema, canTransitionProposal } from '../../../src/domain/proposal.ts'
import { proposalStates } from '../../../src/domain/proposal-state.ts'
import { governedVocabularySchema } from '../../../src/domain/vocabulary.ts'
import { version, terms } from './fixtures.ts'

describe('a scope that names a dimension with any value (FR-126)', () => {
  it('is scope on its own, and is optional in an item file', () => {
    const anyMarket = version({
      scope: { metrics: [], dimensions: ['dim:market'], dimensionValues: [] },
    })
    expect(itemVersionSchema.safeParse(anyMarket).success).toBe(true)
    const { scope, ...rest } = version()
    const { dimensions: _none, ...withoutDimensions } = scope
    expect(itemVersionSchema.parse({ ...rest, scope: withoutDimensions }).scope.dimensions).toEqual(
      [],
    )
    const schema = itemJsonSchema() as unknown as {
      properties: { scope: { required?: string[]; properties: Record<string, unknown> } }
    }
    expect(schema.properties.scope.properties).toHaveProperty('dimensions')
    expect(schema.properties.scope.required).not.toContain('dimensions')
  })
  it('keeps the digest of a version saved before it existed', async () => {
    const { scope, ...rest } = version()
    const { dimensions: _none, ...old } = scope
    const before = await itemVersionDigests({ ...rest, scope: old } as ItemVersion)
    expect(await itemVersionDigests(version())).toEqual(before)
    const any = await itemVersionDigests(
      version({ scope: { ...scope, dimensions: ['dim:product'] } }),
    )
    expect(any.content).not.toBe(before.content)
  })
})

describe('governed schemas', () => {
  it('accepts a complete governed version and exports the same structural JSON schema', () => {
    expect(itemVersionSchema.parse(version())).toEqual(version())
    const schema = itemJsonSchema()
    expect(schema.properties).toHaveProperty('mentions')
    expect(schema.required).toContain('scope')
    expect(schema.additionalProperties).toBe(false)
  })
  it.each([
    { scope: { metrics: [], dimensions: [], dimensionValues: [] } },
    { validity: { start: '2026-02-30', end: null } },
    { validity: { start: '2026-08-04', end: '2026-08-04' } },
    { reviewDate: null },
    { audience: { kind: 'groups', groups: ['finance'] } },
    { claimLevel: 'effect_stated' },
    { mentions: [] },
    { summary: 'Different words' },
    { summaryMarkup: '@[bad](group:payments)' },
    { title: '@[Metric](metric:x)' },
    { evidence: [] },
    { summary: 'x'.repeat(281) },
    { references: ['cube:x'], changeMarks: {} },
    { scope: { metrics: ['metric:x', 'metric:x'], dimensions: [], dimensionValues: [] } },
    { scope: { metrics: [], dimensions: ['dim:market', 'dim:market'], dimensionValues: [] } },
    { scope: { metrics: [], dimensions: ['val:market/norway'], dimensionValues: [] } },
    {
      scope: {
        metrics: [],
        dimensions: ['dim:market'],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
    },
  ])('rejects invalid content %j', (patch) =>
    expect(itemVersionSchema.safeParse({ ...version(), ...patch }).success).toBe(false),
  )
  it('counts visible Unicode characters and requires authority for an effect claim', () => {
    expect(
      itemVersionSchema.safeParse(
        version({
          summary: '🌍'.repeat(280),
          summaryMarkup: undefined,
          mentions: [],
          claimLevel: 'effect_stated',
          claimAuthority: 'Regulator',
          claimQuote: 'The closure caused the effect.',
        }),
      ).success,
    ).toBe(true)
  })
  it('validates vocabulary parents and keys', () => {
    expect(governedVocabularySchema.safeParse(terms).success).toBe(true)
    expect(governedVocabularySchema.safeParse(terms.slice(1)).success).toBe(false)
    expect(governedVocabularySchema.safeParse([...terms, terms[0]]).success).toBe(false)
  })
  it('validates proposal version, retirement and closure consistency', () => {
    const proposal = {
      id: 'p1',
      number: 1,
      subject: 'item',
      action: 'create',
      state: 'draft',
      areaId: 'finance',
      itemId: null,
      itemVersionId: null,
      vocabularyVersionId: null,
      proposerId: 'alice',
      createdVia: 'form',
      revision: 1,
      reason: null,
      closedAt: null,
    }
    expect(proposalSchema.safeParse(proposal).success).toBe(true)
    expect(proposalSchema.safeParse({ ...proposal, state: 'submitted' }).success).toBe(false)
    expect(
      proposalSchema.safeParse({ ...proposal, state: 'submitted', itemVersionId: 'v1' }).success,
    ).toBe(true)
    expect(proposalSchema.safeParse({ ...proposal, action: 'retire' }).success).toBe(false)
    expect(
      proposalSchema.safeParse({ ...proposal, state: 'accepted', itemVersionId: 'v1' }).success,
    ).toBe(false)
  })
  it('permits exactly the documented state moves', () => {
    const allowed = new Set([
      'draft:submitted',
      'submitted:in_review',
      'submitted:accepted',
      'submitted:changes_requested',
      'submitted:rejected',
      'submitted:withdrawn',
      'in_review:accepted',
      'in_review:changes_requested',
      'in_review:rejected',
      'in_review:withdrawn',
      'changes_requested:submitted',
      'changes_requested:withdrawn',
    ])
    for (const from of proposalStates)
      for (const to of proposalStates)
        expect(canTransitionProposal(from, to)).toBe(allowed.has(`${from}:${to}`))
  })
})
