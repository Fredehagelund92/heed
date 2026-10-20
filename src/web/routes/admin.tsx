import { createFileRoute, redirect } from '@tanstack/react-router'
import { AdminPage } from '@/components/settings/admin-page'
import { validateAdminSearch } from '@/lib/search-params'
import { movedSourceSettings, retiredAdminSectionMoves } from '@/lib/settings-sections'

export const Route = createFileRoute('/admin')({
  validateSearch: validateAdminSearch,
  /**
   * An old link to a source's setting on Limits opens it on the source's page in Sources, where
   * it moved (integrations decision, 12 October 2026).
   */
  beforeLoad: ({ search }) => {
    // People and roles is People since the People page: an old link opens it, filters and all.
    if (search.section === 'roles')
      throw redirect({
        to: '/admin',
        search: { ...search, section: retiredAdminSectionMoves.roles },
        replace: true,
      })
    const source = search.setting ? movedSourceSettings[search.setting] : undefined
    if (search.section !== 'limits' || !source) return
    throw redirect({
      to: '/admin',
      search: { section: 'sources', source, setting: search.setting },
      replace: true,
    })
  },
  component: AdminRoute,
})

function AdminRoute() {
  return <AdminPage search={Route.useSearch()} />
}
