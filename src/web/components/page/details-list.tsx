import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Compact facts in a document's companion column, with room for values to wrap. On a phone a
 * label with a hint is a 24px target across its whole column (WCAG 2.5.8), so the sticky action
 * bar never leaves it only a sliver to tap; the text keeps its place.
 */
export function DetailsList({
  label,
  rows,
}: {
  label: string
  rows: { label: string; value: ReactNode; hint?: string }[]
}) {
  return (
    <dl aria-label={label} className="flex min-w-0 flex-col text-dense">
      {rows.map((row) => (
        <div key={row.label} className="flex min-h-control-md items-start gap-3 py-1">
          <dt className="w-details-label shrink-0 text-muted-foreground">
            {/* A hint's term is at least 24 high (WCAG 2.2 target size), its words on the first line. */}
            {row.hint ? (
              <Tooltip>
                <TooltipTrigger className="text-left underline decoration-border decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring max-md:flex max-md:min-h-6 max-md:w-full max-md:-translate-y-0.5 max-md:items-center">
                  {row.label}
                </TooltipTrigger>
                <TooltipContent>{row.hint}</TooltipContent>
              </Tooltip>
            ) : (
              row.label
            )}
          </dt>
          <dd className="min-w-0 flex-1 break-words">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
