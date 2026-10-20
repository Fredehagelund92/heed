import type { GapStatus } from '@domain/gaps'
import type { Area } from '@domain/item'
import type { Gap } from '@/api'
import {
  BadgeCheckIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  FilePenIcon,
  HeedDomainIcon,
  UsersIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { Badge, type BadgeTone } from '@/components/ui/badge'
import { countText, gapStatusNames, topicArea, topicDomainsText, type ShownCount } from '@/lib/gaps'
import { cn } from '@/lib/utils'

/*
  The marks of the Gaps page, from the badge family (contract 6.13). A gap's status is soft while
  it asks for a look (open: amber, a draft started: blue) and bare and muted once closed, each
  with its own glyph, so the status never relies on colour.
*/

export const gapStatusLook: Record<GapStatus, { glyph: Icon; tone: BadgeTone | null }> = {
  open: { glyph: CircleDashedIcon, tone: 'warning' },
  proposal_made: { glyph: FilePenIcon, tone: 'info' },
  wont_fix: { glyph: CircleSlashIcon, tone: null },
  resolved: { glyph: CircleCheckIcon, tone: null },
}

export function GapStatusBadge({
  status,
  size = 'md',
  iconOnly = false,
}: {
  status: GapStatus
  size?: 'md' | 'sm'
  iconOnly?: boolean
}) {
  const { glyph, tone } = gapStatusLook[status]
  return (
    <Badge
      iconOnly={iconOnly}
      form={tone ? 'soft' : 'bare'}
      size={tone ? size : 'md'}
      tone={tone ?? 'neutral'}
      quiet={!tone}
      icon={glyph}
      data-slot="gap-status-badge"
    >
      {gapStatusNames[status]}
    </Badge>
  )
}

/**
 * A gap's domain: the topic's area, or the one domain its metrics have; otherwise an outline badge
 * that names the domains it spans ("2 domains: Customer value, Marketing").
 */
export function TopicDomainBadge({
  topic,
  areas,
}: {
  topic: Pick<Gap['topic'], 'areaId' | 'areaIds'>
  areas: readonly Area[]
}) {
  const area = topicArea(topic, areas)
  if (area) return <DomainBadge name={area.name} label={area.label} />
  return (
    <Badge form="outline" icon={HeedDomainIcon} fullText={topicDomainsText(topic, areas)}>
      {topicDomainsText(topic, areas)}
    </Badge>
  )
}

/**
 * Verified by test (FR-610): every linked test passed on the edition that resolved the gap or a
 * later one. A fact beside the status, never instead of it, so an outline in the success tone with
 * its own glyph; the words say it, not the colour. The day and edition are in its title.
 */
export function VerifiedBadge({
  size = 'md',
  title,
}: {
  size?: 'md' | 'sm'
  /** When, in words. */
  title?: string
}) {
  return (
    <Badge
      form="outline"
      tone="success"
      size={size}
      icon={BadgeCheckIcon}
      data-slot="verified-badge"
      title={title}
    >
      Checked by a test
    </Badge>
  )
}

/**
 * A gap people reported from Try it or the assistant (FR-606 case 5): a plain fact, so an
 * outline, with the people glyph. It never says who, or how many when that would be fewer than
 * the minimum; the count is in the docked panel, through the privacy rule. In the grid's topic
 * cell it is the glyph alone (`compact`), so the topic keeps its room; the words stay its name.
 */
export function FromPeopleBadge({
  size = 'md',
  compact = false,
}: {
  size?: 'md' | 'sm'
  compact?: boolean
}) {
  return (
    <Badge
      form="outline"
      size={size}
      icon={UsersIcon}
      data-slot="from-people-badge"
      title="From people: reported from Try a question or the assistant. We never record who."
    >
      {compact ? <span className="sr-only">From people</span> : 'From people'}
    </Badge>
  )
}

/**
 * A count through the privacy rule (FR-614): the number, or "Fewer than 5" and "Hidden" in muted
 * words with the reason in the tooltip. It never prints a value below the minimum.
 */
export function GapCount({ count, className }: { count: ShownCount; className?: string }) {
  if (count.kind === 'value')
    return <span className={cn('tabular-nums', className)}>{countText(count)}</span>
  return (
    <span
      data-slot="hidden-count"
      title={
        count.kind === 'fewer'
          ? `Counts below ${count.minimum} are hidden, so no one can tell who asked.`
          : 'Hidden: too few to show, so no one can tell who asked.'
      }
      className={cn('text-muted-foreground', className)}
    >
      {countText(count)}
    </span>
  )
}
