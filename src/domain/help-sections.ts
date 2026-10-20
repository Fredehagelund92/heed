/*
  The sections of Heed's help pages (docs/help/README.md), in order: the docs' tree lists every
  page under them. Apart from the page model (help-pages.ts) so the app's first load, which shows
  the sections in the sidebar, carries only these names.
*/

/**
 * A section is named like nothing else in the sidebar, the palette or a trail: Connect your AI is
 * the person's own page where they connect, Connecting AI apps the docs about it, and Common
 * questions the page in Questions.
 */
export const helpSections = [
  { id: 'start', title: 'Start here' },
  { id: 'concepts', title: 'Concepts' },
  { id: 'guides', title: 'Guides' },
  { id: 'connect', title: 'Connecting AI apps' },
  { id: 'reference', title: 'Reference' },
  { id: 'questions', title: 'Questions' },
] as const
export type HelpSectionId = (typeof helpSections)[number]['id']
export const helpSectionIds = helpSections.map((section) => section.id) as [
  HelpSectionId,
  ...HelpSectionId[],
]
