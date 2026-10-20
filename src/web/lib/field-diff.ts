import { diffArrays } from 'diff'
import { parseMentions } from '@domain/mentions'
import { ownCaveat } from '@domain/proposal-rules'
import { lastDayFromEnd } from '@/lib/validity-range'

/*
  The review screen's diffs (frame C2, 2; FR-209), pure so the rows, their stories and their
  tests agree: a word diff for text that keeps a mention whole, a chip diff for a scope, and two
  date ranges on one scale. A changed word carries a sign (+ or -) as well as a tint, so colour
  is never the only sign (NFR-111).
*/

export type DiffKind = 'same' | 'added' | 'removed'

/** One run of words, or one mention, on one side of a word diff. */
export type WordPart =
  | { kind: DiffKind; type: 'text'; text: string }
  | { kind: DiffKind; type: 'mention'; label: string; target: string }

type Token = { type: 'text'; text: string } | { type: 'mention'; label: string; target: string }

/** Words, spaces and punctuation as tokens; a mention token `@[words](target)` is one token. */
export function tokenize(markup: string): Token[] {
  return parseMentions(markup).parts.flatMap((part): Token[] =>
    part.kind === 'mention'
      ? [{ type: 'mention', label: part.label, target: part.target }]
      : (part.text.match(/\s+|[\p{L}\p{N}_'’-]+|[^\s\p{L}\p{N}_'’-]/gu) ?? []).map((text) => ({
          type: 'text',
          text,
        })),
  )
}

const sameToken = (a: Token, b: Token) =>
  a.type === b.type &&
  (a.type === 'text'
    ? a.text === (b as typeof a).text
    : a.target === (b as typeof a).target && a.label === (b as typeof a).label)

/** Joins neighbouring text tokens of the same kind, so a changed phrase is one marked run. */
function merge(parts: WordPart[]): WordPart[] {
  const merged: WordPart[] = []
  for (const part of parts) {
    const last = merged.at(-1)
    if (last && last.type === 'text' && part.type === 'text' && last.kind === part.kind)
      merged[merged.length - 1] = { ...last, text: last.text + part.text }
    else merged.push(part)
  }
  return merged
}

/**
 * A space the two sides share, between two changed runs, belongs to both runs: it is split into
 * a removed and an added space, so "and lifted the pause" reads as one marked run on each side
 * and each side still reads back as its own text.
 */
function bridgeSpaces(parts: WordPart[]): WordPart[] {
  return parts.flatMap((part, index): WordPart[] => {
    if (part.kind !== 'same' || part.type !== 'text' || part.text.trim() !== '') return [part]
    const before = parts[index - 1]
    const after = parts[index + 1]
    if (!before || !after || before.kind === 'same' || after.kind === 'same') return [part]
    return [
      { ...part, kind: 'removed' },
      { ...part, kind: 'added' },
    ]
  })
}

/**
 * The words of `before` and `after` with what changed: the unchanged words in order, the removed
 * ones from `before` and the added ones from `after`. Each side reads back as its own text:
 * `side(parts, 'before')` is `before`.
 */
export function wordDiff(before: string, after: string): WordPart[] {
  const changes = diffArrays(tokenize(before), tokenize(after), { comparator: sameToken })
  const parts = changes.flatMap((change) =>
    change.value.map((token): WordPart => ({
      ...token,
      kind: change.added ? 'added' : change.removed ? 'removed' : 'same',
    })),
  )
  return merge(bridgeSpaces(parts))
}

/** One side of a word diff: the old text with its removed words, or the new with its added. */
export function side(parts: readonly WordPart[], which: 'before' | 'after'): WordPart[] {
  const left = which === 'before' ? 'added' : 'removed'
  return merge(parts.filter((part) => part.kind !== left))
}

/** The text a side reads as, mentions as their words. */
export function plainText(parts: readonly WordPart[]): string {
  return parts.map((part) => (part.type === 'text' ? part.text : part.label)).join('')
}

