import { createFileRoute } from '@tanstack/react-router'
import { ContextPage } from '@/pages/context'
import { contextSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/context/')({
  validateSearch: contextSearch,
  component: ContextPage,
})
