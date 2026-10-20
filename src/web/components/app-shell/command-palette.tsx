import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { Area } from '@domain/item'
import type { CatalogueTerm } from '@/api'
import { areasQuery, catalogueQuery, recentQuery } from '@/api/queries'
import { TermDomain, termKindGlyphs, termKindNames } from '@/components/catalogue/catalogue-marks'
import { DomainBadge, KindIcon } from '@/components/item/item-marks'
import { BookOpenIcon, SearchIcon } from '@/components/icons'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import {
  commandGroups,
  commands,
  commandTitle,
  formatHotkey,
  isAvailable,
  type Command as RegistryCommand,
  type CommandContext,
} from '@/lib/commands'
import { rankTerms } from '@/lib/catalogue'
import type { DocHit } from '@/lib/docs'
import { docsQuery } from '@/lib/docs-sections'
import { isLiveIssueRow, type LibraryRow } from '@/lib/library'
import { searchIds } from '@/lib/library-search'
import { useLibrary } from '@/lib/use-library'

const ITEM_RESULTS = 5
const RECENT_RESULTS = 5
const TERM_RESULTS = 3
const DOC_RESULTS = 4

function matchesCommand(command: RegistryCommand, title: string, query: string) {
  const haystack = [title, command.group, ...(command.keywords ?? [])].join(' ').toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word))
}

function Hotkey({ hotkey }: { hotkey: string }) {
  // Hidden on phones, which have no keyboard.
  return (
    <CommandShortcut className="hidden items-center gap-1 tracking-normal sm:flex">
      {formatHotkey(hotkey).map((key, index) =>
        key === 'then' ? (
          <span key={index}>then</span>
        ) : (
          <Kbd key={index} className="font-mono tabular-nums">
            {key}
          </Kbd>
        ),
      )}
    </CommandShortcut>
  )
}

function ItemOption({ row, onSelect }: { row: LibraryRow; onSelect: () => void }) {
  return (
    <CommandItem value={`item ${row.id}`} onSelect={onSelect}>
      <KindIcon kind={row.kind} active={isLiveIssueRow(row)} />
      <span className="min-w-0 flex-1 truncate">{row.title}</span>
      <DomainBadge
        name={row.areaName}
        label={row.areaLabel}
        size="sm"
        className="hidden max-w-column-domain sm:inline-flex"
      />
    </CommandItem>
  )
}

/** A metric or dimension as a palette result: its type's glyph, its name and its domain badge. */
export function TermOption({
  term,
  areas,
  onSelect,
}: {
  term: CatalogueTerm
  areas: readonly Area[]
  onSelect: () => void
}) {
  const Glyph = termKindGlyphs[term.kind]
  return (
    <CommandItem value={`term ${term.key}`} onSelect={onSelect}>
      {/* A bare glyph, as an item's kind is in the rows above and below. */}
      <Glyph
        role="img"
        aria-label={termKindNames[term.kind]}
        aria-hidden={false}
        className="size-4 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate">{term.name}</span>
      <TermDomain
        term={term}
        areas={areas}
        size="sm"
        className="hidden max-w-column-domain sm:inline-flex"
      />
    </CommandItem>
  )
}

/** A help page, or a heading on one, as a palette result: its name and where it is. */
function DocOption({ hit, onSelect }: { hit: DocHit; onSelect: () => void }) {
  return (
    <CommandItem value={`doc ${hit.href}`} onSelect={onSelect}>
      <BookOpenIcon />
      <span className="min-w-0 flex-1 truncate">{hit.heading ? hit.heading.title : hit.title}</span>
      <span className="hidden shrink-0 text-caption text-muted-foreground sm:inline-flex">
        {hit.heading ? hit.title : `${hit.kindName}, ${hit.minutes} min`}
      </span>
    </CommandItem>
  )
}

/**
 * The command palette and the quick switcher in one (contract 9.1). With no query it shows the
 * items you opened last, then the actions for the item in front of you, then every command. As
 * you type it shows the best five items, a way to see all results in the library, the metrics
 * and dimensions of the catalogue that match, the pages of the docs that match, and the commands
 * that match. Everything here comes from the library index, the catalogue, the help pages
 * (docs/help) and the command registry.
 */
