import { ArrowUpRightIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { docHref, docTitle } from '@/lib/doc-links'

/** Under an aside's help: one quiet link to its guide in the documentation, which opens as its own site. */
export function GuideLink({ slug, className }: { slug: string; className?: string }) {
  const title = docTitle(slug)
  if (!title) return null
  return (
    <a
      href={docHref(slug)}
      target="_blank"
      rel="noreferrer"
      className={cn(
        'inline-flex min-h-6 w-fit items-center gap-1 text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:underline',
        className,
      )}
    >
      Read the guide
      <ArrowUpRightIcon className="size-3.5" aria-hidden />
      <span className="sr-only">: {title} (opens in a new tab)</span>
    </a>
  )
}
