import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

/*
  Which of the repository's Markdown files are pages of the site, and where they sit in its
  sidebar. Nothing moves on disk: every page stays in docs/, and its front matter says its place.
  What stays in the repository (docs/README.md, evaluations, design, development) is not listed.
*/

/** The folder `npm run build` runs in is apps/docs, whichever way it is started. */
export const repoRoot = resolve(process.cwd(), '../..')

/** The sidebar's groups, in order: docs/help's, then the operators' and integrators' pages. */
export const siteGroups = [
  'Start',
  'Write and review',
  'Set up',
  'How it works',
  'Run the service',
  'Connectors',
  'Reference',
] as const
export type SiteGroup = (typeof siteGroups)[number]

/** The pages outside docs/help, by their path under docs/. */
export const operatorPages = [
  'where-to-run',
  'self-hosting',
  'operations',
  'vercel',
  'security',
  'connectors',
  'connectors/cube',
  'connectors/authoring',
  'connectors/security',
  'reference',
  'ai-sign-in',
]

/** The files of the site for the content loader, as paths under docs/. */
export const pagePatterns = [
  'help/*.md',
  '!help/README.md',
  ...operatorPages.map((page) => `${page}.md`),
]

/** A file under docs/ to its address under the site: help/privacy.md is privacy. */
export const slugOf = (entry: string) => entry.replace(/^help\//, '').replace(/\.md$/, '')

export type SitePage = {
  slug: string
  /** Its path in the repository, `docs/help/privacy.md`. */
  file: string
  title: string
  line: string
  group?: SiteGroup
  order: number
}

function readPage(root: string, entry: string): SitePage {
  const file = join('docs', entry)
  const front = /^---\n([\s\S]*?)\n---\n/.exec(readFileSync(join(root, file), 'utf8'))
  if (!front) throw new Error(`${file} has no front matter`)
  const { title, line, group, order } = parse(front[1]!) as Omit<SitePage, 'slug' | 'file'>
  return { slug: slugOf(entry), file, title, line, group, order: order ?? 0 }
}

/** Every page of the site: by group and order, and What's new, which has no group, last. */
export function sitePages(root = repoRoot): SitePage[] {
  const help = readdirSync(join(root, 'docs/help'))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => `help/${name}`)
  const place = (page: SitePage) => {
    const at = page.group ? siteGroups.indexOf(page.group) : siteGroups.length
    if (at === -1) throw new Error(`${page.file}: no group "${page.group}"`)
    return at
  }
  return [...help, ...operatorPages.map((page) => `${page}.md`)]
    .map((entry) => readPage(root, entry))
    .sort((a, b) => place(a) - place(b) || a.order - b.order)
}

/** Starlight's sidebar, from each page's front matter. */
export function sidebar(pages: readonly SitePage[]) {
  return [
    ...siteGroups.map((label) => ({
      label,
      items: pages.filter((page) => page.group === label).map(({ slug }) => ({ slug })),
    })),
    ...pages.filter((page) => !page.group).map(({ slug }) => ({ slug })),
  ]
}
