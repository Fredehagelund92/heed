import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRODUCT_NAME, PRODUCT_TOKEN } from '@domain/brand'
import { headingSlug } from '@domain/heading-anchors'
import { helpPageLines, ONE_MINUTE, readHelpPage, type HelpPage } from '@domain/help-pages'
import { wordsToChange } from '@domain/words'
import { parseGfm, type AnswerBlock, type AnswerInline } from '@/lib/answer-markdown'
import { crumbDefinitions, pathOf } from '@/lib/crumbs'
import {
  blocksText,
  docFrontMatterSchema,
  docLink,
  docsLibrary,
  docTemplates,
  repositoryPath,
  splitPage,
  unsafePicture,
  docExcerpt,
} from '@/lib/docs'
import { helpPlace, helpTargets } from '@/lib/help'
import { allowedIn } from '../../eslint.plain-words.js'
import {
  compareToBaseline,
  countWords,
  type WordCounts,
} from '../../scripts/plain-words-baseline.ts'

/*
  The docs check (docs/help/README.md, "The docs check"): mechanical, no model. Wrong docs are
  worse than none, so every page must parse, follow its kind's template, link only to pages,
  headings, pictures and screens that exist, and name the app's controls in the app's own words.
*/

const folder = 'docs/help'
const files = readdirSync(folder).filter((file) => file.endsWith('.md') && file !== 'README.md')
const pictureFiles = readdirSync(join(folder, 'images')).filter((file) => file.endsWith('.svg'))
const library = docsLibrary()

type Page = { file: string; slug: string; source: string; data: unknown; body: string }
const pages: Page[] = files.map((file) => {
  const source = readFileSync(join(folder, file), 'utf8')
  const split = splitPage(source)
  if (!split.ok) throw new Error(`${file}: ${split.reason}`)
  return { file, slug: file.replace(/\.md$/, ''), source, data: split.data, body: split.body }
})

