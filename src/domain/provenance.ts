import * as z from 'zod/mini'
import { canonicalJson } from './canonical.ts'
import type { Draft } from './draft.ts'
import {
  fieldMarks,
  limits,
  markedFields,
  toolInputLimits,
  type FieldMark,
  type MarkedField,
} from './proposal-rules.ts'
import { calendarDateSchema } from './validity.ts'

/*
  Where each field of a draft that an agent or the assistant wrote came from (FR-121, FR-707).
  A mark tells the person what to check before they submit, and the owner where the words came
  from: never a confidence number, only how the value was found. A field the person changes
  loses its mark: from then on it is their own. The marks and the fields that carry one are the
  provenance table of src/domain/proposal-attributes.ts.
*/

export { fieldMarks, markedFields, type FieldMark, type MarkedField }

/**
 * `may_be_high_risk`: the words suggest a legal, regulatory or financial-reporting matter; the
 * risk level stays at its default and the owner decides (FR-106). `instruction_like_text`:
 * the words read like orders to a language model. `uncertain_dates`: the person was unsure of
 * the dates, or gave none, and the writer drafted with its best guess; it stays while the dates
 * do, and goes once someone changes them. All are shown, never acted on.
 */
export const provenanceFlagCodes = [
  'may_be_high_risk',
  'instruction_like_text',
  'uncertain_dates',
] as const
export type ProvenanceFlagCode = (typeof provenanceFlagCodes)[number]

const flagSchema = z.strictObject({
  code: z.enum(provenanceFlagCodes),
  field: z.enum(markedFields),
  words: z.array(z.string().check(z.maxLength(60))).check(z.maxLength(10)),
})
export type ProvenanceFlag = z.infer<typeof flagSchema>

/**
 * An evidence entry the assistant took from a public web page Heed read for the person: an
 * external source nobody has reviewed yet. `quoteFound` is the automatic quote match against the
 * text Heed read on `readOn`: when false the person and the owner are warned, never stopped.
 * Heed sets it from what it read, never from what a model says.
 */
const externalSchema = z.strictObject({
  url: z.string().check(z.maxLength(limits.url)),
  quote: z.string().check(z.maxLength(limits.quote)),
  readOn: calendarDateSchema,
  quoteFound: z.boolean(),
})
export type ExternalSource = z.infer<typeof externalSchema>

export const provenanceSchema = z.strictObject({
  /**
   * Who wrote the draft: an AI agent over MCP or the built-in assistant, for the person; or a
   * content source's read, from a document, for nobody (CON-603).
   */
  by: z.enum(['agent', 'assistant', 'source']),
  fields: z.partialRecord(z.enum(markedFields), z.enum(fieldMarks)),
  flags: z.array(flagSchema).check(z.maxLength(20)),
  /** The evidence entries taken from web pages Heed read; absent when there are none. */
  external: z.optional(z.array(externalSchema).check(z.maxLength(toolInputLimits.evidence))),
})
export type Provenance = z.infer<typeof provenanceSchema>

const sameEntry = (entry: { url?: string; quote?: string }, source: ExternalSource) =>
  entry.url === source.url && entry.quote === source.quote

/** The external sources that still stand for an evidence entry of the draft, as they are. */
function externalOf(draft: Draft, external: readonly ExternalSource[] | undefined) {
  const kept = (external ?? []).filter((source) =>
    (draft.evidence ?? []).some((entry) => sameEntry(entry, source)),
  )
  return kept.length ? { external: kept } : {}
}

/** A marked field's value in a draft; the summary and the body read their markup first. */
export function fieldValue(draft: Draft, field: MarkedField): unknown {
  if (field === 'summary') return draft.summaryMarkup ?? draft.summary
  if (field === 'body') return draft.bodyMarkup ?? draft.body
  return draft[field]
}

const same = (a: unknown, b: unknown) =>
  canonicalJson(a === undefined ? null : a) === canonicalJson(b === undefined ? null : b)

/** The flag of dates the person was unsure of, which no words show. */
const uncertainDates: ProvenanceFlag = { code: 'uncertain_dates', field: 'validity', words: [] }

/**
 * The marks after the person saved `after` over `before`: a field they changed is theirs and
 * loses its mark, and the flags are worked out again from the words as they are now. Uncertain
 * dates stay flagged until someone changes the dates.
 */
export function keepMarks(provenance: Provenance, before: Draft, after: Draft): Provenance {
  const fields: Provenance['fields'] = {}
  for (const field of markedFields) {
    const mark = provenance.fields[field]
    if (mark && same(fieldValue(before, field), fieldValue(after, field))) fields[field] = mark
  }
  const uncertain =
    provenance.flags.some((flag) => flag.code === 'uncertain_dates') &&
    same(before.validity, after.validity)
  // An entry the person changed is theirs: it no longer stands for the page Heed read.
  return {
    by: provenance.by,
    fields,
    flags: [...provenanceFlags(after), ...(uncertain ? [uncertainDates] : [])],
    ...externalOf(after, provenance.external),
  }
}

/**
 * The provenance of a saved draft: the marks of the fields it holds, the flags of its words, the
 * evidence entries taken from web pages Heed read, and whether the person was unsure of the
 * dates (flagged only when the draft has dates to check).
 */
