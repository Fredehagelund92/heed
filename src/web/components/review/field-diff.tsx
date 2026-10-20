import { createContext, Fragment, useContext, type ReactNode } from 'react'
import type { Area, ClaimLevel, ItemKind, RiskLevel } from '@domain/item'
import { audienceSchema, claimLevels, itemKinds, riskLevels } from '@domain/item'
import type { FieldMark, MarkedField, Provenance } from '@domain/provenance'
import { ownCaveat } from '@domain/proposal-rules'
import {
  ChevronRightIcon,
  CircleSlashIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GitCompareArrowsIcon,
  HeedDomainIcon,
  HeedRiskIcon,
  HeedValidUntilIcon,
  LinkIcon,
  MinusIcon,
  PlusIcon,
  QuoteIcon,
  ScaleIcon,
  ShapesIcon,
  SigmaIcon,
  SplitIcon,
  TargetIcon,
  TextAlignStartIcon,
  TypeIcon,
  UserRoundIcon,
  UsersIcon,
  type Icon,
} from '@/components/icons'
import { AudienceBadge, ClaimBadge, RiskBadge } from '@/components/item/fact-badges'
import { DomainBadge, KindBadge } from '@/components/item/item-marks'
import { LinkedMentionChip } from '@/components/mentions/mention-text'
import { previewRender } from '@/components/preview/preview-link'
import { webLink } from '@/components/proposal/proposal-fields'
import { EditionLabel } from '@/components/proposal/edition-label'
import { ProvenanceFlagBadge, ProvenanceMark } from '@/components/proposal/provenance-mark'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  changedWords,
  chipDiff,
  diffRowNames,
  diffRows,
  emptySide,
  evidenceOf,
  rangeDiff,
  scopeKeysOf,
  side,
  sourceMarks,
  technicalRowIds,
  textOf,
  unchangedRowNames,
  windowOf,
  wordDiff,
  type DiffKind,
  type DiffRow,
  type DiffRowId,
  type EvidenceValue,
  type RangeBar,
  type SourceMark,
  type WordPart,
} from '@/lib/field-diff'
import { formatDay } from '@/lib/library'
import type { MentionOption } from '@/lib/mention-targets'
import { previewTargetOf } from '@/lib/preview'
import { cn } from '@/lib/utils'
import '@/components/proposal/ai-mark.css'

/*
  FieldDiff (frame C2, 2; FR-209): one row per changed field, the live version on the left and
  the proposed one on the right, in the form's order. Words that changed are underlined when
  added and struck when removed, as well as tinted; scope is a chip diff, dates are two bars on
  one scale with the last day, evidence is a quote block, risk is a before and after. Fields the
  change leaves alone fold into one line. A new item has one column: everything is proposed.
  On a narrow column the two sides stack, live above proposed.
*/

export type DiffLookups = {
  targets: ReadonlyMap<string, MentionOption>
  areas: readonly Area[]
  nameOf: (id: string) => string | null
  /**
   * The name of the deleted domain the version before names, which no list holds: a rescue's
   * (FR-814), restored from the Bin into another domain.
   */
  deletedDomain?: string
}

const rowIcons: Record<DiffRowId, Icon> = {
  title: TypeIcon,
  summary: TextAlignStartIcon,
  kind: ShapesIcon,
  scope: TargetIcon,
  validity: HeedValidUntilIcon,
  evidence: QuoteIcon,
  domain: HeedDomainIcon,
  owner: UserRoundIcon,
  claim: ScaleIcon,
  risk: HeedRiskIcon,
  audience: UsersIcon,
  notToConclude: CircleSlashIcon,
  body: FileTextIcon,
  replaces: GitCompareArrowsIcon,
  conflicts: GitCompareArrowsIcon,
  references: LinkIcon,
  marks: SigmaIcon,
  status: GitCompareArrowsIcon,
}

/** The draft field a row shows, for its mark (FR-121); a retirement's status has none. */
const rowFields: Record<DiffRowId, MarkedField | null> = {
  title: 'title',
  summary: 'summary',
  kind: 'kind',
  scope: 'scope',
  validity: 'validity',
  evidence: 'evidence',
  domain: 'areaId',
  owner: 'ownerId',
  claim: 'claimLevel',
  risk: 'riskLevel',
  audience: 'audience',
  notToConclude: 'notToConclude',
  body: 'body',
  replaces: 'replaces',
  conflicts: 'conflicts',
  references: 'references',
  marks: 'changeMarks',
  status: null,
}

/** The mark of a row's field (FR-121), for the glyph beside its name and the line. */
export const rowMark = (id: DiffRowId, provenance: Provenance | null) => {
  const field = rowFields[id]
  return field && provenance ? (provenance.fields[field] ?? null) : null
}

/**
 * The marks of the rows a diff shows, for the summary line's counts: the same rows FieldDiff
 * draws, so the line counts the glyphs the owner sees.
 */
