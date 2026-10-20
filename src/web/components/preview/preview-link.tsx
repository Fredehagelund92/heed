import type { ComponentProps, ReactElement, ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { previewPage, type PreviewPage, type PreviewTarget } from '@/lib/preview'
import { cn } from '@/lib/utils'
import { PreviewTrigger } from './preview-trigger'

/**
 * The router link to a chip's page. A chip shown outside the app's router (a part rendered on its
 * own, as in a unit test) still previews, as a focusable span with no address.
 */
function PageLink({ page, ...props }: ComponentProps<'a'> & { page: PreviewPage }) {
  const router = useRouter({ warn: false }) as ReturnType<typeof useRouter> | null
  if (!router) {
    const { tabIndex, ref, ...rest } = props
    return <span ref={ref} tabIndex={tabIndex ?? 0} {...rest} />
  }
  return <Link {...page} {...props} />
}

/**
 * A chip that links to its page and previews it: a metric or a dimension to its catalogue page, a
 * value to its dimension's page with the value picked out, an item to its page. A person has no
 * page, so their chip is a focusable span that only previews. `newTab` keeps the page that holds
 * the chip, such as a form with unsaved words.
 */
export function PreviewLink({
  preview,
  newTab = false,
  className,
  label,
  tabIndex,
  children,
}: {
  preview: PreviewTarget
  newTab?: boolean
  className?: string
  /** -1 inside a grid row, where the row owns the keyboard. */
  tabIndex?: number
  /** The accessible name, when the chip's words are not enough. */
  label?: string
  children: ReactNode
}) {
  const page = previewPage(preview)
  if (!page)
    return (
      <PreviewTrigger
        preview={preview}
        render={<span tabIndex={tabIndex ?? 0} />}
        aria-label={label}
        className={className}
      >
        {children}
      </PreviewTrigger>
    )
  return (
    <PreviewTrigger
      preview={preview}
      render={
        <PageLink
          page={page}
          target={newTab ? '_blank' : undefined}
          rel={newTab ? 'noopener' : undefined}
        />
      }
      tabIndex={tabIndex}
      aria-label={label}
      className={className}
    >
      {children}
      {newTab ? <span className="sr-only"> (opens in a new tab)</span> : null}
    </PreviewTrigger>
  )
}

/**
 * The same link as an element for a `render` prop, so a badge keeps its own look and becomes the
 * link: `<Badge render={previewRender(preview)}>`.
 */
export function previewRender(preview: PreviewTarget): ReactElement {
  const page = previewPage(preview)
  return (
    <PreviewTrigger
      preview={preview}
      render={page ? <PageLink page={page} /> : <span tabIndex={0} />}
    />
  )
}

/**
 * A person, previewed: their name and the domains they look after. There is no people page, so
 * the wrapper is a focusable span around what shows the person (an `Owner`).
 */
export function PersonPreview({
  personId,
  tabIndex = 0,
  className,
  children,
}: {
  personId: string
  /** -1 inside a grid row, where the row owns the keyboard. */
  tabIndex?: number
  className?: string
  children: ReactNode
}) {
  return (
    <PreviewTrigger
      preview={{ type: 'person', id: personId }}
      render={<span tabIndex={tabIndex} />}
      className={cn(
        'inline-flex max-w-full min-w-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring',
        tabIndex < 0 && 'relative z-raised',
        className,
      )}
    >
      {children}
    </PreviewTrigger>
  )
}
