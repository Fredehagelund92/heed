import { createFileRoute } from '@tanstack/react-router'
import { ContextPage } from '@/components/context/context-page'
import { validateContextSearch } from '@/lib/search-params'
import { keysOf } from '@/lib/try-it'

export const Route = createFileRoute('/library/new')({
  validateSearch: validateContextSearch,
  component: NewContext,
})

function NewContext() {
  const { draft, asked, metric, about, from, evidence_url, quote } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ContextPage
      draftId={draft}
      asked={draft ? asked : undefined}
      metric={draft ? undefined : metric}
      about={draft ? undefined : keysOf(about)}
      from={draft ? undefined : from}
      evidence={draft ? undefined : { url: evidence_url, quote }}
      onCreated={(proposal) => {
        void navigate({ search: { draft: proposal.id }, replace: true })
      }}
    />
  )
}
