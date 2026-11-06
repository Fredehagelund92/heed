import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

/*
  Which of the repository's Markdown files are pages of the site, and where they sit in its
  sidebar. Nothing moves on disk: a page stays in docs/, and its front matter says its place.

  The site publishes only what is written for its readers. A page outside this list stays in the
  repository: it is out of the sidebar, the search, llms.txt and the sitemap, and a published page
  that links to it opens it on GitHub. A page joins the list once it passes the reader check
  (lib/reader-ready.ts).
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

/** The published pages, by their path under docs/. */
export const publishedPages = [
  'help/get-started',
  'help/connect-an-agent',
  'help/write-context',
  'help/review-a-suggestion',
  'help/settle-a-conflict',
  'help/definitions-and-synonyms',
  'help/publish-without-review',
  'help/domains-and-owners',
  'help/integrations',
  'help/how-agents-use-it',
  'help/answer-lines',
  'help/privacy',
  'help/tools',
  'reference',
  'reference/connect-by-hand',
  'reference/agent-tools',
  'ai-sign-in',
  'reference/http-api',
  'where-to-run',
  'self-hosting',
  'operations',
  'configuration',
  'company-sign-in',
  'administration',
  'security',
  'vercel',
  'connectors',
  'connectors/cube',
  'connectors/security',
  'connectors/authoring',
  'help/changelog',
]

/** The files of the site for the content loader, as paths under docs/. */
export const pagePatterns = publishedPages.map((page) => `${page}.md`)

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

/** Every help page that is not on the list, so that a new one is never left out by accident. */
export function unlistedHelpPages(root = repoRoot): string[] {
  return readdirSync(join(root, 'docs/help'))
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .map((name) => `help/${name.replace(/\.md$/, '')}`)
    .filter((page) => !publishedPages.includes(page))
}

/** Every page of the site: by group and order, and What's new, which has no group, last. */
export function sitePages(root = repoRoot): SitePage[] {
  const place = (page: SitePage) => {
    const at = page.group ? siteGroups.indexOf(page.group) : siteGroups.length
    if (at === -1) throw new Error(`${page.file}: no group "${page.group}"`)
    return at
  }
  return pagePatterns
    .map((entry) => readPage(root, entry))
    .sort((a, b) => place(a) - place(b) || a.order - b.order)
}

/** The groups that have a published page, in order. */
export const shownGroups = (pages: readonly SitePage[]) =>
  siteGroups.filter((group) => pages.some((page) => page.group === group))

/** Starlight's sidebar, from each page's front matter. */
export function sidebar(pages: readonly SitePage[]) {
  return [
    ...shownGroups(pages).map((label) => ({
      label,
      items: pages.filter((page) => page.group === label).map(({ slug }) => ({ slug })),
    })),
    ...pages.filter((page) => !page.group).map(({ slug }) => ({ slug })),
  ]
}
