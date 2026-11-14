import { setQuery, useRoute } from '@/lib/router'

// The dock's content lives in the address (?dock=kind.id), so Back closes it and every state has a link.

export type DockKind =
  'review' | 'context' | 'def' | 'ask' | 'try' | 'topic' | 'share' | 'where' | 'conflict'
export type DockState = { kind: DockKind; id?: string; width: number }

/** Each dock's title, for its frame before its own content draws: while its code loads, or after it fails. */
export const DOCK_TITLE: Record<DockKind, string> = {
  review: 'Review',
  context: 'Context',
  def: 'Definition',
  ask: 'Ask',
  try: 'Try it',
  topic: 'Answer',
  share: 'Share this answer',
  where: 'Where it says that',
  conflict: 'Conflict',
}

export function useDock(): DockState | null {
  const { query } = useRoute()
  const raw = query.get('dock')
  if (!raw) return null
  // The id is everything after the first dot: a conflict's is its pair, `conflict.itm_a.itm_b`.
  const dot = raw.indexOf('.')
  const kind = (dot < 0 ? raw : raw.slice(0, dot)) as DockKind
  const id = dot < 0 ? undefined : raw.slice(dot + 1)
  return {
    kind,
    id,
    width: kind === 'review' || kind === 'conflict' ? 720 : kind === 'topic' ? 560 : 480,
  }
}

export function openDock(kind: DockKind, id?: string, extra?: Record<string, string | undefined>) {
  setQuery({
    dock: id ? `${kind}.${id}` : kind,
    tab: undefined,
    flag: undefined,
    ptab: undefined,
    when: undefined,
    ...extra,
  })
}

export function closeDock() {
  setQuery({ dock: undefined, tab: undefined, flag: undefined, ptab: undefined, when: undefined })
}
