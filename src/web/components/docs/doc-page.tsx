import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { plainClick } from '@/components/app-shell/trail'
import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/editions/load-error'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChevronDownIcon,
  ExternalLinkIcon,
  SearchXIcon,
  TimerIcon,
} from '@/components/icons'
import { Page, PageContent, PageDocument } from '@/components/page/page'
import { PageRail, RailSection } from '@/components/page/page-rail'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  docKindNames,
  docsRepository,
  docTemplates,
  type DocHeading,
  type DocPage,
  type DocsLibrary,
} from '@/lib/docs'
import { docsQuery } from '@/lib/docs-sections'
import { formatDay } from '@/lib/library'
import { cn } from '@/lib/utils'
import { DocBlocks, DocLink, ReadingTime } from './doc-parts'

/*
  A page of the docs (docs/help/README.md, "How a page is made"): the document template, its
  title in the paper with one quiet line of what it is (its kind, reading time and who it is
  for), a concept's answer in one minute in a box under it, the body in the reading type, and the
  page rail with On this page, Related, the page's owner and the day it was last checked, and
  Edit this page on GitHub. Previous and Next follow the docs' order. In docs mode the docs'
  sidebar takes room from the page, so the rail sits beside it from a 1,024 page; below that, On
  this page folds under the title.
*/

export function DocPageRoute({ slug }: { slug: string }) {
  const docs = useQuery(docsQuery())
  if (docs.isError)
    return (
      <Page title="Docs">
        <PageContent width="reading">
          <LoadError
            what="the docs"
            onRetry={() => void docs.refetch()}
            detail={docs.error.message}
          />
        </PageContent>
      </Page>
    )
  if (!docs.data) return <DocLoading />
  const page = docs.data.page(slug)
  if (!page) return <DocNotFound slug={slug} />
  return <DocPageView page={page} docs={docs.data} />
}

function DocLoading() {
  return (
    <Page title="Docs">
      <PageDocument>
        <div
          role="status"
          aria-label="Loading the page"
          className="flex w-full max-w-reading flex-col gap-4"
        >
          <Skeleton className="h-6 w-1/4" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </PageDocument>
    </Page>
  )
}

function DocNotFound({ slug }: { slug: string }) {
  return (
    <Page title="Page not found">
      <PageContent width="overview">
        <Empty className="border" data-slot="doc-not-found">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle className="break-all">There is no page “{slug}” in the docs</EmptyTitle>
            <EmptyDescription>
              The address may be mistyped, or the page may have a new name. Every page is listed on
              the docs home.
            </EmptyDescription>
          </EmptyHeader>
          <Button variant="outline" render={<Link to="/docs" />}>
            Go to the docs home
          </Button>
        </Empty>
      </PageContent>
    </Page>
  )
}

