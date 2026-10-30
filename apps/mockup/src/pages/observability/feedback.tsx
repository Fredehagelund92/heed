import * as React from "react"
import { ArrowUpRightIcon, BotIcon, CheckIcon, FlagIcon, LockIcon, MinusIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react"
import { cn } from "cn"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Frame, FrameSection } from "@/components/heed/frame"
import { Loadable } from "@/components/heed/load-state"
import { ObsSkeleton } from "@/components/obs/obs-skeleton"
import { DomainDot } from "@/components/heed/tag-chip"
import { Bars } from "@/components/obs/charts"
import { Kpi, RangeSwitch } from "@/components/obs/controls"
import { kpiChange, moreOrFewer } from "@/lib/obs-change"
import { countChange, FEEDBACK_WEEK, GOOD_BY_WEEK, REPORT_WORDS, REPORTS, shownCount, type ReportState } from "@/data/observability"
import { domains } from "@/data/world"
import { OBS_PURPOSE, useObsView } from "@/lib/obs"
import { ObsPage } from "@/pages/observability"

// Feedback: what people and agents said about answers. A thumbs up or down under an answer in Ask
// keeps only the verdict and the domain; a report is sent on purpose, so it carries the person's
// name; an agent's report carries its kind, never a name. Open reports wait in the Inbox, which is
// the queue: nothing is scored here. Agents never read comments or reports.

const STATE_ICON: Record<ReportState, typeof FlagIcon> = { inbox: FlagIcon, looked: CheckIcon, fine: MinusIcon }

export function FeedbackPage() {
  return (
    <ObsPage section="feedback">
      <Loadable what="the feedback" skeleton={<ObsSkeleton section="feedback" kpis={4} body="split" />}>
        <Feedback />
      </Loadable>
    </ObsPage>
  )
}

function Feedback() {
  const view = useObsView()
  const [tab, setTab] = React.useState<"all" | ReportState>("all")
  const reports = view.state === "empty" ? [] : REPORTS.filter((r) => !view.owned || view.owned.includes(r.domain))
  const shown = reports.filter((r) => tab === "all" || r.state === tab)
  const weeks = view.range === 90 ? 13 : 8
  const scale = view.range === 7 ? 1 : view.range === 30 ? 4.3 : 12.9
  const good = view.state === "empty" ? 0 : Math.round(FEEDBACK_WEEK.good * scale)
  const wrong = view.state === "empty" ? 0 : Math.round(FEEDBACK_WEEK.wrong * scale)
  const people = reports.filter((r) => !r.agent).length
  const agents = reports.filter((r) => r.agent).length
  if (view.state === "empty")
    return (
      <Frame>
        <FrameSection title="Feedback" description={OBS_PURPOSE.feedback} />
        <Empty className="border-t py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ThumbsUpIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing said about answers yet</EmptyTitle>
            <EmptyDescription>
              When someone marks an answer in Ask, or reports one, or an agent reports a gap, it shows here. Open reports wait in the Inbox.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Frame>
    )
  return (
    <Frame>
      <FrameSection title="Feedback" description={OBS_PURPOSE.feedback} action={<RangeSwitch value={view.range} />} />
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        <Kpi
          icon={<ThumbsUpIcon />}
          label="Good answer"
          value={shownCount(good)}
          change={view.range === 7 ? kpiChange(countChange(good, good - FEEDBACK_WEEK.goodChange), moreOrFewer, "up") : undefined}
          sub={`${view.label}, in Ask`}
        />
        <Kpi
          icon={<ThumbsDownIcon />}
          label="Something was wrong"
          value={wrong < 5 ? <span className="text-xl">Fewer than 5</span> : wrong}
          sub={wrong < 5 ? "a count under 5 is hidden" : `${view.label}, in Ask`}
        />
        {/* Reports are sent on purpose and carry a name, so their count hides nobody: it shows as it is. */}
        <Kpi icon={<FlagIcon />} label="Reports" value={people} sub="sent on purpose, with a name" />
        <Kpi icon={<BotIcon />} label="From agents" value={agents} sub="reported a gap or gave feedback" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] border-t @4xl/main:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-x-1 border-b px-3 md:px-4">
            {(["all", "inbox", "looked", "fine"] as const).map((k) => {
              const n = k === "all" ? reports.length : reports.filter((r) => r.state === k).length
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "-mb-px flex h-10 items-center gap-1.5 border-b-2 border-transparent px-2 text-[13px] whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                    tab === k && "border-foreground font-medium text-foreground"
                  )}
                >
                  {k === "all" ? "All" : k === "inbox" ? "In the Inbox" : REPORT_WORDS[k]}
                  <span className="text-xs tabular-nums">{n}</span>
                </button>
              )
            })}
          </div>
          <div role="tabpanel" aria-label={tab === "all" ? "All reports" : REPORT_WORDS[tab]}>
            <ul>
              {shown.map((r) => {
                const Icon = STATE_ICON[r.state]
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-4 py-3 md:px-5">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                      {r.agent ? <BotIcon className="size-4" aria-hidden /> : <FlagIcon className="size-4" aria-hidden />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a href={r.href} className="block truncate text-sm font-medium underline-offset-4 hover:underline">
                        {r.title}
                      </a>
                      <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <DomainDot id={r.domain} />
                        {domains[r.domain].name} - {r.line}
                      </p>
                    </div>
                    {/* On a narrow page the state and who sent it go under the title. */}
                    <div className="flex shrink-0 flex-col items-end gap-1 @max-2xl/main:basis-full @max-2xl/main:flex-row @max-2xl/main:items-center @max-2xl/main:gap-2 @max-2xl/main:pl-11">
                      <span
                        className={cn(
                          "inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs whitespace-nowrap",
                          r.state === "inbox" && "border-[color-mix(in_oklab,var(--warn)_45%,transparent)] text-foreground",
                          r.state === "looked" && "text-foreground",
                          r.state === "fine" && "text-muted-foreground"
                        )}
                      >
                        <Icon className="size-3" aria-hidden />
                        {REPORT_WORDS[r.state]}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.from} - {r.when}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
          <a
            href="#/inbox"
            className="flex items-center gap-1.5 px-4 py-3 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:px-5"
          >
            <ArrowUpRightIcon className="size-3.5" aria-hidden />
            Open reports wait in the Inbox
          </a>
        </div>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
          <FrameSection title="Good answer, by week" description="Thumbs under an answer in Ask. Only the verdict and the domain are kept.">
            <div className="px-3 pb-3">
              <Bars values={GOOD_BY_WEEK.values.slice(-weeks)} labels={GOOD_BY_WEEK.labels.slice(-weeks)} caption="Good answers, by week" />
            </div>
          </FrameSection>
          <p className="flex items-start gap-2 border-t px-4 py-4 text-sm text-muted-foreground md:px-5">
            <LockIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
            Comments and reports are read by owners and admins. Agents never read them.
          </p>
        </div>
      </div>
    </Frame>
  )
}
