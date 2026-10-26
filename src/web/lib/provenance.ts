import { fieldWords as attributeWords, markedFields } from '@domain/proposal-attributes'
import type {
  ExternalSource,
  FieldMark,
  MarkedField,
  Provenance,
  ProvenanceFlag,
} from '@domain/provenance'
import { plainName } from '@domain/words-v1'
import { formatDay } from './library'

/*
  The words for the checks a draft asks of the person (FR-121, FR-707): which fields to look at
  before sending, what a flag says, and the outside source of a piece of evidence. The stored
  provenance still records who wrote each field; nothing here shows it as authorship.
*/

/**
 * The field names a person reads, for the list of fields to check: the attribute table's words
 * with the glossary's name where it has one ("check date" for "review date"). The MCP keeps
 * the table's own words.
 */
const fieldWords = Object.fromEntries(
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
 * Evidence copied from a web page Heed read, in words: an external source nobody has reviewed,
 * and, when the sentence was not on the page Heed read, a warning. A warning only: the person
 * may still submit and the owner decides (the owner opening the link is the check).
 */
export function externalWords(source: ExternalSource, where: 'editor' | 'review') {
  const site = siteOf(source.url)
  const read = `We read ${site} on ${formatDay(source.readOn)}`
  return {
    label: 'Outside source, not checked yet',
    sentence:
      where === 'editor'
        ? `${read} and the sentence was copied from it. Open the link and check the sentence before you send it.`
        : `${read} for the proposer. Open the link and check the sentence before you accept.`,
    warning: source.quoteFound
      ? null
      : {
          label: 'Sentence not found on the page',
          sentence: `We didn't find the quoted sentence word for word on the page from ${site}. Check it against the page.`,
        },
  }
}