export function provenanceOf(
  by: Provenance['by'],
  marks: Partial<Record<MarkedField, FieldMark>>,
  draft: Draft,
  external?: readonly ExternalSource[],
  datesUncertain = false,
): Provenance {
  const fields: Provenance['fields'] = {}
  for (const field of markedFields) {
    const mark = marks[field]
    const value = fieldValue(draft, field)
    const empty =
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && !value.length) ||
      (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length)
    // An empty list still marks a field people decide (replaces, conflicts).
    if (mark && (!empty || mark === 'not_inferred')) fields[field] = mark
  }
  const uncertain = datesUncertain && draft.validity !== undefined
  return {
    by,
    fields,
    flags: [...provenanceFlags(draft), ...(uncertain ? [uncertainDates] : [])],
    ...externalOf(draft, external),
  }
}

/**
 * A word list in Portuguese or Spanish, matched as whole words: `\\b` reads only ASCII letters, so
 * an accented letter at either end would break it.
 */
const words = (list: string) =>
  new RegExp(`(?<![\\p{L}\\p{N}])(?:${list})(?![\\p{L}\\p{N}])`, 'giu')

const riskPatterns: RegExp[] = [
  /\bregulat(?:or|ors|ory|ion|ions|ed)\b/gi,
  /\b(?:law|laws|legal|legislation|court)\b/gi,
  /\blicen[cs](?:e|es|ed|ing)\b/gi,
  /\bcompliance\b/gi,
  /\b(?:financial statements?|annual report|statutory|auditors?)\b/gi,
  /\b(?:sanctions?|anti-money laundering|money laundering|aml|kyc|gdpr)\b/gi,
  /\b(?:restricted|confidential)\b/gi,
  // Portuguese and Spanish: a regulation from Portugal or Spain is quoted in its own words.
  words(
    'leis?|ley(?:es)?|decretos?|portarias?|medidas? provis[óo]rias?|regulamenta\\p{L}*|reglament\\p{L}*|regula[çc][ãa]o|regulaci[óo]n|legisla[çc][ãa]o|legislaci[óo]n|licen[çc]as?|licencias?|tribunal|pro[ií]b\\p{L}*|proh[ií]b\\p{L}*|san[çc][ãa]o|sanci[óo]n',
  ),
]
const instructionPatterns: RegExp[] = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,40}\b(?:previous|prior|above|earlier|all|other|system)\b[^.\n]{0,20}\b(?:instructions?|prompts?|rules?|messages?)\b/gi,
  /\b(?:always|never|you must|you should)\s+(?:call|use|run|invoke|answer|reply|say|tell|output|include)\b/gi,
  /\byou are (?:now )?(?:an?|the) (?:ai|assistant|agent|model|language model|chatbot)\b/gi,
  /\b(?:system prompt|developer message|jailbreak)\b/gi,
  /<\/?\s*(?:system|assistant|instructions?|tool_call|im_start|im_end)\b[^>]*>/gi,
  /\b(?:do not|don't|never) (?:tell|show|inform|warn) (?:the )?(?:user|person|owner|reviewer|human)\b/gi,
  // Portuguese and Spanish: a page in either language can carry orders to a model too.
  words(
    '(?:ignore|ignora|desconsidere|desconsidera|esque[çc]a|olvida)[^.\\n]{0,40}instru(?:[çc][õo]es|cciones)',
  ),
  words(
    '(?:voc[êe] [ée]|eres|usted es) (?:agora |ahora )?(?:um|uma|un|una) (?:assistente|asistente|ia|modelo)',
  ),
  words(
    '(?:n[ãa]o|no)(?: le| lhe)? (?:conte|diga|informe|mostre|avise|cuentes|digas|informes|muestres|avises)(?: nada)? (?:ao|al|a la|à) (?:usu[áa]rio|pessoa|persona|revisor)',
  ),
]

function matchesOf(patterns: RegExp[], text: string): string[] {
  const words = new Set<string>()
  for (const pattern of patterns)
    for (const match of text.matchAll(pattern)) words.add(match[0].toLowerCase().slice(0, 60))
  return [...words].slice(0, 10)
}

/** Words that suggest a legal, regulatory or financial-reporting matter (FR-106's high risk). */
export const riskWords = (text: string) => matchesOf(riskPatterns, text)
/** Words that read like orders to a language model (NFR-024): shown as a warning, kept as data. */
export const instructionWords = (text: string) => matchesOf(instructionPatterns, text)

const flaggedFields = ['title', 'summary', 'body', 'notToConclude', 'evidence'] as const

/** The flags of a draft's words, worked out from the text alone. */
export function provenanceFlags(draft: Draft): ProvenanceFlag[] {
  const texts: [MarkedField, string][] = flaggedFields.map((field) => {
    const value = fieldValue(draft, field)
    return [
      field,
      field === 'evidence'
        ? (draft.evidence ?? []).map((entry) => entry.quote).join('\n')
        : typeof value === 'string'
          ? value
          : '',
    ]
  })
  const flags: ProvenanceFlag[] = []
  const risk = [...new Set(texts.flatMap(([, text]) => riskWords(text)))].slice(0, 10)
  if (risk.length) flags.push({ code: 'may_be_high_risk', field: 'riskLevel', words: risk })
  for (const [field, text] of texts) {
    const words = instructionWords(text)
    if (words.length) flags.push({ code: 'instruction_like_text', field, words })
  }
  return flags
}

/**
 * Invisible characters an agent's text may carry (zero-width and direction marks, tag
 * characters, soft hyphens): removed, as they can hide words from the person and the owner.
 */
export function withoutInvisible(text: string): string {
  return text
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, '')
    .replace(/[\u{E0000}-\u{E007F}]/gu, '')
    .replace(/\r\n?/g, '\n')
}
