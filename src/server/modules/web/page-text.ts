import { matchForm } from '../../../domain/quote-match.ts'

/*
  A web page's words as plain text: the bytes decoded in the page's own character set, the
  markup, scripts and styles dropped, entities decoded, one paragraph per block. Official pages
  are often old: some serve Windows-1252 with no charset anywhere and write
  "Art. 1º&nbsp;Ficam", so a strict UTF-8 read would garble every accent and no quote would ever
  match. Nothing here runs the page's code or follows anything it says: it is text, kept in memory
  for one tool call and never stored (FR-116).
*/

/** The character set a page's bytes are in: its header, a byte order mark, its meta tag, or a guess. */
export function charsetOf(bytes: Uint8Array, contentType: string | undefined): string {
  const declared = (label: string | undefined) => {
    if (!label) return null
    try {
      return new TextDecoder(label.trim().replace(/^["']|["']$/g, '')).encoding
    } catch {
      return null
    }
  }
  const header = declared(/charset=([^;]+)/i.exec(contentType ?? '')?.[1])
  if (header) return header
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 'utf-8'
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le'
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be'
  // The meta tag sits in the first bytes, in ASCII whatever the page's set.
  const head = new TextDecoder('windows-1252').decode(bytes.subarray(0, 4096))
  const meta = declared(
    /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ??
      /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w.:-]+)/i.exec(head)?.[1],
  )
  if (meta) return meta
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return 'utf-8'
  } catch {
    // Bytes that are not UTF-8 and name no set: the old Western default, as browsers read them.
    return 'windows-1252'
  }
}

export const decodePage = (bytes: Uint8Array, contentType: string | undefined) =>
  new TextDecoder(charsetOf(bytes, contentType)).decode(bytes)

/** The named entities a page writes: Latin-1's letters and signs, and the common punctuation. */
const latin1Names =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml'.split(
    ' ',
  )
const entities = new Map<string, number>([
  ...latin1Names.map((name, index) => [name, 160 + index] as const),
  ['amp', 38],
  ['lt', 60],
  ['gt', 62],
  ['quot', 34],
  ['apos', 39],
  ['OElig', 338],
  ['oelig', 339],
  ['Scaron', 352],
  ['scaron', 353],
  ['circ', 710],
  ['tilde', 732],
  ['ensp', 8194],
  ['emsp', 8195],
  ['thinsp', 8201],
  ['zwnj', 8204],
  ['zwj', 8205],
  ['lrm', 8206],
  ['rlm', 8207],
  ['ndash', 8211],
  ['mdash', 8212],
  ['lsquo', 8216],
  ['rsquo', 8217],
  ['sbquo', 8218],
  ['ldquo', 8220],
  ['rdquo', 8221],
  ['bdquo', 8222],
  ['dagger', 8224],
  ['Dagger', 8225],
  ['bull', 8226],
  ['hellip', 8230],
  ['permil', 8240],
  ['euro', 8364],
  ['trade', 8482],
])

/** Text with its character references read: `&ccedil;`, `&#231;` and `&#xE7;` are all ç. */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,8});?/gi,
    (whole, name: string) => {
      const code =
        name[0] === '#'
          ? Number.parseInt(
              name.slice(name[1] === 'x' || name[1] === 'X' ? 2 : 1),
              name[1] === 'x' || name[1] === 'X' ? 16 : 10,
            )
          : entities.get(name)
      if (code === undefined || !Number.isFinite(code) || code > 0x10ffff || code === 0)
        return whole
      if (code >= 0xd800 && code <= 0xdfff) return whole
      return String.fromCodePoint(code)
    },
  )
}

/** Elements whose content is never words a reader sees in the page; the title is read apart. */
const dropped: ReadonlySet<string> = new Set([
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'math',
  'iframe',
  'object',
  'head',
  'title',
  'nav',
  'select',
])
/** Elements that start a new paragraph. */
const blocks: ReadonlySet<string> = new Set(
  'address article aside blockquote br caption dd div dl dt fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hr li main ol p pre section table tbody thead tfoot tr ul'.split(
    ' ',
  ),
)

export type PageText = { title: string | null; paragraphs: string[] }

/** Collapses a line's spaces, the no-break space among them. */
const line = (text: string) => text.replace(/[\s\u00a0]+/g, ' ').trim()

/** Whether a character code is an ASCII letter or digit. */
const alphanumeric = (code: number) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)

/** The name of the tag that starts at `<`, lower case, or '' when it is no tag. */
function tagName(html: string, at: number): string {
  let end = at + 1
  if (html.charCodeAt(end) === 47) end++
  const start = end
  while (end < html.length && alphanumeric(html.charCodeAt(end))) end++
  return html.slice(start, end).toLowerCase()
}

/** Marks where a block starts while the words are gathered; never in a page's own text. */
const BREAK = String.fromCharCode(0)

/**
 * The words of an HTML page, one block per line, in one pass from the start to the end: an
 * element left open, a comment never closed or a stray `<` costs no second look at the rest, so a
 * hostile page of 2 MB is read in linear time. Not a full HTML parser: enough to read a page's text.
 */
