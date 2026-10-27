import { describe, expect, it } from 'vitest'
import type { DerivationContext } from '../../../src/domain/agent-draft.ts'
import type { SourceDocument } from '../../../src/domain/connector-runtime.ts'
import {
  documentDraft,
  documentMark,
  documentQuote,
  normalisedText,
  skipReason,
} from '../../../src/domain/content-document.ts'
import { limits } from '../../../src/domain/proposal-rules.ts'
import { durationText, nextReadAt, scheduleSeconds } from '../../../src/domain/source-schedule.ts'
import type { Term } from '../../../src/domain/vocabulary.ts'

const term = (key: string, kind: Term['kind'], name: string, extra: Partial<Term> = {}): Term => ({
  key,
  kind,
  name,
  aliases: [],
  parentKey: null,
  areaId: null,
  definitionRefs: [],
  ...extra,
})
const context: DerivationContext = {
  terms: [
    term('metric:orders', 'metric', 'Orders', { areaId: 'finance' }),
    term('dim:market', 'dimension', 'Market'),
    term('val:market/norway', 'dimension_value', 'Norway', { parentKey: 'dim:market' }),
  ],
  areaOf: (key) => (key === 'metric:orders' ? 'finance' : null),
  areas: [
    { id: 'finance', name: 'Finance' },
    { id: 'sales', name: 'Sales' },
  ],
  today: '2026-10-08',
}
const document = (patch: Partial<SourceDocument> = {}): SourceDocument => ({
  id: 'docs/sales/orders.md',
  scope: 'sales',
  title: 'Orders in Norway include marketplace orders',
  link: 'https://git.example.test/handbook/blob/abc/docs/sales/orders.md',
  modifiedAt: '2026-10-06T09:30:00.000Z',
  version: 'abc',
  text: '# Orders in Norway include marketplace orders\n\nOrders in Norway include orders placed through the marketplace.\n\n## Why\n\nThe webshop alone is no longer the whole picture.\n',
  mediaType: 'text/markdown',
  ...patch,
})

describe('a document as the pipeline compares it (CON-605, CON-606)', () => {
  it('keeps its mark through line ends, trailing spaces and blank runs, and moves it with its words', async () => {
    const text = 'Orders in Norway.\n\nMore words.'
    expect(normalisedText('\uFEFFOrders in Norway.  \r\n\r\n\r\n\r\nMore words.\n')).toBe(text)
    const mark = await documentMark({ title: 'Orders', text })
    expect(await documentMark({ title: ' Orders ', text: `${text}\r\n\r\n` })).toBe(mark)
    expect(
      await documentMark({ title: 'Orders', text: 'Orders in Spain.\n\nMore words.' }),
    ).not.toBe(mark)
    expect(await documentMark({ title: 'Returns', text })).not.toBe(mark)
    expect(mark).toMatch(/^[a-f0-9]{64}$/)
  })

  it('quotes its first sentence after the headings, at most 500 characters', () => {
    expect(documentQuote(document().text)).toBe(
      'Orders in Norway include orders placed through the marketplace.',
    )
    const long = `${'word '.repeat(200)}end.`
    expect([...documentQuote(long)].length).toBe(limits.quote)
    expect(documentQuote('')).toBe('')
  })

  it('skips one that appears to name people, holds a secret or holds no words (CON-608)', () => {
    expect(skipReason('Ask anna@example.test about it.')).toBe('names_people')
    expect(skipReason('Call 555-123-4567 for orders.')).toBe('names_people')
    expect(skipReason('api_key: sk-abcdefghijklmnopqrstuv')).toBe('holds_secret')
    expect(skipReason('  \n\n ')).toBe('empty')
    expect(skipReason(document().text)).toBeNull()
  })
})

