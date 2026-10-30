import * as React from 'react'
import { ChevronsUpDownIcon } from '@/components/icons'
import { MentionText } from '@/components/heed/mention-chip'
import { cn } from '@/lib/utils'
import {
  diffStats,
  hunks,
  lineDiff,
  linesWords,
  wordDiff,
  type Row,
  type Word,
} from '@/lib/line-diff'
import { fieldRows, type FieldRow } from '@/model/review-fields'
import type { FieldSide } from '@/model/review'

// The Source review's two parts, each fed two sides, so the same parts compare a suggestion with
// the live item today and, later, a live item with a suggestion beside it:
//
// - FieldsDiff, the Fields table: every field but the text, each row changed or the same, with
//   its value now and suggested. The unchanged rows fold into one line.
// - TextDiff, the stored text line by line, in the app's own font: line numbers, removed lines
//   before added ones, only the changed words marked when most of a line stays, and the unchanged
//   stretches folded, three lines kept around each change.
//
// Marks are never colour alone: a removed line has a minus and says "removed", removed words are
// struck through, added words underlined. Every change is a stop for N and P (`data-review-change`),
// which the page steps through.

/** What each side is called: "Now" and "Suggested" in a review. */
export type SideLabels = { before: string; after: string }
const REVIEW_SIDES: SideLabels = { before: 'Now', after: 'Suggested' }

/** A stop for N and P, ringed while it is the one stepped to. */
const stop =
  'scroll-mt-24 outline-none data-active:outline-2 data-active:-outline-offset-2 data-active:outline-ring data-active:outline-solid'

/* ---------- words ---------- */

/** Text with its mentions as chips, and its changed runs struck through or underlined. */
function Words({ words, side }: { words: Word[]; side: 'before' | 'after' }) {
  return words.map((w, i) =>
    !w.changed || !w.text.trim() ? (
      <MentionText key={i} text={w.text} />
    ) : side === 'before' ? (
      <del
        key={i}
        className="rounded-mark bg-mark-del-line/28 text-foreground decoration-[var(--mark-del-line)] decoration-2"
      >
        <span className="sr-only">[removed: </span>
        <MentionText text={w.text} />
        <span className="sr-only">]</span>
      </del>
    ) : (
      <ins
        key={i}
        className="rounded-mark bg-mark-add-line/28 text-foreground underline decoration-[var(--mark-add-line)] decoration-2 underline-offset-3"
      >
        <span className="sr-only">[added: </span>
        <MentionText text={w.text} />
        <span className="sr-only">]</span>
      </ins>
    ),
  )
}

/* ---------- the Fields table ---------- */

/** A value that was replaced whole: struck through on one side, underlined on the other. */
function Whole({
  text,
  side,
  marked,
}: {
  text: string
  side: 'before' | 'after'
  marked: boolean
}) {
  if (!marked) return <>{text}</>
  return <Words words={[{ text, changed: true }]} side={side} />
}

/** A name in Applies to, as a small chip; one added or removed says so in words and marks. */
function Name({ name, change }: { name: string; change?: 'added' | 'removed' }) {
  return (
    <li
      className={cn(
        'inline-flex h-6 items-center rounded-md border px-1.5 text-xs',
        change === 'added' &&
          'border-[var(--mark-add-line)] bg-[var(--mark-add)] underline decoration-[var(--mark-add-line)] underline-offset-3',
        change === 'removed' &&
          'border-[var(--mark-del-line)] bg-[var(--mark-del)] line-through decoration-[var(--mark-del-line)]',
      )}
    >
      {change && <span className="sr-only">{change}: </span>}
      {name}
    </li>
  )
}

/** A source: its address, with only the changed part marked, and the sentence copied from it. */
function SourceValue({
  source,
  other,
  side,
}: {
  source: FieldSide['sources'][number]
  other?: FieldSide['sources'][number]
  side: 'before' | 'after'
}) {
  const [l, r] = other
    ? side === 'before'
      ? wordDiff(source.url, other.url)
      : wordDiff(other.url, source.url)
    : [[{ text: source.url, changed: false }], [{ text: source.url, changed: false }]]
  const quote = other && other.quote !== source.quote
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <a
        href={source.url}
        target="_blank"
        rel="noreferrer"
        className="break-all underline decoration-muted-foreground/40 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Words words={side === 'before' ? l : r} side={side} />
      </a>
      {source.quote && (
        <q className="text-muted-foreground italic">
          {quote ? <Whole text={source.quote} side={side} marked /> : source.quote}
        </q>
      )}
    </div>
  )
}

