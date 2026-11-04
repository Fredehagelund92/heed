import { join } from 'node:path'
import type { Blockquote, Paragraph, Root } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { describe, expect, it } from 'vitest'
import { VFile } from 'vfile'
import type { LinkContext } from '../lib/links.ts'
import { repoRoot } from '../lib/pages.ts'
import { remarkHeedDocs } from '../lib/remark-heed-docs.ts'

const context: LinkContext = {
  pages: new Map([['docs/help/tools.md', 'tools']]),
  base: '/v0.1',
  ref: 'main',
  kind: () => 'blob',
}

function read(markdown: string): Root {
  const tree = fromMarkdown(markdown)
  remarkHeedDocs(context)(tree, new VFile({ path: join(repoRoot, 'docs/help/privacy.md') }))
  return tree
}

describe('the remark plugin', () => {
  it('points a link at its address', () => {
    const paragraph = read('See [the tools](tools.md#send).').children[0] as Paragraph
    expect(paragraph.children[1]).toMatchObject({ type: 'link', url: '/v0.1/tools/#send' })
  })

  it('keeps the words of a link to a screen of the app', () => {
    const paragraph = read('Open [Agents](/settings/agents) now.').children[0] as Paragraph
    expect(paragraph.children.map((node) => node.type)).toEqual(['text', 'text', 'text'])
  })

  it('draws a quote that opens with a bold title as a note, and no other quote', () => {
    const [note, quote] = read(
      '> **Revoking.** Revoke it.\n\n---\n\n> Plain words.',
    ).children.filter((node) => node.type === 'blockquote') as Blockquote[]
    expect(note!.data).toMatchObject({ hName: 'div', hProperties: { role: 'note' } })
    expect(quote!.data).toBeUndefined()
  })

  it('lets the keyboard reach a table, which scrolls on a phone', () => {
    const tree = fromMarkdown('| A |\n| - |\n| b |', {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    })
    remarkHeedDocs(context)(tree, new VFile({ path: join(repoRoot, 'docs/help/privacy.md') }))
    expect(tree.children[0]?.data).toMatchObject({ hProperties: { tabIndex: 0 } })
  })

  it('drops include markers and keeps what stands between them', () => {
    const tree = read('<!-- include words -->\n\nThe words.\n\n<!-- /include -->\n\nAfter.')
    expect(tree.children.map((node) => node.type)).toEqual(['paragraph', 'paragraph'])
  })
})
