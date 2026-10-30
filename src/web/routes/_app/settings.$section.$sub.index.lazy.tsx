import { createLazyFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/pages/settings'

export const Route = createLazyFileRoute('/_app/settings/$section/$sub/')({ component: Page })

function Page() {
  const { section, sub } = Route.useParams()
  return <SettingsPage section={section} sub={sub} />
}
