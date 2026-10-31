import { ArrowLeftRightIcon, TriangleAlertIcon } from "lucide-react"
import { SideSection } from "@/components/heed/doc"
import { Statement } from "@/components/heed/conflict-view"
import { Button } from "@/components/ui/button"
import { askedOf, rightsOf, type ConflictPair } from "@/data/conflicts"
import { domains } from "@/data/world"
import { comparePair } from "@/lib/conflict-words"
import { openDock } from "@/lib/dock"
import { useMe } from "@/lib/store"

/** One button to the comparison: "Compare and decide" for someone who can settle it, else "Compare the two". */
export function CompareButton({ pair, size = "sm", variant = "default" }: { pair: ConflictPair; size?: "sm" | "default"; variant?: "default" | "outline" }) {
  const me = useMe()
  const can = rightsOf(me, pair).any
  return (
    <Button size={size} variant={variant} onClick={() => openDock("conflict", pair.key)}>
      <ArrowLeftRightIcon data-icon="inline-start" />
      {can ? "Compare and decide" : "Compare the two"}
    </Button>
  )
}

/**
 * On an item's page: the other item of its conflict, what it says (marked as in the comparison), its
 * domain and check, how many questions get Conflict, and the way to the comparison.
 */
export function DisagreesSection({ pair, self }: { pair: ConflictPair; self: string }) {
  const [mine, theirs] = pair.holder.id === self ? [pair.holder, pair.other] : [pair.other, pair.holder]
  const compared = comparePair(mine.summary, theirs.summary)[1]
  return (
    <SideSection
      title={
        <span className="flex items-center gap-1.5">
          <TriangleAlertIcon aria-hidden className="size-4 text-[var(--warn)]" />
          Disagrees with
        </span>
      }
    >
      <div className="flex flex-col gap-2">
        <button type="button" className="text-left text-sm font-medium text-primary underline-offset-4 hover:underline" onClick={() => openDock("context", theirs.id)}>
          {theirs.title}
        </button>
        <Statement c={compared} className="text-sm leading-6" />
        <p className="text-xs text-muted-foreground">
          {domains[theirs.domain].name}, checked {theirs.checkedOn}. Agents say Conflict for {askedOf(pair).asked} questions this week.
        </p>
        <div>
          <CompareButton pair={pair} />
        </div>
      </div>
    </SideSection>
  )
}
