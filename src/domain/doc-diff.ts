/*
  The review's difference of a suggestion (FR-224): what changes between the version agents get
  now and the suggested one, told apart by kind, the same way every time. No model decides it.

  A context item is read as one document: its text (the summary, then the body, in the Markdown
  the editor writes, with `@[words](target)` mentions) and the fields around it (title, kind,
  where, when, the check date, its sources and what not to conclude). The text is parsed into
  blocks (paragraphs, headings, quotes, list items), and blocks are compared before words:

  - a block with the same words in another place is a change of Order;
  - the same words with other marks (bold, italic, a list's numbers) are Formatting;
  - a link's address, a link added or removed, or a mention added or removed is a Link;
  - changed words inside a block are Wording, and a block with no partner is Added or Removed;
  - when it applies, and the check date, are Dates.

  `sourceDiff` is the Source view: the stored Markdown line by line, removed lines before added
  ones, and inside a changed line only the words that differ (J19).

  Long inputs stay cheap: a comparison works on what lies between the common start and end, and
  past `LCS_CELLS` it gives the middle as one removed and one added run instead of a word diff.
  Pure: no clock, no input or output.
*/
import { shiftDate } from './validity.ts'

/** The kinds of change, in the order the review counts them. */
export const changeKinds = [
  'wording',
  'formatting',
  'link',
  'order',
  'added',
  'removed',
  'dates',
] as const
export type ChangeKind = (typeof changeKinds)[number]

/** The parts of a context item the review compares, in the order it shows them. */
export const docFields = [
  'title',
  'text',
  'kind',
  'where',
  'when',
  'checkDate',
  'sources',
  'notToConclude',
] as const
export type DocField = (typeof docFields)[number]

/** One source of a context item: its address, and the sentence copied from it. */
export type DocSource = { url: string; quote: string | null }

/** One side of the comparison: a version of a context item as the review reads it. */
export type DocSide = {
  kind: string
  title: string
  /** The summary, with its mention markup. */
  summary: string
  /** The body in Markdown, with its mention markup, or null. */
  body: string | null
  /** What it applies to, as names (metrics, then values), in a fixed order. */
  where: readonly string[]
  validFrom: string
  /** The first day it no longer applies, or null while it is still going on. */
  validUntil: string | null
  reviewDate: string | null
  sources: readonly DocSource[]
  notToConclude: string
}

/** A run of text in a change: unchanged, added, removed, or the same words with other marks. */
export type Run =
  | { t: 'same' | 'add' | 'del'; text: string }
  | { t: 'fmt'; text: string; added: Mark[]; removed: Mark[] }

/** The marks inline text can carry. */
export const marks = ['bold', 'italic', 'strike', 'code'] as const
export type Mark = (typeof marks)[number]

/** The shape of a block of text. */
export type BlockShape =
  | { type: 'paragraph' | 'quote' | 'rule' }
  | { type: 'heading'; level: number }
  | { type: 'bullet' | 'number'; depth: number }

/** A text field the review diffs word by word. */
export type TextField = 'title' | 'text' | 'notToConclude' | 'quote'

/** What changed in a formatting block. */
export type FormatChange =
  | { what: 'marks'; added: Mark[]; removed: Mark[] }
  | { what: 'list'; was: 'bullet' | 'number'; now: 'bullet' | 'number' }
  | { what: 'block'; was: BlockShape; now: BlockShape }

/** One change, under the kind label the review shows it with. */
export type ChangeBlock =
  | {
      kind: 'wording'
      field: TextField
      runs: Run[]
      /** How many separate stretches of words changed. */
      changes: number
      /** Most of the words changed: the review shows the two sides next to each other. */
      rewrite: boolean
    }
  | { kind: 'wording'; field: 'kind'; before: string; after: string }
  | { kind: 'added' | 'removed'; field: TextField; text: string }
  | { kind: 'added' | 'removed'; field: 'where'; parts: string[] }
  | { kind: 'added'; field: 'when'; from: string; until: string | null }
  | { kind: 'added' | 'removed'; field: 'sources'; url: string; quote: string | null }
  | { kind: 'formatting'; field: 'text'; change: FormatChange; runs: Run[] }
  | { kind: 'formatting'; field: 'text'; change: FormatChange & { what: 'list' }; items: string[] }
  | {
      kind: 'link'
      field: 'text' | 'sources'
      /** The words of the link, or the copied sentence of a source. */
      text: string
      before: string | null
      after: string | null
    }
  | {
      kind: 'link'
      field: 'text'
      mention: { target: string; label: string; change: 'added' | 'removed' }
    }
  | {
      kind: 'order'
      field: 'text'
      /** The blocks in their new order; a moved one says where it was (1 is the first). */
      steps: { text: string; from: number | null }[]
      moved: number
    }
  | {
      kind: 'dates'
      field: 'when' | 'checkDate'
      before: { from: string | null; until: string | null }
      after: { from: string | null; until: string | null }
    }

/** A number, a date or a source address that moved, pulled out of the change. */
export type ValueChange = {
  what: 'number' | 'date' | 'source'
  field: DocField | 'quote'
  before: string | null
  after: string | null
}

/** The whole difference of one suggestion. */
export type DocDiff = {
  mode: 'new' | 'edit' | 'retire'
  blocks: ChangeBlock[]
  /** How many changes of each kind, in the order of `changeKinds`, only kinds that occur. */
  counts: { kind: ChangeKind; n: number }[]
  /** The fields an edit leaves as they were. */
  unchanged: DocField[]
  values: ValueChange[]
  /** The one kind every change is of, or null when there are several (or none). */
  only: ChangeKind | null
}

