import * as React from "react"
import { GuideLink } from "@/components/heed/guide-link"
import { useEditor } from "@tiptap/react"
import {
  CircleCheckIcon,
  FlaskConicalIcon,
  ListChecksIcon,
  LockIcon,
  NotebookTextIcon,
  PanelRightIcon,
  Trash2Icon,
  UserIcon,
  UserPlusIcon,
  WholeWordIcon,
} from "lucide-react"
import { toast } from "sonner"
import { RichTextEditor } from "@/components/editor"
import { DocumentEditorShell } from "@/components/heed/document-shell"
import { DocFooter, Paper } from "@/components/heed/doc"
import { HeaderMore, SaveStatus } from "@/components/heed/editor-header"
import { PeopleField, PropertyGroup, PropertyList, PropertyRow, StaticField } from "@/components/heed/field-controls"
import { Panel } from "@/components/heed/panel"
import { DomainDot } from "@/components/heed/tag-chip"
import { ResizableAside } from "@/components/resizable-aside"
import { SiteHeader } from "@/components/site-header"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Kbd } from "@/components/ui/kbd"
import { domains, people, servedToAgents, type DomainId } from "@/data/world"
import { useWide } from "@/hooks/use-wide"
import { usePrimaryKey } from "@/hooks/use-primary-key"
import { useDefinitions } from "@/lib/definitions"
import { addDomain, domainText, removeDomain, updateDomain, useDomains } from "@/lib/domains"
import { docExtensions } from "@/lib/doc-extensions"
import { savedCounts, useSavedQuestions } from "@/data/saved-questions"
import { plainText } from "@/lib/mentions"
import { href, navigate } from "@/lib/router"
import { useSideChoice } from "@/lib/side-panel"
import { useFacts, useMe } from "@/lib/store"
import { InviteDialog } from "@/pages/people"

// A domain as its own document, the way a context item and About our business are written: the name
// as the large title, its owners and quiet counts as properties, then its text in the shared editor
// (what it covers, then its house rules). It saves itself. A new domain is created with one button.
// Only an empty domain can be deleted; the sandbox, which never reaches agents, can't be.

const GUIDE = "One or two sentences on what the domain covers, then its house rules: which calendar, currency or definitions to assume, and what not to mix up."

