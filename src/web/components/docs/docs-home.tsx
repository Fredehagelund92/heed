import { useId, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { LoadError } from '@/components/editions/load-error'
import { ExternalLinkIcon } from '@/components/icons'
import { Page, PageContent } from '@/components/page/page'
import { Skeleton } from '@/components/ui/skeleton'
import { docPicture, docsFolder, docsRepository, type DocPage, type DocsLibrary } from '@/lib/docs'
import { docSectionTitle, docsQuery, type DocSectionId } from '@/lib/docs-sections'
import { cn } from '@/lib/utils'
import { DocLink, ReadingTime } from './doc-parts'
import { productName } from '@/lib/brand'

/*
  The docs home (docs/help/README.md), a way in rather than a wall of cards: the pages to read
  first, in order; how Heed works, as the loop picture with the page for each step; and the pages
  to look something up in. The docs' sidebar lists and searches every page. A section's own
  address (`?section=`, the crumb of a page) lists that section's pages.
*/

const linkClass =
  'text-brand-ink underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring'

export function DocsHome({ section }: { section?: DocSectionId }) {
  const docs = useQuery(docsQuery())
  const title = section ? docSectionTitle(section) : 'Docs'
  return (
    <Page title={title} documentTitle={section ? `${title} - Docs` : title} data-docs>
      <PageContent width="reading" className="gap-12">
        {docs.isError ? (
          <LoadError
            what="the docs"
            onRetry={() => void docs.refetch()}
            detail={docs.error.message}
          />
        ) : !docs.data ? (
          <div role="status" aria-label="Loading the docs" className="flex flex-col gap-4">
            <Skeleton className="h-6 w-1/4" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : section ? (
          <SectionPages docs={docs.data} section={section} />
        ) : (
          <>
            <p className="text-reading text-muted-foreground">
              What {productName} is, how it fits with your AI agent, and how to do your part. Read
              the first three pages in order; the others answer one question each.
            </p>
            <StartPath docs={docs.data} />
            <HowHeedWorks docs={docs.data} />
            <LookUp docs={docs.data} />
          </>
        )}
        <p className="flex flex-wrap items-center gap-1 text-dense text-muted-foreground">
          These pages are Markdown files in the repository, in {docsFolder}.
          <a
            href={`${docsRepository}/tree/main/${docsFolder}`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn('inline-flex items-center gap-1', linkClass)}
          >
            Read and edit them on GitHub
            <ExternalLinkIcon aria-hidden="true" className="size-icon-sm" />
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </p>
      </PageContent>
    </Page>
  )
}

const pagesOf = (docs: DocsLibrary, slugs: readonly string[]) =>
  slugs.flatMap((slug) => docs.page(slug) ?? [])

/** A heading of the home, with a fact at the end of its line. */
function HomeSection({
  title,
  fact,
  children,
}: {
  title: string
  fact?: string
  children: ReactNode
}) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2 id={id} className="text-large font-bold tracking-large">
          {title}
        </h2>
        {fact ? (
          <span className="text-dense text-muted-foreground tabular-nums">{fact}</span>
        ) : null}
      </div>
      {children}
    </section>
  )
}

