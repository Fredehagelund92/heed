import * as React from 'react'
import type {
  RecordsAnswer,
  RecordsFound,
  RecordsKind,
  RecordsRow,
  RecordsSection,
} from '@domain/records-answer'
import type { RecordsParts } from '@/components/heed/records-parts'

// A records answer in Ask (FR-718): a question about the context's own records, counted from what
// the person may see. It has no answer state: a Records chip and one source sentence say where it
// comes from, then the answer in one plain sentence, and at most five rows with links, or a small
// table of counts. An analysis (FR-720) has up to four sections of them instead, the rule behind a
// ranking and what the read cannot see. Context keeps the full list. Loaded with the first records answer, so Ask's first
// load does not carry it; the parts it shares with Ask come from Ask itself (records-parts.ts), so
// loading it apart leaves Ask's own first load as it was.

const Parts = React.createContext<RecordsParts | null>(null)
const useParts = () => React.useContext(Parts)!

const link =
  'rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50'

/** The chip that says where the answer comes from: neutral, never an answer state's colour. */
function RecordsChip() {
  const { TableIcon } = useParts()
  return (
    <span className="flex h-6 w-fit items-center gap-1.5 rounded-md bg-muted px-2 text-xs font-medium">
      <TableIcon className="size-3.5 shrink-0" aria-hidden />
      Records
    </span>
  )
}

/** A context item by its title, opening in the right panel. */
function ItemLink({ id, title, className }: { id: string; title: string; className?: string }) {
  const { openDock, cn } = useParts()
  return (
    <button
      type="button"
      onClick={() => openDock('context', id)}
      className={cn(link, 'text-left', className)}
    >
      {title}
    </button>
  )
}

/** A context item's kind as its icon, named for a screen reader as the row's first word. */
function KindGlyph({ kind }: { kind: RecordsKind }) {
  const { kindIcons, kindLabel } = useParts()
  const Icon = kindIcons[kind]
  return (
    <Icon
      role="img"
      aria-label={kindLabel[kind]}
      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      strokeWidth={1.75}
    />
  )
}

/** Where a list lives, as an address. */
function moreTo(
  more: NonNullable<RecordsFound['more']>,
  href: ReturnType<typeof useParts>['href'],
) {
  return more.to === 'context'
    ? href('/context', {
        domain: more.domain ?? undefined,
        due: more.status === 'due' ? '1' : undefined,
        status: more.status === 'archived' ? 'archived' : undefined,
        show: more.status === 'conflicts' ? 'conflicts' : undefined,
      })
    : more.to === 'inbox'
      ? '/inbox'
      : more.to === 'definitions'
        ? more.page
          ? `/definitions/${encodeURIComponent(more.page)}`
          : href('/definitions', { domain: more.domain ?? undefined })
        : `/settings/domains/${more.domain}`
}

/**
 * Where a row leads: a context item, a domain's page, a term's page in Definitions, a conflict's
 * own page, or the Not found card open on a topic.
 */
function RowName({ row }: { row: RecordsRow }) {
  const { href, cn } = useParts()
  if (row.type === 'pair')
    return (
      <span className="min-w-0">
        <ItemLink id={row.holder.id} title={row.holder.title} className="text-foreground" />
        <span className="text-muted-foreground"> and </span>
        <ItemLink id={row.other.id} title={row.other.title} className="text-foreground" />
      </span>
    )
  if (row.type === 'member') return <span>{row.name}</span>
  if (row.type === 'line')
    return row.more ? (
      <a href={moreTo(row.more, href)} className={cn(link, 'text-foreground')}>
        {row.label}
      </a>
    ) : (
      <span>{row.label}</span>
    )
  if (row.type === 'item')
    return (
      <span className="flex min-w-0 items-start gap-2">
        <KindGlyph kind={row.kind} />
        <ItemLink id={row.id} title={row.title} className="min-w-0 text-foreground" />
      </span>
    )
  if (row.type === 'area')
    return (
      <a href={`/settings/domains/${row.id}`} className={cn(link, 'text-foreground')}>
        {row.name}
      </a>
    )
  if (row.type === 'term')
    return (
      <a
        href={`/definitions/${encodeURIComponent(row.page)}`}
        className={cn(link, 'text-foreground')}
      >
        {row.name}
      </a>
    )
  if (row.type === 'conflict')
    return (
      <a href={`/context/conflicts/${row.key}`} className={cn(link, 'text-foreground')}>
        {row.holder.title}
        <span className="text-muted-foreground"> and </span>
        {row.other.title}
      </a>
    )
  if (row.type === 'topic')
    return (
      <span className="flex flex-wrap items-baseline gap-x-2">
        <span>{row.title}</span>
        {row.gap && (
          <a
            href={
              row.gap.draft
                ? href('/context/new', { gap: row.gap.draft })
                : href('/inbox', { card: row.gap.card })
            }
            className={cn(link, 'text-xs')}
          >
            {row.gap.draft ? 'Write it' : 'Open the card'}
            <span className="sr-only"> for {row.title}</span>
          </a>
        )}
      </span>
    )
  return <span className={cn(row.kind === null && 'font-medium')}>{row.label}</span>
}

const rowKey = (row: RecordsRow) =>
  row.type === 'item' || row.type === 'area'
    ? row.id
    : row.type === 'term' || row.type === 'conflict'
      ? row.key
      : row.type === 'topic'
        ? row.title
        : row.type === 'pair'
          ? `${row.holder.id}.${row.other.id}`
          : row.type === 'member'
            ? row.name
            : row.type === 'line'
              ? row.label
              : (row.kind ?? 'all')

/**
 * The rows: a small table where there is room, and on a narrow screen or in the right panel each
 * row stacked, its name first and then what each column says.
 */