/** A comparison of more pairs than this gives its middle as one removed and one added run. */
export const LCS_CELLS = 1_000_000
/** A block pair with at least this many changed stretches, or most words changed, is a rewrite. */
export const REWRITE_CHANGES = 4
/** Two blocks share at least this much of their words to count as one block reworded. */
const PAIR_SIMILARITY = 0.4

/* Comparing two sequences */

type Op = { op: 'same'; a: number; b: number } | { op: 'del'; a: number } | { op: 'add'; b: number }

/**
 * The steps that turn `a` into `b`, keeping the longest common subsequence. Where both a removal
 * and an addition keep it as long, the removal comes first, so a changed line reads as what went,
 * then what came. `prefer: 'add'` takes the addition first instead, so of two blocks that swapped
 * places the one that moved up is the one that moved.
 */
export function sequenceDiff<T>(
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
  prefer: 'del' | 'add' = 'del',
): Op[] {
  let start = 0
  while (start < a.length && start < b.length && same(a[start]!, b[start]!)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && same(a[endA - 1]!, b[endB - 1]!)) {
    endA--
    endB--
  }
  const ops: Op[] = []
  for (let i = 0; i < start; i++) ops.push({ op: 'same', a: i, b: i })
  const n = endA - start
  const m = endB - start
  if (n > 0 && m > 0 && (n + 1) * (m + 1) <= LCS_CELLS) {
    const width = m + 1
    const dp = new Uint32Array((n + 1) * width)
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * width + j] = same(a[start + i]!, b[start + j]!)
          ? dp[(i + 1) * width + j + 1]! + 1
          : Math.max(dp[(i + 1) * width + j]!, dp[i * width + j + 1]!)
    let i = 0
    let j = 0
    while (i < n || j < m) {
      if (i < n && j < m && same(a[start + i]!, b[start + j]!)) {
        ops.push({ op: 'same', a: start + i++, b: start + j++ })
      } else if (
        i < n &&
        (j === m ||
          (prefer === 'del'
            ? dp[(i + 1) * width + j]! >= dp[i * width + j + 1]!
            : dp[(i + 1) * width + j]! > dp[i * width + j + 1]!))
      ) {
        ops.push({ op: 'del', a: start + i++ })
      } else ops.push({ op: 'add', b: start + j++ })
    }
  } else {
    for (let i = start; i < endA; i++) ops.push({ op: 'del', a: i })
    for (let j = start; j < endB; j++) ops.push({ op: 'add', b: j })
  }
  for (let k = 0; k < a.length - endA; k++) ops.push({ op: 'same', a: endA + k, b: endB + k })
  return slideDown(ops, a, b, same)
}

/**
 * Moves each run of only additions (or only removals) as late as it can go, past an unchanged
 * element equal to its first one. Taking the common end off first can match an element early that
 * a whole comparison matches late; this puts the change where the whole comparison does, so
 * "webshop. From 1 October ... as well." marks " From ... as well." and keeps the full stop.
 */
function slideDown<T>(
  ops: Op[],
  a: readonly T[],
  b: readonly T[],
  same: (x: T, y: T) => boolean,
): Op[] {
  const out = [...ops]
  for (let i = 0; i < out.length; i++) {
    const kind = out[i]!.op
    if (kind === 'same') continue
    for (;;) {
      let j = i
      while (j < out.length && out[j]!.op === kind) j++
      const next = out[j]
      if (!next || next.op !== 'same') break
      const first = out[i]!
      if (first.op === 'add' && same(b[first.b]!, b[next.b]!)) {
        out[i] = { op: 'same', a: next.a, b: first.b }
        out.splice(j, 1)
        out.splice(i + 1, 0, ...out.splice(i + 1, j - i - 1), { op: 'add', b: next.b })
      } else if (first.op === 'del' && same(a[first.a]!, a[next.a]!)) {
        out[i] = { op: 'same', a: first.a, b: next.b }
        out.splice(j, 1)
        out.splice(i + 1, 0, ...out.splice(i + 1, j - i - 1), { op: 'del', a: next.a })
      } else break
      i++
    }
  }
  return out
}

/** Words, runs of spaces and single marks, so an address diffs by its parts. */
export const wordTokens = (text: string): string[] =>
  text.match(/[\p{L}\p{N}_]+|\s+|[^\p{L}\p{N}_\s]/gu) ?? []

/* Reading the Markdown the editor writes */

type Segment = {
  text: string
  marks: ReadonlySet<Mark>
  href: string | null
  mention: { target: string; label: string } | null
}
type Token = { text: string; marks: string; href: string | null; mention: string | null }
type DocBlock = { shape: BlockShape; text: string; tokens: Token[]; segments: Segment[] }

const markOrder = (set: ReadonlySet<Mark>) => marks.filter((m) => set.has(m)).join(',')

const delimiters: { open: string; mark: Mark }[] = [
  { open: '**', mark: 'bold' },
  { open: '__', mark: 'bold' },
  { open: '~~', mark: 'strike' },
  { open: '*', mark: 'italic' },
  { open: '_', mark: 'italic' },
]

