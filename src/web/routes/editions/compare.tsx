import { createFileRoute } from '@tanstack/react-router'
import { EditionComparePage } from '@/components/editions/compare-page'
import { validateEditionCompareSearch } from '@/lib/search-params'

export const Route = createFileRoute('/editions/compare')({
  validateSearch: validateEditionCompareSearch,
  // In the person's words: "what changed between", not "compare" (Editions design, section 0).
  component: EditionCompareRoute,
})

function EditionCompareRoute() {
  return <EditionComparePage search={Route.useSearch()} />
}