/** Counts of changed words, for a screen reader's summary of a row ("3 words added"). */
export function changedWords(parts: readonly WordPart[]): { added: number; removed: number } {
  const words = (kind: DiffKind) =>
    parts
      .filter((part) => part.kind === kind)
      .reduce(
        (sum, part) =>
          sum + (part.type === 'mention' ? 1 : (part.text.match(/[\p{L}\p{N}]+/gu) ?? []).length),
        0,
      )
  return { added: words('added'), removed: words('removed') }
}

/** A scope chip on one side of a chip diff. */
export type ChipChange = { key: string; kind: DiffKind }

/**
 * The keys of two lists as kept, added and removed, in the order a reader expects: `before`'s
 * order for what stays and goes, then what is new in `after`'s order.
 */
export function chipDiff(
  before: readonly string[],
  after: readonly string[],
): { before: ChipChange[]; after: ChipChange[]; added: number; removed: number } {
  const old = new Set(before)
  const now = new Set(after)
  const left = before.map((key): ChipChange => ({ key, kind: now.has(key) ? 'same' : 'removed' }))
  const right = [
    ...after.filter((key) => old.has(key)).map((key): ChipChange => ({ key, kind: 'same' })),
    ...after.filter((key) => !old.has(key)).map((key): ChipChange => ({ key, kind: 'added' })),
  ]
  return {
    before: left,
    after: right,
    added: right.filter((chip) => chip.kind === 'added').length,
    removed: left.filter((chip) => chip.kind === 'removed').length,
  }
}

type Window = { start: string; end: string | null }

const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / 86_400_000

/** One range drawn on the shared scale: where its bar starts and how wide it is, in percent. */
export type RangeBar = {
  start: string
  /** The last day the range applies, or null for one with no end date. */
  last: string | null
  left: number
  width: number
  /** No end date: the bar fades out at the end of the scale. */
  open: boolean
}

/**
 * Two date ranges on one scale (frame C2, "When it applies"): the scale runs from the earlier
 * start to the later last day, with room after an open end so it reads as going on. The stored
 * end is the day after the last day (NFR-048); the bars and the words use the last day.
 */
export function rangeDiff(
  before: Window | null,
  after: Window,
): { before: RangeBar | null; after: RangeBar; from: string; to: string } {
  const windows = before ? [before, after] : [after]
  const lasts = windows.map((window) => lastDayFromEnd(window.end))
  const firstDay = Math.min(...windows.map((window) => dayNumber(window.start)))
  const closedLasts = lasts.filter((last): last is string => last !== null).map(dayNumber)
  const latestStart = Math.max(...windows.map((window) => dayNumber(window.start)))
  // An open range runs past everything known by a quarter of the span, at least two weeks.
  const known = Math.max(latestStart, ...closedLasts)
  const span = Math.max(known - firstDay, 1)
  const anyOpen = lasts.some((last) => last === null)
  const lastDay = anyOpen ? known + Math.max(Math.round(span / 4), 14) : known
  const total = lastDay - firstDay + 1
  const bar = (window: Window, last: string | null): RangeBar => {
    const start = dayNumber(window.start)
    const end = last === null ? lastDay : dayNumber(last)
    return {
      start: window.start,
      last,
      left: ((start - firstDay) / total) * 100,
      width: (Math.max(end - start + 1, 1) / total) * 100,
      open: last === null,
    }
  }
  const toDate = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10)
  return {
    before: before ? bar(before, lasts[0] ?? null) : null,
    after: bar(after, lasts.at(-1) ?? null),
    from: toDate(firstDay),
    to: toDate(lastDay),
  }
}

// ---- the rows of the field diff ----

/** One value as the diff carries it: whatever the field holds, or null when it is empty. */
type Value = unknown

type ScopeValue = {
  metrics: string[]
  dimensions?: string[]
  dimensionValues: { dimension: string; value: string }[]
}
export type EvidenceValue = { url: string; quote: string; date: string }

const isRecord = (value: Value): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: Value): value is string => typeof value === 'string'