export function CommandPalette({
  open,
  onOpenChange,
  context,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  context: CommandContext
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const { rows } = useLibrary()
  const { data: recent } = useQuery(recentQuery())
  const trimmed = query.trim()
  // The catalogue is read once someone types; Home and the catalogue have usually loaded it.
  const { data: catalogue } = useQuery({ ...catalogueQuery(), enabled: trimmed !== '' })
  const { data: areas = [] } = useQuery({ ...areasQuery(), enabled: trimmed !== '' })
  // The help pages are a chunk of their own, read once someone types.
  const { data: docs } = useQuery({ ...docsQuery(), enabled: trimmed !== '' })
  const docHits = useMemo(
    () => (docs && trimmed ? docs.search(trimmed, DOC_RESULTS) : []),
    [docs, trimmed],
  )

  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows])
  const items = useMemo(() => {
    if (trimmed) {
      return searchIds(rows, trimmed)
        .flatMap((id) => {
          const row = byId.get(id)
          return row && row.displayStatus !== 'retired' ? [row] : []
        })
        .slice(0, ITEM_RESULTS)
    }
    return (recent ?? []).flatMap((id) => byId.get(id) ?? []).slice(0, RECENT_RESULTS)
  }, [trimmed, rows, byId, recent])

  const terms = useMemo(
    () => rankTerms(catalogue?.terms ?? [], trimmed, TERM_RESULTS),
    [catalogue, trimmed],
  )
  // A metric or dimension named outright ("orders", "units per order") leads the items about it.
  const termsFirst = terms[0] !== undefined && terms[0].rank <= 1

  const available = commands.filter(
    (command) =>
      !command.paletteHidden &&
      isAvailable(command, context) &&
      (!trimmed || matchesCommand(command, commandTitle(command, context), trimmed)),
  )

  // A page or action whose name starts with the query ("gaps", "dark") leads; otherwise items do.
  const leading = trimmed
    ? available.find((command) =>
        commandTitle(command, context).toLowerCase().startsWith(trimmed.toLowerCase()),
      )
    : undefined
  const commandsFirst = leading !== undefined

  // The results are ours, not cmdk's (shouldFilter is off), so the highlight goes back to the
  // first result whenever the query changes. Otherwise Enter would pick a stale option.
  const firstValue = leading
    ? leading.id
    : termsFirst
      ? `term ${terms[0]!.term.key}`
      : items[0]
        ? `item ${items[0].id}`
        : terms[0]
          ? `term ${terms[0].term.key}`
          : docHits[0]
            ? `doc ${docHits[0].href}`
            : trimmed
              ? 'search-library'
              : (available[0]?.id ?? '')
  // cmdk scrolls its own pick into view while the results change, and the highlight then comes
  // back to the first result without scrolling, leaving the list scrolled past it. The first
  // result is always at the top, so a new query or a new first result starts the list there.
  const listRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    if (listRef.current) listRef.current.scrollTop = 0
  }, [trimmed, firstValue])
  const [highlighted, setHighlighted] = useState(firstValue)
  const [highlightFor, setHighlightFor] = useState(firstValue)
  if (highlightFor !== firstValue) {
    setHighlightFor(firstValue)
    setHighlighted(firstValue)
  }

  const close = (then: () => void) => {
    onOpenChange(false)
    setQuery('')
    then()
  }
  const openItem = (row: LibraryRow) =>
    close(() => void navigate({ to: '/library/$itemId', params: { itemId: row.id } }))
  const openTerm = (term: CatalogueTerm) =>
    close(
      () =>
        void navigate(
          term.kind === 'metric'
            ? { to: '/catalogue/metric/$id', params: { id: term.id } }
            : { to: '/catalogue/dimension/$id', params: { id: term.id } },
        ),
    )
  const searchLibrary = () => close(() => void navigate({ to: '/library', search: { q: trimmed } }))
  const openDoc = (hit: DocHit) =>
    close(
      () => void navigate({ to: '/docs/$slug', params: { slug: hit.slug }, hash: hit.heading?.id }),
    )

  const commandSections = (
    <>
      {commandGroups.map((group) => {
        const inGroup = available.filter((command) => command.group === group)
        if (inGroup.length === 0) return null
        return (
          <CommandGroup key={group} heading={group}>
            {inGroup.map((command) => (
              <CommandItem
                key={command.id}
                value={command.id}
                onSelect={() => close(() => command.run(context))}
              >
                <command.icon />
                <span>{commandTitle(command, context)}</span>
                {command.hotkey ? <Hotkey hotkey={command.hotkey} /> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )
      })}
    </>
  )

  const termSection =
    terms.length > 0 ? (
      <CommandGroup heading="Catalogue">
        {terms.map(({ term }) => (
          <TermOption key={term.key} term={term} areas={areas} onSelect={() => openTerm(term)} />
        ))}
      </CommandGroup>
    ) : null

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setQuery('')
      }}
      title="Command palette"
      description="Jump to a fact, a page or an action."
    >
      <Command shouldFilter={false} loop value={highlighted} onValueChange={setHighlighted}>
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder="Jump to a fact, a page or an action"
          aria-label="Search facts, pages and actions"
        />
        <CommandList ref={listRef}>
          <CommandEmpty>
            <span className="text-muted-foreground">Nothing matches.</span>
          </CommandEmpty>
          {commandsFirst ? commandSections : null}
          {termsFirst ? termSection : null}
          {items.length > 0 ? (
            <CommandGroup heading={trimmed ? 'Facts' : 'Recent'}>
              {items.map((row) => (
                <ItemOption key={row.id} row={row} onSelect={() => openItem(row)} />
              ))}
            </CommandGroup>
          ) : null}
          {trimmed ? (
            <CommandGroup heading={items.length > 0 ? undefined : 'Library'}>
              <CommandItem value="search-library" onSelect={searchLibrary}>
                <SearchIcon />
                <span className="truncate">
                  {items.length > 0 ? 'See all results for' : 'Search the library for'} “{trimmed}”
                </span>
              </CommandItem>
            </CommandGroup>
          ) : null}
          {termsFirst ? null : termSection}
          {docHits.length > 0 ? (
            <CommandGroup heading="Docs">
              {docHits.map((hit) => (
                <DocOption key={hit.href} hit={hit} onSelect={() => openDoc(hit)} />
              ))}
            </CommandGroup>
          ) : null}
          {commandsFirst ? null : commandSections}
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
