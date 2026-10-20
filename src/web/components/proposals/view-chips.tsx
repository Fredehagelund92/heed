import { Link, useNavigate } from '@tanstack/react-router'
import { ChevronDownIcon } from '@/components/icons'
import { CountBadge } from '@/components/item/item-marks'
import { toolbarViewClass } from '@/components/page/toolbar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { ProposalViewId } from '@/lib/proposals'

/*
  The views of the Proposals page as chips with a count (table design, "View tabs"; frame C1):
  the active chip is filled, a count that needs the person is amber, the others quiet. The view
  is in the address (`view=`), so every view is linkable. Below a 672 pixel container the chips
  become one menu button that shows the active view and its count (contract 8.4).
*/

export type ViewChip = {
  id: ProposalViewId
  title: string
  /** Null while the count loads. */
  count: number | null
  /** The count asks for a look: something in the view waits for this person. */
  attention: boolean
}

function Count({ chip }: { chip: ViewChip }) {
  if (chip.count === null) return null
  return <CountBadge count={chip.count} tone={chip.attention ? 'attention' : 'quiet'} />
}

export function ViewChips({
  views,
  active,
}: {
  views: readonly ViewChip[]
  active: ProposalViewId
}) {
  const navigate = useNavigate()
  const current = views.find((view) => view.id === active) ?? views[0]
  return (
    <>
      <nav aria-label="Proposal views" className="flex items-center gap-1 @max-2xl:hidden">
        {views.map((view) => (
          <Link
            key={view.id}
            to="/proposals"
            search={{ view: view.id }}
            aria-current={view.id === active ? 'page' : undefined}
            className={toolbarViewClass}
          >
            {view.title}
            <Count chip={view} />
          </Link>
        ))}
      </nav>
      {current ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="touch"
                aria-label={`View: ${current.title}`}
                className="@2xl:hidden"
              />
            }
          >
            {current.title}
            <Count chip={current} />
            <ChevronDownIcon className="text-muted-foreground" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={active}
              onValueChange={(value: ProposalViewId) =>
                void navigate({ to: '/proposals', search: { view: value } })
              }
            >
              {views.map((view) => (
                <DropdownMenuRadioItem key={view.id} value={view.id} closeOnClick>
                  <span className="flex-1">{view.title}</span>
                  <Count chip={view} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </>
  )
}
