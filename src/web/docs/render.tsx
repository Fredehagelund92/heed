import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { CHANGELOG_SLUG, CHANGES, DOC_PAGES, docPage } from '@/lib/docs'
import { DocsSite } from '@/pages/docs'

// The static docs site, drawn ahead of time (npm run docs:build): every page as HTML, so it reads
// with no script, a search engine finds it, and main.tsx makes it work in the browser.

/** Every page the site has: the landing page (no slug), each guide and What's new. */
export const slugs: (string | undefined)[] = [
  undefined,
  ...DOC_PAGES.map((p) => p.slug),
  CHANGELOG_SLUG,
]

/** A page's title and line, for its <title> and its description. */
export function headOf(slug: string | undefined): { title: string; line: string } {
  if (slug === CHANGELOG_SLUG) return { title: CHANGES.title, line: CHANGES.line }
  const page = docPage(slug)
  if (page) return { title: page.title, line: page.line }
  return {
    title: 'Documentation',
    line: 'How to write context, connect your agents and review suggestions, and how agents read what you wrote.',
  }
}

export function render(slug: string | undefined): string {
  return renderToString(
    <StrictMode>
      <DocsSite slug={slug} query={new URLSearchParams()} go={() => undefined} />
    </StrictMode>,
  )
}
