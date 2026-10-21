import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { CatalogueTermDetail } from '@/api'
import { areasQuery, itemListQuery, peopleQuery, vocabularyQuery } from '@/api/queries'
import {
  AtSignIcon,
  CalendarClockIcon,
  CalendarSyncIcon,
  ChevronDownIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CloudOffIcon,
  CopyIcon,
  DatabaseIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  EyeIcon,
  FileTextIcon,
  HashIcon,
  HeedAcceptedIcon,
  HeedDomainIcon,
  HeedIssueIcon,
  LibraryBigIcon,
  LinkIcon,
  Link2OffIcon,
  ListIcon,
  ListPlusIcon,
  PlusIcon,
  SigmaIcon,
  TargetIcon,
  TextAlignStartIcon,
  UserRoundIcon,
} from '@/components/icons'
import { FieldRow, FieldTable, Section } from '@/components/item/field-table'
import { DomainBadge, kindGlyphs, Owner } from '@/components/item/item-marks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { TabsContent } from '@/components/ui/tabs'
import { PersonPreview } from '@/components/preview/preview-link'
import { catalogueChangeDetail, termDomainInfo } from '@/lib/catalogue'
import { formatCount, formatDay, kindNames, type LibraryRow } from '@/lib/library'
import type { LibrarySearch } from '@/lib/search-params'
import {
  activeIssueRows,
  domainSourceText,
  newestRows,
  readChip,
  sourceNames,
  sourceStateText,
  termTool,
  termListSearch,
  termNote,
  usedWith,
  valueTypeText,
  type TermOwner,
  type TermTab,
} from '@/lib/term-page'
import { addValuesSearch } from '@/lib/sources'
import { showToast } from '@/lib/toast'
import { useLibrary } from '@/lib/use-library'
import { usePermissions } from '@/lib/use-session'
import { CatalogueStatusBadge, TermDomainBadge } from './catalogue-marks'
import { ShelfCard } from './shelf-card'
import { TermItems } from './term-items'
import { productName } from '@/lib/brand'

/*
  The parts of a term that the metric page and the catalogue's docked panel both show (design
  round 3, direction A): what the library holds about it, its newest context and the items that
  only mention it, where it comes from in the source and who looks after it, and the one action group. The
  panel opens dimensions too; a dimension has no single library list (an item names one of its
  values), so the parts that link to "every item about it" are a metric's only, and a dimension
  lists its values instead.
*/

/** How many items the Context tab and its Also mentioned list show before the way to all of them. */
const CONTEXT_ROWS = 10
const listFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })
const MENTION_ROWS = 5

const linkClass =
  'min-w-0 underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring'

export function copy(text: string, what: string) {
  void navigator.clipboard
    ?.writeText(text)
    .then(() => showToast(`${what} copied`))
    .catch(() => undefined)
}

/** The library's list of every item about a term: a metric has one; a dimension does not. */
export function termLibraryList(
  term: Pick<CatalogueTermDetail, 'kind' | 'id'>,
): LibrarySearch | null {
  return term.kind === 'metric' ? termListSearch(term) : null
}

/** What every surface of a term reads about it: its domain, owner, issues, note and read chip. */
export function useTermFacts(term: CatalogueTermDetail) {
  const library = useLibrary()
  const { data: areas = [] } = useQuery(areasQuery())
  const { data: people = [] } = useQuery(peopleQuery())
  const domain = termDomainInfo(term, areas)
  const area = areas.find((candidate) => candidate.id === term.domain.areaId) ?? null
  const person = (personId: string | null) =>
    personId ? (people.find((candidate) => candidate.id === personId) ?? null) : null
  const [first = null, ...rest] = area?.ownerIds ?? []
  const owner: TermOwner = {
    area,
    person: person(first),
    others: rest.flatMap((id) => {
      const found = person(id)
      return found ? [found] : []
    }),
  }
  const issues = useMemo(() => activeIssueRows(library.rows, term.key), [library.rows, term.key])
  return {
    library,
    domain,
    owner,
    issues,
    note: termNote(term, { owner, issues }),
    chip: readChip(term),
  }
}

export type TermFacts = ReturnType<typeof useTermFacts>

