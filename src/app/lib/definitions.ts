import * as React from 'react'
import { useDefinitions as useDefinitionList } from '@/api/queries'
import { servedToAgents, type DomainId, type Fact } from '@/model/items'

// Definitions: the data glossary. Metrics and dimensions are synced from the connector (Cube
// today) and are never changed here: their name, meaning, other names and domain are Cube's.
// Two plain concepts are written here. A term is a word with its own meaning ("Peak season"). A
// synonym is another name for an existing definition ("GMV" for Gross sales): stored as a term
// that points at it, so adding one from the definition's tag box or from the term editor's
// "Another name for" writes the same entry, once. The definitions come from the app's API; the
// rules here read the list they are given.

export type DefinitionType = 'metric' | 'dimension' | 'term'

export type Definition = {
  name: string
  type: DefinitionType
  /** Its meaning. Empty for a synonym, whose meaning is its target's. */
  definition: string
  /** A synonym: the definition it is another name for. */
  sameAs?: string
  /** Synced from Cube: read-only here. */
  synced: boolean
  /** The tool a synced definition comes from, as people say it: "Cube". */
  tool?: string
  /** Other names that came with the synced item from Cube; read-only. */
  sourceNames: string[]
  domain?: DomainId
  /** Cube's group, for metrics and dimensions. */
  group?: string
  /** A dimension's values, as Cube lists them. */
  values?: string
  /** Cube changed it at the last sync. */
  changed?: string
  /** Who wrote a term. */
  by?: string
  updated: string
}

export const typeLabel: Record<DefinitionType, string> = {
  metric: 'Metric',
  dimension: 'Dimension',
  term: 'Term',
}
/** A type as people read it; a term that points at something else is a synonym. */
export const kindName = (d: Pick<Definition, 'type' | 'sameAs'>) =>
  d.sameAs ? 'Synonym' : typeLabel[d.type]
export const SYNCED_AT = 'today at 06:00'
export const sourceUrl = (d: Definition) =>
  `https://git.example/data/cube-model/blob/main/model/${(d.group ?? 'segments').toLowerCase()}.yml`
export const cubeRef = (d: Definition) =>
  `cube:${(d.group ?? 'segments').toLowerCase()}.${d.name.toLowerCase().replace(/[^a-z]+/g, '_')}`

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
export const findDefinition = (all: Definition[], name: string | undefined) =>
  name ? all.find((d) => same(d.name, name)) : undefined

/** The terms that mean the same as this definition: its "Also called in Heed". */
export const synonymsOf = (all: Definition[], name: string) =>
  all.filter((d) => d.sameAs && same(d.sameAs, name))

/** What a word finally means: a synonym's target, followed to the end. */
export function meaningOf(all: Definition[], d: Definition): Definition {
  const seen = new Set<string>()
  let at = d
  while (at.sameAs && !seen.has(at.name)) {
    seen.add(at.name)
    const next = findDefinition(all, at.sameAs)
    if (!next) break
    at = next
  }
  return at
}

/** Every word that means this definition: its name, Cube's other names, and Heed's synonyms. */
export const namesOf = (all: Definition[], d: Definition) => [
  d.name,
  ...d.sourceNames,
  ...synonymsOf(all, d.name).map((s) => s.name),
]

/** `short` is the one line a quick view shows; `other` is what the word already means. */
export type Conflict = {
  kind: 'two-things' | 'chain' | 'missing'
  message: string
  short: string
  other?: string
}

/**
 * Why a term can mislead an agent: its word already means something else (another definition's
 * name, or a name Cube gives another item), or it is a synonym of a synonym.
 */
export function conflictOf(all: Definition[], d: Definition): Conflict | undefined {
  if (d.type !== 'term') return undefined
  const target = d.sameAs ? findDefinition(all, d.sameAs) : undefined
  if (d.sameAs && !target)
    return {
      kind: 'missing',
      message: `${d.sameAs} isn't in Definitions any more. Point ${d.name} at something else.`,
      short: `${d.sameAs} isn't in Definitions any more.`,
    }
  // A term never conflicts with itself (a draft of it is a different object with the same name).
  const other = all.find(
    (x) =>
      !(x.type === 'term' && same(x.name, d.name)) &&
      x !== target &&
      (same(x.name, d.name) || x.sourceNames.some((n) => same(n, d.name))),
  )
  if (other)
    return {
      kind: 'two-things',
      message: `“${d.name}” already means ${other.name}${other.synced ? ` in ${other.tool}` : ' here'}${target ? `, and this term says it means ${target.name}` : ''}. An agent can't tell which one a person means. Rename this term or point it at ${other.name}.`,
      short: `“${d.name}” already means ${other.name}.`,
      other: other.name,
    }
  if (target?.sameAs) {
    const to = meaningOf(all, target)
    return {
      kind: 'chain',
      message: `${target.name} is itself a synonym of ${to.name}. Point ${d.name} at ${to.name} directly.`,
      short: `${target.name} is itself a synonym of ${to.name}.`,
    }
  }
  return undefined
}

/**
 * The live context about a definition: for a metric or a term, the items that use any of its
 * names (a metric through where it applies, a term in its text). Dimensions are about every item.
 */
