/**
 * The small, safe Markdown subset of item text (contract 9.6, FR-119, NFR-024). Item text is
 * untrusted data, so this parser builds a plain tree of allowed nodes and the renderer
 * (`components/form/markdown.tsx`) turns it into React elements. Nothing is ever passed to the
 * browser as HTML.
 *
 * Shown as formatting: headings 2 and 3, bold, italic, ordered and unordered lists, links to
 * http, https and mailto addresses, inline code, code blocks, block quotes and @ mentions.
 * Everything else stays the text that was typed: images, tables, raw HTML, other headings, and
 * links to any other kind of address (javascript:, data:, relative paths). That way a person
 * sees exactly what was refused instead of having it disappear.
 */

export type MarkdownInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: MarkdownInline[] }
  | { type: 'emphasis'; children: MarkdownInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: MarkdownInline[] }
  | { type: 'mention'; label: string; target: string }

export type MarkdownBlock =
  | { type: 'heading'; level: 2 | 3; children: MarkdownInline[] }
  | { type: 'paragraph'; children: MarkdownInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: MarkdownInline[][] }
  | { type: 'quote'; children: MarkdownBlock[] }
  | { type: 'code'; text: string }

/** Addresses a link may point at. Anything else is shown as the typed text. */
const allowedProtocols = new Set(['http:', 'https:', 'mailto:'])

/** The address a link may open, or null when it is refused. */
export function safeHref(raw: string): string | null {
  const href = raw.trim()
  // Control characters and whitespace inside an address are a classic way to hide a scheme.
  // eslint-disable-next-line no-control-regex
  if (href === '' || /[\u0000- \u007f]/.test(href)) return null
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  return allowedProtocols.has(url.protocol) ? url.href : null
}

