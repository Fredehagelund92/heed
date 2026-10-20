import { Schema, type Mark, type Node } from 'prosemirror-model'
import { parseMarkdown, safeHref, type MarkdownBlock, type MarkdownInline } from '@/lib/markdown'
import { mentionWords } from '@/lib/mention-markup'

/*
  The item body as a ProseMirror document (contract 9.6, FR-119): the safe Markdown subset of
  `lib/markdown.ts` and nothing more. Headings 2 and 3, paragraphs, bulleted and numbered lists
  of one level, quotes, code blocks, bold, italic, inline code, links and @ mentions. The
  document is read with the project's own reader and written back in its dialect, so what the
  editor shows is what the item page draws, and the stored body stays plain Markdown that the
  Source and History tabs diff. Everything here is pure (no view, no DOM), so the round trip is
  unit tested without a browser.
*/

export const bodySchema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: {
      group: 'block',
      content: 'inline*',
      parseDOM: [{ tag: 'p' }],
      toDOM: () => ['p', 0],
    },
    heading: {
      group: 'block',
      content: 'inline*',
      attrs: { level: { default: 2 } },
      defining: true,
      parseDOM: [
        { tag: 'h2', attrs: { level: 2 } },
        { tag: 'h3', attrs: { level: 3 } },
      ],
      toDOM: (node) => [`h${String(node.attrs.level)}`, 0],
    },
    bullet_list: {
      group: 'block',
      content: 'list_item+',
      parseDOM: [{ tag: 'ul' }],
      toDOM: () => ['ul', 0],
    },
    ordered_list: {
      group: 'block',
      content: 'list_item+',
      attrs: { order: { default: 1 } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs: (dom) => ({ order: Number(dom.getAttribute('start') ?? 1) || 1 }),
        },
      ],
      toDOM: (node) => {
        const order = Number(node.attrs.order)
        return ['ol', order === 1 ? {} : { start: order }, 0]
      },
    },
    // One paragraph per item: the reader flattens nested lists, so the editor never makes one.
    list_item: {
      content: 'paragraph',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM: () => ['li', 0],
    },
    // A quote holds what the reader draws inside one: never another quote.
    blockquote: {
      group: 'block',
      content: '(paragraph | heading | bullet_list | ordered_list | code_block)+',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM: () => ['blockquote', 0],
    },
    code_block: {
      group: 'block',
      content: 'text*',
      marks: '',
      code: true,
      defining: true,
      parseDOM: [{ tag: 'pre', preserveWhitespace: 'full' }],
      toDOM: () => ['pre', ['code', 0]],
    },
    text: { group: 'inline' },
    hard_break: {
      group: 'inline',
      inline: true,
      selectable: false,
      leafText: () => '\n',
      parseDOM: [{ tag: 'br' }],
      toDOM: () => ['br'],
    },
    mention: {
      group: 'inline',
      inline: true,
      atom: true,
      selectable: true,
      // A link's words end at the first `]`, so a mention, which has one, cannot sit in a link.
      marks: 'strong em',
      attrs: { target: {}, label: {} },
      leafText: (node) => String(node.attrs.label),
      parseDOM: [
        {
          tag: 'span[data-mention]',
          getAttrs: (dom) => ({
            target: dom.dataset.mention ?? '',
            label: dom.textContent ?? '',
          }),
        },
      ],
      toDOM: (node) => [
        'span',
        { 'data-mention': String(node.attrs.target) },
        String(node.attrs.label),
      ],
    },
  },
  // The order is the nesting the writer uses: a link holds bold, bold holds italic.
  marks: {
    link: {
      attrs: { href: {} },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs: (dom) => {
            const href = safeHref(dom.getAttribute('href') ?? '')
            return href ? { href } : false
          },
        },
      ],
      toDOM: (mark) => ['a', { href: String(mark.attrs.href), rel: 'noopener noreferrer' }, 0],
    },
    strong: {
      parseDOM: [{ tag: 'strong' }, { tag: 'b' }],
      toDOM: () => ['strong', 0],
    },
    em: {
      parseDOM: [{ tag: 'em' }, { tag: 'i' }],
      toDOM: () => ['em', 0],
    },
    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM: () => ['code', 0],
    },
  },
})

