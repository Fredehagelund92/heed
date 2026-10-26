import * as React from "react"
import { useEditor } from "@tiptap/react"
import {
  ArchiveIcon,
  CalendarIcon,
  CircleCheckIcon,
  CircleDotIcon,
  CircleDashedIcon,
  FilePenLineIcon,
  CircleAlertIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
  PanelRightIcon,
  FolderIcon,
  GlobeIcon,
  LinkIcon,
  MapPinIcon,
  ShapesIcon,
  ShieldAlertIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UserIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { RichTextEditor } from "@/components/editor"
import { ContextText } from "@/components/heed/mention-chip"
import { useSideChoice } from "@/lib/side-panel"
import { useSend } from "@/lib/scenario"
import "@/components/editor/style.css"
import { docExtensions } from "@/lib/doc-extensions"
import { noteEmoji } from "@/lib/emoji-note"
import { type Validity } from "@/data/contract"
import { missingDates, validOfWhen, whenOfValid, whenSummary, type WhenMode, type WhenValue } from "@/lib/when"
import {
  ChipsField,
  Ghost,
  InlineText,
  PeopleField,
  PickerField,
  PropertyGroup,
  PropertyList,
  PropertyRow,
  SelectField,
  StaticField,
  WhenField,
  type Option,
} from "@/components/heed/field-controls"
import { DomainDot, TagChip } from "@/components/heed/tag-chip"
import { kindIcons } from "@/components/heed/kind-icons"
import { plainText } from "@/lib/mentions"
import { PersonAvatar } from "@/components/heed/bits"
import { DocFooter, Paper } from "@/components/heed/doc"
import { ResizableAside } from "@/components/resizable-aside"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cards } from "@/data/inbox"
import {
  domainIds,
  domains,
  kindHint,
  kindLabel,
  markets,
  metrics,
  ownersOf,
  people,
  servedToAgents,
  type DomainId,
  type Fact,
  type Kind,
  type Status,
} from "@/data/world"
import { closeDock, openDock, useDock } from "@/lib/dock"
import { HeaderMore, SaveStatus } from "@/components/heed/editor-header"
import { Panel, PanelGroup } from "@/components/heed/panel"
import { ChoiceGroup, ViewToggle } from "@/components/heed/switches"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { setDraft } from "@/lib/draft"
import { href, navigate, useRoute } from "@/lib/router"
import { useFact, useFacts, useMe, useStore } from "@/lib/store"
import { useWide } from "@/hooks/use-wide"
import { Kbd } from "@/components/ui/kbd"
import { usePrimaryKey } from "@/hooks/use-primary-key"
import { DocumentEditorShell } from "@/components/heed/document-shell"

// The context editor as a document, the way editorcn's Simple Document Editor template shows one: a
// muted canvas, editorcn's floating toolbar, the title as a large heading, the text as the document,
// and a word count in the footer. The item's fields are a property strip under the title; what
// agents get, the overlaps and the Ready line sit in a side panel. Publish and Save are in the
// header, as in a docs editor. One page for new context, an edit and a suggestion.

type Form = {
  title: string
  body: string
  kind: Kind
  domain: DomainId
  owners: string[]
  status: Status
  where: string[]
  when: WhenMode
  from: string
  until: string
  source: string
  quote: string
  causes: boolean
  dontConclude: string
}

const NORWAY: Form = {
  title: "Online sales to Norway stopped on 4 August 2026",
  body: 'A new customs rule stopped all online sales to Norway from 4 August 2026, so orders there fell to almost nothing.\n\nThere are no stores in Norway, so the [@ id="term:Webshop" label="Webshop"] was the only way to buy there.\n\n- Parcels already on their way still arrived.\n- Compare [@ id="metric:Orders" label="Orders"] in Norway with itself before or after the stop, never across it.\n\n> Paid campaigns there had stopped before this: [@ id="context:itm_za26xpzv" label="Regulator paused price promotions in Norway on 9 May 2026"].\n\nNot the same as the earlier change in Norway payments: [@ id="context:itm_kh4llvi9" label="Payment provider switched in Norway on 9 July 2025"].',
  kind: "event",
  domain: "sales",
  owners: domains.sales.owners,
  status: "Live",
  where: ["Orders", "Norway"],
  when: "ongoing",
  from: "2026-08-04",
  until: "",
  source: "https://customs.example/norway/notices/2026-08-04",
  quote: "Parcels from webshops outside Norway are held at the border from 4 August 2026 until further notice.",
  causes: false,
  dontConclude: "Fewer orders in Norway after 4 August do not mean fewer customers.",
}

