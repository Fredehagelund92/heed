import { ArrowRightLeftIcon, CircleCheckIcon, TriangleAlertIcon } from "lucide-react"
import { cn } from "cn"
import { RESULT_WORDS, type SavedResult } from "@/data/saved-questions"

// A saved question's result, by shape and words as well as colour: a check for Same, two arrows for
// Changed, a triangle for Needs a look.

export function ResultIcon({ result, className }: { result: SavedResult; className?: string }) {
  const Icon = result === "same" ? CircleCheckIcon : result === "changed" ? ArrowRightLeftIcon : TriangleAlertIcon
  return (
    <span className={cn("inline-flex shrink-0", result === "same" ? "text-[var(--ok)]" : result === "changed" ? "text-primary" : "text-[var(--warn)]", className)}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{RESULT_WORDS[result]}</span>
    </span>
  )
}
