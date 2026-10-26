import { ArrowUpRightIcon, BellIcon, PlusIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Frame, FrameSection } from "@/components/heed/frame"
import { Loadable } from "@/components/heed/load-state"
import { ObsSkeleton } from "@/components/obs/obs-skeleton"
import { DomainDot } from "@/components/heed/tag-chip"
import { lastOf, RAISED, rulesFor, setMuted, setRuleOn, setThreshold, thresholdOf, useAlerts, type Rule } from "@/data/alerts"
import { domains, type DomainId } from "@/data/world"
import { OBS_PURPOSE, useObsView } from "@/lib/obs"
import { useMe } from "@/lib/store"
import { ObsPage } from "@/pages/observability"

// Alerts: what raises a card in the Inbox, as rules of one sentence each, and what was raised
// lately. The Inbox is the only place an alert goes. An admin turns a rule off for everyone and
// changes its threshold in the sentence; an owner mutes a rule for their own domains.

const ADD_REASON = "The eight rules are fixed for now. Your own rules, and email and chat, come later."

export function AlertsPage() {
  return (
    <ObsPage section="alerts">
      <Loadable what="the alerts" skeleton={<ObsSkeleton section="alerts" body="rules" />}>
        <Alerts />
      </Loadable>
    </ObsPage>
  )
}

