import { existsSync } from 'node:fs'
import type { Link, Nodes, Table } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { describe, expect, it } from 'vitest'
import { productName } from '../../../src/server/brand.ts'
import { draftingGuide } from '../../../src/domain/drafting-guide.ts'
import { bannedWords, usesWord } from '../../../src/domain/words-v1.ts'
import {
  assistantSystemPrompt,
  plainWordMap,
} from '../../../src/server/modules/assistant/prompt.ts'
import { assistantToolNames } from '../../../src/server/modules/assistant/tools.ts'

/*
  The assistant's instructions (the companion review, sections 5 and 8). What they make a model
  do is tested on the golden set: by the real model (npm run eval:assistant) and the scripted one
  (tests/integration/assistant.test.ts). These tests never pin their wording; they check what
  holds of the text whatever its words: the tools it tells a model to call exist, the Markdown it
  shows reads as Heed reads an answer (lib/answer-markdown.ts), it speaks the glossary's words
  (src/domain/words-v1.ts) so a model does not learn the specification's, and it stays the same
  bytes for the prompt cache.
*/

const examples = assistantSystemPrompt.split('\n').filter((line) => line.startsWith('Example '))
/** The statuses get_facts and find_facts reply with, which the instructions also name. */
const statuses = new Set(['matched', 'conflict', 'no_match', 'need_more_detail', 'check_failed'])

const routes = new URL('../../../src/web/routes/', import.meta.url)

/** Every node of a type in a Markdown tree, at any depth. */
function nodesOf<T extends Nodes>(node: Nodes, type: T['type']): T[] {
  const inner = 'children' in node ? node.children.flatMap((child) => nodesOf<T>(child, type)) : []
  return node.type === type ? [node as T, ...inner] : inner
}

describe("the assistant's instructions", () => {
  it('name only tools the assistant has, so a model never calls one that is not there', () => {
    const named = new Set(assistantSystemPrompt.match(/\b[a-z]+(?:_[a-z]+)+\b/g))
    const tools = new Set<string>(assistantToolNames)
    expect([...named].filter((name) => !tools.has(name) && !statuses.has(name))).toEqual([])
    // Six examples: five turns that call a tool, and a thank-you that calls none.
    expect(examples).toHaveLength(6)
    const calling = examples.filter((example) =>
      example.match(/\b[a-z]+(?:_[a-z]+)+\b/g)?.some((name) => tools.has(name)),
    )
    expect(calling).toHaveLength(5)
  })

  it('map every word the glossary bans to what to write instead, and use none of them in the rules', () => {
    for (const { word, write } of bannedWords) {
      expect(plainWordMap).toContain(word)
      expect(plainWordMap).toContain(write)
    }
    // The rules and the replies of the examples, without the map itself, the drafting guide the
    // MCP tools share, tool names and statuses, page names in links, and what the person says.
    const rules = assistantSystemPrompt
      .replace(plainWordMap, '')
      .replace(draftingGuide, '')
      .split('\n')
      .filter((line) => !line.startsWith('- '))
      .map((line) => (line.startsWith('Example ') ? line.replace(/"[^"]*"/, '') : line))
      .map((line) =>
        line.replace(/\[[^\]]*\]\(\/[^)]*\)/g, '').replace(/\b[a-z]+(?:_[a-z]+)+\b/g, ''),
      )
    const used = rules.flatMap((line) =>
      bannedWords.filter(({ word }) => usesWord(line, word)).map(({ word }) => `${word}: ${line}`),
    )
    expect(used).toEqual([])
  })

  it('reply to a thank-you in one short line, and name the product only to say what it is', () => {
    expect(examples.find((example) => example.includes('"thanks!"'))).toMatch(
      /You reply: "You're welcome\."$/,
    )
    // Who the assistant is, the rule on naming the product, and questions about how it works.
    expect(assistantSystemPrompt.split(productName)).toHaveLength(4)
  })

  it('keep each example short', () => {
    for (const example of examples) expect(example.split(' ').length).toBeLessThan(110)
  })

  it('show Markdown that reads as one narrow table and a link to a page Heed has', () => {
    // The parser Heed reads answers with: GitHub-flavoured Markdown.
    const tree = fromMarkdown(assistantSystemPrompt, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    })
    const tables = nodesOf<Table>(tree, 'table')
    expect(tables).toHaveLength(1)
    // At most five columns, each row whole: it reads in a panel as narrow as a phone.
    const [head, ...rows] = tables[0]!.children
    expect(head!.children.length).toBeLessThanOrEqual(5)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) expect(row.children.length).toBe(head!.children.length)
    const pages = nodesOf<Link>(tree, 'link').filter((link) => link.url.startsWith('/'))
    expect(pages.length).toBeGreaterThan(0)
    for (const { url } of pages) {
      const page = new URL(url, 'https://heed.invalid').pathname.split('/')[1]
      const route = (end: string) => new URL(`${page}${end}`, routes)
      expect({ url, page: existsSync(route('.tsx')) || existsSync(route('/')) }).toEqual({
        url,
        page: true,
      })
    }
  })

  it('stay the same bytes every day and for every person: no real date or id', () => {
    expect(assistantSystemPrompt).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    // An id anywhere in the instructions that looks real could be cited as if a tool returned it.
    expect(assistantSystemPrompt).not.toMatch(/itm_[a-z0-9]{8}/i)
  })
})
