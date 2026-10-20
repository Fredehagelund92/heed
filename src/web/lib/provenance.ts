import { fieldWords as attributeWords, markedFields } from '@domain/proposal-attributes'
import type {
  ExternalSource,
  FieldMark,
  MarkedField,
  Provenance,
  ProvenanceFlag,
} from '@domain/provenance'
import { plainName } from '@domain/words'
import { formatDay } from './library'

/*
  The words for where a field of a draft came from, when an AI app or the assistant wrote it for
  the person (FR-121, FR-707). In the draft editor a mark asks the person to check the field; on
  the review screen it tells the owner where the words came from. Never a confidence number.
  The words say "AI app" for the program over MCP, as the help pages do (glossary, "AI app"):
  the provenance records only that an AI app or the assistant wrote a field, never which app.
*/

/** Who wrote the draft, as a phrase: "an AI app", "the assistant". */
export const writerOf = (by: Provenance['by']) => (by === 'agent' ? 'an AI app' : 'the assistant')

/** The writer as the subject of a sentence after the draft is named: "The AI app", "The assistant". */
const writerShort = (by: Provenance['by']) => (by === 'agent' ? 'The AI app' : 'The assistant')

/** The short label of a mark. `where` is the person's editor or the owner's review. */
export function markLabel(mark: FieldMark, by: Provenance['by'], where: 'editor' | 'review') {
  if (mark === 'prefilled')
    return where === 'editor' ? 'Suggested' : by === 'agent' ? 'AI app wrote' : 'Assistant wrote'
  return {
    derived: 'Derived',
    default: 'Default',
    confirmed: 'Confirmed',
    not_inferred: 'Left for people',
  }[mark]
}

/** What a mark means, in one sentence. */
export function markMeaning(mark: FieldMark, by: Provenance['by'], where: 'editor' | 'review') {
  const writer = writerOf(by)
  switch (mark) {
    case 'prefilled':
      return where === 'editor'
        ? `Suggested by ${writer}. Check it before you send it.`
        : `Written by ${writer} for the proposer, who sent it.`
    case 'confirmed':
      if (by === 'assistant')
        return where === 'editor'
          ? 'You answered this when the assistant asked.'
          : 'Confirmed by the proposer when the assistant asked.'
      return where === 'editor'
        ? 'You answered this in your AI app, when it asked.'
        : 'Confirmed by the proposer in their AI app, when it asked.'
    case 'derived':
      return 'We worked it out from the names we know and the domain.'
    case 'default':
      return 'The usual default. An owner can change it.'
    case 'not_inferred':
      return 'We never fill this from what an AI app says. People decide it.'
  }
}

/** How many of the fields shown carry each kind of mark, for the one summary line. */
export type MarkCounts = { wrote: number; confirmed: number; filled: number; left: number }

/** The counts of a list of marks: written, confirmed, filled in automatically, left for people. */
export function countMarks(marks: readonly FieldMark[]): MarkCounts {
  const counts: MarkCounts = { wrote: 0, confirmed: 0, filled: 0, left: 0 }
  for (const mark of marks) {
    if (mark === 'prefilled') counts.wrote += 1
    else if (mark === 'confirmed') counts.confirmed += 1
    else if (mark === 'not_inferred') counts.left += 1
    else counts.filled += 1
  }
  return counts
}

const fieldCount = (count: number) => `${count} ${count === 1 ? 'field' : 'fields'}`

/**
 * The summary line of a drafted proposal (contract 6.13, "Field provenance"): who proposed it,
 * with what, and what each one wrote. `proposer` is the proposer's name, or null when the reader
 * is the proposer ("you"). "Priya Nair drafted this with an AI app and sent it." and "The AI
 * app wrote 5 fields, Priya confirmed 2 and 4 were filled in automatically.""
 */
