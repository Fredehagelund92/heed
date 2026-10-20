import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { CatalogueTermDetail } from '@/api'
import { catalogueTermQuery } from '@/api/queries'
import { RefreshCwIcon } from '@/components/icons'
import { CountBadge } from '@/components/item/item-marks'
import { ListEmpty } from '@/components/library/list-state'
import { DockPanel, type DockTab } from '@/components/page/dock-panel'
import { PageRail } from '@/components/page/page-rail'
import { Button } from '@/components/ui/button'
import { termTabs, type TermTab } from '@/lib/term-page'
import { usePermissions } from '@/lib/use-session'
import { termKindNames } from './catalogue-marks'
import { TermBadges, TermDescription, TermNoteLine } from './term-header'
import { TermActions, TermTabPanels, termTabNames, useTermFacts } from './term-parts'

/*
  A metric or a dimension opened from the catalogue in the docked panel (design round 3,
  direction A): its badges with the source's read chip, its name and the copy of the source's description,
  the note line while something asks for a look, and the Overview (On the shelf, what the
  library holds and the issues), Context (with the items that only mention it) and Source tabs,
  the same parts as the metric page. The action group sits in the footer. Expand opens the term's page.
*/

type TermPanelProps = {
  /** The term's vocabulary key: `metric:orders`, `dim:market`. */
  termKey: string
  tab: TermTab
  onTabChange: (tab: TermTab) => void
  /** Where the term is in the list, when it is in it. */
  position: { index: number; total: number } | null
  onPrevious?: () => void
  onNext?: () => void
  onClose: () => void
}

/** `metric:orders` as the catalogue's term input. */
export function termOfKey(key: string): { kind: 'metric' | 'dimension'; id: string } {
  const [prefix, id = ''] = key.split(':')
  return { kind: prefix === 'dim' ? 'dimension' : 'metric', id }
}

function Meta({ kind, position }: { kind: string; position: TermPanelProps['position'] }) {
  return (
    <>
      <span className="truncate">{kind}</span>
      {position ? (
        <span className="shrink-0">
          · {(position.index + 1).toLocaleString('en')} of {position.total.toLocaleString('en')}
        </span>
      ) : null}
    </>
  )
}

export function TermPanel(props: TermPanelProps) {
  const { kind, id } = termOfKey(props.termKey)
  const query = useQuery(catalogueTermQuery(kind, id))
  if (query.data) return <TermPanelContent key={query.data.key} term={query.data} {...props} />
  const missing = query.data === null
  return (
    <DockPanel
      title={missing ? 'Term not found' : query.isError ? "The term couldn't load" : null}
      meta={<Meta kind={termKindNames[kind]} position={props.position} />}
      onClose={props.onClose}
      onPrevious={props.onPrevious}
      onNext={props.onNext}
    >
      {missing ? (
        <ListEmpty
          title="This term isn't in the catalogue"
          action={
            <Button variant="outline" onClick={props.onClose}>
              Close
            </Button>
          }
        >
          It may no longer be one of the names we know, or the link is mistyped. The list is still
          where it was.
        </ListEmpty>
      ) : query.isError ? (
        <ListEmpty
          title="Nothing is lost"
          action={
            <Button variant="outline" onClick={() => void query.refetch()}>
              <RefreshCwIcon />
              Try again
            </Button>
          }
        >
          Check your connection, then try again.
        </ListEmpty>
      ) : null}
    </DockPanel>
  )
}

function TermPanelContent({
  term,
  tab,
  onTabChange,
  position,
  onPrevious,
  onNext,
  onClose,
}: TermPanelProps & { term: CatalogueTermDetail }) {
  const facts = useTermFacts(term)
  const { isAdmin } = usePermissions()
  const page =
    term.kind === 'metric'
      ? ({ to: '/catalogue/metric/$id', params: { id: term.id } } as const)
      : ({ to: '/catalogue/dimension/$id', params: { id: term.id } } as const)
  const tabs: DockTab<TermTab>[] = termTabs.map((value) => ({
    value,
    label: termTabNames[value],
    count:
      value === 'context' && term.shelf.items > 0 ? (
        <CountBadge count={term.shelf.items} />
      ) : undefined,
  }))
  return (
    <DockPanel
      title={term.name}
      contentKey={term.key}
      meta={<Meta kind={termKindNames[term.kind]} position={position} />}
      badges={<TermBadges term={term} domain={facts.domain} chip={facts.chip} />}
      note={
        <>
          <TermDescription term={term} />
          {facts.note ? <TermNoteLine note={facts.note} /> : null}
        </>
      }
      tabs={tabs}
      tab={tab}
      onTabChange={onTabChange}
      tabsLabel={`${termKindNames[term.kind]} sections`}
      onPrevious={onPrevious}
      onNext={onNext}
      onClose={onClose}
      expand={
        // The page goes up to this list, the entry behind it, so its Escape comes back here.
        term.kind === 'metric' ? (
          <Link
            {...page}
            search={{ tab: tab === 'overview' ? undefined : tab }}
            state={{ fromParent: true }}
          />
        ) : (
          <Link {...page} state={{ fromParent: true }} />
        )
      }
      // A dimension's panel has an action for an administrator only: its Values.
      footer={term.kind === 'metric' || isAdmin ? <TermActions term={term} panel /> : undefined}
    >
      <PageRail placement="panel">
        <TermTabPanels
          term={term}
          facts={facts}
          shelf
          headingLevel={3}
          className="flex flex-col gap-8 text-body"
        />
      </PageRail>
    </DockPanel>
  )
}
