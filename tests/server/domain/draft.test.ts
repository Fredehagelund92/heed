import { describe, expect, it } from 'vitest'
import {
  draftSchema,
  formatDraft,
  isEvidenceFinding,
  previewVersion,
  textFindings,
} from '../../../src/domain/draft.ts'
import { version } from './fixtures.ts'

describe('draft format checks', () => {
  it('keeps incomplete form fields while reporting submission problems', () => {
    const draft = {
      title: '',
      evidence: [{ url: '', quote: '', date: '' }],
      validity: { start: '', end: null },
    }
    expect(draftSchema.safeParse(draft).success).toBe(true)
    expect(formatDraft(draft, 'person', 'form').findings.some((f) => f.code === 'format')).toBe(
      true,
    )
  })
  it.each([
    ['email_address', 'person@example.test'],
    ['password_or_token', 'password = secret-value'],
    ['password_or_token', 'Bearer abcdefghijklmnop'],
    ['private_key', '-----BEGIN PRIVATE KEY-----'],
    ['access_key', 'AKIA1234567890ABCDEF'],
    ['phone_number', '555-123-4567'],
  ])('names %s without returning the matched text', (code, text) => {
    const findings = textFindings({ evidence: [{ quote: text }] })
    expect(findings).toContainEqual({
      code,
      field: 'evidence.0.quote',
      message: `Text matches ${code}`,
      severity: 'error',
    })
    expect(JSON.stringify(findings)).not.toContain(text)
  })
  it('does not treat dates, vocabulary ids or ordinary prose as sensitive text', () => {
    expect(
      textFindings({
        validity: { start: '2026-08-04', end: '2026-09-01' },
        summary: 'The API key rotation policy changed',
        scope: ['metric:orders'],
      }),
    ).toEqual([])
  })
})

describe('the live preview of a draft (FR-108)', () => {
  const {
    proposerId: _proposer,
    createdVia: _channel,
    mentions: _mentions,
    ...complete
  } = version()
  const draft = {
    ...complete,
    evidence: [{ url: 'https://example.test/law', quote: 'Online sales stopped', date: '' }],
  }

  it('previews a draft whose only errors are in where it comes from, with no evidence', () => {
    const checked = previewVersion(draft, 'person', 'form')
    expect(formatDraft(draft, 'person', 'form').version).toBeNull()
    expect(checked.findings.length).toBeGreaterThan(0)
    expect(checked.findings.every(isEvidenceFinding)).toBe(true)
    expect(checked.version).toMatchObject({ scope: draft.scope, evidence: [] })
  })

  it('keeps the evidence entries that are complete', () => {
    const complete = { url: 'https://example.test/notice', quote: 'Closed', date: '2026-08-04' }
    expect(
      previewVersion({ ...draft, evidence: [...draft.evidence, complete] }, 'person', 'form')
        .version?.evidence,
    ).toEqual([complete])
  })

  it('still stops on any other error, and on sensitive text in the evidence', () => {
    expect(previewVersion({ ...draft, validity: undefined }, 'person', 'form').version).toBeNull()
    expect(
      previewVersion(
        { ...draft, evidence: [{ url: '', quote: 'Mail ravi@example.test', date: '' }] },
        'person',
        'form',
      ).version,
    ).toBeNull()
  })
})