export function attributionWords({
  provenance,
  proposer,
  counts,
  submitted,
}: {
  provenance: Provenance
  proposer: string | null
  counts: MarkCounts
  submitted: boolean
}) {
  const writer = writerOf(provenance.by)
  const pages = provenance.external?.length ?? 0
  const read = provenance.external?.[0]?.readOn
  const from = pages
    ? pages === 1 && read
      ? `, from a page it read on ${formatDay(read)}`
      : `, from ${pages} pages it read`
    : ''
  const who = proposer ?? 'You'
  const lead = `${who} drafted this with ${writer}${from}${submitted ? ' and sent it' : ''}.`
  const first = proposer ? (proposer.split(' ')[0] ?? proposer) : 'you'
  const parts = [
    counts.wrote ? `${writerShort(provenance.by)} wrote ${fieldCount(counts.wrote)}` : null,
    counts.confirmed
      ? `${counts.wrote ? first : first.charAt(0).toUpperCase() + first.slice(1)} confirmed ${counts.confirmed} when it asked`
      : null,
    counts.filled
      ? `${counts.filled} ${counts.filled === 1 ? 'was' : 'were'} filled in automatically`
      : null,
    counts.left ? `${counts.left} left for people` : null,
  ].filter((part): part is string => part !== null)
  const joined =
    parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]
  const tally = joined ? `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.` : ''
  return { lead, tally }
}

/**
 * The field names a person reads, for the list of fields to check: the attribute table's words
 * with the glossary's name where it has one ("check date" for "review date"). The MCP keeps
 * the table's own words.
 */
export const fieldWords = Object.fromEntries(
  markedFields.map((field) => [field, plainName(attributeWords[field]) ?? attributeWords[field]]),
) as Record<MarkedField, string>

/** The fields with one mark, in the form's order. */
export function fieldsMarked(provenance: Provenance, mark: FieldMark): MarkedField[] {
  return markedFields.filter((field) => provenance.fields[field] === mark)
}

/** "kind, title and summary". */
export function listWords(fields: readonly MarkedField[]): string {
  const words = fields.map((field) => fieldWords[field])
  return words.length > 1
    ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`
    : (words[0] ?? '')
}

/** A flag as a short label and a sentence, naming the words that raised it. */
export function flagWords(flag: ProvenanceFlag) {
  const quoted = flag.words.map((word) => `"${word}"`).join(', ')
  switch (flag.code) {
    case 'may_be_high_risk':
      return {
        label: 'May be high risk',
        sentence: `It mentions ${quoted}. The risk level stays at its default. Only an owner raises it.`,
      }
    case 'instruction_like_text':
      return {
        label: 'Reads like orders to an AI',
        sentence: `It contains ${quoted}. We keep these words as text and never follow them.`,
      }
    case 'uncertain_dates':
      return {
        label: 'Dates uncertain',
        sentence:
          'The dates were a best guess when this was drafted. Check them against the source.',
      }
  }
}

/** A link's site, as a person reads it: "consumer.example". */
export const siteOf = (url: string) => URL.parse(url)?.hostname ?? url

/**
 * Evidence the assistant took from a web page Heed read, in words: an external source nobody has
 * reviewed, and, when the sentence was not on the page Heed read, a warning. A warning only: the
 * person may still submit and the owner decides (the owner opening the link is the check).
 */
export function externalWords(
  source: ExternalSource,
  by: Provenance['by'],
  where: 'editor' | 'review',
) {
  const site = siteOf(source.url)
  const writer = writerOf(by)
  const read = `${writer.charAt(0).toUpperCase() + writer.slice(1)} read ${site} on ${formatDay(source.readOn)}`
  return {
    label: 'Outside source, not checked yet',
    sentence:
      where === 'editor'
        ? `${read} and copied the sentence from it. Open the link and check the sentence before you send it.`
        : `${read} for the proposer. Open the link and check the sentence before you accept.`,
    warning: source.quoteFound
      ? null
      : {
          label: 'Sentence not found on the page',
          sentence: `We didn't find the quoted sentence word for word on the page from ${site}. Check it against the page.`,
        },
  }
}
