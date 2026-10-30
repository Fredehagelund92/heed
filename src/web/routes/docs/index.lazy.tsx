import { createLazyFileRoute } from '@tanstack/react-router'
import { DocsRoute } from '@/pages/docs-route'

export const Route = createLazyFileRoute('/docs/')({ component: DocsRoute })
