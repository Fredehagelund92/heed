import { useEffect, type ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { useTrail } from '@/components/app-shell/trail-context'
import { productName } from '@/lib/brand'
import { cn } from '@/lib/utils'

/**
 * Page templates. Every page is a column of up to three regions, and every region sits inside
 * the same horizontal gutter (`px-gutter`, one variable in tokens.css), so the left edges of
 * the shell header, the toolbar and the content line up by construction.
 * tests/e2e/layout.spec.ts asserts it at every width.
 *
 * The page title is shown once (contract 8.6). On list and overview pages it is the last
 * breadcrumb in the shell header, and `Page` adds the same title as a visually hidden heading.
 * A phone's header has room for the way up only below a sidebar place (contract 8.11), so there
 * the heading shows at the top of the content instead. On a document page the paper shows the
 * title as the page's `h1`, so `heading="paper"` leaves the hidden one out. Either way `Page`
 * sets the document title: the title, or `documentTitle` when it names the place too.
 */

export function Page({
  title,
  documentTitle = title,
  heading = 'hidden',
  launcherRoom = 'every-width',
  className,
  children,
  ...props
}: Omit<ComponentProps<'div'>, 'title'> & {
  title: string
  documentTitle?: string
  heading?: 'hidden' | 'paper'
  /**
   * Where the page keeps room at its end for the assistant launcher, so its last row scrolls
   * clear of it (A7): at every width, or only on a phone, for a page whose panes scroll on their
   * own from 768 wide (the Workbench).
   */
  launcherRoom?: 'every-width' | 'phone'
}) {
  useEffect(() => {
    document.title = `${documentTitle} - ${productName}`
  }, [documentTitle])
  const deep = useTrail().length > 1
  return (
    <div
      data-slot="page"
      className={cn(
        '@container flex min-h-0 flex-1 flex-col',
        // Only while the launcher is there: the assistant's own pages have none.
        launcherRoom === 'every-width'
          ? '[body:has([data-slot=assistant-launcher])_&]:pb-launcher-clear [body:has([data-slot=assistant-launcher])_&]:[&>[data-launcher-clear]]:launcher-clear-above'
          : 'max-md:[body:has([data-slot=assistant-launcher])_&]:pb-launcher-clear max-md:[body:has([data-slot=assistant-launcher])_&]:[&>[data-launcher-clear]]:launcher-clear-above',
        className,
      )}
      {...props}
    >
      {heading === 'paper' ? null : deep ? (
        // One heading at each width: the header's crumb names the page from 768, the content on
        // a phone.
        <>
          <h1 className="sr-only max-md:hidden">{title}</h1>
          <h1 className="px-gutter pt-6 text-title font-bold md:hidden">{title}</h1>
        </>
      ) : (
        <h1 className="sr-only">{title}</h1>
      )}
      {children}
    </div>
  )
}

/**
 * A row of controls under the shell header: tabs, filters, view switches. 44 high around 28 pixel
 * ghost controls (`size="toolbar"`, the professional pass); a phone's 44 pixel targets get 12
 * above and below, as before.
 */
export function PageToolbar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-toolbar"
      data-layout="toolbar"
      className={cn(
        'flex min-h-toolbar flex-wrap items-center gap-2 border-b px-gutter py-2 @max-2xl:py-3',
        className,
      )}
      {...props}
    />
  )
}

const pageContentVariants = cva('flex min-w-0 flex-1 flex-col gap-6 px-gutter py-6', {
  variants: {
    /** list: full width. overview: capped at 70rem (1120). reading: capped at 45rem (720). All stay left aligned. */
    width: {
      list: '',
      overview: 'max-w-overview',
      reading: 'max-w-reading',
    },
  },
  defaultVariants: { width: 'list' },
})

export function PageContent({
  className,
  width,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof pageContentVariants>) {
  return (
    <div
      data-slot="page-content"
      data-layout="content"
      className={cn(pageContentVariants({ width }), className)}
      {...props}
    />
  )
}

/**
 * The document template's header above the body (contract 5, "Document page"): the title and
 * what is true of the subject, on the page background and in the gutter, so its left edge is the
 * body's. The item page puts its badges, title, actions and note line here.
 */
export function PageDocumentHeader({ className, ...props }: ComponentProps<'header'>) {
  return (
    <header
      data-slot="page-document-header"
      data-layout="content"
      className={cn('flex flex-col gap-3 px-gutter pt-6', className)}
      {...props}
    />
  )
}

const pageDocumentVariants = cva('flex flex-col gap-8 px-gutter pt-8 pb-16', {
  variants: {
    /**
     * Where the paper and the companion go side by side: from a 1,152 page, or from a 1,024 page
     * in docs mode, whose own sidebar takes room from the page (contract 8.11). The rail follows
     * with the same `besideFrom`.
     */
    besideFrom: {
      '1152': '@6xl:flex-row @6xl:items-start',
      '1024': '@5xl:flex-row @5xl:items-start',
    },
  },
  defaultVariants: { besideFrom: '1152' },
})

/**
 * The document template's body (contract 5, "Document page"): 32 above the paper, 64 below the
 * last section, the paper (720) and the companion (320) side by side when the page is wide
 * enough, stacked below that.
 */
export function PageDocument({
  besideFrom,
  className,
  ...props
}: ComponentProps<'div'> & VariantProps<typeof pageDocumentVariants>) {
  return (
    <div
      data-slot="page-document"
      data-layout="content"
      className={cn(pageDocumentVariants({ besideFrom }), className)}
      {...props}
    />
  )
}

/**
 * A form's primary action stays within reach when the shell hides its desktop actions. The
 * assistant launcher rises over it, as over every bar stuck to the bottom of a page; a bar with
 * a More menu that offers the assistant (`AssistantMenuItem`) holds it instead, and the launcher
 * leaves the corner while the bar shows, so it covers none of the form above it (A7).
 */
export function PagePhoneActions({
  holdsAssistant = false,
  className,
  ...props
}: ComponentProps<'div'> & { holdsAssistant?: boolean }) {
  return (
    <div
      data-launcher-clear
      data-launcher-fold={holdsAssistant || undefined}
      className={cn(
        'sticky bottom-0 z-sticky flex items-center justify-between gap-2 border-t bg-background px-gutter py-3 pb-safe-bottom md:hidden',
        className,
      )}
      {...props}
    />
  )
}

/**
 * A bar that sticks to the bottom of the page while it scrolls, in the gutter: the review
 * screen's decision bar (frame C2, 8). It stays on every width, unlike `PagePhoneActions`.
 */
export function PageStickyBar({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-sticky-bar"
      data-launcher-clear
      className={cn('sticky bottom-0 z-sticky border-t bg-background px-gutter py-3', className)}
      {...props}
    />
  )
}
