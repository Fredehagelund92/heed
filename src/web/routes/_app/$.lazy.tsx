import { createLazyFileRoute } from '@tanstack/react-router'
import { NotFoundPage } from '@/pages/not-found'

export const Route = createLazyFileRoute('/_app/$')({ component: NotFoundPage })