/** Start here, in the section's order: numbered steps joined by a line. */
function StartPath({ docs }: { docs: DocsLibrary }) {
  const path = docs.pages.filter((page) => page.section === 'start')
  const minutes = path.reduce((sum, page) => sum + page.minutes, 0)
  return (
    <HomeSection title="Start here, in this order" fact={`${minutes} min in all`}>
      <ol data-slot="docs-start-path" className="flex flex-col">
        {path.map((page, index) => {
          const last = index === path.length - 1
          return (
            <li key={page.slug} className="flex gap-4">
              <div aria-hidden="true" className="flex flex-col items-center">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border text-dense font-bold tabular-nums">
                  {index + 1}
                </span>
                {last ? null : <span className="w-px flex-1 bg-border" />}
              </div>
              <div className={cn('flex min-w-0 flex-1 flex-col gap-1 pt-1', !last && 'pb-6')}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <DocLink
                    slug={page.slug}
                    className="text-body font-bold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    {page.title}
                  </DocLink>
                  <ReadingTime
                    minutes={page.minutes}
                    className="text-dense text-muted-foreground"
                  />
                </div>
                <p className="text-dense text-muted-foreground">{page.summary}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </HomeSection>
  )
}

/** The steps of the Heed loop (docs/help/images/heed-loop.svg), each with the pages that do it. */
const loopSteps = [
  {
    step: 'Write',
    line: "Anyone writes down what the numbers don't show.",
    pages: [
      'add-your-first-context',
      'assistant',
      'tell-heed-about-your-business',
      'add-a-connector',
    ],
  },
  {
    step: 'Review',
    line: 'The owner of the domain checks it.',
    pages: ['review-a-proposal'],
  },
  {
    step: 'Publish',
    line: 'Accepted facts reach agents at once.',
    pages: ['editions'],
  },
  {
    step: 'Use',
    line: 'Your agent reads them before it answers.',
    pages: ['connect-an-agent'],
  },
  {
    step: 'Learn',
    line: 'A question with no answer becomes a gap to fill.',
    pages: ['read-health'],
  },
] as const

const LOOP = 'docs/help/images/heed-loop.svg'

/**
 * How Heed works: the loop picture, drawn inline in the app's tokens, then each step with the
 * pages that do it. The picture shows from a 672 page, where it fits without scrolling; the
 * steps say all it says.
 */
function HowHeedWorks({ docs }: { docs: DocsLibrary }) {
  const loop = docPicture(LOOP)
  return (
    <HomeSection title="How it works">
      <p className="text-reading text-muted-foreground">
        People write down what the numbers don't show, an owner checks it, and agents read it before
        they answer. Each step has a page.
      </p>
      {loop ? (
        <div
          role="img"
          aria-label="The loop: people write facts, owners review them, accepted facts reach agents at once, agents read them before they answer, and questions with no answer become gaps that people fill."
          data-slot="docs-loop"
          className="hidden rounded-lg border p-4 @2xl:block [&>svg]:h-auto [&>svg]:max-w-full"
          // A file of the repository, checked by the docs test: no script, link or handler.
          dangerouslySetInnerHTML={{ __html: loop }}
        />
      ) : null}
      <ol data-slot="docs-loop-steps" className="flex flex-col divide-y border-y">
        {loopSteps.map((entry, index) => (
          <li key={entry.step} className="flex gap-4 py-3">
            <span className="w-6 shrink-0 text-dense font-bold text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2 @xl:flex-row @xl:gap-4">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-body font-bold">{entry.step}</span>
                <span className="text-dense text-muted-foreground">{entry.line}</span>
              </div>
              <ul className="flex min-w-0 flex-1 flex-col gap-1 text-dense">
                {pagesOf(docs, entry.pages).map((page) => (
                  <li key={page.slug} className="flex flex-wrap items-baseline gap-x-2">
                    <DocLink slug={page.slug} className={linkClass}>
                      {page.title}
                    </DocLink>
                    <ReadingTime
                      minutes={page.minutes}
                      className="text-caption text-muted-foreground"
                    />
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </HomeSection>
  )
}

/** The pages to look something up in: a row each, its title and what it holds. */
function LookUp({ docs }: { docs: DocsLibrary }) {
  const pages = docs.pages.filter(
    (page) => page.section === 'reference' || page.section === 'questions',
  )
  return (
    <HomeSection title="Look something up">
      <PageRows pages={pages} />
    </HomeSection>
  )
}

/** Pages as plain rows: the title, what it is about and how long it takes to read. */
function PageRows({ pages }: { pages: DocPage[] }) {
  return (
    <ul data-slot="docs-rows" className="flex flex-col divide-y border-y">
      {pages.map((page) => (
        <li key={page.slug} className="flex flex-col gap-1 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <DocLink
              slug={page.slug}
              className="text-body font-bold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              {page.title}
            </DocLink>
            <ReadingTime minutes={page.minutes} className="text-dense text-muted-foreground" />
          </div>
          <p className="text-dense text-muted-foreground">{page.summary}</p>
        </li>
      ))}
    </ul>
  )
}

/** What each section holds, over its pages on the section's own address. */
const sectionLines: Record<DocSectionId, string> = {
  start: `What ${productName} is and how the parts fit. Read these in order.`,
  concepts: 'The ideas behind the screens.',
  guides: 'One task each, step by step.',
  connect: `Use ${productName} from Claude Code and other agents.`,
  reference: 'Every word the app uses, in one sentence each.',
  questions: 'Short answers to what people ask most.',
}

/** A section on its own address: what it holds, then its pages. */
function SectionPages({ docs, section }: { docs: DocsLibrary; section: DocSectionId }) {
  return (
    <section aria-label={docSectionTitle(section)} className="flex flex-col gap-4">
      <p className="text-reading text-muted-foreground">{sectionLines[section]}</p>
      <PageRows pages={docs.pages.filter((page) => page.section === section)} />
    </section>
  )
}