/**
 * A scope as a list of keys (`metric:orders`, `dim:market`, `val:market/norway`), or null.
 * A version from before dimensions with any value has no `dimensions`.
 */
export function scopeKeysOf(value: Value): string[] | null {
  if (!isRecord(value)) return null
  const scope = value as Partial<ScopeValue>
  if (!Array.isArray(scope.metrics) || !Array.isArray(scope.dimensionValues)) return null
  return [
    ...scope.metrics.filter(isString),
    ...(Array.isArray(scope.dimensions) ? scope.dimensions.filter(isString) : []),
    ...scope.dimensionValues.flatMap((row) =>
      isRecord(row) && isString(row.value) ? [row.value] : [],
    ),
  ]
}

export function windowOf(value: Value): Window | null {
  if (!isRecord(value) || !isString(value.start)) return null
  return { start: value.start, end: isString(value.end) ? value.end : null }
}

export function evidenceOf(value: Value): EvidenceValue[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) =>
    isRecord(entry) && isString(entry.quote)
      ? [
          {
            url: isString(entry.url) ? entry.url : '',
            quote: entry.quote,
            date: isString(entry.date) ? entry.date : '',
          },
        ]
      : [],
  )
}

/** Where a field sits on the review screen, in the form's order (frame C2, 2). */
export const diffRowIds = [
  'title',
  'summary',
  'kind',
  'scope',
  'validity',
  'evidence',
  'domain',
  'owner',
  'claim',
  'risk',
  'audience',
  'notToConclude',
  'body',
  'replaces',
  'conflicts',
  'references',
  'marks',
  'status',
] as const
export type DiffRowId = (typeof diffRowIds)[number]

/** The rows' names, the form's words for each field. */
export const diffRowNames: Record<DiffRowId, string> = {
  title: 'Title',
  summary: 'What happened',
  kind: 'Kind',
  scope: 'Where it applies',
  validity: 'When it applies',
  evidence: 'Where this comes from',
  domain: 'Domain',
  owner: 'Owner',
  claim: 'Cause',
  risk: 'Risk level',
  audience: 'Who can see it',
  notToConclude: 'What not to conclude',
  body: 'Longer explanation',
  replaces: 'Replaces',
  conflicts: 'Conflicts with',
  references: 'References',
  marks: 'Source marks',
  status: 'Status',
}

/** The governed fields of each row (src/domain/review.ts, `reviewedFields`). */
const rowFields: Record<DiffRowId, readonly string[]> = {
  title: ['title'],
  summary: ['summary', 'summaryMarkup'],
  kind: ['kind'],
  scope: ['scope'],
  validity: ['validity', 'reviewDate'],
  evidence: ['evidence'],
  domain: ['areaId'],
  owner: ['ownerId'],
  claim: ['claimLevel', 'claimAuthority', 'claimQuote'],
  risk: ['riskLevel'],
  audience: ['audience'],
  notToConclude: ['notToConclude'],
  body: ['body', 'bodyMarkup'],
  replaces: ['replaces'],
  conflicts: ['conflicts'],
  references: ['references'],
  marks: ['changeMarks'],
  status: ['status'],
}

/** One row of the diff: the changed fields it shows, as before and after, by field name. */
export type DiffRow = {
  id: DiffRowId
  before: Record<string, Value>
  after: Record<string, Value>
}

/**
 * The field diff as rows, in the form's order: one row per changed field (the summary and its
 * markup are one row, the dates and the review date one, the cause and its authority one). The
 * title is a row of its own only when the summary did not change with it, since it follows the
 * first sentence. A field the screen does not know still shows, under its own name.
 */
