import type { CatalogueStatus, CatalogueTermKind } from '@domain/catalogue'
import type { Area } from '@domain/item'
import type { CatalogueTerm } from '@/api'
import {
  CircleCheckIcon,
  CircleDashedIcon,
  GlobeIcon,
  Link2OffIcon,
  RefreshCwIcon,
  SigmaIcon,
  SplitIcon,
  TriangleAlertIcon,
  UnlinkIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { Badge } from '@/components/ui/badge'
import {
  ANY_SOURCE_TOOL,
  catalogueStatusAsks,
  catalogueStatusName,
  termDomainInfo,
} from '@/lib/catalogue'
import { cn } from '@/lib/utils'

/*
  The catalogue's marks (design contract 5, "The catalogue"), each a form of the shared badge
  (components/ui/badge.tsx) so they follow the badge system wherever it goes. The type of a term
  stays quiet, as an item's kind does: a neutral tile with its glyph. Its status is one badge,
  tinted only when it asks for a look.
*/

export const termKindGlyphs: Record<CatalogueTermKind, Icon> = {
  metric: SigmaIcon,
  dimension: SplitIcon,
}

export const termKindNames: Record<CatalogueTermKind, string> = {
  metric: 'Metric',
  dimension: 'Dimension',
}

const tileSize = {
  md: 'size-6 rounded-badge',
  lg: 'size-7 rounded-md',
}

/**
 * The glyph tile for a term's type: sigma for a metric, split for a dimension. Neutral, because
 * the type is quiet; 24 in compact rows, 28 in rows with a description and on a phone.
 */
export function TermTile({
  kind,
  size = 'lg',
  className,
}: {
  kind: CatalogueTermKind
  size?: 'md' | 'lg'
  className?: string
}) {
  const Glyph = termKindGlyphs[kind]
  return (
    <span
      role="img"
      aria-label={termKindNames[kind]}
      data-slot="term-tile"
      data-tone="neutral"
      className={cn(
        'inline-flex shrink-0 items-center justify-center border border-tone-line bg-tone-tint text-tone-ink',
        tileSize[size],
        className,
      )}
    >
      <Glyph aria-hidden="true" className={size === 'lg' ? 'size-4' : 'size-icon-sm'} />
    </span>
  )
}

export const catalogueStatusGlyphs: Record<CatalogueStatus, Icon> = {
  gone: UnlinkIcon,
  changed: RefreshCwIcon,
  active_issues: TriangleAlertIcon,
  no_context: CircleDashedIcon,
  not_linked: Link2OffIcon,
  in_sync: CircleCheckIcon,
}

/**
 * A term's status as one badge, most urgent first (contract 5): soft in the warning tone when it
 * asks for a look (gone from the source, changed there, issues that still apply), bare and muted
 * otherwise. Each status has its own glyph, so the state never relies on colour. `tool` names the
 * tool the definition comes from ("Changed in Cube").
 */
export function CatalogueStatusBadge({
  status,
  activeIssues = 0,
  tool = ANY_SOURCE_TOOL,
  size = 'md',
  iconOnly = false,
  className,
}: {
  status: CatalogueStatus
  /** The count an `active_issues` badge names. */
  activeIssues?: number
  /** The tool the term's definition comes from, as people say it. */
  tool?: string
  size?: 'md' | 'sm'
  iconOnly?: boolean
  className?: string
}) {
  const asks = catalogueStatusAsks(status)
  return (
    <Badge
      iconOnly={iconOnly}
      form={asks ? 'soft' : 'bare'}
      // A bare badge is cell text: it keeps the 13 pixel label in compact rows too.
      size={asks ? size : 'md'}
      tone={asks ? 'warning' : 'neutral'}
      quiet={!asks}
      icon={catalogueStatusGlyphs[status]}
      data-slot="catalogue-status"
      data-status={status}
      className={className}
    >
      {catalogueStatusName(status, { activeIssues, tool })}
    </Badge>
  )
}

/** A term's domain badge, from the term and the domains (`termDomainInfo`). */
export function TermDomain({
  term,
  areas,
  size,
  className,
}: {
  term: Pick<CatalogueTerm, 'kind' | 'domain'>
  areas: readonly Area[]
  size?: 'md' | 'sm'
  className?: string
}) {
  const { name, label, none } = termDomainInfo(term, areas)
  return <TermDomainBadge name={name} label={label} none={none} size={size} className={className} />
}

/**
 * A term's domain: the soft domain badge, or a bare mark when the term has no area. A dimension
 * with no area applies to every domain (a globe); a metric with none says so (CON-516).
 */
export function TermDomainBadge({
  name,
  label,
  none,
  form = 'soft',
  size = 'md',
  className,
}: {
  name: string
  label: Area['label'] | null
  /** Set when the term has no area: All domains for a dimension, No domain for a metric. */
  none: CatalogueTermKind | null
  form?: 'soft' | 'bare'
  size?: 'md' | 'sm'
  className?: string
}) {
  if (label !== null) {
    return <DomainBadge name={name} label={label} form={form} size={size} className={className} />
  }
  // In a cell the mark is quiet; as a group's name, All domains reads like any domain.
  const quiet = form === 'soft' || none !== 'dimension'
  return (
    <Badge
      form="bare"
      size="md"
      tone="neutral"
      quiet={quiet}
      icon={none === 'dimension' ? GlobeIcon : CircleDashedIcon}
      data-slot="domain-badge"
      className={cn(!quiet && 'text-foreground', className)}
    >
      {name}
    </Badge>
  )
}