/** Inline Markdown as runs of text with their marks, link and mention. */
export function inlineSegments(source: string): Segment[] {
  const out: Segment[] = []
  const push = (text: string, active: Set<Mark>, href: string | null) => {
    if (!text) return
    const last = out.at(-1)
    if (last && !last.mention && last.href === href && markOrder(last.marks) === markOrder(active))
      last.text += text
    else out.push({ text, marks: new Set(active), href, mention: null })
  }
  const walk = (s: string, active: Set<Mark>, href: string | null) => {
    let literal = ''
    const flush = () => {
      push(literal, active, href)
      literal = ''
    }
    for (let i = 0; i < s.length;) {
      const c = s[i]!
      if (c === '\\' && i + 1 < s.length && /[\\`*_~[\]()@#>+-]/.test(s[i + 1]!)) {
        literal += s[i + 1]
        i += 2
        continue
      }
      if (c === '@' && s[i + 1] === '[') {
        const close = s.indexOf('](', i + 2)
        const end = close < 0 ? -1 : s.indexOf(')', close + 2)
        if (close > i + 2 && end > close + 2 && !s.slice(i + 2, close).includes(']')) {
          flush()
          const label = s.slice(i + 2, close)
          out.push({
            text: label,
            marks: new Set(active),
            href,
            mention: { target: s.slice(close + 2, end), label },
          })
          i = end + 1
          continue
        }
      }
      if (c === '`') {
        const end = s.indexOf('`', i + 1)
        if (end > i + 1) {
          flush()
          push(s.slice(i + 1, end), new Set([...active, 'code']), href)
          i = end + 1
          continue
        }
      }
      if (c === '[' && href === null) {
        const close = s.indexOf('](', i + 1)
        const end = close < 0 ? -1 : s.indexOf(')', close + 2)
        if (close > i && end > close + 2 && !s.slice(i + 1, close).includes('[')) {
          flush()
          walk(s.slice(i + 1, close), active, s.slice(close + 2, end).trim())
          i = end + 1
          continue
        }
      }
      const delimiter = delimiters.find((d) => s.startsWith(d.open, i))
      if (delimiter && !active.has(delimiter.mark)) {
        const wordBefore = /[\p{L}\p{N}]/u.test(s[i - 1] ?? '')
        const inner = i + delimiter.open.length
        const end = s.indexOf(delimiter.open, inner + 1)
        const opens =
          end > inner &&
          !/\s/.test(s[inner] ?? ' ') &&
          !/\s/.test(s[end - 1] ?? ' ') &&
          !(delimiter.open.startsWith('_') && wordBefore)
        if (opens) {
          flush()
          walk(s.slice(inner, end), new Set([...active, delimiter.mark]), href)
          i = end + delimiter.open.length
          continue
        }
      }
      literal += c
      i++
    }
    flush()
  }
  walk(source, new Set(), null)
  return out
}

const segmentTokens = (segments: readonly Segment[]): Token[] =>
  segments.flatMap((segment): Token[] =>
    segment.mention
      ? [
          {
            text: segment.text,
            marks: markOrder(segment.marks),
            href: segment.href,
            mention: segment.mention.target,
          },
        ]
      : wordTokens(segment.text).map((text) => ({
          text,
          marks: markOrder(segment.marks),
          href: segment.href,
          mention: null,
        })),
  )

const block = (shape: BlockShape, source: string): DocBlock => {
  const segments = inlineSegments(source.replace(/\s*\n\s*/g, ' ').trim())
  const tokens = segmentTokens(segments)
  return { shape, segments, tokens, text: tokens.map((t) => t.text).join('') }
}

/** The blocks of a Markdown text: paragraphs, headings, quotes, list items and rules. */
export function markdownBlocks(markdown: string): DocBlock[] {
  const blocks: DocBlock[] = []
  let paragraph: string[] = []
  let quote: string[] = []
  const endParagraph = () => {
    if (paragraph.length) blocks.push(block({ type: 'paragraph' }, paragraph.join('\n')))
    paragraph = []
  }
  const endQuote = () => {
    if (quote.length) blocks.push(block({ type: 'quote' }, quote.join('\n')))
    quote = []
  }
  let item: { shape: BlockShape; lines: string[] } | null = null
  const endItem = () => {
    if (item) blocks.push(block(item.shape, item.lines.join('\n')))
    item = null
  }
  const endAll = () => {
    endParagraph()
    endQuote()
    endItem()
  }
  for (const raw of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    if (!line.trim()) {
      endAll()
      continue
    }
    const heading = /^ {0,3}(#{1,6})\s+(.*?)(?:\s+#+)?$/.exec(line)
    const rule = /^ {0,3}([-*_])(?:\s*\1){2,}$/.test(line)
    const listItem = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/.exec(line)
    const quoted = /^ {0,3}>\s?(.*)$/.exec(line)
    if (rule) {
      endAll()
      blocks.push({ shape: { type: 'rule' }, segments: [], tokens: [], text: '' })
    } else if (heading) {
      endAll()
      blocks.push(block({ type: 'heading', level: heading[1]!.length }, heading[2]!))
    } else if (listItem) {
      endParagraph()
      endQuote()
      endItem()
      const depth = Math.floor(listItem[1]!.replace(/\t/g, '  ').length / 2)
      const type = /\d/.test(listItem[2]!) ? 'number' : 'bullet'
      item = { shape: { type, depth }, lines: [listItem[3]!] }
    } else if (quoted) {
      endParagraph()
      endItem()
      quote.push(quoted[1]!)
    } else if (item && /^\s+/.test(line)) {
      ;(item as { lines: string[] }).lines.push(line.trim())
    } else {
      endQuote()
      endItem()
      paragraph.push(line)
    }
  }
  endAll()
  return blocks
}

/** The stored Markdown of a context item's text: the summary, then the body. */
export const docMarkdown = (side: Pick<DocSide, 'summary' | 'body'>): string =>
  [side.summary.trim(), side.body?.trim() ?? ''].filter(Boolean).join('\n\n')

/** The words of the text as an agent reads them, without Markdown and mention markup. */
export const plainText = (markdown: string): string =>
  markdownBlocks(markdown)
    .map((b) => b.text)
    .filter(Boolean)
    .join(' ')

/* Words */

/** One run per changed stretch: a space between two changed words is changed too, and runs join. */
function joinRuns(runs: Run[]): Run[] {
  const out: Run[] = []
  runs.forEach((run, index) => {
    const before = runs[index - 1]
    const after = runs[index + 1]
    const bridge =
      run.t === 'same' &&
      !run.text.trim() &&
      before &&
      after &&
      before.t !== 'same' &&
      after.t !== 'same' &&
      before.t !== 'fmt' &&
      after.t !== 'fmt'
    const pieces: Run[] = bridge
      ? [
          { t: 'del', text: run.text },
          { t: 'add', text: run.text },
        ]
      : [run]
    for (const piece of pieces) {
      const last = out.at(-1)
      if (last && last.t === piece.t && last.t !== 'fmt') last.text += piece.text
      else if (
        last &&
        last.t === 'fmt' &&
        piece.t === 'fmt' &&
        last.added.join() === piece.added.join() &&
        last.removed.join() === piece.removed.join()
      )
        last.text += piece.text
      else out.push({ ...piece })
    }
  })
  // A removed run right after an added one reads the other way: what went, then what came.
  for (let k = 1; k < out.length; k++) {
    if (out[k]!.t === 'del' && out[k - 1]!.t === 'add') {
      ;[out[k - 1], out[k]] = [out[k]!, out[k - 1]!]
      if (k > 1) k -= 2
    }
  }
  return out.reduce<Run[]>((joined, run) => {
    const last = joined.at(-1)
    if (last && last.t === run.t && run.t !== 'fmt') last.text += run.text
    else joined.push(run)
    return joined
  }, [])
}

/** How many separate stretches changed: a removal and the addition after it are one. */
export function changeCount(runs: readonly Run[]): number {
  let n = 0
  let open = false
  for (const run of runs) {
    const changed = run.t === 'add' || run.t === 'del'
    if (changed && !open) n++
    open = changed || (open && run.t === 'same' && !run.text.trim())
    if (run.t === 'same' && run.text.trim()) open = false
  }
  return n
}

const markDiff = (before: string, after: string) => {
  const was = new Set(before ? before.split(',') : [])
  const now = new Set(after ? after.split(',') : [])
  return {
    added: marks.filter((m) => now.has(m) && !was.has(m)),
    removed: marks.filter((m) => was.has(m) && !now.has(m)),
  }
}

type PairResult = {
  words: Run[]
  /** For each change of marks, the new block's words with the changed ones marked. */
  formats: { added: Mark[]; removed: Mark[]; runs: Run[] }[]
  hrefs: { text: string; before: string | null; after: string | null }[]
}

/** Two blocks compared word by word: changed words, and the same words with other marks or links. */
function comparePair(a: DocBlock, b: DocBlock): PairResult {
  const ops = sequenceDiff(a.tokens, b.tokens, (x, y) => x.text === y.text)
  const words: Run[] = []
  const changes = new Map<string, { added: Mark[]; removed: Mark[] }>()
  const keyOf = (change: { added: Mark[]; removed: Mark[] }) =>
    `${change.added.join()}|${change.removed.join()}`
  const hrefPairs: { a: Token; b: Token }[] = []
  for (const op of ops) {
    if (op.op === 'del') words.push({ t: 'del', text: a.tokens[op.a]!.text })
    else if (op.op === 'add') words.push({ t: 'add', text: b.tokens[op.b]!.text })
    else {
      const x = a.tokens[op.a]!
      const y = b.tokens[op.b]!
      words.push({ t: 'same', text: y.text })
      if (x.marks !== y.marks && y.text.trim()) {
        const change = markDiff(x.marks, y.marks)
        changes.set(keyOf(change), change)
      }
      if (x.href !== y.href && x.mention === null && y.mention === null)
        hrefPairs.push({ a: x, b: y })
    }
  }
  // Each kind of formatting change reads as the whole new sentence with its words marked.
  const formats = [...changes.values()].map(({ added, removed }) => {
    const runs = ops.flatMap((op): Run[] => {
      if (op.op === 'del') return []
      const y = b.tokens[op.b]!
      if (op.op === 'add') return [{ t: 'same', text: y.text }]
      const x = a.tokens[op.a]!
      return x.marks !== y.marks && keyOf(markDiff(x.marks, y.marks)) === keyOf({ added, removed })
        ? [{ t: 'fmt', text: y.text, added, removed }]
        : [{ t: 'same', text: y.text }]
    })
    return { added, removed, runs: trimFmtSpaces(joinRuns(runs)) }
  })
  const hrefs: PairResult['hrefs'] = []
  for (const { a: x, b: y } of hrefPairs) {
    const last = hrefs.at(-1)
    if (last && last.before === x.href && last.after === y.href) last.text += y.text
    else hrefs.push({ text: y.text, before: x.href, after: y.href })
  }
  return {
    words: joinRuns(words),
    formats,
    hrefs: hrefs.map((h) => ({ ...h, text: h.text.trim() })),
  }
}

/** A formatted run never starts or ends with a space: the space belongs to the words around it. */
function trimFmtSpaces(runs: Run[]): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    if (run.t !== 'fmt') {
      out.push(run)
      continue
    }
    const lead = /^\s*/.exec(run.text)![0]
    const trail = /\s*$/.exec(run.text)![0]
    const core = run.text.slice(lead.length, run.text.length - trail.length)
    if (lead) out.push({ t: 'same', text: lead })
    if (core) out.push({ ...run, text: core })
    if (trail) out.push({ t: 'same', text: trail })
  }
  return out.reduce<Run[]>((joined, run) => {
    const last = joined.at(-1)
    if (last && last.t === 'same' && run.t === 'same') last.text += run.text
    else joined.push(run)
    return joined
  }, [])
}

