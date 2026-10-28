import {
  connectors,
  type ConnectorId,
  type IntegrationsView,
  type SourcePage,
} from '@/model/integrations'
import { ApiError } from '../errors'
import { integrationState, sourcePageOf, sources } from './data/integrations'
import type { Address } from './scenario'

/** How long a read the mock runs takes: Read again shows Reading for this long. */
export const MOCK_READ_MS = 1_200

// The mock's integrations: the tools connected (Settings' own list, which the connect flow adds
// to), each as the demo world has it, in the state the address names (?state=) on the
// integrations' pages. Read again reads for a moment and finds nothing new; Pause reading holds
// until the page reloads, as every other switch of the mock.

export function createIntegrations(connected: () => ConnectorId[]) {
  const paused = new Set<string>()
  /** The tools read again this visit, and until when they read. */
  const reading = new Map<string, number>()
  /** The reads Read again ran this visit, newest first, by tool. */
  const reads = new Map<string, SourcePage['activity']>()

  const stateAt = (address: Address) =>
    address.path.startsWith('/settings/integrations')
      ? integrationState(address.query.state ?? null)
      : 'normal'

  /** A tool as it is now: paused, reading, or as the address's state has it. */
  const pageOf = (id: ConnectorId, address: Address): SourcePage | null => {
    const source = sources[id]
    if (!source || !connected().includes(id)) return null
    const page = sourcePageOf(stateAt(address), source)
    const until = reading.get(id)
    if (until !== undefined && until <= Date.now()) reading.delete(id)
    const health = paused.has(id) ? 'paused' : reading.has(id) ? 'reading' : page.source.health
    return {
      ...page,
      source: { ...page.source, health, next: paused.has(id) ? null : page.source.next },
      activity: [...(reads.get(id) ?? []), ...page.activity],
    }
  }

  return {
    page(address: Address): IntegrationsView {
      const nothing = stateAt(address) === 'nothing'
      return {
        sources: nothing
          ? []
          : connectors.flatMap((c) => {
              const page = pageOf(c.id, address)
              return page ? [page.source] : []
            }),
        connectable: connectors.filter((c) => !c.soon).map((c) => c.id),
      }
    },

    sourcePage(id: string, address: Address): SourcePage | null {
      const known = connectors.find((c) => c.id === id)
      return known ? pageOf(known.id, address) : null
    },

    /** Read again: reading for a moment, then a read that found nothing new. */
    readAgain(id: string, now: Date) {
      const source = sources[id as ConnectorId]
      if (!source || !connected().includes(source.connector))
        throw new ApiError('not-found', "We couldn't find this source.")
      if (paused.has(id))
        throw new ApiError('conflict', 'This source is switched off. Switch it on to read it.')
      reading.set(id, Date.now() + MOCK_READ_MS)
      const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
      const detail = source.definitions
        ? `${source.definitions.metrics + source.definitions.dimensions} definitions, no changes`
        : `${source.documents?.held ?? 0} documents, no changes. No new suggestions`
      reads.set(id, [
        { when: `Today, ${time}`, tone: 'ok', what: 'Read complete', detail },
        ...(reads.get(id) ?? []),
      ])
    },

    pause(id: string, on: boolean) {
      if (on) paused.add(id)
      else paused.delete(id)
    },
  }
}
