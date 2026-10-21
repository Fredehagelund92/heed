import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  helpAnswer,
  helpFolderPath,
  HELP_TEXT_MAX,
  readHelpLibrary,
  repositoryHelp,
} from '../../../src/server/modules/help/index.ts'

type Answer = {
  say: string
  status: string
  results?: { page: string; section: string | null; text: string; url: string; checked: string }[]
  pages?: { page: string; summary: string; url: string }[]
}
const answer = (query: string, web: string | null = null) =>
  helpAnswer(repositoryHelp(), query, web) as Answer

describe("the service's help pages", () => {
  it('reads every page of docs/help, the files the Docs area draws, and leaves none out', () => {
    const help = repositoryHelp()
    expect(help.problems).toEqual([])
    const files = readdirSync(helpFolderPath()).filter(
      (f) => f.endsWith('.md') && f !== 'README.md',
    )
    expect(help.pages.map((page) => page.slug).sort()).toEqual(
      files.map((f) => f.replace(/\.md$/, '')).sort(),
    )
    // In the order of the docs' tree.
    expect(help.pages.slice(0, 3).map((page) => page.slug)).toEqual(['what-is-heed', 'mcp', 'tour'])
  })

  it('leaves out a page it cannot read, and says which and why', () => {
    const folder = mkdtempSync(join(tmpdir(), 'heed-help-'))
    writeFileSync(join(folder, 'README.md'), '# Not a page')
    writeFileSync(join(folder, 'broken.md'), 'no front matter')
    writeFileSync(
      join(folder, 'fine.md'),
      '---\ntitle: Fine\nkind: faq\nsection: questions\norder: 1\nsummary: Fine.\naudience: [everyone]\nminutes: 1\nowner: Heed product team\nreviewed: 2026-10-15\nscreens: []\n---\n\nAll fine here.\n',
    )
    const help = readHelpLibrary(folder)
    expect(help.pages.map((page) => page.slug)).toEqual(['fine'])
    expect(help.problems).toEqual(['broken.md: no front matter'])
  })

  // The golden set's help cases (db/seed/golden-set.yml, type help): the page each one is answered
  // from. A change to a page that moves one of them is a change to what people are told.
  it.each([
    ['What is an MCP?', '/docs/mcp#in-one-minute'],
    ['What is Heed?', '/docs/what-is-heed#in-one-minute'],
    ['What is an edition?', '/docs/glossary#edition'],
    ['How do I connect Claude Code to Heed?', '/docs/connect-an-agent#before-you-start'],
    ['How do I review a proposal?', '/docs/review-a-proposal#before-you-start'],
    ['What is a gap?', '/docs/glossary#gap'],
    ['What does the stop switch do?', '/docs/editions#the-stop-switch'],
    ['Does Heed keep my questions?', '/docs/common-questions#does-it-keep-my-questions'],
    // The retired name still finds the page.
    ['How do I set up an AI app in Heed?', '/docs/connect-an-agent#before-you-start'],
  ])('answers %s from %s', (query, url) => {
    const result = answer(query)
    expect(result.status).toBe('matched')
    expect(result.results![0]!.url).toBe(url)
  })

  it('gives each section its page, heading, words, link and the day the page was checked', () => {
    const result = answer('What is an MCP?')
    expect(result.say).toBe(
      "From Heed's help pages: What is an MCP, and how it all connects and Glossary. Answer from these sections and link the page you use.",
    )
    expect(result.results![0]).toEqual({
      page: 'What is an MCP, and how it all connects',
      section: 'In one minute',
      text: expect.stringMatching(/^MCP stands for Model Context Protocol\./) as string,
      url: '/docs/mcp#in-one-minute',
      checked: '2026-10-19',
    })
    expect(result.results!.length).toBeLessThanOrEqual(3)
  })

  it('gives an agent outside Heed whole addresses on the web app, for the page and its links', () => {
    const result = answer('Does Heed keep my questions?', 'https://heed.example')
    const first = result.results![0]!
    expect(first.url).toBe('https://heed.example/docs/common-questions#does-it-keep-my-questions')
    expect(first.text).toContain('(https://heed.example/docs/mcp#what-stays-with-you)')
    expect(first.text).not.toMatch(/\]\(\//)
  })

  it('cuts a long section at a line and says the page has the rest', () => {
    const folder = mkdtempSync(join(tmpdir(), 'heed-help-'))
    const line = 'Every edition is a numbered set of accepted items that never changes.'
    writeFileSync(
      join(folder, 'long.md'),
      `---\ntitle: Long\nkind: faq\nsection: questions\norder: 1\nsummary: Long.\naudience: [everyone]\nminutes: 1\nowner: Heed product team\nreviewed: 2026-10-15\nscreens: []\n---\n\nOne page.\n\n## Editions\n\n${Array.from({ length: 60 }, () => line).join('\n')}\n`,
    )
    const [result] = (helpAnswer(readHelpLibrary(folder), 'editions') as Answer).results!
    expect(result!.text.length).toBeLessThanOrEqual(HELP_TEXT_MAX + 30)
    expect(result!.text).toMatch(new RegExp(`${line}\\n\\nThe rest is on the page\\.$`))
  })

  it('says when nothing matched, that the pages are about Heed and not data, and lists them', () => {
    const result = answer('zzzz qqqq')
    expect(result.status).toBe('no_match')
    expect(result.say).toContain('call get_facts')
    expect(result.results).toBeUndefined()
    expect(result.pages?.map((page) => page.url)).toContain('/docs/mcp')
  })
})
