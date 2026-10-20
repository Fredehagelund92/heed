/**
 * Item files: what `heed import` and the import API read (FR-120). A file is a list of items, or
 * an object with an `items` list, so an edition export (src/domain/edition-export.ts) reads back
 * as an import. Each entry is a draft in the item format, with an optional `id` that makes it a
 * change to that accepted item. Mentions are `@[words](target)` tokens in `summaryMarkup` and
 * `bodyMarkup`, as on the write path.
 */
import * as z from 'zod/mini'
import { type Draft, draftSchema, type FormatFinding, textFindings } from './draft.ts'
import { mentionSchema, mentionsInFields, parseMentions } from './mentions.ts'

/** The most entries one file may hold: a whole exported edition reads back in one import. */
export const ITEM_FILE_MAX_ENTRIES = 5_000
/**
 * The most proposals one import makes. Each runs the review checks at submit in the same
 * transaction, so a larger change goes in several files; unchanged entries do not count.
 */
export const ITEM_IMPORT_MAX_PROPOSALS = 500
/** The longest file, in characters (an exported item takes about 1,500). */
export const ITEM_FILE_MAX_LENGTH = 16_000_000

/**
 * What an edition export adds to each item. An import reads past them: the service records who
 * imports and through which channel, numbers the version and computes its digest.
 */
const exportOnlyKeys = ['version', 'digest', 'proposerId', 'createdVia'] as const

const itemIdSchema = z.string().check(z.regex(/^itm_[a-z0-9]{8,16}$/))
const mentionRowsSchema = z.array(mentionSchema)

export type ItemFileEntry = {
  /** Position in the file, from zero. */
  index: number
  /** The accepted item this entry changes; null creates a new item. */
  itemId: string | null
  /** The draft, or null when the entry is not one. */
  draft: Draft | null
  findings: FormatFinding[]
}
export type ItemFile = { entries: ItemFileEntry[]; error: string | null }

const finding = (code: string, field: string, message: string): FormatFinding => ({
  code,
  field,
  message,
  severity: 'error',
})

function readEntry(value: unknown, index: number): ItemFileEntry {
  const entry: ItemFileEntry = { index, itemId: null, draft: null, findings: [] }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    entry.findings.push(finding('format', '', 'Expected an item'))
    return entry
  }
  const { id, mentions, ...rest } = value as Record<string, unknown>
  for (const key of exportOnlyKeys) delete rest[key]
  if (id !== undefined) {
    if (itemIdSchema.safeParse(id).success) entry.itemId = id as string
    else
      entry.findings.push(
        finding('format', 'id', 'An item id looks like itm_ and 8 to 16 letters or digits'),
      )
  }
  const parsed = draftSchema.safeParse(rest)
  if (!parsed.success) {
    entry.findings.push(
      ...parsed.error.issues.map((issue) => finding('format', issue.path.join('.'), issue.message)),
    )
    return entry
  }
  const draft = parsed.data
  for (const field of ['summary', 'body'] as const) {
    const markup = field === 'summary' ? draft.summaryMarkup : draft.bodyMarkup
    if (markup === undefined || draft[field] === undefined) continue
    const plain = parseMentions(markup)
    if (!plain.errors.length && plain.text !== draft[field])
      entry.findings.push(
        finding('mention_text', field, `The ${field} must equal the text of its mention markup`),
      )
  }
  // An export lists the mention rows the markup gives; an edited file must keep them in step.
  if (mentions !== undefined) {
    const rows = mentionRowsSchema.safeParse(mentions)
    const derived = mentionsInFields(draft)
    if (
      !rows.success ||
      rows.data.length !== derived.length ||
      rows.data.some(
        (row, i) =>
          row.field !== derived[i]!.field ||
          row.position !== derived[i]!.position ||
          row.target !== derived[i]!.target ||
          row.label !== derived[i]!.label,
      )
    )
      entry.findings.push(
        finding('mention_rows', 'mentions', 'The mentions must match the markup in field order'),
      )
  }
  entry.draft = draft
  return entry
}

/** Reads a parsed YAML or JSON document. Nothing here needs the service. */
export function readItemFile(document: unknown): ItemFile {
  const list = Array.isArray(document)
    ? document
    : document &&
        typeof document === 'object' &&
        Array.isArray((document as { items?: unknown }).items)
      ? (document as { items: unknown[] }).items
      : null
  if (!list)
    return { entries: [], error: 'Expected a list of items, or an object with an items list' }
  if (!list.length) return { entries: [], error: 'The file has no items' }
  if (list.length > ITEM_FILE_MAX_ENTRIES)
    return { entries: [], error: `A file may hold at most ${ITEM_FILE_MAX_ENTRIES} items` }
  return { entries: list.map(readEntry), error: null }
}

/**
 * The checks an entry passes without the service: the file checks above, text that looks
 * sensitive, mention syntax, where mentions may appear and their limit. Scope, vocabulary,
 * mention targets, the area and the owner need the live edition: the import dry run checks them.
 */
export function offlineFindings(entry: ItemFileEntry): FormatFinding[] {
  const findings = [...entry.findings]
  const draft = entry.draft
  if (!draft) return findings
  findings.push(...textFindings(draft))
  for (const field of ['summary', 'body'] as const) {
    const markup = field === 'summary' ? draft.summaryMarkup : draft.bodyMarkup
    if (markup !== undefined && parseMentions(markup).errors.length)
      findings.push(finding('mention_syntax', field, 'Invalid mention syntax'))
  }
  const plainFields = {
    title: draft.title,
    notToConclude: draft.notToConclude,
    claimAuthority: draft.claimAuthority,
    claimQuote: draft.claimQuote,
  }
  for (const [field, text] of Object.entries(plainFields))
    if (text !== undefined && parseMentions(text).mentions.length)
      findings.push(
        finding('mention_field', field, 'Mentions are only allowed in summary and body'),
      )
  if (mentionsInFields(draft).length > 50)
    findings.push(finding('mention_limit', 'summaryMarkup', 'At most 50 mentions are allowed'))
  return findings
}
