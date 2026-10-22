import type { ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { itemConditions } from '@domain/item-conditions'
import { itemDisplayStatus } from '@domain/status'
import {
  areasQuery,
  catalogueQuery,
  catalogueTermQuery,
  libraryQuery,
  peopleQuery,
  vocabularyQuery,
} from '@/api/queries'
import {
  CatalogueStatusBadge,
  TermDomainBadge,
  termKindGlyphs,
} from '@/components/catalogue/catalogue-marks'
import { CopyIcon, HeedValidUntilIcon, SearchXIcon, TagIcon, type Icon } from '@/components/icons'
import { DomainBadge, KindBadge, StatusBadge } from '@/components/item/item-marks'
import { PersonAvatar } from '@/components/person-avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { termDomainInfo } from '@/lib/catalogue'
import { validityChip } from '@/lib/item-state'
import { formatDay } from '@/lib/library'
import {
  firstValues,
  personAreas,
  personRole,
  previewListSearch,
  previewPage,
  previewTypeNames,
  shelfLine,
  termMeta,
  valueOf,
  type PreviewPage,
  type PreviewTarget,
} from '@/lib/preview'
import type { LibrarySearch } from '@/lib/search-params'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'

/*
  What a chip's preview says (the editor design, section 6): for a metric or a dimension the copy of
  the source's description, its status, its domain and what the library holds about it; for a value its
  other names and its items; for an item its kind, domain, status, first lines and when it
  applies; for a person their name and the domains they look after. All of it comes from reads the
  app already caches: the catalogue (one read for every term), a dimension's detail (one read per
  dimension, for its values), the library index, the domains and the people. A page of chips makes
  no request until a card opens, and the same term never asks twice.

  Three surfaces show it: the hover card, the bottom sheet on touch and the @ list's peek. The
  peek has no actions, because focus stays in the field that opened the list.
*/

export type PreviewVariant = 'card' | 'sheet' | 'peek'

/** A term's detail is read once a minute at most for a preview: its page reads it at every visit. */
const DETAIL_STALE = 60_000

type Model = {
  name: string
  /** The type's glyph in a tile; an item's kind is its badge instead. */
  glyph?: Icon
  /** "Metric · group Payments": the type and what it belongs to. An item's kind badge says it. */
  meta?: string
  badges?: ReactNode
  /** The definition or the item's first lines. */
  text?: { body: string; quiet?: boolean }
  /** What the definition source called it, and when Heed read it. */
  source?: { line: string }
  extra?: ReactNode
  shelf?: { strong: string; rest: string }
  /** Where Open goes; null for a person (there is no people page). */
  page: PreviewPage | null
  /** "Show the 92 items": the library list a metric or a value chip opened before. */
  list?: { search: LibrarySearch; count: number }
  /** Dashed, like the chip of a retired item. */
  retired?: boolean
}

function Loading() {
  return (
    <div
      role="status"
      aria-label="Loading the preview"
      data-slot="preview-loading"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center gap-3">
        <Skeleton className="size-7 rounded-md" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  )
}

function Missing({ children }: { children: string }) {
  return (
    <p data-slot="preview-missing" className="flex items-start gap-2 text-muted-foreground">
      <SearchXIcon aria-hidden="true" className="size-4 shrink-0 translate-y-px" />
      {children}
    </p>
  )
}

/** Copies the absolute address of a page, as Copy link does everywhere. */
function useCopyLink() {
  const router = useRouter()
  return (page: PreviewPage, name: string) => {
    const href = new URL(router.buildLocation(page).href, window.location.origin).toString()
    void navigator.clipboard
      ?.writeText(href)
      .then(() => showToast(`Link to ${name} copied`))
      .catch(() => showToast("Couldn't copy the link"))
  }
}

function Actions({
  model,
  variant,
  onDone,
}: {
  model: Model
  variant: Exclude<PreviewVariant, 'peek'>
  onDone?: () => void
}) {
  const copyLink = useCopyLink()
  const { page, list, name } = model
  if (!page) return null
  const sheet = variant === 'sheet'
  const size = sheet ? 'touch' : 'sm'
  return (
    <div
      data-slot="preview-actions"
      className={cn(
        'flex',
        sheet ? 'flex-col gap-2 border-t p-4' : 'flex-wrap items-center gap-2 border-t pt-2',
      )}
    >
      <Button
        variant={sheet ? 'default' : 'outline'}
        size={size}
        aria-label={`Open ${name}`}
        render={<Link {...page} onClick={onDone} />}
      >
        Open
      </Button>
      {/* On the card the count in the shelf line is this link. */}
      {sheet && list && list.count > 0 ? (
        <Button
          variant="outline"
          size={size}
          render={<Link to="/library" search={list.search} onClick={onDone} />}
        >
          Show the {list.count.toLocaleString('en')} {list.count === 1 ? 'fact' : 'facts'}
        </Button>
      ) : null}
      <Button
        variant={sheet ? 'outline' : 'ghost'}
        size={size}
        aria-label={`Copy a link to ${name}`}
        onClick={() => copyLink(page, name)}
      >
        <CopyIcon aria-hidden="true" />
        Copy link
      </Button>
    </div>
  )
}

/** The shelf line; on the card its count links to the library's list of those items. */
function Shelf({ model, variant }: { model: Model; variant: PreviewVariant }) {
  const { shelf, list } = model
  if (!shelf) return null
  const linked = variant === 'card' && list && list.count > 0 && shelf.strong
  return (
    <p data-slot="preview-shelf" className="border-t pt-2 text-dense">
      {linked ? (
        <Link
          to="/library"
          search={list.search}
          className="font-bold underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          {shelf.strong}
        </Link>
      ) : shelf.strong ? (
        <b className="font-bold">{shelf.strong}</b>
      ) : null}
      <span className={cn(!shelf.strong && 'text-muted-foreground')}>{shelf.rest}</span>
    </p>
  )
}

/** The card's contents for one model, in the surface's layout. */
function View({
  model,
  variant,
  onDone,
}: {
  model: Model
  variant: PreviewVariant
  onDone?: () => void
}) {
  const Glyph = model.glyph
  return (
    <div
      data-slot="preview-view"
      data-retired={model.retired || undefined}
      className={cn('flex min-w-0 flex-col', variant === 'sheet' ? 'gap-0' : 'gap-3')}
    >
      <div className={cn('flex min-w-0 flex-col gap-3', variant === 'sheet' && 'px-4 pb-4')}>
        {/* The sheet's title already names it, so an item there has no header line at all. */}
        {Glyph || model.meta || variant !== 'sheet' ? (
          <div className="flex min-w-0 items-start gap-3">
            {Glyph ? (
              <span
                aria-hidden="true"
                className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground"
              >
                <Glyph className="size-4" />
              </span>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col">
              {/* The sheet's title already names it. */}
              {variant === 'sheet' ? null : (
                <p className="text-body font-bold break-words" data-slot="preview-name">
                  {model.name}
                </p>
              )}
              {model.meta ? (
                <p className="text-caption text-muted-foreground">{model.meta}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {model.badges ? (
          <div className="flex flex-wrap items-center gap-2">{model.badges}</div>
        ) : null}
        {model.text ? (
          <p
            data-slot="preview-text"
            className={cn('line-clamp-3 text-dense', model.text.quiet && 'text-muted-foreground')}
          >
            {model.text.body}
          </p>
        ) : null}
        {model.source ? (
          <p className="text-caption text-muted-foreground">{model.source.line}</p>
        ) : null}
        {model.extra}
        <Shelf model={model} variant={variant} />
      </div>
      {variant === 'peek' ? null : <Actions model={model} variant={variant} onDone={onDone} />}
    </div>
  )
}

/**
 * Where the words come from: the tool, never the member's name, whose view is how the model is
 * built, not what people pick (a dimension is one term however many views have it).
 */
function sourceOf(definition: { readAt: string | null; tool: string } | null) {
  if (!definition) return undefined
  return {
    line: definition.readAt
      ? `Copy from ${definition.tool}, read ${formatDay(definition.readAt)}`
      : `From ${definition.tool}`,
  }
}

function TermPreview({
  target,
  variant,
  onDone,
}: {
  target: Extract<PreviewTarget, { type: 'metric' | 'dim' }>
  variant: PreviewVariant
  onDone?: () => void
}) {
  const catalogue = useQuery(catalogueQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const key = `${target.type}:${target.id}`
  if (catalogue.data === undefined && !catalogue.isError) return <Loading />
  const term = catalogue.data?.terms.find((candidate) => candidate.key === key)
  if (!term)
    return (
      <Missing>
        {catalogue.isError
          ? "We couldn't load the Catalogue. The link still opens the page."
          : "It's no longer in the Catalogue."}
      </Missing>
    )
  const domain = termDomainInfo(term, areas)
  const values =
    term.kind === 'dimension'
      ? (vocabulary?.dimensions.find((dimension) => dimension.id === term.id)?.values ?? [])
      : []
  const listed = firstValues(values)
  const description = term.definition?.descriptionCopy ?? null
  const model: Model = {
    name: term.name,
    glyph: termKindGlyphs[term.kind],
    meta: termMeta(term, term.kind === 'dimension' && vocabulary ? values.length : undefined),
    badges: (
      <>
        <TermDomainBadge name={domain.name} label={domain.label} none={domain.none} size="sm" />
        <CatalogueStatusBadge
          status={term.status}
          activeIssues={term.shelf.activeIssues}
          tool={term.definition?.tool}
          size="sm"
        />
      </>
    ),
    text: description
      ? { body: description }
      : {
          body: term.definition
            ? `No description in ${term.definition.tool}.`
            : 'Not linked to a definition.',
          quiet: true,
        },
    source: sourceOf(term.definition),
    extra:
      listed.shown.length > 0 ? (
        <ul
          aria-label={`Values of ${term.name}`}
          className="flex flex-wrap items-center gap-1"
          data-slot="preview-values"
        >
          {listed.shown.map((name) => (
            <li key={name}>
              <Badge form="outline" size="sm">
                {name}
              </Badge>
            </li>
          ))}
          {listed.more > 0 ? (
            <li className="text-caption text-muted-foreground">+ {listed.more} more</li>
          ) : null}
        </ul>
      ) : undefined,
    shelf: shelfLine(term.shelf, term.kind === 'dimension' ? term.name : undefined),
    page: previewPage(target),
    list: (() => {
      const search = previewListSearch(target)
      return search ? { search, count: term.shelf.items } : undefined
    })(),
  }
  return <View model={model} variant={variant} onDone={onDone} />
}

function ValuePreview({
  target,
  variant,
  onDone,
}: {
  target: Extract<PreviewTarget, { type: 'val' }>
  variant: PreviewVariant
  onDone?: () => void
}) {
  const detail = useQuery({
    ...catalogueTermQuery('dimension', target.dimension),
    staleTime: DETAIL_STALE,
  })
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const dimension = vocabulary?.dimensions.find((candidate) => candidate.id === target.dimension)
  const known = dimension?.values.find((value) => value.id === target.value)
  const value = detail.data ? valueOf(detail.data, target.value) : null
  if (detail.data === undefined && !detail.isError && !known) return <Loading />
  const name = value?.name ?? known?.name
  if (!name || detail.data === null)
    return <Missing>It&apos;s no longer among the names we know.</Missing>
  const dimensionName = detail.data?.name ?? dimension?.name ?? target.dimension
  const aliases = value?.aliases ?? known?.aliases ?? []
  const model: Model = {
    name,
    glyph: TagIcon,
    meta: dimensionName,
    text: aliases.length ? { body: `Also called ${aliases.join(', ')}`, quiet: true } : undefined,
    shelf: value
      ? shelfLine({ items: value.items, mentionedBy: value.mentionedBy })
      : {
          strong: '',
          rest: detail.isError ? "We couldn't load the counts." : 'Counting the facts…',
        },
    page: previewPage(target),
    list: { search: previewListSearch(target)!, count: value?.items ?? 0 },
  }
  return <View model={model} variant={variant} onDone={onDone} />
}

function ItemPreview({
  target,
  variant,
  onDone,
}: {
  target: Extract<PreviewTarget, { type: 'item' }>
  variant: PreviewVariant
  onDone?: () => void
}) {
  const library = useQuery(libraryQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  if (library.data === undefined && !library.isError) return <Loading />
  const item = library.data?.items.find((candidate) => candidate.id === target.id)
  if (!item || !library.data)
    return (
      <Missing>
        {library.isError
          ? "We couldn't load the library. The link still opens the fact."
          : 'This fact is no longer in the library. The words you see are the ones its writer used.'}
      </Missing>
    )
  const today = library.data.today
  const area = areas.find((candidate) => candidate.id === item.areaId)
  const status = itemDisplayStatus(item, today)
  const chip = validityChip(item, itemConditions(item, today), {
    today,
    ownerName: null,
    areaName: area?.name ?? null,
    retired: item.status === 'retired' ? { by: null, date: item.updatedAt } : null,
  })
  const model: Model = {
    name: item.title,
    badges: (
      <>
        <KindBadge kind={item.kind} size="sm" />
        {area ? <DomainBadge name={area.name} label={area.label} size="sm" /> : null}
        <StatusBadge status={status} size="sm" />
      </>
    ),
    text: { body: item.summary },
    extra: (
      <p className="flex items-center gap-2 text-caption text-muted-foreground">
        <HeedValidUntilIcon aria-hidden="true" className="size-icon-sm shrink-0" />
        <span>
          {chip.label}
          {chip.tail}
        </span>
      </p>
    ),
    page: previewPage(target),
    retired: item.status === 'retired',
  }
  return <View model={model} variant={variant} onDone={onDone} />
}

function PersonPreview({
  target,
  variant,
}: {
  target: Extract<PreviewTarget, { type: 'person' }>
  variant: PreviewVariant
}) {
  const people = useQuery(peopleQuery())
  const { data: areas = [] } = useQuery(areasQuery())
  if (people.data === undefined && !people.isError) return <Loading />
  const person = people.data?.find((candidate) => candidate.id === target.id)
  if (!person) return <Missing>We don&apos;t know this person.</Missing>
  const role = personRole(person, areas)
  const looksAfter = personAreas(person, areas)
  return (
    <div
      data-slot="preview-view"
      className={cn('flex flex-col gap-3', variant === 'sheet' && 'px-4 pb-4')}
    >
      <div className="flex items-center gap-3">
        <PersonAvatar person={person} size="lg" decorative />
        <div className="flex min-w-0 flex-col">
          {variant === 'sheet' ? null : (
            <p className="text-body font-bold" data-slot="preview-name">
              {person.name}
            </p>
          )}
          <p className="text-caption text-muted-foreground">{role ?? 'Owns no domain'}</p>
        </div>
      </div>
      {looksAfter.length ? (
        <div className="flex flex-wrap gap-2">
          {looksAfter.map((area) => (
            <DomainBadge key={area.id} name={area.name} label={area.label} size="sm" />
          ))}
        </div>
      ) : null}
      <p className="border-t pt-2 text-caption text-muted-foreground">
        We keep no profile, email or phone number. Roles come from the domains.
      </p>
    </div>
  )
}

/** The name a surface gives the preview for screen readers, before its contents load. */
export function previewLabel(target: PreviewTarget): string {
  return `Preview of a ${previewTypeNames[target.type].toLocaleLowerCase('en')}`
}

/**
 * The preview of one target on one surface. `onDone` runs when an action leaves the page, so the
 * sheet can close.
 */
export function PreviewBody({
  target,
  variant,
  onDone,
}: {
  target: PreviewTarget
  variant: PreviewVariant
  onDone?: () => void
}) {
  switch (target.type) {
    case 'metric':
    case 'dim':
      return <TermPreview target={target} variant={variant} onDone={onDone} />
    case 'val':
      return <ValuePreview target={target} variant={variant} onDone={onDone} />
    case 'item':
      return <ItemPreview target={target} variant={variant} onDone={onDone} />
    case 'person':
      return <PersonPreview target={target} variant={variant} />
  }
}

/** The name of a target for the sheet's title, from the reads the card uses. */
export function usePreviewName(target: PreviewTarget | null): string | null {
  const { data: catalogue } = useQuery({ ...catalogueQuery(), enabled: false })
  const { data: vocabulary } = useQuery({ ...vocabularyQuery(), enabled: false })
  const { data: library } = useQuery({ ...libraryQuery(), enabled: false })
  const { data: people } = useQuery({ ...peopleQuery(), enabled: false })
  if (!target) return null
  switch (target.type) {
    case 'metric':
    case 'dim':
      return (
        catalogue?.terms.find((term) => term.key === `${target.type}:${target.id}`)?.name ?? null
      )
    case 'val':
      return (
        vocabulary?.dimensions
          .find((dimension) => dimension.id === target.dimension)
          ?.values.find((value) => value.id === target.value)?.name ?? null
      )
    case 'item':
      return library?.items.find((item) => item.id === target.id)?.title ?? null
    case 'person':
      return people?.find((person) => person.id === target.id)?.name ?? null
  }
}
