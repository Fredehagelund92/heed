import type { Nodes, PhrasingContent, RootContent, Table, Text } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { headingIds } from '@domain/heading-anchors'
import { mentionTarget, safeHref } from '@/lib/markdown'

/*
  The assistant's answers as people read them (contract 9.8). An answer is model text the
  citation check has already let through, written in GitHub-flavoured Markdown, so it is read
  with a standard parser (micromark, as GitHub and react-markdown do) rather than the small
  subset of item text (lib/markdown.ts, contract 9.6): tables, nested and task lists, headings,
  strikethrough, block quotes and code. The parser builds a plain tree of allowed nodes and the
  renderer (`components/assistant/answer-markdown.tsx`) draws it with React elements only, so
  nothing reaches the browser as HTML. Raw HTML, images, footnotes and link definitions stay the
  text that was written. A link opens only an http, https or mailto address in a new tab, or a
  page of Heed in the app; a page's path written as plain words (`/library?view=attention`)
  becomes a link to it too.

  The help pages (`lib/docs.ts`, docs/help) are read with the same parser through `parseGfm`
  and its options: each heading gets the id GitHub gives it, so a link to a heading works on
  GitHub and in the app; a paragraph that holds only a picture of the pages becomes a figure;
  and their links between pages and to the repository resolve as the pages decide. They are
  trusted files of the repository; an answer never gets these options.

  While an answer streams, each update lets out the sentences the citation check has passed
  (`readStreaming`). The reading remembers where each update started, and marks what came in it:
  a block that is new as a whole, or the new words at the end of a block that was already there.
  Only those parts settle in as they arrive; what was on screen stays as it was.
*/

export type AnswerInline =
  | { type: 'text'; text: string }
  | { type: 'break' }
  | { type: 'strong' | 'emphasis' | 'delete'; children: AnswerInline[] }
  | { type: 'code'; text: string }
  /** `internal` is a page of Heed, opened in the app; anything else opens in a new tab. */
  | { type: 'link'; href: string; internal: boolean; children: AnswerInline[] }
  | { type: 'mention'; label: string; target: string }
  /** Words that came in one update of a streaming answer, which starts at `at` in its text. */
  | { type: 'arrive'; at: number; children: AnswerInline[] }

export type TableAlign = 'left' | 'right' | 'center' | null

export type AnswerTable = {
  type: 'table'
  /** Each column's alignment: as written, else right for a column of numbers. */
  align: TableAlign[]
  /** A column of numbers, drawn with tabular numerals. */
  numeric: boolean[]
  /**
   * A column of short values (a name, a date, a state): kept on one line, so a long column of
   * sentences wraps instead. A short first column is each row's name and stays in view.
   */
  short: boolean[]
  head: AnswerInline[][]
  /**
   * Every row has a cell for each column. `span`: a row of one cell, across the table. `arrive`:
   * the row came in a later update than its table (`Arrive`).
   */
  rows: ({ cells: AnswerInline[][]; span: boolean } & Arrive)[]
}

/**
 * A part that came in a later update of a streaming answer than what holds it: where that update
 * starts in the answer's text. It settles in as it arrives.
 */
export type Arrive = { arrive?: number }

export type AnswerBlock =
  /** `id`: the heading's anchor, as GitHub writes it, when the options ask for it. */
  (
    | { type: 'heading'; depth: number; id?: string; children: AnswerInline[] }
    /** A picture the options resolved (`image`): its key, what it shows and its caption. */
    | { type: 'figure'; src: string; alt: string; caption: string | null }
    | { type: 'paragraph'; children: AnswerInline[] }
    | {
        type: 'list'
        ordered: boolean
        start: number
        /** `checked` is a task's state, null for an item that is not a task. */
        items: ({ checked: boolean | null; children: AnswerBlock[] } & Arrive)[]
      }
    | { type: 'quote'; children: AnswerBlock[] }
    | { type: 'code'; text: string }
    | { type: 'rule' }
    | AnswerTable
  ) &
    Arrive

/**
 * The first part of the paths of Heed's pages an answer may link to: the pages the assistant's
 * turn context names (turn-context.ts) and the rest of the signed-in app. Never the sign-in, the
 * AI app consent or the design previews.
 */
