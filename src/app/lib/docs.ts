import MiniSearch from 'minisearch'
import docs from 'virtual:help-docs'
import {
  CHANGELOG,
  docGroups,
  docPath,
  llmsTxt as indexOf,
  type DocChangelog,
  type DocPage,
} from '@domain/docs'

// The documentation's pages (docs/help), read at build time (scripts/docs-plugin.ts). The app's
// Docs area, the static docs site, Help and the guide links all read them from here.

export type { DocPage } from '@domain/docs'

/** Where the docs open: in the app at /docs, and on the static site at its own base. */
export const DOCS_HOME = (import.meta.env.VITE_DOCS_BASE as string | undefined) ?? '/docs'

export const DOC_GROUPS = docGroups
export const DOC_PAGES: DocPage[] = docs.pages
export const CHANGES: DocChangelog = docs.changelog
export const CHANGELOG_SLUG = CHANGELOG

export const docPage = (slug: string | undefined) => DOC_PAGES.find((p) => p.slug === slug)

/** Where a page opens, at a heading when there is one. */
export const docHref = (slug: string, hash = '') => docPath(DOCS_HOME, slug, hash)

/** The plain-text index an agent can read at /docs/llms.txt: every page with its one line. */
export const llmsTxt = () => indexOf(docs, DOCS_HOME)

export type DocHit = { slug: string; title: string; heading: string; id: string; group: string }

let index: MiniSearch<DocHit & { key: string; text: string }> | undefined

/**
 * The pages' parts that best match a search, by their words: a page's title and line, each
 * heading and the words under it, at most eight. A word matches its start and one typo, so
 * "synonim" finds synonyms. Built the first time the search opens.
 */
export function searchDocs(query: string): DocHit[] {
  index ??= (() => {
    const built = new MiniSearch<DocHit & { key: string; text: string }>({
      idField: 'key',
      fields: ['title', 'heading', 'text'],
      storeFields: ['slug', 'title', 'heading', 'id', 'group'],
      searchOptions: { boost: { title: 3, heading: 2 }, prefix: true, fuzzy: 0.2 },
    })
    built.addAll(
      DOC_PAGES.flatMap((p) =>
        p.sections.map((s) => ({
          key: `${p.slug}#${s.id}`,
          slug: p.slug,
          title: p.title,
          heading: s.heading,
          id: s.id,
          group: p.group,
          text: s.id ? s.text : `${p.line}\n${s.text}`,
        })),
      ),
    )
    return built
  })()
  if (!query.trim()) return []
  // Every word first; when no part has them all, any of them.
  const all = index.search(query, { combineWith: 'AND' })
  const hits = all.length ? all : index.search(query)
  return hits.slice(0, 8).map((hit) => ({
    slug: hit.slug as string,
    title: hit.title as string,
    heading: hit.heading as string,
    id: hit.id as string,
    group: hit.group as string,
  }))
}
