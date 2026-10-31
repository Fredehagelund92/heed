import * as React from "react"
import { ChevronDownIcon, ChevronUpIcon, NotebookTextIcon, PlusIcon } from "lucide-react"
import { cn } from "cn"
import { ConflictView } from "@/components/heed/conflict-view"
import { conflictHref } from "@/lib/conflict"
import { useConflictList } from "@/hooks/use-conflicts"
import { DockFrame, DockMissing, PeekBar } from "@/components/dock"
import { Loadable, TableSkeleton } from "@/components/heed/load-state"
import { TextSwitch } from "@/components/heed/switches"
import { Page, SiteHeader } from "@/components/site-header"
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { askedOf, MANY, pairAt, rightsOf, type ConflictPair } from "@/data/conflicts"
import { domains } from "@/data/world"
import { openDock } from "@/lib/dock"
import { href, navigate, setQuery, useRoute } from "@/lib/router"
import { useFacts, useMe } from "@/lib/store"

// Where a conflict is settled: its own page under Context, the conflict dock (720, expandable to
// the page) and the Conflicts view of the Context list. All three draw the one ConflictView.

/** Items or Conflicts: the Context list's two views. */
export function ContextViews({ value }: { value: "items" | "conflicts" }) {
  const n = useConflictList().length
  const { query } = useRoute()
  const many = query.get("state") === "many" ? MANY.length : 0
  return (
    <TextSwitch
      label="Show"
      value={value}
      onChange={(v) => navigate(v === "items" ? "/context" : "/context/conflicts")}
      options={[
        { value: "items", label: "Items" },
        { value: "conflicts", label: "Conflicts", count: n + many },
      ]}
    />
  )
}

/** The page: the pair, with Context before it, and J and K through the conflict list. */
export function ConflictPage({ pairKey }: { pairKey: string }) {
  const facts = useFacts()
  const pair = pairAt(facts, pairKey)
  const [topic] = React.useState(() => pair?.topic)
  return (
    <Page
      title={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="#/context/conflicts">Context</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate">Conflict{topic ? `: ${topic}` : ""}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      actions={
        <span className="flex items-center gap-1 text-xs text-muted-foreground max-md:hidden">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
        </span>
      }
    >
      <div className="mx-auto flex min-h-full w-full max-w-wide flex-col px-4 py-6 md:px-8 md:py-8">
        <ConflictView key={pairKey} pairKey={pairKey} place="page" onStep={(p) => navigate(conflictHref(p))} />
      </div>
    </Page>
  )
}

/** The dock: the same view at 720, its up and down stepping through the conflict list, and the page behind it. */
export function ConflictDock({ pairKey }: { pairKey: string }) {
  const facts = useFacts()
  const list = useConflictList()
  const pair = pairAt(facts, pairKey)
  const at = pair ? list.findIndex((p) => p.key === pair.key) : -1
  const go = (p: ConflictPair) => openDock("conflict", p.key)
  if (!pair && at < 0 && !pairKey)
    return (
      <DockFrame title="Conflict">
        <DockMissing>This conflict isn't there any more. Close the panel and open Conflicts in Context.</DockMissing>
      </DockFrame>
    )
  return (
    <DockFrame
      title="Conflict"
      quietTitle
      actions={
        <PeekBar onExpand={() => navigate(conflictHref({ key: pairKey }))}>
          {at >= 0 && (
            <span className="flex items-center gap-0.5">
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Previous conflict" disabled={at === 0} onClick={() => go(list[at - 1])} />}>
                  <ChevronUpIcon />
                </TooltipTrigger>
                <TooltipContent>
                  Previous <Kbd>K</Kbd>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Next conflict" disabled={at === list.length - 1} onClick={() => go(list[at + 1])} />}>
                  <ChevronDownIcon />
                </TooltipTrigger>
                <TooltipContent>
                  Next <Kbd>J</Kbd>
                </TooltipContent>
              </Tooltip>
            </span>
          )}
        </PeekBar>
      }
    >
      <div className="dock-swap p-4 md:p-5" key={pairKey}>
        <ConflictView pairKey={pairKey} place="dock" onStep={go} />
      </div>
    </DockFrame>
  )
}

const SHOWN = 6

