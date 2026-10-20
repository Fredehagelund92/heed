import type { ReactNode } from 'react'
import {
  ActivityIcon,
  HeedDomainIcon,
  PercentIcon,
  SearchXIcon,
  TargetIcon,
  type Icon,
} from '@/components/icons'
import { HelpLink } from '@/components/help/help-link'
import { DomainBadge } from '@/components/item/item-marks'
import { highlight } from '@/components/library/item-list'
import { gridCell, gridFooter, gridHeaderRow, gridRow } from '@/components/page/grid'
import {
  countText,
  monthText,
  shareText,
  weekText,
  type TopicEntry,
  type TopicRow,
} from '@/lib/gaps'
import { cn } from '@/lib/utils'
import { topicColumnSpecs, type TopicColumnId } from './gap-columns'
import { GroupRow } from './gap-list'
import { GapCount } from './gap-marks'

/*
  The topic counts (FR-605, FR-614): agent calls per topic and week, on the same grid as the gaps,
  one group per week. Only the topic weeks that reach the minimum are listed, and a count of calls
  that found nothing below it reads "Fewer than 5"; the footer says how many topic weeks were left
  out, never which. Rows are facts to read, not links.
*/

const fieldIcons: Record<TopicColumnId | 'title', Icon> = {
  title: TargetIcon,
  domain: HeedDomainIcon,
  calls: ActivityIcon,
  noItemCalls: SearchXIcon,
  share: PercentIcon,
}

function Cell({ column, row }: { column: TopicColumnId; row: TopicRow }) {
  const spec = topicColumnSpecs[column]
  let content: ReactNode
  switch (column) {
    case 'domain':
      content =
        row.areaName && row.areaLabel ? (
          <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
        ) : (
          <span className="text-muted-foreground">{row.domainsText}</span>
        )
      break
    case 'calls':
      content = <GapCount count={row.calls} />
      break
    case 'noItemCalls':
      content = <GapCount count={row.noItemCalls} />
      break
    case 'share':
      content =
        row.share === null ? (
          <span className="text-muted-foreground">{shareText(null)}</span>
        ) : (
          shareText(row.share)
        )
      break
  }
  return (
    <div
      role="cell"
      className={cn(gridCell, 'truncate', spec.widthClass, spec.numeric && 'tabular-nums')}
    >
      {content}
    </div>
  )
}

/** The grid's column header, also kept over its loading rows. */
export function TopicHeaderRow({ columns }: { columns: TopicColumnId[] }) {
  const cell = (id: TopicColumnId | 'title', title: string, className: string) => {
    const Glyph = fieldIcons[id]
    return (
      <div key={id} role="columnheader" className={cn(gridCell, className)}>
        <span className="inline-flex min-w-0 items-center gap-2">
          <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
          <span className="truncate">{title}</span>
        </span>
      </div>
    )
  }
  return (
    <div role="rowgroup" className="sticky top-(--list-sticky-top) z-sticky">
      <div role="row" data-layout="content" className={cn(gridHeaderRow, 'heed-ink')}>
        {cell('title', 'Topic', 'min-w-0 flex-1')}
        {columns.map((column) =>
          cell(column, topicColumnSpecs[column].title, topicColumnSpecs[column].widthClass),
        )}
      </div>
    </div>
  )
}

function GridRow({
  row,
  columns,
  terms,
}: {
  row: TopicRow
  columns: TopicColumnId[]
  terms: string[]
}) {
  return (
    <div role="row" className={cn(gridRow, 'h-row')}>
      <div role="rowheader" className={cn(gridCell, 'flex-1 shrink gap-2')}>
        <span className="min-w-0 truncate text-body">{highlight(row.title, terms)}</span>
        <span className="shrink-0 text-dense text-muted-foreground">
          {monthText(row.month, 'short')}
        </span>
      </div>
      {columns.map((column) => (
        <Cell key={column} column={column} row={row} />
      ))}
    </div>
  )
}

