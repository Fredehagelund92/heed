import * as z from 'zod/mini'
import { REPOSITORY_URL } from './brand.ts'
import { stem } from './context-search.ts'
import { headingIds } from './heading-anchors.ts'
import { helpSectionIds } from './help-sections.ts'
import { currentWords } from './words.ts'

export { headingIds, headingSlug } from './heading-anchors.ts'
export { helpSectionIds, helpSections, type HelpSectionId } from './help-sections.ts'

/*
  Heed's help pages (docs/help/README.md) as one page model: what a page's front matter holds,
  the anchor each heading gets, a page's answer and its sections, where its links go, and the
  search that ranks its sections by a question's words. The Docs area draws the pages from it
  (web/lib/docs.ts) and the service answers "how does Heed work" from it (search_help, for the
  assistant and for agents over MCP), so a question gets the same page everywhere, with the same
  link. The files are read by each side as it can (the build, the disk); this module only reads
  text it is given. Pure: no input or output, no clock.
*/

export const helpFolder = 'docs/help'

export const helpKinds = ['concept', 'guide', 'reference', 'tour', 'glossary', 'faq'] as const
export type HelpKind = (typeof helpKinds)[number]

export const helpAudiences = [
  'everyone',
  'owner',
  'approver',
  'administrator',
  'auditor',
  'operator',
] as const
export type HelpAudience = (typeof helpAudiences)[number]

