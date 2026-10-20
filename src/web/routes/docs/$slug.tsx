import { createFileRoute } from '@tanstack/react-router'
import { DocPageRoute } from '@/components/docs/doc-page'

export const Route = createFileRoute('/docs/$slug')({
  loader: async ({ context, params }) => {
    const { docSectionTitle, docsQuery } = await import('@/lib/docs-sections')
    const docs = await context.queryClient.ensureQueryData(docsQuery())
    const page = docs.page(params.slug)
    // The trail ends with the page's section; the page has its title (contract 8.6). The
    // sidebar picks out the same section.
    return page
      ? { crumb: docSectionTitle(page.section), section: page.section }
      : { crumb: 'Page not found' }
  },
  component: DocRoute,
})

function DocRoute() {
  const { slug } = Route.useParams()
  return <DocPageRoute key={slug} slug={slug} />
}
