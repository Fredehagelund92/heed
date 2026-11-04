import { statSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import type { Image, Link, Nodes } from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import { visit } from 'unist-util-visit'
import { repoRoot, type SitePage } from './pages.ts'

/*
  Where a link written in a page goes on the site. The Markdown keeps the relative links that work
  on GitHub. Here a link to another page of the site becomes its address, and a link to any other
  file of the repository opens on GitHub at the build's reference, so a release's pages open the
  files of that release. A link to a file that does not exist stops the build.
*/

const repository = 'https://github.com/Fredehagelund92/heed'

export type LinkContext = {
  /** Each page's address by its path in the repository. */
  pages: ReadonlyMap<string, string>
  /** The site's path, or its whole address for text read away from the site. */
  base: string
  ref: string
  /** Whether a path of the repository is a file, a folder or nothing. */
  kind: (path: string) => 'blob' | 'tree' | undefined
}

export function linkContext(pages: readonly SitePage[], base: string, ref: string): LinkContext {
  return {
    pages: new Map(pages.map(({ file, slug }) => [file, slug])),
    base,
    ref,
    kind: (path) => {
      const stat = statSync(join(repoRoot, path), { throwIfNoEntry: false })
      return stat?.isDirectory() ? 'tree' : stat?.isFile() ? 'blob' : undefined
    },
  }
}

/** The address of a link written in `from`, or undefined for a screen of the app. */
export function resolveLink(url: string, from: string, context: LinkContext): string | undefined {
  if (url.startsWith('#') || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)) return url
  // A site that may be read by anyone knows no instance of the app, so the words stay, unlinked.
  if (url.startsWith('/')) return undefined
  const [path = '', hash] = url.split('#')
  const target = posix.normalize(posix.join(dirname(from), path)).replace(/\/$/, '')
  const anchor = hash ? `#${hash}` : ''
  const slug = context.pages.get(target)
  if (slug) return `${context.base}/${slug}/${anchor}`
  const kind = target.startsWith('..') ? undefined : context.kind(target)
  if (!kind) throw new Error(`${from}: a link to "${url}", and ${target} does not exist`)
  return `${repository}/${kind}/${context.ref}/${target}${anchor}`
}

/**
 * A page's Markdown with its links as resolved above, for text read away from the site
 * (llms-full.txt): a link within the page takes the page's whole address too.
 */
export function withResolvedLinks(body: string, from: string, context: LinkContext): string {
  const tree = fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })
  const found: (Link | Image)[] = []
  visit(tree as Nodes, (node) => {
    if ((node.type === 'link' || node.type === 'image') && node.position) found.push(node)
  })
  const page = context.pages.get(from)
  // From the last to the first, so that each change leaves the earlier offsets as they were.
  return found.reverse().reduce((text, node) => {
    const start = node.position!.start.offset!
    const end = node.position!.end.offset!
    const written = text.slice(start, end)
    const at = written.lastIndexOf('](')
    if (at === -1) return text
    const url = node.url.startsWith('#')
      ? `${context.base}/${page}/${node.url}`
      : resolveLink(node.url, from, context)
    if (url === undefined) return text.slice(0, start) + written.slice(1, at) + text.slice(end)
    return `${text.slice(0, start)}${written.slice(0, at)}](${url})${text.slice(end)}`
  }, body)
}
