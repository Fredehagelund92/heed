import { createLazyFileRoute } from '@tanstack/react-router'
import { DefinitionEditor } from '@/pages/definition-editor'

export const Route = createLazyFileRoute('/_app/definitions/$name/edit')({ component: Editor })

function Editor() {
  const { name } = Route.useParams()
  return <DefinitionEditor key={`${name}?${Route.useSearch().sameAs ?? ''}`} name={name} />
}
