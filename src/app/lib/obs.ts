import {
  BellIcon,
  GaugeIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MessageSquareWarningIcon,
  ScanSearchIcon,
} from '@/components/icons'
import * as React from 'react'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import type { ObsPageInput } from '@/api/client'
import { observabilityPageQuery, replayQuery } from '@/api/queries'
import {
  observability,
  RANGES,
  type ObsData,
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

/** The view in the address: its range, and a domain or a kind of agent; an owner's own domains. */
export type ObsAddress = View & { owned: DomainId[] | null; label: string }
export type ObsView = ObsAddress & { state: ObsState }

/** What the address asks for: the range and filters, and an owner's own domains. */
export function useObsAddress(): ObsAddress {
  const { query } = useRoute()
  const me = useMe()
  const range = (Number(query.get('range')) as Range) || 7
  const owned = me.admin ? null : me.owns.filter((d) => d !== 'sandbox')
  const asked = query.get('domain')
  // An owner always sees one of their own domains.
  const domain = owned ? (asked && owned.includes(asked) ? asked : owned[0]) : (asked ?? undefined)
  const agent = me.admin ? (query.get('agent') ?? undefined) : undefined
  return {
    range: RANGES.includes(range) ? range : 7,
    domain,
    agent,
    owned,
    label: range === 7 ? 'this week' : `the last ${range} days`,
  }
}

/**
 * What a page reads for its view. Questions reads every domain the person sees, so its filters can
 * count them; the other pages read the domain in the address.
 */
export const obsPageInput = (section: ObsSection, a: ObsAddress): ObsPageInput => ({
  section,
  range: a.range,
  ...(section !== 'questions' && a.domain ? { domain: a.domain } : {}),
  ...(a.agent ? { agent: a.agent } : {}),
})

/** A page's own read, which its loading state shows. */
export const useObsPageQuery = (section: ObsSection) =>
  useQuery(observabilityPageQuery(obsPageInput(section, useObsAddress())))

/** The page in the address, which its own read loaded before anything under it draws. */
function useObsData(): ObsData {
  const { parts } = useRoute()
  const section = (parts[1] && parts[1] in OBS_PURPOSE ? parts[1] : 'overview') as ObsSection
  return useSuspenseQuery(observabilityPageQuery(obsPageInput(section, useObsAddress()))).data
}

/** The view of a page that has loaded: what the address asks for, and what its data says it is. */
export function useObsView(): ObsView {
  return { ...useObsAddress(), state: useObsData().state }
}

/** A topic run again (`now`, or before the last publish); undefined until it has run. */
export const useReplay = (topic: string, when: 'now' | 'before') =>
  useQuery(replayQuery(topic, when)).data ?? undefined

/** Observability's reading of the page's data, for the view in the address. */
export function useObservability(): Observability {
  const data = useObsData()
  return React.useMemo(() => observability(data), [data])
}
