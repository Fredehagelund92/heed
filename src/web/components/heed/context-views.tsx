import { useQuery } from '@tanstack/react-query'
import { TextSwitch } from '@/components/heed/switches'
import { conflictsQuery } from '@/api/queries'
import { navigate } from '@/lib/router'

// The Context list's two views, Items and Conflicts (FR-220), with how many conflicts there are.
// A file of its own, so the list does not pull the conflict view in with it.

/** Items or Conflicts: the Context list's two views, with how many conflicts there are. */
export function ContextViews({ value }: { value: 'items' | 'conflicts' }) {
  const all = useQuery(conflictsQuery('all'))
  return (
    <TextSwitch
      label="Show"
      value={value}
      onChange={(v) => navigate(v === 'items' ? '/context' : '/context/conflicts')}
      options={[
        { value: 'items', label: 'Items' },
        { value: 'conflicts', label: 'Conflicts', count: all.data?.length },
      ]}
    />
  )
}