export function diffRows(diff: readonly { field: string; before: Value; after: Value }[]): {
  rows: DiffRow[]
  unknown: { field: string; before: Value; after: Value }[]
} {
  const byField = new Map(diff.map((entry) => [entry.field, entry]))
  const known = new Set(Object.values(rowFields).flat())
  const rows = diffRowIds.flatMap((id): DiffRow[] => {
    const entries = rowFields[id].flatMap((field) => {
      const entry = byField.get(field)
      return entry ? [entry] : []
    })
    if (!entries.length) return []
    if (id === 'title' && rowFields.summary.some((field) => byField.has(field))) return []
    return [
      {
        id,
        before: Object.fromEntries(entries.map((entry) => [entry.field, entry.before])),
        after: Object.fromEntries(entries.map((entry) => [entry.field, entry.after])),
      },
    ]
  })
  return { rows, unknown: diff.filter((entry) => !known.has(entry.field)) }
}

/**
 * The rows a reviewer rarely reads, folded under "Technical details" below the field diff
 * (heed-ux A9): the definitions an item points at and the source marks that record which version
 * of each it was written against.
 */
export const technicalRowIds: readonly DiffRowId[] = ['references', 'marks']

export type SourceMark = {
  /** The definition reference. */
  reference: string
  /** Its source mark, or null when it has none. */
  mark: string | null
  /** Against the live version: new, gone, a new mark, or the same. */
  change: 'same' | 'added' | 'removed' | 'changed'
}

/** One side's references with their marks: every reference and every marked key, once. */
function marksOf(values: Record<string, Value>): Map<string, string | null> {
  const references = Array.isArray(values.references) ? values.references.filter(isString) : []
  const marks = isRecord(values.changeMarks) ? values.changeMarks : {}
  const keys = [...new Set([...references, ...Object.keys(marks)])]
  return new Map(keys.map((key) => [key, isString(marks[key]) ? marks[key] : null]))
}

/**
 * The technical rows as one list, a reference and its source mark per line, in the proposed
 * order and then what the proposal removes. A new item (`change` false) has nothing to compare
 * with, so every line is the same.
 */
export function sourceMarks(rows: readonly DiffRow[], change: boolean): SourceMark[] {
  const technical = rows.filter((row) => technicalRowIds.includes(row.id))
  const side = (which: 'before' | 'after') =>
    marksOf(Object.assign({}, ...technical.map((row) => row[which])) as Record<string, Value>)
  const after = side('after')
  const before = change ? side('before') : after
  const kept: SourceMark[] = [...after].map(([reference, mark]) => ({
    reference,
    mark,
    change: !before.has(reference) ? 'added' : before.get(reference) !== mark ? 'changed' : 'same',
  }))
  const removed: SourceMark[] = [...before]
    .filter(([reference]) => !after.has(reference))
    .map(([reference, mark]) => ({ reference, mark, change: 'removed' }))
  return [...kept, ...removed]
}

/** A value that says nothing: missing, null, blank text, an empty list or an empty record. */
function emptyValue(value: Value): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  if (isRecord(value)) return Object.values(value).every((entry) => emptyValue(entry))
  return false
}

/**
 * Whether one side of a row holds nothing, so a new item's diff leaves the row out instead of
 * showing "Not filled in" for every field the proposer did not use.
 */
export function emptySide(row: DiffRow, which: 'before' | 'after'): boolean {
  // The stored default of what not to conclude is no line of the proposer's own (FR-104).
  if (row.id === 'notToConclude') {
    const value = row[which].notToConclude
    return !isString(value) || ownCaveat(value) === null
  }
  return Object.values(row[which]).every((value) => emptyValue(value))
}

/** The fields a change leaves alone, by their row names, for the folded line. */
export function unchangedRowNames(diff: readonly { field: string }[]): string[] {
  const changed = new Set(diff.map((entry) => entry.field))
  const shown: DiffRowId[] = [
    'title',
    'kind',
    'scope',
    'validity',
    'evidence',
    'domain',
    'owner',
    'claim',
    'risk',
    'audience',
  ]
  return shown
    .filter((id) => !rowFields[id].some((field) => changed.has(field)))
    .map((id) => diffRowNames[id].toLowerCase())
}

/** Text of a row's side: the markup when there is one, the plain text otherwise. */
export function textOf(values: Record<string, Value>, markup: string, plain: string): string {
  const value = values[markup] ?? values[plain]
  return isString(value) ? value : ''
}