export function shownMarks(
  diff: readonly { field: string; before: unknown; after: unknown }[],
  change: boolean,
  provenance: Provenance,
): FieldMark[] {
  const rows = diffRows(diff).rows.filter((row) => !technicalRowIds.includes(row.id))
  return (change ? rows : rows.filter((row) => !emptySide(row, 'after')))
    .map((row) => rowMark(row.id, provenance))
    .filter((mark): mark is FieldMark => mark !== null)
}

/** The flags of a row's words, under its value: they ask for a look, so they keep their badge. */
function RowFlags({ id, provenance }: { id: DiffRowId; provenance: Provenance }) {
  const field = rowFields[id]
  const flags = provenance.flags.filter((flag) => flag.field === field)
  if (!flags.length) return null
  return (
    <span className="flex flex-wrap items-center gap-1" data-slot="row-provenance">
      {flags.map((flag) => (
        <ProvenanceFlagBadge key={flag.code} flag={flag} />
      ))}
    </span>
  )
}

const diffTone: Record<Exclude<DiffKind, 'same'>, 'success' | 'danger'> = {
  added: 'success',
  removed: 'danger',
}

/** Words with what changed marked: underlined when added, struck when removed, both tinted. */
export function DiffWords({
  parts,
  targets,
}: {
  parts: readonly WordPart[]
  targets: ReadonlyMap<string, MentionOption>
}) {
  return parts.map((part, index) => {
    const content =
      part.type === 'text' ? (
        part.text
      ) : (
        <LinkedMentionChip
          targetKey={part.target}
          label={part.label}
          option={targets.get(part.target)}
        />
      )
    if (part.kind === 'same') return <Fragment key={index}>{content}</Fragment>
    const Mark = part.kind === 'added' ? 'ins' : 'del'
    return (
      <Mark
        key={index}
        data-diff={part.kind}
        data-tone={diffTone[part.kind]}
        className={cn(
          'rounded-sm bg-tone-tint text-tone-ink decoration-tone-dot underline-offset-4',
          part.kind === 'added' ? 'underline' : 'line-through',
        )}
      >
        <span className="sr-only">{part.kind === 'added' ? '[added: ' : '[removed: '}</span>
        {content}
        <span className="sr-only">]</span>
      </Mark>
    )
  })
}

/** A changed text: the old words with what went, or the new ones with what came. */
export function TextSide({
  before,
  after,
  which,
  targets,
  prose = false,
}: {
  before: string
  after: string
  which: 'before' | 'after'
  targets: ReadonlyMap<string, MentionOption>
  prose?: boolean
}) {
  const text = which === 'before' ? before : after
  if (!text.trim()) return <Empty />
  const parts = side(wordDiff(before, after), which)
  return (
    <p
      className={cn(
        'max-w-prose text-body break-words',
        prose && 'whitespace-pre-line',
        // The chips inside the text keep the line box (mention-chip.tsx).
        'leading-relaxed',
      )}
    >
      <DiffWords parts={parts} targets={targets} />
    </p>
  )
}

function Empty({ children = 'Not filled in' }: { children?: ReactNode }) {
  return <span className="text-dense text-muted-foreground">{children}</span>
}

/**
 * A scope chip as the form shows it: a sigma and the name, the dimension and the value, or the
 * dimension and "any value".
 */
export function ScopeChip({
  scopeKey,
  kind = 'same',
  targets,
}: {
  scopeKey: string
  kind?: DiffKind
  targets: ReadonlyMap<string, MentionOption>
}) {
  const option = targets.get(scopeKey)
  const metric = scopeKey.startsWith('metric:') || scopeKey.startsWith('group:')
  const anyValue = scopeKey.startsWith('dim:')
  const changed = kind !== 'same'
  // A term chip opens its catalogue page and previews it; a metric group has no page.
  const preview = previewTargetOf(scopeKey)
  return (
    <Badge
      render={preview ? previewRender(preview) : undefined}
      form={changed ? 'soft' : 'outline'}
      tone={changed ? diffTone[kind] : 'neutral'}
      icon={
        kind === 'added'
          ? PlusIcon
          : kind === 'removed'
            ? MinusIcon
            : metric
              ? SigmaIcon
              : anyValue
                ? SplitIcon
                : undefined
      }
      data-diff={changed ? kind : undefined}
      className={cn(
        kind === 'removed' && '[&_[data-slot=badge-label]]:line-through',
        preview && 'focus-visible:outline-2 focus-visible:outline-ring',
        preview && !changed && 'hover:bg-accent',
      )}
    >
      <span className="sr-only">
        {changed ? `${kind === 'added' ? 'Added' : 'Removed'}: ` : ''}
      </span>
      {metric ? (
        (option?.name ?? scopeKey)
      ) : anyValue ? (
        <>
          <span className="opacity-80">{option?.name ?? scopeKey}</span>{' '}
          <span className="font-bold">any value</span>
        </>
      ) : (
        <>
          {option?.detail ? <span className="opacity-80">{option.detail}</span> : null}{' '}
          <span className="font-bold">{option?.name ?? scopeKey}</span>
        </>
      )}
    </Badge>
  )
}

