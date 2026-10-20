import type { Area, ItemKind } from '@domain/item'
import {
  HeedDomainIcon,
  HeedSourceChangedIcon,
  SigmaIcon,
  SplitIcon,
  TagIcon,
  type Icon,
} from '@/components/icons'
import { kindGlyphs } from '@/components/item/item-marks'
import { mentionSpokenName, mentionTypeWords, type MentionStatus } from '@/lib/mention-names'
import { cn } from '@/lib/utils'
import './mention-chip.css'

/** The longest item title a chip prints before it truncates (contract 6.13). */
export const MENTION_TITLE_LIMIT = 34

/**
 * What a mention points at, by the prefix of its target (src/domain/mentions.ts): an area, a
 * metric, a dimension, a dimension value or an item. A missing target is a stale link.
 */
export type MentionChipTarget =
  | { type: 'area'; label: Area['label'] }
  | { type: 'metric' }
  | { type: 'dim' }
  | { type: 'val' }
  | { type: 'item'; kind: ItemKind; calm?: boolean }

const scopeGlyphs: Record<'metric' | 'dim' | 'val', Icon> = {
  metric: SigmaIcon,
  dim: SplitIcon,
  val: TagIcon,
}

const typeNames: Record<MentionChipTarget['type'], string> = {
  area: 'Domain',
  metric: 'Metric',
  dim: 'Dimension',
  val: 'Value',
  item: 'Fact',
}

/** Shortens an item title to the chip's limit, on a word where it can. */
export function mentionText(type: MentionChipTarget['type'], name: string): string {
  if (type !== 'item' || [...name].length <= MENTION_TITLE_LIMIT) return name
  const cut = [...name].slice(0, MENTION_TITLE_LIMIT - 1).join('')
  const space = cut.lastIndexOf(' ')
  return `${(space > MENTION_TITLE_LIMIT / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

const statusTitles: Record<Exclude<MentionStatus, 'current'>, string> = {
  retired: 'archived',
  source_changed: 'its source definition changed',
  source_missing: 'its source definition is missing',
}

/**
 * An @ mention inside running text (contract 6.13): an inline chip from the badge family with the
 * look of the thing it points at. A domain keeps its domain badge (hue and domain mark), a metric, a
 * dimension and a value are quiet scope chips with their glyph, an item is a quiet chip with its
 * kind glyph in the kind's hue. A missing target, or a term whose source definition is missing,
 * is a dashed outline with a struck label; a retired item is a dashed, muted chip; a term whose
 * source changed carries a small warning glyph. The chip is sized from the text around it, so it
 * never changes the line box.
 *
 * A screen reader hears the name and the type, and the state when it is not current ("Net
 * revenue, metric"), from a hidden suffix that a selection does not copy: copying text still
 * gives the name.
 */
export function MentionChip({
  target,
  name,
  missing = false,
  status = 'current',
  hint = true,
  className,
}: {
  target: MentionChipTarget
  name: string
  /** The target is not in the library at all. */
  missing?: boolean
  status?: MentionStatus
  /** The native tooltip; off inside a preview trigger, whose card says more. */
  hint?: boolean
  className?: string
}) {
  const text = mentionText(target.type, name)
  const struck = missing || status === 'source_missing'
  const dashed = struck || status === 'retired'
  const area = target.type === 'area' && !dashed
  // An issue that has ended keeps its glyph in the calm tone: it is history, not a warning.
  const calm = target.type === 'item' && target.calm === true
  // Hidden but in the flow: an absolutely placed suffix would read as a line of its own.
  const suffix = (
    <span className="sr-inline select-none">
      {`, ${missing ? `${mentionTypeWords[target.type]}, no longer in the library` : mentionSpokenName(target.type, '', status)}`}
    </span>
  )
  const lastWordAt = text.lastIndexOf(' ') + 1
  const stateGlyph =
    status === 'source_changed' ? (
      <HeedSourceChangedIcon
        aria-hidden="true"
        data-slot="mention-state"
        data-tone="warning"
        className="text-tone-dot"
      />
    ) : null
  const Glyph =
    target.type === 'item'
      ? kindGlyphs[target.kind]
      : target.type === 'area'
        ? null
        : scopeGlyphs[target.type]
  return (
    <span
      data-slot="mention-chip"
      data-target={target.type}
      data-missing={missing || undefined}
      data-status={status === 'current' ? undefined : status}
      data-tone={area ? target.label : 'neutral'}
      title={
        !hint
          ? undefined
          : missing
            ? `${name} (no longer in the library)`
            : `${typeNames[target.type]}: ${name}${status === 'current' ? '' : ` (${statusTitles[status]})`}`
      }
      className={cn(
        'mention-chip rounded-badge border',
        area
          ? 'border-tone-line bg-tone-tint text-tone-ink'
          : 'border-border bg-background text-foreground',
        dashed && 'border-dashed bg-transparent text-muted-foreground',
        className,
      )}
    >
      {area ? (
        <HeedDomainIcon aria-hidden="true" className="text-tone-dot" />
      ) : Glyph ? (
        <Glyph
          aria-hidden="true"
          className={cn(
            target.type === 'item' && target.kind === 'issue' && !calm && !dashed
              ? 'text-status-warning-icon'
              : 'text-muted-foreground',
          )}
        />
      ) : null}
      {area ? (
        // A domain's chip wraps (index.css): its last word and the spoken suffix stay on one line,
        // or the suffix would wrap alone and draw an empty piece of the chip there.
        <span>
          {text.slice(0, lastWordAt)}
          <span className="whitespace-nowrap">
            {text.slice(lastWordAt)}
            {stateGlyph}
            {suffix}
          </span>
        </span>
      ) : (
        <>
          <span className={cn(struck && 'line-through')}>{text}</span>
          {stateGlyph}
          {suffix}
        </>
      )}
    </span>
  )
}