const sameShape = (a: BlockShape, b: BlockShape) => JSON.stringify(a) === JSON.stringify(b)
const isListItem = (s: BlockShape): s is BlockShape & { type: 'bullet' | 'number' } =>
  s.type === 'bullet' || s.type === 'number'

/** How much of their words two blocks share, from 0 to 1. */
function similarity(a: DocBlock, b: DocBlock): number {
  const words = (x: DocBlock) =>
    x.tokens.filter((t) => t.text.trim()).map((t) => t.text.toLowerCase())
  const wa = words(a)
  const wb = words(b)
  if (!wa.length || !wb.length) return 0
  const common = sequenceDiff(wa, wb, (x, y) => x === y).filter((op) => op.op === 'same').length
  return (2 * common) / (wa.length + wb.length)
}

/* The text field */

/** The text (the summary, then the body) compared as a Markdown document, block by block. */
function textBlocks(before: string, after: string): ChangeBlock[] {
  const field = 'text'
  const a = markdownBlocks(before)
  const b = markdownBlocks(after)
  const key = (x: DocBlock) => x.text.replace(/\s+/g, ' ').trim()
  const ops = sequenceDiff(a, b, (x, y) => key(x) === key(y), 'add')
  const matched: { a: number; b: number }[] = []
  const lonelyA = new Set<number>()
  const lonelyB = new Set<number>()
  for (const op of ops) {
    if (op.op === 'same') matched.push({ a: op.a, b: op.b })
    else if (op.op === 'del') lonelyA.add(op.a)
    else lonelyB.add(op.b)
  }
  // The same words in another place: a move, not a removal and an addition.
  const moved: { a: number; b: number }[] = []
  for (const j of [...lonelyB]) {
    if (!key(b[j]!)) continue
    const i = [...lonelyA].find((x) => key(a[x]!) === key(b[j]!))
    if (i === undefined) continue
    lonelyA.delete(i)
    lonelyB.delete(j)
    moved.push({ a: i, b: j })
  }
  // In each stretch between unchanged blocks, a removed block and an added one that share most of
  // their words are one block reworded.
  const pairs: { a: number; b: number }[] = []
  const anchors = [{ a: -1, b: -1 }, ...matched, { a: a.length, b: b.length }]
  for (let k = 0; k + 1 < anchors.length; k++) {
    const from = anchors[k]!
    const to = anchors[k + 1]!
    const removed = [...lonelyA].filter((i) => i > from.a && i < to.a).sort((x, y) => x - y)
    const added = [...lonelyB].filter((j) => j > from.b && j < to.b).sort((x, y) => x - y)
    let next = 0
    for (const i of removed) {
      for (let p = next; p < added.length; p++) {
        if (similarity(a[i]!, b[added[p]!]!) < PAIR_SIMILARITY) continue
        pairs.push({ a: i, b: added[p]! })
        lonelyA.delete(i)
        lonelyB.delete(added[p]!)
        next = p + 1
        break
      }
    }
  }
  const events: { at: number; block: ChangeBlock }[] = []
  const listChanges = new Map<number, { was: 'bullet' | 'number'; now: 'bullet' | 'number' }>()
  const compareShape = (i: number, j: number) => {
    const was = a[i]!.shape
    const now = b[j]!.shape
    if (sameShape(was, now)) return
    if (isListItem(was) && isListItem(now) && was.type !== now.type) {
      // One change for a whole list whose kind changed: find its first item.
      let first = j
      while (first > 0 && isListItem(b[first - 1]!.shape) && b[first - 1]!.shape.type === now.type)
        first--
      listChanges.set(first, { was: was.type, now: now.type })
      return
    }
    events.push({
      at: j,
      block: {
        kind: 'formatting',
        field: 'text',
        change: { what: 'block', was, now },
        runs: [{ t: 'same', text: b[j]!.text }],
      },
    })
  }
  const pairBlocks = (i: number, j: number, reworded: boolean) => {
    compareShape(i, j)
    const result = comparePair(a[i]!, b[j]!)
    if (reworded) {
      const changes = changeCount(result.words)
      const changedWords = result.words
        .filter((r) => r.t !== 'same')
        .reduce((n, r) => n + wordTokens(r.text).filter((t) => t.trim()).length, 0)
      const allWords = result.words.reduce(
        (n, r) => n + wordTokens(r.text).filter((t) => t.trim()).length,
        0,
      )
      if (changes > 0)
        events.push({
          at: j,
          block: {
            kind: 'wording',
            field,
            runs: result.words,
            changes,
            rewrite: changes >= REWRITE_CHANGES || changedWords * 2 > allWords,
          },
        })
    }
    for (const { added, removed, runs } of result.formats)
      events.push({
        at: j,
        block: { kind: 'formatting', field, change: { what: 'marks', added, removed }, runs },
      })
    for (const href of result.hrefs)
      events.push({
        at: j,
        block: { kind: 'link', field, text: href.text, before: href.before, after: href.after },
      })
  }
  for (const { a: i, b: j } of matched) pairBlocks(i, j, false)
  for (const { a: i, b: j } of moved) pairBlocks(i, j, false)
  for (const { a: i, b: j } of pairs) pairBlocks(i, j, true)
  for (const [first, change] of listChanges) {
    let last = first
    while (
      last + 1 < b.length &&
      isListItem(b[last + 1]!.shape) &&
      b[last + 1]!.shape.type === change.now
    )
      last++
    events.push({
      at: first,
      block: {
        kind: 'formatting',
        field: 'text',
        change: { what: 'list', was: change.was, now: change.now },
        items: b.slice(first, last + 1).map((x) => x.text),
      },
    })
  }
  if (moved.length) {
    // One Order block per group the moves happened in: a list, or the field's blocks.
    const groupOf = (j: number) => {
      const shape = b[j]!.shape
      if (!isListItem(shape)) return { start: 0, end: b.length - 1, list: false }
      let start = j
      let end = j
      while (start > 0 && isListItem(b[start - 1]!.shape)) start--
      while (end + 1 < b.length && isListItem(b[end + 1]!.shape)) end++
      return { start, end, list: true }
    }
    const groups = new Map<
      number,
      { start: number; end: number; list: boolean; moved: Map<number, number> }
    >()
    for (const { a: i, b: j } of moved) {
      const g = groupOf(j)
      const entry = groups.get(g.start) ?? { ...g, moved: new Map<number, number>() }
      // Where it was, counted inside the same group of the earlier version.
      let startA = i
      if (g.list) while (startA > 0 && isListItem(a[startA - 1]!.shape)) startA--
      else startA = 0
      entry.moved.set(j, i - startA + 1)
      groups.set(g.start, entry)
    }
    for (const g of groups.values()) {
      const steps = b
        .slice(g.start, g.end + 1)
        .map((x, offset) => ({ text: x.text, from: g.moved.get(g.start + offset) ?? null }))
        .filter((s) => s.text)
      events.push({
        at: g.start,
        block: { kind: 'order', field: 'text', steps, moved: g.moved.size },
      })
    }
  }
  for (const j of lonelyB)
    if (b[j]!.text) events.push({ at: j, block: { kind: 'added', field, text: b[j]!.text } })
  // A removed block shows where it was: before the block that now follows it.
  for (const i of lonelyA) {
    if (!a[i]!.text) continue
    const after = ops.find((op) => op.op !== 'del' && 'a' in op && op.a > i)
    const at = after && after.op === 'same' ? after.b - 0.5 : b.length
    events.push({ at, block: { kind: 'removed', field, text: a[i]!.text } })
  }
  // Mentions added or removed anywhere in the text.
  const mentionsOf = (blocks: DocBlock[]) => {
    const found = new Map<string, { label: string; n: number }>()
    for (const x of blocks)
      for (const s of x.segments)
        if (s.mention) {
          const entry = found.get(s.mention.target) ?? { label: s.mention.label, n: 0 }
          entry.n++
          found.set(s.mention.target, entry)
        }
    return found
  }
  const mentionsA = mentionsOf(a)
  const mentionsB = mentionsOf(b)
  for (const [target, { label, n }] of mentionsB)
    if (n > (mentionsA.get(target)?.n ?? 0))
      events.push({
        at: b.length,
        block: { kind: 'link', field: 'text', mention: { target, label, change: 'added' } },
      })
  for (const [target, { label, n }] of mentionsA)
    if (n > (mentionsB.get(target)?.n ?? 0))
      events.push({
        at: b.length,
        block: { kind: 'link', field: 'text', mention: { target, label, change: 'removed' } },
      })
  // Links that came or went with words (a changed address on the same words is found above).
  const linksOf = (blocks: DocBlock[]) => {
    const found = new Map<string, string>()
    for (const x of blocks)
      for (const s of x.segments)
        if (s.href && !s.mention) found.set(s.href, (found.get(s.href) ?? '') + s.text)
    return found
  }
  const linksA = linksOf(a)
  const linksB = linksOf(b)
  const changedHrefs = new Set(
    events.flatMap((e) =>
      e.block.kind === 'link' && 'before' in e.block ? [e.block.before, e.block.after] : [],
    ),
  )
  for (const [href, text] of linksB)
    if (!linksA.has(href) && !changedHrefs.has(href))
      events.push({
        at: b.length,
        block: { kind: 'link', field: 'text', text: text.trim(), before: null, after: href },
      })
  for (const [href, text] of linksA)
    if (!linksB.has(href) && !changedHrefs.has(href))
      events.push({
        at: b.length,
        block: { kind: 'link', field: 'text', text: text.trim(), before: href, after: null },
      })
  return events
    .map((e, index) => ({ ...e, index }))
    .sort((x, y) => x.at - y.at || x.index - y.index)
    .map((e) => e.block)
}

