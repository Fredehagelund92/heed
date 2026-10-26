import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/pages/settings'
import { settingsSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/settings/$section/$sub/$step')({
  validateSearch: settingsSearch,
  component: Page,
})

function Page() {
  const { section, sub, step } = Route.useParams()
  return <SettingsPage section={section} sub={sub} step={step} />
}
