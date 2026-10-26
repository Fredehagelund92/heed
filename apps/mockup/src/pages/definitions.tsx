import * as React from "react"
import {
  ArrowUpDownIcon,
  BookAIcon,
  ChevronDownIcon,
  ListFilterIcon,
  ListTreeIcon,
  PencilIcon,
  RefreshCwIcon,
  PlusIcon,
  ExternalLinkIcon,
  CircleDashedIcon,
  TriangleAlertIcon,
  EqualIcon,
} from "lucide-react"
import { cn } from "cn"
import { ToolLogo } from "@/components/heed/tool-logo"
import { connectorById } from "@/data/integrations"
import { PersonAvatar } from "@/components/heed/bits"
import { AnotherNameFor, TypeGlyph, TypeTile } from "@/components/heed/definition"
import { TagChip } from "@/components/heed/tag-chip"
import {
  AddRow,
  BarSpacer,
  barButton,
  Count,
  FilterChip,
  FilterRow,
  FilterValue,
  GroupRow,
  Highlight,
  ListBar,
  RowMenu,
  SearchField,
  Th,
  thClass,
} from "@/components/heed/list"
import { Checkbox } from "@/components/ui/checkbox"
import { useSelection } from "@/hooks/use-selection"
import { DefinitionsBulk } from "@/components/heed/definitions-bulk"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { domainIds, domains, type DomainId } from "@/data/world"
import {
  alsoCalled,
  conflictOf,
  contextAbout,
  findDefinition,
  foldsInto,
  sourceUrl,
  typeLabel,
  useDefinitions,
  type Definition,
  type DefinitionType,
  meaningOf,
} from "@/lib/definitions"
import { closeDock, openDock, useDock } from "@/lib/dock"
import { matches, usePublishOrder, useRowKeys, words } from "@/lib/list"
import { href, navigate, useRoute } from "@/lib/router"
import { useFacts } from "@/lib/store"
import { APP_URL } from "@/lib/brand"
import { TruncatedText } from "@/components/heed/truncated"
import { TextSwitch } from "@/components/heed/switches"
import { plainText } from "@/lib/mentions"
import { DEFINITIONS_TOOL } from "@/data/integrations"
import { Loadable, TableSkeleton } from "@/components/heed/load-state"
import { useFigures } from "@/lib/figures"

// Definitions: the data glossary, laid out like the Heed app's catalogue. Views with counts (All,
// Metrics, Dimensions, Terms), a line saying where the definitions come from, the same quiet bar
// and compact rows as Context, grouped by domain by default, and v1's two cues in the Status
// column: Definition changed, and No context yet with Write one. Metrics and dimensions come from
// Cube; terms are the business's own words, written here.