const answerPages = new Set([
  'admin',
  'areas',
  'assistant',
  'catalogue',
  'docs',
  'editions',
  'evals',
  'gaps',
  'health',
  'library',
  'mcp',
  'proposals',
  'quality',
  'settings',
  'try-it',
  'workbench',
])

const base = 'https://heed.invalid'

/** A page of Heed as its path, search and hash, or null when the text is not one. */
export function internalPath(raw: string): string | null {
  // Control characters and whitespace inside an address are a classic way to hide a scheme.
  // eslint-disable-next-line no-control-regex
  if (!/^\/(?![/\\])/.test(raw) || /[\u0000- \u007f\\]/.test(raw)) return null
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return null
  }
  if (url.origin !== base || !answerPages.has(url.pathname.split('/')[1] ?? '')) return null
  return url.pathname + url.search + url.hash
}

/** Where a link in an answer may go: a page of Heed, a safe address, or nowhere. */
export function answerHref(raw: string): { href: string; internal: boolean } | null {
  const path = internalPath(raw.trim())
  if (path) return { href: path, internal: true }
  const href = safeHref(raw)
  return href ? { href, internal: false } : null
}

const fenceOpen = /^ {0,3}(`{3,}|~{3,})/
const blank = (line: string | undefined) => line === undefined || /^\s*$/.test(line)
/** The cells of a table line: split on each pipe that no backslash escapes. */
const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
const hasPipe = (line: string) => /^ {0,3}\S/.test(line) && /(?<!\\)\|/.test(line)
const delimiterCell = /^\s*:?-+:?\s*$/
/** A header line and the delimiter line under it, with as many cells: where GFM starts a table. */
function startsTable(lines: readonly string[], at: number): boolean {
  const head = lines[at]
  const delimiter = lines[at + 1]
  if (head === undefined || delimiter === undefined || !hasPipe(head) || !hasPipe(delimiter))
    return false
  const cells = cellsOf(delimiter)
  return cells.every((cell) => delimiterCell.test(cell)) && cells.length === cellsOf(head).length
}

/**
 * Makes a model's tables read as it meant them. A table gets a blank line before it, so it does
 * not join the sentence that introduces it in other Markdown readers too, and it ends at the first
 * line without a cell, which GFM would otherwise take as one more row. While the answer streams, a
 * table whose header has come but not yet its delimiter line is held back, so it never shows as a
 * line of pipes first.
 */
export function tidyAnswer(source: string, { streaming = false } = {}): string {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let fence: RegExp | null = null
  let table = false
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at]!
    if (fence) {
      if (fence.test(line)) fence = null
      out.push(line)
      continue
    }
    const open = fenceOpen.exec(line)
    if (open) {
      const marker = open[1]!
      fence = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`)
      table = false
      out.push(line)
      continue
    }
    if (table) {
      if (blank(line) || !hasPipe(line)) {
        table = false
        if (!blank(line)) out.push('')
      }
      out.push(line)
      continue
    }
    if (startsTable(lines, at)) {
      if (!blank(out.at(-1))) out.push('')
      out.push(line, lines[at + 1]!)
      at += 1
      table = true
      continue
    }
    out.push(line)
  }
  if (streaming && !fence) {
    let start = out.length
    while (start > 0 && !blank(out[start - 1]) && hasPipe(out[start - 1]!)) start -= 1
    if (start < out.length && !startsTable(out, start)) out.length = start
  }
  return out.join('\n')
}

/** Where a link may go: a page of Heed, opened in the app, or another address; null for none. */
export type LinkTarget = { href: string; internal: boolean } | null

export type MarkdownOptions = {
  /** The answer is still arriving: a table shows once its header and delimiter lines have. */
  streaming?: boolean
  /** Where each link goes. An answer's links go where `answerHref` lets them. */
  link?: (url: string) => LinkTarget
  /** The key of a picture the text may show, or null to keep the image as the words written. */
  image?: (url: string) => string | null
  /** Give each heading the id GitHub gives it. */
  headingIds?: boolean
}

/** Reads an answer into the blocks the renderer draws. */
export function parseAnswer(source: string, { streaming = false } = {}): AnswerBlock[] {
  return parseGfm(source, { streaming })
}