/**
 * The term's action group: Add context about it and Show all of its items (a metric's), and the
 * menu with Copy link, Copy the name in the source and Suggest a name. In the panel Add context is
 * the filled button and there is no menu: the Source tab copies that name, and the page (expand)
 * has the rest.
 */
export function TermActions({
  term,
  panel = false,
}: {
  term: CatalogueTermDetail
  panel?: boolean
}) {
  const list = termLibraryList(term)
  const { isAdmin } = usePermissions()
  // An administrator adds a dimension's values at any time, through its source's page.
  const sourceId = term.definition?.sourceId ?? term.source?.id
  return (
    <div
      data-slot="term-actions"
      className={
        panel
          ? 'flex w-full flex-wrap items-center gap-2'
          : 'flex flex-wrap items-center gap-2 @5xl:shrink-0'
      }
    >
      {term.kind === 'metric' ? (
        <Button
          variant={panel ? 'default' : 'outline'}
          render={<Link to="/library/new" search={{ metric: term.id }} />}
          // The panel's title names the term just above, so its footer fits on one line.
          aria-label={panel ? `Add a fact about ${term.name}` : undefined}
        >
          <PlusIcon />
          {panel ? 'Add a fact' : `Add a fact about ${term.name}`}
        </Button>
      ) : null}
      {term.kind === 'dimension' && isAdmin && sourceId ? (
        <Button
          variant="outline"
          render={<Link to="/admin" search={addValuesSearch(sourceId, term.key)} />}
          aria-label={`Add values of ${term.name}`}
        >
          <ListPlusIcon />
          Values
        </Button>
      ) : null}
      {list && term.shelf.items > 0 ? (
        <Button variant="outline" render={<Link to="/library" search={list} />}>
          <LibraryBigIcon />
          Show all {formatCount(term.shelf.items)}
        </Button>
      ) : null}
      {panel ? null : (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="icon" aria-label="More actions" />}
          >
            <EllipsisIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-popover">
            <DropdownMenuItem onClick={() => copy(window.location.href, 'Link')}>
              <LinkIcon />
              Copy link
            </DropdownMenuItem>
            {term.definitions.length ? (
              <DropdownMenuItem
                onClick={() =>
                  copy(
                    sourceNames(term).join('\n'),
                    `${termTool(term)} ${term.definitions.length > 1 ? 'names' : 'name'}`,
                  )
                }
              >
                <CopyIcon />
                Copy {termTool(term)} {term.definitions.length > 1 ? 'names' : 'name'}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem render={<Link to="/catalogue/suggest" />}>
              <PlusIcon />
              Suggest a name
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export const termTabNames: Record<TermTab, string> = {
  overview: 'Overview',
  context: 'Context',
  source: 'Source',
}

/**
 * The Overview, Context and Source tabs' contents, as `TabsContent` panels. `shelf` puts On the
 * shelf first in Overview, where there is no rail beside the tabs (the panel).
 */
export function TermTabPanels({
  term,
  facts,
  shelf = false,
  headingLevel = 2,
  highlight,
  className,
}: {
  term: CatalogueTermDetail
  facts: TermFacts
  shelf?: boolean
  /** A dimension's value to pick out in its Values list, by id (a value chip's link). */
  highlight?: string
  /** h3 in the docked panel, whose title is the h2. */
  headingLevel?: 2 | 3
  className: string
}) {
  const { library } = facts
  return (
    <>
      <TabsContent value="overview" className={className}>
        {shelf ? <ShelfCard term={term} headingLevel={headingLevel} /> : null}
        <Overview
          term={term}
          highlight={highlight}
          issues={facts.issues}
          owner={facts.owner}
          rows={library.rows}
          level={headingLevel}
        />
      </TabsContent>
      <TabsContent value="context" className={className}>
        <Section title={`Context about ${term.name}`} icon={LibraryBigIcon} level={headingLevel}>
          <ContextList term={term} rows={library.rows} pending={library.pending} />
          <AlsoMentioned term={term} level={headingLevel} />
        </Section>
      </TabsContent>
      <TabsContent value="source" className={className}>
        <Section title="Where it comes from" icon={DatabaseIcon} level={headingLevel}>
          <SourceFields term={term} domain={facts.domain} owner={facts.owner} />
        </Section>
      </TabsContent>
    </>
  )
}

function Quiet({ children }: { children: string }) {
  return (
    <Badge form="bare" quiet icon={HeedAcceptedIcon}>
      {children}
    </Badge>
  )
}

function Overview({
  term,
  highlight,
  issues,
  owner,
  rows,
  level,
}: {
  term: CatalogueTermDetail
  highlight?: string
  issues: LibraryRow[]
  owner: TermOwner
  rows: LibraryRow[]
  level: 2 | 3
}) {
  const { shelf, name } = term
  const list = termLibraryList(term)
  // The people who look after a domain work on gaps in the Workbench; everyone else on Gaps.
  const inWorkbench = usePermissions().isFor('quality')
  const { data: vocabulary } = useQuery(vocabularyQuery())
  const values = useMemo(
    () =>
      usedWith(
        rows,
        term.key,
        (dimension) =>
          vocabulary?.dimensions.find((candidate) => candidate.id === dimension)?.name ?? dimension,
      ),
    [rows, term.key, vocabulary],
  )
  const who = owner.person?.name ?? (owner.area ? `The owner of ${owner.area.name}` : null)
  const needs = `${shelf.needsALook.toLocaleString('en')} ${shelf.needsALook === 1 ? 'needs' : 'need'} a look`
  return (
    <>
      <Section title="What the library holds" icon={LibraryBigIcon} level={level}>
        <FieldTable label={`What the library holds about ${name}`} wideLabels>
          <FieldRow
            icon={LibraryBigIcon}
            label="Context"
            hint={
              shelf.items === 0
                ? `Nothing yet. AI apps have nothing to add when someone asks about ${name}.`
                : shelf.ended > 0
                  ? `${shelf.ended.toLocaleString('en')} ${shelf.ended === 1 ? 'has' : 'have'} ended and ${shelf.ended === 1 ? 'stays' : 'stay'} in service for ${shelf.ended === 1 ? 'its' : 'their'} period.`
                  : `Accepted facts that apply to ${name}.`
            }
          >
            <span>
              <span className="font-bold tabular-nums">{shelf.items.toLocaleString('en')}</span>{' '}
              {shelf.items === 1 ? 'fact' : 'facts'}
            </span>
          </FieldRow>
          <FieldRow
            icon={CircleDashedIcon}
            label="Needs checking"
            hint={
              shelf.needsALook > 0
                ? `A check is due, or a source changed or went missing.${who ? ` ${who} checks each one.` : ''}`
                : 'Every fact is within its check date and its sources are in place.'
            }
          >
            {shelf.needsALook > 0 ? (
              list ? (
                <Badge
                  form="soft"
                  tone="warning"
                  icon={EyeIcon}
                  className="hover:bg-status-warning-bg focus-visible:outline-2 focus-visible:outline-ring"
                  render={<Link to="/library" search={{ ...list, view: 'attention' }} />}
                >
                  {needs}
                </Badge>
              ) : (
                <Badge form="soft" tone="warning" icon={EyeIcon}>
                  {needs}
                </Badge>
              )
            ) : (
              <Quiet>None</Quiet>
            )}
          </FieldRow>
          <FieldRow
            icon={HeedIssueIcon}
            label="Active issues"
            hint={
              shelf.activeIssues > 0
                ? `AI apps warn about ${shelf.activeIssues === 1 ? 'it' : 'them'} in answers that touch ${name}.`
                : undefined
            }
          >
            {shelf.activeIssues > 0 ? (
              <>
                <CatalogueStatusBadge status="active_issues" activeIssues={shelf.activeIssues} />
                <ul className="flex flex-col gap-2" aria-label="Active issues">
                  {issues.map((issue) => (
                    <li key={issue.id}>
                      <Link
                        to="/library/$itemId"
                        params={{ itemId: issue.id }}
                        className={`${linkClass} font-bold`}
                      >
                        {issue.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <Quiet>None</Quiet>
            )}
          </FieldRow>
          <FieldRow
            icon={CircleHelpIcon}
            label="Gaps"
            hint={`Questions about ${name} that the library couldn't answer.`}
          >
            {shelf.gaps > 0 ? (
              <Link
                {...(inWorkbench
                  ? { to: '/health', search: { view: 'gaps', status: 'open' } }
                  : { to: '/gaps' })}
                className={`${linkClass} font-bold`}
              >
                {shelf.gaps.toLocaleString('en')} open
              </Link>
            ) : (
              <Quiet>None open</Quiet>
            )}
          </FieldRow>
          <FieldRow
            icon={AtSignIcon}
            label="Mentioned by"
            hint={`Facts whose text mentions ${name}.`}
          >
            <span>
              <span className="font-bold tabular-nums">
                {shelf.mentionedBy.toLocaleString('en')}
              </span>{' '}
              {shelf.mentionedBy === 1 ? 'fact' : 'facts'}
            </span>
          </FieldRow>
          <FieldRow
            icon={CalendarClockIcon}
            label="Last updated"
            hint="The newest change to a fact about it."
          >
            {shelf.lastUpdated ? (
              <span className="tabular-nums">{formatDay(shelf.lastUpdated, 'long')}</span>
            ) : (
              <span className="text-muted-foreground">Never</span>
            )}
          </FieldRow>
        </FieldTable>
      </Section>
      {term.kind === 'dimension' ? (
        <Section title="Values" icon={ListIcon} level={level}>
          <DimensionValues term={term} highlight={highlight} />
        </Section>
      ) : null}
      {term.kind === 'metric' && values.length > 0 ? (
        <Section title="Often used with" icon={TargetIcon} level={level}>
          <ul className="flex flex-wrap gap-2" aria-label={`Values often used with ${name}`}>
            {values.map((value) => (
              <li key={value.about}>
                <Badge
                  form="outline"
                  title={`Show every fact about ${value.value}`}
                  className="hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                  render={<Link to="/library" search={{ about: value.about }} />}
                >
                  <span className="text-muted-foreground">{value.dimension}</span>{' '}
                  <span className="font-bold">{value.value}</span>{' '}
                  <span className="text-muted-foreground tabular-nums">{value.count}</span>
                </Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  )
}

const listClass =
  'flex flex-col overflow-hidden rounded-lg border bg-card text-dense [&>li+li]:border-t'

/** Values listed before the rest of a long dimension fold away. */
const VALUE_ROWS = 50

/**
 * A dimension's values (owners keep them in the vocabulary), each with the items about it and
 * the way to them: the library's list of one value (`about=market:poland`). A dimension can hold
 * thousands of values, so a long one shows its first fifty, those with items first, and the rest
 * on request. A value chip opens the page with its value picked out (`highlight`): the row is
 * marked, named the current one and scrolled into view, and the list unfolds if it was folded
 * away.
 */
function DimensionValues({ term, highlight }: { term: CatalogueTermDetail; highlight?: string }) {
  const [all, setAll] = useState(false)
  const folded = !all && term.values.length > VALUE_ROWS
  const firstRows = folded
    ? [
        ...term.values.filter((value) => value.items > 0),
        ...term.values.filter((value) => value.items === 0),
      ].slice(0, VALUE_ROWS)
    : term.values
  const shown =
    highlight && !firstRows.some((value) => value.id === highlight) ? term.values : firstRows
  const picked = useRef<HTMLLIElement>(null)
  const router = useRouter()
  useEffect(() => {
    if (!highlight) return
    const show = () => picked.current?.scrollIntoView({ block: 'center' })
    // The router restores the scroll once the page has rendered, so scroll after it does.
    const frame = requestAnimationFrame(show)
    const stop = router.subscribe('onRendered', () => requestAnimationFrame(show))
    return () => {
      cancelAnimationFrame(frame)
      stop()
    }
  }, [highlight, router])
  if (term.values.length === 0)
    return <p className="text-body text-muted-foreground">No values yet. An owner adds them.</p>
  return (
    <div className="flex flex-col gap-2">
      <ul className={listClass} aria-label={`Values of ${term.name}`}>
        {shown.map((value) => {
          const about = value.key.replace(/^val:/, '').replace('/', ':')
          const current = value.id === highlight
          return (
            <li
              key={value.key}
              ref={current ? picked : undefined}
              aria-current={current || undefined}
              data-highlighted={current || undefined}
              className="flex min-h-12 items-center gap-3 px-4 py-2 data-highlighted:bg-accent data-highlighted:outline-2 data-highlighted:-outline-offset-2 data-highlighted:outline-ring"
            >
              {value.items > 0 ? (
                <Link to="/library" search={{ about }} className={`${linkClass} flex-1 font-bold`}>
                  {value.name}
                </Link>
              ) : (
                <span className="min-w-0 flex-1 font-bold">{value.name}</span>
              )}
              {value.aliases.length > 0 ? (
                <span className="hidden min-w-0 truncate text-caption text-muted-foreground @md:block">
                  Also called {value.aliases.join(', ')}
                </span>
              ) : null}
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {formatCount(value.items)}
              </span>
            </li>
          )
        })}
      </ul>
      {shown.length < term.values.length ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => setAll(true)}>
            Show all {formatCount(term.values.length, 'value')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The items whose text only mentions the term, as a quiet list under its context, closed until
 * asked for. A mention is not scope (FR-131): agents do not get these items when someone asks
 * about the term, so the list says so and stays apart from the context above it. The list loads
 * when it opens.
 */
function AlsoMentioned({ term, level }: { term: CatalogueTermDetail; level: 2 | 3 }) {
  const Heading = level === 2 ? 'h3' : 'h4'
  const count = term.shelf.mentionedBy
  return (
    <Collapsible data-slot="also-mentioned" className="flex flex-col gap-3">
      <Heading className="text-dense">
        <CollapsibleTrigger className="group/fold inline-flex min-h-control-md items-center gap-2 rounded-md font-bold text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-control-touch">
          <ChevronDownIcon
            aria-hidden="true"
            className="size-icon-sm shrink-0 transition-transform group-data-panel-open/fold:rotate-180"
          />
          Also mentioned
          <span className="font-normal tabular-nums">{count.toLocaleString('en')}</span>
        </CollapsibleTrigger>
      </Heading>
      <CollapsibleContent className="flex flex-col gap-3">
        <p className="text-dense text-muted-foreground">
          These facts name {term.name} in their text. A mention isn't what a fact is about, so AI
          apps don't get a fact for its mention alone.
        </p>
        <MentionedIn term={term} />
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The newest items whose text mentions the term (`items.list` with `mentions`), and the count. */
function MentionedIn({ term }: { term: CatalogueTermDetail }) {
  const { data, isPending, isError, refetch } = useQuery(
    itemListQuery({ mentions: term.key, limit: MENTION_ROWS, sort: 'updated' }),
  )
  if (isPending)
    return (
      <div role="status" aria-label="Loading the mentions" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    )
  if (isError)
    return (
      <p className="flex flex-wrap items-center gap-3 text-body text-muted-foreground">
        The mentions couldn't load.
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </p>
    )
  if (data.total === 0)
    return (
      <p className="text-body text-muted-foreground">
        No fact mentions {term.name} yet. When a text names it with @, the fact shows here.
      </p>
    )
  return (
    <div className="flex flex-col gap-2">
      <ul className={listClass} aria-label={`Facts that mention ${term.name}`}>
        {data.rows.map((item) => {
          const Glyph = kindGlyphs[item.kind]
          return (
            <li key={item.id} className="flex min-h-12 items-center gap-3 px-4 py-2">
              <span className="flex w-column-version shrink-0 items-center gap-2 text-muted-foreground">
                <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
                {kindNames[item.kind]}
              </span>
              <span className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-2">
                {item.status === 'retired' ? (
                  <span className="min-w-0 text-muted-foreground">{item.title}</span>
                ) : (
                  <Link to="/library/$itemId" params={{ itemId: item.id }} className={linkClass}>
                    {item.title}
                  </Link>
                )}
                <MentionDomain areaId={item.areaId} />
              </span>
            </li>
          )
        })}
      </ul>
      {data.total > data.rows.length ? (
        <p className="text-caption text-muted-foreground">
          The {data.rows.length.toLocaleString('en')} newest of {data.total.toLocaleString('en')}.
        </p>
      ) : null}
    </div>
  )
}

function MentionDomain({ areaId }: { areaId: string }) {
  const { data: areas } = useQuery(areasQuery())
  const area = areas?.find((candidate) => candidate.id === areaId)
  return area ? <DomainBadge name={area.name} label={area.label} size="sm" /> : null
}

function ContextList({
  term,
  rows,
  pending,
}: {
  term: CatalogueTermDetail
  rows: LibraryRow[]
  pending: boolean
}) {
  const newest = useMemo(() => newestRows(rows, term.key, CONTEXT_ROWS), [rows, term.key])
  if (pending)
    return (
      <div role="status" aria-label="Loading the facts" className="flex flex-col gap-2">
        <Skeleton className="h-row-comfortable w-full" />
        <Skeleton className="h-row-comfortable w-full" />
      </div>
    )
  if (term.shelf.items === 0 || newest.length === 0)
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LibraryBigIcon />
          </EmptyMedia>
          <EmptyTitle>Nothing on the shelf yet</EmptyTitle>
          <EmptyDescription>
            No accepted fact is about {term.name}, so AI apps have nothing to add when someone asks
            about it.
          </EmptyDescription>
        </EmptyHeader>
        <Button
          variant="outline"
          render={
            <Link
              to="/library/new"
              search={term.kind === 'metric' ? { metric: term.id } : undefined}
            />
          }
        >
          <PlusIcon />
          Add a fact about {term.name}
        </Button>
      </Empty>
    )
  return (
    <TermItems
      name={term.name}
      rows={newest}
      total={term.shelf.items}
      search={termLibraryList(term) ?? undefined}
    />
  )
}

function SourceFields({
  term,
  domain,
  owner,
}: {
  term: CatalogueTermDetail
  domain: ReturnType<typeof termDomainInfo>
  owner: TermOwner
}) {
  const { definition, source } = term
  const tool = termTool(term)
  const type = valueTypeText(definition?.valueType ?? null)
  const kind = term.kind === 'metric' ? 'metric' : 'dimension'
  // A dimension in several views: its names, and its words and types where they differ.
  const several = term.definitions.length > 1
  const allViews =
    term.definitions.length === 2 ? 'both views' : `all ${term.definitions.length} views`
  const descriptions: { text: string | null; names: string[] }[] = []
  for (const member of term.definitions) {
    const same = descriptions.find((entry) => entry.text === member.descriptionCopy)
    if (same) same.names.push(member.name)
    else descriptions.push({ text: member.descriptionCopy, names: [member.name] })
  }
  const types = [
    ...new Set(term.definitions.map((member) => valueTypeText(member.valueType) ?? 'Not given')),
  ]
  return (
    <FieldTable label="Where it comes from" wideLabels>
      <FieldRow icon={DatabaseIcon} label="Source" hint={sourceStateText(term, source)}>
        {!definition ? (
          <Badge form="bare" quiet icon={Link2OffIcon}>
            Not linked
          </Badge>
        ) : definition.state === 'missing' ? (
          <CatalogueStatusBadge status="gone" tool={tool} />
        ) : source?.failing ? (
          <Badge form="soft" tone="warning" icon={CloudOffIcon}>
            Read failed
          </Badge>
        ) : definition.state === 'changed' ? (
          <CatalogueStatusBadge status="changed" tool={tool} changedAt={definition.changedAt} />
        ) : (
          <Quiet>In sync</Quiet>
        )}
      </FieldRow>
      {definition ? (
        <>
          {several ? (
            <FieldRow
              icon={HashIcon}
              label={`${tool} names`}
              hint={`One ${kind} in ${productName}, named in ${term.definitions.length} views of the ${tool} model. A change to one marks only the facts about metrics in its view.`}
            >
              <span className="inline-flex max-w-full items-start gap-1">
                <ul
                  aria-label={`${tool} names`}
                  data-slot="source-names"
                  className="flex min-w-0 flex-col font-mono text-caption"
                >
                  {term.definitions.map((member) => (
                    <li key={member.ref} className="truncate">
                      {member.name}
                    </li>
                  ))}
                </ul>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copy(sourceNames(term).join('\n'), `${tool} names`)}
                  aria-label={`Copy the ${tool} names`}
                >
                  <CopyIcon />
                </Button>
              </span>
            </FieldRow>
          ) : (
            <FieldRow
              icon={HashIcon}
              label={`${tool} name`}
              hint={`The name in the ${tool} model. Facts point at ${definition.ref}.`}
            >
              <span className="inline-flex max-w-full items-center gap-1">
                <span className="truncate font-mono text-caption">{definition.name}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => copy(definition.name, `${tool} name`)}
                  aria-label={`Copy the ${tool} name`}
                >
                  <CopyIcon />
                </Button>
              </span>
            </FieldRow>
          )}
          <FieldRow
            icon={TextAlignStartIcon}
            label="Description"
            hint={
              descriptions.length > 1
                ? `${tool} describes it differently in its views. Copies, at most 500 characters each, refreshed at every read. ${tool} owns them.`
                : several
                  ? `${tool} describes it the same in ${allViews}. A copy, at most 500 characters, refreshed at every read. ${tool} owns it.`
                  : `A copy of ${tool}'s description, at most 500 characters, refreshed at every read. ${tool} owns it.`
            }
          >
            {descriptions.length > 1 ? (
              <ul data-slot="description-copy" className="flex flex-col gap-2">
                {descriptions.map(({ text, names }) => (
                  <li key={names.join()} className="flex flex-col">
                    <span className={text ? undefined : 'text-muted-foreground'}>
                      {text ?? `No description in ${tool}.`}
                    </span>
                    <span className="font-mono text-caption text-muted-foreground">
                      {names.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span
                data-slot="description-copy"
                className={definition.descriptionCopy ? undefined : 'text-muted-foreground'}
              >
                {definition.descriptionCopy ?? `No description in ${tool}.`}
              </span>
            )}
          </FieldRow>
          <FieldRow
            icon={SigmaIcon}
            label="Type"
            hint={
              types.length > 1
                ? `${tool} returns different kinds of value in its views: ${types.join(', ')}.`
                : several
                  ? `The kind of value ${tool} returns, the same in ${allViews}.`
                  : `The kind of value ${tool} returns.`
            }
          >
            {type ?? <span className="text-muted-foreground">Not given</span>}
          </FieldRow>
          {term.modelFile?.url ? (
            <FieldRow
              icon={FileTextIcon}
              label="Model file"
              hint={
                several
                  ? `Where ${tool} defines ${definition.name}, with its calculation. ${productName} keeps no calculation.`
                  : `Where ${tool} defines it, with its calculation. ${productName} keeps no calculation.`
              }
            >
              <a
                href={term.modelFile.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-brand-ink underline underline-offset-4"
              >
                Open the model file
                <ExternalLinkIcon aria-hidden="true" className="size-icon-sm" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </FieldRow>
          ) : null}
        </>
      ) : null}
      <FieldRow icon={HeedDomainIcon} label="Domain" hint={domainSourceText(term)}>
        <TermDomainBadge name={domain.name} label={domain.label} none={domain.none} />
      </FieldRow>
      <FieldRow
        icon={UserRoundIcon}
        label={owner.area ? 'Owner' : 'Reviewed by'}
        hint={
          owner.others.length
            ? `${listFormat.format(owner.others.map((other) => other.name))} ${owner.others.length === 1 ? 'is an owner' : 'are owners'} too.`
            : owner.area
              ? undefined
              : `A ${kind} with no domain has no owner. An admin reviews changes to it.`
        }
      >
        {!owner.area ? (
          <span>Admins</span>
        ) : owner.person ? (
          <PersonPreview personId={owner.area.ownerIds[0] ?? ''}>
            <Owner
              name={owner.person.name}
              initials={owner.person.initials}
              size="lg"
              role={`Owner of ${owner.area.name}`}
            />
          </PersonPreview>
        ) : (
          <span className="text-muted-foreground">No owner</span>
        )}
      </FieldRow>
      {definition ? (
        <FieldRow
          icon={CalendarSyncIcon}
          label="Definition changed"
          hint={
            definition.changedAt
              ? `${catalogueChangeDetail(tool, definition.changedAt)}. Facts written before the change wait for a check.`
              : `${tool} hasn't changed it since it was first read.`
          }
        >
          {definition.changedAt ? (
            <span className="tabular-nums">{formatDay(definition.changedAt, 'long')}</span>
          ) : (
            <span className="text-muted-foreground">Not changed</span>
          )}
        </FieldRow>
      ) : null}
    </FieldTable>
  )
}
