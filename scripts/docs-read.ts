import type * as Md from 'mdast'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { gfm } from 'micromark-extension-gfm'
import * as z from 'zod/mini'
import {
  blocksText,
  CHANGELOG,
  docGroups,
  docIncludes,
  docLinks,
  inlineText,
  type DocBlock,
  type DocChange,
  type DocChangelog,
  type DocFile,
  type DocInclude,
  type DocInline,
  type DocPage,
  type Docs,
  type DocSection,
  type DocTarget,
} from '../src/domain/docs.ts'
import { headingIds } from '../src/domain/heading-anchors.ts'

/*
  Reads the documentation's Markdown files (docs/help) into the page model of docs.ts, or says
  which page cannot be read and why. Only the build runs it (docs-plugin.ts), so neither
  the app nor the docs site carries a Markdown reader. Pure: it reads only the text it is given.
*/

const pageFrontMatter = z.strictObject({
  title: z.string().check(z.minLength(1), z.maxLength(40)),
  /** One line on what the page holds: the landing page, search and llms.txt show it. */
  line: z.string().check(z.minLength(1), z.maxLength(120)),
  group: z.enum(docGroups),
  order: z.number().check(z.int(), z.minimum(1)),
  minutes: z.number().check(z.int(), z.minimum(1), z.maximum(30)),
  /** The day someone last checked the page against the app. */
  reviewed: z.iso.date(),
  /** A screen of the app the page is about, opened from beside its title. */
  open: z.optional(
    z.strictObject({
      label: z.string().check(z.minLength(1)),
      href: z.string().check(z.regex(/^\/[a-z]/)),
    }),
  ),
})

const changelogFrontMatter = z.strictObject({
  title: z.string().check(z.minLength(1)),
  line: z.string().check(z.minLength(1), z.maxLength(120)),
  reviewed: z.iso.date(),
})

type Result<T> = { ok: true; value: T } | { ok: false; reason: string }

const frontMatter = /^---\n([\s\S]*?)\n---\n/
const includeOpen = /^<!--\s*include\s+([a-z-]+)(?::\s*(.+?))?\s*-->$/
const includeClose = /^<!--\s*\/include\s*-->$/

/** A page's front matter and body. The front matter is YAML, read by the caller's own reader. */
export function splitDocPage(
  source: string,
  parse: (yaml: string) => unknown,
): Result<{ data: unknown; body: string }> {
  const text = source.replace(/\r\n?/g, '\n')
  const match = frontMatter.exec(text)
  if (!match) return { ok: false, reason: 'no front matter' }
  try {
    return { ok: true, value: { data: parse(match[1]!), body: text.slice(match[0].length) } }
  } catch (error) {
    return { ok: false, reason: `front matter is not YAML: ${String(error)}` }
  }
}

const parseTree = (body: string) =>
  fromMarkdown(body, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] })

