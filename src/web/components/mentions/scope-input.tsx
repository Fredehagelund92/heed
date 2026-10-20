import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { Scope } from '@domain/item'
import type { ScopeHit } from '@/api'
import { scopeSearchQuery, scopeTermsQuery } from '@/api/queries'
import { HeedSourceMissingIcon, SplitIcon, XIcon } from '@/components/icons'
import { optionId } from '@/components/mentions/mention-list'
import { ScopeList, type ScopeRow, type ScopeSection } from '@/components/mentions/scope-list'
import { PreviewLink } from '@/components/preview/preview-link'
import {
  ScopeTermLabel,
  scopeTermKind,
  scopeTermWords,
  type ScopeTermView,
} from '@/components/mentions/scope-term'
import { Badge } from '@/components/ui/badge'
import { addToScope, removeFromScope, scopeKeys } from '@/lib/mention-targets'
import { previewTargetOf } from '@/lib/preview'
import { anyValueInSentence } from '@/lib/library-core'
import { cn } from '@/lib/utils'

/** Chips shown before the rest fold into "+N more". */
export const CHIP_FOLD = 8
/**
 * Rows of a page, across dimensions or inside one: a page fits under the field on a laptop
 * screen, and the list never scrolls (the service's own page is up to 20).
 */
const PAGE_ROWS = 12
/** How long typing rests before the search runs. */
const SEARCH_DELAY_MS = 150

/** The part after the last separator of a key: `val:market/norway` is `norway`. */
const idOf = (key: string) =>
  key
    .slice(key.indexOf(':') + 1)
    .split('/')
    .pop() ?? key

const plurals: Record<string, string> = { match: 'matches' }
const humanize = (id: string) => {
  const words = id.replace(/_/g, ' ')
  return words.charAt(0).toLocaleUpperCase('en') + words.slice(1)
}
const count = (value: number, noun: string) =>
  `${value.toLocaleString('en')} ${value === 1 ? noun : (plurals[noun] ?? `${noun}s`)}`

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return debounced
}

const viewOf = (hit: ScopeHit): ScopeTermView => ({
  kind: hit.kind,
  name: hit.name,
  dimensionName: hit.dimension?.name ?? null,
})

type Chip = { key: string; term: ScopeTermView; missing: boolean }

/**
 * A chosen term's words: a link to its catalogue page in a new tab, so the draft stays where it
 * is, that previews the term on hover or a tap. It is out of the tab order: in the field, the keys
 * move between the words and the chips (Backspace picks the last chip). A term the vocabulary no
 * longer holds has no page.
 */
function ScopeChipName({ chip, children }: { chip: Chip; children: ReactNode }) {
  const preview = chip.missing ? null : previewTargetOf(chip.key)
  if (!preview) return <>{children}</>
  return (
    <PreviewLink
      preview={preview}
      newTab
      tabIndex={-1}
      className="inline-flex min-w-0 rounded-sm hover:underline hover:underline-offset-4"
    >
      {children}
    </PreviewLink>
  )
}

/**
 * A chip in "Where it applies" (the table report's scope family, radius 4). A chosen term the
 * vocabulary no longer holds keeps its chip, dashed, and is followed by a soft warning badge.
 */