function markupText(page: string): string {
  const html = page.replaceAll(BREAK, '')
  const lower = html.toLowerCase()
  const out: string[] = []
  let at = 0
  while (at < html.length) {
    const open = html.indexOf('<', at)
    if (open < 0) {
      out.push(html.slice(at))
      break
    }
    // A "<" that starts no tag ("a < b", "3<4") is text: a tag starts with a letter.
    const next = html.charCodeAt(open + 1)
    const letter = (next >= 65 && next <= 90) || (next >= 97 && next <= 122)
    if (!(letter || next === 47 || next === 33 || next === 63)) {
      const following = html.indexOf('<', open + 1)
      const stop = following < 0 ? html.length : following
      out.push(html.slice(at, stop))
      at = stop
      continue
    }
    out.push(html.slice(at, open))
    if (html.startsWith('<!--', open)) {
      const close = html.indexOf('-->', open + 4)
      at = close < 0 ? html.length : close + 3
      out.push(' ')
      continue
    }
    const end = html.indexOf('>', open + 1)
    // No tag ends after it: the rest is a broken tag, never words.
    if (end < 0) break
    const name = tagName(html, open)
    at = end + 1
    if (next !== 47 && dropped.has(name)) {
      const close = lower.indexOf(`</${name}`, at)
      const closeEnd = close < 0 ? -1 : html.indexOf('>', close)
      at = closeEnd < 0 ? html.length : closeEnd + 1
      out.push(' ')
    } else out.push(blocks.has(name) ? BREAK : name === 'td' || name === 'th' ? ' ' : '')
  }
  // A line break in the markup is a space: only blocks start a paragraph.
  return out.join('').replace(/\s+/g, ' ').replaceAll(BREAK, '\n')
}

/** A page's title and paragraphs. `kind` says whether the text is HTML or plain text. */
export function pageText(body: string, kind: 'html' | 'text'): PageText {
  if (kind === 'text')
    return {
      title: null,
      paragraphs: body
        .split(/\r?\n\s*\r?\n|\r?\n/)
        .map(line)
        .filter(Boolean),
    }
  const lower = body.toLowerCase()
  const titleStart = lower.indexOf('<title')
  const titleOpen = titleStart < 0 ? -1 : body.indexOf('>', titleStart)
  const titleEnd = titleOpen < 0 ? -1 : lower.indexOf('</title', titleOpen)
  const title =
    titleEnd < 0 ? '' : line(decodeEntities(markupText(body.slice(titleOpen + 1, titleEnd))))
  const paragraphs = decodeEntities(markupText(body)).split('\n').map(line).filter(Boolean)
  return { title: title || null, paragraphs }
}

/** The longest passage handed on whole; a longer paragraph is cut at its sentences. */
const MAX_PASSAGE = 1500

function pieces(paragraph: string): string[] {
  if (paragraph.length <= MAX_PASSAGE) return [paragraph]
  const out: string[] = []
  let current = ''
  for (const sentence of paragraph.split(/(?<=[.!?;:])\s+/)) {
    if (current && current.length + sentence.length + 1 > MAX_PASSAGE) {
      out.push(current)
      current = ''
    }
    current = current ? `${current} ${sentence}` : sentence
    while (current.length > MAX_PASSAGE) {
      out.push(current.slice(0, MAX_PASSAGE))
      current = current.slice(MAX_PASSAGE)
    }
  }
  if (current) out.push(current)
  return out
}

/** Words without their accents, as a person types them when they look for a word. */
const plain = (text: string) => matchForm(text).normalize('NFD').replace(/\p{M}/gu, '')

/**
 * The passages to hand on within `budget` characters: every paragraph when the page is short;
 * otherwise the ones that hold most of the words looked for (a law's number, a name), in the
 * page's order, after the opening paragraphs; without words, the page from its start.
 */
export function passages(
  paragraphs: readonly string[],
  lookFor: string | undefined,
  budget: number,
): { passages: string[]; truncated: boolean } {
  const all = paragraphs.flatMap(pieces)
  const total = all.reduce((sum, text) => sum + text.length, 0)
  if (total <= budget) return { passages: all, truncated: false }
  const terms = [
    ...new Set(
      plain(lookFor ?? '')
        .split(/[^\p{L}\p{N}.,/-]+/u)
        .map((term) => term.replace(/^[.,/-]+|[.,/-]+$/g, ''))
        .filter((term) => term.length >= 3 || /\d/.test(term)),
    ),
  ]
  const scores = all.map((text) => {
    const words = plain(text)
    return terms.filter((term) => words.includes(term)).length
  })
  const order = all.map((_, index) => index)
  const found = order
    .filter((index) => scores[index]! > 0)
    .sort((a, b) => scores[b]! - scores[a]! || a - b)
  const ranked = found.length
    ? [
        // The opening says what the page is; a found passage's neighbours say what it means.
        ...order.slice(0, 2),
        ...found,
        ...found.flatMap((index) => [index - 1, index + 1]).filter((index) => index >= 0),
        ...order,
      ]
    : order
  const chosen = new Set<number>()
  let used = 0
  for (const index of ranked) {
    if (chosen.has(index) || index >= all.length) continue
    const size = all[index]!.length
    if (used + size > budget) continue
    chosen.add(index)
    used += size
    if (used >= budget) break
  }
  return {
    passages: [...chosen].sort((a, b) => a - b).map((index) => all[index]!),
    truncated: true,
  }
}
