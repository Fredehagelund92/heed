import * as React from 'react'
import type { LoopItem, LoopRun, LoopTurn } from '@contract/answer'
import { dimensionHue, nounKindOf } from '@domain/ask-nouns'
import type { Domain } from '@/model/people'
import type { Kind, Status } from '@/model/items'
import type { AnswerActions, ReportLine, SomethingWrong } from '@/components/heed/answer'
import type { LoopPartsOfAsk } from '@/components/heed/loop-parts'

/** What the loop's answer uses of Ask, handed to it by Ask (loop-parts.ts). */
export type LoopParts = LoopPartsOfAsk & {
  AnswerActions: typeof AnswerActions
  ReportLine: typeof ReportLine
  SomethingWrong: typeof SomethingWrong
}
export const PartsContext = React.createContext<LoopParts | null>(null)
/** Ask's parts, as the answer was given them. */
export function useParts(): LoopParts {
  const parts = React.useContext(PartsContext)
  if (!parts) throw new Error('A loop answer is drawn inside its parts.')
  return parts
}

/*
  The nouns of Ask's loop answers, one look each, the same in the words, the rows, the read line
  and the hover cards: a metric is a solid tinted chip with its sigma; a value of a dimension an
  outline in its dimension's own hue, with the icon its source's value type picks (a tag when it
  gives none); a dimension a dashed outline; a domain its own dot; a person their face and name;
  a day words with a dotted underline; a count bold with what it is out of; a context item a
  number where it is cited. Every hue comes from an id, never a name: no dimension, domain or
  person is special. Each opens its own card on hover, on keyboard focus and on a press; Escape
  closes it and focus comes back.
*/

type Noun = LoopTurn['nouns'][number]
export type Nouns = ReadonlyMap<string, Noun>

const key = (id: string) => id.slice(id.indexOf(':') + 1)

/** A domain of the workspace by a noun's id: its own id, or the service's `area_` one. */
function useDomainOf(id: string | null | undefined): Domain | undefined {
  const P = useParts()
  const domains = P.useDomains()
  if (!id) return undefined
  const k = key(id)
  return domains[k] ?? domains[k.replace(/^area_/, '')]
}

/**
 * A dimension's icon, or its value's: the dimension's own split, or the icon its source's value
 * type picks for a value: a day for time, a globe for places, else a tag.
 */
