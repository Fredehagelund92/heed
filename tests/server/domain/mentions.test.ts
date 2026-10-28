import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { audienceAllows, noGroups } from '../../../src/domain/item.ts'
import {
  mentionsInFields,
  namedItems,
  parseMentions,
  serializeMentions,
  validateMentionTargets,
  withoutItems,
  type MentionPart,
} from '../../../src/domain/mentions.ts'

describe('mention tokens', () => {
  it('parses adjacent tokens, parentheses, accents and all five target kinds', () => {
    const parsed = parseMentions(
      '@[Cost (EUR)](metric:cost)@[Æøå](dim:market)@[Norway](val:market/norway)@[Notice](item:itm_12345678)@[Finance](area:finance)',
    )
    expect(parsed.text).toBe('Cost (EUR)ÆøåNorwayNoticeFinance')
    expect(parsed.mentions.map((mention) => mention.position)).toEqual([0, 1, 2, 3, 4])
    expect(parsed.errors).toEqual([])
  })
  it('parses a term written in Definitions by its id', () => {
    const id = '0190a0a0-0000-7000-8000-00000000000a'
    expect(parseMentions(`A @[webshop](term:${id}) order`).mentions).toEqual([
      { position: 0, label: 'webshop', target: `term:${id}` },
    ])
  })
  it.each([
    '@[x](term:Webshop)',
    '@[Review [draft]](metric:x)',
    '@[line\nbreak](metric:x)',
    '@[](metric:x)',
    '@[x](group:payments)',
    '@[x](cube:raw.name)',
    '@[x](item:version)',
    '@[x](metric:x',
  ])('preserves malformed input %s without a link', (markup) => {
    expect(parseMentions(markup)).toMatchObject({ text: markup, mentions: [] })
    expect(parseMentions(markup).errors).toHaveLength(1)
  })
  it('accepts an opening bracket but never an escaped closing bracket inside a label', () => {
    expect(parseMentions('@[[draft](metric:x)').mentions[0]?.label).toBe('[draft')
    expect(parseMentions(String.raw`@[draft\]](metric:x)`).mentions).toEqual([])
  })
  it('defines odd and even backslash parity without treating other backslashes as escapes', () => {
    expect(parseMentions(String.raw`Mail \@[literal](metric:x)`).text).toBe(
      'Mail @[literal](metric:x)',
    )
    expect(parseMentions(String.raw`Mail \@[literal](metric:x)`).mentions).toEqual([])
    expect(parseMentions(String.raw`\\@[linked](metric:x)`)).toMatchObject({
      text: '\\linked',
      mentions: [{ label: 'linked' }],
    })
    expect(parseMentions(String.raw`\\\@[literal](metric:x)`)).toMatchObject({
      text: '\\@[literal](metric:x)',
      mentions: [],
    })
    expect(parseMentions(String.raw`C:\temp`)).toMatchObject({
      text: String.raw`C:\temp`,
      mentions: [],
    })
  })
  it('round trips generated text and tokens, preserving order, targets and visible words', () => {
    const label = fc
      .string({ minLength: 1, maxLength: 100 })
      .filter((value) => !/[\]\r\n]/.test(value))
    const part = fc.oneof(
      fc.string().map((text): MentionPart => ({ kind: 'text', text })),
      fc
        .record({
          label,
          target: fc.constantFrom(
            'metric:x',
            'dim:y',
            'val:y/z',
            'item:itm_12345678',
            'area:finance',
          ),
        })
        .map((value): MentionPart => ({ kind: 'mention', ...value })),
    )
    fc.assert(
      fc.property(fc.array(part), (parts) => {
        const markup = serializeMentions(parts)
        const parsed = parseMentions(markup)
        expect(parsed.errors).toEqual([])
        expect(parsed.text).toBe(
          parts.map((part) => (part.kind === 'text' ? part.text : part.label)).join(''),
        )
        expect(parsed.mentions.map(({ label, target }) => ({ label, target }))).toEqual(
          parts
            .filter((part) => part.kind === 'mention')
            .map(({ label, target }) => ({ label, target })),
        )
        expect(serializeMentions(parsed.parts)).toBe(markup)
      }),
      { seed: 204, numRuns: 1000 },
    )
  })
  it('refuses self, missing, retired and source-missing targets and enforces the version cap', () => {
    const mentions = [
      'item:itm_12345678',
      'metric:unknown',
      'metric:missing',
      'item:itm_87654321',
    ].map((target, position) => ({ target, position, field: 'summary' as const, label: 'x' }))
    expect(
      validateMentionTargets(
        mentions,
        'itm_12345678',
        [
          { target: 'metric:missing', state: 'source_missing' },
          { target: 'item:itm_87654321', state: 'retired' },
        ],
        3,
      ),
    ).toHaveLength(5)
  })
})

