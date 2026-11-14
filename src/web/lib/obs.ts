import {
  BellIcon,
  GaugeIcon,
  LayoutGridIcon,
  ListChecksIcon,
  MessageSquareWarningIcon,
} from '@/components/icons'
import * as React from 'react'
import { keepPreviousData, useQuery, useSuspenseQuery } from '@tanstack/react-query'
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
import { chipOf, chipsFrom, readDomain } from '@/lib/obs-chips'
import { readOf } from '@/lib/read'
import { useRoute } from '@/lib/router'
import { useDomains, useMe } from '@/lib/workspace'

// Observability's map: five pages in three small groups, who sees them, and what each is for.
// Overview comes first, and is where Observability opens: the numbers, the chart and the topics in
// one view. Questions was a page of its own; its address now opens Overview at the topics.

export const OBS_SECTIONS = [
  {
    group: 'Agents',
    items: [{ id: 'overview', title: 'Overview', icon: LayoutGridIcon }],
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
    'What agents asked and what they got, by topic: a metric, the values asked about and the month. Counts only: never the words, never who asked.',
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

/** A page's address: Overview is Observability's own. */
export const obsHref = (section: ObsSection) =>
  section === 'overview' ? '/observability' : `/observability/${section}`

/**
 * The page an address shows: Overview when it names none, and for Questions' old address, which
 * opens Overview at the topics so its links (and an Inbox card's) keep working.
 */
export const obsSectionOf = (part: string | undefined): ObsSection =>
  part && part in OBS_PURPOSE ? (part as ObsSection) : 'overview'

/** The view in the address: its range, and a domain or a kind of agent; an owner's own domains. */
export type ObsAddress = View & { owned: DomainId[] | null; label: string }
export type ObsView = ObsAddress & { state: ObsState }

/** What the address asks for: the range and filters, and an owner's own domains. */
export function useObsAddress(): ObsAddress {
  const { query } = useRoute()
  const me = useMe()
  const domains = useDomains()
  const range = (Number(query.get('range')) as Range) || 7
  const owned = me.admin ? null : me.owns.filter((d) => !domains[d]?.sandbox)
  const chips = chipsFrom(query)
  // The service reads one domain, or all of them; a domain chip of several, or one left out,
  // narrows the topics alone. An owner always sees one of their own domains.
  const asked = readDomain(chips)
  const domain = owned ? (asked && owned.includes(asked) ? asked : owned[0]) : asked
  const agent = me.admin ? chipOf(chips, 'agent')?.values[0] : undefined
  return {
    range: RANGES.includes(range) ? range : 7,
    domain,
    agent,
    owned,
    label: range === 7 ? 'this week' : `the last ${range} days`,
  }
}

/**
 * What a page reads for its view: the range, the domain and the kind of agent in the address. The
 * numbers and the chart are the domain's; the topics are every domain the person sees, in the same
 * pass, so Overview's filters can count them.
 */
export const obsPageInput = (section: ObsSection, a: ObsAddress): ObsPageInput => ({
  section,
  range: a.range,
  ...(a.domain ? { domain: a.domain } : {}),
  ...(a.agent ? { agent: a.agent } : {}),
})

/**
 * A page's own read, which its loading state shows. With `keep`, a new view (another range, domain
 * or agent) keeps the last one on screen until it has loaded, so its numbers can count to the new
 * ones and its bars move to their new heights instead of the page going back to a skeleton.
 */
export const useObsPageQuery = (section: ObsSection, keep?: boolean) =>
  useQuery({
    ...observabilityPageQuery(obsPageInput(section, useObsAddress())),
    ...(keep ? { placeholderData: keepPreviousData } : {}),
  })

/**
 * The view a page draws while it keeps the last one (`useObsPageQuery`): what is under it reads
 * that view, which has loaded, instead of the one in the address, which may still be on its way.
 */
export const ObsDrawn = React.createContext<ObsPageInput | null>(null)

/** The page in the address, which its own read loaded before anything under it draws. */
function useObsData(): ObsData {
  const { parts } = useRoute()
  const address = useObsAddress()
  const drawn = React.useContext(ObsDrawn)
  return useSuspenseQuery(
    observabilityPageQuery(drawn ?? obsPageInput(obsSectionOf(parts[1]), address)),
  ).data
}

/** The view of a page that has loaded: what the address asks for, and what its data says it is. */
export function useObsView(): ObsView {
  return { ...useObsAddress(), state: useObsData().state }
}

/** A topic run again (`now`, or before the last publish): loading, failed, missing or ready. */
export const useReplay = (topic: string, when: 'now' | 'before') =>
  readOf(useQuery(replayQuery(topic, when)))

/** Observability's reading of the page's data, for the view in the address. */
export function useObservability(): Observability {
  const data = useObsData()
  return React.useMemo(() => observability(data), [data])
}
