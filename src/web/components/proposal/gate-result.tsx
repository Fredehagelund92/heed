import { useMemo, type ReactNode } from 'react'
import type { RiskLevel } from '@domain/item'
import type { Gate } from '@/api/client'
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  LoaderCircleIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  type Icon,
} from '@/components/icons'
import type { BadgeTone } from '@/components/ui/badge'
import { railSectionClass, useInRail } from '@/components/page/page-rail'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  checkedEdition,
  checkLevelNames,
  checkLevelShortNames,
  checkStateNames,
  gateHeadline,
  gateState,
  readGate,
  requiredLine,
  type CheckReading,
  type CheckState,
} from '@/lib/gate'
import { parseEditionLabel } from '@/lib/editions'
import { formatDay } from '@/lib/library'
import { cn } from '@/lib/utils'
import { PartCard } from './part-card'

/*
  The checks of a proposal (contract 7.2 GateResult, 9.7; FR-505 to FR-516): one row per required
  level with a bare glyph, the level's name and one plain sentence. The glyph's shape carries the
  outcome (a check, a cross, a triangle, a dashed or a turning circle), the hue only repeats it,
  and the outcome is also in words for a screen reader, so colour is never the only sign.
*/

export const checkStateLook: Record<CheckState, { glyph: Icon; tone: BadgeTone }> = {
  passed: { glyph: CircleCheckIcon, tone: 'success' },
  failed: { glyph: CircleXIcon, tone: 'danger' },
  error: { glyph: TriangleAlertIcon, tone: 'warning' },
  running: { glyph: LoaderCircleIcon, tone: 'info' },
  not_run: { glyph: CircleDashedIcon, tone: 'neutral' },
}

/** The outcome as a 16 pixel glyph in its tone, named for assistive technology. */
export function CheckGlyph({ state, className }: { state: CheckState; className?: string }) {
  const { glyph: Glyph, tone } = checkStateLook[state]
  return (
    <span
      role="img"
      aria-label={checkStateNames[state]}
      data-slot="check-glyph"
      data-state={state}
      data-tone={tone}
      className={cn('inline-flex shrink-0 text-tone-dot', className)}
    >
      <Glyph aria-hidden="true" className="size-4" />
    </span>
  )
}

