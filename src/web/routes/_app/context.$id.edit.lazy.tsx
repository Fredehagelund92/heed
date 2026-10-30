import { createLazyFileRoute } from '@tanstack/react-router'
import { FactEditor } from '@/pages/editor'
import { editorStart } from '@/lib/editor-start'

export const Route = createLazyFileRoute('/_app/context/$id/edit')({ component: Editor })

function Editor() {
  const { id } = Route.useParams()
  return <FactEditor key={`${id}/edit?${editorStart(Route.useSearch())}`} mode="edit" factId={id} />
}
