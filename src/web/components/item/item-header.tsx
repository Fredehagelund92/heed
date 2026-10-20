import type { ReactNode } from 'react'
import type { Area, ContextItem } from '@domain/item'
import {
  ChevronDownIcon,
  HeedAcceptedIcon,
  HeedEndedIcon,
  HeedIssueIcon,
  HeedRetiredIcon,
  HeedValidUntilIcon,
  type Icon,
} from '@/components/icons'
import { RiskBadge } from '@/components/item/fact-badges'
import { DomainBadge, KindBadge, StatusBadge } from '@/components/item/item-marks'
import { badgeVariants } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ItemState, ValidityChip as ValidityChipModel } from '@/lib/item-state'
import { cn } from '@/lib/utils'

/** The chip's glyph is the Heed mark of the state it says (contract 6.11). */
const chipGlyphs: Record<ValidityChipModel['key'], Icon> = {
  applies_since: HeedAcceptedIcon,
  applies_until: HeedAcceptedIcon,
  future: HeedValidUntilIcon,
  active_since: HeedIssueIcon,
  active_until: HeedIssueIcon,
  ended: HeedEndedIcon,
  resolved: HeedAcceptedIcon,
  retired: HeedRetiredIcon,
}

/**
 * The validity chip: the period the item applies, as a badge that opens the lifecycle sentence.
 * Outline, and soft amber only when its last day is within 30 days (the library's Valid until).
 * An active issue keeps a neutral chip with the issue's amber warning mark: the issue is the item's content,
 * not a fault in it. Only a trigger, so it sits inside a `Collapsible` with its detail.
 */
export function ValidityChip({ chip }: { chip: ValidityChipModel }) {
  const Glyph = chipGlyphs[chip.key]
  const issue = chip.key === 'active_since' || chip.key === 'active_until'
  return (
    <CollapsibleTrigger
      data-slot="validity-chip"
      data-key={chip.key}
      data-tone={chip.soon ? 'warning' : 'neutral'}
      className={cn(
        badgeVariants({ form: chip.soon ? 'soft' : 'outline' }),
        'group/chip cursor-pointer focus-visible:outline-2 focus-visible:outline-ring',
        !chip.soon && 'hover:bg-accent',
      )}
    >
      <Glyph aria-hidden="true" data-tone={issue ? 'warning' : undefined} />
      <span data-slot="badge-label" className="min-w-0 truncate">
        <span className={cn(chip.quiet && 'text-muted-foreground')}>{chip.label}</span>
        {chip.tail ? (
          <span className={cn(!chip.soon && 'text-muted-foreground')}>{chip.tail}</span>
        ) : null}
      </span>
      <ChevronDownIcon
        aria-hidden="true"
        className="size-3 stroke-icon-sm transition-transform group-data-panel-open/chip:rotate-180"
      />
    </CollapsibleTrigger>
  )
}

/** The one line under the title while something asks for a look: what agents do and who acts. */
export function StateNote({ children }: { children: ReactNode }) {
  return (
    <p
      data-slot="state-note"
      className="max-w-prose border-l-2 border-status-warning-icon pl-3 text-dense"
    >
      {children}
    </p>
  )
}

/**
 * The badges of an item (the note line of the item page design): one row of every condition
 * that is true, ending in the validity chip and the next check as quiet text. The chip opens the
 * lifecycle sentence in place. The item page and the library's docked panel both show it.
 */
export function ItemBadges({
  item,
  area,
  state,
  kind = true,
}: {
  item: ContextItem
  area: Area | undefined
  state: ItemState
  /** Whether the row starts with the kind; the docked panel names it in its bar instead. */
  kind?: boolean
}) {
  const { conditions, lifecycle, chip, nextCheck } = state
  return (
    <Collapsible className="flex flex-col gap-3">
      <div data-slot="item-badges" className="flex flex-wrap items-center gap-2">
        {kind ? (
          <KindBadge kind={item.kind} active={conditions.lifecycle === 'active_issue'} />
        ) : null}
        {area ? <DomainBadge name={area.name} label={area.label} /> : null}
        {conditions.warnings.map((warning) => (
          <StatusBadge key={warning} status={warning} />
        ))}
        {item.riskLevel === 'high' ? <RiskBadge level="high" /> : null}
        <span aria-hidden="true" className="hidden px-1 @xl:block">
          <span className="block h-4 w-px bg-border" />
        </span>
        <ValidityChip chip={chip} />
        {nextCheck ? (
          <span
            data-slot="next-check"
            className="text-dense whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {nextCheck}
          </span>
        ) : null}
      </div>
      <CollapsibleContent
        data-slot="validity-detail"
        className="flex max-w-prose flex-col gap-1 rounded-md bg-muted px-3 py-2 text-dense"
      >
        <p className="font-bold">{lifecycle.title}</p>
        <p className="text-muted-foreground">{lifecycle.line}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

/**
 * Title, compact badges, plain validity line, how the served version was reviewed (FR-326), then
 * the warning's explanation.
 */
export function ItemHeader({
  item,
  area,
  state,
  stamp,
}: {
  item: ContextItem
  area: Area | undefined
  state: ItemState
  /** The review stamp of the version agents get, for an item the live edition serves. */
  stamp?: ReactNode
}) {
  return (
    <header data-slot="item-header" className="flex flex-col gap-3">
      <h1 className="max-w-reading min-w-0 text-display font-bold tracking-display">
        {item.title}
      </h1>
      <div data-slot="item-badges" className="flex flex-wrap items-center gap-2">
        <KindBadge
          kind={item.kind}
          size="sm"
          active={state.conditions.lifecycle === 'active_issue'}
        />
        {area ? <DomainBadge name={area.name} label={area.label} size="sm" /> : null}
        {state.conditions.warnings.map((warning) => (
          <StatusBadge key={warning} status={warning} size="sm" />
        ))}
        {item.riskLevel === 'high' ? <RiskBadge level="high" size="sm" /> : null}
      </div>
      <p data-slot="item-note" className="text-dense text-muted-foreground">
        {/* The stamp under it starts with "Accepted", so the note does not say it twice. */}
        {state.chip.key !== 'retired' && !(stamp && state.lifecycle.key === 'accepted')
          ? `${state.lifecycle.title} · `
          : null}
        {state.chip.summaryLabel ?? state.chip.label}
        {state.chip.tail}
        {state.nextCheck ? (
          <>
            {' '}
            · <span data-slot="next-check">{state.nextCheck}</span>
          </>
        ) : null}
      </p>
      {stamp}
      {state.note ? <StateNote>{state.note}</StateNote> : null}
    </header>
  )
}