function CheckRow({
  reading,
  number,
  details,
}: {
  reading: CheckReading
  number?: number
  details?: ReactNode
}) {
  return (
    <li
      data-slot="check-row"
      data-level={reading.level}
      data-state={reading.state}
      className="flex gap-3 border-b py-3 first:pt-0 last:border-b-0 last:pb-0"
    >
      <CheckGlyph state={reading.state} className="h-5 items-center" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-dense font-bold">
          {number === undefined ? null : (
            <>
              <span className="tabular-nums">{number}</span>{' '}
            </>
          )}
          {checkLevelNames[reading.level]}
        </p>
        <p className="text-caption text-muted-foreground">{reading.summary}</p>
        {reading.notes.length ? (
          <ul className="flex list-disc flex-col gap-1 pl-4 text-caption">
            {reading.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
        {details ? (
          <Collapsible className="flex flex-col gap-2">
            <CollapsibleTrigger className="group/details inline-flex w-fit items-center gap-1 rounded-sm text-caption font-bold text-muted-foreground hover:text-foreground">
              <ChevronDownIcon
                aria-hidden="true"
                className="size-icon-sm -rotate-90 transition-transform group-data-panel-open/details:rotate-0"
              />
              Details
              <span className="sr-only"> of {checkLevelNames[reading.level]}</span>
            </CollapsibleTrigger>
            <CollapsibleContent>{details}</CollapsibleContent>
          </Collapsible>
        ) : null}
      </div>
    </li>
  )
}

function CheckList({
  readings,
  numbered,
  renderDetails,
}: {
  readings: CheckReading[]
  numbered: boolean
  renderDetails?: (level: CheckReading['level']) => ReactNode
}) {
  return (
    <ol aria-label="Checks" className="flex flex-col">
      {readings.map((reading, index) => (
        <CheckRow
          key={reading.level}
          reading={reading}
          number={numbered ? index + 1 : undefined}
          details={renderDetails?.(reading.level)}
        />
      ))}
    </ol>
  )
}

/** "7 October 2026", the day of the edition the checks ran against: a review names no number. */
function editionDayWords(edition: string): string {
  const day = parseEditionLabel(edition)?.day
  return day ? formatDay(day, 'long') : 'that day'
}

function CheckedAgainst({ edition, action }: { edition: string | null; action?: ReactNode }) {
  if (!edition && !action) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-caption text-muted-foreground">
      {edition ? (
        <span className="inline-flex min-w-0 flex-wrap items-center gap-1">
          Checked against what agents got on {editionDayWords(edition)}
        </span>
      ) : (
        <span />
      )}
      {action}
    </div>
  )
}

/** How many levels the risk requires, and the help on what a check is, when there are either. */
function RequiredLine({
  required,
  risk,
  help,
}: {
  required: Gate['required']
  risk: RiskLevel | null
  help: ReactNode
}) {
  if (!risk && !help) return null
  return (
    <p className="text-caption text-muted-foreground">
      {risk ? requiredLine(required, risk) : null}
      {risk && help ? ' ' : null}
      {help}
    </p>
  )
}

type GateResultProps = {
  gate: Pick<Gate, 'required' | 'levels'>
  /** The proposal's risk: it sets how many levels are required, and the line that says so. */
  risk?: RiskLevel | null
  /** "1 Format": the review screen numbers the levels, the status page does not. */
  numbered?: boolean
  /** Beside the title, such as the risk badge. */
  aside?: ReactNode
  /** At the end of the footer, such as Run again (the review screen). */
  action?: ReactNode
  /** A help link after the line on what is required (the review screen). */
  help?: ReactNode
  /**
   * `card` is the checks part (a section in a page rail). `folded` is one row that opens the
   * list, for a phone and for a page where the checks are not the point (the status page on a
   * phone).
   */
  variant?: 'card' | 'folded'
  headingLevel?: 2 | 3
  /**
   * What a level found beyond its sentence, behind a Details disclosure: the probes, the
   * delivery questions, the answer run (the review screen). Null for a level with nothing more.
   */
  renderDetails?: (level: CheckReading['level']) => ReactNode
  className?: string
}

/** The required levels with their outcomes, as a part of the page rail or as one folded row. */
export function GateResult({
  gate,
  risk = null,
  numbered = false,
  aside,
  action,
  help,
  variant = 'card',
  headingLevel = 2,
  renderDetails,
  className,
}: GateResultProps) {
  const readings = useMemo(() => readGate(gate), [gate])
  const edition = checkedEdition(gate)
  const inRail = useInRail()
  if (variant === 'folded') {
    const overall = gateState(readings)
    return (
      <Collapsible
        data-slot="gate-result"
        data-variant="folded"
        className={cn(inRail ? railSectionClass : 'rounded-lg border bg-card', className)}
      >
        <CollapsibleTrigger
          className={cn(
            'group/fold flex min-h-control-touch w-full items-center gap-3 text-left',
            inRail ? 'rounded-sm' : 'rounded-lg px-4',
          )}
        >
          <ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 text-dense">
            <span className="font-bold">Checks:</span> {gateHeadline(readings)}
          </span>
          <CheckGlyph state={overall} />
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground transition-transform group-data-panel-open/fold:rotate-180"
          />
        </CollapsibleTrigger>
        <CollapsibleContent className={cn('flex flex-col gap-3', !inRail && 'px-4 pb-4')}>
          <RequiredLine required={gate.required} risk={risk} help={help} />
          <CheckList readings={readings} numbered={numbered} renderDetails={renderDetails} />
          <CheckedAgainst edition={edition} action={action} />
        </CollapsibleContent>
      </Collapsible>
    )
  }
  return (
    <PartCard
      title="Checks"
      aside={aside}
      headingLevel={headingLevel}
      data-slot="gate-result"
      data-variant="card"
      className={className}
    >
      <RequiredLine required={gate.required} risk={risk} help={help} />
      <CheckList readings={readings} numbered={numbered} renderDetails={renderDetails} />
      <CheckedAgainst edition={edition} action={action} />
    </PartCard>
  )
}

/**
 * The outcomes on one line, for a timeline row ("Checks ran"): each level's glyph and short name
 * in its tone. Wraps on a narrow column.
 */
export function CheckOutcomes({
  gate,
  className,
}: {
  gate: Pick<Gate, 'required' | 'levels'>
  className?: string
}) {
  const readings = readGate(gate)
  return (
    <ul
      data-slot="check-outcomes"
      aria-label="Check outcomes"
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-dense', className)}
    >
      {readings.map((reading) => (
        <li
          key={reading.level}
          data-tone={checkStateLook[reading.state].tone}
          className={cn(
            'inline-flex items-center gap-1',
            reading.state === 'not_run' ? 'text-muted-foreground' : 'text-tone-ink',
          )}
        >
          <CheckGlyph state={reading.state} className="[&>svg]:size-icon-sm" />
          {checkLevelShortNames[reading.level]}
        </li>
      ))}
    </ul>
  )
}