/** A plain field, compared as one block of words. */
function plainBlocks(field: TextField, before: string, after: string): ChangeBlock[] {
  if (before === after) return []
  if (!before.trim()) return after.trim() ? [{ kind: 'added', field, text: after }] : []
  if (!after.trim()) return [{ kind: 'removed', field, text: before }]
  const words = joinRuns(
    sequenceDiff(wordTokens(before), wordTokens(after), (x, y) => x === y).map((op): Run =>
      op.op === 'same'
        ? { t: 'same', text: wordTokens(after)[op.b]! }
        : op.op === 'del'
          ? { t: 'del', text: wordTokens(before)[op.a]! }
          : { t: 'add', text: wordTokens(after)[op.b]! },
    ),
  )
  const changes = changeCount(words)
  if (!changes) return []
  const changedWords = words
    .filter((r) => r.t !== 'same')
    .reduce((n, r) => n + wordTokens(r.text).filter((t) => t.trim()).length, 0)
  const allWords = words.reduce((n, r) => n + wordTokens(r.text).filter((t) => t.trim()).length, 0)
  return [
    {
      kind: 'wording',
      field,
      runs: words,
      changes,
      rewrite: changes >= REWRITE_CHANGES || changedWords * 2 > allWords,
    },
  ]
}

/* Numbers and dates in words */

