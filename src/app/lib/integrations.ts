import { useSettings, useWrite } from '@/api/queries'
import type { ConnectorId } from '@/model/integrations'

// Which tools are connected: Cube, Google Drive and the warehouse in the demo world; Markdown in Git
// once someone goes through the connect flow.

export const useConnected = (): ConnectorId[] => useSettings().connected

export function useConnectActions() {
  const write = useWrite()
  return {
    /** `setup`: connected from the setup checklist, whose last step it is. */
    connect: (id: ConnectorId, setup?: boolean) => write('connectIntegration', { id, setup }),
    disconnect: (id: ConnectorId) => write('disconnectIntegration', { id }),
  }
}
