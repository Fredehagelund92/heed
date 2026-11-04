import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Nodes, Paragraph, PhrasingContent } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { visit } from 'unist-util-visit'
import { repoRoot, type SitePage } from './pages.ts'

/*
  Whether a page is written for the people who read the site. A published page holds nothing that
  only makes sense inside the repository: no requirement ids, no paths to source files, no dated
  history of how the product changed. It holds no wall of text either: no long paragraph, and no
  paragraph that is mostly code. Link addresses are left alone, because a reader sees only the
  words of a link. What's new is the one page that is dated history, so that rule leaves it alone.
*/

const months =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)'

const requirementId = /\b(?:(?:N?FR|CON)-?|R-)\d+[a-z]?\b/
const sourcePath =
  /(?:^|[\s`'"(])(?:\.\/)?(?:src|db|scripts|tests|apps|docs|docker|\.github)\/[\w.-]|\b[\w.-]+\.(?:ts|tsx|mjs|sql|sh)\b/
const datedHistory = new RegExp(
  `\\b\\d{1,2} ${months} \\d{4}\\b|\\b${months} \\d{1,2}, \\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b(?:since|before|until|as of) v?\\d+\\.\\d+\\.\\d+\\b|\\bv\\d+\\.\\d+(?:\\.\\d+)?\\b`,
)

/** Past these a paragraph reads as a wall. */
export const maxParagraphWords = 70
export const maxCodeInParagraph = 4

const frontMatter = /^---\n[\s\S]*?\n---\n/

/** What a reader sees of some inline content: its words and its code, not its link addresses. */
const shownText = (nodes: readonly PhrasingContent[]): string =>
  nodes
    .map((node) =>
      'value' in node ? node.value : 'children' in node ? shownText(node.children) : ' ',
    )
    .join('')

function paragraphProblems(paragraph: Paragraph) {
  const words = shownText(paragraph.children).split(/\s+/).filter(Boolean).length
  let code = 0
  visit(paragraph, 'inlineCode', () => void code++)
  return [
    ...(words > maxParagraphWords
      ? [`a paragraph of ${words} words, over ${maxParagraphWords}: split it or make it a list`]
      : []),
    ...(code > maxCodeInParagraph
      ? [`${code} pieces of code in one paragraph, over ${maxCodeInParagraph}: make them a list`]
      : []),
  ]
}

/** What keeps a page's Markdown from being published, each with its line in the file. */
export function readerProblems(source: string, file: string, history = false): string[] {
  const front = frontMatter.exec(source)?.[0] ?? ''
  const offset = front.split('\n').length - 1
  const tree = fromMarkdown(source.slice(front.length), {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
  const problems: string[] = []
  const report = (node: Nodes, what: string) =>
    problems.push(`${file}:${(node.position?.start.line ?? 0) + offset}: ${what}`)

  visit(tree as Nodes, (node) => {
    if (node.type === 'paragraph')
      for (const problem of paragraphProblems(node)) report(node, problem)
    if (node.type !== 'text' && node.type !== 'inlineCode' && node.type !== 'code') return
    const id = requirementId.exec(node.value)?.[0]
    if (id) report(node, `the requirement id ${id}, which means nothing to a reader`)
    const path = sourcePath.exec(node.value)?.[0]
    if (path) report(node, `the source path ${path.trim()}, which means nothing to a reader`)
    const day = history ? undefined : datedHistory.exec(node.value)?.[0]
    if (day) report(node, `"${day}": dated history belongs in What's new`)
  })
  return problems
}

/** The same for every published page. */
export function checkPages(pages: readonly SitePage[], root = repoRoot): string[] {
  return pages.flatMap(({ file, slug }) =>
    readerProblems(readFileSync(join(root, file), 'utf8'), file, slug === 'changelog'),
  )
}