function DimensionGlyph({ dimension, type }: { dimension: boolean; type: string | null }) {
  const P = useParts()
  const cls = 'size-3 shrink-0'
  if (dimension) return <P.SplitIcon aria-hidden className={cls} />
  if (type === 'time') return <P.CalendarIcon aria-hidden className={cls} />
  if (type === 'geo') return <P.GlobeIcon aria-hidden className={cls} />
  return <P.TagIcon aria-hidden className={cls} />
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
/** A day as the answer says it: "4 August 2026"; `short` as a row says it: "4 Aug 2026". */
export function dayText(day: string, short = false) {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  const month = MONTHS[(m ?? 1) - 1] ?? ''
  return `${d} ${short ? month.slice(0, 3) : month} ${y}`
}

// 24px tall at the least, so each is a target a pointer can hit (WCAG 2.5.8).
const chip =
  'inline-flex min-h-6 max-w-full items-center gap-1 rounded-sm px-1.5 py-px align-baseline text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * A trigger with its card: hover opens it after a moment, keyboard focus opens it at once, a press
 * keeps it open; Escape or a press outside closes it.
 */
function HoverCard({
  trigger,
  label,
  children,
  onOpen,
  still,
}: {
  trigger: React.ReactElement<Record<string, unknown>>
  label: string
  children: React.ReactNode
  onOpen?: () => void
  /** Inside another control: the chip alone, with no card of its own. */
  still?: boolean
}) {
  const P = useParts()
  const [open, setOpen] = React.useState(false)
  const returning = React.useRef(false)
  const card = React.useRef<HTMLDivElement>(null)
  if (still) return trigger
  return (
    <P.Popover
      open={open}
      onOpenChange={(next, { reason }) => {
        const o = reason === 'trigger-press' ? !open || next : next
        if (!o && card.current?.contains(document.activeElement)) returning.current = true
        setOpen(o)
      }}
    >
      <P.PopoverTrigger
        openOnHover
        delay={120}
        closeDelay={100}
        nativeButton={false}
        render={trigger}
        onFocus={(e) => {
          if (returning.current) returning.current = false
          else if (e.currentTarget.matches(':focus-visible')) setOpen(true)
        }}
        onClick={onOpen}
      />
      <P.PopoverContent
        side="top"
        align="start"
        initialFocus={false}
        ref={card}
        aria-label={label}
        className="w-72 gap-1.5 p-3"
      >
        {children}
      </P.PopoverContent>
    </P.Popover>
  )
}

const kindWords: Record<string, string> = {
  metric: 'metric',
  dimension: 'dimension',
  value: 'value',
  domain: 'domain',
  person: 'person',
}

/** One noun as its chip, with its card. */
export function NounChip({
  id,
  nouns,
  still,
}: {
  id: string
  nouns: Nouns
  /** Inside another control, such as a button: drawn, with no card and no press of its own. */
  still?: boolean
}) {
  const P = useParts()
  const noun = nouns.get(id)
  const kind = nounKindOf(id)
  const domain = useDomainOf(kind === 'domain' ? id : null)
  const name = noun?.name ?? (kind === 'domain' ? domain?.name : undefined) ?? key(id)
  // Its name as shown, then what it is, said to a screen reader: "Orders, metric".
  const said = <span className="sr-only">, {kind ? kindWords[kind] : 'name'}</span>
  const button = (className: string, style?: React.CSSProperties, body?: React.ReactNode) => (
    <span
      role={still ? undefined : 'button'}
      tabIndex={still ? undefined : 0}
      style={style}
      className={P.cn(chip, className)}
    >
      {body}
      {said}
    </span>
  )
  switch (kind) {
    case 'metric': {
      const tone = P.chipTone('metric')
      return (
        <HoverCard
          label={name}
          still={still}
          trigger={button(
            P.cn(tone.className, 'cursor-pointer'),
            tone.style,
            <>
              <P.SigmaIcon aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{name}</span>
            </>,
          )}
          onOpen={() => P.openDock('def', name)}
        >
          <MetricCard name={name} />
        </HoverCard>
      )
    }
    case 'value':
    case 'dimension': {
      const dimension = kind === 'value' ? noun?.of : { id, name }
      // The outline in the dimension's own hue, the chip dot's: 3:1 or more in both themes.
      const style = {
        '--chip-h': dimensionHue(dimension?.id ?? id),
        borderColor: 'oklch(0.62 0.14 var(--chip-h))',
      } as React.CSSProperties
      return (
        <HoverCard
          label={name}
          still={still}
          trigger={button(
            P.cn(
              'border bg-transparent text-chip-foreground',
              kind === 'dimension' && 'border-dashed',
            ),
            style,
            <>
              <DimensionGlyph dimension={kind === 'dimension'} type={noun?.type ?? null} />
              <span className="min-w-0 truncate">{name}</span>
            </>,
          )}
        >
          <p className="text-xs text-muted-foreground">
            {kind === 'value' ? `A value of ${dimension?.name ?? 'a dimension'}` : 'A dimension'}
          </p>
          <p className="text-sm font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">
            {kind === 'value'
              ? `What context items apply to when they name ${name}.`
              : `Every value of ${name}.`}
          </p>
        </HoverCard>
      )
    }
    case 'domain': {
      const hue = P.domainHue(key(id).replace(/^area_/, ''))
      return (
        <HoverCard
          label={name}
          still={still}
          trigger={button(
            'bg-muted text-foreground',
            undefined,
            <>
              <span
                aria-hidden
                style={{ '--chip-h': hue } as React.CSSProperties}
                className="size-2 shrink-0 self-center rounded-full bg-chip-dot"
              />
              <span className="min-w-0 truncate">{name}</span>
            </>,
          )}
        >
          <p className="text-xs text-muted-foreground">Domain</p>
          <p className="text-sm font-medium">{name}</p>
          {domain?.covers && <p className="text-sm text-muted-foreground">{domain.covers}</p>}
          {!!domain?.owners.length && (
            <p className="text-xs text-muted-foreground">Owners: {domain.owners.join(', ')}</p>
          )}
        </HoverCard>
      )
    }
    case 'person':
      return <PersonChip name={name} still={still} />
    default:
      return <>{name}</>
  }
}

function PersonChip({ name, still }: { name: string; still?: boolean }) {
  const P = useParts()
  const person = P.usePeople().find((p) => p.name === name)
  return (
    <HoverCard
      label={name}
      still={still}
      trigger={
        <span
          role={still ? undefined : 'button'}
          tabIndex={still ? undefined : 0}
          className={P.cn(chip, 'px-0.5 font-normal')}
        >
          <span aria-hidden className="inline-flex">
            <P.PersonAvatar name={name} size={16} />
          </span>
          {/* The name alone sets the chip's baseline, so it sits on the line with the words around
              it, not the initials in the face. */}
          <span className="min-w-0 self-baseline truncate">{name}</span>
          <span className="sr-only">, person</span>
        </span>
      }
    >
      <div className="flex items-center gap-2.5">
        <P.PersonAvatar name={name} size={32} />
        <div className="min-w-0">
          <p className="truncate font-medium">{name}</p>
          {person?.role && <p className="truncate text-xs text-muted-foreground">{person.role}</p>}
          {person?.email && (
            <p className="truncate text-xs text-muted-foreground">{person.email}</p>
          )}
        </div>
      </div>
    </HoverCard>
  )
}

/** A metric's card: its definition as its tool words it, its domain and owners, and the way to it. */
function MetricCard({ name }: { name: string }) {
  const P = useParts()
  const d = P.useDefinitions().find((x) => x.name === name && x.type === 'metric')
  const domain = useDomainOf(d?.domain ? `domain:${d.domain}` : null)
  return (
    <>
      <p className="text-xs text-muted-foreground">Metric{d?.tool ? ` · from ${d.tool}` : ''}</p>
      <p className="text-sm font-medium">{name}</p>
      {d?.definition && (
        <p className="line-clamp-3 text-sm text-muted-foreground">{d.definition}</p>
      )}
      {domain && (
        <p className="text-xs text-muted-foreground">
          In {domain.name}
          {domain.owners.length ? ` · owners ${domain.owners.join(', ')}` : ''}
          {d?.sourceNames.length ? ` · also called ${d.sourceNames.join(', ')}` : ''}
        </p>
      )}
      <button
        type="button"
        onClick={() => P.openDock('def', name)}
        className="w-fit rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Open the definition
      </button>
    </>
  )
}

/** A context item's kind as the reads name it ("rule", "warning") or as the app does. */
const kindOf = (kind: string): Kind =>
  kind === 'warning'
    ? 'issue'
    : kind === 'event' || kind === 'guide' || kind === 'issue'
      ? kind
      : 'note'

/** A row's status as the Context list says it, with its day: "Live · checked 12 Sep 2026". */
export function statusWords(item: Pick<LoopItem, 'status' | 'checked' | 'outOfDate'>) {
  const due = item.status === 'due' || !!item.outOfDate
  return {
    due,
    words: (item.status === 'archived' ? 'Archived' : due ? 'Needs checking' : 'Live') as Status,
    day: item.outOfDate ?? (item.checked ? `checked ${dayText(item.checked, true)}` : null),
  }
}

/** A status with its dot, as the Context list draws it: live green, needs checking amber. */
function StatusMark({ status }: { status: Status }) {
  const dot = status === 'Live' ? 'bg-good' : status === 'Needs checking' ? 'bg-caution' : 'bg-off'
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className={`size-2 shrink-0 rounded-full ${dot}`} />
      {status}
    </span>
  )
}

