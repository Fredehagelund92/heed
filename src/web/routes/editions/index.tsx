import { createFileRoute } from '@tanstack/react-router'
import { EditionsPage } from '@/components/editions/editions-page'
import { validateEditionsSearch } from '@/lib/search-params'

export const Route = createFileRoute('/editions/')({
  validateSearch: validateEditionsSearch,
  component: EditionsRoute,
})

function EditionsRoute() {
  return <EditionsPage search={Route.useSearch()} />
}
