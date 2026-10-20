import { createFileRoute, redirect } from '@tanstack/react-router'
import { SettingsPage } from '@/components/settings/settings-page'
import { validateSettingsSearch } from '@/lib/search-params'
import { retiredSettingsSectionMoves } from '@/lib/settings-sections'

export const Route = createFileRoute('/settings')({
  validateSearch: validateSettingsSearch,
  /**
   * An old link to a section Administration took over lands on it with its setting, filters and
   * open entry; exporting an edition is on Editions. Administration's own gate then says whose
   * section it is.
   */
  beforeLoad: ({ search: { section, ...rest } }) => {
    if (!section || section === 'profile' || section === 'connect') return
    const moved = retiredSettingsSectionMoves[section]
    if (moved === 'editions') throw redirect({ to: '/editions', replace: true })
    throw redirect({ to: '/admin', search: { ...moved, ...rest }, replace: true })
  },
  component: SettingsRoute,
})

function SettingsRoute() {
  return <SettingsPage section={Route.useSearch().section} />
}
