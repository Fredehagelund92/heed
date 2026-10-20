import { describe, expect, it } from 'vitest'
import { serializeMentions } from '@domain/mentions'
import {
  contextFormFindings,
  contextTextFindings,
  draftScope,
  findingField,
  followedDomain,
  formToDraft,
  formValues,
  hasDraftContent,
  inferredDomain,
  parseFormBackup,
  titleFromSummary,
} from '@/lib/context-form'
import { endFromLastDay } from '@/lib/validity-range'
import { getFixtureItems } from '@/mocks/fixtures'
import type { ProposalRecord } from '@/api'
import { createMockApi } from '@/api/mock-api'

describe('Add a fact draft mapping', () => {
  it('derives the title from the first visible sentence, within 200 characters', () => {
    expect(titleFromSummary('A change in @[Norway](val:market/norway). More detail.')).toBe(
      'A change in Norway.',
    )
    expect([...titleFromSummary('😀'.repeat(210))]).toHaveLength(200)
  })
  it('maps picker ids to governed keys and sends an exclusive end, without assigning a person', () => {
    const value = formValues()
    value.areaId = 'area_sales'
    value.kind = 'issue'
    value.scope = {
      metrics: ['orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'market', value: 'norway' }],
    }
    value.validity = { start: '2026-08-04', end: endFromLastDay('2026-08-04') }
    value.ended = true
    value.summaryMarkup = 'A reporting delay.'
    const draft = formToDraft(value)
    expect(draft.scope).toEqual({
      metrics: ['metric:orders'],
      dimensions: [],
      dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
    })
    expect(draft.validity).toEqual({ start: '2026-08-04', end: '2026-08-05' })
    expect(draft).not.toHaveProperty('ownerId')
    expect(draft).not.toHaveProperty('reviewDate')
    expect(draft).not.toHaveProperty('riskLevel')
  })
  it('sends no end for an open Issue even when an end date is still in the form', () => {
    const value = formValues()
    value.areaId = 'area_sales'
    value.kind = 'issue'
    value.summaryMarkup = 'A reporting delay.'
    value.validity = { start: '2026-08-04', end: '2026-08-06' }
    value.ended = false
    expect(formToDraft(value).validity).toEqual({ start: '2026-08-04', end: null })
    value.ended = true
    expect(formToDraft(value).validity).toEqual({ start: '2026-08-04', end: '2026-08-06' })
  })
  it('keeps accepted content when seeding a suggestion', () => {
    const item = getFixtureItems().find((item) => item.status === 'accepted')!
    expect(formValues(item)).toMatchObject({
      kind: item.kind,
      areaId: item.areaId,
      validity: item.validity,
      scope: draftScope(item.scope),
      evidence: item.evidence,
    })
  })
  it('starts what not to conclude empty, unless the item stores its own words', () => {
    const items = getFixtureItems()
    const plain = items.find((item) => item.notToConclude === 'cause not proven')!
    expect(formValues(plain).notToConclude).toBe('')
    expect(formValues({ ...plain, notToConclude: 'Cause not proven' }).notToConclude).toBe('')
    const own = items.find((item) => item.title === 'Payment provider delays order data in Poland')!
    expect(formValues(own).notToConclude).toBe(own.notToConclude)
    expect(own.notToConclude).toMatch(/^Low orders in Poland/)
    expect(formValues().notToConclude).toBe('')
  })
  it('stores the default for an empty box, and never turns a stored default into a change', () => {
    const empty = { ...formValues(), areaId: 'sales' }
    // A new draft leaves it to the service, which stores "cause not proven".
    expect(formToDraft(empty)).not.toHaveProperty('notToConclude')
    // A draft that holds a default keeps it as written: a new spelling would be a change nobody made.
    const stored = { notToConclude: 'Cause not proven' }
    expect(formToDraft(empty, stored).notToConclude).toBe('Cause not proven')
    // Own words taken out store the default; own words typed are stored as typed.
    expect(formToDraft(empty, { notToConclude: 'Old words.' }).notToConclude).toBe(
      'cause not proven',
    )
    const typed = { ...empty, notToConclude: 'It does not tell you why.' }
    expect(formToDraft(typed, stored).notToConclude).toBe('It does not tell you why.')
  })
  it('restores a backup saved with the default in the box as an empty box', () => {
    const backup = { ...formValues(), notToConclude: 'Cause not proven' }
    expect(parseFormBackup(backup)).toMatchObject({ success: true, data: { notToConclude: '' } })
  })
  it('keeps what is wrong with the current version apart from the draft, and reads it back', () => {
    const item = getFixtureItems().find((item) => item.status === 'accepted')!
    const value = { ...formValues(item), reason: 'The source moved.' }
    expect(formToDraft(value)).not.toHaveProperty('reason')
    const change = { action: 'change', reason: 'The source moved.', draft: formToDraft(value) }
    expect(formValues(change as unknown as ProposalRecord).reason).toBe('The source moved.')
    // A withdrawn or new item's reason is not what is wrong with a current version.
    expect(formValues({ ...change, action: 'create' } as unknown as ProposalRecord).reason).toBe('')
    expect(contextTextFindings({ ...value, reason: 'Mail jon@example.com' })).toContainEqual(
      expect.objectContaining({ field: 'reason', code: 'email_address' }),
    )
  })
  it('restores a backup saved before the form asked what is wrong', () => {
    const { reason: _reason, ...older } = formValues()
    expect(parseFormBackup(older)).toMatchObject({ success: true, data: { reason: '' } })
  })
  it('asks for a change reason within 500 characters, in plain text', () => {
    const item = getFixtureItems().find((item) => item.status === 'accepted')!
    const findings = (reason: string) =>
      contextFormFindings({ ...formValues(item), reason }).filter(
        (finding) => finding.field === 'reason',
      )
    expect(findings('x'.repeat(500))).toEqual([])
    expect(findings('x'.repeat(501))).toMatchObject([{ message: 'Keep it to 500 characters.' }])
    expect(findings('See @[Orders](metric:orders)')).toMatchObject([
      { message: 'Write plain text, without @ mentions.' },
    ])
  })
  it('does not accept an ended issue without its last day or sensitive source text', () => {
    const value = { ...formValues(), kind: 'issue' as const, ended: true }
    value.evidence[0]!.quote = 'password=do-not-store-this'
    const findings = contextFormFindings(value)
    expect(findings).toContainEqual(expect.objectContaining({ field: 'validity.end' }))
    expect(findings).toContainEqual(
      expect.objectContaining({ field: 'evidence.0.quote', code: 'password_or_token' }),
    )
  })
  it('maps service findings to the visible field and leaves blank drafts out of lists', () => {
    expect(findingField('summary')).toBe('summaryMarkup')
    expect(findingField('ownerId')).toBe('areaId')
    expect(findingField('scope.metrics.0')).toBe('scope')
    expect(
      hasDraftContent({
        summary: ' ',
        scope: { metrics: [], dimensions: [], dimensionValues: [] },
      }),
    ).toBe(false)
    expect(hasDraftContent({ summary: 'Something happened.' })).toBe(true)
  })
  it('infers a domain only when the selected metrics agree', async () => {
    const catalogue = await createMockApi().listCatalogue()
    const metric = catalogue.terms.find((term) => term.kind === 'metric' && term.domain.areaId)!
    expect(
      inferredDomain({ metrics: [metric.id], dimensions: [], dimensionValues: [] }, catalogue),
    ).toBe(metric.domain.areaId)
    expect(
      inferredDomain({ metrics: [], dimensions: [], dimensionValues: [] }, catalogue),
    ).toBeNull()
  })
  it('follows the metric domain once the catalogue is there, and never clears it before', async () => {
    const catalogue = await createMockApi().listCatalogue()
    // Still loading: the form keeps its domain rather than clearing one it cannot work out yet.
    expect(followedDomain(false, undefined, null)).toBeUndefined()
    expect(followedDomain(false, catalogue, 'area_sales')).toBe('area_sales')
    expect(followedDomain(false, catalogue, null)).toBe('')
    // Once the person chooses a domain, it is theirs.
    expect(followedDomain(true, catalogue, 'area_marketing')).toBeUndefined()
  })
  it('finds an email in the summary although its markup escapes the @, as the service does', () => {
    const value = formValues()
    value.summaryMarkup = serializeMentions([{ kind: 'text', text: 'Ask anna.berg@example.com.' }])
    expect(value.summaryMarkup).toBe('Ask anna.berg\\@example.com.')
    const findings = contextTextFindings(value)
    expect(findings.map(({ field, code }) => ({ field, code }))).toEqual([
      { field: 'summaryMarkup', code: 'email_address' },
    ])
    expect(findings[0]?.message).toMatch(/^Looks like an email address\./)
    expect(contextFormFindings(value)).toContainEqual(
      expect.objectContaining({ field: 'summaryMarkup', code: 'email_address' }),
    )
  })
  it('sends the typed title, and the first sentence of the summary when there is none', () => {
    const value = formValues()
    value.areaId = 'area_sales'
    value.summaryMarkup = 'Online sales stopped. More detail.'
    expect(formToDraft(value).title).toBe('Online sales stopped.')
    value.title = '  How to explain a drop  '
    expect(formToDraft(value).title).toBe('How to explain a drop')
    expect(findingField('title')).toBe('title')
  })
  it('reopens a derived title as an empty field that follows a new summary', () => {
    const value = formValues()
    value.areaId = 'area_sales'
    value.summaryMarkup = 'Fees rose in May.'
    const reopened = formValues({ draft: formToDraft(value) } as unknown as ProposalRecord)
    expect(reopened.title).toBe('')
    reopened.summaryMarkup = 'Fees fell in June.'
    expect(formToDraft(reopened).title).toBe('Fees fell in June.')
  })
  it('keeps a typed title when a draft is reopened', () => {
    const value = formValues()
    value.areaId = 'area_sales'
    value.summaryMarkup = 'Fees rose in May.'
    value.title = 'May fee change'
    const reopened = formValues({ draft: formToDraft(value) } as unknown as ProposalRecord)
    expect(reopened.title).toBe('May fee change')
    reopened.summaryMarkup = 'Fees fell in June.'
    expect(formToDraft(reopened).title).toBe('May fee change')
  })
})
