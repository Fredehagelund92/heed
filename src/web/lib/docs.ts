import MiniSearch from 'minisearch'
import { parse as parseYaml } from 'yaml'
import {
  helpAudiences,
  helpFolder,
  helpFrontMatterSchema,
  helpKinds,
  helpLinkOf,
  helpSections,
  helpSlugOf,
  ONE_MINUTE,
  repositoryPath,
  splitHelpPage,
  type HelpAudience,
  type HelpFrontMatter,
  type HelpKind,
} from '@domain/help-pages'
import {
  answerHref,
  parseGfm,
  type AnswerBlock,
  type AnswerInline,
  type LinkTarget,
} from './answer-markdown'
import { REPOSITORY_URL, withProductName, withProductNameIn } from '@domain/brand'
import { currentWords } from '@domain/words'
import { productName } from './brand'

/*
  Heed's help pages (docs/old-help/README.md): Markdown files in the repository, read at build time
  and drawn in the app's Docs area. This module is a chunk of its own, loaded by the docs route,
  its loader and the palette (`docsQuery` in docs-sections.ts), so none of it is in the first
  load. The same files read on GitHub, so links between pages are relative `.md` links and
  pictures are SVG files beside them; here a link opens the page in the app, and a picture is
  drawn inline so it takes the app's tokens in light and dark.

  The pages are trusted files of the repository, checked by tests/unit/old-help.test.ts: the front
  matter, the links, the pictures and the screen words. What a page is (its front matter, its
  headings' anchors, its answer and where its links go) is decided once, in
  src/domain/help-pages.ts, which the service reads the same files with for search_help.
*/

const sources = import.meta.glob<string>(
  ['../../../docs/old-help/*.md', '!../../../docs/old-help/README.md'],
  { query: '?raw', import: 'default', eager: true },
)
const pictureSources = import.meta.glob<string>('../../../docs/old-help/images/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
})

/** The repository the pages live in, for Edit on GitHub and links to its other documents. */
export const docsRepository = REPOSITORY_URL
export const docsFolder = helpFolder

export const docKinds = helpKinds
export type DocKind = HelpKind

export const docKindNames: Record<DocKind, string> = {
  concept: 'Concept',
  guide: 'Guide',
  reference: 'Reference',
  tour: 'Tour',
  glossary: 'Reference',
  faq: 'Common questions',
}

/** The layout a kind takes (docs/old-help/README.md, "How a page is made"). */
export type DocTemplate = 'concept' | 'guide' | 'reference'
export const docTemplates: Record<DocKind, DocTemplate> = {
  concept: 'concept',
  guide: 'guide',
  tour: 'guide',
  reference: 'reference',
  glossary: 'reference',
  faq: 'reference',
}

export const docAudiences = helpAudiences
export type DocAudience = HelpAudience

const audienceNames: Record<DocAudience, string> = {
  everyone: 'everyone',
  owner: 'owners',
  approver: 'approvers',
  administrator: 'admins',
  auditor: 'auditors',
  operator: `people who run ${productName}`,
}

/** The front matter every page starts with. Unknown keys are refused, so a typo is caught. */
export const docFrontMatterSchema = helpFrontMatterSchema
export type DocFrontMatter = HelpFrontMatter

export type DocHeading = { id: string; title: string; depth: number }

export type DocPage = DocFrontMatter & {
  slug: string
  /** The title in the docs' tree and the phone's place line: `short`, or else the title. */
  shortTitle: string
  /** The page's file in the repository. */
  file: string
  /** Who it is for, in words: "For everyone", "For owners and approvers". */
  forWhom: string
  /** A concept's answer in one minute, drawn as the box under its title. */
  oneMinute: AnswerBlock[] | null
  /** Everything else, in order. */
  blocks: AnswerBlock[]
  /** The page's headings, for On this page and for links to a heading. */
  headings: DocHeading[]
}

export type DocHit = {
  slug: string
  title: string
  kind: DocKind
  /** The kind in words, so a reader of a hit needs nothing else from this module. */
  kindName: string
  minutes: number
  /** A heading of the page the words matched under, or none for the page itself. */
  heading: DocHeading | null
  /** Where it opens: the page, at the heading when there is one. */
  href: string
}

export type DocsLibrary = {
  /** Every page, in the order of the sections and then of each page's `order`. */
  pages: DocPage[]
  page: (slug: string) => DocPage | undefined
  search: (query: string, limit?: number) => DocHit[]
}

/** A page's front matter and body, or a reason it cannot be read. */
export const splitPage = (source: string) => splitHelpPage(source, parseYaml)

const slugOf = helpSlugOf
const pictureKeyOf = (path: string) => path.slice(path.indexOf('docs/old-help/'))

export { repositoryPath }

/**
 * Where a link in a page goes: another page of the docs or a heading on one (opened in the app),
 * another document of the repository (on GitHub), a page of Heed, or a safe address.
 */
export function docLink(slug: string, slugs: ReadonlySet<string>) {
  return (url: string): LinkTarget => {
    const target = helpLinkOf(url, slug, slugs)
    if (target === 'missing') return null
    return target ?? answerHref(url)
  }
}

