import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { areasQuery, libraryQuery, vocabularyQuery } from '@/api/queries'
import { buildMentionTargets, type MentionOption } from '@/lib/mention-targets'

const empty: MentionOption[] = []

/**
 * Everything a person may mention or put in scope, from the cached vocabulary, library index and
 * areas. The list is the same object until one of them changes, so the search index built on it
 * (mention-targets.ts) is built once.
 */
export function useMentionTargets(): { targets: MentionOption[]; pending: boolean } {
  const vocabulary = useQuery(vocabularyQuery())
  const library = useQuery(libraryQuery())
  const areas = useQuery(areasQuery())
  const targets = useMemo(
    () =>
      vocabulary.data || library.data || areas.data
        ? buildMentionTargets({
            vocabulary: vocabulary.data,
            library: library.data,
            areas: areas.data,
          })
        : empty,
    [vocabulary.data, library.data, areas.data],
  )
  return { targets, pending: vocabulary.isPending || library.isPending || areas.isPending }
}
