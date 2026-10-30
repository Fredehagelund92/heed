import * as React from 'react'
import { Page } from '@/components/site-header'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { FramePage } from '@/components/heed/frame'
import { OBS_TITLES, seesObservability, type ObsSection } from '@/lib/obs'
import { SettingsCrumbs } from '@/pages/settings'
import { useMe } from '@/lib/workspace'
import { OverviewPage } from '@/pages/observability/overview'
import { QuestionsPage } from '@/pages/observability/questions'
import { QualityPage } from '@/pages/observability/quality'
import { FeedbackPage } from '@/pages/observability/feedback'
import { UsagePage } from '@/pages/observability/usage'
import { AlertsPage } from '@/pages/observability/alerts'
import { DigestPage, SummaryPage } from '@/pages/observability/summary'

// Observability: what agents asked and what they got, as counts and scopes, never the words of a
// question or who asked. Seven pages in four groups (components/obs/obs-nav.tsx), Summary first,
// for admins and, for their own domains, owners. Usage and spend are for admins.

// A topic's answer panel, the dock these pages open (App.tsx): it loads with them.
export { AnswerPanel } from '@/components/obs/answer-panel'

/** The breadcrumb: Observability, then the page, then what is open in it. */
export function ObsCrumbs({
  section,
  rest = [],
}: {
  section: ObsSection
  rest?: { label: string; href?: string }[]
}) {
  return (
    <SettingsCrumbs
      trail={[
        { label: 'Observability', href: '/observability/summary' },
        { label: OBS_TITLES[section], href: `/observability/${section}` },
        ...rest,
      ]}
    />
  )
}

/** One page of Observability: the breadcrumb in the header, the frames in the page's gutter. */
export function ObsPage({
  section,
  crumbs,
  actions,
  children,
}: {
  section: ObsSection
  /** A breadcrumb that goes further than the page, to what is open in it. */
  crumbs?: React.ReactNode
  actions?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Page title={crumbs ?? <ObsCrumbs section={section} />} actions={actions}>
      <FramePage>{children}</FramePage>
    </Page>
  )
}

/** A page of Observability, or with `snapshot` the digest of one of Summary's monthly snapshots. */
export function ObservabilityPage({ section, snapshot }: { section?: string; snapshot?: string }) {
  const me = useMe()
  const current = (section && section in OBS_TITLES ? section : 'summary') as ObsSection
  if (!seesObservability(me) || (current === 'usage' && !me.admin))
    return (
      <Page title="Observability">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {current === 'usage'
                ? 'Usage is for admins'
                : 'Observability is for owners and admins'}
            </EmptyTitle>
            <EmptyDescription>
              {current === 'usage'
                ? 'Owners see Summary, Overview, Questions, Quality, Feedback and Alerts for their domains.'
                : 'It shows what agents asked and what they got. Ask an owner of your domain, or an admin.'}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )
  if (current === 'summary') return snapshot ? <DigestPage id={snapshot} /> : <SummaryPage />
  if (current === 'overview') return <OverviewPage />
  if (current === 'questions') return <QuestionsPage />
  if (current === 'quality') return <QualityPage />
  if (current === 'feedback') return <FeedbackPage />
  if (current === 'usage') return <UsagePage />
  return <AlertsPage />
}
