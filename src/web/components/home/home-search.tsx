import { useId, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { TryItReading } from '@/api'
import { tryItReadingQuery } from '@/api/queries'
import { BotIcon, CornerDownLeftIcon, MessageSquareIcon, SearchIcon } from '@/components/icons'
import { KindIcon } from '@/components/item/item-marks'
import { highlight } from '@/components/library/item-list'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Kbd } from '@/components/ui/kbd'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { factQuery, factSuggestions } from '@/lib/home'
import {
  formatDay,
  isLiveIssueRow,
  queryTerms,
  type LibraryRow,
  type LibraryViewer,
} from '@/lib/library'
import { daysWords } from '@/lib/try-it'
import { cn } from '@/lib/utils'

/** How long typing rests before the words are read as a scope. */
const READ_DEBOUNCE_MS = 300

/**
 * A reading of the words as Try it takes it: the keys its address holds and the days, and the
 * same in words for the row ("Orders, Norway, 1 Aug 2026 to 31 Aug 2026"). Null when the
 * words name nothing Try it can ask about.
 */
function readingOf(reading: TryItReading) {
  const about = reading.about.filter((term) => /^(?:metric|dim|val):/.test(term.key))
  if (!about.length) return null
  const days = daysWords(reading.from, reading.to, formatDay)
  return {
    search: {
      about: about.map((term) => term.key).join(','),
      ...(reading.from ? { from: reading.from } : {}),
      ...(reading.to ? { to: reading.to } : {}),
    },
    words: [...about.map((term) => term.name), ...(days ? [days] : [])].join(', '),
  }
}

type Suggestion =
  | { type: 'fact'; row: LibraryRow }
  | { type: 'all'; total: number }
  | { type: 'ask' }
  | { type: 'try' }

/**
 * Home's one search field (Home P, the captain's call: "one plain field"). Typing opens a list of
 * what can be done with the same words, in the app's popover style: the facts that match, best
 * first, from the library's own client index; then "Ask the assistant" and "Try it". Arrows move,
 * Enter opens the highlighted row (the first fact by default), Escape closes the list and then
 * clears the field. Nothing typed is stored.
 *
 * It is the ARIA combobox pattern written out (a text field that owns a listbox), not cmdk: cmdk
 * always reports the list as expanded, and this list is closed until a person types.
 */