/** Reads GitHub-flavoured Markdown into the blocks the renderer draws, as the options allow. */
export function parseGfm(source: string, options: MarkdownOptions = {}): AnswerBlock[] {
  return parseTidied(tidyAnswer(source, { streaming: options.streaming ?? false }), options, [])
}

/**
 * An answer read as it streams: its blocks, with what came in each update marked, and what the
 * next update is read against. `text` is the answer tidied for reading; `arrivals` is where each
 * update started in it, in order.
 */
export type StreamingReading = {
  source: string
  streaming: boolean
  text: string
  arrivals: readonly number[]
  blocks: AnswerBlock[]
}

/**
 * Reads the next update of an answer against the reading before it (`before`). An answer first
 * read while it streams has arrived as a whole; one first read when it is done marks nothing, so
 * opening a conversation again moves nothing.
 */
export function readStreaming(
  source: string,
  { streaming, before }: { streaming: boolean; before: StreamingReading | null },
): StreamingReading {
  const text = tidyAnswer(source, { streaming })
  const arrivals = before ? nextArrivals(before.arrivals, before.text, text) : streaming ? [0] : []
  return { source, streaming, text, arrivals, blocks: parseTidied(text, {}, arrivals) }
}

/**
 * Where each update starts, after one more: the text that is new starts where the two texts part.
 * Tidying may rewrite the end of what was there (a table's header held back, then let out), so an
 * update counts from the first character that changed, and an earlier start after it is dropped.
 */
export function nextArrivals(
  arrivals: readonly number[],
  before: string,
  text: string,
): readonly number[] {
  if (text === before) return arrivals
  const most = Math.min(before.length, text.length)
  let same = 0
  while (same < most && before.charCodeAt(same) === text.charCodeAt(same)) same += 1
  const kept = arrivals.filter((at) => at <= same)
  return text.length > same && kept.at(-1) !== same ? [...kept, same] : kept
}

