import { useCallback, useMemo } from 'react'
import { usePreference } from '@/lib/preferences'
import { isViewedList, toggledViewed, VIEWED_STORAGE_KEY } from '@/lib/edition-compare'

/**
 * Which changed items this person has marked as viewed, kept in this browser (Editions design:
 * "Viewed state in the browser first"). A mark belongs to the item and the two versions compared,
 * so it is shared by every comparison that shows the same change and gone when the item changes
 * again.
 */
export function useEditionViewed() {
  const [keys, setKeys] = usePreference<string[]>(VIEWED_STORAGE_KEY, [], isViewedList)
  const viewed = useMemo(() => new Set(keys), [keys])
  const toggle = useCallback((key: string) => setKeys(toggledViewed(keys, key)), [keys, setKeys])
  return { viewed, toggle }
}
