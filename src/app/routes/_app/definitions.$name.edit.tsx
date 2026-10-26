import { createFileRoute } from '@tanstack/react-router'
import { Loading } from '@/App'
import { definitionEditorSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/definitions/$name/edit')({
  validateSearch: definitionEditorSearch,
  pendingComponent: () => <Loading shape="editor" />,
})
