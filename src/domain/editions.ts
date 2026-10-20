/**
 * What changed between two editions, in the words of the people who read it: data owners and
 * the data platform team, not developers (Editions design, sections 0 and 1). How a change is
 * classified, which fields the system fills in, and one sentence that says what changed, who did
 * it and why. Pure functions of what they are given: no clock, no input or output.
 */
import { editionChangeKinds, type EditionChangeKind } from './edition-changes.ts'
import type { RiskLevel } from './item.ts'

export { editionChangeKinds, type EditionChangeKind }

export type ChangeCounts = Record<EditionChangeKind, number>

export const noChanges = (): ChangeCounts => ({
  added: 0,
  changed: 0,
  checked: 0,
  resaved: 0,
  retired: 0,
  removed: 0,
})

/**
 * Fields the system fills in rather than a person: definition references and their change marks
 * follow the scope, and the markup repeats the text with its mentions. A page folds them away.
 */
export const systemFilledFields = [
  'references',
  'changeMarks',
  'summaryMarkup',
  'bodyMarkup',
] as const

export function isSystemFilled(field: string): boolean {
  return (systemFilledFields as readonly string[]).includes(field)
}

const riskOrder: readonly RiskLevel[] = ['low', 'normal', 'high']

/** The highest of some risk levels, or null for none. */
export function highestRisk(levels: readonly (RiskLevel | null)[]): RiskLevel | null {
  let highest: RiskLevel | null = null
  for (const level of levels)
    if (level && (highest === null || riskOrder.indexOf(level) > riskOrder.indexOf(highest)))
      highest = level
  return highest
}

/** Everything a sentence needs, with people and areas already named. */
export type SentenceInput = {
  /**
   * What made the edition (`edition_reason`: `proposal_accepted`, `item_retired`, `rollback`
   * and so on); null for a comparison of two editions.
   */
  reason: string | null
  /** The edition gone back to, for a rollback. */
  restores?: string | null
  /** Who made the change: the person who decided, else the edition's actor; null when nobody did. */
  actor?: string | null
  /** Who proposed it, when one person did. */
  proposer?: string | null
  /** Why, in the decider's own words: the decision's reason or the edition's note. */
  why?: string | null
  counts: ChangeCounts
  /** The item, when exactly one changed. */
  only?: { title: string } | null
  /** The names of the areas whose items changed. */
  areas: readonly string[]
  vocabulary: number
  /** Changed items with an audience group, which only a count may show. */
  withheld?: number
  /** For a comparison: how many editions it spans. */
  editions?: number
}

const plural = (count: number, one: string, many: string) =>
  `${count.toLocaleString('en')} ${count === 1 ? one : many}`

/** "Finance", "Finance and Marketing", "Finance, Marketing and Payments", "5 domains". */
function areaList(areas: readonly string[]): string {
  if (areas.length === 0) return ''
  if (areas.length > 3) return plural(areas.length, 'domain', 'domains')
  if (areas.length === 1) return areas[0]!
  return `${areas.slice(0, -1).join(', ')} and ${areas.at(-1)}`
}

const countWords: Record<EditionChangeKind, string> = {
  added: 'added',
  changed: 'changed',
  checked: 'checked and still correct',
  resaved: 'saved again with nothing different',
  retired: 'archived',
  removed: 'no longer shared with AI apps',
}

function onlyItem(kind: EditionChangeKind, title: string, area: string): string {
  const where = (word: string) => (area ? ` ${word} ${area}` : '')
  switch (kind) {
    case 'added':
      return `"${title}" was added${where('to')}`
    case 'changed':
      return `"${title}" changed${where('in')}`
    case 'checked':
      return `"${title}"${where('in')} was checked and is still correct`
    case 'resaved':
      return `"${title}"${where('in')} was saved again, nothing different`
    case 'retired':
      return `"${title}"${where('in')} was archived`
    case 'removed':
      return `AI apps no longer get "${title}"${where('in')}`
  }
}

/** What changed, without who or why. */
function whatChanged(input: SentenceInput): string {
  const kinds = editionChangeKinds.filter((kind) => input.counts[kind] > 0)
  const total = kinds.reduce((sum, kind) => sum + input.counts[kind], 0)
  const parts: string[] = []
  if (total === 1 && input.only)
    parts.push(onlyItem(kinds[0]!, input.only.title, areaList(input.areas)))
  else if (total > 0) {
    const where = input.areas.length ? ` in ${areaList(input.areas)}` : ''
    const split =
      kinds.length > 1
        ? `: ${kinds.map((kind) => `${input.counts[kind].toLocaleString('en')} ${countWords[kind]}`).join(', ')}`
        : ` (${countWords[kinds[0]!]})`
    parts.push(`${plural(total, 'fact', 'facts')}${where}${split}`)
  }
  if (input.withheld)
    parts.push(
      `${plural(input.withheld, 'fact that only some groups see', 'facts that only some groups see')} changed`,
    )
  if (input.vocabulary > 0) parts.push(plural(input.vocabulary, 'name changed', 'names changed'))
  // An edition from before every domain was served may have only moved a domain's state.
  if (parts.length === 0)
    return input.reason === 'area_state_changed'
      ? 'A domain was switched on or off, before AI apps got every domain'
      : 'Nothing different'
  const sentence = parts.join('; ')
  return sentence.charAt(0).toUpperCase() + sentence.slice(1)
}

/** Who made the change, in words: "by Jon Abara", or "automatically" when nobody did. */
function whoChanged(input: SentenceInput): string {
  const by = input.actor ? `by ${input.actor}` : 'automatically'
  switch (input.reason) {
    case null:
      return ''
    case 'bootstrap':
      return 'The first edition'
    case 'proposal_accepted':
      if (input.proposer && input.proposer === input.actor) return `Proposed and accepted ${by}`
      return input.proposer ? `Proposed by ${input.proposer}, accepted ${by}` : `Accepted ${by}`
    case 'item_retired':
      return `Archived ${by}`
    case 'source_rechecked':
      return `Checked ${by}`
    case 'item_restored':
      return `Restored from the Bin ${by}`
    case 'area_deleted':
      return `Domain deleted ${by}`
    case 'area_restored':
      return `Domain restored ${by}`
    case 'rollback':
      return `${capitalized(input.actor ?? 'we')} went back to ${input.restores ? `edition ${input.restores}` : 'an earlier edition'}`
    case 'vocabulary_changed':
      return `Accepted ${by}`
    default:
      return `Changed ${by}`
  }
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
const ended = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`)

/**
 * One sentence, built from a template (no model), that says what changed, who did it and why,
 * with no tool words: "\"Norway closure\" changed in Finance. Proposed by Maria Lindqvist,
 * accepted by Jon Abara. Why: Checked against the law." A comparison of two editions says what
 * changed across them: "7 facts in Finance: 1 added, 4 changed, ... Across 10 editions."
 */
export function changeSentence(input: SentenceInput): string {
  const sentences = [ended(whatChanged(input))]
  const who = whoChanged(input)
  if (who) sentences.push(ended(who))
  const why = input.why?.trim()
  if (why && input.reason !== null) sentences.push(ended(`Why: ${why}`))
  if (input.reason === null && input.editions !== undefined)
    sentences.push(ended(`Across ${plural(input.editions, 'edition', 'editions')}`))
  return sentences.join(' ')
}