function NarrowRow({ row, terms }: { row: TopicRow; terms: string[] }) {
  return (
    <div role="row" className="flex min-h-row-phone items-start gap-3 border-b px-gutter py-3">
      <div role="rowheader" className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="line-clamp-2 text-row-phone font-normal">
          {highlight(row.title, terms)}
        </span>
        {row.areaName && row.areaLabel ? (
          <DomainBadge name={row.areaName} label={row.areaLabel} size="sm" />
        ) : (
          <span className="text-caption text-muted-foreground">{row.domainsText}</span>
        )}
        <p className="flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground tabular-nums">
          <span>{monthText(row.month)}</span>
          <span aria-hidden="true">·</span>
          <span>{`${countText(row.calls)} calls`}</span>
          <span aria-hidden="true">·</span>
          <span>
            {row.noItemCalls.kind === 'value'
              ? `${countText(row.noItemCalls)} found nothing`
              : `Found nothing: ${countText(row.noItemCalls).toLowerCase()}`}
          </span>
          {row.share !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span>{shareText(row.share)}</span>
            </>
          ) : null}
        </p>
      </div>
    </div>
  )
}

function Footer({
  rows,
  hidden,
  columns,
  narrow,
}: {
  rows: readonly TopicRow[]
  hidden: number
  columns: TopicColumnId[]
  narrow: boolean
}) {
  const weeks = (
    <>
      <span className="font-bold text-foreground tabular-nums">
        {rows.length.toLocaleString('en')}
      </span>
      {rows.length === 1 ? 'topic week' : 'topic weeks'}
    </>
  )
  const left = hidden ? (
    <>
      <span className="font-bold text-foreground tabular-nums">{hidden.toLocaleString('en')}</span>
      below the minimum, not shown
    </>
  ) : null
  if (narrow)
    return (
      <p
        data-slot="list-footer"
        className="flex flex-wrap gap-1 border-t px-gutter py-3 text-caption text-muted-foreground"
      >
        {weeks}
        {left ? <span aria-hidden="true">·</span> : null}
        {left}
      </p>
    )
  return (
    <div
      role="group"
      aria-label="Totals"
      data-slot="list-footer"
      data-launcher-clear
      className={gridFooter}
    >
      <div className={cn(gridCell, 'flex-1 gap-1')}>
        {weeks}
        {left ? <span aria-hidden="true">·</span> : null}
        {left}
      </div>
      {columns.map((column) => (
        <div key={column} className={cn(gridCell, topicColumnSpecs[column].widthClass)} />
      ))}
    </div>
  )
}

export function TopicList({
  entries,
  rows,
  hidden,
  columns,
  narrow,
  terms,
  note,
}: {
  entries: readonly TopicEntry[]
  rows: readonly TopicRow[]
  /** Topic weeks below the minimum in the period: counted, never listed. */
  hidden: number
  columns: TopicColumnId[]
  narrow: boolean
  terms: string[]
  /** Why some counts read "Fewer than 5", under the list. */
  note: string
}) {
  return (
    <div className="flex flex-col">
      <div role="table" aria-label="Topic counts" data-slot="topic-list" className="flex flex-col">
        {narrow ? null : <TopicHeaderRow columns={columns} />}
        <div role="rowgroup" className="flex flex-col">
          {entries.map((entry, index) =>
            entry.type === 'group' ? (
              <GroupRow
                key={`week:${entry.week}`}
                label={weekText(entry.week, 'long')}
                count={entry.count}
                narrow={narrow}
                first={index === 0}
              />
            ) : narrow ? (
              <NarrowRow key={entry.row.key} row={entry.row} terms={terms} />
            ) : (
              <GridRow key={entry.row.key} row={entry.row} columns={columns} terms={terms} />
            ),
          )}
        </div>
      </div>
      <Footer rows={rows} hidden={hidden} columns={columns} narrow={narrow} />
      <p className="px-gutter pt-3 text-caption text-muted-foreground">
        {note} <HelpLink to="common-questions#why-are-some-counts-hidden">Why?</HelpLink>
      </p>
    </div>
  )
}
