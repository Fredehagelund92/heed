import * as React from 'react'
import { BookmarkIcon, XIcon } from '@/components/icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import type { Answer } from '@/model/ask'
import { useWrite } from '@/api/queries'
import { useTakeBack } from '@/lib/undo'
import type { DomainId } from '@/model/items'
import { navigate } from '@/lib/router'
import { useDomains, useFacts, useMe } from '@/lib/workspace'

// Save question: the same action under an answer in Ask and in the answer panel's footer. A soft
// popover: the question, what it should answer from (the answer's sources, removable), and the
// domain. Owners of the domain and admins save; after every change it is checked again, for free,
// and Quality shows the result. It checks what agents get, not how an agent words it.

export function SaveQuestion({
  question,
  domain,
  answer,
  from: anchor,
  onClose,
}: {
  question: string
  domain: DomainId
  answer: Answer
  /**
   * Under an answer in Ask, where More holds it: no button of its own, open from the start, beside
   * the More button it was chosen from, and focus goes back there when it closes.
   */
  from?: React.RefObject<HTMLElement | null>
  onClose?: () => void
}) {
  const me = useMe()
  const domains = useDomains()
  const facts = useFacts()
  const factById = (id: string) => facts.find((f) => f.id === id)
  const write = useWrite()
  const takeBack = useTakeBack()
  const [open, setOpenState] = React.useState(!!anchor)
  const setOpen = (o: boolean) => {
    setOpenState(o)
    if (!o) onClose?.()
  }
  const [q, setQ] = React.useState(question)
  const [from, setFrom] = React.useState<string[]>(answer.sources)
  const allowed = me.admin || me.owns.includes(domain)
  const reason = allowed
    ? undefined
    : `Owners of ${domains[domain]?.name} and admins save questions about it.`
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (reason) return
        setOpen(o)
        if (o) {
          setQ(question)
          setFrom(answer.sources)
        }
      }}
    >
      {!anchor && (
        <PopoverTrigger
          render={
            <Button
              variant="outline"
              aria-disabled={reason ? true : undefined}
              aria-description={reason}
              title={reason}
            />
          }
        >
          <BookmarkIcon data-icon="inline-start" />
          Save question
        </PopoverTrigger>
      )}
      <PopoverContent
        align={anchor ? 'start' : 'end'}
        side="top"
        anchor={anchor}
        finalFocus={anchor}
        className="w-96 max-w-viewport-inset"
      >
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!q.trim()) return
            const titles = from.map((id) => factById(id)?.title).filter(Boolean)
            const expect = titles.length
              ? `Checked, from ${titles.join(' and ')}.`
              : 'Not found, until someone writes it.'
            void write('saveQuestion', {
              question: {
                question: q.trim(),
                domain,
                savedBy: me.name,
                expect,
                factId: from[0] ?? '',
              },
              from,
              origin: 'ask',
            }).then(({ undo }) => {
              setOpen(false)
              toast('Question saved', {
                description: 'It is checked after every change. Quality shows the result.',
                action: { label: 'Undo', onClick: () => void takeBack(undo) },
                cancel: {
                  label: 'Open Quality',
                  onClick: () => navigate('/observability/quality'),
                },
              })
            })
          }}
        >
          <p className="text-sm font-medium">Save question</p>
          <label className="flex flex-col gap-1.5 text-sm" htmlFor="sq-question">
            <span className="text-xs font-semibold text-muted-foreground">The question</span>
            <Input id="sq-question" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground">Should answer from</span>
            {from.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {from.map((id) => (
                  <li
                    key={id}
                    className="inline-flex max-w-full items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs"
                  >
                    <span className="truncate">{factById(id)?.title ?? id}</span>
                    <button
                      type="button"
                      aria-label={`Remove ${factById(id)?.title ?? id}`}
                      className="grid size-5 place-items-center rounded-sm text-muted-foreground hover:bg-muted"
                      onClick={() => setFrom(from.filter((x) => x !== id))}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm">
                Nothing: it should keep saying nothing is written down, until someone writes it.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            In {domains[domain]?.name}. After every publish, archive, restore, sync or check date
            passing, it is checked again. It checks what agents get, not how an agent words it.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save question</Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