/** A citation: its number where it is cited; its card names the item, and a press opens it. */
export function CiteMark({ n, item }: { n: number; item?: LoopItem }) {
  const P = useParts()
  const marker =
    'relative ml-0.5 mr-px inline-flex h-6 min-w-6 -translate-y-px items-center justify-center rounded-md bg-muted px-1.5 align-middle text-xs font-medium text-foreground tabular-nums outline-none after:absolute after:-inset-[13px] hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50'
  if (!item)
    return (
      <span className={marker} aria-label={`Source ${n}`}>
        {n}
      </span>
    )
  return (
    <HoverCard
      label={item.title}
      trigger={
        <span
          role="button"
          tabIndex={0}
          aria-label={`Source ${n}: ${item.title}`}
          className={marker}
        >
          {n}
        </span>
      }
      onOpen={() => P.openDock('context', item.id)}
    >
      <ItemCard item={item} />
    </HoverCard>
  )
}

/** An item's card: its kind and domain, its status, who checked it and when, what it says. */
function ItemCard({ item }: { item: LoopItem }) {
  const P = useParts()
  // Its card is showing: the quick view it opens is read ahead.
  P.useReadCitedAhead([item.id], true)
  const fact = P.useFacts().find((f) => f.id === item.id)
  const domain = useDomainOf(item.domain)
  const Icon = P.kindIcons[kindOf(item.kind)]
  const status = statusWords(item)
  return (
    <>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon aria-hidden className="size-3.5" />
        {domain?.name ?? 'Context item'}
      </p>
      <p className="text-sm leading-snug font-medium">{item.title}</p>
      <p className="text-xs text-muted-foreground">
        {status.words}
        {fact?.checkedBy
          ? ` · checked by ${fact.checkedBy}, ${fact.checkedOn}`
          : status.day
            ? ` · ${status.day}`
            : ''}
      </p>
      {fact?.summary && (
        <p className="line-clamp-3 text-sm text-muted-foreground">{fact.summary}</p>
      )}
      <button
        type="button"
        onClick={() => P.openDock('context', item.id)}
        className="w-fit rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Open it
      </button>
    </>
  )
}

