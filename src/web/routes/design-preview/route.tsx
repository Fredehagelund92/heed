import { createFileRoute, notFound } from '@tanstack/react-router'
import { DesignPreviewLayout } from '@/design-preview/layout'
import { designPreviewEnabled } from '@/lib/env'

/** Development only (or a build made with VITE_DESIGN_PREVIEW=true). Anywhere else it is a 404. */
export const Route = createFileRoute('/design-preview')({
  beforeLoad: () => {
    if (!designPreviewEnabled) throw notFound()
  },
  component: DesignPreviewLayout,
})
