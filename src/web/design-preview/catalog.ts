/**
 * The page templates the design preview shows, without their components, so the router can
 * check a template name without loading the previews (they stay in the route's lazy chunk).
 */
export const pageTemplates = [
  {
    id: 'list',
    title: 'List page',
    description: 'Toolbar, then a dense table that fills the width.',
  },
  {
    id: 'document',
    title: 'Document page',
    description: 'A reading column and a flat page rail.',
  },
  {
    id: 'overview',
    title: 'Overview page',
    description: 'Sections and summary cards, capped at 70rem.',
  },
  { id: 'empty', title: 'First-run and empty page', description: 'One message and one action.' },
  {
    id: 'workbench',
    title: 'Workbench page',
    description: 'A scope strip, then the list, the open record and its actions, each scrolling.',
  },
] as const

export type PageTemplateId = (typeof pageTemplates)[number]['id']

export function isPageTemplateId(value: string): value is PageTemplateId {
  return pageTemplates.some((template) => template.id === value)
}