/** The key of a picture a page shows, when the file exists: `docs/old-help/images/mcp-plug.svg`. */
export function docPictureKey(url: string): string | null {
  const path = repositoryPath(url)
  return path && pictures.has(path) ? path : null
}

/**
 * What a picture file may not hold to be drawn inline: a script, an element that loads or links
 * something, an event handler, a link, a CSS address, or an id (which would clash between two
 * pictures on one page).
 */
export const unsafePicture =
  /<(?:script|foreignObject|a|iframe|image|use|link)\b|\son[a-z]+\s*=|href\s*=|url\(|@import|\sid\s*=/i

const svgText = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const pictures = new Map(
  Object.entries(pictureSources).flatMap(([path, svg]) =>
    unsafePicture.test(svg)
      ? []
      : [
          [
            pictureKeyOf(path),
            // Drawn inside a figure that carries the alt text: the drawing itself is hidden from
            // assistive technology, and its title (a tooltip) is left out. A picture names the
            // product with the pages' token too, escaped as the SVG's text.
            withProductName(svg, svgText(productName))
              .replace(/<title>[\s\S]*?<\/title>\s*/, '')
              .replace(' role="img"', ' aria-hidden="true" focusable="false"'),
          ] as const,
        ],
  ),
)

/** A picture's SVG, ready to draw inline, or undefined when there is none by that key. */
export function docPicture(key: string): string | undefined {
  return pictures.get(key)
}

function inlineText(nodes: readonly AnswerInline[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'code':
          return node.text
        case 'break':
          return ' '
        case 'mention':
          return node.label
        default:
          return inlineText(node.children)
      }
    })
    .join('')
}

/** The words of blocks, for search. */
export function blocksText(blocks: readonly AnswerBlock[]): string {
  return blocks
    .map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          return inlineText(block.children)
        case 'list':
          return block.items.map((item) => blocksText(item.children)).join(' ')
        case 'quote':
          return blocksText(block.children)
        case 'code':
          return block.text
        case 'table':
          return [...block.head, ...block.rows.flatMap((row) => row.cells)]
            .map((cell) => inlineText(cell))
            .join(' ')
        case 'figure':
          return [block.alt, block.caption ?? ''].join(' ')
        case 'rule':
          return ''
      }
    })
    .join(' ')
}

function forWhom(audience: readonly DocAudience[]): string {
  const names = audience.map((who) => audienceNames[who])
  const list =
    names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `For ${list}`
}

// A page writes {{product}} where it names the product (docs/old-help/README.md). The name goes into
// the parsed front matter and the body, never through the YAML.
const named = <T>(value: T): T => withProductNameIn(value, productName)

function readPage(path: string, source: string, slugs: ReadonlySet<string>): DocPage | null {
  const split = splitPage(source)
  if (!split.ok) return null
  const meta = docFrontMatterSchema.safeParse(named(split.data))
  if (!meta.success) return null
  const slug = slugOf(path)
  const all = parseGfm(named(split.body), {
    link: docLink(slug, slugs),
    image: docPictureKey,
    headingIds: true,
  })
  // A concept opens with its answer in one minute: the section under that heading.
  let oneMinute: AnswerBlock[] | null = null
  let blocks = all
  const first = all[0]
  if (first?.type === 'heading' && first.depth === 2 && first.id === ONE_MINUTE) {
    const end = all.findIndex((block, index) => index > 0 && block.type === 'heading')
    oneMinute = all.slice(1, end === -1 ? undefined : end)
    blocks = end === -1 ? [] : all.slice(end)
  }
  return {
    ...meta.data,
    slug,
    shortTitle: meta.data.short ?? meta.data.title,
    file: `${docsFolder}/${slug}.md`,
    forWhom: forWhom(meta.data.audience),
    oneMinute,
    blocks,
    headings: blocks.flatMap((block) =>
      block.type === 'heading' && block.id
        ? [{ id: block.id, title: inlineText(block.children), depth: block.depth }]
        : [],
    ),
  }
}

/** What a help link on a screen shows of a page (`lib/help.ts`), before the page itself. */
export type DocExcerpt = {
  /** The heading's words, or the page's title. */
  title: string
  blocks: AnswerBlock[]
  /** The whole page, at the heading when there is one. */
  href: string
}

/**
 * The few lines a help link shows. At a heading: the words under it, or, for a group of terms
 * with nothing above them (a glossary section), each term and its first sentence. On a page: a
 * concept's answer in one minute, or else the page's first section. Pictures are left out: the
 * help is narrow, and the page has them. Null when the page has no such heading.
 */