export function contextAbout(all: Definition[], d: Definition, facts: Fact[]) {
  const target = meaningOf(all, d)
  if (target.type === 'dimension') return []
  const names = namesOf(all, target).map((n) => n.toLowerCase())
  const word = (n: string) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i')
  return facts.filter(
    (f) =>
      servedToAgents(f) &&
      (target.type === 'metric'
        ? f.where.some((w) => names.includes(w.toLowerCase()))
        : names.some((n) => word(n).test(`${f.title} ${f.summary} ${f.body ?? ''}`))),
  )
}

/** The word in a question that is a Heed synonym, and the synced item it means: "turnover" is Net revenue. */
export function synonymIn(
  all: Definition[],
  question: string,
): { asked: string; is: Definition } | undefined {
  const lower = question.toLowerCase()
  const hit = all
    .filter((d) => d.sameAs && !conflictOf(all, d))
    .sort((a, b) => b.name.length - a.name.length)
    .find((d) => new RegExp(`\\b${d.name.toLowerCase()}\\b`).test(lower))
  if (!hit) return undefined
  const is = meaningOf(all, hit)
  return is.synced ? { asked: hit.name, is } : undefined
}

/** The synonym rows the list folds into their definition: those whose definition is still there. */
export const foldsInto = (all: Definition[], d: Definition) =>
  d.sameAs ? findDefinition(all, d.sameAs) : undefined

/** Every synonym that ends at this definition, a synonym of a synonym included: the list's "Also called". */
export const alsoCalled = (all: Definition[], d: Definition) =>
  all.filter((x) => x.sameAs && !same(x.name, d.name) && same(meaningOf(all, x).name, d.name))

/**
 * Words typed or pasted into the synonym box: split on commas and new lines, trimmed, each word
 * once whatever its case, the person's own casing kept. "GMV, turnover, sales value" is three.
 */
export function parseTags(input: string): string[] {
  const out: string[] = []
  for (const raw of input.split(/[,\n]/)) {
    const w = raw.trim().replace(/\s+/g, ' ')
    if (w && !out.some((x) => same(x, w))) out.push(w)
  }
  return out
}

/** Why a word can't become a synonym of this definition, and who already has it. */
export type SynonymCheck =
  | { ok: true }
  | {
      ok: false
      why: 'empty' | 'here' | 'source' | 'taken' | 'term'
      reason: string
      holder?: string
      by?: string
    }

/** Checks a word before it becomes a synonym: never a second entry for a word, never a word that means something else. */
export function checkSynonym(all: Definition[], target: Definition, word: string): SynonymCheck {
  const name = word.trim()
  if (!name) return { ok: false, why: 'empty', reason: 'Type a word.' }
  const point = target.sameAs ? meaningOf(all, target) : target
  if (namesOf(all, point).some((n) => same(n, name)))
    return {
      ok: false,
      why: 'here',
      reason: `${point.name} is already called “${name}”.`,
      holder: point.name,
    }
  const taken = all.find(
    (d) => d.synced && (same(d.name, name) || d.sourceNames.some((n) => same(n, name))),
  )
  if (taken)
    return {
      ok: false,
      why: 'source',
      reason: `“${name}” is ${taken.tool}'s name for ${taken.name}.`,
      holder: taken.name,
      by: taken.tool,
    }
  const existing = all.find((d) => d.type === 'term' && same(d.name, name))
  if (existing?.sameAs)
    return {
      ok: false,
      why: 'taken',
      reason: `“${existing.name}” is already another name for ${existing.sameAs}, added by ${existing.by}.`,
      holder: existing.sameAs,
      by: existing.by,
    }
  if (existing)
    return {
      ok: false,
      why: 'term',
      reason: `“${existing.name}” is a term with its own meaning, written by ${existing.by}.`,
      holder: existing.name,
      by: existing.by,
    }
  return { ok: true }
}

/** The other names that go with a term when it is deleted: the synonyms that point at it. */
export const goesWith = (all: Definition[], names: string[]) =>
  all.filter(
    (d) => d.sameAs && names.some((n) => same(d.sameAs!, n)) && !names.some((n) => same(d.name, n)),
  )

/** The glossary's rules over one list of definitions, for a screen to call without passing it. */
export function glossary(all: Definition[]) {
  return {
    all,
    find: (name: string | undefined) => findDefinition(all, name),
    synonymsOf: (name: string) => synonymsOf(all, name),
    meaningOf: (d: Definition) => meaningOf(all, d),
    namesOf: (d: Definition) => namesOf(all, d),
    conflictOf: (d: Definition) => conflictOf(all, d),
    contextAbout: (d: Definition, facts: Fact[]) => contextAbout(all, d, facts),
    synonymIn: (question: string) => synonymIn(all, question),
    foldsInto: (d: Definition) => foldsInto(all, d),
    alsoCalled: (d: Definition) => alsoCalled(all, d),
    checkSynonym: (target: Definition, word: string) => checkSynonym(all, target, word),
    goesWith: (names: string[]) => goesWith(all, names),
  }
}

export type Glossary = ReturnType<typeof glossary>

/** The definitions as they stand, from the shared read. */
export const useDefinitions = (): Definition[] => useDefinitionList()

/** The glossary's rules over the definitions as they stand. */
export function useGlossary(): Glossary {
  const all = useDefinitions()
  return React.useMemo(() => glossary(all), [all])
}
