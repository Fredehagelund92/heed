import { Link, useNavigate } from '@tanstack/react-router'
import { Page, PageContent, PageToolbar } from '@/components/page/page'
import type { SettingsSearch } from '@/lib/search-params'
import { settingsSections, settingsSectionTitles, type SettingsSection } from '@/lib/settings'
import { ConnectSection } from './connect-section'
import { ProfileSection } from './profile-section'
import { SectionNav } from './section-nav'

const groups = [{ title: null, sections: settingsSections }] as const

/**
 * A person's own Settings (navigation decision, 12 October 2026), opened from the user menu:
 * Profile and appearance, and Connect your AI, with the AI apps connected as them. Everyone has
 * both. What runs the workspace is in Administration. The section is in the address
 * (`section=`), so each is linkable.
 */
export function SettingsPage({ section: asked }: { section: SettingsSearch['section'] }) {
  const navigate = useNavigate()
  const section: SettingsSection = asked === 'connect' ? 'connect' : 'profile'
  return (
    <Page
      title={settingsSectionTitles[section]}
      documentTitle={`${settingsSectionTitles[section]} - Settings`}
    >
      <PageToolbar>
        <SectionNav
          label="Settings sections"
          groups={groups}
          titles={settingsSectionTitles}
          active={section}
          // Profile names itself too: a link without the section would read as the current
          // page on every section.
          link={(value) => <Link to="/settings" search={{ section: value }} />}
          onChoose={(value) => void navigate({ to: '/settings', search: { section: value } })}
        />
      </PageToolbar>
      {section === 'profile' ? (
        <ProfileSection />
      ) : (
        <PageContent width="reading" className="pb-0" data-slot="settings-connect">
          <ConnectSection />
        </PageContent>
      )}
    </Page>
  )
}
