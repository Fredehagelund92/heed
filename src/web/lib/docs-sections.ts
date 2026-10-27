import { queryOptions } from '@tanstack/react-query'
import { helpSectionIds, helpSections, type HelpSectionId } from '@domain/help-sections'

/*
  The Docs area's sections (docs/old-help/README.md): the docs' tree lists every page under them, in
  this order (docs mode, contract 8.11), and a section's own address (`?section=`, the end of a
  help page's trail) lists its pages. Only the names live in the first load; the pages
  themselves are read by `lib/docs.ts`, a chunk of its own that the docs route, its loader and
  the palette load on demand (`docsQuery`).

  The sections and their names are the pages' own (src/domain/help-sections.ts).
*/

export const docSections = helpSections
export type DocSectionId = HelpSectionId
export const docSectionIds = helpSectionIds

export const docSectionTitle = (id: DocSectionId) =>
  docSections.find((section) => section.id === id)?.title ?? 'Docs'

/** The help pages, read once: they are part of the build and never change while the app runs. */
export const docsQuery = () =>
  queryOptions({
    queryKey: ['docs'],
    queryFn: () => import('./docs').then((module) => module.docsLibrary()),
    staleTime: Infinity,
    gcTime: Infinity,
    // The library holds its lookup and search functions, not plain data to compare.
    structuralSharing: false,
  })