const { nodes, marks } = bodySchema

// ---------------------------------------------------------------- Markdown to a document

function inlineNodes(parts: readonly MarkdownInline[], active: readonly Mark[] = []): Node[] {
  return parts.flatMap((part): Node[] => {
    switch (part.type) {
      case 'text':
        return part.text
          .split('\n')
          .flatMap((line, index) => [
            ...(index > 0 ? [nodes.hard_break.create(null, null, active)] : []),
            ...(line ? [bodySchema.text(line, active)] : []),
          ])
      case 'mention':
        return [
          nodes.mention.create(
            { target: part.target, label: part.label },
            null,
            active.filter((mark) => mark.type !== marks.code),
          ),
        ]
      case 'code':
        return part.text ? [bodySchema.text(part.text, marks.code.create().addToSet(active))] : []
      case 'strong':
        return inlineNodes(part.children, marks.strong.create().addToSet(active))
      case 'emphasis':
        return inlineNodes(part.children, marks.em.create().addToSet(active))
      case 'link':
        return inlineNodes(part.children, marks.link.create({ href: part.href }).addToSet(active))
    }
  })
}

/** A list item or a heading holds one line: a line break inside one is a space. */
const oneLine = (parts: readonly MarkdownInline[]) =>
  inlineNodes(parts).map((node) =>
    node.type === nodes.hard_break ? bodySchema.text(' ', node.marks) : node,
  )

function blockNode(block: MarkdownBlock): Node {
  switch (block.type) {
    case 'paragraph':
      return nodes.paragraph.create(null, inlineNodes(block.children))
    case 'heading':
      return nodes.heading.create({ level: block.level }, oneLine(block.children))
    case 'code':
      return nodes.code_block.create(null, block.text ? bodySchema.text(block.text) : null)
    case 'quote':
      return nodes.blockquote.create(
        null,
        block.children.length ? block.children.map(blockNode) : [nodes.paragraph.create()],
      )
    case 'list': {
      const items = block.items.map((item) =>
        nodes.list_item.create(null, nodes.paragraph.create(null, oneLine(item))),
      )
      return block.ordered
        ? nodes.ordered_list.create({ order: block.start }, items)
        : nodes.bullet_list.create(null, items)
    }
  }
}

/** The document for a stored body. Markup outside the subset stays the text that was typed. */
export function markdownToDoc(markdown: string): Node {
  const blocks = parseMarkdown(markdown)
  return nodes.doc.create(null, blocks.length ? blocks.map(blockNode) : [nodes.paragraph.create()])
}

// ---------------------------------------------------------------- A document to Markdown

/** One written character, and whether it is Markdown syntax or text that may need a backslash. */
type Char = { c: string; syntax: boolean; force?: boolean }

const syntax = (text: string): Char[] => [...text].map((c) => ({ c, syntax: true }))
const literal = (text: string): Char[] => [...text].map((c) => ({ c, syntax: false }))

/** Signs the reader takes as text after a backslash (lib/markdown.ts, parseInline). */
const escapable = /[\\`*_[\]()#@!>.+~-]/
const linkAhead = /^\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/
const imageAhead = /^!\[[^\]]*\]\([^)]*\)/

/** A code span: a fence of backticks longer than any run inside, padded if the text touches one. */
function codeSpan(text: string): Char[] {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((run) => run[0].length))
  const fence = '`'.repeat(longest + 1)
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return [
    ...syntax(fence + pad),
    ...literal(text).map((char) => ({ ...char, syntax: true })),
    ...syntax(pad + fence),
  ]
}

/** A link's address, with the brackets the reader would stop at written as escapes. */
const linkHref = (href: string) =>
  href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20')

/**
 * The inline content of a text block as characters. Marks are written outermost first (link,
 * bold, italic), so `**see @[X](metric:x)**` stays one bold run. The reader finds the end of
 * bold and italic by the next marker, so a run whose text holds a `*` is written with `_`.
 */
