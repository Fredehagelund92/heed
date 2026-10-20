import type { Area } from '@domain/item'
import type { Verdict as RunVerdict } from '@domain/golden-question'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleXIcon,
  FlaskConicalIcon,
  HeedRecheckDueIcon,
  ListChecksIcon,
  MinusIcon,
  SearchXIcon,
  type Icon,
} from '@/components/icons'
import { DomainBadge } from '@/components/item/item-marks'
import { Badge } from '@/components/ui/badge'
import {
  fixKindWords,
  formatRate,
  stateWords,
  verdictWords,
  type Change,
  type DomainState,
  type FixEntry,
} from '@/lib/quality'
import { cn } from '@/lib/utils'

/*
  The marks of the test results (Quality design, direction C; the Workbench shows them), all forms of the Reference badge and
  the status grammar: colour always comes with an arrow, an icon or a word (NFR-111). A healthy
  domain is quiet: "Steady" is plain muted words, and only a state that asks for a look is a
  tinted badge.
*/

/**
 * A change with its arrow and signed size (contract 6.1, "Status": a trend mark): green when it
 * went the better way, red when the worse, muted when there is none or it has no better way.
 * The arrow and the sign carry the direction for anyone who cannot tell the two hues apart, and
 * the words say it all for a screen reader, and on hover.
 */
export function ChangeMark({
  change,
  better = 'up',
  className,
}: {
  change: Pick<Change, 'direction' | 'text' | 'spoken'> | null
  /**
   * Which way is better: down for a share that should fall, such as cause claims; none for a
   * change that is not judged (a volume, or a share of too few to tell), which stays muted.
   */
  better?: 'up' | 'down' | 'none'
  className?: string
}) {
  if (!change) return null
  const verdict =
    change.direction === 'flat' || better === 'none'
      ? 'none'
      : change.direction === better
        ? 'better'
        : 'worse'
  const Glyph =
    change.direction === 'up'
      ? ArrowUpIcon
      : change.direction === 'down'
        ? ArrowDownIcon
        : MinusIcon
  return (
    <span
      data-slot="change-mark"
      data-direction={change.direction}
      data-verdict={verdict}
      className={cn(
        'inline-flex items-center gap-1 text-dense whitespace-nowrap tabular-nums',
        verdict === 'better'
          ? 'text-status-success-fg'
          : verdict === 'worse'
            ? 'text-status-danger-fg'
            : 'text-muted-foreground',
        className,
      )}
    >
      <span aria-hidden="true" title={sentence(change.spoken)} className="contents">
        <Glyph className="size-icon-sm shrink-0" />
        <span>{change.text}</span>
      </span>
      <span className="sr-only">{change.spoken}</span>
    </span>
  )
}

const sentence = (words: string) => words.charAt(0).toUpperCase() + words.slice(1)

/** A share and its change, stacked, as a grid cell and a tile show it. */
export function RateValue({
  rate,
  change,
  danger = false,
  empty = 'No data yet',
}: {
  rate: number | null | undefined
  change: Change | null
  /** The share itself asks for a look (a large drop). */
  danger?: boolean
  empty?: string
}) {
  const text = formatRate(rate)
  if (text === null) return <span className="text-dense text-muted-foreground">{empty}</span>
  return (
    <span className="flex min-w-0 flex-col">
      <span className={cn('font-bold tabular-nums', danger && 'text-status-danger-fg')}>
        {text}
      </span>
      <ChangeMark change={change} />
    </span>
  )
}

/** Where a domain's tests stand: muted words when steady or with none yet, a badge when it asks for a look. */
export function DomainStateMark({ state }: { state: DomainState }) {
  if (state.kind === 'failing')
    return (
      <Badge tone="warning" icon={FlaskConicalIcon} data-slot="domain-state">
        {stateWords(state)}
      </Badge>
    )
  if (state.kind === 'attention')
    return (
      <Badge tone="danger" icon={CircleAlertIcon} title={state.reason} data-slot="domain-state">
        {stateWords(state)}
      </Badge>
    )
  return (
    <span data-slot="domain-state" className="text-muted-foreground">
      {stateWords(state)}
    </span>
  )
}

/** Questions that got better and worse since the run before: "2 better, 1 worse". */
export function FlipsMark({
  flips,
}: {
  flips: { better: number; worse: number } | null | undefined
}) {
  if (!flips) return <span className="text-dense text-muted-foreground">Not compared</span>
  if (flips.better + flips.worse === 0) return <span className="text-muted-foreground">None</span>
  return (
    <span className="flex flex-col text-dense tabular-nums">
      {flips.better ? (
        <span className="inline-flex items-center gap-1 text-status-success-fg">
          <ArrowUpIcon aria-hidden="true" className="size-icon-sm" />
          {flips.better.toLocaleString('en')} better
        </span>
      ) : null}
      {flips.worse ? (
        <span className="inline-flex items-center gap-1 text-status-danger-fg">
          <ArrowDownIcon aria-hidden="true" className="size-icon-sm" />
          {flips.worse.toLocaleString('en')} worse
        </span>
      ) : null}
    </span>
  )
}

const fixGlyphs: Record<FixEntry['kind'], Icon> = {
  regression: ArrowDownIcon,
  failing_question: FlaskConicalIcon,
  gap: SearchXIcon,
  past_review: HeedRecheckDueIcon,
  untested: ListChecksIcon,
}

/** The kind of a Fix next entry: a soft badge in its tone. */
export function FixKindBadge({ kind }: { kind: FixEntry['kind'] }) {
  const words = fixKindWords[kind]
  return (
    <Badge tone={words.tone} icon={fixGlyphs[kind]} data-slot="fix-kind">
      {words.label}
    </Badge>
  )
}

const verdictGlyphs: Record<RunVerdict, Icon> = {
  pass: CircleCheckIcon,
  fail: CircleXIcon,
  no_answer: CircleHelpIcon,
}

/** A question's verdict in a run: a quiet outline when it passes, a tinted badge when not. */
export function VerdictBadge({
  verdict,
  size = 'md',
}: {
  verdict: RunVerdict | null
  size?: 'md' | 'sm'
}) {
  if (verdict === null)
    return (
      <Badge form="outline" quiet size={size} icon={CircleDashedIcon}>
        Not run
      </Badge>
    )
  return (
    <Badge
      form={verdict === 'pass' ? 'outline' : 'soft'}
      tone={verdict === 'pass' ? 'success' : verdict === 'fail' ? 'danger' : 'warning'}
      size={size}
      icon={verdictGlyphs[verdict]}
      data-slot="verdict"
      data-verdict={verdict}
    >
      {verdictWords[verdict]}
    </Badge>
  )
}

/** A domain badge, or a quiet word for an area the reader cannot name. */
export function AreaBadge({ area, size }: { area: Area | undefined; size?: 'md' | 'sm' }) {
  if (!area) return <span className="text-muted-foreground">Unknown domain</span>
  return <DomainBadge name={area.name} label={area.label} size={size} />
}