function parseTidied(
  text: string,
  options: MarkdownOptions,
  arrivals: readonly number[],
): AnswerBlock[] {
  const tree = fromMarkdown(text, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const read: Read = {
    source: text,
    link: options.link ?? answerHref,
    image: options.image ?? null,
    ids: options.headingIds ? headingIds() : null,
    arrivals,
  }
  return blocksOf(tree.children, read, -1)
}

/** What the reading of one text needs: its words, the link and picture rules, the ids so far. */
type Read = {
  source: string
  link: (url: string) => LinkTarget
  image: ((url: string) => string | null) | null
  /** Hands out each heading's anchor, as GitHub does (`-1`, `-2` after a repeat). */
  ids: ((text: string) => string) | null
  /** Where each update of a streaming answer starts in `source`; empty for a text read whole. */
  arrivals: readonly number[]
}

/**
 * The update a place in the text came in: an index into the arrivals, -1 for none. A part is
 * marked when it came in a later update than what holds it (`within`), and what it holds is then
 * read against its own update, so each new part is marked once, where it starts.
 */
function updateOf(read: Read, offset: number | undefined): number {
  let update = -1
  if (offset === undefined) return update
  for (const at of read.arrivals) {
    if (at > offset) break
    update += 1
  }
  return update
}

/** The mark of a part that came in update `update`, inside a part of update `within`. */
const arriveOf = (read: Read, update: number, within: number): Arrive =>
  update > within ? { arrive: read.arrivals[update]! } : {}

/** The text a node was written as, for what an answer may not show as formatting. */
const written = (node: Nodes, source: string) =>
  node.position?.start.offset !== undefined && node.position.end.offset !== undefined
    ? source.slice(node.position.start.offset, node.position.end.offset)
    : plainText(node)

function plainText(node: Nodes): string {
  if ('value' in node) return node.value
  if ('children' in node) return node.children.map((child) => plainText(child)).join('')
  return ''
}

function blocksOf(nodes: readonly RootContent[], read: Read, within: number): AnswerBlock[] {
  return nodes.flatMap((node): AnswerBlock[] => {
    const update = Math.max(within, updateOf(read, node.position?.start.offset))
    const arrive = arriveOf(read, update, within)
    return blockOf(node, read, update).map((block) => ({ ...block, ...arrive }))
  })
}

function blockOf(node: RootContent, read: Read, update: number): AnswerBlock[] {
  switch (node.type) {
    case 'paragraph': {
      const figure = figureOf(node.children, read)
      if (figure) return [figure]
      return [{ type: 'paragraph', children: inlinesOf(node.children, read, update) }]
    }
    case 'heading':
      return [
        {
          type: 'heading',
          depth: node.depth,
          ...(read.ids ? { id: read.ids(plainText(node)) } : {}),
          children: inlinesOf(node.children, read, update),
        },
      ]
    case 'list':
      return [
        {
          type: 'list',
          ordered: node.ordered === true,
          start: node.start ?? 1,
          items: node.children.map((item) => {
            const own = Math.max(update, updateOf(read, item.position?.start.offset))
            return {
              checked: item.checked ?? null,
              children: blocksOf(item.children, read, own),
              ...arriveOf(read, own, update),
            }
          }),
        },
      ]
    case 'blockquote':
      return [{ type: 'quote', children: blocksOf(node.children, read, update) }]
    case 'code':
      return [{ type: 'code', text: node.value }]
    case 'thematicBreak':
      return [{ type: 'rule' }]
    case 'table':
      return [tableOf(node, read, update)]
    default:
      // Raw HTML, a link or footnote definition: the words as written, never formatting.
      return [{ type: 'paragraph', children: textOf(written(node, read.source)) }]
  }
}

/** A paragraph that holds only a picture the options know: a figure with its caption. */
function figureOf(nodes: readonly PhrasingContent[], read: Read): AnswerBlock | null {
  const content = nodes.filter((node) => node.type !== 'text' || node.value.trim() !== '')
  const [only] = content
  if (!read.image || content.length !== 1 || only?.type !== 'image') return null
  const src = read.image(only.url)
  return src ? { type: 'figure', src, alt: only.alt ?? '', caption: only.title ?? null } : null
}

const number = /^[-+−]?[\d\s.,]*\d[\d\s.,]*%?$/
/** The longest value a short column holds: "Noor Haddad (deputy)", "31 Aug 2026". */
const SHORT_CELL = 20

function tableOf(node: Table, read: Read, update: number): AnswerTable {
  const [header, ...body] = node.children
  const head = (header?.children ?? []).map((cell) => inlinesOf(cell.children, read, update))
  const rows = body.map((row) => {
    const own = Math.max(update, updateOf(read, row.position?.start.offset))
    const cells = row.children.map((cell) => inlinesOf(cell.children, read, own))
    return {
      cells: head.map((_, column) => cells[column] ?? []),
      span: head.length > 1 && row.children.length === 1,
      ...arriveOf(read, own, update),
    }
  })
  const columns = head.map((_, column) =>
    body
      .filter((_, index) => !rows[index]!.span)
      .map((row) => (row.children[column] ? plainText(row.children[column]).trim() : ''))
      .filter(Boolean),
  )
  const numeric = columns.map(
    (values) => values.length > 0 && values.every((value) => number.test(value)),
  )
  const short = columns.map((values) => values.every((value) => [...value].length <= SHORT_CELL))
  return {
    type: 'table',
    align: head.map((_, column) => node.align?.[column] ?? (numeric[column] ? 'right' : null)),
    numeric,
    short,
    head,
    rows,
  }
}

const fullMention = new RegExp(`^(?:${mentionTarget.source})$`)

/** An inline part and the update it came in. */
type Piece = { update: number; node: AnswerInline }

function inlinesOf(nodes: readonly PhrasingContent[], read: Read, within: number): AnswerInline[] {
  const { source } = read
  const out: Piece[] = []
  for (const node of nodes) {
    const update = Math.max(within, updateOf(read, node.position?.start.offset))
    const add = (inline: AnswerInline) => out.push({ update, node: inline })
    switch (node.type) {
      case 'text':
        out.push(...textPieces(node, read, update))
        break
      case 'break':
        add({ type: 'break' })
        break
      case 'strong':
      case 'emphasis':
      case 'delete':
        add({ type: node.type, children: inlinesOf(node.children, read, update) })
        break
      case 'inlineCode':
        add({ type: 'code', text: node.value })
        break
      case 'link': {
        // `@[title](item:itm_...)`: a fact the answer cites, or a statement the check removed.
        const before = out.at(-1)?.node
        if (fullMention.test(node.url) && before?.type === 'text' && before.text.endsWith('@')) {
          before.text = before.text.slice(0, -1)
          if (!before.text) out.pop()
          add({ type: 'mention', label: plainText(node), target: node.url })
          break
        }
        const target = read.link(node.url)
        if (target)
          add({ type: 'link', ...target, children: inlinesOf(node.children, read, update) })
        else textOf(written(node, source)).forEach(add)
        break
      }
      default:
        // An image, raw HTML, a reference or a footnote: the words as written.
        textOf(written(node, source)).forEach(add)
    }
  }
  return arrived(out, read, within)
}

/** The parts in order, each run that came in a later update than `within` held together. */
function arrived(pieces: readonly Piece[], read: Read, within: number): AnswerInline[] {
  const out: AnswerInline[] = []
  for (const { update, node } of pieces) {
    if (update <= within) {
      out.push(node)
      continue
    }
    const at = read.arrivals[update]!
    const last = out.at(-1)
    if (last?.type === 'arrive' && last.at === at) last.children.push(node)
    else out.push({ type: 'arrive', at, children: [node] })
  }
  return out
}

/**
 * A text's words with the update each came in: a later update often adds to the text that ends a
 * paragraph, so the words are cut where it starts. A page path is never cut. When the words
 * differ from what was written (an escape), the cut is found from the end, which a later update
 * only adds to.
 */
function textPieces(node: Text, read: Read, update: number): Piece[] {
  const runs = textRuns(node.value)
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined)
    return runs.map((run) => ({ update, node: run.node }))
  const exact = read.source.slice(start, end) === node.value
  const cuts: { at: number; update: number }[] = []
  read.arrivals.forEach((offset, index) => {
    if (index <= update || offset >= end) return
    const tail = read.source.slice(offset, end)
    if (exact) cuts.push({ at: offset - start, update: index })
    else if (node.value.endsWith(tail))
      cuts.push({ at: node.value.length - tail.length, update: index })
  })
  const updateAt = (at: number) => cuts.findLast((cut) => cut.at <= at)?.update ?? update
  return runs.flatMap(({ node: inline, from }): Piece[] => {
    if (inline.type !== 'text') return [{ update: updateAt(from), node: inline }]
    const to = from + inline.text.length
    const inside = cuts.filter((cut) => cut.at > from && cut.at < to).map((cut) => cut.at)
    return [from, ...inside].map((at, index, all) => ({
      update: updateAt(at),
      node: { type: 'text', text: inline.text.slice(at - from, (all[index + 1] ?? to) - from) },
    }))
  })
}

