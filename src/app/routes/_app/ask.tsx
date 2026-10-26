import { createFileRoute } from '@tanstack/react-router'
import { AskPage } from '@/pages/ask'
import { askSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/ask')({ validateSearch: askSearch, component: AskPage })
