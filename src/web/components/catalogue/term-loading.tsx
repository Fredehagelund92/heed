import { Page, PageDocument, PageDocumentHeader } from '@/components/page/page'
import { Skeleton } from '@/components/ui/skeleton'

// Its own module: the route shows it while its loader runs, so it is part of the first load,
// and the term page itself stays in its lazy chunk.

/** The page while the term loads: the header's rows and the card, as placeholders. */
export function TermLoading() {
  return (
    <Page title="Metric" heading="paper" data-template="document">
      <PageDocumentHeader>
        <div role="status" aria-label="Loading the metric" className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Skeleton className="h-6 w-column-kind" />
            <Skeleton className="h-6 w-column-kind" />
            <Skeleton className="h-6 w-column-domain" />
          </div>
          <Skeleton className="h-control-lg w-column-about" />
          <Skeleton className="h-4 w-full max-w-prose" />
        </div>
      </PageDocumentHeader>
      <PageDocument className="grow pt-6">
        <Skeleton className="h-row-scope w-full max-w-reading" />
      </PageDocument>
    </Page>
  )
}
