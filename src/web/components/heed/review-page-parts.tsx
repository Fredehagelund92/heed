import * as React from 'react'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CircleXIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { pageKey } from '@/lib/keys'
import { Button } from '@/components/ui/button'
import { KindLabel, Marked } from '@/components/heed/review-parts'
import { marks, type Review } from '@/model/review'

// The parts only the full review draws: a long rewrite side by side, and the claim check. Apart
// from review-parts.tsx, which the Inbox's quick review loads up front, so they load on demand with
// the review page.

/** A long rewrite, side by side: where the changes sit along the text, and N and P to step through them. */
export function Rewrite({ rewrite }: { rewrite: NonNullable<Review['rewrite']> }) {
  const [active, setActive] = React.useState(0)
  const before = marks(rewrite.before)
  const after = marks(rewrite.after)
  const total = after.filter((s) => s.t !== 'same').length
  const ref = React.useRef<HTMLDivElement>(null)
  const go = React.useCallback(
    (i: number) => {
      const next = (i + total) % total
      setActive(next)
      ref.current
        ?.querySelector(`[data-side=after] [data-change="${next}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    },
    [total],
  )
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pageKey(e)) return
      if (e.key === 'n') go(active + 1)
      if (e.key === 'p') go(active - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, go])
  // Where each change sits, as a share of the text, for the strip.
  let pos = 0
  const length = after.reduce((n, s) => n + s.text.length, 0)
  const ticks: number[] = []
  for (const s of after) {
    if (s.t !== 'same') ticks.push((pos + s.text.length / 2) / length)
    pos += s.text.length
  }
  return (
    <section ref={ref} className="flex flex-col gap-4 py-2">
      <header className="flex flex-wrap items-center gap-2">
        <KindLabel kind="Wording" />
        <span className="text-xs text-muted-foreground">
          {rewrite.field}, mostly rewritten, so side by side
        </span>
        <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
          Change {active + 1} of {total}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Previous change (P)"
            onClick={() => go(active - 1)}
          >
            <ChevronUpIcon />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Next change (N)"
            onClick={() => go(active + 1)}
          >
            <ChevronDownIcon />
          </Button>
        </span>
      </header>
      <div className="relative h-2 rounded-full bg-muted" role="presentation">
        {ticks.map((t, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to change ${i + 1}`}
            onClick={() => go(i)}
            className={cn(
              'absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-[var(--mark-add-line)]',
              i === active && 'ring-2 ring-ring',
            )}
            style={{ left: `${t * 100}%` }}
          />
        ))}
      </div>
      <div className="grid gap-4 @3xl:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-frame border p-4">
          <p className="text-xs font-medium text-muted-foreground">Now</p>
          <Marked segs={before} className="text-reading leading-7" />
        </div>
        <div data-side="after" className="flex flex-col gap-2 rounded-frame border p-4">
          <p className="text-xs font-medium text-muted-foreground">After you publish</p>
          <Marked segs={after} active={active} className="text-reading leading-7" />
        </div>
      </div>
    </section>
  )
}

/** An agent's claims, each against the sentence it copied from the source. Heed didn't open the page. */
export function ClaimCheck({
  claims,
  from,
  drafted,
}: {
  claims: NonNullable<Review['claims']>
  from: string
  drafted?: boolean
}) {
  const verdict = {
    same: { icon: CircleCheckIcon, label: 'Same', cls: 'text-foreground' },
    check: { icon: CircleHelpIcon, label: 'Same? Check', cls: 'text-caution-ink' },
    different: { icon: CircleXIcon, label: 'Different', cls: 'text-destructive' },
  } as const
  return (
    <section className="flex flex-col gap-3 py-2">
      <header className="flex items-center gap-2">
        <KindLabel kind="Added" />
        <span className="text-xs text-muted-foreground">Claim check</span>
      </header>
      <p className="text-sm text-muted-foreground">
        {drafted
          ? 'The draft copied this sentence from the source.'
          : `The agent copied this sentence from the source, with ${from}'s OK.`}{' '}
        The numbers, dates and names in the summary are compared with it.{' '}
        {drafted ? 'Nobody opened the page yet.' : 'It did not open the page.'}
      </p>
      <blockquote className="rounded-frame bg-muted px-3 py-2 text-sm italic">
        “{claims.sentence}”
      </blockquote>
      <div className="overflow-hidden rounded-frame border">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-xs text-muted-foreground">
              <th className="px-3 py-2 font-medium">In the summary</th>
              <th className="px-3 py-2 font-medium">In the copied sentence</th>
              <th className="w-36 px-3 py-2 font-medium">Same?</th>
            </tr>
          </thead>
          <tbody>
            {claims.rows.map((r) => {
              const v = verdict[r.same]
              return (
                <tr key={r.claim} className="border-t">
                  <td className="px-3 py-2.5">{r.claim}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{r.source}</td>
                  <td className={cn('px-3 py-2.5 font-medium whitespace-nowrap', v.cls)}>
                    <span className="inline-flex items-center gap-1.5">
                      <v.icon aria-hidden className="size-4" />
                      {v.label}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