/** Scope as chips: what stays, what is removed and what is added (ChipDiff). */
export function ChipDiff({
  before,
  after,
  which,
  targets,
}: {
  before: readonly string[]
  after: readonly string[]
  which: 'before' | 'after'
  targets: ReadonlyMap<string, MentionOption>
}) {
  const diff = chipDiff(before, after)
  const chips = which === 'before' ? diff.before : diff.after
  return (
    <div className="flex flex-col gap-2">
      {chips.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Where it applies">
          {chips.map((chip) => (
            <li key={chip.key}>
              <ScopeChip scopeKey={chip.key} kind={chip.kind} targets={targets} />
            </li>
          ))}
        </ul>
      ) : (
        <Empty />
      )}
      {which === 'after' && before.length && (diff.added || diff.removed) ? (
        <span className="text-caption text-muted-foreground tabular-nums">
          {diff.added} added, {diff.removed} removed
        </span>
      ) : null}
    </div>
  )
}

/** The words for a range: "From 15 Jun 2026 to 2 Sep 2026 (last day)", an issue's own words. */
export function rangeWords(bar: RangeBar, issue: boolean): ReactNode {
  const start = formatDay(bar.start)
  if (issue)
    return bar.last ? (
      <>
        From {start} to <b className="font-bold">{formatDay(bar.last)}</b> (last day)
      </>
    ) : (
      `From ${start}, still going on`
    )
  return bar.last ? (
    <>
      From {start} to <b className="font-bold">{formatDay(bar.last)}</b> (last day)
    </>
  ) : (
    `From ${start}, no end date`
  )
}

/** One range as a bar on the shared scale; an open end fades out. */
function RangeTrack({ bar, label }: { bar: RangeBar; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      data-slot="range-track"
      className="relative h-2 w-full overflow-hidden rounded-full bg-muted"
    >
      <span
        data-slot="range-bar"
        data-open={bar.open || undefined}
        // Position on the shared scale: data, not styling (contract 3.3 allows a computed value).
        style={{ left: `${bar.left}%`, width: `${bar.width}%` }}
        // An open end fades out: a solid fill under the gradient would hide the fade.
        className={cn(
          'absolute inset-y-0 rounded-full',
          bar.open ? 'bg-linear-to-r from-foreground to-transparent' : 'bg-foreground',
        )}
      />
    </div>
  )
}

/**
 * The dates of both sides on one scale (RangeDiff), with the last day in words and the review
 * date under them. For an issue that gets an end date, one more sentence: it becomes history.
 */
function RangeSide({
  row,
  which,
  issue,
  review = true,
}: {
  row: DiffRow
  review?: boolean
  which: 'before' | 'after'
  issue: boolean
}) {
  const values = row[which]
  const otherValues = which === 'before' ? row.after : row.before
  // The validity may not have changed (only the review date did): both sides then share it.
  const own = windowOf(values.validity) ?? windowOf(otherValues.validity)
  if (!own) return <Empty />
  const beforeWindow = windowOf(row.before.validity) ?? windowOf(row.after.validity)
  const afterWindow = windowOf(row.after.validity) ?? beforeWindow
  const scale = afterWindow ? rangeDiff(beforeWindow, afterWindow) : null
  const bar = which === 'before' ? scale?.before : scale?.after
  const reviewDate =
    'reviewDate' in values
      ? values.reviewDate
      : 'reviewDate' in otherValues
        ? otherValues.reviewDate
        : undefined
  const becameHistory =
    which === 'after' &&
    issue &&
    beforeWindow?.end === null &&
    afterWindow?.end !== null &&
    afterWindow !== null &&
    bar?.last
  return (
    <div className="flex w-full flex-col gap-2">
      {bar ? (
        <RangeTrack
          bar={bar}
          label={`${which === 'before' ? (review ? 'Current' : 'Before') : review ? 'Proposed' : 'After'} dates`}
        />
      ) : null}
      {bar ? <p className="text-dense">{rangeWords(bar, issue)}</p> : null}
      {reviewDate !== undefined ? (
        <p className="text-caption text-muted-foreground">
          {typeof reviewDate === 'string'
            ? `Check again by ${formatDay(reviewDate)}`
            : 'No check date, because it ends'}
        </p>
      ) : null}
      {becameHistory && bar?.last ? (
        <p data-slot="issue-history" className="text-caption text-muted-foreground">
          It becomes history. AI apps get it only for questions about {formatDay(bar.start)} to{' '}
          {formatDay(bar.last)}.
        </p>
      ) : null}
    </div>
  )
}

