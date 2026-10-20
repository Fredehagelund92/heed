import type { ReactNode } from 'react'

/**
 * Shared parts of the form kit stories: the state grid (contract 7, "the state set") and the
 * 200 character label every component is shown with. Hover, focus-visible and pressed are drawn
 * with the pseudo-states addon: a story passes `stateParameters`, and the cells with those ids
 * get the state's styles without a pointer.
 */

/** A label of 200 characters, to show wrapping and truncation. */
export const LONG_LABEL =
  'The date the customs office in Norway published the notice that stopped online footwear and clothing sales from abroad, as printed at the top of the first page of the PDF'

export const stateParameters = {
  pseudo: {
    hover: ['#state-hover'],
    focusVisible: ['#state-focus'],
    active: ['#state-pressed'],
  },
}

/** One row of the state grid: the state's name, then the component in that state. */
export function StateRow({
  name,
  id,
  children,
}: {
  name: string
  id?: string
  children: ReactNode
}) {
  return (
    <div className="grid items-start gap-2 @lg:grid-cols-4 @lg:gap-6">
      <p className="text-caption font-bold text-muted-foreground @lg:pt-2">{name}</p>
      <div id={id} className="flex min-w-0 flex-col gap-2 @lg:col-span-3">
        {children}
      </div>
    </div>
  )
}

/** The page a story draws on: the paper's reading width, in the gutter. */
export function StoryPaper({ children }: { children: ReactNode }) {
  return (
    <div className="@container flex min-h-dvh w-full justify-start bg-background p-6 text-foreground">
      <div className="flex w-full max-w-reading flex-col gap-6">{children}</div>
    </div>
  )
}
