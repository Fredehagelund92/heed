import {
  ChevronRightIcon,
  CircleSlashIcon,
  DatabaseIcon,
  ExternalLinkIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { connectorById } from '@/model/integrations'
import type { Figure, FigureView } from '@/model/figures'
import { useDomains, useFacts } from '@/lib/workspace'
import { openDock } from '@/lib/dock'
import { plainText } from '@/lib/mentions'
import { useWrite } from '@/api/queries'
import type { Answer } from '@/model/ask'

// A figure in an answer, kept apart from the context: its own line and icon, its own words ("From
// Cube, data as of today at 06:00"), never the word for context that an owner accepted. It sits
// after the answer's text and before its sources, and never changes the answer's state.

const SOURCE_URL: Record<string, string> = {
  cube: 'https://cube.larchwood.example/',
}

/** Where the figure came from and how fresh it is, then the definition, then the query in words. */
function Provenance({
  source,
  asOf,
  figure,
  metric,
}: {
  source: string
  asOf: string
  figure: Figure
  metric: string
}) {
  const name = connectorById(source)!.name
  return (
    <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-1.5">
        <span>
          From {name}, data as of {asOf}.
        </span>
        <button
          type="button"
          onClick={() => openDock('def', metric)}
          className="inline-flex h-6 items-center rounded-sm text-foreground underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Definition of {metric}
        </button>
      </p>
      <Collapsible>
        <CollapsibleTrigger className="group/q -ml-1 inline-flex h-7 items-center gap-1.5 rounded-md px-1 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
          <ChevronRightIcon
            className="size-3.5 transition-transform group-aria-expanded/q:rotate-90"
            aria-hidden
          />
          Show the query
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="mt-1 max-w-reading rounded-surface border border-input bg-background px-3 py-2 text-sm leading-relaxed text-foreground">
            {figure.words}
          </p>
          <p className="mt-1">
            Asked of {name} when this answer was written. Nothing it returned is kept; run it in{' '}
            {name} to check.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

/** One figure: what was counted, the number and how it moved. */
export function FigureLine({
  view,
  metric,
}: {
  view: Extract<FigureView, { kind: 'line' }>
  metric: string
}) {
  const f = view.figure
  return (
    <div className="flex gap-2.5">
      <DatabaseIcon aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-reading leading-relaxed">
          <span className="text-muted-foreground">{f.label}:</span>{' '}
          <span className="font-semibold tabular-nums">{f.value}</span>
          {f.change ? `, ${f.change}` : ''}.
        </p>
        <Provenance source={view.source} asOf={view.asOf} figure={f} metric={metric} />
      </div>
    </div>
  )
}

/** A figure that doesn't fit a context item: both side by side with their own sources, no verdict, two routes. */
export function FigureAgainst({
  view,
  answer,
  contact,
}: {
  view: Extract<FigureView, { kind: 'against' }>
  answer: Pick<Answer, 'question' | 'metric' | 'markets' | 'dates'>
  contact: string
}) {
  const f = view.figure
  const metric = answer.metric
  const facts = useFacts()
  const domains = useDomains()
  const write = useWrite()
  const item = facts.find((x) => x.id === f.against!.contextId)
  const owners = item ? domains[item.domain] : undefined
  /** A figure report on the item, to its owners or to the data contact. */
  const tell = (to: 'owners' | 'contact', sent: string, description: string) => {
    if (!item) return
    write('reportAnswer', {
      question: answer.question,
      part: 'figure',
      sources: [item.id],
      what: "The figure doesn't fit this context item.",
      figure: {
        source: view.source,
        to,
        metric: answer.metric,
        markets: answer.markets,
        ...(answer.dates ? { dates: answer.dates } : {}),
      },
    })
      .then(() => toast(sent, { description }))
      .catch(() =>
        toast.error("It wasn't sent", { description: 'Nothing was lost: try again in a moment.' }),
      )
  }
  return (
    <div className="flex flex-col gap-3 rounded-surface border border-caution/45 bg-caution/5 p-3 dark:border-warn/45 dark:bg-caution/8">
      <p className="text-sm">
        <span className="font-medium">The figure doesn't fit a context item.</span>{' '}
        <span className="text-muted-foreground">
          Neither is picked: one of them needs a look, by its owner or by the data contact.
        </span>
      </p>
      <div className="grid items-start gap-3 @lg:grid-cols-2">
        {item && (
          <div className="flex min-w-0 flex-col gap-1 rounded-surface border bg-background px-3 py-2.5">
            <p className="text-xs text-muted-foreground">Context</p>
            <button
              type="button"
              onClick={() => openDock('context', item.id)}
              className="text-left text-sm leading-snug font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.title}
            </button>
            <p className="line-clamp-3 text-sm text-muted-foreground">{plainText(item.summary)}</p>
            <p className="pt-1 text-xs text-muted-foreground">
              {domains[item.domain]?.name}, checked by {item.checkedBy}, {item.checkedOn}
            </p>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-1 rounded-surface border bg-background px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Figure</p>
          <p className="text-sm leading-snug font-medium">
            {f.label}: <span className="tabular-nums">{f.value}</span>
          </p>
          <p className="text-sm text-muted-foreground">
            {f.change && `${f.change[0]!.toUpperCase()}${f.change.slice(1)}.`}
          </p>
          <div className="pt-1">
            <Provenance source={view.source} asOf={view.asOf} figure={f} metric={metric} />
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {owners && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              tell(
                'owners',
                `Sent to the owner of ${owners.name}`,
                'They see the context item and the figure side by side.',
              )
            }
          >
            Tell the owner of {owners.name}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            tell(
              'contact',
              `Sent to ${contact}`,
              'The data contact sees the figure, its query and the context item.',
            )
          }
        >
          Tell {contact}, the data contact
        </Button>
      </div>
    </div>
  )
}

/** No figure: why, and the closest metrics there are. */
export function NoFigure({ view }: { view: Extract<FigureView, { kind: 'none' }> }) {
  return (
    <div className="flex items-start gap-2 rounded-surface border border-dashed border-input px-3 py-2 text-sm">
      <CircleSlashIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="flex flex-col gap-0.5">
        <p>
          <span className="font-medium">No figure.</span>{' '}
          <span className="text-muted-foreground">{view.why}</span>
        </p>
        {view.closest.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Closest that can be read: {view.closest.join(', ')}.
          </p>
        )}
      </div>
    </div>
  )
}

/** Figures off: a way into the tool that has the number. */
export function FigureLink({ view }: { view: Extract<FigureView, { kind: 'link' }> }) {
  const name = connectorById(view.source)!.name
  return (
    <a
      href={view.href ?? SOURCE_URL[view.source]}
      target="_blank"
      rel="noreferrer"
      className="inline-flex w-fit max-w-full items-start gap-1.5 rounded-md text-sm text-foreground underline decoration-foreground/25 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ExternalLinkIcon className="mt-1 size-3.5 shrink-0" aria-hidden />
      <span>
        See the figure in {name}: {view.scope}
        <span className="sr-only"> (opens in a new tab)</span>
      </span>
    </a>
  )
}
