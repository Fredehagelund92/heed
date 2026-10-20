import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { describeApiError, toApiError } from '@/api'
import { areasQuery, tryItQuery, vocabularyQuery } from '@/api/queries'
import { DateField } from '@/components/form/date-field'
import { CircleAlertIcon, MessageSquareIcon, SearchIcon } from '@/components/icons'
import { ScopeInput } from '@/components/mentions/scope-input'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import { targetsByKey } from '@/lib/mention-targets'
import {
  countWords,
  defaultWindow,
  emptyScope,
  hasTerms,
  readTryIt,
  sameScope,
  scopeWords,
  tryItInput,
  type TryItScope,
} from '@/lib/try-it'
import { formatDay } from '@/lib/library'
import { useLibrary } from '@/lib/use-library'
import { useMentionTargets } from '@/lib/use-mention-targets'
import { cn } from '@/lib/utils'
import { TryItReply } from './try-it-reply'

/*
  What an agent would get (Try it; Assistant board, direction A with C's shared scope bar): a
  scope in, get_context's reply on the live edition out, with no model and nothing recorded. The
  bar holds the chips (metrics, markets, products, from the vocabulary) and the first and last
  day, which start as the last 30 days. "Show what an agent gets", Enter in the chips or Command
  or Control Enter anywhere in the bar asks; the reply below is always for the scope last asked,
  so changing a chip does not change it until the person asks again. The assistant's panel and
  the Try it page both show it; the page keeps the scope asked in its address.
*/

/** The bar's dates before the person sets them: `undefined` reads as the default window. */
type Draft = {
  scope: TryItScope['scope']
  from: string | null | undefined
  to: string | null | undefined
}

const draftOf = (tried: TryItScope | null): Draft =>
  tried
    ? { scope: tried.scope, from: tried.from, to: tried.to }
    : { scope: emptyScope, from: undefined, to: undefined }

function Loading() {
  return (
    <div data-slot="try-it-loading" className="flex flex-col gap-3" aria-hidden="true">
      <div className="flex gap-2">
        <Skeleton className="h-6 w-16" />
        <Skeleton className="h-6 w-1/3" />
      </div>
      <Skeleton className="h-4 w-full max-w-popover" />
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  )
}

/**
 * Before anything is asked: what this shows, and how to ask; and where a person uses the same
 * facts in their own AI app (Settings, Connect an AI app).
 */
