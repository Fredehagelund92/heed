import type { Audience, ClaimLevel, RiskLevel } from '@domain/item'
import {
  CircleHelpIcon,
  GitCommitHorizontalIcon,
  GlobeIcon,
  LockIcon,
  ShieldCheckIcon,
} from '@/components/icons'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

/*
  The facts of an item as badges (contract 6.13; S5 of the item page design): its risk, what an
  agent may say about cause, who can receive it and its version. Kept apart from item-marks.tsx,
  which the library and the shell load first, because only the item page uses them.
*/

const riskNames: Record<RiskLevel, string> = {
  low: 'Low risk',
  normal: 'Normal risk',
  high: 'High risk',
}

const riskSteps: Record<RiskLevel, number> = { low: 1, normal: 2, high: 3 }
/** The three bars as x, y and height in a 14 pixel box: 3 wide, 2 apart, rising. */
const bars = [
  { x: 1, y: 8, height: 5 },
  { x: 5.5, y: 5, height: 8 },
  { x: 10, y: 1, height: 12 },
]

/** Three ascending bars: the risk level without colour (one, two or three are filled). */
function RiskBars({ level }: { level: RiskLevel }) {
  return (
    <svg
      aria-hidden="true"
      data-slot="risk-bars"
      viewBox="0 0 14 14"
      className="size-icon-sm shrink-0"
    >
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width={3}
          height={bar.height}
          rx={1}
          className={index < riskSteps[level] ? 'fill-tone-dot' : 'fill-border'}
        />
      ))}
    </svg>
  )
}

/**
 * A risk level (contract 6.13): three ascending bars and the words. Outline for low and normal,
 * soft red only for high, because high risk is what a reader must not miss (FR-206, FR-207).
 * `bare` is the same fact inside a cell.
 */
export function RiskBadge({
  level,
  form,
  size = 'md',
  className,
}: {
  level: RiskLevel
  form?: 'soft' | 'outline' | 'bare'
  size?: 'md' | 'sm'
  className?: string
}) {
  const high = level === 'high'
  return (
    <Badge
      form={form ?? (high ? 'soft' : 'outline')}
      size={size}
      tone={high ? 'danger' : 'neutral'}
      mark={<RiskBars level={level} />}
      data-slot="risk-badge"
      data-level={level}
      className={className}
    >
      {riskNames[level]}
    </Badge>
  )
}

/**
 * What an agent may say about cause (FR-125): "Stated" when a named authority states the effect,
 * "Not proven" when the item documents a fact only. An outline badge: a plain fact.
 */
export function ClaimBadge({
  level,
  short = false,
  className,
}: {
  level: ClaimLevel
  short?: boolean
  className?: string
}) {
  const stated = level === 'effect_stated'
  return (
    <Badge
      form="outline"
      tone={stated ? 'info' : 'neutral'}
      icon={stated ? ShieldCheckIcon : CircleHelpIcon}
      data-slot="claim-badge"
      className={className}
    >
      {stated ? (short ? 'Stated' : 'Cause stated') : short ? 'Not proven' : 'Cause not proven'}
    </Badge>
  )
}

/** Who can receive an item, in words. */
export function audienceText(audience: Audience): string {
  return audience.kind === 'everyone'
    ? 'Everyone'
    : `Only ${audience.groups.map((group) => group.replace('_', ' ')).join(', ')}`
}

/** Who can receive an item: a globe for everyone, a lock for named groups. An outline badge. */
export function AudienceBadge({ audience, className }: { audience: Audience; className?: string }) {
  return (
    <Badge
      form="outline"
      icon={audience.kind === 'everyone' ? GlobeIcon : LockIcon}
      data-slot="audience-badge"
      className={className}
    >
      {audienceText(audience)}
    </Badge>
  )
}

/** A version number as `v3`: an outline badge with the commit glyph. */
export function VersionBadge({ version, className }: { version: number; className?: string }) {
  return (
    <Badge
      form="outline"
      icon={GitCommitHorizontalIcon}
      aria-label={`Version ${version}`}
      data-slot="version-badge"
      className={cn('tabular-nums', className)}
    >
      v{version}
    </Badge>
  )
}