describe('what names an item the audience rule hides (FR-128, NFR-029)', () => {
  const hidden = new Set(['itm_vault0001'])
  const summaryMarkup =
    'See @[the harbour note](item:itm_vault0001) and @[Orders](metric:orders), not @[the pier](item:itm_pier0001).'
  const bodyMarkup = 'Kept at 100 \\@ 5\\\\ by @[the harbour note](item:itm_vault0001).'

  it('names every item a value mentions, replaces or conflicts with, once', () => {
    expect(
      namedItems({
        summaryMarkup,
        bodyMarkup,
        replaces: ['itm_old00001'],
        conflicts: ['itm_pier0001'],
      }),
    ).toEqual(['itm_vault0001', 'itm_pier0001', 'itm_old00001'])
  })

  it('turns a mention of a hidden item into its words and drops it from the lists', () => {
    const mentions = mentionsInFields({ summaryMarkup, bodyMarkup })
    const shown = withoutItems(
      {
        summaryMarkup,
        bodyMarkup,
        mentions,
        replaces: ['itm_vault0001'],
        conflicts: ['itm_pier0001', 'itm_vault0001'],
      },
      hidden,
    )
    expect(shown.summaryMarkup).toBe(
      'See the harbour note and @[Orders](metric:orders), not @[the pier](item:itm_pier0001).',
    )
    expect(shown.bodyMarkup).toBe('Kept at 100 \\@ 5\\\\ by the harbour note.')
    // The plain text reads the same, and the mention rows still match the markup.
    expect(parseMentions(shown.summaryMarkup).text).toBe(parseMentions(summaryMarkup).text)
    expect(parseMentions(shown.bodyMarkup).text).toBe(parseMentions(bodyMarkup).text)
    expect(shown.mentions).toEqual([
      { field: 'summary', position: 0, label: 'Orders', target: 'metric:orders' },
      { field: 'summary', position: 1, label: 'the pier', target: 'item:itm_pier0001' },
    ])
    expect(shown.replaces).toEqual([])
    expect(shown.conflicts).toEqual(['itm_pier0001'])
    expect(JSON.stringify(shown)).not.toContain('itm_vault0001')
  })

  it('escapes the words of a hidden mention, so they never read as markup', () => {
    const shown = withoutItems({ summaryMarkup: 'A @[x \\ @y](item:itm_vault0001)' }, hidden)
    expect(shown.summaryMarkup).toBe('A x \\\\ \\@y')
    expect(parseMentions(shown.summaryMarkup).text).toBe('A x \\ @y')
    expect(parseMentions(shown.summaryMarkup).mentions).toEqual([])
  })

  it('leaves a value that names no hidden item exactly as it was', () => {
    const value = {
      summaryMarkup: 'See @[the pier](item:itm_pier0001).',
      conflicts: ['itm_pier0001'],
    }
    expect(withoutItems(value, hidden)).toBe(value)
    expect(withoutItems(value, new Set())).toBe(value)
  })

  it('gives an item for some groups only to nobody while groups are parked', () => {
    expect(audienceAllows({ kind: 'everyone' }, noGroups)).toBe(true)
    expect(audienceAllows({ kind: 'groups', groups: ['finance_team'] }, noGroups)).toBe(false)
    expect(audienceAllows({ kind: 'groups', groups: ['finance_team'] }, ['sales'])).toBe(false)
    expect(audienceAllows({ kind: 'groups', groups: ['finance_team'] }, ['finance_team'])).toBe(
      true,
    )
  })
})