function inlineChars(children: readonly Node[]): Char[] {
  const linkOf = (node: Node) => marks.link.isInSet(node.marks)?.attrs.href as string | undefined
  const tests = [
    (node: Node) => linkOf(node) !== undefined,
    (node: Node) => marks.strong.isInSet(node.marks) !== undefined,
    (node: Node) => marks.em.isInSet(node.marks) !== undefined,
  ]
  const leaves = (items: readonly Node[]): Char[] =>
    items.flatMap((node) => {
      if (node.type === nodes.hard_break) return syntax('\n')
      if (node.type === nodes.mention)
        return syntax(`@[${mentionWords(String(node.attrs.label))}](${String(node.attrs.target)})`)
      const text = node.text ?? ''
      return marks.code.isInSet(node.marks) ? codeSpan(text) : literal(text)
    })
  const render = (items: readonly Node[], level: number): Char[] => {
    if (level === tests.length) return leaves(items)
    const test = tests[level]!
    const out: Char[] = []
    for (let at = 0; at < items.length;) {
      let end = at + 1
      if (!test(items[at]!)) {
        while (end < items.length && !test(items[end]!)) end++
        out.push(...render(items.slice(at, end), level + 1))
      } else {
        const href = level === 0 ? linkOf(items[at]!) : undefined
        while (
          end < items.length &&
          test(items[end]!) &&
          (level !== 0 || linkOf(items[end]!) === href)
        )
          end++
        const inner = render(items.slice(at, end), level + 1)
        // Spaces at the edges go outside the markers: `*word *` is not italic to the reader.
        let lead = 0
        let trail = inner.length
        while (lead < trail && !inner[lead]!.syntax && /\s/.test(inner[lead]!.c)) lead++
        while (trail > lead && !inner[trail - 1]!.syntax && /\s/.test(inner[trail - 1]!.c)) trail--
        const core = inner.slice(lead, trail)
        out.push(...inner.slice(0, lead))
        if (!core.length) {
          /* Only spaces were marked: they stay plain. */
        } else if (level === 0)
          out.push(...syntax('['), ...core, ...syntax(`](${linkHref(href ?? '')})`))
        else {
          // The reader ends the run at the first marker after it, so pick one the words lack.
          const words = core.map((char) => char.c).join('')
          const options = level === 1 ? ['**', '__'] : ['*', '_']
          const marker =
            options.find((sign) => (words + sign).indexOf(sign) === words.length) ?? options[0]!
          out.push(...syntax(marker), ...core, ...syntax(marker))
        }
        out.push(...inner.slice(trail))
      }
      at = end
    }
    return out
  }
  return render(children, 0)
}

/** Would the reader start bold or italic at the start of `rest` (lib/markdown.ts, parseInline)? */
function opensEmphasis(rest: string, before: string): boolean {
  const char = rest[0]!
  if (rest[1] === char) return rest.indexOf(char + char, 2) > 2
  const close = rest.indexOf(char, 1)
  const inner = rest.slice(1, close)
  return close > 1 && !/^\s|\s$/.test(inner) && !(char === '_' && /\w/.test(before))
}