const BLANK: Form = { ...NORWAY, title: "", body: "", where: [], when: "always", from: "", until: "", source: "", quote: "", dontConclude: "" }

function fromFact(f: Fact): Form {
  // From the stored dates, so the editor shows the real ones.
  const w = whenOfValid(f.valid)
  return {
    title: f.title,
    body: [f.summary, f.body].filter(Boolean).join("\n\n"),
    kind: f.kind,
    domain: f.domain,
    owners: ownersOf(f),
    // A draft is published as Live.
    status: f.status === "Draft" ? "Live" : f.status,
    where: f.where,
    when: w.mode,
    from: w.from,
    until: w.until,
    source: f.source,
    quote: f.quote,
    causes: !!f.causes,
    dontConclude: f.dontConclude,
  }
}

const whenOf = (f: Form): WhenValue => ({ mode: f.when, from: f.from, until: f.until })

/** The stored dates the form says. */
const validOf = (f: Form): Validity => validOfWhen(whenOf(f))

/** The When people read, from the same function as everywhere else once the dates are there. */
const whenText = (f: Form) => whenSummary(whenOf(f))

function toFact(f: Form, id: string, me: string, original?: Fact): Fact {
  const [summary, ...rest] = f.body.split("\n\n")
  return {
    valid: validOf(f),
    id,
    title: f.title || "Untitled context item",
    summary: summary ?? "",
    body: rest.join("\n\n") || undefined,
    domain: f.domain,
    // Owners of its own only when they differ from its domain's.
    owners: f.owners.join() === domains[f.domain].owners.join() ? undefined : f.owners,
    kind: f.kind,
    where: f.where,
    // Until its dates are picked, an edited item keeps saying what it said.
    when: original && missingDates(whenOf(f)) ? original.when : whenText(f),
    status: f.status,
    checkedBy: me,
    checkedOn: "22 Oct 2026",
    source: f.source,
    quote: f.quote,
    dontConclude: f.dontConclude || "Cause not proven.",
    causes: f.causes,
  }
}

function initialForm(mode: string, fact: Fact | undefined, query: URLSearchParams, home: DomainId): Form {
  if (fact) return fromFact(fact)
  if (query.get("draft") === "norway") return NORWAY
  // New context starts in the writer's own domain, so an owner publishes rather than suggests.
  const blank = { ...BLANK, domain: home, owners: domains[home].owners }
  // A Not found card opens its draft, never a blank page, with the draft's own dates.
  const gap = cards.find((c) => c.id === query.get("gap"))?.gap
  if (gap?.draft)
    return { ...fromFact(gap.draft), domain: gap.draft.domain, owners: domains[gap.draft.domain].owners, when: "between", from: "2026-10-14", until: "2026-10-16" }
  const metric = query.get("metric")
  const market = query.get("market")
  if (metric || market) return { ...blank, where: [metric, market].filter(Boolean) as string[] }
  return mode === "new" ? blank : NORWAY
}

