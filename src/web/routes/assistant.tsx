import { createFileRoute } from '@tanstack/react-router'
import { AssistantPage } from '@/components/assistant/assistant-page'
import { validateAssistantSearch } from '@/lib/search-params'

export const Route = createFileRoute('/assistant')({
  validateSearch: validateAssistantSearch,
  component: AssistantRoute,
})

/** The assistant as a page: expanded from the panel's Ask tab, with the scope in the address. */
function AssistantRoute() {
  return <AssistantPage search={Route.useSearch()} />
}
