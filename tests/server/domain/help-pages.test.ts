import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  helpIndex,
  helpLinkOf,
  helpTerms,
  readHelpPage,
  splitHelpPage,
  type HelpPage,
} from '../../../src/domain/help-pages.ts'

/** A page's front matter, with what a test changes. */
const meta = (title: string, extra: Record<string, unknown> = {}) => ({
  title,
  kind: 'concept',
  section: 'concepts',
  order: 1,
  summary: `About ${title}.`,
  audience: ['everyone'],
  minutes: 2,
  owner: 'Heed product team',
  reviewed: '2026-10-15',
  screens: [],
  ...extra,
})

function page(slug: string, title: string, body: string, slugs = [slug]): HelpPage {
  const read = readHelpPage(slug, meta(title), body, new Set(slugs))
  if (!read.ok) throw new Error(read.reason)
  return read.page
}

describe('a help page as search_help reads it', () => {
  it('cuts the body at every heading, with the anchors GitHub gives them', () => {
    const read = page(
      'editions',
      'Editions',
      [
        '## In one minute',
        '',
        'An edition never changes.',
        '',
        '## Why **editions** exist',
        '',
        'So the same question gets the same answer.',
        '',
        '### Why editions exist',
        '',
        'Twice, so the anchor is numbered.',
      ].join('\n'),
    )
    expect(read.sections.map(({ id, heading, depth }) => ({ id, heading, depth }))).toEqual([
      { id: 'in-one-minute', heading: 'In one minute', depth: 2 },
      { id: 'why-editions-exist', heading: 'Why editions exist', depth: 2 },
      { id: 'why-editions-exist-1', heading: 'Why editions exist', depth: 3 },
    ])
    expect(read.answer?.text).toBe('An edition never changes.')
    expect(read.path).toBe('/docs/editions')
  })

  it('takes the words above the first heading as the answer of a page without In one minute', () => {
    const read = page(
      'glossary',
      'Glossary',
      'The words on the screens.\n\n## Items\n\n### Item\n\nOne fact.',
    )
    expect(read.answer).toMatchObject({
      id: '',
      heading: '',
      depth: 0,
      text: 'The words on the screens.',
    })
    // A heading with no words of its own stays a section, and is never the answer.
    const guide = page(
      'guide',
      'A guide',
      '## Before you start\n\n- You will: read.\n\n## Steps\n\n1. Read.',
    )
    expect(guide.answer?.id).toBe('before-you-start')
  })

  it('leaves a heading inside fenced code as code', () => {
    const read = page(
      'readme',
      'Readme',
      '## How\n\n```yaml\n## not a heading\n[x](y.md)\n```\n\nAfter.',
    )
    expect(read.sections.map((s) => s.id)).toEqual(['how'])
    expect(read.sections[0]!.text).toContain('## not a heading\n[x](y.md)')
  })

  it('writes links where the app opens them, pictures as their words, and drops what goes nowhere', () => {
    const read = page(
      'mcp',
      'What is an MCP',
      [
        '## Links',
        '',
        'See [the glossary](glossary.md#edition), [Go deeper](#go-deeper), [Connect your AI](/settings?section=connect),',
        '[a missing page](missing.md), [the spec](https://modelcontextprotocol.io), [AI sign-in](../ai-sign-in.md)',
        'and [a script](javascript:alert(1)).',
        '',
        "![The plug: AI apps on the left, Heed on the right.](images/mcp-plug.svg 'One plug.')",
      ].join('\n'),
      ['mcp', 'glossary'],
    )
    const text = read.sections[0]!.text
    expect(text).toContain('[the glossary](/docs/glossary#edition)')
    expect(text).toContain('[Go deeper](/docs/mcp#go-deeper)')
    expect(text).toContain('[Connect your AI](/settings?section=connect)')
    expect(text).toContain('a missing page,')
    expect(text).toContain('[the spec](https://modelcontextprotocol.io)')
    expect(text).toContain(
      '[AI sign-in](https://github.com/Fredehagelund92/heed/blob/main/docs/ai-sign-in.md)',
    )
    expect(text).not.toContain('javascript:')
    expect(text).toContain('The plug: AI apps on the left, Heed on the right.')
    expect(text).not.toContain('mcp-plug.svg')
  })

  it("gives an app's paths on the web app's address for a reader outside it", () => {
    const read = readHelpPage(
      'mcp',
      meta('MCP'),
      '## Links\n\nSee [the glossary](glossary.md) and [Try it](/try-it).',
      new Set(['mcp', 'glossary']),
      (path) => `https://heed.example${path}`,
    )
    if (!read.ok) throw new Error(read.reason)
    expect(read.page.path).toBe('https://heed.example/docs/mcp')
    expect(read.page.sections[0]!.text).toBe(
      'See [the glossary](https://heed.example/docs/glossary) and [Try it](https://heed.example/try-it).',
    )
  })

  it('refuses front matter that is incomplete or not YAML', () => {
    expect(readHelpPage('x', { title: 'X' }, '', new Set(['x'])).ok).toBe(false)
    expect(splitHelpPage('no front matter', parseYaml)).toEqual({
      ok: false,
      reason: 'no front matter',
    })
    expect(splitHelpPage('---\ntitle: [\n---\nbody', parseYaml).ok).toBe(false)
    expect(splitHelpPage('---\ntitle: Ok\n---\nbody', parseYaml)).toEqual({
      ok: true,
      data: { title: 'Ok' },
      body: 'body',
    })
  })

  it('resolves a link the way the Docs area does', () => {
    const slugs = new Set(['mcp', 'glossary'])
    expect(helpLinkOf('glossary.md#gap', 'mcp', slugs)).toEqual({
      href: '/docs/glossary#gap',
      internal: true,
    })
    expect(helpLinkOf('missing.md', 'mcp', slugs)).toBe('missing')
    expect(helpLinkOf('../../../etc/passwd', 'mcp', slugs)).toBe('missing')
    expect(helpLinkOf('/try-it', 'mcp', slugs)).toBeNull()
    expect(helpLinkOf('https://example.test', 'mcp', slugs)).toBeNull()
  })
})

