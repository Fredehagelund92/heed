import * as React from "react"
import { BookmarkIcon, XIcon } from "lucide-react"
import { toast } from "sonner"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import type { Answer } from "@/data/ask"
import { removeSavedQuestion, saveQuestion } from "@/data/saved-questions"
import { domains, factById, type DomainId } from "@/data/world"
import { navigate } from "@/lib/router"
import { useMe } from "@/lib/store"

// Save question: the same action under an answer in Ask and in the answer panel's footer. A soft
// popover: the question, what it should answer from (the answer's sources, removable), and the
// domain. Owners of the domain and admins save; after every change it is checked again, for free,
// and Quality shows the result. It checks what agents get, not how an agent words it.

export function SaveQuestion({
  question,
  domain,
  answer,
  quiet,
}: {
  question: string
  domain: DomainId
  answer: Answer
  /** Under an answer in Ask: a quiet text button, as Something wrong? is. */
  quiet?: boolean
}) {
  const me = useMe()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState(question)
  const [from, setFrom] = React.useState<string[]>(answer.sources)
  const allowed = me.admin || me.owns.includes(domain)
  const reason = allowed ? undefined : `Owners of ${domains[domain].name} and admins save questions about it.`
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
      <PopoverTrigger
        render={
          <Button
            variant={quiet ? "ghost" : "outline"}
            size="sm"
            aria-disabled={reason ? true : undefined}
            aria-description={reason}
            title={reason}
            className={cn(quiet && "h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground pointer-coarse:h-9")}
          />
        }
      >
        <BookmarkIcon data-icon="inline-start" />
        Save question
      </PopoverTrigger>
      <PopoverContent align={quiet ? "start" : "end"} side="top" className="w-96 max-w-[calc(100vw-2rem)]">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!q.trim()) return
            const titles = from.map((id) => factById(id)?.title).filter(Boolean)
            const expect = titles.length ? `Checked, from ${titles.join(" and ")}.` : "Not found, until someone writes it."
            const id = saveQuestion({ question: q.trim(), domain, savedBy: me.name, expect, factId: from[0] ?? "" })
            setOpen(false)
            toast("Question saved", {
              description: "It is checked after every change. Quality shows the result.",
              action: { label: "Undo", onClick: () => removeSavedQuestion(id) },
              cancel: { label: "Open Quality", onClick: () => navigate("/observability/quality") },
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
                  <li key={id} className="inline-flex max-w-full items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-2 text-xs">
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
              <p className="text-sm">Nothing: it should keep saying nothing is written down, until someone writes it.</p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            In {domains[domain].name}. After every publish, archive, restore, sync or check date passing, it is checked again. It checks what agents get, not how an agent
            words it.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save question
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