/** "customs.example": a link's host, the way a link chip names it. */
const hostOf = (url: string) => {
  try {
    return new URL(url).host.replace(/^www\./, "")
  } catch {
    return url.replace(/^https?:\/\//, "")
  }
}

const countWords = (text: string) =>
  text
    .replace(/[#*_`>[\]()-]/g, " ")
    .split(/\s+/)
    .filter(Boolean).length

/* ---------- the property list ---------- */

const STATUS_OPTIONS: Option<Status>[] = [
  { value: "Live", label: "Live", hint: "Agents get it." },
  { value: "Needs checking", label: "Needs checking", hint: "Agents get it, told it may be out of date." },
  { value: "Archived", label: "Archived", hint: "Agents stop getting it." },
]
const KIND_OPTIONS = (Object.keys(kindLabel) as Kind[]).map((k) => {
  const Icon = kindIcons[k]
  return { value: k, label: kindLabel[k], hint: kindHint[k], icon: <Icon aria-hidden className="size-4 text-muted-foreground" /> }
})
// Read each time, so a domain added or renamed in Settings is here with its own words.
const domainOptions = () => domainIds.map((d) => ({ value: d, label: domains[d].name, hint: domains[d].covers, icon: <DomainDot id={d} /> }))
const whereGroups = () => [
  { heading: "Domains", items: domainIds.filter((d) => d !== "sandbox").map((d) => domains[d].name) },
  { heading: "Metrics", items: metrics.map((m) => m.name) },
  { heading: "Markets", items: markets },
]

/* ---------- the page ---------- */

export function FactEditor({ mode, factId }: { mode: "new" | "edit" | "suggest"; factId?: string }) {
  const original = useFact(factId)
  const facts = useFacts()
  const me = useMe()
  const { dispatch } = useStore()
  const { query } = useRoute()
  // What the page opened with, so an edit or a suggestion that changes nothing can't be sent.
  const [initial] = React.useState<Form>(() => initialForm(mode, original, query, me.owns[0] ?? "sales"))
  const [form, setForm] = React.useState<Form>(initial)
  const [sourceOpen, setSourceOpen] = React.useState(false)
  const [mainRef, wide] = useWide<HTMLDivElement>()
  usePrimaryKey()
  const titleRef = React.useRef<HTMLTextAreaElement>(null)
  const [overlap, setOverlap] = React.useState<Record<string, string>>({})
  const [pasted, setPasted] = React.useState("")
  const [draftOpen, setDraftOpen] = React.useState(false)
  const [previewAll, setPreviewAll] = React.useState(false)
  // Drafts save themselves: a quiet status instead of a Save button.
  const [saving, setSaving] = React.useState(false)
  const saveTimer = React.useRef<number>(0)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setSaving(true)
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => setSaving(false), 700)
  }
  React.useEffect(() => () => window.clearTimeout(saveTimer.current), [])

  const editor = useEditor({
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: docExtensions("Two or three plain sentences. The first one is what agents read first."),
    content: form.body,
    contentType: "markdown",
    editorProps: { attributes: { "aria-label": "What agents should know" } },
    onUpdate: ({ editor }) => set("body", editor.getMarkdown()),
  })

  const trying = useDock()?.kind === "try"
  const { state: sendState, send, online } = useSend()
  const owner = me.owns.includes(form.domain) || me.admin
  const isSuggest = mode === "suggest" || !owner
  const ownerName = form.owners[0] ?? domains[form.domain].owners[0]
  const ids = React.useId()
  const KindIcon = kindIcons[form.kind]
  const fieldId = (name: string) => `${ids}-${name}`
  const draft = toFact(form, original?.id ?? "draft", me.name, original)
  React.useEffect(() => setDraft(draft))

  const overlaps = facts.filter(
    (f) => f.id !== original?.id && f.title !== form.title && servedToAgents(f) && form.where.length >= 2 && form.where.every((w) => f.where.includes(w))
  )
  // Folded unless there is something to say (an overlap), until the person chooses.
  // The panel's open or closed, as the person last left it this session; until then, open only with an overlap.
  const [sideChoice, setSideChoice] = useSideChoice()
  const sideOpen = sideChoice ?? overlaps.length > 0
  const missing = [!form.title && "a title", !form.body.trim() && "what agents should know", !form.source && "a source"].filter(Boolean) as string[]
  const reaches = form.where.length ? (form.where.includes("Norway") ? 12 : 9) : 0
  // Counted as agents read it: a mention is its words.
  const text = plainText(form.body)
  const words = countWords(`${form.title} ${text}`)
  // Long enough to clamp: about six lines of the preview's width.
  const long = text.split("\n").filter(Boolean).length + Math.floor(text.length / 45) > 6

  const fill = () => {
    setForm(NORWAY)
    editor?.commands.setContent(NORWAY.body, { contentType: "markdown" })
    setDraftOpen(false)
    toast("Filled from your text", { description: "Check each part before you publish." })
  }

  const unchanged = mode !== "new" && JSON.stringify(form) === JSON.stringify(initial)
  // The first paragraph is the summary agents read first; the real schema keeps it to 280 characters.
  const summaryLength = plainText(form.body.split("\n\n")[0] ?? "").length
  const tooLong = summaryLength > 280
  const blocked = missing.length
    ? `Add ${missing.join(", ")} first.`
    : tooLong
      ? "Shorten the first paragraph to 280 characters first."
      : unchanged
        ? "Nothing has changed yet."
        : ""
  // A blocked click goes to the first thing missing instead of answering with a toast.
  const goToMissing = () => {
    if (!form.title) titleRef.current?.focus()
    else if (!form.body.trim()) editor?.commands.focus("end")
    else if (!form.source) setSourceOpen(true)
  }

  const commit = () => {
    if (isSuggest) {
      // It waits visibly: a line on the item, and a row under All in your Inbox.
      const id = `sent_${Date.now().toString(36)}`
      dispatch({ type: "send", sent: { id, factId: original?.id, title: form.title, by: me.name, to: ownerName, domain: form.domain, at: "just now" } })
      toast(`Sent to ${ownerName}, owner of ${domains[form.domain].name}`, { description: "Agents get it once the owner publishes it." })
      navigate(original ? `/context/${original.id}` : "/inbox", original ? undefined : { tab: "all", card: id })
      return
    }
    const id = original?.id ?? `itm_new_${Date.now().toString(36)}`
    if (original) dispatch({ type: "editFact", id, patch: draft })
    else dispatch({ type: "addFact", fact: { ...draft, id } })
    dispatch({ type: "published", id })
    const gap = query.get("gap")
    if (gap) dispatch({ type: "complete", card: gap, outcome: "Context written" })
    if (query.get("setup")) {
      dispatch({ type: "setupStep", step: "fact" })
      toast("Published", { description: "Your first context item. Agents get it from the next question." })
      navigate("/inbox")
      return
    }
    toast(original ? "Saved" : "Published", { description: "Agents get it from the next question." })
    navigate(`/context/${id}`)
  }
  // Sending, then done; or failed with Retry, the text untouched. Offline, nothing is sent.
  const verb = isSuggest ? "Send" : original ? "Save" : "Publish"
  const submit = () => {
    if (blocked) return goToMissing()
    send(commit)
  }
  const held = blocked || (!online ? `You're offline. ${verb} once you're back; your text stays here.` : "")

  const heading = form.title || (mode === "new" ? "New context" : mode === "edit" ? "Edit" : "Suggest a change")

  // Draft from text: a short dialog, opened from the More menu.
  const draftFromText = (
    <Dialog open={draftOpen} onOpenChange={setDraftOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Draft from text</DialogTitle>
          <DialogDescription>Paste a message or a link; the fields fill in, and you check each one.</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="draft-text">Message or link</FieldLabel>
          <Textarea
            id="draft-text"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            className="min-h-28"
            placeholder="Online sales to Norway stopped on 4 August 2026 after a new customs rule, so orders there fell. https://customs.example/norway/notices/2026-08-04"
          />
        </Field>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={fill}>Fill it in</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // The panel: the preview and the overlaps as groups that fold (the preview starts folded when
  // there are overlaps, so the choices are in view), and the Ready line as its footer.
  const side = (
    <>
      <PanelGroup
        title="Preview"
        defaultOpen={!overlaps.length}
        description={
          form.where.length
            ? `Agents asking about ${form.where.join(" in ")}${form.when === "always" ? "" : `, ${whenText(form).replace(/^From/, "from")}`} get this, live as you type.`
            : "Add where it applies to see who gets it."
        }
      >
        <div className="rounded-frame border bg-muted/30 p-3 text-sm">
          <p className="leading-snug font-medium">{draft.title}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {domains[form.domain].name}, {kindLabel[form.kind].toLowerCase()}, {draft.when.charAt(0).toLowerCase() + draft.when.slice(1)}
          </p>
          <p className="text-xs text-muted-foreground">{isSuggest ? "Not checked yet: waiting for the owner" : `Checked by the owner of ${domains[form.domain].name}`}</p>
          {/* The text as the document reads it: paragraphs, real bullets, a quote. Clamped when long,
              never boxed, so the panel keeps one scroll bar at most. */}
          <div
            className={cn(
              "mt-2.5 flex flex-col gap-2 leading-relaxed text-foreground/85",
              long && !previewAll && "max-h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
            )}
          >
            {form.body.trim() ? <ContextText text={form.body.replace(/\*\*|`/g, "")} dense /> : <p className="text-muted-foreground">…</p>}
          </div>
          {long && (
            <Button variant="link" size="sm" className="h-auto px-0 text-xs" aria-expanded={previewAll} onClick={() => setPreviewAll((v) => !v)}>
              {previewAll ? "Show less" : "Show all"}
            </Button>
          )}
          <p className="mt-2.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <LinkIcon aria-hidden className="size-3 shrink-0" />
            <span className="truncate">{form.source.replace(/^https?:\/\//, "") || "No source yet"}</span>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="text-foreground">Don't conclude:</span> {draft.dontConclude}
            {form.causes ? "" : " The source doesn't say this caused a change."}
          </p>
        </div>
        {reaches > 0 && <p className="mt-3 text-sm text-muted-foreground">{reaches} questions agents asked this week would get it.</p>}
      </PanelGroup>
      <PanelGroup
        title="Overlaps"
        count={overlaps.length}
        description={overlaps.length ? "Context on the same metric and market. Say how this one relates to each." : "None. Nothing else covers the same place."}
      >
        {overlaps.length > 0 && (
          <div className="flex flex-col gap-4">
            {overlaps.map((f) => (
              <div key={f.id} className="flex flex-col gap-2">
                <button type="button" className="text-left text-sm font-medium underline-offset-4 hover:underline" onClick={() => openDock("context", f.id)}>
                  {f.title}
                </button>
                <ChoiceGroup
                  label={`How this relates to ${f.title}`}
                  value={overlap[f.id] ?? "unrelated"}
                  onChange={(v) => setOverlap((o) => ({ ...o, [f.id]: v }))}
                  options={[
                    { value: "replaces", label: "Replaces it" },
                    { value: "disagree", label: "Disagrees" },
                    { value: "unrelated", label: "Unrelated" },
                  ]}
                />
              </div>
            ))}
          </div>
        )}
      </PanelGroup>
    </>
  )
  const ready = (
    <p className="flex items-start gap-2 p-4 text-sm">
      {missing.length ? (
        <CircleDashedIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <CircleCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      )}
      <span>
        <span className="font-medium">{missing.length ? "Not ready yet." : "Ready."}</span>{" "}
        <span className="text-muted-foreground">{missing.length ? `Add ${missing.join(", ")}.` : "Complete, and it reaches the questions it is meant for."}</span>
      </span>
    </p>
  )

  return (
    <DocumentEditorShell
      editor={editor}
      toolbar={true}
      paneRef={mainRef}
      header={
        <>
          <SiteHeader
            title={heading}
            icon={<FilePenLineIcon />}
            back={original ? { href: href(`/context/${original.id}`), label: "Back to the context item" } : { href: href("/context"), label: "Back to Context" }}
            bare
          >
            <SaveStatus saving={saving} offline={!online} />
            {/* Write or try it: the same draft, seen two ways, so a quiet toggle rather than tabs. */}
            <ViewToggle
              pressed={trying}
              onPressedChange={(p) => (p ? openDock("try", "editor") : closeDock())}
              icon={<FlaskConicalIcon />}
              on="Try it"
              off="Back to writing"
            />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    data-primary
                    aria-disabled={!!held}
                    loading={sendState === "sending"}
                    loadingLabel={verb === "Send" ? "Sending…" : verb === "Save" ? "Saving…" : "Publishing…"}
                    aria-describedby={held ? "publish-blocked" : undefined}

                    onClick={submit}
                  />
                }
              >
                {isSuggest ? (
                  <>
                    Send<span className="hidden sm:inline"> to the owner of {domains[form.domain].name}</span>
                  </>
                ) : (
                  verb
                )}
              </TooltipTrigger>
              <TooltipContent>
                {held || (
                  <>
                    {isSuggest ? "Send" : original ? "Save" : "Publish"} <Kbd className="ml-1">⌘</Kbd>
                    <Kbd>Enter</Kbd>
                  </>
                )}
              </TooltipContent>
            </Tooltip>
            <span id="publish-blocked" className="sr-only">
              {held}
            </span>
            <HeaderMore>
              {mode === "new" && (
                <DropdownMenuItem onClick={() => setDraftOpen(true)}>
                  <SparklesIcon />
                  Draft from text
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setSideChoice(!sideOpen)}>
                <PanelRightIcon />
                {sideOpen ? "Hide what agents get" : "Show what agents get"}
              </DropdownMenuItem>
            </HeaderMore>
          </SiteHeader>
          {draftFromText}
        </>
      }
      aside={
        <>
          {/* The side pane opens by itself only when this overlaps another item: then what agents get, and how the two relate, matter. Otherwise the header's toggle opens it. */}
          {sideOpen && wide && (
            <ResizableAside side="right" storageKey="doc-side" defaultWidth={320} min={280} max={520} label="What agents get" className="border-l bg-background">
              <Panel title="What agents get" onClose={() => setSideChoice(false)} closeLabel="Hide what agents get" footer={ready}>
                {side}
              </Panel>
            </ResizableAside>
          )}
        </>
      }
      footer={
        <DocFooter
          status={
            sendState === "failed" ? (
              <span role="alert" className="flex items-center gap-2 text-destructive">
                <CircleAlertIcon className="size-3.5 shrink-0" aria-hidden />
                <span>
                  Couldn't {verb.toLowerCase()}
                  <span className="max-sm:hidden">. Your text is kept</span>.
                </span>
                <Button variant="outline" size="sm" className="h-7 text-foreground" onClick={() => send(commit)}>
                  <RefreshCwIcon data-icon="inline-start" />
                  Retry
                </Button>
              </span>
            ) : missing.length ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                <span>
                  Not ready<span className="hidden sm:inline">: add {missing.join(", ")}</span>
                </span>
              </>
            ) : unchanged ? (
              <>
                <CircleDashedIcon className="size-3.5" aria-hidden />
                No changes yet
              </>
            ) : (
              <>
                <CircleCheckIcon className="size-3.5" aria-hidden />
                Ready
              </>
            )
          }
        >
          <span className={cn("whitespace-nowrap tabular-nums", tooLong && "font-medium text-destructive")} title="The first paragraph is what agents read first">
            Summary {summaryLength} of 280
          </span>
          <span className="whitespace-nowrap">
            {words.toLocaleString("en-GB")} {words === 1 ? "word" : "words"}
          </span>
          <span className="whitespace-nowrap max-sm:hidden">{(form.title.length + text.length).toLocaleString("en-GB")} characters</span>
          <span className="hidden sm:inline">Markdown</span>
        </DocFooter>
      }
    >
      <Paper>
        {mode === "suggest" && original && (
          <p className="mb-5 rounded-frame bg-muted px-3 py-2 text-sm text-muted-foreground">
            You're suggesting a change. {ownerName}, owner of {domains[original.domain].name}, decides; agents keep getting the context item as it is until then.
          </p>
        )}
        <textarea
          ref={titleRef}
          aria-label="Title"
          rows={1}
          className="mb-4 field-sizing-content w-full resize-none overflow-hidden bg-transparent text-2xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 sm:mb-5 sm:text-3xl"
          placeholder="What should agents know?"
          value={form.title}
          onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
          onPaste={(e) => noteEmoji(e.clipboardData.getData("text/plain"))}
        />
        {/* The properties as a calm list under the title: what it is, when and where it applies,
            where it comes from. Each value shows as the thing it is; a click edits it. */}
        <PropertyList label="Properties">
          <PropertyGroup>
            <PropertyRow id={fieldId("domain")} label="Domain" icon={<FolderIcon />}>
              <SelectField
                labelId={fieldId("domain")}
                label="Domain"
                value={form.domain}
                options={domainOptions()}
                onChange={(d) => {
                  set("domain", d)
                  set("owners", domains[d].owners)
                }}
                display={
                  <>
                    <DomainDot id={form.domain} />
                    <span className="font-medium">{domains[form.domain].name}</span>
                  </>
                }
              />
            </PropertyRow>
            <PropertyRow id={fieldId("kind")} label="Kind" icon={<ShapesIcon />}>
              <SelectField
                labelId={fieldId("kind")}
                label="Kind"
                value={form.kind}
                options={KIND_OPTIONS}
                onChange={(k) => set("kind", k)}
                display={<TagChip icon={<KindIcon aria-hidden />}>{kindLabel[form.kind]}</TagChip>}
              />
            </PropertyRow>
            <PropertyRow id={fieldId("status")} label="Status" icon={<CircleDotIcon />}>
              <SelectField
                labelId={fieldId("status")}
                label="Status"
                value={form.status}
                options={STATUS_OPTIONS}
                onChange={(v) => set("status", v)}
                disabled={isSuggest}
                display={
                  // Live is the default and says nothing; a status that needs attention is a chip.
                  form.status === "Live" ? (
                    <span>Live</span>
                  ) : form.status === "Needs checking" ? (
                    <TagChip tone="warn" icon={<TriangleAlertIcon aria-hidden />}>
                      Needs checking
                    </TagChip>
                  ) : (
                    <TagChip icon={<ArchiveIcon aria-hidden />}>Archived</TagChip>
                  )
                }
              />
            </PropertyRow>
            <PropertyRow id={fieldId("owner")} label="Owner" icon={<UserIcon />}>
              <PeopleField
                labelId={fieldId("owner")}
                label="Owner"
                values={form.owners}
                people={people}
                me={me.name}
                onChange={(v) => set("owners", v)}
                note={isSuggest ? "The owner decides on your suggestion." : "An owner publishes and checks this domain's context."}
              />
            </PropertyRow>
          </PropertyGroup>
          <PropertyGroup>
            <PropertyRow id={fieldId("where")} label="Applies to" icon={<MapPinIcon />}>
              <ChipsField
                labelId={fieldId("where")}
                label="Applies to"
                values={form.where}
                groups={whereGroups()}
                onChange={(w) => set("where", w)}
                placeholder="Add a metric, market or domain"
                searchPlaceholder="Search metrics, markets and domains"
              />
            </PropertyRow>
            <PropertyRow id={fieldId("when")} label="When" icon={<CalendarIcon />}>
              <WhenField labelId={fieldId("when")} value={whenOf(form)} onChange={(w) => setForm((f) => ({ ...f, when: w.mode, from: w.from, until: w.until }))} />
            </PropertyRow>
          </PropertyGroup>
          <PropertyGroup>
            <PropertyRow id={fieldId("source")} label="Source" icon={<LinkIcon />} required={!form.source}>
              <PickerField
                labelId={fieldId("source")}
                label="Source"
                open={sourceOpen}
                onOpenChange={setSourceOpen}
                className="w-96 p-3"
                value={
                  form.source ? (
                    <TagChip icon={<GlobeIcon aria-hidden />} title={form.source}>
                      {hostOf(form.source)}
                    </TagChip>
                  ) : (
                    <Ghost>Add a source</Ghost>
                  )
                }
              >
                <div className="grid gap-3 pb-1">
                  <Field>
                    <FieldLabel htmlFor="fact-source">Link</FieldLabel>
                    <Input id="fact-source" type="url" value={form.source} onChange={(e) => set("source", e.target.value)} placeholder="https://" className="h-9" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="fact-quote">A sentence copied from it</FieldLabel>
                    <Textarea id="fact-quote" value={form.quote} onChange={(e) => set("quote", e.target.value)} className="min-h-16" />
                  </Field>
                  <Field orientation="horizontal">
                    <Checkbox id="fact-causes" checked={form.causes} onCheckedChange={(v) => set("causes", !!v)} />
                    <FieldLabel htmlFor="fact-causes" className="font-normal">
                      The source says this caused the change
                    </FieldLabel>
                  </Field>
                </div>
              </PickerField>
            </PropertyRow>
            <PropertyRow id={fieldId("dont")} label="Don't conclude" icon={<ShieldAlertIcon />}>
              <InlineText
                labelId={fieldId("dont")}
                value={form.dontConclude}
                onChange={(v) => set("dontConclude", v)}
                placeholder="Anything an agent should not conclude from this?"
              />
            </PropertyRow>
            {original && (
              <PropertyRow id={fieldId("checked")} label="Checked" icon={<CircleCheckIcon />}>
                <StaticField>
                  <PersonAvatar name={original.checkedBy} size={20} />
                  <span>
                    {original.checkedBy}, {original.checkedOn}
                  </span>
                </StaticField>
              </PropertyRow>
            )}
          </PropertyGroup>
        </PropertyList>
        <RichTextEditor.Content className="text-base [&_.ProseMirror]:min-h-48! [&_.ProseMirror]:max-w-reading [&_.ProseMirror]:p-0!" />
      </Paper>
      {sideOpen && !wide && (
        <section aria-labelledby="doc-side-under" className="border-t bg-background">
          {/* Under the document the panel keeps its title, so its groups sit under a heading of their own. */}
          <h2 id="doc-side-under" className="px-4 pt-4 pb-1 text-sm font-medium">
            What agents get
          </h2>
          {side}
          <div className="border-t">{ready}</div>
        </section>
      )}
    </DocumentEditorShell>
  )
}
