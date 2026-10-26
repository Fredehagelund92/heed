import * as React from 'react'
import { ArrowUpRightIcon, ChevronDownIcon, EyeOffIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { StateLine } from '@/components/heed/bits'
import { ASKED_ROWS, askedThisWeek } from '@/data/asked-week'
import { seesObservability } from '@/lib/obs'
import { useFacts, useMe } from '@/lib/store'

// The empty Ask: what agents asked about most this week, each topic with the state Ask gives it now
// and how often it was asked. Everyone sees it, as counts only: never the words of a question, never
// who asked. An owner sees the draft or suggestion that waits on a Not found topic of their domain.

export function AskedThisWeek({ onPick }: { onPick: (question: string) => void }) {
  const me = useMe()
  const pool = useFacts()
  const w = askedThisWeek(pool)
  // The four most asked; the rest open in place, so the empty page stays calm.
  const [all, setAll] = React.useState(false)
  const more = w.rows.length - ASKED_ROWS
  const rows = all ? w.rows : w.rows.slice(0, ASKED_ROWS)
  return (
    <section
      aria-labelledby="asked-week"
      className="overflow-hidden rounded-frame border bg-background"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b px-4 py-3">
        <h3 id="asked-week" className="text-sm font-semibold">
          Asked this week
        </h3>
        <p className="text-xs text-muted-foreground">
          Agents asked {w.asked} times. Counts only, never the words or who asked.
        </p>
      </div>
      <ul>
        {rows.map((r) => {
          const mine = me.admin || (!!r.topic.domain && me.owns.includes(r.topic.domain))
          return (
            <li
              key={r.topic.id}
              className="flex items-center gap-3 border-b px-2 py-1.5 last:border-b-0 sm:px-2.5"
            >
              <button
                type="button"
                onClick={() => onPick(r.question)}
                className="flex min-h-14 min-w-0 flex-1 flex-col items-start justify-center gap-1 rounded-md px-1.5 py-1.5 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="text-sm font-medium">{r.title}</span>
                <StateLine state={r.state} tip={false} className="px-1.5 py-0.5 text-xs" />
              </button>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {r.count} times
              </span>
              {mine && r.next && (
                <a
                  href={r.next.href}
                  className={cn(
                    buttonVariants({
                      size: 'sm',
                      variant: r.next.label === 'Write it' ? 'default' : 'outline',
                    }),
                    'shrink-0',
                  )}
                >
                  {r.next.label}
                  <span className="sr-only"> for {r.title}</span>
                </a>
              )}
            </li>
          )
        })}
      </ul>
      {(more > 0 || w.hidden > 0) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-4 py-2 text-xs text-muted-foreground">
          {more > 0 && (
            <button
              type="button"
              aria-expanded={all}
              onClick={() => setAll(!all)}
              className="-ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1 font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {all ? 'Show fewer' : `More asked this week (${more})`}
              <ChevronDownIcon
                className={cn(
                  'size-3.5 transition-transform duration-(--dur-2)',
                  all && 'rotate-180',
                )}
                aria-hidden
              />
            </button>
          )}
          {w.hidden > 0 && (
            <span className="flex items-center gap-1.5">
              <EyeOffIcon className="size-3.5 shrink-0" aria-hidden />
              {w.hidden} questions were about topics asked fewer than 5 times, so they are not
              shown.
            </span>
          )}
          {seesObservability(me) && (
            <a
              href="/observability/questions"
              className="ml-auto inline-flex items-center gap-0.5 underline-offset-4 hover:text-foreground hover:underline"
            >
              In Observability
              <ArrowUpRightIcon className="size-3" aria-hidden />
            </a>
          )}
        </div>
      )}
    </section>
  )
}
