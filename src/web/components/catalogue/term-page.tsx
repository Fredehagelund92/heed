import { useNavigate, useRouter, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { catalogueTermInputSchema } from '../../../contract/catalogue.ts'
import type { CatalogueTermDetail, CatalogueTermKind } from '@/api'
import { catalogueTermQuery } from '@/api/queries'
import { LoadError } from '@/components/editions/load-error'
import { PlusIcon, SearchXIcon } from '@/components/icons'
import { CountBadge } from '@/components/item/item-marks'
import { Page, PageContent, PageDocument } from '@/components/page/page'
import { PageRail } from '@/components/page/page-rail'
import { Button } from '@/components/ui/button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { TermSearch } from '@/lib/search-params'
import { termTabs, type TermTab } from '@/lib/term-page'
import { termKindNames } from './catalogue-marks'
import { ShelfCard } from './shelf-card'
import { TermHeader } from './term-header'
import { TermLoading } from './term-loading'
import { TermActions, TermTabPanels, termTabNames, useTermFacts } from './term-parts'

/** No term by that id: say so, and offer the catalogue and Suggest a name (decision 5). */
function TermNotFound({ kind, id }: { kind: CatalogueTermKind; id: string }) {
  const name = termKindNames[kind]
  const word = name.toLowerCase()
  return (
    <Page title={`${name} not found`}>
      <PageContent width="overview">
        <Empty className="border" data-slot="term-not-found">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle className="break-all">
              There is no {word} “{id}” in the catalogue
            </EmptyTitle>
            <EmptyDescription>
              The address may be mistyped, or the {word} is no longer one of the names we know. Find
              it in the catalogue, or suggest it as a new name for an owner to review.
            </EmptyDescription>
          </EmptyHeader>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" render={<Link to="/catalogue" />}>
              Back to the catalogue
            </Button>
            <Button variant="outline" render={<Link to="/catalogue/suggest" />}>
              <PlusIcon />
              Suggest a name
            </Button>
          </div>
        </Empty>
      </PageContent>
    </Page>
  )
}

/**
 * A metric or a dimension of the catalogue (FR-136, slice S3 of the catalogue research): the item
 * page's header with the read chip and a note line while something asks for a look, the On the
 * shelf card, and the Overview, Context and Source tabs. A dimension's Overview lists its values,
 * with one picked out when a value chip opened the page (`search.value`). It reads `catalogue.get`
 * at every visit, so the copy of the source's description is the newest one Heed holds. No
 * formula (CON-207).
 */
export function TermPage({
  kind,
  id,
  search,
}: {
  kind: CatalogueTermKind
  id: string
  search: TermSearch
}) {
  const router = useRouter()
  const valid = catalogueTermInputSchema.safeParse({ kind, id }).success
  const query = useQuery({ ...catalogueTermQuery(kind, id), enabled: valid })
  if (!valid || query.data === null) return <TermNotFound kind={kind} id={id} />
  if (query.isError && query.data === undefined)
    return (
      <Page title={termKindNames[kind]}>
        <PageContent width="overview">
          <LoadError
            what={`this ${termKindNames[kind].toLowerCase()}`}
            // The loader runs again too, so the breadcrumb gets the name.
            onRetry={() => void router.invalidate()}
            detail={query.error.message}
          />
        </PageContent>
      </Page>
    )
  if (query.data === undefined) return <TermLoading />
  return <TermView key={query.data.key} term={query.data} search={search} />
}

function TermView({ term, search }: { term: CatalogueTermDetail; search: TermSearch }) {
  const navigate = useNavigate()
  const facts = useTermFacts(term)
  const tab: TermTab = search.tab ?? 'overview'
  const showTab = (value: TermTab) =>
    void navigate({
      to: term.kind === 'metric' ? '/catalogue/metric/$id' : '/catalogue/dimension/$id',
      params: { id: term.id },
      search: { tab: value === 'overview' ? undefined : value, value: search.value },
      replace: true,
      state: true,
    })

  return (
    <Page title={term.name} heading="paper" data-template="document" data-term-key={term.key}>
      <TermHeader
        term={term}
        domain={facts.domain}
        chip={facts.chip}
        note={facts.note}
        actions={<TermActions term={term} />}
      />
      <PageDocument className="grow pt-6">
        <PageRail
          aria-label={`${term.name} on the shelf`}
          stack="above"
          className="max-w-reading @6xl:order-last @6xl:ml-auto"
        >
          <ShelfCard term={term} />
        </PageRail>
        <article data-slot="paper" className="flex w-full max-w-reading min-w-0 flex-col gap-6">
          <Tabs value={tab} onValueChange={(value: TermTab) => showTab(value)}>
            <TabsList
              variant="line"
              aria-label={`${termKindNames[term.kind]} sections`}
              className="w-full justify-start border-b"
            >
              {termTabs.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {termTabNames[value]}
                  {value === 'context' && term.shelf.items > 0 ? (
                    <CountBadge count={term.shelf.items} />
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
            <TermTabPanels
              term={term}
              facts={facts}
              highlight={search.value}
              className="flex flex-col gap-8 pt-6 text-body"
            />
          </Tabs>
        </article>
      </PageDocument>
    </Page>
  )
}
