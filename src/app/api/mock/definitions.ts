import { DEFINITIONS_TOOL } from '@/model/integrations'
import { dimensions, metrics } from './data/world'
import { term, TERMS } from './data/terms'
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
