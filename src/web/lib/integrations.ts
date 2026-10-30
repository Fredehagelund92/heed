import { useSettings, useWrite, type WriteInput } from '@/api/queries'
import type { ConnectorId } from '@/model/integrations'

// Which tools are connected: Cube and Google Drive in the demo world; Markdown in Git once someone
// goes through the connect flow.

export const useConnected = (): ConnectorId[] => useSettings().connected

export function useConnectActions() {
  const write = useWrite()
  return {
    /** Connects a tool with what the flow gathered; from the setup checklist, its last step. */
    connect: (input: WriteInput<'connectIntegration'>) => write('connectIntegration', input),
    /** Change settings of a connected tool. */
    change: (input: WriteInput<'changeIntegration'>) => write('changeIntegration', input),
    /** Disconnects a tool, by its page's id. */
    disconnect: (id: string) => write('disconnectIntegration', { id }),
  }
}