describe('the search over the help pages', () => {
  it('reads a question by the words that mean something, each in a plain form', () => {
    expect(helpTerms('What is an MCP?')).toEqual(['mcp'])
    expect(helpTerms('How do I connect Claude Code to Heed?')).toEqual([
      'connect',
      'claude',
      'code',
      'heed',
    ])
    expect(helpTerms('stopped stopping editions reviewed')).toEqual([
      'stop',
      'stop',
      'edition',
      'review',
    ])
  })

  const pages = [
    page(
      'what-is-heed',
      'What is Heed',
      '## In one minute\n\nHeed keeps the facts behind numbers.\n\n## Who uses Heed\n\nOwners and contributors use Heed.',
    ),
    page(
      'mcp',
      'What is an MCP',
      '## In one minute\n\nMCP is a plug for AI apps. Heed offers one.\n\n## What it is not\n\nAn MCP is not a model.',
    ),
    page(
      'glossary',
      'Glossary',
      'The words of Heed.\n\n### Gap\n\nA topic where people asked and Heed had nothing.\n\n### Edition\n\nA numbered set of items.',
    ),
  ]
  const index = helpIndex(pages)

  it("ranks a page's answer first when the question names its title", () => {
    expect(
      index.search('What is an MCP?').map((hit) => `${hit.page.slug}#${hit.section.id}`),
    ).toEqual(['mcp#in-one-minute', 'mcp#what-it-is-not'])
    expect(index.search('What is Heed?')[0]?.page.slug).toBe('what-is-heed')
  })

  it("lets the product's name decide only a question of nothing else", () => {
    const named = helpIndex(pages, 'Heed')
    // Every page is about the product, so its name says nothing about which one answers.
    expect(named.search('Does Heed have a gap?')[0]).toMatchObject({
      page: { slug: 'glossary' },
      section: { id: 'gap' },
    })
    expect(named.search('What is Heed?')[0]?.page.slug).toBe('what-is-heed')
    expect(named.search('Heed')[0]?.page.slug).toBe('what-is-heed')
  })

  it('ranks a section whose heading the question names over a section that only mentions it', () => {
    expect(index.search('What is a gap?')[0]).toMatchObject({
      page: { slug: 'glossary' },
      section: { id: 'gap' },
    })
  })

  it('gives at most the limit, and at most so many sections of one page', () => {
    const hits = index.search('heed', { limit: 3, perPage: 1 })
    expect(new Set(hits.map((hit) => hit.page.slug)).size).toBe(hits.length)
    expect(index.search('heed', { limit: 2 })).toHaveLength(2)
  })

  it('finds nothing for words no page has, or for a question of only small words', () => {
    expect(index.search('zzzz')).toEqual([])
    expect(index.search('what is it?')).toEqual([])
  })

  it('ranks the same way every time', () => {
    const first = index.search('heed numbers').map((hit) => hit.section.id)
    expect(index.search('heed numbers').map((hit) => hit.section.id)).toEqual(first)
  })
})
