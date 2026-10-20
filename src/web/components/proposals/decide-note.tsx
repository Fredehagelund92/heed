import { Link, useRouterState } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { signInPeopleQuery } from '@/api/queries'
import { InfoIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

/**
 * Where to switch to another local person, the sign-in page that offers them: only where the
 * local sign-in offers people (the pilot, a local install, the mock), never in production
 * (dev-sign-in.ts). Null elsewhere.
 */
export function useSwitchPerson(): { to: '/signed-out'; search: { from: string } } | null {
  const href = useRouterState({ select: (state) => state.location.href })
  const people = useQuery(signInPeopleQuery()).data?.length ?? 0
  return people > 1 ? { to: '/signed-out', search: { from: href } } : null
}

/**
 * The line above a list of proposals the person cannot all decide (FR-223): why, and who can, in
 * the words `undecidableSummary` makes of each row's `canDecideInList`; and, where local people
 * can be switched to, the way to review as one of them. It scrolls with the list: it is not chrome.
 */
export function DecideNote({ text, narrow }: { text: string; narrow: boolean }) {
  const switchTo = useSwitchPerson()
  return (
    <div data-slot="decide-note" className="border-b border-border-subtle px-gutter">
      {/* Inset as a group row's label, so the line starts where the list's rows do. */}
      <p
        className={cn(
          'flex items-start gap-2 py-3 text-dense text-muted-foreground',
          !narrow && 'px-3',
        )}
      >
        <InfoIcon aria-hidden="true" className="size-4 shrink-0" />
        <span className="min-w-0">
          {text}
          {switchTo ? (
            <>
              {' '}
              <Link {...switchTo} className="text-foreground underline underline-offset-2">
                Switch person
              </Link>{' '}
              to review as one of them.
            </>
          ) : null}
        </span>
      </p>
    </div>
  )
}
