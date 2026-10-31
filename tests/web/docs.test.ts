/// <reference types="node" />
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRODUCT_NAME } from '@domain/brand'
import {
  blocksText,
  CHANGELOG,
  docLinks,
  docsFolder,
  inlineText,
  llmsFullTxt,
  type DocBlock,
  type DocInline,
} from '@domain/docs'
import { readDocs } from '../../scripts/docs-read.ts'
import { wordsToChange } from '@domain/words'
import { format, resolveConfig } from 'prettier'
import { parse } from 'yaml'
import { includeMarkdown } from '@/lib/docs-includes'
import { CHANGES, DOC_PAGES, llmsTxt, searchDocs } from '@/lib/docs'
import { docTitle } from '@/lib/doc-links'
import { docControls } from '../e2e/docs-controls.ts'

/*
  The docs check (docs/help/README.md): mechanical, no model. Wrong docs are worse than none, so
  every page must read, keep to the mockup's twelve pages and What's new, name the app's controls in
  the app's own words (each bold one has a row in tests/e2e/docs-controls.ts, drawn by its spec), link only to pages, headings and screens that exist, and hold the app's own
  lists as they are now. `npm run docs:sync` writes the lists into the pages when they changed.
*/

const files = readdirSync(docsFolder)
  .filter((name) => name.endsWith('.md') && name !== 'README.md')
  .map((name) => ({
    slug: name.replace(/\.md$/, ''),
    path: join(docsFolder, name),
    source: readFileSync(join(docsFolder, name), 'utf8'),
  }))

const read = readDocs(files, (yaml) => parse(yaml))
if (!read.ok) throw new Error(read.reason)
const docs = read.value

/** Every block of a page, the words above its first heading included. */
const pageBlocks = (slug: string): DocBlock[] => {
  if (slug === CHANGELOG) return docs.changelog.changes.flatMap((c) => c.children)
  const page = docs.pages.find((p) => p.slug === slug)!
  return [{ type: 'paragraph', children: page.lead }, ...page.blocks]
}

/** Every bold phrase in some blocks, in the words written. A note's title is not one. */
function boldPhrases(blocks: readonly DocBlock[]): string[] {
  const inline = (nodes: readonly DocInline[]): string[] =>
    nodes.flatMap((node) =>
      node.type === 'strong'
        ? [inlineText(node.children)]
        : 'children' in node
          ? inline(node.children)
          : [],
    )
  return blocks.flatMap((block) => {
    switch (block.type) {
      case 'paragraph':
        return inline(block.children)
      case 'list':
        return block.items.flatMap((item) => boldPhrases(item))
      case 'note':
        return boldPhrases(block.children)
      case 'table':
        return [...block.head, ...block.rows.flat()].flatMap(inline)
      default:
        return []
    }
  })
}

/** The app's addresses as patterns, from its router: `/settings/$section` matches `/settings/agents`. */
const screens = [
  ...readFileSync('src/web/routeTree.gen.ts', 'utf8')
    .split('export interface FileRoutesByTo {')[1]!
    .split('}')[0]!
    .matchAll(/'(\/[^']*)'/g),
]
  .map((m) => m[1]!)
  .filter((path) => path !== '/$')
  .map((path) => new RegExp(`^${path.replace(/\$\w+/g, '[^/]+')}$`))
