import { createLazyFileRoute } from '@tanstack/react-router'
import { ConflictsPage } from '@/pages/conflicts'

export const Route = createLazyFileRoute('/_app/context/conflicts/')({ component: ConflictsPage })