/** Where a link written in a page goes, or a reason it cannot go anywhere. */
export function docTarget(url: string, slug: string): Result<DocTarget> {
  if (url.startsWith('#')) return { ok: true, value: { page: slug, hash: url.slice(1) } }
  if (/^https:\/\//.test(url)) return { ok: true, value: { web: url } }
  if (/^\/[a-z]/.test(url)) return { ok: true, value: { screen: url } }
  const page = /^(?:\.\/)?([a-z0-9]+(?:-[a-z0-9]+)*)\.md(?:#([a-z0-9-]+))?$/.exec(url)
  if (page) return { ok: true, value: { page: page[1]!, hash: page[2] ?? '' } }
  return {
    ok: false,
    reason: `a link to "${url}": write another page as name.md, or a screen as /path`,
  }
}

class Refusal extends Error {}

/** Reads one tree of a page into the page model, refusing what the docs do not use. */
function reader(slug: string) {
  const nextId = headingIds()

  const inline = (nodes: readonly Md.PhrasingContent[]): DocInline[] =>
    nodes.flatMap((node): DocInline[] => {
      switch (node.type) {
        case 'text':
          return [{ type: 'text', text: node.value.replace(/\s*\n\s*/g, ' ') }]
        case 'strong':
          return [{ type: 'strong', children: inline(node.children) }]
        case 'emphasis':
          return [{ type: 'em', children: inline(node.children) }]
        case 'inlineCode':
          return [{ type: 'code', text: node.value }]
        case 'break':
          return [{ type: 'break' }]
        case 'link': {
          const to = docTarget(node.url, slug)
          if (!to.ok) throw new Refusal(to.reason)
          return [{ type: 'link', to: to.value, children: inline(node.children) }]
        }
        default:
          throw new Refusal(`${node.type} is not used in the docs`)
      }
    })

  const blocks = (nodes: readonly Md.RootContent[]): DocBlock[] => {
    const out: DocBlock[] = []
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]!
      switch (node.type) {
        case 'heading': {
          if (node.depth !== 2 && node.depth !== 3)
            throw new Refusal('a page uses ## and ### headings; its title is in the front matter')
          const text = inlineText(inline(node.children))
          out.push({ type: 'heading', depth: node.depth, id: nextId(text), text })
          break
        }
        case 'paragraph':
          out.push({ type: 'paragraph', children: inline(node.children) })
          break
        case 'list':
          out.push({
            type: 'list',
            ordered: Boolean(node.ordered),
            items: node.children.map((item) => blocks(item.children)),
          })
          break
        case 'code': {
          const title = /title="([^"]+)"/.exec(node.meta ?? '')?.[1]
          if (!title) throw new Refusal('a code block says what it is: ```text title="..."')
          out.push({ type: 'code', title, text: node.value })
          break
        }
        case 'blockquote': {
          // A note: a quote whose first words are its title in bold, with a full stop.
          const [first, ...rest] = node.children
          const lead = first?.type === 'paragraph' ? first.children[0] : undefined
          const title = lead?.type === 'strong' ? inlineText(inline(lead.children)) : ''
          if (!first || first.type !== 'paragraph' || !title.endsWith('.'))
            throw new Refusal('a note starts with its title in bold, ending in a full stop')
          const words = inline(first.children.slice(1))
          const head = words[0]
          if (head?.type === 'text') head.text = head.text.replace(/^\s+/, '')
          out.push({
            type: 'note',
            title: title.slice(0, -1),
            children: [{ type: 'paragraph', children: words }, ...blocks(rest)],
          })
          break
        }
        case 'table':
          out.push({
            type: 'table',
            head: node.children[0]!.children.map((cell) => inline(cell.children)),
            rows: node.children.slice(1).map((row) => row.children.map((c) => inline(c.children))),
          })
          break
        case 'html': {
          const open = includeOpen.exec(node.value.trim())
          if (!open) throw new Refusal(`HTML is not used in the docs: ${node.value.trim()}`)
          const name = open[1] as DocInclude
          if (!docIncludes.includes(name)) throw new Refusal(`no include "${open[1]}"`)
          const end = nodes.findIndex(
            (other, at) => at > i && other.type === 'html' && includeClose.test(other.value.trim()),
          )
          if (end === -1) throw new Refusal(`the include "${name}" is not closed`)
          const from = node.position!.end.offset!
          const to = nodes[end]!.position!.start.offset!
          out.push({ type: 'include', name, arg: open[2] ?? '', markdown: source.slice(from, to) })
          i = end
          break
        }
        case 'thematicBreak':
        case 'image':
        default:
          throw new Refusal(`${node.type} is not used in the docs`)
      }
    }
    return out
  }

  let source = ''
  return (body: string) => {
    source = body
    return blocks(parseTree(body).children)
  }
}

/** The parts of a page for search: the words above the first heading, then each heading's. */
function sectionsOf(lead: readonly DocInline[], blocks: readonly DocBlock[]): DocSection[] {
  const sections: DocSection[] = [{ id: '', heading: '', text: inlineText(lead) }]
  for (const block of blocks) {
    if (block.type === 'heading') sections.push({ id: block.id, heading: block.text, text: '' })
    else {
      const last = sections.at(-1)!
      last.text = [last.text, blocksText([block])].filter(Boolean).join('\n')
    }
  }
  return sections.filter((section) => section.heading || section.text)
}

