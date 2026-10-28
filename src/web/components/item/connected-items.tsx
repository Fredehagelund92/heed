import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty'
import { NetworkIcon } from '@/components/icons'
import type { ItemLinks } from '@/api'
import {
  BookOpenIcon,
  HeedDomainIcon,
  HeedRetiredIcon,
  HeedSourceChangedIcon,
  HeedSourceMissingIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
  type Icon,
} from '@/components/icons'
import { kindGlyphs } from '@/components/item/item-marks'
import { PreviewLink } from '@/components/preview/preview-link'
import { Badge } from '@/components/ui/badge'
import { kindNames } from '@/lib/library'
import { previewTargetOf } from '@/lib/preview'

/*
  What an item is connected to (S3 of the item page design, FR-128): the things its text
  mentions, and the items whose text mentions it ("what links here"). Rows of 48 in a bordered
  list, the type with its glyph on the left, the name as a link that previews what it opens: an
  item its page, a metric or a dimension its catalogue page, a value its dimension's page. A
  domain links to its library.
*/

type Outgoing = ItemLinks['mentions'][number]

const typeLook: Record<
  Exclude<Outgoing['target']['type'], 'item'>,
  { glyph: Icon; name: string }
> = {
  metric: { glyph: SigmaIcon, name: 'Metric' },
  dimension: { glyph: SplitIcon, name: 'Dimension' },
  dimension_value: { glyph: TagIcon, name: 'Value' },
  area: { glyph: HeedDomainIcon, name: 'Domain' },
  term: { glyph: BookOpenIcon, name: 'Word' },
}

const statusLook = {
  retired: { glyph: HeedRetiredIcon, text: 'Archived' },
  source_changed: { glyph: HeedSourceChangedIcon, text: 'Source changed' },
  source_missing: { glyph: HeedSourceMissingIcon, text: 'Source missing' },
} as const

/** The distinct things an item mentions, in text order: one row per target. */
export function mentionTargets(links: ItemLinks | undefined): Outgoing[] {
  const seen = new Set<string>()
  return (links?.mentions ?? []).filter((mention) => {
    if (seen.has(mention.target.key)) return false
    seen.add(mention.target.key)
    return true
  })
}

/** The Links tab's count: distinct mentioned targets and the items that mention this one. */
export function linkCount(links: ItemLinks | undefined): number {
  return mentionTargets(links).length + (links?.mentionedBy.total ?? 0)
}

function Row({ glyph: Glyph, type, children }: { glyph: Icon; type: string; children: ReactNode }) {
  return (
    <li className="flex min-h-12 items-center gap-3 px-4 py-2">
      <span className="flex w-column-version shrink-0 items-center gap-2 text-muted-foreground">
        <Glyph aria-hidden="true" className="size-icon-sm shrink-0" />
        {type}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</span>
    </li>
  )
}

const listClass =
  'flex flex-col overflow-hidden rounded-lg border bg-card text-dense [&>li+li]:border-t'
const nameClass =
  'min-w-0 underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-2 focus-visible:outline-ring'

function TargetName({ target }: { target: Outgoing['target'] }) {
  const preview = target.status === 'retired' ? null : previewTargetOf(target.key)
  if (preview)
    return (
      <PreviewLink preview={preview} className={nameClass}>
        {target.name}
      </PreviewLink>
    )
  if (target.type === 'area' && target.status !== 'retired')
    return (
      <Link to="/library" search={{ area: target.key.slice('area:'.length) }} className={nameClass}>
        {target.name}
      </Link>
    )
  return <span className="min-w-0 text-muted-foreground">{target.name}</span>
}

export function ConnectedItems({
  links,
  itemKind,
  emptyAction,
}: {
  links: ItemLinks | undefined
  emptyAction?: ReactNode
  /** The kind of a mentioned item, from the person's library. */
  itemKind: (id: string) => keyof typeof kindNames | undefined
}) {
  const outgoing = mentionTargets(links)
  const incoming = links?.mentionedBy.rows ?? []
  const total = links?.mentionedBy.total ?? 0
  if (outgoing.length === 0 && incoming.length === 0) {
    if (emptyAction)
      return (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <NetworkIcon />
            </EmptyMedia>
            <EmptyTitle>No connections yet</EmptyTitle>
            <EmptyDescription>
              When a text mentions this fact with @, the connection shows here.
            </EmptyDescription>
          </EmptyHeader>
          {emptyAction}
        </Empty>
      )
    return (
      <p className="text-body text-muted-foreground">
        Nothing links to or from this fact yet. When a text mentions it with @, it shows here.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-6">
      {outgoing.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-dense font-bold text-muted-foreground">This fact mentions</h3>
          <ul className={listClass} aria-label="This fact mentions">
            {outgoing.map((mention) => {
              const { target } = mention
              const kind =
                target.type === 'item'
                  ? (itemKind(target.key.slice('item:'.length)) ?? 'note')
                  : null
              const look =
                kind !== null
                  ? { glyph: kindGlyphs[kind], name: kindNames[kind] }
                  : typeLook[target.type as Exclude<typeof target.type, 'item'>]
              const problem = target.status === 'current' ? null : statusLook[target.status]
              return (
                <Row key={target.key} glyph={look.glyph} type={look.name}>
                  <TargetName target={target} />
                  {problem ? (
                    <Badge form="soft" tone="warning" size="sm" icon={problem.glyph}>
                      {problem.text}
                    </Badge>
                  ) : null}
                </Row>
              )
            })}
          </ul>
        </div>
      ) : null}
      {incoming.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-dense font-bold text-muted-foreground">
            Mentioned by {total.toLocaleString('en')} {total === 1 ? 'fact' : 'facts'}
          </h3>
          <ul className={listClass} aria-label="Mentioned by">
            {incoming.map((row) => (
              <Row
                key={`${row.source.id}-${row.field}-${row.position}`}
                glyph={kindGlyphs[row.source.kind]}
                type={kindNames[row.source.kind]}
              >
                {row.source.status === 'retired' ? (
                  <span className="min-w-0 text-muted-foreground">{row.source.title}</span>
                ) : (
                  <PreviewLink preview={{ type: 'item', id: row.source.id }} className={nameClass}>
                    {row.source.title}
                  </PreviewLink>
                )}
              </Row>
            ))}
          </ul>
          {total > incoming.length ? (
            <p className="text-caption text-muted-foreground">
              Showing the newest {incoming.length.toLocaleString('en')}.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
