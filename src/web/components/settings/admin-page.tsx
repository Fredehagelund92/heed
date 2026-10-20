import { lazy, Suspense } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { operationsQuery } from '@/api/queries'
import { sourceTypesQuery } from '@/api/source-queries'
import { GatewaySection } from '@/components/gateway/gateway-section'
import { LockIcon } from '@/components/icons'
import { AudienceGate } from '@/components/page/audience-gate'
import { Page, PageContent, PageToolbar } from '@/components/page/page'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import type { AdminSearch } from '@/lib/search-params'
import { retiredAdminSectionMoves, retiredAdminSections } from '@/lib/settings-sections'
import {
  adminSectionGroups,
  adminSectionsFor,
  adminSectionTitles,
  type AdminSection,
} from '@/lib/settings'
import { usePermissions } from '@/lib/use-session'
import { AuditSection } from './audit-section'
import { BusinessSection } from './business-section'
import { DomainsSection } from './domains-section'
import { ImportSection } from './import-section'
import { LimitsSection } from './limits-section'
import { OperationsSection } from './operations-section'
import { PeopleSection } from './people-section'
import { SectionNav } from './section-nav'
import { SourcesLoading } from './sources-loading'

// Sources keeps its pages out of Administration's first load.
const SourcesSection = lazy(() =>
  import('./sources-section').then((module) => ({ default: module.SourcesSection })),
)

const isRetiredAdminSection = (section: string): section is (typeof retiredAdminSections)[number] =>
  (retiredAdminSections as readonly string[]).includes(section)

/** What a section is for, in the refusal a person sees who opens one that is not theirs. */
const refusals: Record<AdminSection, string> = {
  domains:
    'Admins create domains and change their details. Owners describe their own domains in Health.',
  business:
    'Admins write what the business does and the words it uses. The assistant and AI apps get it as background.',
  people: 'Admins find people, and give and remove their roles.',
  sources:
    'Admins look after the tools we read definitions from. Owners see what changes there in Health and in their review queue.',
  limits: 'Admins change the limits, how long we keep records, and the AI models.',
  gateway:
    'Admins decide which AI apps can connect and which tools they can use. You connect your own AI app from your Settings.',
  import: 'Admins import files of facts as proposals.',
  audit: 'Admins and auditors read the history log.',
  operations: 'Admins watch the scheduled jobs and the definition sources.',
}

/**
 * Administration (navigation decision, 12 October 2026): the sidebar's place for the people who
 * run the workspace and those who oversee it. Workspace holds Domains, About our business, People, Sources,
 * Limits, MCP and gateway, and Import facts; Oversight the History log and Operations. Admins
 * have every section; an auditor reads the history log only, and anyone else is told whose place
 * it is. The section is in the address (`section=`), so each is linkable; a section opened that
 * is not the person's says whose it is. The service checks every call again.
 */
export function AdminPage({ search }: { search: AdminSearch }) {
  return (
    <AudienceGate
      audience="administration"
      title="Administration"
      refusal={{
        title: 'Administration is for admins and auditors',
        description:
          'The data team runs domains, roles, limits and AI app access here, and auditors read the history log. Your own profile and AI apps are in Settings, in the menu under your name.',
      }}
    >
      <AdminSections search={search} />
    </AudienceGate>
  )
}

function AdminSections({ search }: { search: AdminSearch }) {
  const navigate = useNavigate()
  const { permissions } = usePermissions()
  const sections = adminSectionsFor(permissions)
  const first = sections[0] ?? 'audit'
  // An old address of a renamed section (People and roles) opens the section it became.
  const asked = search.section
  const section: AdminSection =
    asked === undefined
      ? first
      : isRetiredAdminSection(asked)
        ? retiredAdminSectionMoves[asked]
        : asked
  const allowed = sections.includes(section)
  const groups = adminSectionGroups.map((group) => ({
    title: group.title,
    sections: group.sections.filter((entry) => sections.includes(entry)),
  }))
  const sourceOpen = allowed && section === 'sources' && search.source !== undefined
  const sourceName = useSourceName(sourceOpen ? search.source : undefined)
  // The form to add a source, or to change one's settings, names itself in its own heading; so
  // does the list of connectors to add a source of.
  const sourceForm =
    allowed && section === 'sources' && (search.source ? search.edit === true : search.add === true)
  const connectorTitle = useConnectorTitle(
    sourceForm && !search.source ? search.connector : undefined,
  )
  const formTitle = sourceForm
    ? search.source
      ? `Change settings - ${sourceName ?? search.source}`
      : search.connector
        ? `${connectorTitle ?? search.connector} - Add a connector`
        : 'Add a connector'
    : undefined
  const documentTitle = allowed
    ? `${formTitle ? `${formTitle} - ` : sourceName ? `${sourceName} - ` : ''}${adminSectionTitles[section]} - Administration`
    : 'Administration'

  return (
    // The section is the page's title where the person has the section list (the trail names it);
    // an auditor's one section is Administration itself. A source's page shows its own name as
    // the page's heading, as a record page does (the trail ends with its id).
    <Page
      title={allowed && sections.length > 1 ? adminSectionTitles[section] : 'Administration'}
      documentTitle={documentTitle}
      heading={sourceName || sourceForm ? 'paper' : 'hidden'}
    >
      {sections.length > 1 ? (
        <PageToolbar>
          <SectionNav
            label="Administration sections"
            groups={groups}
            titles={adminSectionTitles}
            active={section}
            link={(value) => <Link to="/admin" search={{ section: value }} />}
            onChoose={(value) => void navigate({ to: '/admin', search: { section: value } })}
          />
        </PageToolbar>
      ) : null}
      {allowed ? (
        <SectionBody section={section} search={search} />
      ) : (
        <PageContent width="overview">
          <Empty className="flex-none border" data-slot="settings-refused">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <LockIcon />
              </EmptyMedia>
              <EmptyTitle>{adminSectionTitles[section]} is for admins</EmptyTitle>
              <EmptyDescription>{refusals[section]} Ask an admin if you need it.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button variant="outline" render={<Link to="/admin" search={{ section: first }} />}>
                Open the {adminSectionTitles[first].toLowerCase()}
              </Button>
            </EmptyContent>
          </Empty>
        </PageContent>
      )}
    </Page>
  )
}

/** The title of the connector whose form is open, once the list of connectors has it. */
function useConnectorTitle(id: string | undefined): string | undefined {
  const listings = useQuery({ ...sourceTypesQuery(), enabled: id !== undefined })
  return id
    ? listings.data?.find((listing) => listing.manifest.id === id)?.manifest.title
    : undefined
}

/** The name of the source open in Sources, once the overview has it. */
function useSourceName(id: string | undefined): string | undefined {
  const overview = useQuery({ ...operationsQuery(), enabled: id !== undefined })
  return id ? overview.data?.connectors.find((source) => source.id === id)?.name : undefined
}

function SectionBody({ section, search }: { section: AdminSection; search: AdminSearch }) {
  switch (section) {
    case 'domains':
      return <DomainsSection />
    case 'business':
      return <BusinessSection />
    case 'people':
      return <PeopleSection search={search} />
    case 'sources':
      return (
        <Suspense fallback={<SourcesLoading />}>
          <SourcesSection search={search} />
        </Suspense>
      )
    case 'limits':
      return <LimitsSection search={search} />
    case 'gateway':
      return <GatewaySection search={search} />
    case 'import':
      return <ImportSection />
    case 'audit':
      return <AuditSection search={search} />
    case 'operations':
      return <OperationsSection />
  }
}
