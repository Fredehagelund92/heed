import { figureConnections } from './integrations'
import { connectorById, type ConnectorId } from '@/model/integrations'
import type { Figure, FigureTry, FigureView } from '@/model/figures'
import type { FigureConnection } from '@/model/integrations'
import { metrics } from './world'
import {
  discountAfter,
  discountBefore,
  norwayAug,
  norwayJul,
  returnsBefore,
  returnsNorway,
  spainOct,
  spainSep,
  sum,
} from './figure-series'

// The figures an answer can show, from the demo warehouse behind the integrations: fixtures only,
// every one computed from a series (figure-series.ts, which the http journeys seed into a warehouse
// behind a stand-in Cube) so the line and its comparison agree. A figure is never context:
// it is read from an integration at a time, unchanged, and nobody here checked it. Which integration
// answers is decided by the metric's definition, never guessed.

const eur = (n: number) => `€${Math.round(n).toLocaleString('en-GB')}`
const pct = (a: number, b: number) => Math.round(((a - b) / b) * 100)
const moved = (a: number, b: number) =>
  pct(a, b) < 0 ? `down ${Math.abs(pct(a, b))}%` : `up ${pct(a, b)}%`

const fixtures: Record<string, Figure> = {
  'Orders|Norway|1 to 31 Aug 2026': {
    label: 'Orders in Norway, 1 to 31 Aug 2026',
    value: eur(sum(norwayAug)),
    change: `${moved(sum(norwayAug), norwayJul)} from July (${eur(norwayJul)})`,
    words:
      'Orders, added up for Norway from 1 to 31 Aug 2026, and the same for 1 to 31 Jul 2026 to compare.',
  },
  'Orders|Spain|1 to 31 Oct 2026': {
    label: 'Orders in Spain, 1 to 22 Oct 2026 (October so far)',
    value: eur(sum(spainOct)),
    change: `${moved(sum(spainOct), spainSep)} from 1 to 22 Sep (${eur(spainSep)})`,
    words:
      'Orders, added up for Spain from 1 Oct 2026 to yesterday, and the same days of September to compare.',
  },
  'Returns|Norway|20 Apr to 10 May 2026': {
    label: 'Returns in Norway, 20 Apr to 10 May 2026',
    value: eur(returnsNorway),
    change: `${moved(returnsNorway, returnsBefore)} from the three weeks before (${eur(returnsBefore)})`,
    words:
      'Returns, added up for Norway from 20 Apr to 10 May 2026, and the three weeks before to compare.',
  },
  'Discount cost|Norway|9 to 31 May 2026': {
    label: 'Discount cost in Norway, 9 to 31 May 2026',
    value: eur(discountAfter),
    change: `${moved(discountAfter, discountBefore)} from the 23 days before (${eur(discountBefore)})`,
    words:
      'Discount cost, added up for Norway from 9 to 31 May 2026, and the 23 days before to compare.',
    against: {
      contextId: 'itm_za26xpzv',
      figureSays: `Discount cost in Norway from 9 to 31 May 2026 was ${eur(discountAfter)}, about the same as before 9 May.`,
    },
  },
}

/** The integration a metric's definition comes from: every metric here is defined in Cube. */
export function sourceOfMetric(name: string): ConnectorId | undefined {
  return metrics.some((m) => m.name === name) ? 'cube' : undefined
}

type Asked = { metric: string; markets: string[]; dates?: string; state: string }

const scopeOf = (a: Asked) =>
  `${a.metric}${a.markets.length ? ` in ${a.markets.join(' and ')}` : ''}${a.dates ? `, ${a.dates}` : ''}`

/** What an answer shows of the data, given which integrations have figures on. No period, no figure. */
export function figureFor(a: Asked, enabled: (id: ConnectorId) => boolean): FigureView | null {
  if (!a.metric || a.state === 'failed' || !a.dates) return null
  const source = sourceOfMetric(a.metric)
  if (!source) {
    if (!enabled('cube')) return null
    return {
      kind: 'none',
      why: `No connected integration defines ${a.metric.toLowerCase()}, so no figure is read for it.`,
      closest: ['Repeat purchase rate', 'Churn rate', 'Support contacts'],
    }
  }
  if (!enabled(source)) return { kind: 'link', source, scope: scopeOf(a) }
  const figure = fixtures[`${a.metric}|${a.markets.join(',')}|${a.dates}`]
  if (!figure)
    return {
      kind: 'none',
      why: `${connectorById(source)!.name} returned no figure for ${scopeOf(a)}.`,
      closest: [],
    }
  const asOf = figureConnections[source]?.asOf ?? 'just now'
  return figure.against
    ? { kind: 'against', source, figure, asOf }
    : { kind: 'line', source, figure, asOf }
}

/**
 * Try a figure in the demo week, as the service reads it: the first of Cube's views by name with a
 * single date is Marketing, its first measure by name is Conversion rate, and the demo warehouse
 * has nothing for it in the last 7 days, which still says the endpoint and its token work. With no
 * token set there is nothing to try.
 */
export function figureTryFor(
  source: ConnectorId,
  connection: FigureConnection | undefined,
): FigureTry {
  if (!connection?.endpoint || !connection.secretSet)
    return { kind: 'failed', source, failure: 'not_set_up' }
  return {
    kind: 'figure',
    source,
    label: 'Conversion rate, 17 to 23 Oct 2026',
    value: null,
    asOf: connection.asOf ?? 'just now',
    took: 412,
  }
}
