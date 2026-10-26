import * as React from 'react'
import { ArrowUpRightIcon, ListChecksIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { WordDiff } from '@/components/heed/bits'
import { ResultIcon } from '@/components/obs/result'
import type { Review } from '@/model/review'
import { useInbox, useSavedQuestions } from '@/api/queries'
import {
  checkDraft,
  draftLine,
  itemOfReview,
  savesQuestion,
  setSavesQuestion,
} from '@/lib/saved-check'
import { href } from '@/lib/router'

// In the review, under what agents will say: the saved questions that answer from this item, checked
// against the draft ("1 of 1 still answers the same"). One that moves opens before and now in place,
// and Quality has the full list. A gap's draft offers to keep its question. Never a reason to stop.

export function SavedLine({ r, domain }: { r: Review; domain: string }) {
  const all = useSavedQuestions()
  const { cards } = useInbox()
  const check = checkDraft(r, all, itemOfReview(r, cards))
  const [open, setOpen] = React.useState<string | null>(null)
  const [save, setSave] = React.useState(() => savesQuestion(r.id))
  if (r.drafted)
    return (
      <label className="flex items-start gap-2.5 text-sm" htmlFor={`also-save-${r.id}`}>
        <Checkbox
          id={`also-save-${r.id}`}
          className="mt-0.5"
          checked={save}
          onCheckedChange={(v) => {
            setSave(!!v)
            setSavesQuestion(r.id, !!v)
          }}
        />
        <span>
          Also save this question
          <span className="block text-xs text-muted-foreground">
            “What happened to {r.drafted.scope}?” is checked after every change, in Quality.
          </span>
        </span>
      </label>
    )
  if (!check)
    return (
      <p className="text-xs text-muted-foreground">No saved question answers from this item.</p>
    )
  return (
    <div className="flex flex-col gap-2 rounded-frame border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm">
          <ListChecksIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span>
            <span className="font-medium">Saved questions.</span> {draftLine(check)}
          </span>
        </p>
        <a
          href={href('/observability/quality', { domain })}
          className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'text-muted-foreground')}
        >
          <ArrowUpRightIcon />
          Open in Quality
        </a>
      </div>
      {check.results
        .filter((x) => x.result !== 'same')
        .map((x) => (
          <div key={x.q.id} className="border-t pt-2">
            <button
              type="button"
              aria-expanded={open === x.q.id}
              onClick={() => setOpen(open === x.q.id ? null : x.q.id)}
              className="flex w-full items-start gap-2 text-left text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ResultIcon result={x.result} className="mt-0.5" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{x.q.question}</span>
                <span className="block text-xs text-muted-foreground">{x.why}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground underline underline-offset-4">
                {open === x.q.id ? 'Hide' : 'Before and now'}
              </span>
            </button>
            {open === x.q.id && (
              <div className="mt-2 rounded-md bg-muted/40 px-3 py-2">
                <WordDiff before={x.before} after={x.now} />
              </div>
            )}
          </div>
        ))}
    </div>
  )
}
