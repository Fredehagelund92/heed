import { createFileRoute } from '@tanstack/react-router'
import { DefinitionPage } from '@/pages/definition-page'

export const Route = createFileRoute('/_app/definitions/$name/')({ component: Page })

function Page() {
  return <DefinitionPage name={Route.useParams().name} />
}
