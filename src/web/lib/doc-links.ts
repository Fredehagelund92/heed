import titles from 'virtual:help-docs-titles'
import { CHANGELOG, docPath } from '@domain/docs'

// Links into the documentation from anywhere in the app: where it opens, a page's address and its
// title. Only the titles, not the pages (lib/docs.ts), so a guide link or the help menu keeps the
// documentation and its search off the app's first load.

/** Where the docs open: in the app at /docs, and on the static site at its own base. */
export const DOCS_HOME = (import.meta.env.VITE_DOCS_BASE as string | undefined) ?? '/docs'

export const CHANGELOG_SLUG = CHANGELOG

/** Where a page opens, at a heading when there is one. */
export const docHref = (slug: string, hash = '') => docPath(DOCS_HOME, slug, hash)

/** A page's title by its slug; undefined for a page that does not exist. */
export const docTitle = (slug: string): string | undefined => titles[slug]
