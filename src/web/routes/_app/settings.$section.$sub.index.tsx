import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { settingsSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/settings/$section/$sub/')({
  validateSearch: settingsSearch,
  pendingComponent: () => <Loading shape="page" />,
})