/** Context, Conflicts: one row per pair, most asked first, mine or all. No bulk action: each needs a reason. */
export function ConflictsPage() {
  const me = useMe()
  const { query } = useRoute()
  const list = useConflictList()
  const many = query.get("state") === "many"
  const whose = query.get("whose") === "all" ? "all" : "mine"
  const [more, setMore] = React.useState(false)
  const rows = [
    ...list.map((p) => ({
      key: p.key,
      topic: p.topic,
      a: p.holder.title,
      b: p.other.title,
      domains: [...new Set([p.holder.domain, p.other.domain])].map((d) => domains[d].name).join(" and "),
      asked: askedOf(p).asked,
      since: askedOf(p).since,
      mine: me.owns.includes(p.holder.domain) || me.owns.includes(p.other.domain),
      can: rightsOf(me, p).any,
      open: () => openDock("conflict", p.key),
      page: href(conflictHref(p)),
    })),
    ...(many ? MANY.map((m, i) => ({ key: `many-${i}`, topic: m.topic, a: m.a, b: m.b, domains: m.domains, asked: m.asked, since: m.since, mine: m.mine, can: m.mine, open: undefined, page: undefined })) : []),
  ].sort((x, y) => y.asked - x.asked)
  const mineCount = rows.filter((r) => r.mine).length
  const shownRows = (whose === "mine" ? rows.filter((r) => r.mine) : rows).slice(0, more ? undefined : SHOWN)
  const hidden = (whose === "mine" ? mineCount : rows.length) - shownRows.length
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title="Context" icon={<NotebookTextIcon />}>
        <Button size="sm" onClick={() => navigate("/context/new")}>
          <PlusIcon data-icon="inline-start" />
          New context
        </Button>
      </SiteHeader>
      <div className="@container/main flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-wide flex-col gap-4 px-4 py-5 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ContextViews value="conflicts" />
            {rows.length > 0 && (
              <TextSwitch
                label="Whose"
                value={whose}
                onChange={(v) => setQuery({ whose: v === "all" ? "all" : undefined })}
                options={[
                  { value: "mine", label: "Mine", count: mineCount },
                  { value: "all", label: "All", count: rows.length },
                ]}
              />
            )}
          </div>
          <Loadable what="the conflicts" skeleton={<TableSkeleton rows={6} />}>
            {rows.length === 0 ? (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyTitle>Nothing disagrees</EmptyTitle>
                  <EmptyDescription>Agents get one answer for every question that was asked. A conflict shows here when an owner marks two items as disagreeing.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button variant="outline" onClick={() => navigate("/context")}>
                    Back to the items
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {rows.length} {rows.length === 1 ? "conflict" : "conflicts"}. Agents get both items of each. Most asked first.
                </p>
                <div className="overflow-x-auto rounded-frame border">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Conflicts, most asked first</caption>
                    <thead>
                      <tr className="bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] text-xs text-muted-foreground">
                        <th className="h-9 px-4 text-left font-medium">Topic</th>
                        <th className="h-9 px-4 text-left font-medium">The two items</th>
                        <th className="h-9 px-4 text-left font-medium max-md:hidden">Domains</th>
                        <th className="h-9 px-4 text-right font-medium">Asked</th>
                        <th className="h-9 px-4 text-left font-medium max-sm:hidden">Since</th>
                        <th className="h-9 px-4 text-left font-medium max-md:hidden">
                          <span className="sr-only">What you can do</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownRows.map((r) => (
                        <tr
                          key={r.key}
                          className={cn("border-t align-top", r.open && "cursor-pointer hover:bg-muted/50")}
                          onClick={r.open}
                        >
                          <td className="px-4 py-3 font-medium">
                            {r.page ? (
                              <a
                                href={r.page}
                                className="underline-offset-4 hover:underline"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  r.open?.()
                                }}
                              >
                                {r.topic}
                              </a>
                            ) : (
                              r.topic
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className="block">{r.a}</span>
                            <span className="block text-muted-foreground">{r.b}</span>
                          </td>
                          <td className="px-4 py-3 max-md:hidden">{r.domains}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{r.asked}</td>
                          <td className="px-4 py-3 whitespace-nowrap max-sm:hidden">{r.since}</td>
                          <td className="px-4 py-3 text-xs text-muted-foreground max-md:hidden">{r.can ? "You can settle it" : "Ask the owner"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  {hidden > 0 ? (
                    <Button variant="ghost" size="sm" onClick={() => setMore(true)}>
                      Show {hidden} more ({hidden} not shown)
                    </Button>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-muted-foreground">
                    {rows.length} {rows.length === 1 ? "conflict" : "conflicts"}, {mineCount} {mineCount === 1 ? "is" : "are"} yours
                  </span>
                </div>
              </>
            )}
          </Loadable>
        </div>
      </div>
    </div>
  )
}
