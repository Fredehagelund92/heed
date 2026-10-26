import { useSettings, useWrite } from '@/api/queries'
import type { ConnectorId } from '@/model/integrations'

// Whether Ask shows figures, per integration: off by default (Ask then links into the source),
// switched on by an admin on the integration's page, with who to ask about its data.

export type FigureSettings = {
  enabled: (id: ConnectorId) => boolean
  contact: (id: ConnectorId) => string
}

/** The figure settings as they stand (the mock applies its ?figures= review flag). */
export function useFigures(): FigureSettings {
  const { figures, contacts } = useSettings()
  return {
    enabled: (id) => figures[id] ?? false,
    contact: (id) => contacts[id] ?? 'the data team',
  }
}

/** Switching figures on or off for an integration, and naming its data contact. */
export function useFigureActions() {
  const write = useWrite()
  return {
    setFigures: (source: ConnectorId, on: boolean) => void write('setFigures', { source, on }),
    setDataContact: (source: ConnectorId, name: string) =>
      void write('setDataContact', { source, name }),
  }
}
