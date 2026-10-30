import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/pages/settings'
import { settingsSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/settings/$section/')({
  validateSearch: settingsSearch,
  component: Page,
})

function Page() {
  return <SettingsPage section={Route.useParams().section} />
}
