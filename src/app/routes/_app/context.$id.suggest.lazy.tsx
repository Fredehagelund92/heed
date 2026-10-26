import { createLazyFileRoute } from '@tanstack/react-router'
import { FactEditor } from '@/pages/editor'
import { editorStart } from '@/lib/editor-start'

export const Route = createLazyFileRoute('/_app/context/$id/suggest')({ component: Editor })

function Editor() {
  const { id } = Route.useParams()
  return (
    <FactEditor
      key={`${id}/suggest?${editorStart(Route.useSearch())}`}
      mode="suggest"
      factId={id}
    />
  )
}