const monthPattern =
  '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const datePattern = new RegExp(
  [
    `\\b\\d{4}-\\d{2}-\\d{2}\\b`,
    `\\b\\d{1,2}(?:\\s*(?:to|-|–|and)\\s*\\d{1,2})?\\s+${monthPattern}\\b(?:\\s+\\d{4}\\b)?`,
    `\\b${monthPattern}\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4}\\b)?`,
    `\\b${monthPattern}\\s+\\d{4}\\b`,
  ].join('|'),
  'giu',
)
const numberPattern = /(?<![\p{L}\p{N}])\d+(?:[.,]\d+)*(?:\s?%)?(?![\p{L}\p{N}])/gu

/** The dates and numbers in words, each once, in the order they come. A number in a date is the date's. */
export function valuesIn(text: string): {
  dates: string[]
  numbers: string[]
  /** Both, in the order the words give them. */
  all: { what: 'date' | 'number'; text: string }[]
} {
  const found: { what: 'date' | 'number'; text: string; at: number }[] = []
  const masked = text.replace(datePattern, (match, at: number) => {
    found.push({ what: 'date', text: match.replace(/\s+/g, ' ').trim(), at })
    return ' '.repeat(match.length)
  })
  for (const m of masked.matchAll(numberPattern))
    found.push({ what: 'number', text: m[0].replace(/\s/g, ''), at: m.index })
  const seen = new Set<string>()
  const all = found
    .sort((a, b) => a.at - b.at)
    .filter((v) => !seen.has(`${v.what}:${v.text}`) && seen.add(`${v.what}:${v.text}`))
    .map(({ what, text }) => ({ what, text }))
  return {
    dates: all.filter((v) => v.what === 'date').map((v) => v.text),
    numbers: all.filter((v) => v.what === 'number').map((v) => v.text),
    all,
  }
}