/** The body without its fenced code, where a `#` or a dash may be anything. */
const prose = (body: string) => body.replace(/^ {0,3}(`{3,}|~{3,})[\s\S]*?^ {0,3}\1/gm, '')

function inlines(blocks: readonly AnswerBlock[]): AnswerInline[] {
  return blocks.flatMap((block): AnswerInline[] => {
    switch (block.type) {
      case 'heading':
      case 'paragraph':
        return block.children
      case 'list':
        return block.items.flatMap((item) => inlines(item.children))
      case 'quote':
        return inlines(block.children)
      case 'table':
        return [...block.head, ...block.rows.flatMap((row) => row.cells)].flat()
      default:
        return []
    }
  })
}

function textOf(nodes: readonly AnswerInline[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' || node.type === 'code'
        ? node.text
        : node.type === 'break'
          ? ' '
          : node.type === 'mention'
            ? node.label
            : textOf(node.children),
    )
    .join('')
}

/** Every bold phrase on a page, in the words written. */
function boldPhrases(nodes: readonly AnswerInline[]): string[] {
  return nodes.flatMap((node) =>
    node.type === 'strong'
      ? [textOf(node.children)]
      : 'children' in node
        ? boldPhrases(node.children)
        : [],
  )
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length

/**
 * The app's own copy: every source file of the front end but its stories, mock data, previews
 * and generated tables, with its spaces evened out, so JSX text that wraps still matches.
 */
function appCopy(): string {
  const out: string[] = []
  const skip = /(^|\/)(stories|mocks|design-preview)(\/|$)|\.gen\.ts$/
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (skip.test(path)) continue
      if (entry.isDirectory()) walk(path)
      else if (/\.tsx?$/.test(entry.name)) out.push(readFileSync(path, 'utf8'))
    }
  }
  walk('src/web')
  return out.join('\n').replace(/\s+/g, ' ')
}

/** The app's routes as patterns: `/library/$itemId` matches `/library/itm_1`. */
const routePatterns = Object.keys(crumbDefinitions)
  .filter((id) => crumbDefinitions[id] !== 'layout')
  .map((id) => {
    const path = pathOf(id).replace(/\/$/, '') || '/'
    return new RegExp(`^${path.replace(/\$\w+/g, '[^/]+')}$`)
  })
const isScreen = (address: string) => {
  const path = address.split(/[?#]/)[0]!.replace(/\/$/, '') || '/'
  return routePatterns.some((pattern) => pattern.test(path))
}

describe('the docs check', () => {
  it('reads every page, and drops none', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
    expect(library.pages.map((page) => page.slug).sort()).toEqual(
      pages.map((page) => page.slug).sort(),
    )
  })

  it.each(files)('%s has complete front matter', (file) => {
    const page = pages.find((entry) => entry.file === file)!
    const result = docFrontMatterSchema.safeParse(page.data)
    expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toEqual([])
    expect(page.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it.each(files)('%s follows its kind and the writing rules', (file) => {
    const page = pages.find((entry) => entry.file === file)!
    const doc = library.page(page.slug)!
    // The title comes from the front matter: no `#` heading in the body.
    expect(prose(page.body)).not.toMatch(/^# /m)
    // Plain hyphens only, and no "soon" (writing rules 9 and 12).
    expect(page.source).not.toContain('—')
    expect(prose(page.body)).not.toMatch(/\bsoon\b/i)
    const template = docTemplates[doc.kind]
    if (template === 'concept') {
      expect(doc.oneMinute, 'a concept opens with ## In one minute').not.toBeNull()
      const count = words(textOf(inlines(doc.oneMinute ?? [])))
      expect(count, 'In one minute is 40 to 80 words').toBeGreaterThanOrEqual(40)
      expect(count, 'In one minute is 40 to 80 words').toBeLessThanOrEqual(80)
      expect(doc.headings.map((heading) => heading.title)).toContain('What it is not')
    } else {
      expect(doc.oneMinute).toBeNull()
    }
    if (template === 'guide') {
      const titles = doc.headings.filter((heading) => heading.depth === 2).map((h) => h.title)
      expect(titles).toContain('Steps')
      const at = doc.blocks.findIndex((block) => block.type === 'heading' && block.id === 'steps')
      const steps = doc.blocks.slice(at + 1).find((block) => block.type === 'list')
      expect(steps?.type === 'list' && steps.ordered, 'Steps is a numbered list').toBe(true)
      expect(steps?.type === 'list' ? steps.items.length : 99).toBeLessThanOrEqual(12)
      if (doc.kind === 'guide') {
        expect(titles).toEqual(
          expect.arrayContaining(['Before you start', 'If something goes wrong']),
        )
      }
    }
  })

  it.each(files)('%s links only to pages, headings, pictures and screens that exist', (file) => {
    const page = pages.find((entry) => entry.file === file)!
    const links: string[] = []
    const images: string[] = []
    parseGfm(page.body, {
      link: (url) => (links.push(url), null),
      image: (url) => (images.push(url), null),
      headingIds: true,
    })
    // A picture inside a sentence is not drawn: every picture stands in a paragraph of its own.
    expect(images.length).toBe([...page.body.matchAll(/!\[/g)].length)
    const slugs = new Set(pages.map((entry) => entry.slug))
    const resolve = docLink(page.slug, slugs)
    const broken: string[] = []
    for (const url of links) {
      if (/^https:\/\//.test(url)) continue
      if (url.startsWith('/')) {
        if (!isScreen(url)) broken.push(`${url}: no such screen`)
        continue
      }
      const target = resolve(url)
      if (!target) {
        broken.push(`${url}: no such page`)
        continue
      }
      const path = url.startsWith('#') ? `${folder}/${file}${url}` : repositoryPath(url)
      const [repoFile = '', hash = ''] = (path ?? '').split('#')
      if (!existsSync(repoFile)) broken.push(`${url}: no such file`)
      const linked = library.page(repoFile.replace(`${folder}/`, '').replace(/\.md$/, ''))
      if (hash && linked && !linked.headings.some((heading) => heading.id === hash))
        broken.push(`${url}: no heading "${hash}" on that page`)
    }
    for (const url of images) {
      const path = repositoryPath(url)
      if (!path || !existsSync(path) || !path.endsWith('.svg'))
        broken.push(`${url}: no such picture`)
    }
    expect(broken).toEqual([])
  })

  it.each(files)('%s points at screens, related pages and a review day that exist', (file) => {
    const page = pages.find((entry) => entry.file === file)!
    const doc = library.page(page.slug)!
    expect(doc.screens.filter((screen) => !isScreen(screen))).toEqual([])
    expect((doc.related ?? []).filter((slug) => !library.page(slug) || slug === doc.slug)).toEqual(
      [],
    )
    // Never in the future. A page not checked for 180 days is a warning, not a failure.
    const reviewed = Date.parse(`${doc.reviewed}T00:00:00Z`)
    expect(reviewed).toBeLessThanOrEqual(Date.now())
    if (Date.now() - reviewed > 180 * 86_400_000)
      console.warn(`${file} was last checked on ${doc.reviewed}: check it against the app`)
  })

  it('names the app controls in the app own words: every bold phrase is on a screen', () => {
    const copy = appCopy()
    const missing = pages.flatMap((page) => {
      const doc = library.page(page.slug)!
      const phrases = boldPhrases(inlines([...(doc.oneMinute ?? []), ...doc.blocks]))
      // "Proposals › To review" names two places, each on its own screen.
      return phrases
        .flatMap((phrase) => phrase.split(' › '))
        .filter((phrase) => !copy.includes(phrase.replace(/\s+/g, ' ').trim()))
        .map((phrase) => `${page.file}: **${phrase}**`)
    })
    expect(missing).toEqual([])
  })

  it('names the product only with the token, and never in a heading, whose words are its address', () => {
    // docs/help/README.md: {{product}} becomes the product's name (src/domain/brand.ts) as the
    // app reads a page, so a rename is one setting. Technical names such as the `heed` command and
    // the file names keep theirs (docs/rename-checklist.md).
    const sources = [
      ...pages.map((page) => ({ file: page.file, source: page.source })),
      { file: 'README.md', source: readFileSync(join(folder, 'README.md'), 'utf8') },
      ...pictureFiles.map((file) => ({
        file: `images/${file}`,
        source: readFileSync(join(folder, 'images', file), 'utf8'),
      })),
    ]
    const named = sources.flatMap(({ file, source }) =>
      source
        .split('\n')
        .filter((line) => new RegExp(`\\b${DEFAULT_PRODUCT_NAME}\\b`).test(line))
        .map((line) => `${file}: ${line.trim()}`),
    )
    expect(named).toEqual([])
    const headings = pages.flatMap((page) =>
      prose(page.body)
        .split('\n')
        .filter((line) => /^#{2,6} /.test(line) && line.includes(PRODUCT_TOKEN))
        .map((line) => `${page.file}: ${line}`),
    )
    expect(headings).toEqual([])
  })

  it('gives each heading the anchor GitHub gives it', () => {
    expect(headingSlug('What is an MCP, and how it all connects')).toBe(
      'what-is-an-mcp-and-how-it-all-connects',
    )
    expect(headingSlug('Gateway (MCP)')).toBe('gateway-mcp')
    expect(headingSlug('Re-check due')).toBe('re-check-due')
    expect(headingSlug('Why did my AI app not use Heed?')).toBe('why-did-my-ai-app-not-use-heed')
  })
})

describe('the glossary in the help', () => {
  // The help pages take their words from the glossary, as the screens do (docs/design/voice.md,
  // "The guard rail"). Until the help is rewritten (voice plan V7), a page may hold the old words
  // plain-words.baseline.json counts for it, and no more: `npm run lint:words` lowers the count.
  const baseline = JSON.parse(readFileSync('plain-words.baseline.json', 'utf8')) as WordCounts

  it.each(files)('%s adds no old words to what the baseline counts', (file) => {
    const path = `${folder}/${file}`
    const page = pages.find((entry) => entry.file === file)!
    const found = helpPageLines(page.source).flatMap(({ line, text }) =>
      wordsToChange(text, allowedIn(path)).map((change) => ({
        found: change.found,
        message: `${path}:${line} Instead of "${change.found}", write: ${change.write}.`,
      })),
    )
    const { more } = compareToBaseline(
      countWords(found.map(({ found: word }) => ({ path, found: word }))),
      { [path]: baseline[path] ?? {} },
    )
    expect(more, found.map(({ message }) => message).join('\n')).toEqual([])
  })

  it('reads a page as people read it: its title and summary, and its words without code', () => {
    const lines = helpPageLines(
      [
        '---',
        'title: The steward',
        'kind: concept',
        'audience: [steward]',
        'summary: "Who accepts items."',
        '---',
        '',
        '## What it is not',
        'Ask the **steward**, see [the scope](glossary.md#scope) and `item_id`.',
        '```',
        'get_context(item)',
        '```',
        '<!-- an item a reader never sees -->',
      ].join('\n'),
    )
    expect(lines).toEqual([
      { line: 2, text: 'The steward' },
      { line: 5, text: 'Who accepts items.' },
      { line: 8, text: '## What it is not' },
      { line: 9, text: 'Ask the steward, see the scope and `item_id`.' },
    ])
    expect(lines.flatMap(({ text }) => wordsToChange(text).map((change) => change.found))).toEqual([
      'steward',
      'items',
      'steward',
      'scope',
    ])
  })
})

/** Each page as the service reads it for search_help (domain/help-pages.ts). */
const slugs = new Set(pages.map((page) => page.slug))
const helpPages = new Map(
  pages.map((page) => {
    const read = readHelpPage(page.slug, page.data, page.body, slugs)
    if (!read.ok) throw new Error(`${page.file}: ${read.reason}`)
    return [page.slug, read.page] as [string, HelpPage]
  }),
)

describe('the answers search_help gives', () => {
  // search_help (the assistant's and AI apps' tool) returns a page's answer when a question names
  // the page: without one, a question about it has nothing to come back with.
  it.each(files)('%s keeps an answer at its top, of one minute at most', (file) => {
    const slug = file.replace(/\.md$/, '')
    const answer = helpPages.get(slug)!.answer
    expect(answer, 'a page opens with its answer').not.toBeNull()
    const count = words(answer?.text ?? '')
    expect(count, 'the answer is 12 to 150 words').toBeGreaterThanOrEqual(12)
    expect(count, 'the answer is 12 to 150 words').toBeLessThanOrEqual(150)
  })

  it.each(files)('%s answers with what its help link shows', (file) => {
    const slug = file.replace(/\.md$/, '')
    const doc = library.page(slug)!
    const answer = helpPages.get(slug)!.answer!
    if (doc.oneMinute) expect(answer.id).toBe(ONE_MINUTE)
    else {
      // The words above the first heading, or else the first section, as docExcerpt shows it.
      const first = doc.blocks.findIndex((block) => block.type === 'heading')
      const opening = first === -1 ? doc.blocks : doc.blocks.slice(0, first)
      expect(answer.id).toBe(opening.length ? '' : doc.headings[0]!.id)
    }
    expect(blocksText(docExcerpt(doc)!.blocks).length).toBeGreaterThan(0)
  })

  it.each(files)('%s has the same headings for search_help as in Docs', (file) => {
    const slug = file.replace(/\.md$/, '')
    const sections = helpPages.get(slug)!.sections.filter((section) => section.depth > 0)
    const shown = sections.filter(
      (section) => section.id !== ONE_MINUTE || !library.page(slug)!.oneMinute,
    )
    expect(shown.map(({ id, heading, depth }) => ({ id, title: heading, depth }))).toEqual(
      library.page(slug)!.headings,
    )
  })
})

describe('the help in context', () => {
  // Every place a screen's HelpLink opens (lib/help.ts) is a page, or a heading on one.
  it.each(helpTargets)('%s is a page of the docs, at a heading it has', (target) => {
    const { slug, heading } = helpPlace(target)
    const page = library.page(slug)
    expect(page, `no page "${slug}"`).toBeDefined()
    if (heading)
      expect(
        page!.headings.map((entry) => entry.id),
        `no heading "${heading}"`,
      ).toContain(heading)
    const excerpt = docExcerpt(page!, heading)
    expect(excerpt?.blocks.length, 'a help link opens on words, not on nothing').toBeGreaterThan(0)
  })
})

describe('the pictures', () => {
  const used = new Set(
    pages.flatMap((page) =>
      [...page.body.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)].map((match) => repositoryPath(match[1]!)),
    ),
  )

  it.each(pictureFiles)('%s is safe to draw inline, sized, and used by a page', (file) => {
    const svg = readFileSync(join(folder, 'images', file), 'utf8')
    expect(unsafePicture.test(svg), 'no script, link, handler, CSS address or id').toBe(false)
    expect(svg).not.toContain('—')
    const width = Number(/<svg[^>]*\swidth="(\d+)"/.exec(svg)?.[1])
    expect(width).toBeGreaterThan(0)
    expect(width).toBeLessThanOrEqual(640)
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/)
    // Colours follow the app's tokens, with a fallback for GitHub.
    expect(svg).toContain('var(--foreground,')
    expect(used.has(`${folder}/images/${file}`), 'a picture no page shows').toBe(true)
  })
})

