import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouterState } from '@tanstack/react-router'
import { areasQuery, vocabularyQuery } from '@/api/queries'
import { CornerDownLeftIcon } from '@/components/icons'
import { starters, type Starter } from '@/lib/assistant'
import { useLibrary } from '@/lib/use-library'

/*
  Before the first question (Assistant board, A.empty): what the assistant does, in a business
  person's words and in its own voice ("I"), without the product's name, and five questions that
  teach what it is good at. They are filled from what
  Heed holds, so each one finds something; on a fact's page the first explains that fact.
*/

/** The longest title an example fact may have in a suggested question. */
const STARTER_TITLE_LIMIT = 60

/** The fact whose page is open, if any: `/library/itm_...`. */
function usePageFact(): string | null {
  const path = useRouterState({ select: (state) => state.location.pathname })
  return /^\/library\/(itm_[a-z0-9]{8,16})/.exec(path)?.[1] ?? null
}

/** The suggested questions for the library and vocabulary Heed holds now. */
export function useStarters(): Starter[] {
  const library = useLibrary()
  const vocabulary = useQuery(vocabularyQuery()).data
  const areas = useQuery(areasQuery()).data
  const pageFact = usePageFact()
  return useMemo(() => {
    const rows = library.rows.filter((row) => row.status === 'accepted')
    const onPage = pageFact ? rows.find((row) => row.id === pageFact) : undefined
    // A recent event about a metric in a market, with a title short enough to read at a glance:
    // the kind of fact people ask about most.
    const example =
      [...rows]
        .filter(
          (row) =>
            row.kind === 'event' &&
            [...row.title].length <= STARTER_TITLE_LIMIT &&
            row.scope.metrics.length > 0 &&
            row.scope.dimensionValues.some((value) => value.dimension === 'market'),
        )
        .sort((a, b) => b.validity.start.localeCompare(a.validity.start))[0] ?? rows[0]
    const fact = onPage ?? example ?? null
    const metricId = fact?.scope.metrics[0] ?? vocabulary?.metrics[0]?.id
    const metric = vocabulary?.metrics.find((m) => m.id === metricId)
    const marketValue = fact?.scope.dimensionValues.find((v) => v.dimension === 'market')
    const market = vocabulary?.dimensions
      .find((d) => d.id === 'market')
      ?.values.find((v) => v.id === marketValue?.value)
    const area = areas?.find((a) => a.id === fact?.areaId) ?? areas?.[0]
    return starters({
      fact: fact ? { title: fact.title } : null,
      metric: metric ? { key: `metric:${metric.id}`, name: metric.name } : null,
      market: market ? { key: `val:market/${market.id}`, name: market.name } : null,
      area: area ? { name: area.name } : null,
      today: library.today,
    })
  }, [library.rows, library.today, vocabulary, areas, pageFact])
}

export function AskEmpty({ onAsk }: { onAsk: (starter: Starter) => void }) {
  const list = useStarters()
  return (
    <section
      data-slot="ask-empty"
      aria-labelledby="ask-empty-title"
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <h3 id="ask-empty-title" className="text-large font-bold">
          Ask me about your numbers
        </h3>
        <p className="text-dense text-muted-foreground">
          I can explain a fact, find the facts that apply to a metric, a market and dates, sum up a
          domain, or help you write a new fact. I check every fact I name before you see it.
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <h4 className="text-caption font-bold">Try one of these</h4>
        <ul aria-label="Suggested questions" className="flex flex-col gap-2">
          {list.map((starter) => (
            <li key={starter.label}>
              <button
                type="button"
                data-slot="ask-starter"
                onClick={() => onAsk(starter)}
                className="group/starter flex w-full items-start gap-3 rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-caption font-bold text-muted-foreground">
                    {starter.label}
                  </span>
                  <span className="text-dense">{starter.question}</span>
                </span>
                <CornerDownLeftIcon
                  aria-hidden="true"
                  className="size-4 shrink-0 text-muted-foreground group-hover/starter:text-foreground"
                />
                <span className="sr-only">, ask it</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
