import type { Definition } from '@/lib/definitions'

// The terms and synonyms Larchwood Outdoor's people wrote in Definitions, as the mock starts: the
// mock binding's glossary (definitions.ts) and the http mode's demo week (tests/web/http) read them.

export const term = (
  name: string,
  fields: Partial<Definition> & { by: string; updated: string },
): Definition => ({
  name,
  type: 'term',
  definition: '',
  synced: false,
  sourceNames: [],
  ...fields,
})

export const TERMS: Definition[] = [
  term('Webshop', {
    domain: 'sales',
    definition:
      'Orders placed on larchwood.example or in the iOS and Android apps. Marketplace orders are not the webshop.',
    by: 'Jon Abara',
    updated: '2 Oct 2026',
  }),
  term('Store credit', {
    domain: 'sales',
    definition:
      'Money a customer holds with us from a gift card or a refund, spent like cash at checkout. Orders count it; Net revenue does not.',
    by: 'Sofia Brandt',
    updated: '5 Sep 2026',
  }),
  term('Peak season', {
    domain: 'marketing',
    definition:
      '15 November to 31 December, and 1 to 31 March for the spring sale. Compare a peak week with the same week last year, not with the week before.',
    by: 'Tomas Eriksen',
    updated: '18 Sep 2026',
  }),
  term('Price promotion', {
    domain: 'marketing',
    definition:
      'A lower price shown to everyone for a set time, as opposed to a discount code a customer types in.',
    by: 'Tomas Eriksen',
    updated: '11 Sep 2026',
  }),
  term('Test account', {
    domain: 'customer_value',
    definition:
      'An account made by our team to try the shop. Its orders are real orders in the payment data but are left out of customer counts.',
    by: 'Noor Haddad',
    updated: '2 Jul 2026',
  }),
  // Synonyms: Heed's own words that mean a synced item, or another term.
  term('GMV', { sameAs: 'Gross sales', domain: 'sales', by: 'Jon Abara', updated: '14 Oct 2026' }),
  term('Turnover', {
    sameAs: 'Net revenue',
    domain: 'sales',
    by: 'Sofia Brandt',
    updated: '9 Oct 2026',
  }),
  term('Purchases', {
    sameAs: 'Orders',
    domain: 'sales',
    by: 'Sofia Brandt',
    updated: '12 Oct 2026',
  }),
  term('Basket size', {
    sameAs: 'Average order value',
    domain: 'sales',
    by: 'Jon Abara',
    updated: '30 Sep 2026',
  }),
  term('Country', { sameAs: 'Market', by: 'Ravi Kapoor', updated: '1 Oct 2026' }),
  term('Online store', {
    sameAs: 'Webshop',
    domain: 'sales',
    by: 'Jon Abara',
    updated: '2 Oct 2026',
  }),
  // Two conflicts an owner has to settle: a word used for two things, and a synonym of a synonym.
  term('Sales', {
    sameAs: 'Net revenue',
    domain: 'sales',
    by: 'Ines Duarte',
    updated: '21 Oct 2026',
  }),
  term('Takings', { sameAs: 'Turnover', domain: 'sales', by: 'Lars Dahl', updated: '22 Oct 2026' }),
]
