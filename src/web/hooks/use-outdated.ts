import { useSyncExternalStore } from 'react'
import { outdatedSide, subscribeOutdated, type Outdated } from '@/api/api-version'

/** Which side is older when the app and the service come from different code, else null. */
export function useOutdated(): Outdated | null {
  return useSyncExternalStore(subscribeOutdated, outdatedSide, () => null)
}
