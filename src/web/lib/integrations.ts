import { useSettings, useWrite, type WriteInput } from '@/api/queries'

// Which tools are connected, by their connector's id, and the connect flow's writes.

export const useConnected = (): string[] => useSettings().connected

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