/** Lines of a paragraph that would start a block of their own: their first sign is escaped. */
const blockStart = /^( {0,3})(?:(#{2,3})[ \t]|([-*+])[ \t]|\d{1,9}([.)])[ \t]|(>)|(~~~))/

function markLineStarts(chars: Char[]) {
  for (let start = 0; start < chars.length;) {
    let end = start
    while (end < chars.length && !(chars[end]!.syntax && chars[end]!.c === '\n')) end++
    const line = chars
      .slice(start, end)
      .map((char) => char.c)
      .join('')
    const found = blockStart.exec(line)
    if (found) {
      const sign = found[2] ?? found[3] ?? found[4] ?? found[5] ?? found[6] ?? ''
      const at = start + line.indexOf(sign, found[1]!.length)
      const char = chars[at]
      if (char && !char.syntax) char.force = true
    }
    start = end + 1
  }
}

/**
 * Writes the characters, putting a backslash before text the reader would otherwise take as
 * syntax and nowhere else, so a body typed in plain words comes back as the same words. Decided
 * from the end, so each choice sees the text after it as it will be written.
 */
function writeChars(chars: readonly Char[]): string {
  let out = ''
  for (let at = chars.length - 1; at >= 0; at--) {
    const { c, syntax: isSyntax, force } = chars[at]!
    if (isSyntax) {
      out = c + out
      continue
    }
    const next = out[0] ?? ''
    const neighbour = (char: Char | undefined) => char?.syntax && (char.c === '*' || char.c === '_')
    let escape = Boolean(force)
    if (c === '\\') escape ||= escapable.test(next)
    else if (c === '`') escape = true
    else if (c === '@') escape ||= next === '['
    else if (c === '[') escape ||= linkAhead.test(c + out)
    else if (c === '!') escape ||= next === '[' && imageAhead.test(c + out)
    else if (c === '*' || c === '_')
      escape ||=
        neighbour(chars[at - 1]) ||
        neighbour(chars[at + 1]) ||
        opensEmphasis(c + out, chars[at - 1]?.c ?? '')
    out = (escape ? '\\' : '') + c + out
  }
  return out
}

/** A heading's closing run of `#` is dropped by the reader, so a heading ending in ` #` escapes it. */
function markHeadingEnd(chars: Char[]) {
  let at = chars.length
  while (at > 0 && !chars[at - 1]!.syntax && chars[at - 1]!.c === '#') at--
  const before = chars[at - 1]
  if (at < chars.length && before && !before.syntax && /[ \t]/.test(before.c))
    chars[at]!.force = true
}

function inlineMarkdown(
  node: Node,
  { lineStarts = false, heading = false }: { lineStarts?: boolean; heading?: boolean } = {},
): string {
  const children: Node[] = []
  node.forEach((child) => children.push(child))
  const chars = inlineChars(children)
  if (lineStarts) markLineStarts(chars)
  if (heading) markHeadingEnd(chars)
  // The reader trims each line, so spaces at a line's end are not stored.
  return writeChars(chars).replace(/[ \t]+$/gm, '')
}

function listItemText(item: Node): string {
  return item.firstChild ? inlineMarkdown(item.firstChild).replace(/\n/g, ' ') : ''
}

function blockMarkdown(block: Node): string {
  switch (block.type.name) {
    case 'heading':
      return `${'#'.repeat(Number(block.attrs.level))} ${inlineMarkdown(block, { heading: true }).replace(/\n/g, ' ')}`
    // An empty item, such as a step of the guide template not written yet, is not stored.
    case 'bullet_list': {
      const lines: string[] = []
      block.forEach((item) => {
        const text = listItemText(item)
        if (text.trim()) lines.push(`- ${text}`)
      })
      return lines.join('\n')
    }
    case 'ordered_list': {
      const lines: string[] = []
      let number = Number(block.attrs.order)
      block.forEach((item) => {
        const text = listItemText(item)
        if (text.trim()) lines.push(`${number++}. ${text}`)
      })
      return lines.join('\n')
    }
    case 'blockquote': {
      const parts: string[] = []
      block.forEach((child) => parts.push(blockMarkdown(child)))
      return parts
        .filter(Boolean)
        .join('\n\n')
        .split('\n')
        .map((line) => (line ? `> ${line}` : '>'))
        .join('\n')
    }
    case 'code_block': {
      const text = block.textContent
      const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length))
      const fence = '`'.repeat(Math.max(3, longest + 1))
      return `${fence}\n${text}\n${fence}`
    }
    default:
      return inlineMarkdown(block, { lineStarts: true })
  }
}

/** The stored body for a document: the reader's dialect, blocks apart by one blank line. */
export function docToMarkdown(doc: Node): string {
  const parts: string[] = []
  doc.forEach((block) => parts.push(blockMarkdown(block)))
  return parts.filter((part) => part.trim() !== '').join('\n\n')
}

/** What the counter counts: the words a reader sees, each mention as its words. */
export function docText(doc: Node): string {
  return doc.textBetween(0, doc.content.size, '\n\n', (leaf) =>
    leaf.type === nodes.mention ? String(leaf.attrs.label) : '\n',
  )
}

export function bodyMentionCount(doc: Node): number {
  let count = 0
  doc.descendants((node) => {
    if (node.type === nodes.mention) count++
  })
  return count
}
