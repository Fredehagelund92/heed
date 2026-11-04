import { relative } from 'node:path'
import type { BlockContent, Paragraph, Root, RootContent } from 'mdast'
import { SKIP, visit } from 'unist-util-visit'
import type { VFile } from 'vfile'
import { resolveLink, type LinkContext } from './links.ts'
import { repoRoot } from './pages.ts'

/*
  What the pages write that Markdown alone does not draw as the docs do: links as lib/links.ts
  resolves them, a note (a quote whose first words are its title in bold) as a note, tables a
  keyboard can scroll, and no include markers. What stands between the markers is the list as
  Markdown, so the page reads as it is.
*/

const includeMarker = /^<!--\s*\/?include\b.*-->$/

const isNote = (node: BlockContent | RootContent | undefined) => {
  const lead = node?.type === 'paragraph' ? (node as Paragraph).children[0] : undefined
  const last = lead?.type === 'strong' ? lead.children.at(-1) : undefined
  return last?.type === 'text' && last.value.endsWith('.')
}

export function remarkHeedDocs(context: LinkContext) {
  return (tree: Root, file: VFile) => {
    const from = relative(repoRoot, file.path)
    visit(tree, (node, index, parent) => {
      if (
        node.type === 'html' &&
        includeMarker.test(node.value.trim()) &&
        parent &&
        index != null
      ) {
        parent.children.splice(index, 1)
        return [SKIP, index]
      }
      if (node.type === 'link' && parent && index != null) {
        const url = resolveLink(node.url, from, context)
        if (url !== undefined) node.url = url
        else {
          parent.children.splice(index, 1, ...node.children)
          return [SKIP, index]
        }
      }
      // A wide table scrolls on a phone, so the keyboard has to be able to reach it.
      if (node.type === 'table') node.data = { hProperties: { tabIndex: 0 } }
      if (node.type === 'blockquote' && isNote(node.children[0]))
        node.data = { hName: 'div', hProperties: { className: ['heed-note'], role: 'note' } }
      return undefined
    })
  }
}
