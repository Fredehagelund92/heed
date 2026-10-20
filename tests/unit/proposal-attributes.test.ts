import { describe, expect, it } from 'vitest'
import { itemKinds } from '@domain/item'
import {
  attributeNames,
  formFields,
  limits,
  proposalAttributes,
  type FormField,
  type ProposalAttribute,
} from '@domain/proposal-attributes'
import {
  contextFormFindings,
  contextFormSchema,
  formToDraft,
  formValues,
  type ContextFormValues,
} from '@/lib/context-form'
import { formMismatch } from '../server/attribute-parity.ts'

/*
  The form's half of the alignment guard (CONTRIBUTING.md, "Proposal attributes"): the Add
  context and Suggest a change form edits only attributes classified in
  src/domain/proposal-attributes.ts, asks for each required one it edits, and checks the same
  limits as the item version schema and the agent tool. The schema's and the tool's half is
  tests/server/proposal-attributes.test.ts.
*/

const spec = (name: ProposalAttribute) => proposalAttributes[name]

describe('the form edits the classified attributes', () => {
  const formKeys = Object.keys(contextFormSchema.shape)
  it('has exactly the fields the attribute table names', () => {
    expect(formMismatch(formKeys)).toEqual([])
    expect([...formKeys].sort()).toEqual([...formFields].sort())
    expect(formMismatch([...formKeys, 'confidence'])[0]).toContain(
      'The form field "confidence" edits no classified attribute',
    )
  })
  const valid: ContextFormValues = {
    ...formValues(),
    kind: 'event',
    summaryMarkup: 'Orders in Norway were booked a day late.',
    scope: { metrics: ['metric:orders'], dimensions: [], dimensionValues: [] },
    validity: { start: '2026-10-01', end: null },
    evidence: [{ url: 'https://status.example/a', quote: 'One sentence.', date: '2026-10-02' }],
    areaId: 'area_finance',
  }
  it('turns into a draft of classified attributes only', () => {
    const draft = formToDraft(valid)
    for (const key of Object.keys(draft)) expect(attributeNames).toContain(key)
  })
  // How to leave each form field blank. A new form field fails to compile until it has one.
  const blank: Record<FormField, (values: ContextFormValues) => ContextFormValues> = {
    kind: (values) => values,
    title: (values) => ({ ...values, title: '' }),
    summaryMarkup: (values) => ({ ...values, summaryMarkup: '' }),
    bodyMarkup: (values) => ({ ...values, bodyMarkup: '' }),
    scope: (values) => ({
      ...values,
      scope: { metrics: [], dimensions: [], dimensionValues: [] },
    }),
    validity: (values) => ({ ...values, validity: { start: null, end: null } }),
    ended: (values) => ({ ...values, ended: false }),
    evidence: (values) => ({ ...values, evidence: [{ url: '', quote: '', date: '' }] }),
    areaId: (values) => ({ ...values, areaId: '' }),
    notToConclude: (values) => ({ ...values, notToConclude: '' }),
    reason: (values) => ({ ...values, reason: '' }),
  }
  it('asks for every required attribute it edits, or the table says what fills it', () => {
    expect(contextFormFindings(valid)).toEqual([])
    for (const name of attributeNames) {
      const { form, required } = spec(name)
      if (!required || 'none' in form || 'blank' in spec(name)) continue
      const field = form[0]
      const findings = contextFormFindings(blank[field](valid))
      expect(
        findings.some(
          (finding) => finding.field === field || finding.field.startsWith(`${field}.`),
        ),
        `The form lets "${name}" (form field "${field}") be blank without a finding. Add a check to contextFormFindings in src/web/lib/context-form.ts, or say what fills it in its "blank" in src/domain/proposal-attributes.ts.`,
      ).toBe(true)
    }
  })
})

describe('the form checks the shared limits and vocabulary', () => {
  const over = (limit: number) => 'x'.repeat(limit + 1)
  const at = (limit: number) => 'x'.repeat(limit)
  // Scanning the longest allowed texts for sensitive words is CPU work that passes 5 seconds on
  // a busy machine, so it has more time than the default.
  it('in the form', { timeout: 30_000 }, () => {
    const base: ContextFormValues = {
      ...formValues(),
      evidence: [{ url: 'https://a.example/b', quote: 'q', date: '2026-10-01' }],
    }
    const fieldsOf = (values: ContextFormValues) =>
      contextFormFindings(values).map((finding) => finding.field)
    expect(fieldsOf({ ...base, title: at(limits.title) })).not.toContain('title')
    expect(fieldsOf({ ...base, title: over(limits.title) })).toContain('title')
    expect(fieldsOf({ ...base, summaryMarkup: at(limits.summary) })).not.toContain('summaryMarkup')
    expect(fieldsOf({ ...base, summaryMarkup: over(limits.summary) })).toContain('summaryMarkup')
    expect(fieldsOf({ ...base, notToConclude: at(limits.notToConclude) })).not.toContain(
      'notToConclude',
    )
    expect(fieldsOf({ ...base, notToConclude: over(limits.notToConclude) })).toContain(
      'notToConclude',
    )
    expect(fieldsOf({ ...base, bodyMarkup: over(limits.body) })).toContain('bodyMarkup')
    const quoted = (quote: string) => ({
      ...base,
      evidence: [{ url: 'https://a.example/b', quote, date: '2026-10-01' }],
    })
    expect(fieldsOf(quoted(at(limits.quote)))).not.toContain('evidence.0.quote')
    expect(fieldsOf(quoted(over(limits.quote)))).toContain('evidence.0.quote')
  })
  it('offers the one vocabulary of kinds', () => {
    expect(contextFormSchema.shape.kind.options).toEqual([...itemKinds])
  })
})
