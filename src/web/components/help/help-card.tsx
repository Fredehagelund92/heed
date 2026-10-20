import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { MarkdownBlocks } from '@/components/assistant/answer-markdown'
import { DocKindBadge, ReadingTime } from '@/components/docs/doc-parts'
import type { MentionRenderer } from '@/components/form/markdown'
import { ArrowRightIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { PopoverDescription, PopoverHeader, PopoverTitle } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { docExcerpt } from '@/lib/docs'
import { docsQuery } from '@/lib/docs-sections'
import { helpPlace, type HelpTarget } from '@/lib/help'

/*
  The card a help link opens (`help-link.tsx`): the kind and reading time of the page, the
  heading or the page's title, the few lines that answer the question, and Read the whole page.
  A chunk of its own, with the pages and their renderer.
*/

/** A mention never appears in the pages; their words are drawn as written. */
const plainMention: MentionRenderer = ({ label }) => label

export function HelpCard({ target }: { target: HelpTarget }) {
  const docs = useQuery(docsQuery())
  if (docs.isError)
    return (
      <PopoverHeader data-slot="help-failed">
        <PopoverTitle>Couldn't load the help</PopoverTitle>
        <PopoverDescription>
          Check your connection, then{' '}
          <button
            type="button"
            onClick={() => void docs.refetch()}
            className="text-foreground underline underline-offset-2"
          >
            try again
          </button>
          .
        </PopoverDescription>
      </PopoverHeader>
    )
  if (!docs.data)
    return (
      <div role="status" aria-label="Loading the help" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  const { slug, heading } = helpPlace(target)
  const page = docs.data.page(slug)
  // The docs check keeps every target on a page; this is a page renamed without its links.
  const excerpt = page ? docExcerpt(page, heading) : null
  if (!page || !excerpt)
    return (
      <PopoverHeader>
        <PopoverTitle>This help has moved</PopoverTitle>
        <PopoverDescription>
          Every page is on the{' '}
          <Link to="/docs" className="text-foreground underline underline-offset-2">
            docs home
          </Link>
          .
        </PopoverDescription>
      </PopoverHeader>
    )
  return (
    <>
      <PopoverHeader className="gap-2">
        <span className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground">
          <DocKindBadge kind={page.kind} size="sm" />
          <ReadingTime minutes={page.minutes} />
        </span>
        <PopoverTitle className="text-body">{excerpt.title}</PopoverTitle>
      </PopoverHeader>
      <div data-slot="help-excerpt" className="flex min-w-0 flex-col gap-2 text-dense break-words">
        <MarkdownBlocks blocks={excerpt.blocks} look="answer" renderMention={plainMention} />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-fit"
        render={<Link to="/docs/$slug" params={{ slug }} hash={heading} />}
      >
        Read the whole page
        <ArrowRightIcon data-icon="inline-end" />
      </Button>
    </>
  )
}
