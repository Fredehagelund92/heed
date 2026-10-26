import { createFileRoute } from '@tanstack/react-router'
import { DefinitionsPage } from '@/pages/definitions'
import { definitionsSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/definitions/')({
  validateSearch: definitionsSearch,
  component: DefinitionsPage,
})
