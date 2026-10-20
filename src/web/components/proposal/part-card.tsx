import type { ComponentProps, ReactNode } from 'react'
import { RailSection, useInRail } from '@/components/page/page-rail'
import { cn } from '@/lib/utils'

/**
 * A part of a proposal (contract 5, "Document page"): a bold title with an optional fact beside
 * it (the risk, "Not published"), then the part's content. The checks, the agent preview and the
 * overlaps share it, so they read as one set. In a page rail it is a flat `RailSection`; in a
 * main column it is a card with one outer hairline.
 */
export function PartCard({
  title,
  aside,
  headingLevel = 2,
  className,
  children,
  ...props
}: Omit<ComponentProps<'section'>, 'title'> & {
  title: string
  /** A badge or fact at the end of the title row. */
  aside?: ReactNode
  /** h2 in the rail of a page; h3 when the part sits under a section heading. */
  headingLevel?: 2 | 3
}) {
  const inRail = useInRail()
  if (inRail)
    return (
      <RailSection
        title={title}
        aside={aside}
        headingLevel={headingLevel}
        data-slot="part-card"
        className={className}
        {...props}
      >
        {children}
      </RailSection>
    )
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <section
      data-slot="part-card"
      className={cn('flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-4', className)}
      {...props}
    >
      <div className="flex min-h-control-sm items-center justify-between gap-3">
        <Heading className="text-body font-bold">{title}</Heading>
        {aside}
      </div>
      {children}
    </section>
  )
}