function Alerts() {
  const view = useObsView()
  const me = useMe()
  const s = useAlerts()
  const rules = rulesFor(me.admin)
  const owned = view.owned
  const raised = view.state === "empty" ? [] : RAISED.filter((r) => !owned || (r.domain && owned.includes(r.domain)))
  const head = "text-xs font-medium text-muted-foreground"
  return (
    <Frame>
      <FrameSection
        title="Alerts"
        description={OBS_PURPOSE.alerts}
        action={
          <Button variant="outline" size="sm" aria-disabled aria-description={ADD_REASON} title={ADD_REASON}>
            <PlusIcon data-icon="inline-start" />
            Add a rule
          </Button>
        }
      />
      <section aria-labelledby="alert-rules" className="border-t">
        <h3 id="alert-rules" className="sr-only">
          Rules
        </h3>
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_11rem_3rem] gap-x-4 border-b bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] px-5 py-2.5 @4xl/main:grid"
        >
          <span className={head}>When</span>
          <span className={head}>What happens</span>
          <span className={head}>Last raised</span>
          <span className={cn(head, "text-right")}>{me.admin ? "On" : "For you"}</span>
        </div>
        <ul>
          {rules.map((r) => (
            <RuleRow key={r.id} rule={r} admin={me.admin} owned={owned} empty={view.state === "empty"} state={s} />
          ))}
        </ul>
        {!me.admin && (
          <p className="border-b px-4 py-3 text-[13px] text-muted-foreground md:px-5">
            Four more rules go only to admins: about spend, failed calls and the whole workspace.
          </p>
        )}
      </section>

      <FrameSection title="Raised lately" description="Newest first. Each one is a card in the Inbox." className="border-t-0">
        {raised.length ? (
          <ul className="border-t">
            {raised.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b px-4 py-3 last:border-b-0 md:px-5">
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground">
                  <BellIcon className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <a href={r.href} className="text-sm font-medium underline-offset-4 hover:underline">
                    {r.title}
                  </a>
                  <p className="text-[13px] text-muted-foreground">
                    {r.domain && (
                      <span className="mr-1.5 inline-flex items-center gap-1.5 align-middle">
                        <DomainDot id={r.domain} />
                        {domains[r.domain].name} -
                      </span>
                    )}{" "}
                    {r.line}
                  </p>
                </div>
                <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground max-sm:basis-full max-sm:pl-11">{r.when}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty className="border-t py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BellIcon />
              </EmptyMedia>
              <EmptyTitle>{view.state === "empty" ? "Nothing has raised an alert yet" : "Nothing raised for your domains lately"}</EmptyTitle>
              <EmptyDescription>When a rule above fires, its card goes to the Inbox and shows here too.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </FrameSection>
      <p className="flex items-start gap-2 border-t px-4 py-4 text-sm text-muted-foreground md:px-5">
        <UsersIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        Owners see and mute alerts for their own domains. Admins turn rules off and change the thresholds. Email and chat are for later.
      </p>
    </Frame>
  )
}

function RuleRow({ rule: r, admin, owned, empty, state }: { rule: Rule; admin: boolean; owned: DomainId[] | null; empty: boolean; state: ReturnType<typeof useAlerts> }) {
  const mine = owned ?? []
  const muted = !admin && mine.length > 0 && mine.every((d) => state.muted[r.id]?.includes(d))
  const on = admin ? !state.off.includes(r.id) : !muted
  const where = mine.map((d) => domains[d].name).join(" and ")
  const value = thresholdOf(r, state)
  const [before, after] = r.when.split("{n}")
  const seen = lastOf(r, owned)
  const last = empty ? "Never" : seen.last

  const toggle = (next: boolean) => {
    if (admin) {
      setRuleOn(r.id, next)
      toast(next ? `Turned on: ${r.name}` : `Turned off: ${r.name}`, {
        description: next ? "It raises cards in the Inbox again." : "Nothing raises this card until it is on again.",
        action: { label: "Undo", onClick: () => setRuleOn(r.id, !next) },
      })
    } else {
      setMuted(r.id, mine, !next)
      toast(next ? `Unmuted for ${where}` : `Muted for ${where}`, {
        description: next ? "Its cards reach you again." : "Its cards stop reaching you. Other owners and admins still get them.",
        action: { label: "Undo", onClick: () => setMuted(r.id, mine, next) },
      })
    }
  }

  return (
    <li
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-b px-4 py-3.5 md:px-5 @4xl/main:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_11rem_3rem] @4xl/main:items-center",
        !on && "[&_[data-dim]]:text-muted-foreground"
      )}
    >
      <div className="min-w-0">
        <p data-dim className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {r.name}
          {r.isNew && <span className="inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-normal text-muted-foreground">New</span>}
        </p>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          {r.threshold && after !== undefined ? (
            <>
              {before}
              {admin ? (
                <Select
                  value={value}
                  onValueChange={(v) => {
                    const was = value
                    setThreshold(r.id, v as string)
                    toast("Threshold changed", {
                      description: `${r.name}: ${before}${v}${after}.`,
                      action: { label: "Undo", onClick: () => setThreshold(r.id, was!) },
                    })
                  }}
                >
                  <SelectTrigger size="sm" aria-label={`${r.name}: threshold`} className="mx-0.5 inline-flex h-6 gap-1 px-1.5 align-baseline text-[13px] text-foreground">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {r.threshold.choices.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              ) : (
                <span className="font-medium text-foreground">{value}</span>
              )}
              {after}
            </>
          ) : (
            r.when
          )}
        </p>
      </div>
      <div className="col-start-2 row-start-1 flex items-start justify-end pt-0.5 @4xl/main:col-start-4 @4xl/main:items-center @4xl/main:pt-0">
        <Switch checked={on} onCheckedChange={toggle} aria-label={admin ? r.name : `${r.name}, for ${where}`} />
      </div>
      <p data-dim className="text-[13px] @4xl/main:row-start-1 @4xl/main:col-start-2 @4xl/main:text-sm">
        <span className="text-muted-foreground @4xl/main:sr-only">Then: </span>
        {r.then}
      </p>
      <p className="col-span-2 text-[13px] text-muted-foreground @4xl/main:col-span-1 @4xl/main:row-start-1 @4xl/main:col-start-3">
        <span className="@4xl/main:sr-only">Last raised: </span>
        {seen.href && last !== "Never" ? (
          <a href={seen.href} className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
            {last}
            <ArrowUpRightIcon className="size-3" aria-hidden />
          </a>
        ) : (
          last
        )}
        {!admin && muted && <span className="ml-1.5">- muted for {where}</span>}
      </p>
    </li>
  )
}