function ScopeChip({
  chip,
  selected,
  onRemove,
  disabled,
}: {
  chip: Chip
  selected: boolean
  onRemove: () => void
  disabled?: boolean
}) {
  return (
    <li className="flex max-w-full min-w-0 items-center gap-2">
      <span
        data-slot="scope-chip"
        data-kind={chip.term.kind}
        data-selected={selected || undefined}
        className={cn(
          'inline-flex badge-md max-w-full min-w-0 items-center rounded-badge border border-border bg-background text-foreground',
          chip.missing && 'border-dashed',
          selected && 'ring-2 ring-ring',
        )}
      >
        <ScopeChipName chip={chip}>
          <ScopeTermLabel term={chip.term} />
        </ScopeChipName>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Remove ${scopeTermWords(chip.term)}`}
          onClick={onRemove}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none"
        >
          <XIcon aria-hidden="true" className="size-icon-sm" />
        </button>
      </span>
      {chip.missing ? (
        <Badge form="soft" tone="warning" icon={HeedSourceMissingIcon}>
          Source missing
        </Badge>
      ) : null}
    </li>
  )
}

/**
 * "Where it applies" (contract 9.6, FR-107): a combobox with chips. A dimension can hold
 * thousands of values, so nothing is listed until the person types, and the service searches: a
 * page of metrics and, per dimension, "Any value", a few values with how many match, and a row to
 * search all of them. Recent and often-used terms come first. Inside one dimension the list pages
 * through its values. Another name finds the main one and
 * says so. An unknown word is never accepted: the list says so and can offer to ask an owner.
 * After eight chips the rest fold into "+N more". Backspace in an empty field leaves a dimension,
 * then selects the last chip, and a second Backspace removes it.
 *
 * The value is the draft's scope in the shape the write path checks (`metric:<id>`, `dim:<id>`
 * and `{ dimension: 'dim:<id>', value: 'val:<id>/<value>' }`), so the form passes it straight on.
 */
export function ScopeInput({
  value,
  onChange,
  onRequestTerm,
  onPick,
  id,
  placeholder = 'Search metrics and markets',
  disabled = false,
  className,
  ...aria
}: {
  value: Scope
  onChange: (scope: Scope) => void
  /** Asks an owner to add a missing term. Without it the list only says there is no match. */
  onRequestTerm?: (words: string) => void
  /**
   * After a term picked from the list closes it, with the scope it made: nothing is left to
   * choose there, so a quick picker can be done. Inside a dimension the list stays for more.
   */
  onPick?: (scope: Scope) => void
  id?: string
  placeholder?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  const generatedId = useId()
  const inputId = id ?? `${generatedId}-input`
  const listId = `${generatedId}-list`
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [within, setWithin] = useState<ScopeHit | null>(null)
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [active, setActive] = useState<string | null>(null)
  const [selectedChip, setSelectedChip] = useState<string | null>(null)
  const [unfolded, setUnfolded] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [picked, setPicked] = useState<ReadonlyMap<string, ScopeHit>>(new Map())
  const debounced = useDebounced(query.trim(), SEARCH_DELAY_MS)
  // Clearing the words takes effect at once; only typing waits.
  const words = query.trim() ? debounced : ''

  const keys = useMemo(() => scopeKeys(value), [value])
  // Names come from the service for keys the person did not pick here; a pick brings its own.
  const unnamed = useMemo(() => keys.filter((key) => !picked.has(key)).sort(), [keys, picked])
  const names = useQuery({
    ...scopeTermsQuery(unnamed),
    enabled: unnamed.length > 0,
    placeholderData: keepPreviousData,
  })
  const named = useMemo(() => {
    const map = new Map(picked)
    for (const hit of names.data ?? []) map.set(hit.key, hit)
    return map
  }, [picked, names.data])
  const chips = keys.map((key): Chip => {
    const hit = named.get(key)
    if (hit) return { key, term: viewOf(hit), missing: false }
    return {
      key,
      // Until the names arrive, the id reads as words: `norway_spring` is "Norway spring".
      term: { kind: scopeTermKind(key), name: humanize(idOf(key)) },
      missing: names.isSuccess && !names.isPlaceholderData,
    }
  })
  const shown = unfolded || chips.length <= CHIP_FOLD ? chips : chips.slice(0, CHIP_FOLD)
  const folded = chips.length - shown.length

  const searching = open && (within !== null || words.length > 0)
  const search = useQuery({
    ...scopeSearchQuery(
      within
        ? { q: words, dimension: within.key, limit: PAGE_ROWS, ...(cursor ? { cursor } : {}) }
        : { q: words, limit: PAGE_ROWS },
    ),
    enabled: searching && !disabled,
    placeholderData: keepPreviousData,
  })
  const result = searching ? search.data : undefined

  /** Which values of a dimension a page shows: "13 to 24 of 240 matches". */
  const pageWords =
    within && result?.groups[0] && result.groups[0].count > 0
      ? (() => {
          const group = result.groups[0]
          const start = Number(cursor ?? '0')
          const end = Math.min(group.count, start + group.values.length)
          return `${start + 1} to ${end} of ${count(group.count, group.named ? 'value' : 'match')}`
        })()
      : undefined
  const chosen = new Set(keys)
  const sections: ScopeSection[] = []
  if (result) {
    const terms = (hits: readonly ScopeHit[]): ScopeRow[] =>
      hits.filter((hit) => !chosen.has(hit.key)).map((hit) => ({ id: hit.key, type: 'term', hit }))
    if (result.metrics.length)
      sections.push({ id: 'metrics', heading: 'Metrics', rows: terms(result.metrics) })
    for (const group of result.groups) {
      const shownValues = group.values.filter((hit) => !chosen.has(hit.key))
      // Words that name the dimension, or none inside it, offer "Any value" first; words that
      // found values offer the values first, so Enter takes the value typed.
      const rows: ScopeRow[] = group.named
        ? [...terms([group.dimension]), ...terms(shownValues)]
        : [...terms(shownValues), ...terms([group.dimension])]
      if (within && cursor && cursor !== '0')
        rows.push({
          id: 'page:previous',
          type: 'page',
          direction: 'previous',
          cursor: String(Math.max(0, Number(cursor) - PAGE_ROWS)),
        })
      if (within && result.nextCursor)
        rows.push({ id: 'page:next', type: 'page', direction: 'next', cursor: result.nextCursor })
      if (!within && group.count > group.values.length)
        rows.push({
          id: `within:${group.dimension.key}`,
          type: 'within',
          dimension: group.dimension,
          count: group.count,
        })
      const section = {
        id: group.dimension.key.replace(':', '-'),
        heading: group.dimension.name,
        count: pageWords ?? count(group.count, group.named ? 'value' : 'match'),
        rows,
      }
      // Words that are exactly a dimension's name ("market") put it before the metrics they also
      // start ("Marketing spend"), so Enter takes the dimension.
      if (!within && group.dimension.name.toLocaleLowerCase('en') === words.toLocaleLowerCase('en'))
        sections.unshift(section)
      else sections.push(section)
    }
  }
  const nothing = Boolean(result) && sections.every((section) => section.rows.length === 0)
  // Words that find only what is already chosen say so; only words that find nothing are worth
  // asking an owner about.
  const chosenMatch = nothing
    ? [
        ...(result?.metrics ?? []),
        ...(result?.groups.flatMap((group) => [group.dimension, ...group.values]) ?? []),
      ].find((hit) => chosen.has(hit.key))
    : undefined
  const request =
    onRequestTerm && nothing && !chosenMatch && words.length > 0 && !within ? words : null
  if (request)
    sections.push({
      id: 'request',
      heading: 'Not in the catalogue',
      rows: [{ id: 'request', type: 'request', words: request }],
    })
  const rows = sections.flatMap((section) => section.rows)
  const activeId = active && rows.some((row) => row.id === active) ? active : (rows[0]?.id ?? null)
  const expanded = searching && Boolean(result)
  const remember = (hits: readonly ScopeHit[]) =>
    setPicked((current) => {
      const next = new Map(current)
      for (const hit of hits) next.set(hit.key, hit)
      return next
    })

  const add = (hit: ScopeHit): Scope => {
    const next = addToScope(value, hit.key)
    const dropped = keys.filter((key) => key !== hit.key && !scopeKeys(next).includes(key))
    remember([hit])
    onChange(next)
    const words = scopeTermWords(viewOf(hit))
    const replaced = dropped.length
      ? hit.kind === 'dimension'
        ? ` It replaces ${count(dropped.length, 'value')} of ${hit.name}.`
        : ` It replaces ${hit.dimension ? anyValueInSentence(hit.dimension.name) : 'any value'}.`
      : ''
    setAnnouncement(
      hit.alias
        ? `Added ${words}. ${hit.alias} is another name for ${hit.name}.${replaced}`
        : `Added ${words}.${replaced}`,
    )
    setActive(null)
    // Inside a dimension the list stays, so several values can be picked in a row.
    if (!within) {
      setQuery('')
      setOpen(false)
    }
    inputRef.current?.focus()
    return next
  }
  /**
   * Searches inside one dimension. Words that matched its values keep searching them ("spring"
   * in Campaign); words that named the dimension itself are done and are cleared.
   */
  const enter = (dimension: ScopeHit) => {
    const named = result?.groups.find((group) => group.dimension.key === dimension.key)?.named
    setWithin(dimension)
    setCursor(undefined)
    if (named !== false) setQuery('')
    setActive(null)
    setOpen(true)
    setAnnouncement(
      `Searching the values of ${dimension.name}. Press Backspace in the empty field to leave.`,
    )
    inputRef.current?.focus()
  }
  const leave = () => {
    if (!within) return
    setAnnouncement(`Left ${within.name}. Searching everything.`)
    setWithin(null)
    setCursor(undefined)
    setActive(null)
  }
  const remove = (chip: Chip) => {
    onChange(removeFromScope(value, chip.key))
    setSelectedChip(null)
    setAnnouncement(`Removed ${scopeTermWords(chip.term)}.`)
    inputRef.current?.focus()
  }
  const askOwner = (words: string) => {
    if (!onRequestTerm) return
    onRequestTerm(words)
    setAnnouncement(`Asked an owner to add ${words}.`)
    setQuery('')
    setOpen(false)
  }
  const pick = (row: ScopeRow) => {
    if (row.type === 'term') {
      const next = add(row.hit)
      if (!within) onPick?.(next)
    } else if (row.type === 'within') enter(row.dimension)
    else if (row.type === 'page') {
      setCursor(row.cursor === '0' ? undefined : row.cursor)
      setActive(row.id)
      inputRef.current?.focus()
    } else askOwner(row.words)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const position = activeId ? rows.findIndex((row) => row.id === activeId) : -1
    const activeRow = position >= 0 ? rows[position] : undefined
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (!expanded) {
        setOpen(true)
        return
      }
      if (rows.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(rows[(position + step + rows.length) % rows.length]?.id ?? null)
      return
    }
    if (
      event.key === 'ArrowRight' &&
      expanded &&
      !within &&
      event.currentTarget.selectionStart === query.length
    ) {
      const dimension =
        activeRow?.type === 'within'
          ? activeRow.dimension
          : activeRow?.type === 'term' && activeRow.hit.kind === 'dimension'
            ? activeRow.hit
            : null
      if (dimension) {
        event.preventDefault()
        enter(dimension)
      }
      return
    }
    if (event.key === 'Enter') {
      if (!expanded) return
      event.preventDefault()
      if (activeRow) pick(activeRow)
      return
    }
    if (event.key === 'Escape') {
      if (expanded || selectedChip) {
        event.preventDefault()
        setOpen(false)
        setSelectedChip(null)
      } else if (within) {
        event.preventDefault()
        leave()
      }
      return
    }
    if (event.key === 'Backspace' && query === '') {
      if (within) {
        event.preventDefault()
        leave()
        return
      }
      if (chips.length > 0) {
        event.preventDefault()
        const last = chips[chips.length - 1]!
        if (selectedChip === last.key) remove(last)
        else {
          setUnfolded(true)
          setSelectedChip(last.key)
          setAnnouncement(
            `${scopeTermWords(last.term)} selected. Press Backspace again to remove it.`,
          )
        }
        return
      }
    }
    if (selectedChip) setSelectedChip(null)
  }

  const listLabel = within ? `Values of ${within.name}` : 'Metrics, markets and other names'
  const empty = chosenMatch
    ? `${scopeTermWords(viewOf(chosenMatch))} is already chosen.`
    : within
      ? words
        ? `No value of ${within.name} matches.`
        : `${within.name} has no values yet.`
      : 'Nothing matches. This lists only the names in the catalogue. An admin adds them in Administration › Sources.'
  const spokenStatus = expanded
    ? rows.length === 0
      ? empty
      : within
        ? `Showing ${pageWords ?? 'none'}.`
        : `${count(rows.length, 'result')}.`
    : announcement

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <div className="relative w-full">
        <div
          data-slot="scope-input"
          data-disabled={disabled || undefined}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              event.preventDefault()
              inputRef.current?.focus()
            }
          }}
          className="flex min-h-control-lg w-full cursor-text flex-wrap items-center gap-2 rounded-md border border-input bg-transparent px-2 py-1 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 dark:bg-input/30 data-disabled:cursor-not-allowed data-disabled:opacity-50"
        >
          {chips.length > 0 ? (
            <ul aria-label="Chosen" className="contents">
              {shown.map((chip) => (
                <ScopeChip
                  key={chip.key}
                  chip={chip}
                  selected={selectedChip === chip.key}
                  disabled={disabled}
                  onRemove={() => remove(chip)}
                />
              ))}
            </ul>
          ) : null}
          {folded > 0 || (unfolded && chips.length > CHIP_FOLD) ? (
            <button
              type="button"
              disabled={disabled}
              aria-expanded={folded === 0}
              onClick={() => setUnfolded(folded > 0)}
              className="inline-flex badge-md items-center rounded-badge text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {folded > 0 ? `+${folded.toLocaleString('en')} more` : 'Show fewer'}
            </button>
          ) : null}
          {within ? (
            <span
              data-slot="scope-within"
              className="inline-flex badge-md items-center gap-1 rounded-badge bg-muted text-foreground"
            >
              <SplitIcon aria-hidden="true" className="size-icon-sm text-muted-foreground" />
              <span>
                <span className="sr-only">Searching in </span>
                {within.name}
              </span>
              <button
                type="button"
                aria-label={`Stop searching in ${within.name}`}
                onClick={() => {
                  leave()
                  inputRef.current?.focus()
                }}
                className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <XIcon aria-hidden="true" className="size-icon-sm" />
              </button>
            </span>
          ) : null}
          <input
            ref={inputRef}
            id={inputId}
            type="text"
            role="combobox"
            autoComplete="off"
            spellCheck={false}
            disabled={disabled}
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={expanded && activeId ? optionId(listId, activeId) : undefined}
            {...aria}
            value={query}
            placeholder={
              within
                ? `Search the values of ${within.name}`
                : chips.length > 0
                  ? undefined
                  : placeholder
            }
            onChange={(event) => {
              setQuery(event.target.value)
              setOpen(true)
              setActive(null)
              setCursor(undefined)
              setSelectedChip(null)
            }}
            onFocus={() => {
              if (within) setOpen(true)
            }}
            onKeyDown={onKeyDown}
            onBlur={() => {
              setOpen(false)
              setSelectedChip(null)
            }}
            className="h-control-md min-w-0 flex-1 basis-32 bg-transparent px-1 text-body outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed pointer-coarse:text-large"
          />
        </div>
        {expanded ? (
          <div className="absolute inset-x-0 top-full z-popover pt-1">
            <ScopeList
              id={listId}
              label={listLabel}
              sections={sections}
              query={words}
              activeId={activeId}
              empty={empty}
              onPick={pick}
              onActivate={setActive}
            />
          </div>
        ) : (
          <div id={listId} role="listbox" aria-label={listLabel} hidden />
        )}
      </div>
      <span role="status" className="sr-only">
        {spokenStatus}
      </span>
    </div>
  )
}
