import { createFileRoute } from '@tanstack/react-router'
import { SettingsPage } from '@/pages/settings'
import { settingsSearch } from '@/lib/search'

export const Route = createFileRoute('/_app/settings/')({
  validateSearch: settingsSearch,
  component: () => <SettingsPage />,
})
