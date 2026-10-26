import * as React from "react"
import { Loader2Icon, SearchIcon } from "lucide-react"
import { cn } from "cn"
import { useStages } from "@/lib/stages"

// The staged look-up, where an agent's kind of work really happens (Ask, Try it, the answer panel,
// Quality's check): one quiet line, a spinner and a shimmer on the words while it works, then what
// it found. Shimmer is only ever on these words. With reduced motion the spinner and the shimmer
// stand still and the words still say what is happening.

/** The one line: a spinner and shimmering words while running, a search glyph once done. */
export function ReadingLine({ running, children, className }: { running: boolean; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted-foreground", className)}>
      {running ? <Loader2Icon className="size-3.5 shrink-0 animate-spin" aria-hidden /> : <SearchIcon className="size-3.5 shrink-0" aria-hidden />}
      <span className={cn(running && "shimmer")}>{children}</span>
    </span>
  )
}

/**
 * Stages, then the content: "Looking up…", "Reading 2 context items…", then `children` settling in.
 * `seen` skips the stages for something shown before (the fast path).
 */
export function ReadingCard({
  seen,
  looking,
  reading,
  className,
  children,
}: {
  /** A key for what is read: shown before, it opens at once. */
  seen: string
  looking: string
  reading: string
  /** Where the line sits while it reads. */
  className?: string
  children: React.ReactNode
}) {
  const { stage, staged } = useStages(seen)
  if (stage !== "done")
    return (
      <div role="status" className={cn("py-1", className)}>
        <ReadingLine running>{stage === "looking" ? looking : reading}</ReadingLine>
      </div>
    )
  // After the stages it settles in; on the fast path it is simply there.
  return <div className={cn("contents", staged && "[&>*]:animate-in [&>*]:duration-(--dur-4) [&>*]:fade-in-0")}>{children}</div>
}
