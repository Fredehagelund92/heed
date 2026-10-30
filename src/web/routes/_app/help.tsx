import { createFileRoute } from '@tanstack/react-router'
import { HelpPage } from '@/pages/help'
import { helpSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/help')({
  validateSearch: helpSearch,
  component: HelpPage,
})
