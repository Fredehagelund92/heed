import { createLazyFileRoute } from '@tanstack/react-router'
import { DefinitionsPage } from '@/pages/definitions'

export const Route = createLazyFileRoute('/_app/definitions/')({ component: DefinitionsPage })