const isScreen = (address: string) => {
  const path = address.split(/[?#]/)[0]!.replace(/(.)\/$/, '$1')
  return screens.some((pattern) => pattern.test(path))
}

/** An include's region in a page's file: what stands between its two markers. */
const region =
  /(<!--\s*include\s+([a-z-]+)(?::\s*(.+?))?\s*-->\n)([\s\S]*?)(<!--\s*\/include\s*-->)/g
/** A page's file with every include's list as it is now, laid out as Prettier lays it out. */
async function filled(path: string, source: string) {
  const text = source.replace(
    region,
    (all, open: string, name: string, arg: string | undefined, _old: string, close: string) => {
      const markdown = includeMarkdown(name as never, arg ?? '')
      return markdown === null ? all : `${open}\n${markdown}\n\n${close}`
    },
  )
  return format(text, { ...(await resolveConfig(path)), filepath: path })
}

describe('the docs check', () => {
  it("has the mockup's twelve pages, in its order, and What's new", () => {
    expect(DOC_PAGES.map((p) => p.slug)).toEqual([
      'get-started',
      'connect-an-agent',
      'write-context',
      'review-a-suggestion',
      'settle-a-conflict',
      'definitions-and-synonyms',
      'domains-and-owners',
      'integrations',
      'how-agents-use-it',
      'answer-lines',
      'privacy',
      'tools',
    ])
    expect(CHANGES.changes.length).toBeGreaterThan(0)
    expect(files.map((f) => f.slug).sort()).toEqual(
      [...DOC_PAGES.map((p) => p.slug), CHANGELOG].sort(),
    )
  })

  it.each(files)(
    '$slug.md holds the app’s own lists as they are now',
    async ({ slug, path, source }) => {
      const want = await filled(path, source)
      if (process.env.DOCS_SYNC && want !== source)
        writeFileSync(join(docsFolder, `${slug}.md`), want)
      else expect(source, 'run npm run docs:sync').toBe(want)
      for (const block of pageBlocks(slug))
        if (block.type === 'include')
          expect(
            includeMarkdown(block.name, block.arg),
            `${block.name} ${block.arg}`,
          ).not.toBeNull()
    },
  )

  it.each(files)('$slug.md follows the writing rules', ({ source }) => {
    // Plain hyphens only, and no "soon": never promise what is not built.
    expect(source).not.toContain(String.fromCharCode(0x2014))
    expect(source.replace(/^---[\s\S]*?---/, '')).not.toMatch(/\bsoon\b/i)
    // The product is never named in a sentence (docs/design/copy.md); commands keep their names.
    expect(source).not.toMatch(new RegExp(`\\b${DEFAULT_PRODUCT_NAME}\\b`))
  })

  it.each(files)('$slug.md uses the words of the glossary', ({ slug }) => {
    const text = blocksText(
      pageBlocks(slug).filter((b) => b.type !== 'include' && b.type !== 'code'),
    )
    expect(wordsToChange(text).map((w) => `"${w.found}": write ${w.write}`)).toEqual([])
  })

  it('has a rendered check for every bold control: each is a row of docs-controls.ts', () => {
    const missing = files.flatMap(({ slug }) =>
      boldPhrases(pageBlocks(slug))
        .filter((phrase) => !docControls.some((c) => c.page === slug && c.phrase === phrase.trim()))
        .map((phrase) => `${slug}.md: **${phrase}**`),
    )
    expect(missing).toEqual([])
    for (const c of docControls) expect(isScreen(c.at), `${c.page}.md: ${c.at}`).toBe(true)
  })

  it('opens the screen a page is about, and links only to screens that exist', () => {
    const broken = files.flatMap(({ slug }) => {
      const page = DOC_PAGES.find((p) => p.slug === slug)
      const targets = [
        ...(page?.open ? [{ screen: page.open.href }] : []),
        ...docLinks(pageBlocks(slug)),
      ]
      return targets.flatMap((to) =>
        'screen' in to && !isScreen(to.screen) ? [`${slug}.md: ${to.screen}`] : [],
      )
    })
    expect(broken).toEqual([])
  })

  it('refuses a page that links to nothing, or uses what the docs do not draw', () => {
    const page = (body: string) => ({
      slug: 'privacy',
      source: `---\ntitle: Privacy\nline: A line.\ngroup: How it works\norder: 1\nminutes: 1\nreviewed: 2026-10-01\n---\n\n${body}`,
    })
    const changelog = docs.changelog && files.find((f) => f.slug === CHANGELOG)!
    const reason = (body: string) => {
      const result = readDocs([page(body), changelog], (yaml) => parse(yaml))
      return result.ok ? '' : result.reason
    }
    expect(reason('A lead.\n\nSee [the tools](tools.md).')).toMatch(/tools\.md, which is no page/)
    expect(reason('A lead.\n\n[Up](#nowhere)')).toMatch(/no heading there/)
    expect(reason('A lead.\n\n[Out](http://example.com)')).toMatch(/a link to/)
    expect(reason('A lead.\n\n# A title')).toMatch(/## and ###/)
    expect(reason('A lead.\n\n<!-- include nothing -->\n<!-- /include -->')).toMatch(/no include/)
    expect(reason('A lead.\n\n> A note with no title.')).toMatch(/title in bold/)
    expect(reason('A lead.\n\n```\ncode\n```')).toMatch(/says what it is/)
    expect(reason('## No lead')).toMatch(/opens with one paragraph/)
    expect(reason('A lead.\n\n## Here\n\n[Up](#here)')).toBe('')
  })

  it('never says a day in the future, and lists changes newest first', () => {
    for (const p of DOC_PAGES)
      expect(Date.parse(p.reviewed), p.slug).toBeLessThanOrEqual(Date.now())
    for (const c of CHANGES.changes)
      expect(Date.parse(c.date), c.title).toBeLessThanOrEqual(Date.now())
  })
})

describe('the links into the docs', () => {
  // A guide link reads only the titles (lib/doc-links.ts), so the pages stay off the first load.
  it('name every page by its own title, and no page that does not exist', () => {
    for (const p of DOC_PAGES) expect(docTitle(p.slug)).toBe(p.title)
    expect(docTitle('no-such-page')).toBeUndefined()
  })
})

describe('the index for agents', () => {
  it('lists every page once, with its line, and What’s new', () => {
    const index = llmsTxt()
    for (const p of DOC_PAGES) expect(index).toContain(`- [${p.title}](/docs/${p.slug}): ${p.line}`)
    expect(index).toContain(`- [What's new](/docs/changelog)`)
    expect(index.match(/^- \[/gm)).toHaveLength(DOC_PAGES.length + 2)
  })

  it('gives every page whole, with links where the docs site opens them', () => {
    const full = llmsFullTxt(docs, files, '/docs')
    for (const p of DOC_PAGES) expect(full).toContain(`# ${p.title}\n\n> ${p.line}`)
    expect(full).not.toMatch(/<!--|\]\([a-z-]+\.md/)
    expect(full).toContain('claude mcp add --transport http')
  })
})

describe('the docs search', () => {
  it('finds a page by its words, at the heading that holds them', () => {
    expect(searchDocs('synonym')[0]).toMatchObject({ slug: 'definitions-and-synonyms' })
    expect(searchDocs('nothing signs in')[0]).toMatchObject({
      slug: 'connect-an-agent',
      id: 'if-nothing-signs-in',
    })
    expect(searchDocs('get_related')[0]?.slug).toBe('tools')
    expect(searchDocs('')).toEqual([])
    expect(searchDocs('zzzzqq')).toEqual([])
  })
})