/** The front matter every page starts with. Unknown keys are refused, so a typo is caught. */
export const helpFrontMatterSchema = z.strictObject({
  title: z.string().check(z.minLength(1)),
  /** A long title cut to what the docs' tree and the phone's place line hold. */
  short: z.optional(z.string().check(z.minLength(1), z.maxLength(32))),
  kind: z.enum(helpKinds),
  section: z.enum(helpSectionIds),
  order: z.number().check(z.int(), z.minimum(1)),
  summary: z.string().check(z.minLength(1), z.maxLength(120)),
  audience: z.array(z.enum(helpAudiences)).check(z.minLength(1)),
  minutes: z.number().check(z.int(), z.minimum(1), z.maximum(30)),
  owner: z.string().check(z.minLength(1)),
  /** The day someone last checked the page against the app. */
  reviewed: z.iso.date(),
  screens: z.array(z.string().check(z.regex(/^\//))),
  related: z.optional(z.array(z.string())),
})
export type HelpFrontMatter = z.infer<typeof helpFrontMatterSchema>

const frontMatter = /^---\n([\s\S]*?)\n---\n/

/**
 * A page's front matter and body, or a reason it cannot be read. The front matter is YAML, read
 * by the caller's own reader (`parse`).
 */
export function splitHelpPage(
  source: string,
  parse: (yaml: string) => unknown,
): { ok: true; data: unknown; body: string } | { ok: false; reason: string } {
  const text = source.replace(/\r\n?/g, '\n')
  const match = frontMatter.exec(text)
  if (!match) return { ok: false, reason: 'no front matter' }
  try {
    return { ok: true, data: parse(match[1]!), body: text.slice(match[0].length) }
  } catch (error) {
    return { ok: false, reason: `front matter is not YAML: ${String(error)}` }
  }
}

/** A page's slug from its file's path: `docs/help/mcp.md` is `mcp`. */
export const helpSlugOf = (path: string) =>
  path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '')

/** Where a page opens in the app, at a heading when there is one: `/docs/mcp#go-deeper`. */
export const helpPath = (slug: string, heading = '') =>
  heading ? `/docs/${slug}#${heading}` : `/docs/${slug}`

const root = 'https://heed.invalid/repository/'

/**
 * A path in the repository that a page's relative link points at, such as `docs/help/mcp.md`
 * with its hash, or null for an address that is not relative or leaves the repository.
 */
export function repositoryPath(url: string, from = `${helpFolder}/page.md`): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/') || url.startsWith('#')) return null
  try {
    const resolved = new URL(url, root + from)
    if (!resolved.href.startsWith(root)) return null
    return (
      decodeURIComponent(resolved.pathname.slice(new URL(root).pathname.length)) + resolved.hash
    )
  } catch {
    return null
  }
}

/**
 * Where a link written in a page goes, when the pages decide it: a heading on the page or another
 * page (opened in the app), or another document of the repository (on GitHub). `missing` for a
 * page or a file outside the repository that does not exist as a page; null for any other address
 * (a screen of Heed, a web address), which the reader decides.
 */
export function helpLinkOf(
  url: string,
  slug: string,
  slugs: ReadonlySet<string>,
): { href: string; internal: boolean } | 'missing' | null {
  if (url.startsWith('#')) return { href: `/docs/${slug}${url}`, internal: true }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('/')) return null
  const path = repositoryPath(url)
  if (!path) return 'missing'
  const [file = '', hash = ''] = path.split(/(?=#)/)
  const page = new RegExp(`^${helpFolder}/([a-z0-9-]+)\\.md$`).exec(file)
  if (page)
    return slugs.has(page[1]!) ? { href: `/docs/${page[1]}${hash}`, internal: true } : 'missing'
  return { href: `${REPOSITORY_URL}/blob/main/${file}${hash}`, internal: false }
}

/** The id of the heading a concept opens with: its answer in one minute. */
export const ONE_MINUTE = 'in-one-minute'

/** One part of a page: its heading and the words under it, up to the next heading. */
export type HelpSection = {
  /** The heading's anchor; empty for the words above the first heading. */
  id: string
  /** The heading's words; empty for the words above the first heading. */
  heading: string
  /** 2 for `##`, 3 for `###`; 0 for the words above the first heading. */
  depth: number
  /**
   * The words as Markdown, with each link where the app opens it (an address that is no page
   * becomes its words) and each picture as the words of its alt text.
   */
  text: string
}

export type HelpPage = HelpFrontMatter & {
  slug: string
  /** Where it opens in the app. */
  path: string
  /** Every part of the page, in order: the words above the first heading, when there are any. */
  sections: HelpSection[]
  /**
   * The page's answer, at its top: a concept's In one minute, or else the words above the first
   * heading, or else the first section with words. It is what a help link shows of the page.
   */
  answer: HelpSection | null
}

const fenceOpen = /^ {0,3}(`{3,}|~{3,})/
const atxHeading = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/

/** A heading's words without their formatting, as GitHub reads them for its anchor. */
function plainHeading(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__|\*|_|~~)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .trim()
}

// A link or a picture: its words, its address and an optional title in quotes.
const linkOrPicture = /(!?)\[([^\]]*)\]\(\s*([^)\s]+)(?:\s+(?:'[^']*'|"[^"]*"))?\s*\)/g

/** A section's words as the reader gets them: links where the app opens them, pictures as words. */
function readableText(
  lines: readonly string[],
  slug: string,
  slugs: ReadonlySet<string>,
  screen: (path: string) => string,
): string {
  let fence: string | null = null
  return lines
    .map((line) => {
      const open = fenceOpen.exec(line)?.[1]
      if (fence) {
        if (open && open[0] === fence[0] && open.length >= fence.length) fence = null
        return line
      }
      if (open) {
        fence = open
        return line
      }
      return line.replace(linkOrPicture, (_whole, bang: string, words: string, url: string) => {
        if (bang) return words
        const target = helpLinkOf(url, slug, slugs)
        if (target === 'missing') return words
        if (target) return `[${words}](${target.internal ? screen(target.href) : target.href})`
        if (url.startsWith('/')) return `[${words}](${screen(url)})`
        return /^(?:https?|mailto):/i.test(url) ? `[${words}](${url})` : words
      })
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** One line of a page as a person reads it, with its line number in the file. */
export type HelpLine = { line: number; text: string }

/**
 * What a person reads of a page, line by line: the title, short title and summary of its front
 * matter, then each line of its body without fenced code, comments, link addresses or emphasis
 * marks. Code spans stay, marked, for the reader of the words to leave alone
 * (src/domain/words.ts, `wordsToChange`).
 */
export function helpPageLines(source: string): HelpLine[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1
  const read: HelpLine[] = []
  lines.slice(1, Math.max(end, 1)).forEach((text, at) => {
    const field = /^(title|short|summary):\s*(.*)$/.exec(text)
    if (field) read.push({ line: at + 2, text: field[2]!.replace(/^(["'])(.*)\1$/, '$2') })
  })
  let fence: string | null = null
  let comment = false
  lines.forEach((text, at) => {
    if (at <= end) return
    const open = fenceOpen.exec(text)?.[1]
    if (fence) {
      if (open && open[0] === fence[0] && open.length >= fence.length) fence = null
      return
    }
    if (open) {
      fence = open
      return
    }
    let words = text
    if (comment) {
      const close = words.indexOf('-->')
      if (close === -1) return
      words = words.slice(close + 3)
      comment = false
    }
    words = words.replace(/<!--[\s\S]*?-->/g, ' ')
    if (words.includes('<!--')) {
      words = words.slice(0, words.indexOf('<!--'))
      comment = true
    }
    words = words
      .replace(linkOrPicture, (_whole, _bang: string, inner: string) => inner)
      .replace(/(\*\*|\*|~~)(?=\S)(.*?\S)\1/g, '$2')
      .replace(/(?<![\p{L}\p{N}])(__|_)(?=\S)(.*?\S)\1(?![\p{L}\p{N}])/gu, '$2')
    if (words.trim()) read.push({ line: at + 1, text: words })
  })
  return read
}

/**
 * Reads one page: its front matter checked, then its body cut at every heading. `screen` turns a
 * path of the app (`/docs/mcp`, `/settings?section=connect`) into the address the reader opens:
 * the path itself in the app, the web app's address and the path for an agent.
 */
export function readHelpPage(
  slug: string,
  data: unknown,
  body: string,
  slugs: ReadonlySet<string>,
  screen: (path: string) => string = (path) => path,
): { ok: true; page: HelpPage } | { ok: false; reason: string } {
  const meta = helpFrontMatterSchema.safeParse(data)
  if (!meta.success)
    return {
      ok: false,
      reason: meta.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; '),
    }
  const ids = headingIds()
  const parts: { id: string; heading: string; depth: number; lines: string[] }[] = [
    { id: '', heading: '', depth: 0, lines: [] },
  ]
  let fence: string | null = null
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const open = fenceOpen.exec(line)?.[1]
    if (fence) {
      if (open && open[0] === fence[0] && open.length >= fence.length) fence = null
    } else if (open) fence = open
    else {
      const heading = atxHeading.exec(line)
      if (heading) {
        const words = plainHeading(heading[2]!)
        parts.push({ id: ids(words), heading: words, depth: heading[1]!.length, lines: [] })
        continue
      }
    }
    parts.at(-1)!.lines.push(line)
  }
  const sections = parts
    .map((part) => ({
      id: part.id,
      heading: part.heading,
      depth: part.depth,
      text: readableText(part.lines, slug, slugs, screen),
    }))
    .filter((section) => section.depth > 0 || section.text)
  const answer =
    sections.find((section) => section.id === ONE_MINUTE && section === sections[0]) ??
    sections.find((section) => section.depth === 0) ??
    sections.find((section) => section.text) ??
    null
  return {
    ok: true,
    page: { ...meta.data, slug, path: screen(helpPath(slug)), sections, answer },
  }
}

/** A section a search found, with its page and how well it matched. */
export type HelpHit = { page: HelpPage; section: HelpSection; score: number }

// Words that carry no meaning in a question about Heed: function words and question words.
const stopWords = new Set(
  (
    'a about after all also am an and any are as at be been being but by can could did do does ' +
    'doing done for from had has have how i if in into is it its me my no not of on or our please ' +
    'should so some than that the their them then there these they this those to us very was we ' +
    'were what when where which while who whom why will with would you your'
  ).split(' '),
)

/** A word in a plain form: "editions" and "edition", "connecting" and "connect", "stopped" and "stop". */
function helpStem(word: string): string {
  const w = stem(word)
  const cut = /(?:ing|ed)$/.exec(w)
  if (!cut || w.length - cut[0].length < 3) return w
  const base = w.slice(0, -cut[0].length)
  // A doubled last letter goes back to one: "stopped", "stopping".
  return /([b-df-hj-np-tv-z])\1$/.test(base) && !/(?:ss|ll)$/.test(base) ? base.slice(0, -1) : base
}

/** The words of a text that mean something, each in its plain form. */
export function helpTerms(text: string): string[] {
  return (
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .match(/[\p{L}\p{N}']+/gu) ?? []
  )
    .map((word) => word.replace(/^'+|'+$/g, ''))
    .filter((word) => word && !stopWords.has(word))
    .map(helpStem)
}

// BM25's two settings, at their usual values.
const K1 = 1.2
const B = 0.75
// How much a word counts in each part: a heading names what the section is about, the page's
// title what the page is about.
const HEADING_WEIGHT = 3
const TITLE_WEIGHT = 2
/** A page's answer answers its title's question, so it leads the sections that say as much. */
const ANSWER_BOOST = 1.5
/**
 * A question whose words are a heading's, or a page's title's for its answer, asks about just
 * that: "What is a gap?" is the glossary's Gap, "What is Heed?" the page What is Heed.
 */
const NAMED_BOOST = 2

export type HelpIndex = {
  pages: readonly HelpPage[]
  /**
   * The sections that best match a question's words, best first, ranked with BM25: at most
   * `perPage` from one page. None when no word of the question is in the pages.
   */
  search: (query: string, options?: { limit?: number; perPage?: number }) => HelpHit[]
}

/**
 * Every section of the pages, ready to be searched by a question's words. `product` is the
 * product's name (src/domain/brand.ts): every page is about it, so its words decide nothing when a
 * question has others ("Does Heed keep my questions?" asks about keeping questions), and only a
 * question of nothing else ("What is Heed?") is searched by them.
 */
export function helpIndex(pages: readonly HelpPage[], product = ''): HelpIndex {
  const productTerms = new Set(helpTerms(product))
  const entries = pages.flatMap((page) =>
    page.sections
      .filter((section) => section.text)
      .map((section) => {
        const isAnswer = section === page.answer
        const counts = new Map<string, number>()
        const add = (text: string, weight: number) => {
          for (const term of helpTerms(text)) counts.set(term, (counts.get(term) ?? 0) + weight)
        }
        add(section.text, 1)
        add(section.heading, HEADING_WEIGHT)
        add([page.title, page.short ?? '', isAnswer ? page.summary : ''].join(' '), TITLE_WEIGHT)
        const length = [...counts.values()].reduce((sum, n) => sum + n, 0)
        const named = [
          helpTerms(section.heading),
          ...(isAnswer ? [helpTerms(page.title), helpTerms(page.short ?? '')] : []),
        ].filter((terms) => terms.length > 0)
        return { page, section, counts, length, named, boost: isAnswer ? ANSWER_BOOST : 1 }
      }),
  )
  const average = entries.reduce((sum, entry) => sum + entry.length, 0) / (entries.length || 1)
  const holding = new Map<string, number>()
  for (const entry of entries)
    for (const term of entry.counts.keys()) holding.set(term, (holding.get(term) ?? 0) + 1)
  const idf = (term: string) => {
    const n = holding.get(term) ?? 0
    return Math.log(1 + (entries.length - n + 0.5) / (n + 0.5))
  }
  return {
    pages,
    search(query, { limit = 3, perPage = 2 } = {}) {
      const asked = [...new Set(helpTerms(currentWords(query)))]
      const rest = asked.filter((term) => !productTerms.has(term))
      const terms = rest.length ? rest : asked
      if (!terms.length) return []
      const scored = entries
        .map((entry) => {
          let score = 0
          for (const term of terms) {
            const tf = entry.counts.get(term) ?? 0
            if (!tf) continue
            score +=
              (idf(term) * tf * (K1 + 1)) /
              (tf + K1 * (1 - B + (B * entry.length) / (average || 1)))
          }
          const named = entry.named.some(
            (words) =>
              words.every((word) => terms.includes(word)) &&
              terms.every((word) => words.includes(word)),
          )
          return {
            page: entry.page,
            section: entry.section,
            score: score * entry.boost * (named && score > 0 ? NAMED_BOOST : 1),
          }
        })
        .filter((hit) => hit.score > 0)
        // Ties keep the pages' own order, so a search is the same every time.
        .sort((a, b) => b.score - a.score)
      const hits: HelpHit[] = []
      const fromPage = new Map<string, number>()
      for (const hit of scored) {
        const count = fromPage.get(hit.page.slug) ?? 0
        if (count >= perPage) continue
        fromPage.set(hit.page.slug, count + 1)
        hits.push(hit)
        if (hits.length === limit) break
      }
      return hits
    },
  }
}
