import * as React from 'react'
import { ArrowRightIcon, ArrowUpIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { MentionChip } from '@/components/heed/mention-chip'
import { changeIcons } from '@/components/heed/change-icons'
import { countWord, marks, type Block, type ChangeKind, type Seg } from '@/model/review'

// The parts of a review, drawn so a change is easy to see and to separate from the next one. Each
// change sits in its own block under a quiet kind label. Marks are never colour alone: added words
// are underlined, removed words struck through, formatting has a dotted underline and says what
// changed, a link shows its old and new address, a moved step says where it came from.

/** Each kind's mark colour; the colour is always paired with the glyph and the word. */
const tones: Record<ChangeKind, string> = {
  Wording: 'bg-[var(--mark-add)]',
  Added: 'bg-[var(--mark-add)]',
  Removed: 'bg-[var(--mark-del)]',
  Formatting: 'bg-[var(--mark-fmt)]',
  Link: 'bg-[var(--mark-link)]',
  Order: 'bg-[var(--mark-move)]',
  Dates: 'bg-[var(--mark-link)]',
}

/** The quiet label over a change block: a small swatch, the glyph and the word. */
export function KindLabel({
  kind,
  n,
  className,
}: {
  kind: ChangeKind
  n?: number
  className?: string
}) {
  const Icon = changeIcons[kind]
  const tone = tones[kind]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-foreground',
        className,
      )}
    >
      <span aria-hidden className={cn('size-2 rounded-xs', tone)} />
      <Icon aria-hidden className="size-3.5 text-muted-foreground" />
      {n !== undefined && <span className="tabular-nums">{n}</span>}
      {n !== undefined ? countWord(kind, n) : kind}
    </span>
  )
}

/** A run of marked text. */
export function Marked({
  segs,
  active,
  className,
}: {
  segs: Seg[]
  active?: number
  className?: string
}) {
  // Each mark's number among the changes, for stepping through them.
  const numbers = segs.reduce<number[]>(
    (acc, s) => [...acc, s.t === 'same' ? -1 : acc.filter((n) => n >= 0).length],
    [],
  )
  return (
    <span className={className}>
      {segs.map((s, i) => {
        if (s.t === 'same') return <React.Fragment key={i}>{s.text}</React.Fragment>
        const change = numbers[i]
        const on = active === change
        if (s.t === 'add')
          return (
            <ins
              key={i}
              data-change={change}
              className={cn(
                'rounded-mark bg-[var(--mark-add)] px-0.5 text-foreground underline decoration-[var(--mark-add-line)] decoration-2 underline-offset-3',
                on && 'ring-2 ring-ring',
              )}
            >
              <span className="sr-only">[added: </span>
              {s.text}
              <span className="sr-only">]</span>
            </ins>
          )
        if (s.t === 'del')
          return (
            <del
              key={i}
              data-change={change}
              className={cn(
                'rounded-mark bg-[var(--mark-del)] px-0.5 text-foreground/80 decoration-[var(--mark-del-line)] decoration-2',
                on && 'ring-2 ring-ring',
              )}
            >
              <span className="sr-only">[removed: </span>
              {s.text}
              <span className="sr-only">]</span>
            </del>
          )
        return (
          <span
            key={i}
            data-change={change}
            className="rounded-mark bg-[var(--mark-fmt)] px-0.5 underline decoration-[var(--mark-fmt-line)] decoration-dotted decoration-2 underline-offset-3"
          >
            <span
              className={cn(s.note === 'Bold' && 'font-semibold', s.note === 'Italic' && 'italic')}
            >
              {s.text}
            </span>
            {s.note && (
              <span className="ml-1 rounded-sm bg-[var(--mark-fmt-line)] px-1 align-(--nudge) text-3xs font-medium text-mark-fmt-ink">
                {s.note}
              </span>
            )}
          </span>
        )
      })}
    </span>
  )
}

/** One change, in its own block: the kind label and field on top, the change in the style that fits it. */
export function ChangeBlock({
  block,
  index,
  total,
}: {
  block: Block
  index: number
  total: number
}) {
  return (
    <section className="flex flex-col gap-3 border-t py-6 first:border-t-0 first:pt-2">
      <header className="flex items-center gap-2">
        <KindLabel kind={block.kind} />
        <span className="text-xs text-muted-foreground">{block.field}</span>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {index + 1} of {total}
        </span>
      </header>
      <BlockBody block={block} />
    </section>
  )
}

