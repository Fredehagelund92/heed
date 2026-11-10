import { ArrowLeftRightIcon } from '@/components/icons'
import { Statement } from '@/components/heed/conflict-pair'
import { SideSection } from '@/components/heed/doc'
import { Button } from '@/components/ui/button'
import type { ItemPage } from '@/api/client'
import { comparePair } from '@/lib/differing-words'
import { openDock } from '@/lib/dock'
import { useReadAhead } from '@/lib/read-ahead'
import { useDomains } from '@/lib/workspace'
import type { Fact } from '@/model/items'

// An item's side of a conflict (FR-220), on its page: the other item, what it says marked as the
// conflict view marks it, its domain and check, how often agents get the pair as a Conflict, and
// the way to the comparison. The choice itself is made there, with a reason.

/** "Compare and decide" for someone who can settle the pair, else "Compare the two". */
export function CompareButton({
  pairKey,
  canSettle,
  variant = 'default',
}: {
  pairKey: string
  canSettle: boolean
  variant?: 'default' | 'outline'
}) {
  return (
    <Button size="sm" variant={variant} onClick={() => openDock('conflict', pairKey)}>
      <ArrowLeftRightIcon data-icon="inline-start" />
      {canSettle ? 'Compare and decide' : 'Compare the two'}
    </Button>
  )
}

/** `pair` is what the item's own read says of the conflict: the page draws this side once it has it. */
export function DisagreesSection({
  self,
  other,
  pair,
}: {
  self: Fact
  other: Fact
  pair: ItemPage['conflict']
}) {
  const domains = useDomains()
  const ahead = useReadAhead()
  const pairKey = `${self.id}.${other.id}`
  const theirs = comparePair(self.summary, other.summary)[1]
  return (
    <SideSection title="Disagrees with">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="text-left text-sm font-medium text-primary underline-offset-4 hover:underline"
          {...ahead(other.id)}
          onClick={() => openDock('context', other.id)}
        >
          {other.title}
        </button>
        <Statement c={theirs} className="text-sm leading-6" />
        <p className="text-xs text-muted-foreground">
          {domains[other.domain]?.name ?? other.domain}
          {other.checkedOn && `, checked ${other.checkedOn}`}.
          {pair &&
            pair.asked > 0 &&
            ` Agents say Conflict for ${pair.asked} ${pair.asked === 1 ? 'question' : 'questions'} this week.`}
        </p>
        <div>
          <CompareButton pairKey={pair?.key ?? pairKey} canSettle={!!pair?.canSettle} />
        </div>
      </div>
    </SideSection>
  )
}
