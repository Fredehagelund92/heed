import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { contextEditorSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/context/$id/suggest')({
  validateSearch: contextEditorSearch,
  pendingComponent: () => <Loading shape="editor" />,
})