describe('the docs library', () => {
  it('orders the pages by section, then by their order', () => {
    expect(library.pages.slice(0, 3).map((page) => page.slug)).toEqual([
      'what-is-heed',
      'mcp',
      'tour',
    ])
  })

  it('opens a link between pages in the app, and the repository on GitHub', () => {
    const link = docLink('mcp', new Set(['mcp', 'glossary']))
    expect(link('glossary.md#edition')).toEqual({ href: '/docs/glossary#edition', internal: true })
    expect(link('./glossary.md')).toEqual({ href: '/docs/glossary', internal: true })
    expect(link('#go-deeper')).toEqual({ href: '/docs/mcp#go-deeper', internal: true })
    expect(link('missing.md')).toBeNull()
    expect(link('../ai-sign-in.md')).toEqual({
      href: 'https://github.com/Fredehagelund92/heed/blob/main/docs/ai-sign-in.md',
      internal: false,
    })
    expect(link('../../../etc/passwd')).toBeNull()
    expect(link('/try-it')).toEqual({ href: '/try-it', internal: true })
    expect(link('javascript:alert(1)')).toBeNull()
  })

  it('draws each picture of a page as a figure with its alt text and caption', () => {
    const mcp = library.page('mcp')!
    const figures = mcp.blocks.filter((block) => block.type === 'figure')
    expect(figures).toHaveLength(2)
    expect(figures[0]).toMatchObject({
      src: 'docs/help/images/mcp-plug.svg',
      caption: 'One plug shape. Any AI app that has it can use any system that offers it.',
    })
  })

  it('shows a concept in one minute, a guide by its first section and a term by its sentence', () => {
    const heed = library.page('what-is-heed')!
    expect(docExcerpt(heed)).toMatchObject({
      title: 'What is Heed',
      blocks: heed.oneMinute,
      href: '/docs/what-is-heed',
    })
    const guide = docExcerpt(library.page('review-a-proposal')!)!
    expect(guide.blocks.map((block) => block.type)).toEqual(['list'])
    const gap = docExcerpt(library.page('glossary')!, 'gap')!
    expect(gap.title).toBe('Gap')
    expect(gap.href).toBe('/docs/glossary#gap')
    expect(blocksText(gap.blocks)).toMatch(/^A question that AI apps or people asked/)
    expect(docExcerpt(library.page('glossary')!, 'no-such-heading')).toBeNull()
  })

  it('shows a group of terms with nothing above them as each term and its sentence', () => {
    const facts = docExcerpt(library.page('glossary')!, 'facts')!
    expect(facts.blocks).toHaveLength(1)
    const list = facts.blocks[0]!
    expect(list.type === 'list' && list.items.length).toBeGreaterThan(5)
    expect(blocksText(facts.blocks)).toContain('Event: A fact about something that happened')
  })

  it('finds a page by its words, and a glossary term at its heading', () => {
    expect(library.search('what is an mcp')[0]?.slug).toBe('mcp')
    const term = library.search('re-check due').find((hit) => hit.slug === 'glossary')
    expect(term?.href).toBe('/docs/glossary#re-check-due')
    expect(library.search('zzzz')).toEqual([])
  })
})