const fence = /^ {0,3}(`{3,}|~{3,})/
// A closing run of `#` needs a space before it, so a heading may end in a `#` ("C#").
const heading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const bullet = /^ {0,3}[-*+][ \t]+(.*)$/
const numbered = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/
const quote = /^ {0,3}>[ \t]?(.*)$/
const blank = /^\s*$/

/** Parses item text into blocks. Lines are kept as typed; nothing is dropped. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let at = 0

  while (at < lines.length) {
    const line = lines[at] ?? ''

    if (blank.test(line)) {
      at += 1
      continue
    }

    const open = fence.exec(line)
    if (open) {
      const marker = open[1] ?? '```'
      const closing = new RegExp(
        `^ {0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}[ \\t]*$`,
      )
      const body: string[] = []
      at += 1
      while (at < lines.length && !closing.test(lines[at] ?? '')) {
        body.push(lines[at] ?? '')
        at += 1
      }
      at += 1 // the closing fence, or the end of the text
      blocks.push({ type: 'code', text: body.join('\n') })
      continue
    }

    const title = heading.exec(line)
    if (title && (title[1] === '##' || title[1] === '###')) {
      blocks.push({
        type: 'heading',
        level: title[1] === '##' ? 2 : 3,
        children: parseInline(title[2] ?? ''),
      })
      at += 1
      continue
    }

    if (quote.test(line)) {
      const body: string[] = []
      while (at < lines.length) {
        const match = quote.exec(lines[at] ?? '')
        if (!match) break
        body.push(match[1] ?? '')
        at += 1
      }
      // A quote holds paragraphs and lists, never another quote or a code block.
      const children = parseMarkdown(body.join('\n')).flatMap((block) =>
        block.type === 'quote' ? block.children : [block],
      )
      blocks.push({ type: 'quote', children })
      continue
    }

    const firstBullet = bullet.exec(line)
    const firstNumber = numbered.exec(line)
    if (firstBullet || firstNumber) {
      const ordered = Boolean(firstNumber && !firstBullet)
      const marker = ordered ? numbered : bullet
      const items: string[] = []
      while (at < lines.length) {
        const current = lines[at] ?? ''
        const item = marker.exec(current)
        if (item) {
          items.push((ordered ? item[2] : item[1]) ?? '')
        } else if (!blank.test(current) && /^\s+\S/.test(current) && items.length > 0) {
          // An indented line continues the item above it (nested lists are flattened).
          const nested = bullet.exec(current) ?? numbered.exec(current)
          if (nested) items.push(nested[2] ?? nested[1] ?? '')
          else items[items.length - 1] += ` ${current.trim()}`
        } else {
          break
        }
        at += 1
      }
      blocks.push({
        type: 'list',
        ordered,
        start: ordered ? Number(firstNumber?.[1] ?? 1) : 1,
        items: items.map((item) => parseInline(item)),
      })
      continue
    }

    // A paragraph runs until a blank line or the start of another block. Tables, images,
    // raw HTML and other headings land here and stay as the typed text.
    const body: string[] = []
    while (at < lines.length) {
      const current = lines[at] ?? ''
      if (blank.test(current) || fence.test(current) || quote.test(current)) break
      const isHeading = heading.exec(current)
      if (body.length > 0 && isHeading && (isHeading[1] === '##' || isHeading[1] === '###')) break
      if (body.length > 0 && (bullet.test(current) || numbered.test(current))) break
      body.push(current.trim())
      at += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(body.join('\n')) })
  }

  return blocks
}

/** What an @ mention may point at: a metric, a dimension, a value, an item or a domain. */
export const mentionTarget =
  /(?:metric|dim):[a-z0-9_]+|val:[a-z0-9_]+\/[a-z0-9_]+|item:itm_[a-z0-9]{8,16}|area:[a-z][a-z0-9_-]*/
const mentionToken = new RegExp(`^@\\[([^\\]\\r\\n]{1,120})\\]\\((${mentionTarget.source})\\)`)

/** Parses one run of text: code spans first, then mentions, links, bold and italic. */
export function parseInline(source: string): MarkdownInline[] {
  const nodes: MarkdownInline[] = []
  let text = ''
  const flush = () => {
    if (text) nodes.push({ type: 'text', text })
    text = ''
  }

  for (let at = 0; at < source.length;) {
    const rest = source.slice(at)
    const char = source[at] ?? ''

    // A backslash keeps the next sign as text. `.`, `+` and `~` are here so a line that starts
    // like a numbered or `+` list, or a `~~~` fence, can be written as text (the editor does).
    if (
      char === '\\' &&
      at + 1 < source.length &&
      /[\\`*_[\]()#@!>.+~-]/.test(source[at + 1] ?? '')
    ) {
      text += source[at + 1]
      at += 2
      continue
    }

    if (char === '`') {
      const run = /^`+/.exec(rest)?.[0] ?? '`'
      const close = source.indexOf(run, at + run.length)
      if (close > -1) {
        flush()
        nodes.push({ type: 'code', text: source.slice(at + run.length, close).trim() })
        at = close + run.length
        continue
      }
    }

    if (char === '@') {
      const mention = mentionToken.exec(rest)
      if (mention) {
        flush()
        nodes.push({ type: 'mention', label: mention[1] ?? '', target: mention[2] ?? '' })
        at += mention[0].length
        continue
      }
    }

    // An image is refused: its whole token stays text, so the link inside it is not made live.
    if (char === '!' && source[at + 1] === '[') {
      const image = /^!\[[^\]]*\]\([^)]*\)/.exec(rest)
      if (image) {
        text += image[0]
        at += image[0].length
        continue
      }
    }

    if (char === '[') {
      const link = /^\[([^\]]+)\]\(([^)\s]*)(?:\s+"[^"]*")?\)/.exec(rest)
      if (link) {
        const href = safeHref(link[2] ?? '')
        if (href) {
          flush()
          nodes.push({ type: 'link', href, children: parseInline(link[1] ?? '') })
        } else {
          text += link[0]
        }
        at += link[0].length
        continue
      }
    }

    if ((char === '*' || char === '_') && source[at + 1] === char) {
      const marker = char + char
      const close = source.indexOf(marker, at + 2)
      if (close > at + 2) {
        flush()
        nodes.push({ type: 'strong', children: parseInline(source.slice(at + 2, close)) })
        at = close + 2
        continue
      }
    }

    if (char === '*' || char === '_') {
      const close = source.indexOf(char, at + 1)
      const inner = source.slice(at + 1, close)
      // An underscore inside a word (snake_case) is not emphasis.
      const wordBefore = char === '_' && /\w/.test(source[at - 1] ?? '')
      if (close > at + 1 && !/^\s|\s$/.test(inner) && !wordBefore) {
        flush()
        nodes.push({ type: 'emphasis', children: parseInline(inner) })
        at = close + 1
        continue
      }
    }

    text += char
    at += 1
  }

  flush()
  return nodes
}