/**
 * Runs of words as the answer draws them. A noun gets its chip the first time the answer names it
 * (`seen`), plain words after; punctuation right after a chip stays with it on the line.
 */
export function Runs({
  runs,
  nouns,
  items,
  seen,
}: {
  runs: readonly LoopRun[]
  nouns: Nouns
  items: ReadonlyMap<number, LoopItem>
  seen?: Set<string>
}) {
  return (
    <>
      {runs.map((r, i) => {
        switch (r.t) {
          case 'text':
            return <React.Fragment key={i}>{r.text}</React.Fragment>
          case 'noun': {
            if (seen?.has(r.id))
              return <React.Fragment key={i}>{nouns.get(r.id)?.name ?? key(r.id)}</React.Fragment>
            seen?.add(r.id)
            return <NounChip key={i} id={r.id} nouns={nouns} />
          }
          case 'cite':
            return <CiteMark key={i} n={r.n} item={items.get(r.n)} />
          case 'count':
            return (
              <React.Fragment key={i}>
                <span className="font-semibold tabular-nums">{r.value}</span>
                {r.of && ` ${r.of}`}
              </React.Fragment>
            )
          case 'date':
            return (
              <time
                key={i}
                dateTime={r.day}
                className="tabular-nums underline decoration-dotted underline-offset-4"
              >
                {dayText(r.day)}
              </time>
            )
        }
      })}
    </>
  )
}

/**
 * One item as a row: its kind's icon, its title (its number first when the answer cites it), and
 * a line with what it applies to, its domain, its status and its day, so two items with the same
 * title are told apart. A press opens it.
 */
export function ItemRow({
  item,
  nouns,
  twin,
}: {
  item: LoopItem
  nouns: Nouns
  /** Another row has the same title. */
  twin?: boolean
}) {
  const P = useParts()
  const ahead = P.useReadAhead()
  const Icon = P.kindIcons[kindOf(item.kind)]
  const status = statusWords(item)
  const values = item.about.filter((id) => id.startsWith('value:'))
  return (
    <li className="flex flex-col gap-1">
      <span className="flex items-start gap-2 text-sm">
        {item.n ? (
          <CiteMark n={item.n} item={item} />
        ) : (
          <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <button
          type="button"
          {...ahead(item.id)}
          onClick={() => P.openDock('context', item.id)}
          className="rounded-sm text-left font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {item.n && <Icon aria-hidden className="mr-1 inline size-3.5 text-muted-foreground" />}
          {item.title}
        </button>
      </span>
      <span className="ml-6 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
        {values.map((id) => (
          <NounChip key={id} id={id} nouns={nouns} />
        ))}
        {item.domain && <NounChip id={item.domain} nouns={nouns} />}
        {/* One run of words, a no-break space before each dot: a wrapped line never starts with one. */}
        <span className="min-w-0">
          <StatusMark status={status.words} />
          {status.day && `\u00a0· ${status.day}`}
          {twin && '\u00a0· another item with the same title'}
        </span>
      </span>
    </li>
  )
}