// A page's path in the words: after a space or an opening bracket or quote, a first part Heed
// knows (internalPath checks it), then more parts, a search and a hash.
const pagePath =
  /(?<=^|[\s([{"'“‘])\/[a-z][a-z0-9-]*(?:\/[\w.~%$-]+)*\/?(?:\?[\w.~%&=+,:/-]*)?(?:#[\w.~%-]*)?/g

/** Words as text: each line break a break, each page path a link to the page. */
function textOf(value: string): AnswerInline[] {
  return textRuns(value).map((run) => run.node)
}

/** `textOf`, with where in the words each part starts. */
function textRuns(value: string): { node: AnswerInline; from: number }[] {
  const out: { node: AnswerInline; from: number }[] = []
  let offset = 0
  value.split('\n').forEach((line, index) => {
    if (index > 0) out.push({ node: { type: 'break' }, from: offset - 1 })
    let from = 0
    for (const match of line.matchAll(pagePath)) {
      // A full stop or a comma after a path ends the sentence, not the path.
      const raw = match[0].replace(/[.,;:!?]+$/, '')
      const path = internalPath(raw)
      if (!path) continue
      if (match.index > from)
        out.push({
          node: { type: 'text', text: line.slice(from, match.index) },
          from: offset + from,
        })
      out.push({
        node: { type: 'link', href: path, internal: true, children: [{ type: 'text', text: raw }] },
        from: offset + match.index,
      })
      from = match.index + raw.length
    }
    if (from < line.length)
      out.push({ node: { type: 'text', text: line.slice(from) }, from: offset + from })
    offset += line.length + 1
  })
  return out
}