export function DomainPage({ id, crumbs }: { id: string; crumbs: (name: string) => React.ReactNode }) {
  useDomains()
  const me = useMe()
  const facts = useFacts()
  const defs = useDefinitions()
  const isNew = id === "new"
  const d = isNew ? undefined : domains[id as DomainId]
  const [name, setName] = React.useState(d?.name ?? "")
  const [owners, setOwners] = React.useState<string[]>(d?.owners ?? [me.name])
  const [text, setText] = React.useState(isNew ? "" : domainText(id as DomainId))
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [inviting, setInviting] = React.useState(false)
  const timer = React.useRef(0)
  const pending = React.useRef<{ name?: string; owners?: string[]; text?: string }>({})
  // Leaving the page saves what is still waiting, so a quick change is never lost.
  React.useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      if (Object.keys(pending.current).length && domains[id as DomainId]) updateDomain(id as DomainId, pending.current)
    },
    [id]
  )
  const [paneRef, wide] = useWide<HTMLDivElement>()
  const [helpChoice, setHelp] = useSideChoice("domain-side")
  const savedAll = useSavedQuestions()
  const helpOpen = helpChoice ?? false
  const ids = React.useId()
  const fieldId = (n: string) => `${ids}-${n}`
  usePrimaryKey()

  // An existing domain saves itself a moment after each change.
  const save = (patch: { name?: string; owners?: string[]; text?: string }) => {
    if (isNew) return
    // Changes made close together are saved together.
    pending.current = { ...pending.current, ...patch }
    setSaving(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      updateDomain(id as DomainId, pending.current)
      pending.current = {}
      setSaving(false)
    }, 600)
  }

  // Its owners and admins change a domain; everyone else reads it.
  const canEdit = isNew || me.admin || (d?.owners.includes(me.name) ?? false)
  const editor = useEditor({
    editable: canEdit,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    extensions: docExtensions("What this domain covers, in a sentence or two. Then its house rules: which calendar or currency to assume, and what not to mix up."),
    content: text,
    contentType: "markdown",
    editorProps: { attributes: { "aria-label": "What the domain covers and its house rules" } },
    onUpdate: ({ editor }) => {
      const md = editor.getMarkdown()
      setText(md)
      save({ text: md })
    },
  })

  if (!isNew && !d)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SiteHeader title={crumbs("Domain")} />
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No such domain</EmptyTitle>
            <EmptyDescription>It may have been deleted. The domains are under Settings, Domains and owners.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )

  const items = isNew ? [] : facts.filter((f) => f.domain === id && servedToAgents(f))
  const due = items.filter((f) => f.status === "Needs checking").length
  const saved = savedCounts(savedAll, id as DomainId)
  const terms = isNew ? 0 : defs.filter((x) => x.domain === id).length
  const sandbox = id === "sandbox"
  const empty = !items.length && !terms
  const words = plainText(text).split(/\s+/).filter(Boolean).length

  const create = () => {
    if (!name.trim()) return document.getElementById(fieldId("name"))?.focus()
    const newId = addDomain(name.trim(), owners, editor?.getMarkdown() ?? text)
    toast("Domain added", { description: `${name.trim()} is ready for context.` })
    navigate(`/settings/domains/${newId}`)
  }

  const help = (
    <div className="flex flex-col gap-3 p-4 md:px-5">
      <p className="text-sm text-muted-foreground">{GUIDE}</p>
      <GuideLink slug="domains-and-owners" />
    </div>
  )

  return (
    <DocumentEditorShell
      editor={editor}
      toolbar={canEdit}
      paneRef={paneRef}
      header={
        <SiteHeader title={crumbs(name || (isNew ? "New domain" : d!.name))} bare back={{ href: href("/settings/domains"), label: "Back to the domains" }}>
          {isNew ? (
            <Tooltip>
              <TooltipTrigger render={<Button size="sm" data-primary aria-disabled={!name.trim()} onClick={create} />}>Add the domain</TooltipTrigger>
              <TooltipContent>
                {name.trim() ? (
                  <>
                    Add the domain <Kbd className="ml-1">⌘</Kbd>
                    <Kbd>Enter</Kbd>
                  </>
                ) : (
                  "Name the domain first."
                )}
              </TooltipContent>
            </Tooltip>
          ) : canEdit ? (
            <SaveStatus saving={saving} />
          ) : (
            // Read only: say who changes it instead of a Saved that means nothing here.
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <LockIcon aria-hidden className="size-3.5" />
              <span className="max-sm:sr-only">Its owners and admins change it</span>
            </span>
          )}
          <HeaderMore>
            <DropdownMenuItem onClick={() => setHelp(!helpOpen)}>
              <PanelRightIcon />
              {helpOpen ? "Hide what to put here" : "Show what to put here"}
            </DropdownMenuItem>
            {!isNew && !sandbox && me.admin && (
              <DropdownMenuItem variant="destructive" disabled={!empty} onClick={() => setDeleting(true)}>
                <Trash2Icon />
                <span className="flex flex-col">
                  Delete the domain
                  {!empty && <span className="text-xs text-muted-foreground">Move its context and terms first</span>}
                </span>
              </DropdownMenuItem>
            )}
          </HeaderMore>
        </SiteHeader>
      }
      aside={
        helpOpen &&
        wide && (
          <ResizableAside side="right" storageKey="domain-side" defaultWidth={320} min={260} max={440} label="What to put here" className="border-l bg-background">
            <Panel title="What to put here" onClose={() => setHelp(false)} closeLabel="Hide what to put here">
              {help}
            </Panel>
          </ResizableAside>
        )
      }
      footer={
        <DocFooter>
          <span className="tabular-nums">
            {words.toLocaleString("en-GB")} {words === 1 ? "word" : "words"}
          </span>
          <span className="hidden sm:inline">Markdown</span>
        </DocFooter>
      }
    >
      <Paper>
        <div className="mb-4 flex items-start gap-3 sm:mb-5">
          {!isNew && <DomainDot id={id as DomainId} className="mt-3 size-3 sm:mt-3.5" />}
          <textarea
            id={fieldId("name")}
            aria-label="Name"
            rows={1}
            className="field-sizing-content w-full resize-none overflow-hidden bg-transparent text-2xl leading-tight font-bold tracking-tight outline-none placeholder:text-muted-foreground/60 sm:text-3xl"
            placeholder="Name the domain"
            readOnly={!canEdit}
            value={name}
            onChange={(e) => {
              const v = e.target.value.replace(/\n/g, " ")
              setName(v)
              if (v.trim()) save({ name: v.trim() })
            }}
          />
        </div>
        {sandbox && <p className="-mt-2 mb-5 text-sm text-muted-foreground">The sandbox never reaches agents. Use it to try context before it goes anywhere.</p>}
        <PropertyList label="Properties">
          <PropertyGroup>
            <PropertyRow id={fieldId("owners")} label="Owners" icon={<UserIcon />}>
              <PeopleField
                labelId={fieldId("owners")}
                label="Owners"
                values={owners}
                people={people}
                me={me.name}
                lockedReason={canEdit ? undefined : "Only its owners and admins add owners"}
                onChange={(v) => {
                  // A domain always keeps one owner.
                  if (!v.length && !isNew) return toast("A domain needs an owner", { description: "Add another owner first, then take this one off." })
                  setOwners(v)
                  save({ owners: v })
                }}
                note="An owner publishes and checks the context in this domain."
                footer={
                  isNew
                    ? undefined
                    : (close) => (
                        <button
                          type="button"
                          onClick={() => {
                            close()
                            setInviting(true)
                          }}
                          className="flex min-h-9 w-full items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-muted focus-visible:bg-muted"
                        >
                          <UserPlusIcon aria-hidden className="size-4 text-muted-foreground" />
                          Invite someone as an owner
                        </button>
                      )
                }
              />
            </PropertyRow>
            {!isNew && (
              <>
                <PropertyRow id={fieldId("context")} label="Context" icon={<NotebookTextIcon />}>
                  <StaticField>
                    <a href={href("/context", { domain: id })} className="text-foreground underline-offset-4 hover:underline">
                      {items.length} {items.length === 1 ? "item" : "items"}
                    </a>
                    {due > 0 && (
                      <>
                        <span aria-hidden>-</span>
                        <a href={href("/context", { domain: id, due: "1" })} className="underline-offset-4 hover:underline">
                          {due} due for a check
                        </a>
                      </>
                    )}
                  </StaticField>
                </PropertyRow>
                {/* The health line: the saved questions about this domain, from the one list; Quality has the rest. */}
                <PropertyRow id={fieldId("saved")} label="Saved questions" icon={<ListChecksIcon />}>
                  <StaticField>
                    {saved.total ? (
                      <a href={href("/observability/quality", { domain: id })} className="text-foreground underline-offset-4 hover:underline">
                        {saved.total} saved {saved.total === 1 ? "question" : "questions"} - {saved.same} same - {saved.changed} changed - {saved.look}{" "}
                        {saved.look === 1 ? "needs" : "need"} a look
                      </a>
                    ) : (
                      <span className="text-muted-foreground">None yet. Save one from an answer in Ask.</span>
                    )}
                  </StaticField>
                </PropertyRow>
                <PropertyRow id={fieldId("terms")} label="Definitions" icon={<WholeWordIcon />}>
                  <StaticField>
                    <a href={href("/definitions", { domain: id })} className="text-foreground underline-offset-4 hover:underline">
                      {terms} {terms === 1 ? "definition" : "definitions"}
                    </a>
                  </StaticField>
                </PropertyRow>
              </>
            )}
            {sandbox && (
              <PropertyRow id={fieldId("reach")} label="Reaches agents" icon={<FlaskConicalIcon />}>
                <StaticField>Never</StaticField>
              </PropertyRow>
            )}
            {!isNew && !sandbox && (
              <PropertyRow id={fieldId("reach")} label="Reaches agents" icon={<CircleCheckIcon />}>
                <StaticField>Yes, with every answer about this domain</StaticField>
              </PropertyRow>
            )}
          </PropertyGroup>
        </PropertyList>
        <RichTextEditor.Content className="text-base [&_.ProseMirror]:min-h-48! [&_.ProseMirror]:max-w-reading [&_.ProseMirror]:p-0!" />
      </Paper>
      {helpOpen && !wide && <div className="border-t bg-background">{help}</div>}
      {!isNew && <InviteDialog key={String(inviting)} open={inviting} onOpenChange={setInviting} preset={id as DomainId} />}
      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {d?.name}?</DialogTitle>
            <DialogDescription>It has no context and no definitions, so nothing else changes. Its owners keep their other domains.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                const was = d!.name
                removeDomain(id as DomainId)
                setDeleting(false)
                toast("Domain deleted", { description: was })
                navigate("/settings/domains")
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DocumentEditorShell>
  )
}