function wordingValues(
  field: DocField | 'quote',
  runs: readonly Run[],
  beforeText: string,
): ValueChange[] {
  const out: ValueChange[] = []
  const known = valuesIn(beforeText)
  for (let k = 0; k < runs.length; k++) {
    const run = runs[k]!
    if (run.t !== 'add') continue
    const removed = runs[k - 1]?.t === 'del' ? valuesIn(runs[k - 1]!.text) : null
    const counted = { date: 0, number: 0 }
    for (const value of valuesIn(run.text).all) {
      const before =
        (value.what === 'date' ? removed?.dates : removed?.numbers)?.[counted[value.what]++] ?? null
      const knownBefore = (value.what === 'date' ? known.dates : known.numbers).some(
        (v) => v.toLowerCase() === value.text.toLowerCase(),
      )
      if (before !== null || !knownBefore)
        out.push({ what: value.what, field, before, after: value.text })
    }
  }
  return out
}

/* The whole item */

const runsText = (runs: readonly Run[], side: 'before' | 'after') =>
  runs
    .filter((r) => r.t === 'same' || r.t === 'fmt' || r.t === (side === 'before' ? 'del' : 'add'))
    .map((r) => r.text)
    .join('')

/** What changes between the version agents get now and the suggested one (FR-224). */
export function docDiff(before: DocSide | null, after: DocSide | null): DocDiff {
  if (!after) return finish('retire', [], [], [])
  if (!before) {
    const blocks: ChangeBlock[] = [
      { kind: 'added', field: 'text', text: plainText(docMarkdown(after)) },
    ]
    if (after.where.length) blocks.push({ kind: 'added', field: 'where', parts: [...after.where] })
    blocks.push({ kind: 'added', field: 'when', from: after.validFrom, until: after.validUntil })
    for (const source of after.sources)
      blocks.push({ kind: 'added', field: 'sources', url: source.url, quote: source.quote })
    if (after.notToConclude.trim())
      blocks.push({ kind: 'added', field: 'notToConclude', text: after.notToConclude })
    return finish('new', blocks, [], [])
  }
  const blocks: ChangeBlock[] = [
    ...plainBlocks('title', before.title, after.title),
    ...textBlocks(docMarkdown(before), docMarkdown(after)),
  ]
  if (before.kind !== after.kind)
    blocks.push({ kind: 'wording', field: 'kind', before: before.kind, after: after.kind })
  const addedWhere = after.where.filter((w) => !before.where.includes(w))
  const removedWhere = before.where.filter((w) => !after.where.includes(w))
  if (addedWhere.length) blocks.push({ kind: 'added', field: 'where', parts: addedWhere })
  if (removedWhere.length) blocks.push({ kind: 'removed', field: 'where', parts: removedWhere })
  if (before.validFrom !== after.validFrom || before.validUntil !== after.validUntil)
    blocks.push({
      kind: 'dates',
      field: 'when',
      before: { from: before.validFrom, until: before.validUntil },
      after: { from: after.validFrom, until: after.validUntil },
    })
  if (before.reviewDate !== after.reviewDate)
    blocks.push({
      kind: 'dates',
      field: 'checkDate',
      before: { from: before.reviewDate, until: null },
      after: { from: after.reviewDate, until: null },
    })
  // Sources by position: a new address is a Link; a new copied sentence is Wording.
  const sourceCount = Math.max(before.sources.length, after.sources.length)
  for (let k = 0; k < sourceCount; k++) {
    const was = before.sources[k]
    const now = after.sources[k]
    if (was && now) {
      if (was.url !== now.url)
        blocks.push({
          kind: 'link',
          field: 'sources',
          text: now.quote ?? '',
          before: was.url,
          after: now.url,
        })
      blocks.push(...plainBlocks('quote', was.quote ?? '', now.quote ?? ''))
    } else if (now) blocks.push({ kind: 'added', field: 'sources', url: now.url, quote: now.quote })
    else if (was) blocks.push({ kind: 'removed', field: 'sources', url: was.url, quote: was.quote })
  }
  blocks.push(...plainBlocks('notToConclude', before.notToConclude, after.notToConclude))

  const values: ValueChange[] = []
  for (const b of blocks) {
    if (b.kind === 'wording' && 'runs' in b) {
      const field = b.field
      values.push(...wordingValues(field, b.runs, runsText(b.runs, 'before')))
    } else if (b.kind === 'added' && 'text' in b && b.field !== 'title') {
      const known = valuesIn(plainText(docMarkdown(before)))
      for (const value of valuesIn(b.text).all) {
        const knownBefore = (value.what === 'date' ? known.dates : known.numbers).some(
          (v) => v.toLowerCase() === value.text.toLowerCase(),
        )
        if (!knownBefore)
          values.push({ what: value.what, field: b.field, before: null, after: value.text })
      }
    } else if (b.kind === 'dates' && b.field === 'when') {
      if (b.before.from !== b.after.from)
        values.push({ what: 'date', field: 'when', before: b.before.from, after: b.after.from })
      // The first day it no longer applies is stored; people read the last day it does.
      const lastDay = (until: string | null) => (until === null ? null : shiftDate(until, -1))
      if (b.before.until !== b.after.until)
        values.push({
          what: 'date',
          field: 'when',
          before: lastDay(b.before.until),
          after: lastDay(b.after.until),
        })
    } else if (b.kind === 'link' && b.field === 'sources') {
      values.push({ what: 'source', field: 'sources', before: b.before, after: b.after })
    } else if (b.kind === 'added' && b.field === 'sources') {
      values.push({ what: 'source', field: 'sources', before: null, after: b.url })
    }
  }
  const touched = new Set<DocField>(blocks.map((b) => (b.field === 'quote' ? 'sources' : b.field)))
  return finish(
    'edit',
    blocks,
    docFields.filter((f) => !touched.has(f)),
    values,
  )
}