export function DocPageView({ page, docs }: { page: DocPage; docs: DocsLibrary }) {
  const at = docs.pages.findIndex((entry) => entry.slug === page.slug)
  const previous = docs.pages[at - 1]
  const next = docs.pages[at + 1]
  const related = (page.related ?? []).flatMap((slug) => docs.page(slug) ?? [])
  const outline = page.headings.filter((heading) => heading.depth === 2)
  const current = useCurrentHeading(outline.map((heading) => heading.id))
  return (
    <Page
      title={page.title}
      documentTitle={`${page.title} - Docs`}
      heading="paper"
      data-template="document"
      data-docs
      data-doc-template={docTemplates[page.kind]}
    >
      <PageDocument besideFrom="1024" className="grow">
        <article data-slot="paper" className="flex w-full max-w-reading min-w-0 flex-col gap-8">
          <header className="flex flex-col gap-2">
            <h1 className="text-display font-bold tracking-display text-balance">{page.title}</h1>
            <p
              data-slot="doc-meta"
              className="flex flex-wrap items-center gap-x-2 text-dense text-muted-foreground"
            >
              <span>{docKindNames[page.kind]}</span>
              <span aria-hidden="true">·</span>
              <ReadingTime minutes={page.minutes} read />
              <span aria-hidden="true">·</span>
              <span>{page.forWhom}</span>
            </p>
          </header>
          {outline.length > 1 ? (
            <FoldedOutline slug={page.slug} outline={outline} current={current} />
          ) : null}
          {page.oneMinute ? (
            <section
              aria-labelledby="in-one-minute"
              data-slot="doc-one-minute"
              className="flex flex-col gap-2 rounded-lg bg-muted p-4"
            >
              <h2 id="in-one-minute" className="flex items-center gap-2 text-body font-bold">
                <TimerIcon aria-hidden="true" className="size-4 text-muted-foreground" />
                In one minute
              </h2>
              <DocBlocks blocks={page.oneMinute} />
            </section>
          ) : null}
          <DocBlocks blocks={page.blocks} />
          {previous || next ? (
            <nav
              aria-label="More pages"
              className="flex flex-col gap-3 border-t pt-6 @2xl:flex-row"
            >
              {previous ? <Pager page={previous} direction="previous" /> : null}
              {next ? <Pager page={next} direction="next" /> : null}
            </nav>
          ) : null}
        </article>
        {/*
          Under the page, On this page is hidden, so the first section left draws the line above
          the rail instead of the rail and that section drawing one each.
        */}
        <PageRail
          aria-label="About this page"
          besideFrom="1024"
          className={outline.length > 1 ? 'border-t-0 pt-0' : undefined}
        >
          {/* Beside the page it stays in view while the page scrolls; under it, it has no room to. */}
          <div className="sticky top-rail-sticky flex flex-col gap-6">
            {outline.length > 1 ? (
              // Under the page there is nothing left to jump to: it folds under the title instead.
              <RailSection title="On this page" className="hidden @5xl:flex">
                <ul className="flex flex-col gap-2 text-dense">
                  {outline.map((heading) => (
                    <li key={heading.id}>
                      <HeadingLink
                        slug={page.slug}
                        id={heading.id}
                        current={current === heading.id}
                      >
                        {heading.title}
                      </HeadingLink>
                    </li>
                  ))}
                </ul>
              </RailSection>
            ) : null}
            {related.length ? (
              <RailSection title="Related">
                <ul className="flex flex-col gap-2 text-dense">
                  {related.map((entry) => (
                    <li key={entry.slug}>
                      <DocLink
                        slug={entry.slug}
                        className="text-brand-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        {entry.title}
                      </DocLink>
                    </li>
                  ))}
                </ul>
              </RailSection>
            ) : null}
            <RailSection title="About this page">
              <dl className="flex flex-col gap-2 text-dense">
                <div className="flex flex-col">
                  <dt className="text-muted-foreground">Owner</dt>
                  <dd>{page.owner}</dd>
                </div>
                <div className="flex flex-col">
                  <dt className="text-muted-foreground">Last checked</dt>
                  <dd>{formatDay(page.reviewed)}</dd>
                </div>
              </dl>
              <a
                href={`${docsRepository}/blob/main/${page.file}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-dense text-brand-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
              >
                Edit this page on GitHub
                <ExternalLinkIcon aria-hidden="true" className="size-icon-sm" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </RailSection>
          </div>
        </PageRail>
      </PageDocument>
    </Page>
  )
}

/**
 * On this page under the title, while the rail is under the page (below a 1,024 page): closed,
 * it is one line with the number of sections; open, the sections, each a link to its heading.
 */
function FoldedOutline({
  slug,
  outline,
  current,
}: {
  slug: string
  outline: DocHeading[]
  current: string | undefined
}) {
  return (
    <details data-slot="doc-outline" className="group rounded-lg border @5xl:hidden">
      <summary className="flex min-h-control-lg cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-4 text-dense font-bold -outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring @max-md:min-h-control-touch [&::-webkit-details-marker]:hidden">
        On this page
        <span className="flex items-center gap-2 text-caption font-normal text-muted-foreground">
          {outline.length} sections
          <ChevronDownIcon
            aria-hidden="true"
            className="size-4 transition-transform duration-fast group-open:rotate-180"
          />
        </span>
      </summary>
      <ul className="flex flex-col gap-2 border-t px-4 py-3 text-dense">
        {outline.map((heading) => (
          <li key={heading.id}>
            <HeadingLink slug={slug} id={heading.id} current={current === heading.id}>
              {heading.title}
            </HeadingLink>
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * A heading of the page in On this page. It goes there through the router, which then scrolls
 * the heading into view rather than restoring the page's last position; it is not a router
 * `Link`, which would mark every link to this page as the page itself.
 */
function HeadingLink({
  slug,
  id,
  current,
  children,
}: {
  slug: string
  id: string
  current: boolean
  children: ReactNode
}) {
  const navigate = useNavigate()
  return (
    <a
      href={`#${id}`}
      aria-current={current ? 'location' : undefined}
      onClick={(event) => {
        if (!plainClick(event)) return
        event.preventDefault()
        void navigate({ to: '/docs/$slug', params: { slug }, hash: id })
      }}
      className={cn(
        'hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
        current ? 'font-bold text-foreground' : 'text-muted-foreground',
      )}
    >
      {children}
    </a>
  )
}

/**
 * The section being read, for On this page: the last heading that has reached the top of the
 * reading area, under the header, or the first before any has. At the end of the page, where
 * the last sections cannot scroll up that far, the heading the address names wins.
 */
function useCurrentHeading(ids: readonly string[]): string | undefined {
  const key = ids.join(' ')
  const [current, setCurrent] = useState<string | undefined>(undefined)
  useEffect(() => {
    if (!key) return
    const order = key.split(' ')
    let frame = 0
    const update = () => {
      frame = 0
      // Where a heading a link points at stops (its scroll margin), and a little below.
      const line = parseFloat(getComputedStyle(document.documentElement).fontSize) * 8
      let last = order[0]
      for (const id of order) {
        const heading = document.getElementById(id)
        if (heading && heading.getBoundingClientRect().top <= line) last = id
      }
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2
      const named = decodeURIComponent(window.location.hash.slice(1))
      setCurrent(atEnd && order.includes(named) ? named : last)
    }
    const onScroll = () => {
      frame ||= window.requestAnimationFrame(update)
    }
    onScroll()
    document.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', onScroll, { passive: true })
    return () => {
      document.removeEventListener('scroll', onScroll, { capture: true })
      window.removeEventListener('resize', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [key])
  return current
}

function Pager({ page, direction }: { page: DocPage; direction: 'previous' | 'next' }) {
  const Arrow = direction === 'previous' ? ArrowLeftIcon : ArrowRightIcon
  return (
    <DocLink
      slug={page.slug}
      rel={direction === 'previous' ? 'prev' : 'next'}
      className={
        direction === 'next'
          ? 'flex flex-1 flex-col items-end gap-1 rounded-lg border p-4 text-right hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'
          : 'flex flex-1 flex-col gap-1 rounded-lg border p-4 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring'
      }
    >
      <span className="flex items-center gap-1 text-caption text-muted-foreground">
        {direction === 'previous' ? <Arrow aria-hidden="true" className="size-icon-sm" /> : null}
        {direction === 'previous' ? 'Previous' : 'Next'}
        {direction === 'next' ? <Arrow aria-hidden="true" className="size-icon-sm" /> : null}
      </span>
      <span className="text-body font-bold">{page.title}</span>
    </DocLink>
  )
}