/** Evidence as quote blocks: an added source tinted and marked, a removed one struck. */
function QuoteBlock({ source, kind }: { source: EvidenceValue; kind: DiffKind }) {
  const link = source.url ? webLink(source.url) : null
  const changed = kind !== 'same'
  return (
    <figure
      data-diff={changed ? kind : undefined}
      data-tone={changed ? diffTone[kind] : undefined}
      className={cn(
        'flex flex-col gap-1',
        changed && 'rounded-md border border-tone-line bg-tone-tint p-3 text-tone-ink',
      )}
    >
      {changed ? (
        <span className="sr-only">{kind === 'added' ? 'Added source:' : 'Removed source:'}</span>
      ) : null}
      <blockquote className={cn('text-body', kind === 'removed' && 'line-through')}>
        “{source.quote}”
      </blockquote>
      <figcaption className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
        {link ? (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand-ink underline underline-offset-4"
          >
            {link.host}
            <ExternalLinkIcon aria-hidden="true" className="size-icon-sm" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : source.url ? (
          <span className="break-all">{source.url}</span>
        ) : null}
        {source.date ? (
          <span className="tabular-nums">
            {link || source.url ? '· ' : ''}
            {formatDay(source.date)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  )
}

function EvidenceSide({ row, which }: { row: DiffRow; which: 'before' | 'after' }) {
  const before = evidenceOf(row.before.evidence)
  const after = evidenceOf(row.after.evidence)
  const key = (source: EvidenceValue) => `${source.url}\u0000${source.quote}`
  const keys = new Set((which === 'before' ? after : before).map(key))
  const own = which === 'before' ? before : after
  if (!own.length) return <Empty />
  return (
    <div className="flex flex-col gap-3">
      {own.map((source, index) => (
        <QuoteBlock
          key={`${key(source)}-${index}`}
          source={source}
          kind={keys.has(key(source)) ? 'same' : which === 'before' ? 'removed' : 'added'}
        />
      ))}
    </div>
  )
}

const asEnum = <T extends string>(values: readonly T[], value: unknown): T | null =>
  typeof value === 'string' && (values as readonly string[]).includes(value) ? (value as T) : null

/** One side of one row, drawn the way the form shows that field. */
function RowSide({
  row,
  which,
  lookups,
  issue,
  review = true,
}: {
  row: DiffRow
  review?: boolean
  which: 'before' | 'after'
  lookups: DiffLookups
  issue: boolean
}) {
  const values = row[which]
  const { targets, areas, nameOf } = lookups
  switch (row.id) {
    case 'title':
      return (
        <TextSide
          before={textOf(row.before, 'title', 'title')}
          after={textOf(row.after, 'title', 'title')}
          which={which}
          targets={targets}
        />
      )
    case 'notToConclude':
      // The stored default is no line of the proposer's own: it reads as not filled in (FR-104).
      return (
        <TextSide
          before={ownCaveat(textOf(row.before, row.id, row.id)) ?? ''}
          after={ownCaveat(textOf(row.after, row.id, row.id)) ?? ''}
          which={which}
          targets={targets}
        />
      )
    case 'summary':
      return (
        <TextSide
          before={textOf(row.before, 'summaryMarkup', 'summary')}
          after={textOf(row.after, 'summaryMarkup', 'summary')}
          which={which}
          targets={targets}
        />
      )
    case 'body':
      return (
        <TextSide
          before={textOf(row.before, 'bodyMarkup', 'body')}
          after={textOf(row.after, 'bodyMarkup', 'body')}
          which={which}
          targets={targets}
          prose
        />
      )
    case 'kind': {
      const kind = asEnum<ItemKind>(itemKinds, values.kind)
      return kind ? <KindBadge kind={kind} /> : <Empty />
    }
    case 'scope':
      return (
        <ChipDiff
          before={scopeKeysOf(row.before.scope) ?? []}
          after={scopeKeysOf(row.after.scope) ?? []}
          which={which}
          targets={targets}
        />
      )
    case 'validity':
      return <RangeSide row={row} which={which} issue={issue} review={review} />
    case 'evidence':
      return <EvidenceSide row={row} which={which} />
    case 'domain': {
      const area = areas.find((candidate) => candidate.id === values.areaId)
      if (area) return <DomainBadge name={area.name} label={area.label} />
      return which === 'before' && lookups.deletedDomain && values.areaId ? (
        <span className="text-body text-muted-foreground">{lookups.deletedDomain}, deleted</span>
      ) : (
        <Empty />
      )
    }
    case 'owner': {
      const name = typeof values.ownerId === 'string' ? nameOf(values.ownerId) : null
      return name ? <span className="text-body">{name}</span> : <Empty>Nobody named</Empty>
    }
    case 'claim': {
      const level =
        asEnum<ClaimLevel>(claimLevels, values.claimLevel) ??
        asEnum<ClaimLevel>(claimLevels, (which === 'before' ? row.after : row.before).claimLevel)
      const authority = typeof values.claimAuthority === 'string' ? values.claimAuthority : null
      const quote = typeof values.claimQuote === 'string' ? values.claimQuote : null
      return (
        <div className="flex flex-col gap-2">
          {level ? <ClaimBadge level={level} /> : <Empty />}
          {authority ? <span className="text-dense">Stated by {authority}</span> : null}
          {quote ? <blockquote className="text-dense">“{quote}”</blockquote> : null}
        </div>
      )
    }
    case 'risk': {
      const risk = asEnum<RiskLevel>(riskLevels, values.riskLevel)
      if (!risk) return <Empty />
      return (
        <div className="flex flex-col gap-1">
          <RiskBadge level={risk} form="bare" />
          {review && which === 'after' && risk === 'high' ? (
            <span className="text-caption text-muted-foreground">
              Needs the approver and the answer tests on the whole domain.
            </span>
          ) : null}
        </div>
      )
    }
    case 'audience': {
      const audience = audienceSchema.safeParse(values.audience)
      return audience.success ? <AudienceBadge audience={audience.data} /> : <Empty />
    }
    case 'status':
      return (
        <Badge form="bare" quiet={values.status !== 'retired'}>
          {values.status === 'retired'
            ? 'Archived. AI apps stop getting it'
            : 'Accepted. AI apps get it'}
        </Badge>
      )
    case 'replaces':
    case 'conflicts':
    case 'references':
    case 'marks': {
      const field = {
        replaces: 'replaces',
        conflicts: 'conflicts',
        references: 'references',
        marks: 'changeMarks',
      }[row.id]
      const list = (value: unknown): string[] =>
        Array.isArray(value)
          ? value.filter((entry): entry is string => typeof entry === 'string')
          : value && typeof value === 'object'
            ? Object.entries(value).map(([key, mark]) => `${key}: ${String(mark)}`)
            : []
      return (
        <ChipDiff
          before={list(row.before[field])}
          after={list(row.after[field])}
          which={which}
          targets={targets}
        />
      )
    }
  }
}

/** A row's words for a screen reader: "What happened: 9 words added, 0 removed." */
function rowSummary(row: DiffRow): string | null {
  if (row.id !== 'summary' && row.id !== 'body') return null
  const markup = row.id === 'summary' ? 'summaryMarkup' : 'bodyMarkup'
  const plain = row.id === 'summary' ? 'summary' : 'body'
  const { added, removed } = changedWords(
    wordDiff(textOf(row.before, markup, plain), textOf(row.after, markup, plain)),
  )
  return `${added} ${added === 1 ? 'word' : 'words'} added, ${removed} removed`
}

const cellBase = 'flex min-w-0 flex-col items-start gap-1 px-4 py-3'

/**
 * The frame every "What changed" shares (an item's fields, a term's): a card table with the field
 * names and one value column, or two side by side for a change (live and proposed). Below a 576
 * pixel container the columns stack, each value under its column's name, live above proposed.
 */
export function DiffTable({
  label,
  before,
  after,
  slot = 'field-diff',
  marked = false,
  children,
}: {
  /** The table's accessible name. */
  label: string
  /** The live column's name; null for one column (a new item or a new term). */
  before: string | null
  after: string
  slot?: string
  /** The rows carry provenance glyphs: the name column takes the wide label width for them. */
  marked?: boolean
  children: ReactNode
}) {
  const labelWidth = marked ? 'w-field-label-wide' : 'w-field-label'
  return (
    <div
      role="table"
      aria-label={label}
      data-slot={slot}
      data-columns={before === null ? 1 : 2}
      className="@container flex flex-col overflow-hidden rounded-lg border bg-card text-dense"
    >
      <div role="rowgroup">
        <div
          role="row"
          className="flex border-b bg-sidebar text-caption font-bold text-muted-foreground @max-xl:hidden"
        >
          <span role="columnheader" className={cn(cellBase, labelWidth, 'shrink-0')}>
            Field
          </span>
          {before !== null ? (
            <span role="columnheader" className={cn(cellBase, 'flex-1 border-l')}>
              {before}
            </span>
          ) : null}
          <span role="columnheader" className={cn(cellBase, 'flex-1 border-l')}>
            {after}
          </span>
        </div>
      </div>
      <DiffColumns.Provider value={{ before, after, label: labelWidth }}>
        <div role="rowgroup" className="flex flex-col [&>div+div]:border-t">
          {children}
        </div>
      </DiffColumns.Provider>
    </div>
  )
}

const DiffColumns = createContext<{ before: string | null; after: string; label: string }>({
  before: null,
  after: 'Proposed',
  label: 'w-field-label',
})

/** One field of a `DiffTable`: its name with an icon, then the live value and the proposed one. */
export function DiffTableRow({
  row,
  name,
  icon: Glyph,
  summary,
  mark,
  wrote = false,
  before,
  after,
}: {
  /** The row's id, for tests and screenshots (`data-row`). */
  row: string
  name: string
  icon: Icon
  /** What changed in words, for a screen reader: "9 words added, 0 removed". */
  summary?: string | null
  /** Where the field came from: the provenance glyph at the end of the name cell (6.13). */
  mark?: ReactNode
  /** An AI app or the assistant wrote the value: the row carries the line (`ai-mark`, 6.13). */
  wrote?: boolean
  /** The live value; leave it out in a one-column table. */
  before?: ReactNode
  after: ReactNode
}) {
  const columns = useContext(DiffColumns)
  return (
    <div
      role="row"
      data-slot="diff-row"
      data-row={row}
      data-wrote={wrote || undefined}
      className={cn('flex @max-xl:flex-col', wrote && 'ai-mark')}
    >
      <span
        role="rowheader"
        className={cn(
          cellBase,
          columns.label,
          'shrink-0 flex-row items-center gap-2 bg-sidebar text-muted-foreground @max-xl:w-full @max-xl:bg-transparent @max-xl:pb-0 @xl:items-start',
        )}
      >
        <Glyph aria-hidden="true" className="size-icon-sm shrink-0 @xl:translate-y-0.5" />
        <span className="font-bold @xl:font-normal">{name}</span>
        {summary ? <span className="sr-only">{`: ${summary}`}</span> : null}
        {mark ? (
          <span className="flex shrink-0 @xl:ml-auto @xl:-translate-y-0.5">{mark}</span>
        ) : null}
      </span>
      {columns.before !== null ? (
        <div role="cell" className={cn(cellBase, 'flex-1 @xl:border-l')}>
          <span className="text-caption text-muted-foreground @xl:sr-only">{columns.before}</span>
          {before}
        </div>
      ) : null}
      <div role="cell" className={cn(cellBase, 'flex-1 @xl:border-l')}>
        <span
          className={cn(
            'text-caption text-muted-foreground @xl:sr-only',
            // One column on a phone needs no column name under the field's.
            columns.before === null && 'sr-only',
          )}
        >
          {columns.after}
        </span>
        {after}
      </div>
    </div>
  )
}

/** The fold line under a diff: "3 fields stayed the same: kind, domain, owner". */
export function UnchangedFields({ names }: { names: readonly string[] }) {
  if (!names.length) return null
  return (
    <p className="flex items-start gap-2 px-1 text-caption text-muted-foreground">
      <ChevronRightIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
      {names.length} {names.length === 1 ? 'field stayed' : 'fields stayed'} the same:{' '}
      {names.join(', ')}
    </p>
  )
}

const markChangeWords: Record<Exclude<SourceMark['change'], 'same'>, string> = {
  added: 'New',
  removed: 'Removed',
  changed: 'New mark',
}

/**
 * References and their source marks, folded under the field diff (heed-ux A9): a reviewer rarely
 * reads them, and a mark is a long hash. Each is in the mono face with a copy button, so it can
 * be compared with the source tool without overflowing its line.
 */
function TechnicalDetails({ marks }: { marks: readonly SourceMark[] }) {
  return (
    <Collapsible className="flex flex-col gap-2" data-slot="technical-details">
      <CollapsibleTrigger className="group/technical flex w-fit items-center gap-2 rounded-sm px-1 text-caption text-muted-foreground hover:text-foreground">
        <ChevronRightIcon
          aria-hidden="true"
          className="size-icon-sm shrink-0 transition-transform group-data-panel-open/technical:rotate-90"
        />
        Technical details: {marks.length} {marks.length === 1 ? 'reference' : 'references'} and
        their source marks
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-2">
        {marks.length ? (
          <ul
            aria-label="References and their source marks"
            className="flex flex-col overflow-hidden rounded-lg border bg-card [&>li+li]:border-t"
          >
            {marks.map((entry) => (
              <li
                key={`${entry.change}:${entry.reference}`}
                data-change={entry.change === 'same' ? undefined : entry.change}
                className="flex min-w-0 flex-col gap-1 px-4 py-3"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-column-version shrink-0 text-caption text-muted-foreground">
                    Reference
                  </span>
                  <EditionLabel
                    label={entry.reference}
                    what="reference"
                    className={cn('flex-1', entry.change === 'removed' && 'line-through')}
                  />
                  {entry.change === 'same' ? null : (
                    <Badge
                      form="soft"
                      size="sm"
                      tone={entry.change === 'removed' ? 'danger' : 'success'}
                      className="shrink-0"
                    >
                      {markChangeWords[entry.change]}
                    </Badge>
                  )}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-column-version shrink-0 text-caption text-muted-foreground">
                    Source mark
                  </span>
                  {entry.mark ? (
                    <EditionLabel label={entry.mark} what="source mark" className="flex-1" />
                  ) : (
                    <Empty>None</Empty>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** A value the screen does not know how to draw, as stored. */
function StoredValue({ value }: { value: unknown }) {
  if (value === undefined || value === null) return <Empty>Not set</Empty>
  return <code className="text-caption break-all">{JSON.stringify(value)}</code>
}

/**
 * The field diff as a table: Field, the live version and the proposed one. `live` names the live
 * version's number ("Live version 1"); a new item has no live version and one column.
 */
export function FieldDiff({
  diff,
  lookups,
  issue,
  liveVersion,
  change,
  columns,
  provenance = null,
}: {
  diff: readonly { field: string; before: unknown; after: unknown }[]
  lookups: DiffLookups
  /** The proposal is an issue: an end date gets the "becomes history" sentence. */
  issue: boolean
  /** The live version's number, for a change to an accepted item. */
  liveVersion: number | null
  /** A change to an item in service: two columns. A new item: one. */
  change: boolean
  /** The two columns' names, when they are not the live and the proposed version. */
  columns?: { before: string; after: string }
  /** Where each field came from, when an AI app or the assistant wrote the draft (FR-121). */
  provenance?: Provenance | null
}) {
  const found = diffRows(diff)
  // A new item has nothing to compare with: its fields read as written, without marks.
  const all = change ? found.rows : found.rows.map((row) => ({ ...row, before: row.after }))
  // A new item shows the fields it sets; the ones the proposer left empty are named under it.
  const shown = all.filter((row) => !technicalRowIds.includes(row.id))
  const rows = change ? shown : shown.filter((row) => !emptySide(row, 'after'))
  const empty = change
    ? []
    : shown
        .filter((row) => emptySide(row, 'after'))
        .map((row) => diffRowNames[row.id].toLowerCase())
  const marks = sourceMarks(all, change)
  const unknown = found.unknown
  // A retirement changes the status only: what it leaves alone goes without saying.
  const unchanged =
    change && !diff.some((entry) => entry.field === 'status') ? unchangedRowNames(diff) : []
  const live =
    columns?.before ?? (liveVersion === null ? 'Current version' : `Current version ${liveVersion}`)
  const proposed =
    columns?.after ?? (liveVersion === null ? 'Proposed' : `Proposed version ${liveVersion + 1}`)
  if (!all.length && !unknown.length)
    return (
      <p className="rounded-lg border bg-card px-4 py-3 text-dense text-muted-foreground">
        Nothing changed. The proposal keeps the fact as it is.
      </p>
    )
  return (
    <div className="flex flex-col gap-3">
      {rows.length || unknown.length ? (
        <DiffTable
          label="What changed, field by field"
          before={change ? live : null}
          after={proposed}
          marked={Boolean(provenance)}
        >
          {rows.map((row) => {
            const mark = rowMark(row.id, provenance)
            return (
              <DiffTableRow
                key={row.id}
                row={row.id}
                name={diffRowNames[row.id]}
                icon={rowIcons[row.id]}
                summary={rowSummary(row)}
                mark={
                  provenance && mark ? (
                    <ProvenanceMark mark={mark} by={provenance.by} where="review" />
                  ) : null
                }
                wrote={mark === 'prefilled'}
                before={
                  change ? (
                    <RowSide row={row} which="before" lookups={lookups} issue={issue} />
                  ) : undefined
                }
                after={
                  <>
                    <RowSide row={row} which="after" lookups={lookups} issue={issue} />
                    {provenance ? <RowFlags id={row.id} provenance={provenance} /> : null}
                  </>
                }
              />
            )
          })}
          {/* A field the screen does not know still shows, so no change goes unseen. */}
          {unknown.map((entry) => (
            <DiffTableRow
              key={entry.field}
              row={entry.field}
              name={entry.field}
              icon={FileTextIcon}
              before={change ? <StoredValue value={entry.before} /> : undefined}
              after={<StoredValue value={entry.after} />}
            />
          ))}
        </DiffTable>
      ) : null}
      <UnchangedFields names={unchanged} />
      {empty.length ? (
        <p className="flex items-start gap-2 px-1 text-caption text-muted-foreground">
          <ChevronRightIcon aria-hidden="true" className="size-icon-sm shrink-0 translate-y-px" />
          Not filled in: {empty.join(', ')}
        </p>
      ) : null}
      {marks.length ? <TechnicalDetails marks={marks} /> : null}
    </div>
  )
}

/** Text mode (compare=text): the whole text, what happened and the longer explanation, marked. */
export function TextDiff({
  diff,
  targets,
  current,
}: {
  diff: readonly { field: string; before: unknown; after: unknown }[]
  targets: ReadonlyMap<string, MentionOption>
  /** The proposal's text as it is now, for the parts the change leaves alone. */
  current: { summary: string; body: string }
}) {
  const field = (name: string) => diff.find((entry) => entry.field === name)
  const pick = (markup: string, plain: string, which: 'before' | 'after', fallback: string) => {
    const entry = field(markup) ?? field(plain)
    const value = entry?.[which]
    return typeof value === 'string' ? value : entry ? '' : fallback
  }
  const parts = [
    {
      title: 'What happened',
      parts: wordDiff(
        pick('summaryMarkup', 'summary', 'before', current.summary),
        pick('summaryMarkup', 'summary', 'after', current.summary),
      ),
    },
    {
      title: 'Longer explanation',
      parts: wordDiff(
        pick('bodyMarkup', 'body', 'before', current.body),
        pick('bodyMarkup', 'body', 'after', current.body),
      ),
    },
  ].filter((section) => section.parts.length)
  return (
    <div data-slot="text-diff" className="flex flex-col gap-4 rounded-lg border bg-card p-4">
      {parts.map((section) => (
        <section key={section.title} aria-label={section.title} className="flex flex-col gap-1">
          <h3 className="text-caption font-bold text-muted-foreground">{section.title}</h3>
          <p className="max-w-prose text-body leading-relaxed break-words whitespace-pre-line">
            <DiffWords parts={section.parts} targets={targets} />
          </p>
        </section>
      ))}
      <p className="text-caption text-muted-foreground">
        Added words are underlined, removed words struck through.
      </p>
    </div>
  )
}

/** Keep a replaced phrase together when both sides share one line. */
function UnifiedDiffWords({
  before,
  after,
  targets,
}: {
  before: string
  after: string
  targets: ReadonlyMap<string, MentionOption>
}) {
  const groups: WordPart[][] = []
  for (const part of wordDiff(before, after)) {
    const group = groups.at(-1)
    if (group && (group[0]!.kind === 'same') === (part.kind === 'same')) group.push(part)
    else groups.push([part])
  }
  return groups.map((group, index) => {
    if (group[0]!.kind === 'same') return <DiffWords key={index} parts={group} targets={targets} />
    const removed = side(group, 'before')
    const added = side(group, 'after')
    return (
      <Fragment key={index}>
        <DiffWords parts={removed} targets={targets} />
        {removed.length && added.length ? <span aria-hidden="true"> </span> : null}
        <DiffWords parts={added} targets={targets} />
      </Fragment>
    )
  })
}

/** Sealed editions reuse the review's field renderers in one unified, responsive column. */
export function EditionFieldRows({
  fields,
  lookups,
  issue,
  singleSide,
}: {
  fields: readonly { field: string; before: unknown; after: unknown }[]
  lookups: DiffLookups
  issue: boolean
  singleSide?: 'before' | 'after'
}) {
  const { rows, unknown } = diffRows(fields)
  return (
    <dl className="@container flex min-w-0 flex-col divide-y">
      {rows.map((row) => {
        const Glyph = rowIcons[row.id]
        const textField =
          row.id === 'summary'
            ? 'summary'
            : row.id === 'body'
              ? 'body'
              : row.id === 'title'
                ? 'title'
                : row.id === 'notToConclude'
                  ? 'notToConclude'
                  : null
        const markup =
          textField === 'summary'
            ? 'summaryMarkup'
            : textField === 'body'
              ? 'bodyMarkup'
              : textField
        const own = singleSide ? row[singleSide] : null
        const shown = own ? { ...row, before: own, after: own } : row
        return (
          <div key={row.id} className="flex min-w-0 gap-3 px-4 py-3 @max-xl:flex-col">
            <dt className="flex w-field-label shrink-0 items-start gap-2 text-caption text-muted-foreground @max-xl:w-full">
              <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
              {diffRowNames[row.id]}
            </dt>
            <dd className="flex min-w-0 flex-1 flex-col gap-3 text-body break-words">
              {textField && markup ? (
                <p className="whitespace-pre-wrap">
                  <UnifiedDiffWords
                    before={textOf(shown.before, markup, textField)}
                    after={textOf(shown.after, markup, textField)}
                    targets={lookups.targets}
                  />
                </p>
              ) : singleSide ? (
                <RowSide
                  row={shown}
                  which={singleSide}
                  lookups={lookups}
                  issue={issue}
                  review={false}
                />
              ) : (
                <>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-caption text-muted-foreground">Before</span>
                    <RowSide
                      row={row}
                      which="before"
                      lookups={lookups}
                      issue={issue}
                      review={false}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-caption text-muted-foreground">After</span>
                    <RowSide
                      row={row}
                      which="after"
                      lookups={lookups}
                      issue={issue}
                      review={false}
                    />
                  </div>
                </>
              )}
            </dd>
          </div>
        )
      })}
      {unknown.map((entry) => (
        <div key={entry.field} className="flex min-w-0 flex-col gap-2 px-4 py-3">
          <dt className="text-caption text-muted-foreground">{entry.field}</dt>
          <dd className="flex min-w-0 flex-col gap-2 text-caption break-all">
            {singleSide !== 'after' ? (
              <p>Before: {JSON.stringify(entry.before) ?? 'Not set'}</p>
            ) : null}
            {singleSide !== 'before' ? (
              <p>After: {JSON.stringify(entry.after) ?? 'Not set'}</p>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}
