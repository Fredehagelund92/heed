import { DEFINITIONS_TOOL } from '@/model/integrations'
import { dimensions, metrics } from './data/world'
import type { DomainId } from '@/model/items'
import {
  checkSynonym,
  goesWith,
  meaningOf,
  type Definition,
  type SynonymCheck,
} from '@/lib/definitions'

// The mock's definitions, the data glossary: metrics and dimensions synced from the connector (Cube
// today), never changed here, and the terms and synonyms written here. Kept until the page reloads.

const term = (
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

const TERMS: Definition[] = [
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

const seed: Definition[] = [
  ...metrics.map<Definition>((m) => ({
    name: m.name,
    type: 'metric',
    definition: m.definition,
    synced: true,
    tool: DEFINITIONS_TOOL,
    sourceNames: m.otherNames ?? [],
    domain: m.domain,
    group: m.group,
    changed: m.note === 'changed' ? '7 Oct' : undefined,
    updated: m.note === 'changed' ? '7 Oct 2026' : '22 Oct 2026',
  })),
  ...dimensions.map<Definition>((d) => ({
    name: d.name,
    type: 'dimension',
    definition: d.definition,
    synced: true,
    tool: DEFINITIONS_TOOL,
    sourceNames: [],
    group: 'Segments',
    values: d.values,
    updated: '22 Oct 2026',
  })),
  ...TERMS,
]

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

export { seed as definitionSeed }

export function createDefinitions() {
  let all = seed

  return {
    list: () => all,

    /** Saves a term; a renamed one replaces the old entry where it stood. Synced items are never saved here. */
    saveTerm(previous: string | undefined, next: Definition) {
      if (next.synced) return
      const index = previous ? all.findIndex((d) => d.name === previous) : -1
      all = index === -1 ? [...all, next] : all.map((d, i) => (i === index ? next : d))
    },

    /**
     * Adds a synonym to a definition. An existing term with that word is pointed at it (no second
     * entry for the same word); otherwise a new term is written. It never edits the target.
     */
    addSynonym(
      targetName: string,
      word: string,
      by: string,
    ): { ok: true; created: boolean } | Exclude<SynonymCheck, { ok: true }> {
      const target = all.find((d) => same(d.name, targetName))
      if (!target) return { ok: false, why: 'empty', reason: 'Type a word.' }
      const check = checkSynonym(all, target, word)
      if (!check.ok) return check
      const point = target.sameAs ? meaningOf(all, target) : target
      all = [
        ...all,
        term(word.trim().replace(/\s+/g, ' '), {
          sameAs: point.name,
          domain: point.domain,
          by,
          updated: '23 Oct 2026',
        }),
      ]
      return { ok: true, created: true }
    },

    /** Removes a synonym: the term only existed to point here, so it goes. Gives back Undo. */
    removeTerm(name: string) {
      const was = all.find((d) => d.type === 'term' && same(d.name, name))
      all = all.filter((d) => d !== was)
      return () => {
        if (was && !all.some((d) => same(d.name, was.name))) all = [...all, was]
      }
    },

    /** Deletes terms, and the synonyms that only existed to point at them. Gives back Undo. */
    deleteTerms(names: string[]) {
      const before = all
      const gone = new Set(
        [...names, ...goesWith(all, names).map((d) => d.name)].map((n) => n.toLowerCase()),
      )
      all = all.filter((d) => d.synced || !gone.has(d.name.toLowerCase()))
      return () => {
        all = before
      }
    },

    /** Moves terms to another domain. Gives back Undo. */
    moveTerms(names: string[], domain: DomainId) {
      const before = all
      all = all.map((d) => (!d.synced && names.some((n) => same(d.name, n)) ? { ...d, domain } : d))
      return () => {
        all = before
      }
    },
  }
}

export type MockDefinitions = ReturnType<typeof createDefinitions>
