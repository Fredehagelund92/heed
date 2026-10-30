import { useSettings, useWrite } from '@/api/queries'

// The switch "Let agents follow links" in Settings, Tools and access keys: on in the demo. The
// mock's review flag ?links=on|off sets it from the address, so both states have a link.

/** Whether agents may follow links. */
export const useLinksEnabled = () => useSettings().links

export function useSetLinksEnabled() {
  const write = useWrite()
  return (on: boolean) => void write('setLinks', { on })
}
