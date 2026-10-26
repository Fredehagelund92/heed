import * as React from "react"
import { Page } from "@/components/site-header"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { FramePage } from "@/components/heed/frame"
import { OBS_TITLES, seesObservability, type ObsSection } from "@/lib/obs"
import { SettingsCrumbs } from "@/pages/settings"
import { useMe } from "@/lib/store"
import { OverviewPage } from "@/pages/observability/overview"
import { QuestionsPage } from "@/pages/observability/questions"
import { QualityPage } from "@/pages/observability/quality"
import { FeedbackPage } from "@/pages/observability/feedback"
import { UsagePage } from "@/pages/observability/usage"
import { AlertsPage } from "@/pages/observability/alerts"

// Observability: what agents asked and what they got, as counts and scopes, never the words of a
// question or who asked. Six pages in three groups (components/obs/obs-nav.tsx), for admins and,
// for their own domains, owners. Usage and spend are for admins.

/** The breadcrumb: Observability, then the page, then what is open in it. */
export function ObsCrumbs({ section, rest = [] }: { section: ObsSection; rest?: { label: string; href?: string }[] }) {
  return (
    <SettingsCrumbs trail={[{ label: "Observability", href: "#/observability/overview" }, { label: OBS_TITLES[section], href: `#/observability/${section}` }, ...rest]} />
  )
}

/** One page of Observability: the breadcrumb in the header, the frames in the page's gutter. */
export function ObsPage({ section, actions, children }: { section: ObsSection; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Page title={<ObsCrumbs section={section} />} actions={actions}>
      <FramePage>{children}</FramePage>
    </Page>
  )
}

export function ObservabilityPage({ section }: { section?: string }) {
  const me = useMe()
  const current = (section && section in OBS_TITLES ? section : "overview") as ObsSection
  if (!seesObservability(me) || (current === "usage" && !me.admin))
    return (
      <Page title="Observability">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{current === "usage" ? "Usage is for admins" : "Observability is for owners and admins"}</EmptyTitle>
            <EmptyDescription>
              {current === "usage"
                ? "Owners see Overview, Questions, Quality, Feedback and Alerts for their domains."
                : "It shows what agents asked and what they got. Ask an owner of your domain, or an admin."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )
  if (current === "overview") return <OverviewPage />
  if (current === "questions") return <QuestionsPage />
  if (current === "quality") return <QualityPage />
  if (current === "feedback") return <FeedbackPage />
  if (current === "usage") return <UsagePage />
  return <AlertsPage />
}
