import * as React from "react"
import { ChevronDownIcon, ChevronUpIcon, ExternalLinkIcon } from "lucide-react"
import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { DockFrame, DockMissing } from "@/components/dock"
import { kindIcons } from "@/components/heed/kind-icons"
import { TagChip } from "@/components/heed/tag-chip"
import { domains, kindLabel, type Fact } from "@/data/world"
import { closeDock, openDock } from "@/lib/dock"
import { plainText } from "@/lib/mentions"
import { setQuery, useRoute } from "@/lib/router"
import { useShownAnswer } from "@/lib/shown-answers"
import { markShared, sentencesOf, type Segment } from "@/lib/where"

// Show me where it says that: a sentence of an answer, walked back one step at a time to the
// context item that backs it and to the source line its owner copied. Exact phrases of three words
// or more are marked at each step; the rest is the owner's own wording. The item's "don't conclude"
// line closes the chain. A sentence with no item behind it says it is Ask's own wording.

export function WherePanel({ id }: { id: string }) {
  const shown = useShownAnswer(id)
  const { query } = useRoute()
  const sentences = shown ? sentencesOf(shown.answer.text) : []
  const n = Math.min(Math.max(1, Number(query.get("wn")) || 1), Math.max(1, sentences.length))
  const go = React.useCallback((k: number) => setQuery({ wn: String(k) }), [])

  // The number keys jump between sentences while the panel is open; Escape closes it.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented || t.closest("input, textarea, [contenteditable=true]")) return
      if (e.key === "Escape") return closeDock()
      const k = Number(e.key)
      if (k >= 1 && k <= sentences.length) {
        e.preventDefault()
        go(k)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [sentences.length, go])

  if (!shown || !sentences.length)
    return (
      <DockFrame title="Where it says that">
        <DockMissing>This answer is not on screen any more. Ask the question again to see where it says that.</DockMissing>
      </DockFrame>
    )
  const sentence = sentences[n - 1]
  const cited = sentence.cites.map((c) => shown.facts[c - 1]).filter(Boolean) as Fact[]
  const step = (to: number, label: string, Icon: typeof ChevronUpIcon) => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label={label} disabled={to < 1 || to > sentences.length} onClick={() => go(to)} />}>
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
  return (
    <DockFrame
      title="Where it says that"
      actions={
        <>
          {step(n - 1, "Previous sentence", ChevronUpIcon)}
          {step(n + 1, "Next sentence", ChevronDownIcon)}
        </>
      }
      footer={
        cited.length === 1 ? (
          <Button variant="outline" onClick={() => openDock("context", cited[0].id)}>
            Open the item
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-5 p-4 md:p-5">
        <p className="text-xs text-muted-foreground">
          Sentence {n} of {sentences.length}
          <span className="pointer-coarse:hidden"> - keys 1 to {sentences.length} move between them</span>
        </p>
        {cited.length ? (
          <>
            {cited.map((f) => (
              <Chain key={f.id} sentence={sentence.text} n={n} fact={f} many={cited.length > 1} />
            ))}
            <p className="text-xs text-muted-foreground">
              <Mark>Marked</Mark> words are the same, word for word. Words not marked are the owner&apos;s own wording.
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[15px] leading-relaxed">{sentence.text}</p>
            <p className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
              No context item is behind this sentence. It is Ask&apos;s own wording: it joins what the items say, or says what they leave out.
            </p>
          </div>
        )}
      </div>
    </DockFrame>
  )
}

/** Answer, item, source: three steps on one line, so a gap in the chain shows. */
function Chain({ sentence, n, fact, many }: { sentence: string; n: number; fact: Fact; many: boolean }) {
  const summary = plainText(fact.summary)
  const where = fact.source.replace(/^https?:\/\//, "")
  const KindGlyph = kindIcons[fact.kind]
  return (
    <section aria-label={`From ${fact.title}`} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <TagChip icon={<KindGlyph aria-hidden />} className="w-fit">
          {kindLabel[fact.kind]}
        </TagChip>
        <h3 className="text-base leading-snug font-semibold text-balance">{fact.title}</h3>
        <p className="text-xs text-muted-foreground">
          {domains[fact.domain].name} - {fact.where.join(", ")} - {fact.when}
        </p>
      </div>
      <ol className="relative flex flex-col gap-4 before:absolute before:top-2 before:bottom-2 before:left-[5px] before:w-px before:bg-primary/30">
        <Node label={`In the answer, sentence ${n}`} first>
          <p className="text-sm leading-relaxed">
            <Marked segments={markShared(sentence, [summary])} />
          </p>
        </Node>
        <Node label={`In the context item, checked by ${fact.checkedBy}, ${fact.checkedOn}`}>
          <p className="text-sm leading-relaxed">
            <Marked segments={markShared(summary, [sentence, fact.quote])} />
          </p>
        </Node>
        <Node
          label={
            <>
              In the source -{" "}
              <a href={fact.source} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline-offset-4 hover:text-foreground hover:underline">
                {where}
                <ExternalLinkIcon className="size-3" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </>
          }
        >
          {fact.quote ? (
            <blockquote className="border-l-2 pl-3 text-sm leading-relaxed text-foreground/90 italic">
              “<Marked segments={markShared(fact.quote, [summary])} />”
            </blockquote>
          ) : (
            <p className="text-sm text-muted-foreground">The owner did not copy a line from the source.</p>
          )}
        </Node>
      </ol>
      <div className="rounded-md border border-dashed px-3 py-2.5">
        <p className="text-xs font-medium text-muted-foreground">This item says not to conclude</p>
        <p className="mt-0.5 text-sm">{fact.dontConclude}</p>
      </div>
      {many && (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => openDock("context", fact.id)}>
          Open the item
        </Button>
      )}
    </section>
  )
}

function Node({ label, first, children }: { label: React.ReactNode; first?: boolean; children: React.ReactNode }) {
  return (
    <li className="relative flex flex-col gap-1 pl-6">
      <span aria-hidden className={cn("absolute top-1 left-0 size-[11px] rounded-full border-2 border-primary bg-background", first && "bg-primary")} />
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </li>
  )
}

function Mark({ children }: { children: React.ReactNode }) {
  return <mark className="rounded-[3px] bg-primary/12 px-0.5 text-foreground not-italic dark:bg-primary/25">{children}</mark>
}

function Marked({ segments }: { segments: Segment[] }) {
  return <>{segments.map((s, i) => (s.marked ? <Mark key={i}>{s.text}</Mark> : <React.Fragment key={i}>{s.text}</React.Fragment>))}</>
}
