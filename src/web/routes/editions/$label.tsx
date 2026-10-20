import { createFileRoute } from '@tanstack/react-router'
import { EditionPage } from '@/components/editions/edition-page'

export const Route = createFileRoute('/editions/$label')({
  // The page shows the number as its title; the breadcrumb ends with it (contract 8.6).
  loader: ({ params }) => ({ crumb: params.label, crumbMono: true }),
  component: EditionRoute,
})

function EditionRoute() {
  const { label } = Route.useParams()
  return <EditionPage key={label} label={label} />
}
