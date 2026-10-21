import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { MessageSquareIcon, PlugIcon, PlusIcon, type Icon } from '@/components/icons'

/*
  The quick actions (Home P): the only boxes on Home besides the search field and the table,
  because each is one thing to click. The assistant has its own launcher in the corner of every
  page, so Home reaches it only from the search field's "Ask the assistant" row. "Try a question"
  opens What an agent would get on the Try it page; "Connect your AI" is the line on Home the
  captain chose for the page that says how to use these facts from your own AI client. Side by
  side from the container's xl width; below it each tile is one row with its icon on the left.
*/

const tile =
  'flex min-w-0 flex-1 items-center gap-3 rounded-lg border bg-card p-4 text-left -outline-offset-1 transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring @xl:flex-col @xl:items-start @xl:gap-1'

function TileBody({
  icon: Glyph,
  title,
  children,
}: {
  icon: Icon
  title: string
  children: ReactNode
}) {
  return (
    <>
      <span className="flex h-control-sm shrink-0 items-center">
        <Glyph aria-hidden="true" className="size-5 text-foreground" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="text-body font-bold">{title}</span>
        <span className="text-dense text-muted-foreground">{children}</span>
      </span>
    </>
  )
}

export function QuickActions() {
  return (
    <section aria-labelledby="home-quick-actions" className="flex flex-col gap-3">
      <h2 id="home-quick-actions" className="text-body font-bold">
        Quick actions
      </h2>
      <ul className="grid grid-cols-1 gap-3 @xl:grid-cols-3">
        <li className="flex">
          <Link to="/try-it" className={tile} data-slot="quick-action">
            <TileBody icon={MessageSquareIcon} title="Try a question">
              See what an agent gets for it.
            </TileBody>
          </Link>
        </li>
        <li className="flex">
          <Link to="/library/new" className={tile} data-slot="quick-action">
            <TileBody icon={PlusIcon} title="Add a fact">
              Write down something people should know.
            </TileBody>
          </Link>
        </li>
        <li className="flex">
          <Link
            to="/settings"
            search={{ section: 'connect' }}
            className={tile}
            data-slot="quick-action"
          >
            <TileBody icon={PlugIcon} title="Connect an agent">
              Let Claude or another agent use these facts.
            </TileBody>
          </Link>
        </li>
      </ul>
    </section>
  )
}