function RecordsRows({ found }: { found: Pick<RecordsFound, 'columns' | 'rows'> }) {
  const { cn } = useParts()
  const [first, ...rest] = found.columns
  const counts = found.rows[0]?.type === 'kind' || found.rows[0]?.type === 'line'
  return (
    <div className="@container">
      <div
        className={cn(
          'hidden overflow-hidden rounded-surface border @lg:block',
          counts && 'w-fit min-w-96',
        )}
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="h-9 bg-muted/40 text-xs text-muted-foreground">
              <th scope="col" className="px-3 text-left font-normal">
                {first}
              </th>
              {rest.map((c) => (
                <th
                  key={c}
                  scope="col"
                  className={cn(
                    'px-3 font-normal whitespace-nowrap',
                    counts ? 'text-right' : 'text-left',
                  )}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {found.rows.map((row) => (
              <tr key={rowKey(row)} className="h-9 border-t">
                <th scope="row" className="px-3 py-1.5 text-left font-normal">
                  <RowName row={row} />
                </th>
                {row.cells.map((cell, i) => (
                  <td
                    key={i}
                    className={cn(
                      'px-3 py-1.5 whitespace-nowrap text-muted-foreground tabular-nums',
                      counts && 'text-right text-foreground',
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="overflow-hidden rounded-surface border text-sm @lg:hidden">
        {found.rows.map((row) => (
          <li
            key={rowKey(row)}
            className="flex min-h-11 flex-col justify-center gap-0.5 border-t px-3 py-2 first:border-t-0"
          >
            <RowName row={row} />
            {row.cells.length > 0 && (
              <span className="flex flex-wrap gap-x-3 text-xs text-muted-foreground tabular-nums">
                {row.cells.map((cell, i) => (
                  <span key={i}>{row.type === 'line' ? cell : `${rest[i]} ${cell}`}</span>
                ))}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Where the full list lives, with what the rows are of it. */
function More({ found }: { found: Pick<RecordsFound, 'more' | 'shown'> }) {
  const { href, cn, ArrowUpRightIcon } = useParts()
  const { more, shown } = found
  if (!more && !shown) return null
  const to = more ? moreTo(more, href) : null
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      {more && to && (
        <a href={to} className={cn(link, 'inline-flex items-center gap-0.5')}>
          {more.label}
          <ArrowUpRightIcon className="size-3.5" aria-hidden />
        </a>
      )}
      {shown && <span className="text-xs text-muted-foreground">{shown}</span>}
    </p>
  )
}

/** One part of an analysis: what it counts with its denominator, its rows and where the rest is. */
function RecordsPart({ section }: { section: RecordsSection }) {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-sm font-medium text-pretty">
        {section.title}: <span className="font-normal tabular-nums">{section.count}</span>
      </h3>
      {section.rows.length > 0 && <RecordsRows found={section} />}
      <More found={section} />
    </section>
  )
}

export function RecordsAnswerBody({
  parts,
  ...props
}: {
  parts: RecordsParts
  records: RecordsAnswer
  onSettled?: () => void
}) {
  return (
    <Parts.Provider value={parts}>
      <RecordsBody {...props} />
    </Parts.Provider>
  )
}

function RecordsBody({
  records,
  onSettled,
}: {
  records: RecordsAnswer
  /** Told once it is shown: a records answer is written at once, never word by word. */
  onSettled?: () => void
}) {
  const { SearchIcon, TableIcon } = useParts()
  const settled = React.useRef(onSettled)
  React.useEffect(() => {
    settled.current?.()
  }, [])
  if (records.refused)
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <SearchIcon className="size-3.5 shrink-0" aria-hidden />
          Nothing was looked up
        </p>
        <p className="text-base font-semibold">{records.sentence}</p>
        <p className="text-sm text-muted-foreground">{records.detail}</p>
      </div>
    )
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>
          Understood as{' '}
          <span className="font-medium text-foreground">
            {records.understood}
            {records.period && ` (${records.period.label})`}
          </span>
        </p>
        <p className="flex items-center gap-1.5">
          <TableIcon className="size-3.5 shrink-0" aria-hidden />
          {records.read}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <RecordsChip />
        <p className="text-sm text-muted-foreground">Counted from the workspace&apos;s records.</p>
      </div>
      {records.limit && (
        <p data-answer-limit className="text-base font-medium text-pretty">
          {records.limit.sentence}
        </p>
      )}
      <p className="text-base font-semibold text-pretty">{records.sentence}</p>
      {records.period?.assumed && (
        <p className="-mt-1.5 text-sm text-muted-foreground">
          The question named no period, so this is the last 7 days.
        </p>
      )}
      {records.detail && (
        <p className="text-sm text-muted-foreground">
          {records.detail}
          {records.detailItem && (
            <>
              {' '}
              <ItemLink id={records.detailItem.id} title={records.detailItem.title} />.
            </>
          )}
        </p>
      )}
      {records.rows.length > 0 && <RecordsRows found={records} />}
      <More found={records} />
      {records.sections && (
        <div className="mt-1 flex flex-col gap-5">
          {records.sections.map((section) => (
            <RecordsPart key={section.title} section={section} />
          ))}
        </div>
      )}
      {records.clear?.map((line) => (
        <p key={line} className="text-sm text-muted-foreground">
          {line}
        </p>
      ))}
      {records.ranked && <p className="text-sm">{records.ranked}</p>}
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        {records.note && <p>{records.note}</p>}
        {records.notSeen && <p>{records.notSeen}</p>}
        <p>Agents did not read this answer. It says nothing about what they get.</p>
      </div>
    </div>
  )
}
