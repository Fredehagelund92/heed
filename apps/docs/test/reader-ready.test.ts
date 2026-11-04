import { describe, expect, it } from 'vitest'
import { sitePages } from '../lib/pages.ts'
import { checkPages, maxParagraphWords, readerProblems } from '../lib/reader-ready.ts'

const page = (body: string) => `---\ntitle: A page\nreviewed: 2026-11-04\n---\n\n${body}\n`
const problems = (body: string, history = false) => readerProblems(page(body), 'a.md', history)

describe('a page ready for readers', () => {
  it.each([
    ['FR-343', 'The server does this (FR-343).'],
    ['NFR-022', 'It holds for NFR-022 too.'],
    ['CON-501', 'The first source, `CON-501`.'],
    ['R-12', 'Decided in R-12.'],
  ])('has no requirement id such as %s', (id, body) => {
    expect(problems(body)[0]).toContain(`the requirement id ${id}`)
  })

  it.each([
    ['src/domain/mcp-text.ts', 'The text is in src/domain/mcp-text.ts.'],
    ['db/README.md', 'See `db/README.md`.'],
    ['docs/templates', 'Templates are in docs/templates/.'],
    ['production-boot.sh', 'Run production-boot.sh first.'],
    ['.github/workflows', 'It runs from .github/workflows/ci.yml.'],
  ])('has no repository path such as %s', (path, body) => {
    expect(problems(body).join()).toContain('the source path')
    expect(problems(body).join()).toContain(path.split('/')[0]!.replace(/^\./, ''))
  })

  it('finds a path in a code block too', () => {
    expect(problems('```text title="Run"\nnode src/server/main.ts\n```')[0]).toContain(
      'source path',
    )
  })

  it.each([
    ['30 Oct 2026', 'Withdrawn with the assistant (30 Oct 2026).'],
    ['3 November 2026', 'Moved on 3 November 2026.'],
    ['November 3, 2026', 'Moved on November 3, 2026.'],
    ['2026-10-23', 'Changed on 2026-10-23.'],
    ['before 0.1', 'Settings named this way before 0.1.0 still work.'],
  ])('has no dated history such as %s', (day, body) => {
    expect(problems(body)[0]).toContain(`"${day}"`)
  })

  it("leaves dated history to What's new, and no other rule", () => {
    expect(problems('Moved on 3 November 2026.', true)).toEqual([])
    expect(problems('Moved on 3 November 2026 (FR-1).', true)[0]).toContain('requirement id')
  })

  it('has no wall of text', () => {
    const wall = Array.from({ length: maxParagraphWords + 1 }, () => 'word').join(' ')
    expect(problems(wall)[0]).toContain(`a paragraph of ${maxParagraphWords + 1} words`)
    expect(problems(`- ${wall}`)[0]).toContain('a paragraph of')
    expect(problems(`> **Note.** ${wall}`)[0]).toContain('a paragraph of')
  })

  it('has no paragraph that is mostly code', () => {
    expect(problems('Set `a`, `b`, `c`, `d` and `e`.')[0]).toContain('5 pieces of code')
    expect(problems('Set `a`, `b`, `c` and `d`.')).toEqual([])
  })

  it('says the line of each problem', () => {
    expect(problems('First.\n\nSee FR-1.')[0]).toMatch(/^a\.md:8: /)
  })

  it('looks at words, and not at where a link goes', () => {
    expect(problems('See [the database guide](../db/README.md).')).toEqual([])
    expect(problems('See [db/README.md](../db/README.md).')[0]).toContain('source path')
  })

  it('leaves ordinary words alone', () => {
    expect(
      problems('Connect Claude, in CLAUDE.md or AGENTS.md, over the last 7 days, on 14 pages.'),
    ).toEqual([])
    expect(problems('A count under 5 reads "Fewer than 5". Try /settings/agents.')).toEqual([])
  })
})

describe('the published pages', () => {
  it('are all ready for readers', () => {
    expect(checkPages(sitePages())).toEqual([])
  })
})