describe('a document as a draft (CON-602, CON-603)', () => {
  it('takes its title and first words, the vocabulary it names, and the domain of its scope', () => {
    const drafted = documentDraft(document(), 'sales', context)
    if ('skip' in drafted) throw new Error(drafted.skip)
    expect(drafted.draft).toMatchObject({
      areaId: 'sales',
      title: 'Orders in Norway include marketplace orders',
      summary: 'Orders in Norway include orders placed through the marketplace.',
      body: '## Why\n\nThe webshop alone is no longer the whole picture.',
      scope: {
        metrics: ['metric:orders'],
        dimensionValues: [{ dimension: 'dim:market', value: 'val:market/norway' }],
      },
      // No date in its words: it applies from the day it was last changed.
      validity: { start: '2026-10-06', end: null },
      evidence: [
        {
          url: document().link,
          quote: 'Orders in Norway include orders placed through the marketplace.',
          date: '2026-10-06',
        },
      ],
    })
    // Audience, risk, owner and links are never inferred: they keep their defaults and say so.
    expect(drafted.marks).toMatchObject({
      areaId: 'derived',
      evidence: 'derived',
      title: 'prefilled',
      ownerId: 'not_inferred',
      riskLevel: 'not_inferred',
      audience: 'not_inferred',
      replaces: 'not_inferred',
      conflicts: 'not_inferred',
    })
    expect(drafted.draft).not.toHaveProperty('ownerId')
    expect(drafted.draft).not.toHaveProperty('riskLevel')
  })

  it('reads dates its words name, and keeps a long text within the body limit', () => {
    const dated = documentDraft(
      document({ text: 'From 1 October 2026, orders in Norway include the marketplace.' }),
      'sales',
      context,
    )
    if ('skip' in dated) throw new Error(dated.skip)
    expect(dated.draft.validity?.start).toBe('2026-10-01')
    const paragraphs = Array.from(
      { length: 400 },
      (_, n) => `Orders in Norway, note ${n}. ${'x'.repeat(80)}`,
    )
    const long = documentDraft(document({ text: paragraphs.join('\n\n') }), 'sales', context)
    if ('skip' in long) throw new Error(long.skip)
    expect([...(long.draft.body ?? '')].length).toBeLessThanOrEqual(limits.body)
    expect(long.draft.body?.endsWith('x')).toBe(true)
  })

  it('skips one that names nothing in the vocabulary, or that names people', () => {
    expect(
      documentDraft(
        document({ title: 'Lunch', text: 'The canteen opens at noon.' }),
        'sales',
        context,
      ),
    ).toEqual({ skip: 'no_scope' })
    expect(
      documentDraft(document({ text: 'Orders: ask anna@example.test.' }), 'sales', context),
    ).toEqual({ skip: 'names_people' })
    expect(documentDraft(document({ text: '# Only a heading' }), 'sales', context)).toEqual({
      skip: 'empty',
    })
  })
})

describe('when a source is read next (CON-115)', () => {
  const now = new Date('2026-10-08T06:00:00Z')
  const read = { periodSeconds: 86_400, staleAfterSeconds: 172_800 }
  it('takes its own period, never under the connector’s minimum', () => {
    expect(scheduleSeconds(null, { defaultSeconds: 3_600, minimumSeconds: 900 })).toBe(3_600)
    expect(scheduleSeconds(7_200, { defaultSeconds: 3_600, minimumSeconds: 900 })).toBe(7_200)
    expect(scheduleSeconds(60, { defaultSeconds: 3_600, minimumSeconds: 900 })).toBe(900)
  })
  it('waits a period after a good read, or after one an admin must fix', () => {
    expect(nextReadAt(now, { ...read, failures: 0 }).toISOString()).toBe('2026-10-09T06:00:00.000Z')
    expect(nextReadAt(now, { ...read, failures: 3, failure: 'config' }).toISOString()).toBe(
      '2026-10-09T06:00:00.000Z',
    )
  })
  it('tries again sooner after one that clears by itself, doubling, within half of staleAfter', () => {
    const wait = (failures: number, retryAfterSeconds?: number) =>
      (nextReadAt(now, {
        ...read,
        failures,
        failure: 'transient',
        ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
      }).getTime() -
        now.getTime()) /
      1000
    expect([1, 2, 3, 4].map((n) => wait(n))).toEqual([60, 120, 240, 480])
    expect(wait(30)).toBe(86_400)
    expect(
      nextReadAt(now, {
        periodSeconds: 86_400,
        staleAfterSeconds: 7_200,
        failures: 30,
        failure: 'transient',
      }).getTime() - now.getTime(),
    ).toBe(3_600_000)
    // Never sooner than the tool asked.
    expect(wait(1, 900)).toBe(900)
  })
  it('says a period in ISO 8601', () => {
    expect([3_600, 86_400, 900, 90_000, 0].map(durationText)).toEqual([
      'PT1H',
      'P1D',
      'PT15M',
      'P1DT1H',
      'PT0M',
    ])
  })
})
