import { createFileRoute, redirect } from '@tanstack/react-router'
import { TryItPage } from '@/components/try-it/try-it-page'
import { validateTryItSearch } from '@/lib/search-params'

export const Route = createFileRoute('/try-it')({
  validateSearch: validateTryItSearch,
  // Its old Connect your AI tab is a setting of the person's own now.
  beforeLoad: ({ search }) => {
    if (search.tab === 'connect')
      throw redirect({ to: '/settings', search: { section: 'connect' }, replace: true })
  },
  component: TryItRoute,
})

function TryItRoute() {
  return <TryItPage search={Route.useSearch()} />
}
