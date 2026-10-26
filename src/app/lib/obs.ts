import {
  BellIcon,
  GaugeIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MessageSquareWarningIcon,
  ScanSearchIcon,
} from '@/components/icons'
import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { replayQuery, useObservabilityData } from '@/api/queries'
import {
  observability,
  RANGES,
  type Observability,
  type ObsState,
  type Range,
  type View,
} from '@/model/observability'
import type { DomainId } from '@/model/items'
import { useRoute } from '@/lib/router'
import { useMe } from '@/lib/workspace'

// Observability's map: six pages in three small groups, who sees them, and what each is for.

export const OBS_SECTIONS = [
  {
    group: 'Agents',
    items: [
      { id: 'overview', title: 'Overview', icon: LayoutGridIcon },
      { id: 'questions', title: 'Questions', icon: ScanSearchIcon },
    ],
  },
  {
    group: 'Answers',
    items: [
      { id: 'quality', title: 'Quality', icon: ListChecksIcon },
      { id: 'feedback', title: 'Feedback', icon: MessageSquareWarningIcon },
    ],
  },
  {
    group: 'System',
    items: [
      { id: 'usage', title: 'Usage', icon: GaugeIcon },
      { id: 'alerts', title: 'Alerts', icon: BellIcon },
    ],
  },
] as const

export type ObsSection = (typeof OBS_SECTIONS)[number]['items'][number]['id']

/** Who sees the row and the pages: admins, and owners for their own domains, as in Settings. */
export const seesObservability = (me: { admin: boolean; owns: string[] }) =>
  me.admin || me.owns.length > 0

/** What each page is for, in a line under its title. */
export const OBS_PURPOSE: Record<ObsSection, string> = {
  overview:
    'What agents asked and what they got. Counts only: the words of a question are never kept.',
  questions:
    'What agents asked about, grouped by the same thing: a metric, a market and dates. Never the words, never who asked.',
  quality:
    'Saved questions are checked against every change. Free, no model key needed. It checks what agents get, not how an agent words it.',
  feedback:
    'What people and agents said about answers. Open reports wait in the Inbox, which is the queue: nothing is scored here.',
  usage:
    'How agents use the tools, how fast they get answers, and what the model costs. Agents are counted by kind, never by person.',
  alerts:
    'What raises a card in the Inbox. An alert is never an email or a bell: it is a card, with the same Review and Undo as any other.',
}

export const OBS_TITLES = Object.fromEntries(
  OBS_SECTIONS.flatMap((g) => g.items.map((i) => [i.id, i.title])),
) as Record<ObsSection, string>

export type ObsView = View & { state: ObsState; owned: DomainId[] | null; label: string }

/** What the page shows: the range and filters from the address, an owner's own domains, and the review flag. */
export function useObsView(): ObsView {
  const { query } = useRoute()
  const me = useMe()
  const range = (Number(query.get('range')) as Range) || 7
  const owned = me.admin ? null : me.owns.filter((d) => d !== 'sandbox')
  const asked = query.get('domain')
  // An owner always sees one of their own domains.
  const domain = owned ? (asked && owned.includes(asked) ? asked : owned[0]) : (asked ?? undefined)
  const agent = me.admin ? (query.get('agent') ?? undefined) : undefined
  // The review flag (?state=empty, quiet or busy) is the mock's: its data says which it is.
  const state: ObsState = useObservabilityData().state
  const label = range === 7 ? 'this week' : `the last ${range} days`
  return {
    range: RANGES.includes(range) ? range : 7,
    domain,
    agent,
    scale: state === 'busy' ? 3.4 : undefined,
    state,
    owned,
    label,
  }
}

/** A topic run again (`now`, or before the last publish); undefined until it has run. */
export const useReplay = (topic: string, when: 'now' | 'before') =>
  useQuery(replayQuery(topic, when)).data ?? undefined

/** Observability's counts over its data as it stands (the shared read), for any view. */
export function useObservability(): Observability {
  const data = useObservabilityData()
  return React.useMemo(() => observability(data), [data])
}
