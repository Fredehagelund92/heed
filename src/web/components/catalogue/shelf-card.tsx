import type { ItemKind } from '@domain/item'
import type { CatalogueTermDetail } from '@/api'
import { LibraryBigIcon } from '@/components/icons'
import { RailSection } from '@/components/page/page-rail'
import { kindCountText, kindSegments, shelfSentence } from '@/lib/term-page'
import { cn } from '@/lib/utils'

/** The kind hues of the bar and its legend: the kind's mark, the issue its warning. */
const kindFill: Record<ItemKind, string> = {
  event: 'bg-type-event-dot',
  note: 'bg-type-note-dot',
  guide: 'bg-type-guide-dot',
  example: 'bg-type-example-dot',
  issue: 'bg-status-warning-icon',
}

/**
 * What the library holds about a term, at a glance (the "On the shelf" section of the term
 * page's rail): the accepted items, a bar by kind in the kind hues with its legend (the words
 * carry the kind, never the colour alone), and one sentence on the newest change, what ended and
 * what needs a look. Beside the tabs from a wide page, above them below that.
 */
export function ShelfCard({
  term,
  headingLevel = 2,
}: {
  term: CatalogueTermDetail
  /** h3 in the docked panel, whose title is the h2. */
  headingLevel?: 2 | 3
}) {
  const { shelf } = term
  const segments = kindSegments(shelf.byKind)
  const sentence = shelfSentence(shelf)
  return (
    <RailSection
      title="On the shelf"
      icon={LibraryBigIcon}
      titleId="shelf-card-title"
      headingLevel={headingLevel}
      data-slot="shelf-card"
      className="gap-4"
    >
      <p className="flex items-baseline gap-2">
        <span className="text-display font-bold tracking-display tabular-nums">
          {shelf.items.toLocaleString('en')}
        </span>
        <span className="text-dense text-muted-foreground">
          {shelf.items === 1 ? 'fact' : 'facts'} about {term.name}
        </span>
      </p>
      {segments.length > 0 ? (
        <>
          <div
            aria-hidden="true"
            data-slot="shelf-bar"
            className="flex h-2 divide-x-2 divide-background overflow-hidden rounded-full"
          >
            {segments.map(({ kind, count }) => (
              <span
                key={kind}
                className={cn('min-w-1', kindFill[kind])}
                style={{ flexGrow: count }}
              />
            ))}
          </div>
          <ul
            aria-label="Facts by kind"
            className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground"
          >
            {segments.map(({ kind, count }) => (
              <li key={kind} className="inline-flex items-center gap-2">
                <span aria-hidden="true" className={cn('size-2 rounded-sm', kindFill[kind])} />
                <span>
                  <span className="font-bold text-foreground tabular-nums">
                    {count.toLocaleString('en')}
                  </span>{' '}
                  {kindCountText(kind, count).replace(/^[\d,]+ /, '')}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <p className="text-dense text-muted-foreground">
        {sentence ??
          `Nothing on the shelf yet. AI apps have nothing to add when someone asks about ${term.name}.`}
      </p>
    </RailSection>
  )
}