export function HomeSearch({
  rows,
  viewer,
  onAsk,
}: {
  rows: LibraryRow[]
  viewer: LibraryViewer
  /** Asks the question in a new chat with the assistant, beside the page. */
  onAsk: (question: string) => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const id = useId()
  const listId = `${id}-list`
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const trimmed = query.trim()

  const facts = useMemo(() => factSuggestions(rows, trimmed, viewer), [rows, trimmed, viewer])
  const words = factQuery(trimmed)
  // What the words name, read by the service as get_facts reads a question, so Try it opens on
  // it. Asked once typing rests; the question is never stored or put in an address (FR-602).
  const settled = useDebouncedValue(trimmed, READ_DEBOUNCE_MS)
  const reading = useQuery({
    ...tryItReadingQuery(settled),
    enabled: open && settled.length > 0,
  })
  const read = reading.data && settled === trimmed ? readingOf(reading.data) : null
  const suggestions: Suggestion[] = trimmed
    ? [
        ...facts.rows.map((row) => ({ type: 'fact' as const, row })),
        ...(facts.total > facts.rows.length ? [{ type: 'all' as const, total: facts.total }] : []),
        { type: 'ask' as const },
        { type: 'try' as const },
      ]
    : []
  const expanded = open && suggestions.length > 0
  const current = Math.min(active, suggestions.length - 1)
  const optionId = (index: number) => `${id}-option-${index}`

  const change = (value: string) => {
    setQuery(value)
    setActive(0)
    setOpen(value.trim().length > 0)
  }

  const choose = (suggestion: Suggestion) => {
    setOpen(false)
    switch (suggestion.type) {
      case 'fact':
        void navigate({ to: '/library/$itemId', params: { itemId: suggestion.row.id } })
        break
      case 'all':
        void navigate({ to: '/library', search: { q: words } })
        break
      case 'ask':
        // The words move to the new chat, where they show as sent.
        onAsk(trimmed)
        change('')
        break
      case 'try':
        void openTryIt()
        break
    }
  }

  /** Try it on what the words name; on the empty page when they name nothing or the read fails. */
  const openTryIt = async () => {
    let found = read
    if (!found)
      try {
        found = readingOf(await queryClient.fetchQuery(tryItReadingQuery(trimmed)))
      } catch {
        found = null
      }
    void navigate({ to: '/try-it', search: found?.search ?? {} })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const count = suggestions.length
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (count === 0) return
        event.preventDefault()
        if (!expanded) {
          setOpen(true)
          setActive(event.key === 'ArrowDown' ? 0 : count - 1)
          return
        }
        const step = event.key === 'ArrowDown' ? 1 : -1
        setActive((current + step + count) % count)
        break
      }
      case 'Enter': {
        const suggestion = expanded ? suggestions[current] : undefined
        if (!suggestion) return
        event.preventDefault()
        choose(suggestion)
        break
      }
      case 'Escape':
        if (expanded) {
          event.preventDefault()
          setOpen(false)
        } else if (query) {
          event.preventDefault()
          change('')
        } else {
          event.currentTarget.blur()
        }
        break
    }
  }

  // The options in order, so each knows its index for the highlight and the active descendant.
  let index = 0
  const option = (suggestion: Suggestion, children: ReactNode, label?: string) => {
    const at = index++
    const selected = at === current
    return (
      <div
        key={suggestion.type === 'fact' ? suggestion.row.id : suggestion.type}
        id={optionId(at)}
        role="option"
        aria-selected={selected}
        aria-label={label}
        data-selected={selected || undefined}
        data-suggestion={suggestion.type}
        // Keep the caret in the field: the list never takes focus.
        onMouseDown={(event) => event.preventDefault()}
        onMouseMove={() => setActive(at)}
        onClick={() => choose(suggestion)}
        className="flex min-h-control-lg cursor-pointer items-center gap-3 px-3 py-2 text-body pointer-coarse:min-h-control-touch data-selected:bg-accent"
      >
        {children}
      </div>
    )
  }
  const terms = queryTerms(words)
  const matchText =
    facts.total === 0
      ? 'No match'
      : `${facts.total.toLocaleString('en')} ${facts.total === 1 ? 'match' : 'matches'}`
  const enterHint = (selected: boolean) =>
    selected ? (
      <Kbd aria-hidden="true" className="hidden @lg:inline-flex">
        <CornerDownLeftIcon />
      </Kbd>
    ) : (
      <span aria-hidden="true" className="hidden w-6 @lg:block" />
    )

  return (
    <div
      role="search"
      aria-label="Search the library"
      className="@container relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <InputGroup className={cn('h-control-touch bg-background', expanded && 'border-foreground')}>
        <InputGroupAddon className="pl-3">
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          type="text"
          role="combobox"
          aria-label="Search the library, or ask a question"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={expanded ? optionId(current) : undefined}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="search"
          value={query}
          onChange={(event) => change(event.target.value)}
          onFocus={() => setOpen(trimmed.length > 0)}
          onKeyDown={onKeyDown}
          placeholder="Search the library, or ask a question"
          className="text-body pointer-coarse:text-large"
        />
        {expanded ? (
          <InputGroupAddon align="inline-end" className="pr-3">
            <Kbd className="hidden @lg:inline-flex">esc</Kbd>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <span role="status" className="sr-only">
        {expanded ? `Facts: ${matchText}` : ''}
      </span>
      {expanded ? (
        <div className="absolute inset-x-0 top-full z-popover pt-2">
          <div
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            data-slot="home-suggestions"
            className="flex flex-col overflow-hidden rounded-lg border bg-popover py-1 text-popover-foreground shadow-overlay"
          >
            <div role="group" aria-labelledby={`${id}-facts`}>
              <div
                aria-hidden="true"
                className="flex items-center justify-between gap-3 px-3 pt-2 pb-1 text-caption"
              >
                <span id={`${id}-facts`} className="font-bold text-muted-foreground">
                  Facts
                </span>
                <span className="text-muted-foreground tabular-nums">{matchText}</span>
              </div>
              {facts.total === 0 ? (
                <p aria-hidden="true" className="px-3 py-2 text-dense text-muted-foreground">
                  {read
                    ? `No facts match “${trimmed}”. Ask the assistant, or try the question to see what agents get.`
                    : `No facts match “${trimmed}”. Ask the assistant, or try fewer words.`}
                </p>
              ) : null}
              {facts.rows.map((row) => {
                const selected = index === current
                return option(
                  { type: 'fact', row },
                  <>
                    <KindIcon kind={row.kind} active={isLiveIssueRow(row)} decorative />
                    <span className="flex min-w-0 flex-1 flex-col gap-1 @lg:flex-row @lg:items-center @lg:gap-3">
                      <span className="min-w-0 flex-1 truncate">{highlight(row.title, terms)}</span>
                      <span className="shrink-0 text-dense text-muted-foreground tabular-nums">
                        {`${row.areaName}, ${formatDay(row.updatedAt)}`}
                      </span>
                    </span>
                    {enterHint(selected)}
                  </>,
                  `${row.title}, ${row.areaName}, ${formatDay(row.updatedAt, 'long')}`,
                )
              })}
              {facts.total > facts.rows.length
                ? option(
                    { type: 'all', total: facts.total },
                    <span className="flex min-w-0 flex-1 items-center gap-3 text-dense text-muted-foreground">
                      <span aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">
                        {`Show all ${facts.total.toLocaleString('en')} in the library`}
                      </span>
                    </span>,
                  )
                : null}
            </div>
            <div role="group" aria-labelledby={`${id}-or`} className="border-t">
              <div
                id={`${id}-or`}
                aria-hidden="true"
                className="px-3 pt-2 pb-1 text-caption font-bold text-muted-foreground"
              >
                Or
              </div>
              {option(
                { type: 'ask' },
                <>
                  <BotIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1 @lg:flex-row @lg:items-center @lg:gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      {`Ask the assistant: “${trimmed}”`}
                    </span>
                    <span className="shrink-0 text-dense text-muted-foreground">
                      Starts a new chat
                    </span>
                  </span>
                  {enterHint(index === current)}
                </>,
                `Ask the assistant: ${trimmed}. Starts a new chat.`,
              )}
              {option(
                { type: 'try' },
                <>
                  <MessageSquareIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-1 @lg:flex-row @lg:items-center @lg:gap-3">
                    <span className="min-w-0 flex-1 truncate">
                      {`Try a question: what do agents get for “${trimmed}”?`}
                    </span>
                    {read ? (
                      <span
                        data-slot="try-it-reading"
                        className="min-w-0 shrink truncate text-dense text-muted-foreground @lg:max-w-1/2"
                      >
                        {`Read as ${read.words}`}
                      </span>
                    ) : null}
                  </span>
                  {enterHint(index === current)}
                </>,
                `Try a question: what do agents get for “${trimmed}”?${read ? ` Read as ${read.words}.` : ''}`,
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
