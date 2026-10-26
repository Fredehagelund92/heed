import { createLazyFileRoute } from '@tanstack/react-router'
import { FactEditor } from '@/pages/editor'
import { editorStart } from '@/lib/editor-start'

export const Route = createLazyFileRoute('/_app/context/new')({ component: Editor })

function Editor() {
  return <FactEditor key={`new?${editorStart(Route.useSearch())}`} mode="new" />
}