function Intro({ onLeave }: { onLeave: (() => void) | undefined }) {
  return (
    <Empty data-state="try-it-intro" className="flex-none border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <MessageSquareIcon />
        </EmptyMedia>
        <EmptyTitle>See what an AI app gets</EmptyTitle>
        <EmptyDescription>
          Pick a metric, a market or a product, and the dates. You&apos;ll see the facts an AI app
          gets, in order, and what it&apos;s told.
        </EmptyDescription>
        <EmptyDescription>Nothing is saved, so try as often as you like.</EmptyDescription>
        <EmptyDescription>
          Want these facts in Claude or another AI app?{' '}
          <Link to="/settings" search={{ section: 'connect' }} onClick={onLeave}>
            Connect an AI app
          </Link>
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function TryItView({
  asked,
  onAsk,
  onLeave,
  idPrefix,
}: {
  /** The scope last asked, whose reply shows; null before the first. */
  asked: TryItScope | null
  onAsk: (scope: TryItScope) => void
  /** Going to another page from it (a fact, Add a fact). */
  onLeave?: () => void
  /** Keeps the fields' ids apart when the panel and the page are both on screen. */
  idPrefix?: string
}) {
  const library = useLibrary()
  const today = library.today
  const areas = useQuery(areasQuery()).data
  const { targets } = useMentionTargets()
  const generated = useId()
  const ids = idPrefix ?? generated
  const scopeRef = useRef<HTMLDivElement>(null)

  // A new scope asked from outside (Back, a link) replaces what the bar holds.
  const [draft, setDraft] = useState<Draft>(() => draftOf(asked))
  const [shown, setShown] = useState(asked)
  if (asked !== shown) {
    setShown(asked)
    setDraft(draftOf(asked))
  }
  const [missing, setMissing] = useState(false)

  const defaults = today ? defaultWindow(today) : null
  const current: TryItScope = {
    scope: draft.scope,
    from: draft.from === undefined ? (defaults?.from ?? null) : draft.from,
    to: draft.to === undefined ? (defaults?.to ?? null) : draft.to,
  }
  const ask = () => {
    if (!hasTerms(current.scope)) {
      setMissing(true)
      scopeRef.current?.querySelector('input')?.focus()
      return
    }
    setMissing(false)
    // The same scope again asks the service again: an edition may have gone live since.
    if (asked && sameScope(asked, current)) void query.refetch()
    else onAsk(current)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      ask()
    }
  }

  const input = useMemo(() => (asked ? tryItInput(asked) : null), [asked])
  const query = useQuery({ ...tryItQuery(input ?? {}), enabled: input !== null })
  const lookup = useMemo(() => targetsByKey(targets), [targets])
  const vocabulary = useQuery(vocabularyQuery()).data
  const dimensionNames = useMemo(
    () =>
      new Map(
        (vocabulary?.dimensions ?? []).map((dimension) => [`dim:${dimension.id}`, dimension.name]),
      ),
    [vocabulary],
  )
  const nameOf = useCallback(
    (key: string) => lookup.get(key)?.name ?? dimensionNames.get(key),
    [lookup, dimensionNames],
  )
  const reply = useMemo(
    () => (query.data ? readTryIt(query.data, nameOf) : null),
    [query.data, nameOf],
  )
  const domainOf = (itemId: string) => {
    const areaId = library.rows.find((row) => row.id === itemId)?.areaId
    return areas?.find((area) => area.id === areaId) ?? null
  }
  const failure = query.isError ? toApiError(query.error) : null
  const announcement = !asked
    ? ''
    : query.isPending
      ? 'Asking as an AI app would.'
      : reply
        ? `Ready. ${countWords(reply)}.`
        : failure
          ? "We couldn't get what AI apps get."
          : ''

  return (
    <div data-slot="try-it" className="flex min-w-0 flex-col gap-4">
      <form
        aria-label="What the question is about"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          ask()
        }}
        onKeyDown={onKeyDown}
        className="@container flex flex-col gap-4 rounded-lg border bg-background p-4"
      >
        <Field invalid={missing}>
          <FieldLabel htmlFor={`${ids}-scope`}>What it is about</FieldLabel>
          <div ref={scopeRef}>
            <ScopeInput
              id={`${ids}-scope`}
              value={draft.scope}
              onChange={(scope) => {
                setDraft((now) => ({ ...now, scope }))
                if (hasTerms(scope)) setMissing(false)
              }}
              aria-invalid={missing || undefined}
              aria-describedby={missing ? `${ids}-scope-error` : undefined}
              className="bg-background"
            />
          </div>
          {missing ? (
            <FieldError id={`${ids}-scope-error`}>
              Add a metric, a market or a product first.
            </FieldError>
          ) : null}
        </Field>
        <div className="grid grid-cols-1 gap-4 @sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor={`${ids}-from`}>From</FieldLabel>
            <DateField
              id={`${ids}-from`}
              value={current.from}
              onValueChange={(from) => setDraft((now) => ({ ...now, from }))}
              calendarLabel="Choose the first day"
              placeholder="First day"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-to`}>To</FieldLabel>
            <DateField
              id={`${ids}-to`}
              value={current.to}
              min={current.from ?? undefined}
              onValueChange={(to) => setDraft((now) => ({ ...now, to }))}
              calendarLabel="Choose the last day"
              placeholder="Last day"
            />
          </Field>
        </div>
        <Button
          type="submit"
          size="lg"
          aria-keyshortcuts="Meta+Enter Control+Enter"
          className="w-fit"
        >
          <SearchIcon />
          Show what AI apps get
        </Button>
      </form>
      <span role="status" className="sr-only">
        {announcement}
      </span>
      <section
        aria-label="What AI apps get"
        aria-busy={query.isFetching || undefined}
        className={cn('flex flex-col gap-4', query.isFetching && reply && 'opacity-60')}
      >
        {!asked ? (
          <Intro onLeave={onLeave} />
        ) : failure?.kind === 'precondition' ? (
          <Empty data-state="try-it-not-live" className="flex-none border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleAlertIcon />
              </EmptyMedia>
              <EmptyTitle>AI apps don&apos;t get any facts yet</EmptyTitle>
              <EmptyDescription>
                They start once an admin shares the facts for the first time. Facts accepted now are
                part of it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : failure ? (
          <Alert variant="danger" data-slot="try-it-error">
            <CircleAlertIcon />
            <AlertContent>
              <AlertTitle>We couldn&apos;t get what AI apps get</AlertTitle>
              <AlertDescription>{describeApiError(failure).description}</AlertDescription>
              <Button variant="outline" className="w-fit" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </AlertContent>
          </Alert>
        ) : reply ? (
          <TryItReply
            reply={reply}
            tried={asked}
            about={scopeWords(asked, nameOf, (day) => formatDay(day, 'long'))}
            today={today}
            domainOf={domainOf}
            onLeave={onLeave}
          />
        ) : (
          <Loading />
        )}
      </section>
    </div>
  )
}
