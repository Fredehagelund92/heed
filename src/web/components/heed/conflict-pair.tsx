import * as React from 'react'
import { markText } from '@/components/heed/mark'
import { useWide } from '@/hooks/use-wide'
import { SIDE_BY_SIDE } from '@/lib/conflict'
import { comparePair, type Compared } from '@/lib/differing-words'
import { cn } from '@/lib/utils'
import { sideTitle, type Conflict, type ConflictSide } from '@/model/conflicts'

// The light parts of the conflict view (FR-220): a statement marked as the app compares it, and the
// pair in a few lines. A file of its own, so Ask, the Inbox and the review show a pair without the
// whole view's code.

const sourceShort = (url: string) => url.replace(/^https?:\/\//, '')

/** One statement, with the words both share greyed or the words that differ marked, as the app found them. */
export function Statement({ c, className }: { c: Compared; className?: string }) {
  return (
    <p className={cn('text-base leading-7 text-pretty', className)}>
      {c.inBoth.length > 0 && (
        <span className="sr-only">Words in both: {c.inBoth.join('; ')}. </span>
      )}
      {c.runs.map((r, i) =>
        r.shared ? (
          <span key={i} data-shared className="text-muted-foreground">
            {r.text}
          </span>
        ) : r.differs ? (
          <mark
            key={i}
            data-mark="differs"
            className={cn('bg-transparent text-inherit', markText('differs'))}
          >
            <span className="sr-only">[differs: </span>
            {r.text}
            <span className="sr-only">]</span>
          </mark>
        ) : (
          <React.Fragment key={i}>{r.text}</React.Fragment>
        ),
      )}
    </p>
  )
}

/* ---------- the compact form: the review, Ask, the Inbox card, the item page ---------- */

/**
 * The pair in a few lines: each item's title, what it says (marked as the full view marks it), its
 * domain, check and source. Two columns when they fit, else one above the other.
 */
export function ConflictPairCompact({
  pair,
  label,
  className,
}: {
  pair: Pick<Conflict, 'holder' | 'other'>
  label?: React.ReactNode
  className?: string
}) {
  const [ref, wide] = useWide<HTMLDivElement>(SIDE_BY_SIDE)
  const [a, b] = comparePair(pair.holder.summary ?? '', pair.other.summary ?? '')
  const side = (s: ConflictSide, c: Compared, second?: boolean) => (
    <div
      className={cn(
        'flex min-w-0 flex-col gap-1.5 p-3',
        second && (wide ? 'border-l' : 'border-t'),
      )}
    >
      <p className="text-sm font-semibold">{sideTitle(s)}</p>
      {s.readable ? (
        <Statement c={c} className="text-sm leading-6" />
      ) : (
        <p className="text-sm text-muted-foreground">An item you cannot read.</p>
      )}
      <p className="text-xs text-muted-foreground">
        {s.domainName}
        {s.checkedOn && `, checked ${s.checkedOn}`}
        {s.source && <span className="break-all">, {sourceShort(s.source.url)}</span>}
      </p>
    </div>
  )
  return (
    <div ref={ref} className={cn('overflow-hidden rounded-frame border', className)}>
      {label && <div className="border-b bg-muted/40 px-3 py-2 text-xs font-medium">{label}</div>}
      <div
        className={cn('grid', wide ? 'grid-cols-2' : 'grid-cols-1')}
        role="group"
        aria-label="The two items"
      >
        {side(pair.holder, a)}
        {side(pair.other, b, true)}
      </div>
    </div>
  )
}
