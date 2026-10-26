import * as React from "react"
import { BookAIcon, CalendarIcon, CircleHelpIcon, MapIcon, StickyNoteIcon, TriangleAlertIcon, InboxIcon, MessageSquareIcon, MoonIcon, NotebookTextIcon, PlusIcon, PlugIcon, SettingsIcon, SunIcon } from "lucide-react"
import { openDock } from "@/lib/dock"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandFooter,
  CommandShortcut,
} from "@/components/ui/command"
import { Kbd } from "@/components/ui/kbd"
import { domains, type Kind } from "@/data/world"
import { examples } from "@/data/ask"
import { onOpen, open as openOverlay } from "@/lib/events"
import { navigate } from "@/lib/router"
import { kindName, useDefinitions } from "@/lib/definitions"
import { useFacts, useMe } from "@/lib/store"
import { TypeGlyph } from "@/components/heed/definition"
import { useTheme } from "@/lib/theme-context"
import { DEFINITIONS_TOOL } from "@/data/integrations"

/** A context item's kind as a glyph, labelled for screen readers by the words beside it. */
function KindGlyph({ kind }: { kind: Kind }) {
  const Icon = { event: CalendarIcon, issue: TriangleAlertIcon, note: StickyNoteIcon, guide: MapIcon }[kind]
  return <Icon className="text-muted-foreground" aria-hidden />
}

// Search: shadcn's Command in a dialog, opened with Cmd K or the sidebar's Search. Sized as the
// Heed app's search: 640 wide in the upper part of the screen, a 48px input row, 40px result rows
// with a type glyph, quiet group headers, and a row of key hints.
export function CommandPalette() {
  const [open, setOpen] = React.useState(false)
  const facts = useFacts()
  const definitions = useDefinitions()
  const me = useMe()
  const { theme, setTheme } = useTheme()

  React.useEffect(() => onOpen("palette", () => setOpen(true)), [])
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Search context and go anywhere">
      <Command>
        <CommandInput placeholder="Search context, or type a place…" />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={run(() => navigate("/inbox"))}>
              <InboxIcon />
              Inbox
            </CommandItem>
            <CommandItem onSelect={run(() => navigate("/ask"))}>
              <MessageSquareIcon />
              Ask
            </CommandItem>
            <CommandItem onSelect={run(() => navigate("/context"))}>
              <NotebookTextIcon />
              Context
            </CommandItem>
            <CommandItem onSelect={run(() => navigate("/definitions"))}>
              <BookAIcon />
              Definitions
            </CommandItem>
            {me.admin && (
              <>
                <CommandItem onSelect={run(() => navigate("/settings/general"))}>
                  <SettingsIcon />
                  Settings
                </CommandItem>
                <CommandItem value={`Settings Integrations ${DEFINITIONS_TOOL} Google Drive`} onSelect={run(() => navigate("/settings/integrations"))}>
                  <PlugIcon />
                  Integrations
                </CommandItem>
                <CommandItem value="Settings Domains and owners" onSelect={run(() => navigate("/settings/domains"))}>
                  <SettingsIcon />
                  Domains and owners
                </CommandItem>
                <CommandItem value="Settings Agents and access" onSelect={run(() => navigate("/settings/agents"))}>
                  <SettingsIcon />
                  Agents and access
                </CommandItem>
              </>
            )}
            <CommandItem onSelect={run(() => navigate("/help"))}>
              <CircleHelpIcon />
              Help
            </CommandItem>
          </CommandGroup>
          <CommandGroup className="border-t" heading="Do">
            <CommandItem onSelect={run(() => navigate("/context/new"))}>
              <PlusIcon />
              New context
            </CommandItem>
            <CommandItem onSelect={run(() => navigate("/definitions/new"))}>
              <PlusIcon />
              New term
            </CommandItem>
            <CommandItem onSelect={run(() => openDock("ask"))}>
              <MessageSquareIcon />
              Ask in the side panel
            </CommandItem>
            <CommandItem onSelect={run(() => openOverlay("connect"))}>
              <PlugIcon />
              Connect an agent
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme(theme === "dark" ? "light" : "dark"))}>
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              {theme === "dark" ? "Light appearance" : "Dark appearance"}
            </CommandItem>
          </CommandGroup>
          <CommandGroup className="border-t" heading="Context">
            {facts.map((f) => (
              <CommandItem key={f.id} value={`${f.title} ${f.where.join(" ")} ${domains[f.domain].name}`} onSelect={run(() => openDock("context", f.id))}>
                <KindGlyph kind={f.kind} />
                <span className="min-w-0 flex-1 truncate">{f.title}</span>
                <CommandShortcut className="tracking-normal max-sm:hidden">{domains[f.domain].name}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup className="border-t" heading="Definitions">
            {definitions.map((d) => (
              <CommandItem key={d.name} value={`definition ${d.name} ${d.sourceNames.join(" ")} ${d.sameAs ?? ""}`} onSelect={run(() => openDock("def", d.name))}>
                <TypeGlyph d={d} className="text-current" />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <CommandShortcut className="tracking-normal max-sm:hidden">{d.sameAs ? `Another name for ${d.sameAs}` : kindName(d)}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup className="border-t" heading="Example answers">
            {examples.map((e) => (
              <CommandItem key={e.id} value={`example ${e.label}`} onSelect={run(() => navigate("/ask", { example: e.id }))}>
                <MessageSquareIcon />
                {e.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
        <CommandFooter>
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            to open
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            to close
          </span>
        </CommandFooter>
      </Command>
    </CommandDialog>
  )
}