function readGuide(file: DocFile, parse: (yaml: string) => unknown): Result<DocPage> {
  const split = splitDocPage(file.source, parse)
  if (!split.ok) return split
  const data = pageFrontMatter.safeParse(split.value.data)
  if (!data.success)
    return {
      ok: false,
      reason: data.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }
  try {
    const all = reader(file.slug)(split.value.body)
    const first = all[0]
    if (first?.type !== 'paragraph')
      return { ok: false, reason: 'a page opens with one paragraph, its lead' }
    const blocks = all.slice(1)
    const headings = blocks.flatMap((b) =>
      b.type === 'heading' ? [{ id: b.id, text: b.text, depth: b.depth }] : [],
    )
    return {
      ok: true,
      value: {
        slug: file.slug,
        ...data.data,
        lead: first.children,
        blocks,
        headings,
        sections: sectionsOf(first.children, blocks),
      },
    }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message }
    throw error
  }
}

const isoDay = /^\d{4}-\d{2}-\d{2}$/

function readChangelog(file: DocFile, parse: (yaml: string) => unknown): Result<DocChangelog> {
  const split = splitDocPage(file.source, parse)
  if (!split.ok) return split
  const data = changelogFrontMatter.safeParse(split.value.data)
  if (!data.success)
    return {
      ok: false,
      reason: data.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    }
  try {
    const blocks = reader(file.slug)(split.value.body)
    // Each change is a ## heading, then its day on a line of its own, then what changed.
    const changes: DocChange[] = []
    for (const block of blocks) {
      if (block.type === 'heading' && block.depth === 2) {
        changes.push({ date: '', title: block.text, id: block.id, children: [] })
        continue
      }
      const change = changes.at(-1)
      if (!change) return { ok: false, reason: 'every change starts with a ## heading' }
      const day = block.type === 'paragraph' ? inlineText(block.children).trim() : ''
      if (!change.date) {
        if (!isoDay.test(day)) return { ok: false, reason: `"${change.title}" has no day under it` }
        change.date = day
      } else change.children.push(block)
    }
    for (let i = 1; i < changes.length; i++)
      if (changes[i]!.date > changes[i - 1]!.date)
        return { ok: false, reason: 'changes are newest first' }
    return { ok: true, value: { slug: CHANGELOG, ...data.data, changes } }
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, reason: error.message }
    throw error
  }
}

/**
 * Reads every page of the docs, or says which page cannot be read and why. A link to another page
 * must name a page and a heading that exist, so a reader never follows one to nothing.
 */
export function readDocs(
  files: readonly DocFile[],
  parse: (yaml: string) => unknown,
): Result<Docs> {
  const pages: DocPage[] = []
  let changelog: DocChangelog | undefined
  for (const file of files) {
    if (file.slug === CHANGELOG) {
      const read = readChangelog(file, parse)
      if (!read.ok) return { ok: false, reason: `${file.slug}.md: ${read.reason}` }
      changelog = read.value
    } else {
      const read = readGuide(file, parse)
      if (!read.ok) return { ok: false, reason: `${file.slug}.md: ${read.reason}` }
      pages.push(read.value)
    }
  }
  if (!changelog) return { ok: false, reason: `no ${CHANGELOG}.md` }
  pages.sort((a, b) => docGroups.indexOf(a.group) - docGroups.indexOf(b.group) || a.order - b.order)
  const ids = new Map<string, string[]>(pages.map((p) => [p.slug, p.headings.map((h) => h.id)]))
  ids.set(
    CHANGELOG,
    changelog.changes.map((c) => c.id),
  )
  const all = [
    ...pages.map((p) => ({
      slug: p.slug,
      blocks: [{ type: 'paragraph' as const, children: p.lead }, ...p.blocks],
    })),
    { slug: CHANGELOG, blocks: changelog.changes.flatMap((c) => c.children) },
  ]
  for (const { slug, blocks } of all)
    for (const to of docLinks(blocks)) {
      if (!('page' in to)) continue
      const headings = ids.get(to.page)
      if (!headings)
        return { ok: false, reason: `${slug}.md: a link to ${to.page}.md, which is no page` }
      if (to.hash && !headings.includes(to.hash))
        return {
          ok: false,
          reason: `${slug}.md: a link to ${to.page}.md#${to.hash}, which is no heading there`,
        }
    }
  return { ok: true, value: { pages, changelog } }
}
