import { createLazyFileRoute } from '@tanstack/react-router'
import { HelpPage } from '@/pages/help'

export const Route = createLazyFileRoute('/_app/help')({ component: HelpPage })
