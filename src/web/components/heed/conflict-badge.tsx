import { StateLine } from '@/components/heed/state-line'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { openDock } from '@/lib/dock'
import { href } from '@/lib/router'
import { conflictPath, sideTitle, type ConflictRow } from '@/model/conflicts'

// An item's Conflict in a list row (FR-220): the Conflict chip at the row's size, on every row of
// an item in a conflict, filtered or not. It opens the comparison in the dock; with a modifier key
// it opens the pair's own page, as a link does.

export function ConflictBadge({ pair, itemId }: { pair: ConflictRow; itemId: string }) {
  const other = pair.holder.id === itemId ? pair.other : pair.holder
  const otherTitle = sideTitle(other)
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href(conflictPath(pair.key))}
            aria-label={`Conflict with “${otherTitle}”`}
            className="inline-flex shrink-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={(e) => {
              e.stopPropagation()
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              e.preventDefault()
              openDock('conflict', pair.key)
            }}
          />
        }
      >
        <StateLine
          state="conflict"
          tip={false}
          className="gap-1 px-1.5 py-0.5 text-xs text-foreground [&>svg]:size-3.5"
        />
      </TooltipTrigger>
      <TooltipContent className="block max-w-64 text-pretty">
        Says something different from “{otherTitle}”. Agents get both until an owner decides.
      </TooltipContent>
    </Tooltip>
  )
}