/** One side of a row. */
function Value({ row, side }: { row: FieldRow; side: 'before' | 'after' }) {
  const marked = row.changed
  switch (row.type) {
    case 'words': {
      const text = row[side]
      if (text === undefined) return null
      if (!marked) return <>{text}</>
      const [l, r] = wordDiff(row.before!, row.after!)
      return <Words words={side === 'before' ? l : r} side={side} />
    }
    case 'value': {
      const text = row[side]
      return text === undefined ? null : <Whole text={text} side={side} marked={marked} />
    }
    case 'names': {
      const names = row[side]
      if (!names) return null
      if (!names.length) return <span className="text-muted-foreground">Nothing</span>
      return (
        <ul className="flex flex-wrap gap-1">
          {names.map((n) => (
            <Name
              key={n}
              name={n}
              change={
                side === 'before' && row.removed.includes(n)
                  ? 'removed'
                  : side === 'after' && row.added.includes(n)
                    ? 'added'
                    : undefined
              }
            />
          ))}
        </ul>
      )
    }
    case 'sources': {
      const list = row[side]
      if (!list) return null
      if (!list.length) return <span className="text-muted-foreground">Not set</span>
      const others = side === 'before' ? row.after : row.before
      return (
        <div className="flex flex-col gap-2">
          {list.map((s, i) => (
            <SourceValue
              key={`${s.url}-${i}`}
              source={s}
              other={marked ? others?.[i] : undefined}
              side={side}
            />
          ))}
        </div>
      )
    }
  }
}

/**
 * The Fields table: every field of the two sides. With both sides, the changed rows show their
 * value on each side and the unchanged ones fold into one line; a new item shows only what it
 * sets, an archive only what it had.
 */