function BlockBody({ block }: { block: Block }) {
  switch (block.kind) {
    case 'Wording':
      return <Marked segs={marks(block.text)} className="text-reading leading-7" />
    case 'Added':
    case 'Removed':
      return (
        <p
          className={cn(
            'border-l-2 pl-3 text-reading leading-7',
            block.kind === 'Added'
              ? 'border-[var(--mark-add-line)]'
              : 'border-[var(--mark-del-line)] line-through',
          )}
        >
          <span className="sr-only">{block.kind === 'Added' ? 'Added: ' : 'Removed: '}</span>
          {block.text}
        </p>
      )
    case 'Formatting':
      return (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">{block.label}</p>
          {block.list ? (
            <div className="border-l-2 border-dotted border-[var(--mark-fmt-line)] pl-3">
              <ol className="list-decimal pl-5 text-reading leading-7">
                {block.list.items.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ol>
              <p className="mt-1 text-xs text-muted-foreground">
                Was a bulleted list. A numbered list says the order matters.
              </p>
            </div>
          ) : (
            <Marked segs={marks(block.text)} className="text-reading leading-7" />
          )}
        </div>
      )
    case 'Link':
      if ('mention' in block)
        return (
          <div className="flex flex-col gap-1.5 text-sm">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-reading">
              {block.mention.change === 'added' ? 'Now links to' : 'No longer links to'}
              <MentionChip mention={{ id: block.mention.id, label: block.mention.label }} />
            </p>
            <p className="text-xs text-muted-foreground">
              {block.text} A link is what an agent can follow from this item; it never changes what
              an answer includes.
            </p>
          </div>
        )
      return (
        <div className="flex flex-col gap-2 text-sm">
          <p className="text-reading">
            <span className="underline decoration-[var(--mark-link-line)] decoration-2 underline-offset-3">
              {block.text}
            </span>
            <span className="ml-2 text-xs text-muted-foreground">same words, new address</span>
          </p>
          <dl className="grid grid-cols-(--cols-lead-14) gap-x-3 gap-y-1.5 font-mono text-xs">
            <dt className="font-sans text-muted-foreground">Was</dt>
            <dd className="break-all text-muted-foreground line-through decoration-[var(--mark-del-line)]">
              {block.before}
            </dd>
            <dt className="font-sans text-muted-foreground">Now</dt>
            <dd className="break-all">
              <span className="rounded-mark bg-[var(--mark-link)] px-0.5">{block.after}</span>
            </dd>
          </dl>
        </div>
      )
    case 'Order':
      return (
        <ol className="flex flex-col gap-1.5 text-reading leading-7">
          {block.steps.map((s, i) => (
            <li
              key={s.text}
              className={cn(
                'grid grid-cols-(--cols-lead-6) gap-2 rounded-md py-1 pr-2',
                s.from && 'border-l-2 border-[var(--mark-move-line)] bg-[var(--mark-move)] pl-2',
              )}
            >
              <span className="text-muted-foreground tabular-nums">{i + 1}.</span>
              <span>
                {s.text}
                {s.from && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <ArrowUpIcon aria-hidden className="size-3" />
                    {block.label}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )
    case 'Dates':
      return <DatesChange block={block} />
  }
}

/** Was and now, with a small timeline of the days it now applies when the change stays in one month. */
function DatesChange({ block }: { block: Extract<Block, { kind: 'Dates' }> }) {
  const span = block.span
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-md border px-2 py-1 text-muted-foreground line-through decoration-[var(--mark-del-line)]">
          {block.before}
        </span>
        <ArrowRightIcon aria-hidden className="size-4 text-muted-foreground" />
        <span className="rounded-md border bg-[var(--mark-add)] px-2 py-1 font-medium">
          {block.after}
        </span>
      </div>
      {span && <DatesTimeline span={span} />}
    </div>
  )
}

/** The days it applied and the days it now applies, on a strip of the month, and what that means. */
function DatesTimeline({ span }: { span: NonNullable<Extract<Block, { kind: 'Dates' }>['span']> }) {
  const start = span.from - 2
  const end = Math.max(span.was, span.now) + 5
  const at = (d: number) => `${((d - start) / (end - start)) * 100}%`
  const longer = span.now > span.was
  const [low, high] = longer ? [span.was, span.now] : [span.now, span.was]
  const days = `${low + 1} to ${high} ${span.month}`
  return (
    <>
      <div aria-hidden className="relative h-10">
        <div className="absolute inset-x-0 top-3 h-px bg-border" />
        <div
          className="absolute top-1.5 h-3 rounded-sm bg-muted-foreground/40"
          style={{
            left: at(span.from),
            width: `calc(${at(Math.min(span.was, span.now))} - ${at(span.from)})`,
          }}
        />
        <div
          className={cn(
            'absolute top-1.5 h-3 rounded-r-sm ring-1 ring-inset',
            longer
              ? 'bg-(image:--hatch-add) ring-[var(--mark-add-line)]'
              : 'bg-[var(--mark-del)] ring-[var(--mark-del-line)]',
          )}
          style={{ left: at(low), width: `calc(${at(high)} - ${at(low)})` }}
        />
        {[span.from, span.was, span.now].map((d) => (
          <span
            key={d}
            className="absolute top-6 -translate-x-1/2 text-2xs text-muted-foreground tabular-nums"
            style={{ left: at(d) }}
          >
            {d} {span.month}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {longer
          ? `${high - low === 7 ? 'One more week: a' : 'A'}gents get it for questions about ${days} too.`
          : `Agents no longer get it for questions about ${days}.`}
      </p>
    </>
  )
}