export function docExcerpt(page: DocPage, headingId?: string): DocExcerpt | null {
  const shown = (blocks: readonly AnswerBlock[]) =>
    blocks.filter((block) => block.type !== 'figure')
  const nextHeading = (from: number, depth = Infinity) => {
    const at = page.blocks.findIndex(
      (block, index) => index > from && block.type === 'heading' && block.depth <= depth,
    )
    return at === -1 ? page.blocks.length : at
  }
  if (!headingId) {
    if (page.oneMinute)
      return { title: page.title, blocks: shown(page.oneMinute), href: `/docs/${page.slug}` }
    const first = page.blocks.findIndex((block) => block.type === 'heading')
    const intro = first === -1 ? page.blocks : page.blocks.slice(0, first)
    const blocks = shown(
      intro.length || first === -1 ? intro : page.blocks.slice(first + 1, nextHeading(first)),
    )
    return { title: page.title, blocks, href: `/docs/${page.slug}` }
  }
  const at = page.blocks.findIndex((block) => block.type === 'heading' && block.id === headingId)
  const heading = page.blocks[at]
  if (heading?.type !== 'heading') return null
  const href = `/docs/${page.slug}#${headingId}`
  const own = shown(page.blocks.slice(at + 1, nextHeading(at)))
  if (own.length) return { title: inlineText(heading.children), blocks: own, href }
  const terms = page.blocks
    .slice(at + 1, nextHeading(at, heading.depth))
    .flatMap((block, index, section): AnswerBlock[] => {
      if (block.type !== 'heading') return []
      const sentence = section.slice(index + 1).find((next) => next.type !== 'figure')
      return [
        {
          type: 'paragraph',
          children: [
            { type: 'strong', children: block.children },
            ...(sentence?.type === 'paragraph'
              ? [{ type: 'text' as const, text: ': ' }, ...sentence.children]
              : []),
          ],
        },
      ]
    })
  return {
    title: inlineText(heading.children),
    blocks: terms.length
      ? [
          {
            type: 'list',
            ordered: false,
            start: 1,
            items: terms.map((term) => ({ checked: null, children: [term] })),
          },
        ]
      : [],
    href,
  }
}

type SearchEntry = {
  id: string
  slug: string
  headingId: string
  title: string
  heading: string
  text: string
}

function buildSearch(pages: readonly DocPage[]) {
  const index = new MiniSearch<SearchEntry>({
    fields: ['title', 'heading', 'text'],
    storeFields: ['slug', 'headingId'],
    searchOptions: {
      boost: { title: 4, heading: 3, text: 1 },
      prefix: true,
      fuzzy: (term) => (term.length >= 5 ? 1 : false),
      combineWith: 'AND',
      // A page whose own words match leads the headings on it.
      boostDocument: (_id, _term, stored) => (stored?.headingId ? 1 : 2),
    },
  })
  for (const page of pages) {
    // The page itself, by its title, summary and answer in one minute.
    index.add({
      id: page.slug,
      slug: page.slug,
      headingId: '',
      title: page.title,
      heading: '',
      text: [page.summary, blocksText(page.oneMinute ?? [])].join(' '),
    })
    // Each section under a heading, with its words, so a glossary term opens at its heading.
    page.blocks.forEach((block, at) => {
      if (block.type !== 'heading' || !block.id) return
      const next = page.blocks.findIndex(
        (other, index) => index > at && other.type === 'heading' && other.depth <= block.depth,
      )
      index.add({
        id: `${page.slug}#${block.id}`,
        slug: page.slug,
        headingId: block.id,
        title: page.title,
        heading: inlineText(block.children),
        text: blocksText(page.blocks.slice(at + 1, next === -1 ? undefined : next)),
      })
    })
  }
  return index
}

/** Every page of the docs, read and checked once. */
export function docsLibrary(): DocsLibrary {
  const slugs = new Set(Object.keys(sources).map(slugOf))
  const sectionOrder = new Map(helpSections.map((section, index) => [section.id, index]))
  const pages = Object.entries(sources)
    .flatMap(([path, source]) => readPage(path, source, slugs) ?? [])
    .sort(
      (a, b) =>
        sectionOrder.get(a.section)! - sectionOrder.get(b.section)! ||
        a.order - b.order ||
        a.title.localeCompare(b.title),
    )
  const bySlug = new Map(pages.map((page) => [page.slug, page]))
  let index: MiniSearch<SearchEntry> | null = null
  return {
    pages,
    page: (slug) => bySlug.get(slug),
    search: (query, limit = 5) => {
      if (!query.trim()) return []
      index ??= buildSearch(pages)
      const hits: DocHit[] = []
      const seen = new Set<string>()
      for (const result of index.search(currentWords(query))) {
        const page = bySlug.get(String(result.slug))
        if (!page) continue
        const headingId = String(result.headingId)
        const heading = headingId
          ? (page.headings.find((entry) => entry.id === headingId) ?? null)
          : null
        // A page shows once: at its best match.
        if (seen.has(page.slug)) continue
        seen.add(page.slug)
        hits.push({
          slug: page.slug,
          title: page.title,
          kind: page.kind,
          kindName: docKindNames[page.kind],
          minutes: page.minutes,
          heading,
          href: heading ? `/docs/${page.slug}#${heading.id}` : `/docs/${page.slug}`,
        })
        if (hits.length === limit) break
      }
      return hits
    },
  }
}
