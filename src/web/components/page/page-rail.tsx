import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react'
import { cva } from 'class-variance-authority'
import type { Icon } from '@/components/icons'
import { cn } from '@/lib/utils'

/*
  The page rail (contract 5, "Document page"): what sits beside a page's main column, such as
  the checks, the overlaps and the details of a proposal. It is flat: a plain column with a
  hairline on its left, its sections parted by a hairline, headings and text in the page's own
  type, and no card background or rounded outline. On a narrow page it stacks under the main
  column (or above it, for a summary that should be read first) with the hairline on top.

  The parts that sit in a rail (`PartCard`, `FieldTable`, the folded checks) read `useInRail`
  and drop their card frame there, so the same part is a card in a main column and a flat
  section in a rail. The `panel` placement has no frame of its own, for the contents of a docked
  panel.
*/

const InRail = createContext(false)

/** True inside a `PageRail`: a part drops its card frame and reads as a rail section. */
export function useInRail() {
  return useContext(InRail)
}

/**
 * The hairline between two sections of a rail. A section that is not a `RailSection` (the
 * folded checks) takes it too, so every section of a rail is parted the same way.
 */
export const railSectionClass = 'border-t pt-6 first:border-t-0 first:pt-0'

const pageRailVariants = cva('flex min-w-0 flex-col gap-6', {
  variants: {
    /**
     * responsive: beside the main column from a 1,152 pixel page (the document page's break),
     * stacked below that. beside and below: fixed, for a page that measures its own width.
     * panel: no frame and no width, for the contents of a docked panel.
     */
    placement: {
      responsive: 'w-full @6xl:w-companion @6xl:shrink-0 @6xl:self-stretch @6xl:border-l @6xl:pl-6',
      beside: 'w-companion shrink-0 self-stretch border-l pl-6',
      below: 'w-full',
      panel: 'w-full',
    },
    /** Where the rail goes on a narrow page: under the main column, or above it. */
    stack: { below: '', above: '' },
    /**
     * Where a responsive rail goes beside the main column: from a 1,152 page, or from a 1,024
     * page in docs mode, with the document's own `besideFrom` (contract 8.11).
     */
    besideFrom: { '1152': '', '1024': '' },
  },
  compoundVariants: [
    {
      placement: 'responsive',
      besideFrom: '1024',
      className:
        '@5xl:w-companion @5xl:shrink-0 @5xl:self-stretch @5xl:border-t-0 @5xl:border-b-0 @5xl:border-l @5xl:pt-0 @5xl:pb-0 @5xl:pl-6',
    },
    {
      placement: 'responsive',
      stack: 'below',
      className: 'border-t pt-6 @6xl:border-t-0 @6xl:pt-0',
    },
    {
      placement: 'responsive',
      stack: 'above',
      className: 'border-b pb-6 @6xl:border-b-0 @6xl:pb-0',
    },
    { placement: 'below', stack: 'below', className: 'border-t pt-6' },
    { placement: 'below', stack: 'above', className: 'border-b pb-6' },
  ],
  defaultVariants: { placement: 'responsive', stack: 'below', besideFrom: '1152' },
})

export function PageRail({
  placement = 'responsive',
  stack = 'below',
  besideFrom = '1152',
  className,
  ...props
}: ComponentProps<'aside'> & {
  placement?: 'responsive' | 'beside' | 'below' | 'panel'
  stack?: 'below' | 'above'
  besideFrom?: '1152' | '1024'
}) {
  return (
    <InRail.Provider value>
      <aside
        // In a docked panel the panel is the landmark, so its rail is a plain column.
        role={placement === 'panel' ? 'none' : undefined}
        data-slot="page-rail"
        data-placement={placement}
        className={cn(pageRailVariants({ placement, stack, besideFrom }), className)}
        {...props}
      />
    </InRail.Provider>
  )
}

/**
 * One section of a rail: an optional field icon, the heading in the page's body type, a badge or
 * an action at the end of the heading row, an optional line under it, then the content. A
 * hairline parts it from the section before it.
 */
export function RailSection({
  title,
  icon: Glyph,
  aside,
  description,
  headingLevel = 2,
  titleId,
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title: ReactNode
  icon?: Icon
  /** A badge, fact or small action at the end of the heading row. */
  aside?: ReactNode
  /** A muted line under the heading: what the section is about. */
  description?: ReactNode
  /** h2 in a page's rail; h3 when the rail sits under a section heading. */
  headingLevel?: 2 | 3
  /** The heading's id, when something else points at it (a field's `aria-labelledby`). */
  titleId?: string
}) {
  const generated = useId()
  const id = titleId ?? generated
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  const heading = (
    <div className="flex min-h-control-sm items-center gap-2">
      {Glyph ? (
        <Glyph aria-hidden="true" className="size-4 shrink-0 text-muted-foreground heed-ink" />
      ) : null}
      <Heading id={id} className="min-w-0 flex-1 text-body font-bold">
        {title}
      </Heading>
      {aside}
    </div>
  )
  return (
    <section
      aria-labelledby={id}
      data-slot="rail-section"
      className={cn('flex min-w-0 flex-col gap-3', railSectionClass, className)}
      {...props}
    >
      {description ? (
        <div className="flex min-w-0 flex-col gap-1">
          {heading}
          <p className="text-dense text-muted-foreground">{description}</p>
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  )
}
