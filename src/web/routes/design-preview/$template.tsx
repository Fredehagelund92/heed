import { lazy, Suspense } from 'react'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { isPageTemplateId } from '@/design-preview/catalog'
import { InputsPreview } from '@/design-preview/inputs'
import { PageTemplatePreview } from '@/design-preview/templates'
import { TokensPreview } from '@/design-preview/tokens'

/**
 * The proposal parts preview, loaded on its own and only in builds that have the design preview.
 * The condition is spelled out (not `designPreviewEnabled`) so a production build drops the
 * import and the parts never reach the first load.
 */
const ProposalPartsPreview =
  import.meta.env.DEV || import.meta.env.VITE_DESIGN_PREVIEW === 'true'
    ? lazy(() =>
        import('@/design-preview/proposal-parts').then((module) => ({
          default: module.ProposalPartsPreview,
        })),
      )
    : () => null

/** Sheets that are not page templates: the tokens, the chip-aware inputs and the proposal parts. */
const sheets = {
  tokens: 'Tokens',
  inputs: 'Inputs',
  'proposal-parts': 'Proposal parts',
} as const
const isSheet = (value: string): value is keyof typeof sheets => value in sheets

/**
 * The loader reads the template catalog on demand, so the route's stub, which every build's first
 * load carries, does not import it: a production build has no design preview to name.
 */
export const Route = createFileRoute('/design-preview/$template')({
  loader: async ({ params }) => {
    if (isSheet(params.template)) return { crumb: sheets[params.template] }
    const { pageTemplates } = await import('@/design-preview/catalog')
    const template = pageTemplates.find(({ id }) => id === params.template)
    if (!template) throw notFound()
    return { crumb: template.title }
  },
  component: TemplateRoute,
})

function TemplateRoute() {
  const { template } = Route.useParams()
  if (isPageTemplateId(template)) return <PageTemplatePreview template={template} />
  if (template === 'proposal-parts')
    return (
      <Suspense>
        <ProposalPartsPreview />
      </Suspense>
    )
  return template === 'inputs' ? <InputsPreview /> : <TokensPreview />
}
