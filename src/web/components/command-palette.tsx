import * as React from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { defaultFilter } from 'cmdk'
import {
  BookAIcon,
  CalendarIcon,
  CircleHelpIcon,
  MapIcon,
  StickyNoteIcon,
  TriangleAlertIcon,
  InboxIcon,
  MessageSquareIcon,
  MoonIcon,
  NotebookTextIcon,
  PlusIcon,
  PlugIcon,
  SettingsIcon,
  SunIcon,
  UserIcon,
} from '@/components/icons'
import { openDock } from '@/lib/dock'
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
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import type { Kind } from '@/model/items'
import { searchQuery, useAskExamples } from '@/api/queries'
import { onOpen, open as openOverlay } from '@/lib/events'
import { navigate } from '@/lib/router'
import { kindName } from '@/lib/definitions'
import { useDomains, useMe } from '@/lib/workspace'
import { DomainDot } from '@/components/heed/tag-chip'
import { TypeGlyph } from '@/components/heed/definition'
import { useTheme } from '@/lib/theme-context'
import { DEFINITIONS_TOOL } from '@/model/integrations'

/** A context item's kind as a glyph, labelled for screen readers by the words beside it. */
function KindGlyph({ kind }: { kind: Kind }) {
  const Icon = {
    event: CalendarIcon,
    issue: TriangleAlertIcon,
    note: StickyNoteIcon,
    guide: MapIcon,
  }[kind]
  return <Icon className="text-muted-foreground" aria-hidden />
}

/** Marks a row search everywhere found, so the palette's own filter keeps it. */
const FOUND = 'found by search everywhere'

/**
 * The palette's own filter for its places and actions; a row the service found stays, in the
 * service's order, below the places and actions that match.
 */
const paletteFilter = (value: string, search: string, keywords?: string[]) =>
  keywords?.includes(FOUND) ? 0.01 : defaultFilter(value, search, keywords)

// Search: shadcn's Command in a dialog, opened with Cmd K or the sidebar's Search. Sized as the
// Heed app's search: 640 wide in the upper part of the screen, a 48px input row, 40px result rows
// with a type glyph, quiet group headers, and a row of key hints.
export function CommandPalette() {
  const domains = useDomains()
  const examples = useAskExamples()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  // What the words find, from search everywhere; the last answer stays while the next one loads,
  // so the list doesn't jump as people type.
  const found = useQuery({ ...searchQuery(q), placeholderData: keepPreviousData }).data
  const hits = q.trim() ? found : undefined
  const me = useMe()
  const { theme, setTheme } = useTheme()

  React.useEffect(() => onOpen('palette', () => setOpen(true)), [])
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const onOpenChange = (o: boolean) => {
    setOpen(o)
    if (!o) setQ('')
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search"
      description="Search context and go anywhere"
    >
      <Command filter={paletteFilter}>
        <CommandInput
          placeholder="Search context, or type a place…"
          value={q}
          onValueChange={setQ}
        />
        <CommandList>
          <CommandEmpty>Nothing found.</CommandEmpty>
          <CommandGroup heading="Go to">
            <CommandItem onSelect={run(() => navigate('/inbox'))}>
              <InboxIcon />
              Inbox
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/ask'))}>
              <MessageSquareIcon />
              Ask
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/context'))}>
              <NotebookTextIcon />
              Context
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/definitions'))}>
              <BookAIcon />
              Definitions
            </CommandItem>
            {me.admin && (
              <>
                <CommandItem onSelect={run(() => navigate('/settings/general'))}>
                  <SettingsIcon />
                  Settings
                </CommandItem>
                <CommandItem
                  value={`Settings Integrations ${DEFINITIONS_TOOL} Google Drive`}
                  onSelect={run(() => navigate('/settings/integrations'))}
                >
                  <PlugIcon />
                  Integrations
                </CommandItem>
                <CommandItem
                  value="Settings Domains and owners"
                  onSelect={run(() => navigate('/settings/domains'))}
                >
                  <SettingsIcon />
                  Domains and owners
                </CommandItem>
                <CommandItem
                  value="Settings Agents and access"
                  onSelect={run(() => navigate('/settings/agents'))}
                >
                  <SettingsIcon />
                  Agents and access
                </CommandItem>
              </>
            )}
            <CommandItem onSelect={run(() => navigate('/help'))}>
              <CircleHelpIcon />
              Help
            </CommandItem>
          </CommandGroup>
          <CommandGroup className="border-t" heading="Do">
            <CommandItem onSelect={run(() => navigate('/context/new'))}>
              <PlusIcon />
              New context
            </CommandItem>
            <CommandItem onSelect={run(() => navigate('/definitions/new'))}>
              <PlusIcon />
              New term
            </CommandItem>
            <CommandItem onSelect={run(() => openDock('ask'))}>
              <MessageSquareIcon />
              Ask in the side panel
            </CommandItem>
            <CommandItem onSelect={run(() => openOverlay('connect'))}>
              <PlugIcon />
              Connect an agent
            </CommandItem>
            <CommandItem onSelect={run(() => setTheme(theme === 'dark' ? 'light' : 'dark'))}>
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
              {theme === 'dark' ? 'Light appearance' : 'Dark appearance'}
            </CommandItem>
          </CommandGroup>
          {!!hits?.items.length && (
            <CommandGroup className="border-t" heading="Context">
              {hits.items.map((f) => (
                <CommandItem
                  key={f.id}
                  value={`context ${f.id} ${f.title}`}
                  keywords={[FOUND]}
                  onSelect={run(() => openDock('context', f.id))}
                >
                  <KindGlyph kind={f.kind} />
                  <span className="min-w-0 flex-1 truncate">{f.title}</span>
                  <CommandShortcut className="tracking-normal max-sm:hidden">
                    {domains[f.domain]?.name}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {!!hits?.definitions.length && (
            <CommandGroup className="border-t" heading="Definitions">
              {hits.definitions.map((d) => (
                <CommandItem
                  key={d.name}
                  value={`definition ${d.name}`}
                  keywords={[FOUND]}
                  onSelect={run(() => openDock('def', d.name))}
                >
                  <TypeGlyph d={d} className="text-current" />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                  <CommandShortcut className="tracking-normal max-sm:hidden">
                    {d.sameAs ? `Another name for ${d.sameAs}` : kindName(d)}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {me.admin && !!hits?.domains.length && (
            <CommandGroup className="border-t" heading="Domains">
              {hits.domains.map((d) => (
                <CommandItem
                  key={d.id}
                  value={`domain ${d.id} ${d.name}`}
                  keywords={[FOUND]}
                  onSelect={run(() => navigate(`/settings/domains/${d.id}`))}
                >
                  <DomainDot id={d.id} />
                  <span className="min-w-0 flex-1 truncate">{d.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {me.admin && !!hits?.people.length && (
            <CommandGroup className="border-t" heading="People">
              {hits.people.map((p) => (
                <CommandItem
                  key={p.name}
                  value={`person ${p.name}`}
                  keywords={[FOUND]}
                  onSelect={run(() => navigate('/settings/people', { person: p.name }))}
                >
                  <UserIcon />
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <CommandGroup className="border-t" heading="Example answers">
            {examples.map((e) => (
              <CommandItem
                key={e.id}
                value={`example ${e.label}`}
                onSelect={run(() => navigate('/ask', { example: e.id }))}
              >
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