type View = "all" | DefinitionType
type Cue = "conflict" | "changed" | "none"
type Group = "domain" | "type" | "group" | "none"
const GROUPS: Record<Group, string> = { domain: "Domain", type: "Type", group: `Group in ${DEFINITIONS_TOOL}`, none: "No grouping" }
const SORTS = {
  coverage: { label: "Coverage", way: "No context first" },
  name: { label: "Name", way: "A to Z" },
  context: { label: "Context", way: "Most first" },
  updated: { label: "Last changed", way: "Newest first" },
  best: { label: "Best match", way: "Closest first" },
} as const
type Sort = keyof typeof SORTS
const CUES: Record<Cue, string> = { conflict: "Conflict", changed: "Definition changed", none: "No context yet" }
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`
const COLS = 7

/* ---------- the list ---------- */

export function DefinitionsPage() {
  const all = useDefinitions()
  const facts = useFacts()
  const dock = useDock()
  const { query } = useRoute()
  // Connecting definitions is the Cube integration's connect flow now, in Settings.
  const setup = !!query.get("setup")
  React.useEffect(() => {
    if (setup) navigate("/settings/integrations/cube/connect", { setup: "1" })
  }, [setup])
  const figures = useFigures()
  const [view, setView] = React.useState<View>("all")
  const [text, setText] = React.useState("")
  // A domain page links here filtered to its domain.
  const [domain, setDomain] = React.useState<DomainId[]>(() => (query.get("domain") ? [query.get("domain") as DomainId] : []))
  const [cues, setCues] = React.useState<Cue[]>([])
  // Synonyms fold into their definition's row as tags; this shows them as rows of their own, to audit them.
  const [synonymRows, setSynonymRows] = React.useState(false)
  const [group, setGroup] = React.useState<Group>("domain")
  const [folded, setFolded] = React.useState<string[]>([])
  const [chosenSort, setSort] = React.useState<Sort | null>(null)

  // Led by coverage: what agents would hear Not found for comes first.
  const sort: Sort = chosenSort ?? (text.trim() ? "best" : "coverage")
  const tool = connectorById("cube")!.name
  const about = (d: Definition) => contextAbout(d, facts).length
  // A row's conflict includes the words folded into it, so folding never hides one.
  const cueOf = (d: Definition): Cue | undefined =>
    conflictOf(d) || (!synonymRows && alsoCalled(d).some((x) => conflictOf(x)))
      ? "conflict"
      : d.changed
        ? "changed"
        : d.type !== "dimension" && !d.sameAs && about(d) === 0
          ? "none"
          : undefined
  // The rows: every definition and term, and a synonym only in the audit view (or when what it names is gone).
  const rows = all.filter((d) => synonymRows || !foldsInto(d))
  const otherNames = (d: Definition) => (synonymRows ? [] : alsoCalled(d).map((x) => x.name))
  const pass = (d: Definition, skip?: "view" | "domain" | "cue") =>
    (skip === "view" || view === "all" || d.type === view) &&
    (skip === "domain" || !domain.length || (d.domain && domain.includes(d.domain))) &&
    (skip === "cue" || !cues.length || cues.includes(cueOf(d)!)) &&
    matches(text, `${d.name} ${d.sourceNames.join(" ")} ${otherNames(d).join(" ")} ${plainText(d.definition)} ${d.sameAs ?? ""} ${d.group ?? ""}`)
  // Found by one of its other names: the row says which, quietly.
  const matchedBy = (d: Definition) =>
    text.trim() && !matches(text, d.name) ? [...otherNames(d), ...d.sourceNames].find((n) => words(text).some((w) => n.toLowerCase().includes(w))) : undefined
  const nameHits = (d: Definition) => words(text).filter((w) => `${d.name} ${d.sourceNames.join(" ")} ${otherNames(d).join(" ")}`.toLowerCase().includes(w)).length
  const shown = rows
    .filter((d) => pass(d))
    .sort((a, b) =>
      sort === "coverage"
        ? Number(cueOf(b) === "none") - Number(cueOf(a) === "none") || a.name.localeCompare(b.name)
        : sort === "context"
          ? about(b) - about(a)
          : sort === "updated"
            ? Date.parse(b.updated) - Date.parse(a.updated)
            : sort === "best"
              ? nameHits(b) - nameHits(a) || a.name.localeCompare(b.name)
              : a.name.localeCompare(b.name)
    )
  const keyOf = (d: Definition) =>
    group === "type" ? `${typeLabel[d.type]}s` : group === "group" ? (d.group ?? "Terms") : group === "domain" ? (d.domain ? domains[d.domain].name : "All domains") : ""
  const groups =
    group === "none"
      ? [{ key: "", rows: shown }]
      : [...new Set(shown.map(keyOf))]
          .sort((a, b) => (a === "All domains" ? 1 : b === "All domains" ? -1 : a.localeCompare(b)))
          .map((key) => ({ key, rows: shown.filter((d) => keyOf(d) === key) }))
  const visible = groups.flatMap((g) => (folded.includes(g.key) ? [] : g.rows))
  const order = visible.map((d) => d.name)
  usePublishOrder("definitions", order)
  const table = React.useRef<HTMLTableElement>(null)
  const [deleting, setDeleting] = React.useState(false)
  const sel = useSelection(order, { scope: table, onDeleteKey: () => setDeleting(true) })

  const peeked = dock?.kind === "def" ? dock.id : undefined
  // What can have context of its own: metrics and terms with their own meaning.
  const measurable = all.filter((d) => d.type !== "dimension" && !d.sameAs)
  const uncovered = measurable.filter((d) => about(d) === 0)
  const filters = domain.length + cues.length + Number(synonymRows)
  const typeCount = (t: View) => rows.filter((d) => (t === "all" || d.type === t) && pass(d, "view")).length
  const mix = (rows: Definition[]) =>
    (["metric", "dimension", "term"] as DefinitionType[])
      .map((t) => rows.filter((d) => d.type === t).length && plural(rows.filter((d) => d.type === t).length, typeLabel[t].toLowerCase()))
      .filter(Boolean)
      .join(", ")
  const rowKeys = useRowKeys({
    onMove: (name) => peeked && openDock("def", name),
    // Escape closes the peek first, then clears the selection.
    onEscape: () => {
      if (peeked) closeDock()
      else if (sel.count) sel.clear()
      else return false
      return true
    },
  })
  const clearAll = () => {
    setSynonymRows(false)
    setDomain([])
    setCues([])
    setText("")
    setView("all")
  }

  /** A flag only when something needs a look: a conflict, a definition Cube changed, or no description in Cube. */
  const foldedConflict = (d: Definition) => (synonymRows ? undefined : alsoCalled(d).find((x) => conflictOf(x)))
  const flagOf = (d: Definition) =>
    conflictOf(d)
      ? { icon: TriangleAlertIcon, tip: conflictOf(d)!.message }
      : foldedConflict(d)
        ? { icon: TriangleAlertIcon, tip: `Another name for it has a conflict: ${conflictOf(foldedConflict(d)!)!.message}` }
        : d.changed
          ? { icon: RefreshCwIcon, tip: `Definition changed in ${tool} on ${d.changed}. Context about it comes back to its owners to check.` }
          : d.synced && /^No description/.test(d.definition)
            ? { icon: TriangleAlertIcon, tip: `No description in ${tool}. Agents get the name only.` }
            : undefined

  const row = (d: Definition) => {
    const target = d.sameAs ? findDefinition(d.sameAs) : undefined
    const flag = flagOf(d)
    const n = about(d)
    // The lock is said once, in the line above the table; a row shows only who wrote a term.
    const source = d.synced ? null : (
      <span title={`Written by ${d.by}, ${d.updated}`} className="inline-flex">
        <PersonAvatar name={d.by ?? "Someone"} size={20} />
      </span>
    )
    const isSel = sel.isSelected(d.name)
    return (
      <tr
        key={d.name}
        aria-selected={isSel}
        data-state={isSel ? "selected" : undefined}
        data-peeked={peeked === d.name || undefined}
        className="group/row h-9 cursor-pointer border-b text-sm transition-colors hover:bg-muted/50 has-[[data-row-open]:focus-visible]:bg-muted data-[state=selected]:bg-muted data-peeked:bg-muted data-peeked:shadow-[inset_2px_0_0_var(--foreground)] @max-xl/main:h-auto"
        onMouseDown={sel.onMouseDown}
        onClick={(e) => sel.rowClick(d.name, e) || openDock("def", d.name)}
      >
        <td className="hidden w-[38px] pr-0 pl-4 align-middle md:w-[46px] md:pl-6 @xl/main:table-cell" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            aria-label={`Select ${d.name}`}
            {...sel.checkbox(d.name)}
            className={cn("transition-opacity group-hover/row:opacity-100", !sel.count && !isSel && "opacity-0 focus-visible:opacity-100")}
          />
        </td>
        {/* The name with its type tile, its other names as tags (or, in the audit view, a synonym's Another name for); the rest are short facts. */}
        <td className="max-w-0 pr-2 pl-4 align-middle md:pl-6 @xl/main:pl-1.5 @max-xl/main:py-2">
          <span className="flex min-w-0 items-center gap-2.5">
            <TypeTile d={d} />
            <span className="flex min-w-0 flex-col @xl/main:flex-row @xl/main:items-center @xl/main:gap-2">
              <button
                type="button"
                data-row-open={d.name}
                className="flex min-w-0 shrink text-left font-medium outline-none hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  if (!sel.titleClick(d.name, e)) openDock("def", d.name)
                }}
              >
                <TruncatedText text={d.name}>
                  <Highlight text={d.name} query={text} />
                </TruncatedText>
              </button>
              {target && <AnotherNameFor target={target} className="min-w-0 @max-xl/main:hidden" />}
              <AlsoCalledChips
                names={otherNames(d)}
                conflicts={alsoCalled(d)
                  .filter((x) => conflictOf(x))
                  .map((x) => x.name)}
                matched={matchedBy(d)}
              />
              {/* On a phone the short facts go on a second line. */}
              <span className="flex gap-2 text-[0.8125rem] text-muted-foreground @xl/main:hidden">
                {group !== "domain" && <span>{d.domain ? domains[d.domain].name : "All domains"}</span>}
                <span>{d.type === "dimension" ? "Every context item" : n ? `${n} context` : "No context yet"}</span>
              </span>
            </span>
          </span>
        </td>
        <td className={cn("hidden w-32 px-2 align-middle whitespace-nowrap text-muted-foreground", group !== "domain" && "@min-[60rem]/main:table-cell")}>
          {d.domain ? domains[d.domain].name : "–"}
        </td>
        <td className="hidden w-20 px-2 text-right align-middle tabular-nums @xl/main:table-cell">
          {d.type === "dimension" || d.sameAs ? (
            <span title={d.type === "dimension" ? "Dimensions apply to every context item" : `Counted on ${d.sameAs}`} className="text-[var(--idle)]">
              –
            </span>
          ) : n === 0 ? (
            // No context yet: the count becomes what to do about it.
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 h-7 px-2 text-[0.8125rem] font-medium text-primary hover:text-primary"
              aria-label={`Write context about ${d.name}`}
              onClick={(e) => {
                e.stopPropagation()
                navigate("/context/new", { metric: meaningOf(d).name })
              }}
            >
              Write
            </Button>
          ) : (
            <span title={`${n} context ${n === 1 ? "item" : "items"} about it`}>{n}</span>
          )}
        </td>
        <td className="w-8 px-1 align-middle">
          {flag && (
            <span title={flag.tip} className="inline-flex text-[var(--warn)]">
              <flag.icon aria-hidden className="size-4" strokeWidth={1.75} />
              <span className="sr-only">{flag.tip}</span>
            </span>
          )}
        </td>
        <td className="w-8 px-1 align-middle">{source}</td>
        <td className="w-10 pr-2 align-middle md:pr-4" onClick={(e) => e.stopPropagation()}>
          <RowMenu
            title={d.name}
            page={href(`/definitions/${encodeURIComponent(d.name)}`)}
            link={`${APP_URL}/definitions/${encodeURIComponent(d.name)}`}
            extra={
              d.synced
                ? [{ label: "Open in source", icon: <ExternalLinkIcon />, onSelect: () => window.open(sourceUrl(d), "_blank", "noreferrer") }]
                : [{ label: "Edit", icon: <PencilIcon />, onSelect: () => navigate(`/definitions/${encodeURIComponent(d.name)}/edit`) }]
            }
          />
        </td>
      </tr>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title="Definitions" icon={<BookAIcon />}>
        <Button size="sm" onClick={() => navigate("/definitions/new")}>
          <PlusIcon data-icon="inline-start" />
          New term
        </Button>
      </SiteHeader>
      {/* One scroller; what it holds (the bar, the table, the totals) sits in the 80rem frame, centred. */}
      <div className="@container/main flex min-h-0 flex-1 flex-col overflow-y-auto *:mx-auto *:w-full *:max-w-wide @min-[80rem]/main:*:border-x">
        <Loadable what="the definitions" skeleton={<TableSkeleton lead={[41, 57, 49]} />} errorClassName="border-b">
          <ListBar>
            {/* On a phone the views fold into one menu, so the bar keeps to two rows. */}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={cn(barButton, "text-foreground @md/main:hidden")} />}>
                {view === "all" ? "All" : `${typeLabel[view]}s`}
                <span className="text-xs text-muted-foreground tabular-nums">{typeCount(view)}</span>
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuRadioGroup value={view} onValueChange={(v) => setView(v as View)}>
                  {(["all", "metric", "dimension", "term"] as View[]).map((v) => (
                    <DropdownMenuRadioItem key={v} value={v}>
                      <FilterValue count={typeCount(v)}>{v === "all" ? "All" : `${typeLabel[v]}s`}</FilterValue>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Views are a filter, not navigation: quiet words with counts, the shared text switch. */}
            <TextSwitch
              label="Definitions to show"
              className="pl-1 text-[0.8125rem] @max-md/main:hidden"
              value={view}
              onChange={setView}
              options={(["all", "metric", "dimension", "term"] as View[]).map((v) => ({
                value: v,
                label: v === "all" ? "All" : `${typeLabel[v]}s`,
                count: typeCount(v),
                icon: v !== "all" ? <TypeGlyph d={{ type: v }} className="text-current" /> : undefined,
              }))}
            />
            <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-border @max-3xl/main:hidden" />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={cn(barButton, filters > 0 && "bg-muted text-foreground")} />}>
                <ListFilterIcon />
                <span className="@max-md/main:sr-only">Filter</span>
                {filters > 0 && <span className="tabular-nums">{filters}</span>}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-60">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Status</DropdownMenuLabel>
                  {(Object.keys(CUES) as Cue[]).map((c) => (
                    <DropdownMenuCheckboxItem key={c} checked={cues.includes(c)} onCheckedChange={() => setCues((x) => toggle(x, c))}>
                      <FilterValue count={all.filter((d) => cueOf(d) === c && pass(d, "cue")).length}>{CUES[c]}</FilterValue>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Synonyms</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem checked={synonymRows} onCheckedChange={setSynonymRows}>
                    <FilterValue count={all.filter((d) => foldsInto(d)).length}>
                      <span className="inline-flex items-center gap-2">
                        <TypeGlyph d={{ type: "term", sameAs: "x" }} />
                        Show synonyms as rows
                      </span>
                    </FilterValue>
                  </DropdownMenuCheckboxItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Domain</DropdownMenuLabel>
                  {domainIds.map((d) => (
                    <DropdownMenuCheckboxItem key={d} checked={domain.includes(d)} onCheckedChange={() => setDomain((x) => toggle(x, d))}>
                      <FilterValue count={all.filter((x) => x.domain === d && pass(x, "domain")).length}>{domains[d].name}</FilterValue>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={barButton} />}>
                <ArrowUpDownIcon />
                <span className="@max-5xl/main:sr-only">Sort</span>
                <span className="text-foreground @max-5xl/main:sr-only">{SORTS[sort].label}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuRadioGroup value={sort} onValueChange={(v) => setSort(v as Sort)}>
                  {(Object.keys(SORTS) as Sort[])
                    .filter((k) => k !== "best" || text.trim())
                    .map((k) => (
                      <DropdownMenuRadioItem key={k} value={k}>
                        <span className="flex w-full justify-between gap-3">
                          {SORTS[k].label}
                          <span className="text-xs text-muted-foreground">{SORTS[k].way}</span>
                        </span>
                      </DropdownMenuRadioItem>
                    ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className={barButton} />}>
                <ListTreeIcon />
                <span className={cn(group === "none" ? "sr-only" : "@max-5xl/main:sr-only")}>{group === "none" ? "Group" : GROUPS[group]}</span>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-44">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Group by</DropdownMenuLabel>
                  <DropdownMenuRadioGroup
                    value={group}
                    onValueChange={(v) => {
                      setGroup(v as Group)
                      setFolded([])
                    }}
                  >
                    {(Object.keys(GROUPS) as Group[]).map((g) => (
                      <DropdownMenuRadioItem key={g} value={g}>
                        {GROUPS[g]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <BarSpacer>
              <SearchField value={text} onChange={setText} placeholder="Search definitions" />
            </BarSpacer>
            <Count>
              {shown.length === rows.length ? (
                plural(rows.length, "definition")
              ) : (
                <>
                  <span className="font-semibold text-foreground">{shown.length}</span> of {plural(rows.length, "definition")}
                </>
              )}
            </Count>
          </ListBar>
          <FilterRow count={filters} onClear={() => (setDomain([]), setCues([]), setSynonymRows(false))}>
            {cues.length > 0 && <FilterChip field="Status" values={cues.map((c) => CUES[c])} onRemove={() => setCues([])} />}
            {synonymRows && <FilterChip field="Synonyms" values={["shown as rows"]} onRemove={() => setSynonymRows(false)} />}
            {domain.length > 0 && <FilterChip field="Domain" values={domain.map((d) => domains[d].name)} onRemove={() => setDomain([])} />}
          </FilterRow>
          {/* Where the definitions come from, as the catalogue says it under its toolbar. */}
          <p className="flex shrink-0 items-start gap-2 border-b px-4 py-2 text-xs leading-5 text-muted-foreground md:px-6">
            <ToolLogo c={connectorById("cube")!} size="sm" className="mt-0.5" />
            <span>
              Metrics and dimensions are synced from {tool}, read today at 06:00, and read-only here. Terms are written here, by the owner of their domain.{" "}
              <a
                href="#/settings/integrations/cube"
                className="font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {tool} in Integrations
              </a>
              . A figure that looks wrong goes to {figures.contact("cube")}, the data contact.
            </span>
          </p>
          {/* Coverage first: how much of what agents can be asked has nothing written down. */}
          {uncovered.length > 0 && (
            <p className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 text-sm md:px-6">
              <CircleDashedIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="font-medium">
                  {uncovered.length} of {measurable.length} have no context yet.
                </span>{" "}
                <span className="text-muted-foreground">Agents asking about them get Not found.</span>
              </span>
              {!cues.includes("none") && (
                <Button variant="outline" size="sm" className="h-7" onClick={() => setCues(["none"])}>
                  Show only these
                </Button>
              )}
            </p>
          )}
          <div className="min-w-0 shrink-0">
            <table ref={table} className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr>
                  <th className={cn(thClass, "hidden w-[38px] min-w-[38px] pr-0 pl-4 md:w-[46px] md:min-w-[46px] md:pl-6 @xl/main:table-cell")}>
                    <Checkbox
                      aria-label="Select all definitions shown"
                      checked={sel.allShown}
                      indeterminate={sel.count > 0 && !sel.allShown}
                      onCheckedChange={sel.toggleAll}
                    />
                  </th>
                  <Th className="w-full pr-2 pl-4 md:pl-6 @xl/main:pl-1.5">Name</Th>
                  <Th className={cn("hidden w-32 px-2", group !== "domain" && "@min-[60rem]/main:table-cell")}>Domain</Th>
                  <Th className="hidden w-20 px-2 text-right @xl/main:table-cell">Context</Th>
                  <Th className="w-8 px-1">
                    <span className="sr-only">Needs a look</span>
                  </Th>
                  <Th className="w-8 px-1">
                    <span className="sr-only">Source</span>
                  </Th>
                  <Th className="w-10 pr-2 md:pr-4">
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody
                onKeyDown={(e) => {
                  sel.onKeyDown(e)
                  rowKeys(e)
                }}
              >
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={COLS} className="px-6 py-10 text-center text-sm">
                      <p className="font-medium">No definitions match</p>
                      <p className="mt-1 text-muted-foreground">
                        {[
                          text.trim() && `Searching for “${text.trim()}”`,
                          view !== "all" && `${typeLabel[view]}s only`,
                          cues.length && `Status is ${cues.map((c) => CUES[c]).join(" or ")}`,
                          domain.length && `Domain is ${domain.map((d) => domains[d].name).join(" or ")}`,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                        .
                      </p>
                      <Button variant="outline" size="sm" className="mt-3" onClick={clearAll}>
                        Clear search and filters
                      </Button>
                    </td>
                  </tr>
                )}
                {groups.map((g) => {
                  const open = !folded.includes(g.key)
                  return (
                    <React.Fragment key={g.key || "all"}>
                      {g.key && <GroupRow label={g.key} detail={mix(g.rows)} open={open} colSpan={COLS} onToggle={() => setFolded((x) => toggle(x, g.key))} />}
                      {open && g.rows.map(row)}
                    </React.Fragment>
                  )
                })}
                <AddRow label="New term" colSpan={COLS} onClick={() => navigate("/definitions/new")} />
              </tbody>
              {/* While rows are picked the bar's band holds the foot, so the totals stop sticking over the last rows. */}
              <tfoot className={cn("z-10 bg-background", !sel.count && "sticky bottom-0")}>
                <tr className="text-xs whitespace-nowrap text-muted-foreground tabular-nums shadow-[inset_0_1px_0_var(--border)]">
                  <td className="hidden @xl/main:table-cell" />
                  <td className="h-bar pr-2 pl-4 md:pl-6 @xl/main:pl-1.5">{mix(shown) || plural(0, "definition")}</td>
                  <td className={cn("hidden px-2", group !== "domain" && "@min-[60rem]/main:table-cell")} />
                  <td className="hidden px-2 text-right @xl/main:table-cell">{shown.reduce((n, d) => n + (d.sameAs ? 0 : about(d)), 0)}</td>
                  <td colSpan={3} className="px-1">
                    {shown.filter((d) => flagOf(d)).length} to look at
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Loadable>
      </div>
      {/* Picked rows get their bar in a band of its own under the list, never over a row. */}
      <DefinitionsBulk sel={sel} defs={all} deleting={deleting} setDeleting={setDeleting} />
    </div>
  )
}

/* ---------- the peek ---------- */

/** A definition in the dock, read-only: what it is, its names, and the context about it. Only a term has Edit. */

/**
 * A definition's other names on its row: the first three as small tags, then "+N"; a word with a
 * conflict in the warning tone. Found by one of them in a search, the row says so quietly.
 */
function AlsoCalledChips({ names, conflicts, matched }: { names: string[]; conflicts: string[]; matched?: string }) {
  if (!names.length && !matched) return null
  const first = names.slice(0, 3)
  return (
    <span className="flex min-w-0 items-center gap-1 @max-xl/main:hidden">
      {names.length > 0 && <span className="shrink-0 text-xs text-muted-foreground">Also called</span>}
      {first.map((n) => (
        <TagChip
          key={n}
          tone={conflicts.includes(n) ? "warn" : "term"}
          icon={conflicts.includes(n) ? <TriangleAlertIcon aria-hidden /> : <EqualIcon aria-hidden />}
          className="max-w-32"
          title={conflicts.includes(n) ? `“${n}” has a conflict` : n}
        >
          {n}
        </TagChip>
      ))}
      {names.length > first.length && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={names.slice(3).join(", ")}>
          +{names.length - first.length}
        </span>
      )}
      {matched && <span className="shrink-0 text-xs text-muted-foreground">matches: {matched}</span>}
    </span>
  )
}
