import { createLazyFileRoute } from '@tanstack/react-router'
import { ContextPage } from '@/pages/context'

export const Route = createLazyFileRoute('/_app/context/')({ component: ContextPage })