export function FieldsDiff({
  before,
  after,
  labels = REVIEW_SIDES,
}: {
  before: FieldSide | null
  after: FieldSide | null
  labels?: SideLabels
}) {
  const id = React.useId()
  const [showSame, setShowSame] = React.useState(false)
  const rows = fieldRows(before, after)
  const both = !!before && !!after
  const changed = rows.filter((r) => r.changed)
  const same = both ? rows.filter((r) => !r.changed) : []
  const shown = both ? (showSame ? rows : changed) : rows
  const sides = (['before', 'after'] as const).filter((s) => (s === 'before' ? before : after))
  const line = both
    ? changed.length
      ? `${changed.length} changed, ${same.length} the same`
      : `All ${rows.length} the same`
    : after
      ? 'All set by the suggestion'
      : 'As they are now'
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={`${id}-h`} className="text-sm font-medium">
          Fields
        </h3>
        <span className="text-xs text-muted-foreground">{line}</span>
      </header>
      <div className="overflow-hidden rounded-frame border">
        {shown.length > 0 && (
          <table className="w-full table-fixed text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs text-muted-foreground @max-lg:sr-only">
              <tr>
                <th scope="col" className="w-32 px-3 py-2 font-medium">
                  Field
                </th>
                {sides.map((s) => (
                  <th key={s} scope="col" className="px-3 py-2 font-medium">
                    {labels[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr
                  key={row.key}
                  data-review-change={row.changed ? '' : undefined}
                  tabIndex={row.changed ? -1 : undefined}
                  aria-label={row.changed ? `${row.label}, changed` : undefined}
                  className={cn(
                    'border-t align-top first:border-t-0 @max-lg:grid @max-lg:gap-1 @max-lg:py-2',
                    row.changed && stop,
                  )}
                >
                  <th
                    scope="row"
                    className="px-3 py-2.5 text-left font-medium @max-lg:py-0 @max-lg:pt-0.5"
                  >
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      {row.label}
                      {both && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {row.changed ? 'Changed' : 'The same'}
                        </span>
                      )}
                    </span>
                  </th>
                  {/* An unchanged value is said once, across both sides. */}
                  {both && !row.changed ? (
                    <td colSpan={2} className="px-3 py-2.5 break-words @max-lg:py-0">
                      <Value row={row} side="after" />
                    </td>
                  ) : (
                    sides.map((s) => (
                      <td
                        key={s}
                        className="px-3 py-2.5 break-words @max-lg:grid @max-lg:grid-cols-(--cols-lead-23) @max-lg:gap-2 @max-lg:py-0"
                      >
                        <span className="text-xs text-muted-foreground @lg:sr-only">
                          {labels[s]}
                        </span>
                        <span className="min-w-0">
                          <Value row={row} side={s} />
                        </span>
                      </td>
                    ))
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {same.length > 0 && (
          <button
            type="button"
            aria-expanded={showSame}
            onClick={() => setShowSame((s) => !s)}
            className={cn(
              'flex min-h-9 w-full items-center gap-1.5 bg-muted/30 px-3 py-2 text-left text-xs text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
              shown.length > 0 && 'border-t',
            )}
          >
            <ChevronsUpDownIcon aria-hidden className="size-3.5 shrink-0" />
            {showSame
              ? `Hide the ${same.length} that stay the same`
              : `${same.length} the same: ${same.map((r) => r.label).join(', ')}`}
          </button>
        )}
      </div>
    </section>
  )
}

/* ---------- the Text diff ---------- */

/** One line: its numbers, its sign in a glyph and in words, and its text. */
function Line({ row }: { row: Row }) {
  const side = row.t === '-' ? 'before' : 'after'
  return (
    <div
      className={cn(
        'grid grid-cols-(--cols-diff) @max-lg:grid-cols-(--cols-diff-one)',
        row.t === '+' && 'bg-[var(--mark-add)]',
        row.t === '-' && 'bg-[var(--mark-del)]',
      )}
    >
      <span
        aria-hidden
        className="border-r px-2 py-0.5 text-right text-xs leading-6 text-muted-foreground tabular-nums select-none @max-lg:hidden"
      >
        {row.a}
      </span>
      <span
        aria-hidden
        className="border-r px-2 py-0.5 text-right text-xs leading-6 text-muted-foreground tabular-nums select-none"
      >
        {row.t === '-' ? <span className="@lg:hidden">{row.a}</span> : row.b}
      </span>
      <span
        className="py-0.5 text-center leading-6 text-muted-foreground select-none"
        aria-label={row.t === '+' ? 'added' : row.t === '-' ? 'removed' : undefined}
      >
        {row.t === '+' ? '+' : row.t === '-' ? '−' : ''}
      </span>
      <span className="min-w-0 py-0.5 pr-3 text-sm leading-6 break-words whitespace-pre-wrap">
        <span className="sr-only">
          Line {row.t === '-' ? row.a : row.b}
          {': '}
        </span>
        {row.words ? (
          <Words words={row.words} side={side} />
        ) : row.line ? (
          <MentionText text={row.line} />
        ) : (
          ' '
        )}
      </span>
    </div>
  )
}

/** Unchanged lines folded into one row that opens them. */
function Fold({ rows, all }: { rows: Row[]; all: boolean }) {
  const [open, setOpen] = React.useState(false)
  if (open)
    return (
      <div className="animate-in duration-(--dur-3) fade-in-0 slide-in-from-top-1">
        {rows.map((row, i) => (
          <Line key={i} row={row} />
        ))}
      </div>
    )
  const n = rows.length
  return (
    <button
      type="button"
      aria-expanded={false}
      onClick={() => setOpen(true)}
      className="flex min-h-8 w-full items-center gap-1.5 border-y bg-muted/40 px-3 py-1 text-left text-xs text-muted-foreground outline-none first:border-t-0 last:border-b-0 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
    >
      <ChevronsUpDownIcon aria-hidden className="size-3.5 shrink-0" />
      {all ? `The text is the same: show its ${n} lines` : `Show ${n} unchanged lines`}
    </button>
  )
}

/**
 * The Text diff of two stored texts: every change a stop for N and P, with what stays the same
 * folded around it. One number column on a narrow pane, two when there is room.
 */
export function TextDiff({ before, after }: { before: string; after: string }) {
  const id = React.useId()
  const rows = React.useMemo(() => lineDiff(before, after), [before, after])
  const parts = React.useMemo(() => hunks(rows), [rows])
  const stats = diffStats(rows)
  const changes = parts.filter((p) => p.t === 'change').length
  const line = !rows.length
    ? 'No text'
    : !changes
      ? 'No change'
      : `${linesWords(stats)}, in ${changes} ${changes === 1 ? 'place' : 'places'}`
  return (
    <section aria-labelledby={`${id}-h`} className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 id={`${id}-h`} className="text-sm font-medium">
          Text
        </h3>
        <span className="text-xs text-muted-foreground">{line}</span>
      </header>
      {rows.length > 0 && (
        <div className="overflow-hidden rounded-frame border">
          {parts.map((part, i) =>
            part.t === 'fold' ? (
              <Fold key={i} rows={part.rows} all={!changes} />
            ) : part.t === 'same' ? (
              part.rows.map((row, k) => <Line key={`${i}-${k}`} row={row} />)
            ) : (
              <div
                key={i}
                role="group"
                aria-label={`Change ${part.n + 1} of ${changes} in the text`}
                data-review-change=""
                tabIndex={-1}
                className={stop}
              >
                {part.rows.map((row, k) => (
                  <Line key={k} row={row} />
                ))}
              </div>
            ),
          )}
        </div>
      )}
    </section>
  )
}
