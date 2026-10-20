import { describe, expect, it } from 'vitest'
import {
  ABOUT_BUSINESS_GUIDE,
  ABOUT_BUSINESS_MAX,
  ABOUT_BUSINESS_STARTER,
  ABOUT_BUSINESS_WORDS_HEADING,
  aboutBusinessLength,
  acceptDraft,
  draftAboutBusiness,
  draftProblem,
  normalizeAboutBusiness,
  type BusinessFacts,
} from '../../src/domain/about-business.ts'

/*
  The first version of About our business, written from what Heed already knows: the domains and
  the metrics and dimensions of the definition source. It is a pure function of those facts, it
  fits the limit, and it states no number, deal, date or legal conclusion.
*/

const facts: BusinessFacts = {
  domains: [
    { name: 'Sales', summary: 'Orders and returns' },
    { name: 'Marketing', summary: '' },
    { name: 'Operations', summary: '' },
  ],
  terms: [
    {
      kind: 'dimension',
      name: 'Market',
      aliases: ['Country'],
      description: 'The country or region the order ships to.',
    },
    {
      kind: 'metric',
      name: 'Orders',
      aliases: [],
      description:
        'The value of orders customers completed and paid for, in euros at the daily rate. Cancelled orders are left out.',
    },
    { kind: 'metric', name: 'Net revenue', aliases: ['Turnover', 'Sales'], description: null },
    { kind: 'metric', name: 'Returns', aliases: [], description: null },
  ],
}

describe('draftAboutBusiness', () => {
  it('names the domains, then the words, metrics before dimensions', () => {
    expect(draftAboutBusiness(facts)).toBe(
      [
        'We keep our facts in these domains: Sales, Marketing and Operations.',
        '',
        ABOUT_BUSINESS_WORDS_HEADING,
        '- Orders: the value of orders customers completed and paid for, in euros at the daily rate.',
        '- Net revenue: also called Turnover or Sales.',
        '- Market: the country or region the order ships to.',
      ].join('\n'),
    )
  })

  it('is the same text for the same facts', () => {
    expect(draftAboutBusiness(structuredClone(facts))).toBe(draftAboutBusiness(facts))
  })

  it('keeps to the limit and to whole lines when Heed knows a lot', () => {
    const many: BusinessFacts = {
      domains: facts.domains,
      terms: Array.from({ length: 80 }, (_, index) => ({
        kind: 'metric' as const,
        name: `Metric ${'abcdefghijklmnopqrstuvwxyz'[index % 26]}${'xyz'[index % 3]}${'ab'.repeat(index % 7)} name`,
        aliases: [],
        description: `Counts the things of kind ${'x'.repeat(100)} in the shop.`,
      })),
    }
    const text = draftAboutBusiness(many)
    expect(aboutBusinessLength(text)).toBeLessThanOrEqual(1000)
    expect(text.split('\n').every((line) => !line.startsWith('- ') || line.endsWith('.'))).toBe(
      true,
    )
    expect(acceptDraft(text)).toBe(text)
  })

  it('leaves out a number, a date, a legal conclusion, a link and personal data', () => {
    const risky: BusinessFacts = {
      domains: [
        { name: 'Sales 2026', summary: '' },
        { name: 'Legal', summary: '' },
        ...facts.domains,
      ],
      terms: [
        {
          kind: 'metric',
          name: 'Orders',
          aliases: [],
          description: 'Orders in the last 30 days.',
        },
        {
          kind: 'metric',
          name: 'Consent',
          aliases: [],
          description: 'Whether a sale is lawful in the market.',
        },
        {
          kind: 'metric',
          name: 'Contact',
          aliases: ['anna@example.com'],
          description: 'See https://example.com/contact.',
        },
        {
          kind: 'metric',
          name: 'Margin',
          aliases: [],
          description: 'Net revenue less cost of goods.',
        },
      ],
    }
    const text = draftAboutBusiness(risky)
    expect(draftProblem(text)).toBeNull()
    expect(text).toContain('Sales, Marketing and Operations')
    expect(text).not.toMatch(/Legal|Consent|Contact|30|lawful/)
    expect(text).toContain('- Margin: net revenue less cost of goods.')
  })

  it('writes nothing when Heed knows nothing to write from', () => {
    expect(draftAboutBusiness({ domains: [], terms: [] })).toBe('')
    expect(draftAboutBusiness({ domains: [], terms: [{ ...facts.terms[2]!, aliases: [] }] })).toBe(
      '',
    )
  })

  it('lowers the first letter of a meaning, unless it opens on a name Heed knows', () => {
    const text = draftAboutBusiness({
      domains: [{ name: 'Norway', summary: '' }],
      terms: [
        { kind: 'metric', name: 'Orders', aliases: [], description: 'Customers who paid.' },
        { kind: 'metric', name: 'Home', aliases: [], description: 'Norway is where it ships.' },
      ],
    })
    expect(text).toContain('- Orders: customers who paid.')
    expect(text).toContain('- Home: Norway is where it ships.')
  })

  it('is a text the setting keeps as it is', () => {
    const text = draftAboutBusiness(facts)
    expect(normalizeAboutBusiness(text)).toBe(text)
  })
})

describe('acceptDraft', () => {
  it('takes a model text in Heed form and refuses what a draft must not hold', () => {
    expect(acceptDraft('  We sell boots.\r\n\r\n\r\nWords:\r\n- Order: a paid purchase.  ')).toBe(
      'We sell boots.\n\nWords:\n- Order: a paid purchase.',
    )
    expect(acceptDraft('')).toBeNull()
    expect(acceptDraft('x'.repeat(ABOUT_BUSINESS_MAX + 1))).toBeNull()
    expect(acceptDraft('We sold 40 percent more.')).toBeNull()
    expect(acceptDraft('Selling this is illegal in Norway.')).toBeNull()
    expect(acceptDraft('Write to anna@example.com.')).toBeNull()
  })
})

describe('the guide in the box', () => {
  it('has the two parts and what to leave out, and the starter text follows it', () => {
    expect(ABOUT_BUSINESS_GUIDE.parts.map((part) => part.title)).toEqual([
      'What the company does',
      'Words an outsider would misread',
    ])
    expect(ABOUT_BUSINESS_STARTER).toContain(ABOUT_BUSINESS_WORDS_HEADING)
    expect(ABOUT_BUSINESS_GUIDE.leaveOut).not.toContain('—')
  })
})