function finish(
  mode: DocDiff['mode'],
  blocks: ChangeBlock[],
  unchanged: DocField[],
  values: ValueChange[],
): DocDiff {
  const n = new Map<ChangeKind, number>()
  const add = (kind: ChangeKind, by: number) => n.set(kind, (n.get(kind) ?? 0) + by)
  if (mode === 'new') add('added', 1)
  else if (mode === 'retire') add('removed', 1)
  else
    for (const b of blocks) {
      if (b.kind === 'wording') add('wording', 'changes' in b ? b.changes : 1)
      else if (b.kind === 'order') add('order', b.moved)
      else add(b.kind, 1)
    }
  const counts = changeKinds.filter((k) => n.has(k)).map((kind) => ({ kind, n: n.get(kind)! }))
  return {
    mode,
    blocks,
    counts,
    unchanged,
    values,
    only: counts.length === 1 ? counts[0]!.kind : null,
  }
}

/* The Source view */

/** One line of the stored Markdown, unchanged, removed or added, with its changed words. */
export type SourceRow = {
  t: ' ' | '-' | '+'
  line: string
  words?: { text: string; changed: boolean }[]
}

/** Which words of each side the other side doesn't have, as runs of unchanged and changed text. */
export function lineWords(
  before: string,
  after: string,
): [SourceRow['words'] & {}, SourceRow['words'] & {}] {
  const a = wordTokens(before)
  const b = wordTokens(after)
  const left: { text: string; changed: boolean }[] = []
  const right: { text: string; changed: boolean }[] = []
  for (const op of sequenceDiff(a, b, (x, y) => x === y)) {
    if (op.op === 'same') {
      left.push({ text: a[op.a]!, changed: false })
      right.push({ text: b[op.b]!, changed: false })
    } else if (op.op === 'del') left.push({ text: a[op.a]!, changed: true })
    else right.push({ text: b[op.b]!, changed: true })
  }
  const runs = (words: { text: string; changed: boolean }[]) =>
    words
      .map((w, i) => ({
        ...w,
        changed:
          w.changed || (!w.text.trim() && !!words[i - 1]?.changed && !!words[i + 1]?.changed),
      }))
      .reduce<{ text: string; changed: boolean }[]>((out, w) => {
        const last = out.at(-1)
        if (last && last.changed === w.changed) last.text += w.text
        else out.push({ ...w })
        return out
      }, [])
  return [runs(left), runs(right)]
}

/** The stored Markdown line by line: removed lines before added ones, changed words marked (J19). */
export function sourceDiff(before: string, after: string): SourceRow[] {
  const a = before ? before.split('\n') : []
  const b = after ? after.split('\n') : []
  const rows: SourceRow[] = sequenceDiff(a, b, (x, y) => x === y).map((op) =>
    op.op === 'same'
      ? { t: ' ', line: a[op.a]! }
      : op.op === 'del'
        ? { t: '-', line: a[op.a]! }
        : { t: '+', line: b[op.b]! },
  )
  for (let k = 0; k < rows.length; k++) {
    if (rows[k]!.t !== '-') continue
    let del = k
    while (del < rows.length && rows[del]!.t === '-') del++
    let add = del
    while (add < rows.length && rows[add]!.t === '+') add++
    for (let p = 0; p < Math.min(del - k, add - del); p++) {
      const [left, right] = lineWords(rows[k + p]!.line, rows[del + p]!.line)
      rows[k + p]!.words = left
      rows[del + p]!.words = right
    }
    k = add - 1
  }
  return rows
}
