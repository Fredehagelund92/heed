import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { catalogueQuery, libraryFreshnessQuery, weeklyCallsQuery } from '@/api/queries'
import { useShellActions } from '@/components/app-shell/shell-actions'
import { HelpLink } from '@/components/help/help-link'
import { XIcon } from '@/components/icons'
import { Page, PageContent } from '@/components/page/page'
import { Button } from '@/components/ui/button'
import { homeTopics, knownIssues, recentFacts, type HomeTabId, type HomeTopic } from '@/lib/home'
import {
  agentPulse,
  factPulse,
  lastWeekOf,
  PULSE_WEEKS_READ,
  type AgentPulse,
  type FactPulse,
} from '@/lib/home-pulse'
import { setPreference, usePreference } from '@/lib/preferences'
import type { HomeSearch } from '@/lib/search-params'
import { useLibrary } from '@/lib/use-library'
import { HomePulse } from './home-pulse'
import { HomeSearch as HomeSearchField } from './home-search'
import { HomeTable, type Loadable } from './home-table'
import { QuickActions } from './quick-actions'
import { YourDrafts } from './your-drafts'
import { productName } from '@/lib/brand'

/** Set once a person has seen Home, so the first-visit sentence shows on the first visit only. */
export const HOME_SEEN_KEY = 'cl.home.seen'
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/**
 * Whether this is the person's first visit to Home in this browser. The answer is read once when
 * Home opens and holds for the whole visit; the visit itself is then remembered, so the next one
 * is a returning visit.
 */
function useFirstVisit(): boolean {
  const [seen] = usePreference(HOME_SEEN_KEY, false, isBoolean)
  const [first] = useState(!seen)
  useEffect(() => {
    if (first) setPreference(HOME_SEEN_KEY, true)
  }, [first])
  return first
}

/** Set once a person hides the "New to Heed?" line, which shows on every visit until then. */
export const HOME_NEW_TO_HEED_KEY = 'cl.home.new-to-heed.hidden'

/**
 * "New to Heed?" (docs, help in context): one quiet line that opens What is Heed, for the first
 * visits. A person who knows Heed hides it, and it stays hidden in this browser.
 */
function NewToHeed() {
  const [hidden, setHidden] = usePreference(HOME_NEW_TO_HEED_KEY, false, isBoolean)
  if (hidden) return null
  return (
    <p
      data-slot="home-new-to-heed"
      className="flex items-center gap-1 text-dense text-muted-foreground"
    >
      <span>
        New to {productName}? <HelpLink to="what-is-heed">What is {productName}</HelpLink>
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Hide New to ${productName}`}
        onClick={() => setHidden(true)}
      >
        <XIcon />
      </Button>
    </p>
  )
}

/**
 * Home (Home P, the captain's "Take recommended and go"): one page, the same for every person
 * and every role. A title, one plain search field over the library's client index, the pulse
 * strip (last week in Heed, the Home lab's direction A), three quick actions and one tabbed
 * table. On the first visit one sentence under the title says what Home is for, and until the
 * person hides it, one line opens What is Heed. Nothing on it depends on roles, editions or
 * areas. The one part that is the person's own is Your drafts, under the search field, and only
 * while they have a draft they have not submitted.
 */
export function HomePage({ search }: { search: HomeSearch }) {
  const navigate = useNavigate()
  const { askAssistant } = useShellActions()
  const library = useLibrary()
  const catalogue = useQuery(catalogueQuery())
  const weekly = useQuery(weeklyCallsQuery({ weeks: PULSE_WEEKS_READ }))
  // Today and seven days before: the share current a week ago, for its tile's change mark.
  const freshness = useQuery(libraryFreshnessQuery({ weeks: 2 }))
  const firstVisit = useFirstVisit()
  const tab: HomeTabId = search.tab ?? 'recent'

  const { rows, today } = library
  // Each tab reads the one cached library index; Topics adds the catalogue's metric groups.
  const fromLibrary = <T,>(build: (today: string) => T): Loadable<T> => {
    if (library.failed) return { state: 'failed', retry: library.refetch }
    if (library.pending || today === null) return { state: 'pending' }
    return { state: 'ready', data: build(today) }
  }
  const recent = fromLibrary((day) => ({
    rows: recentFacts(rows, day),
    libraryEmpty: rows.length === 0,
  }))
  const issues = fromLibrary(() => knownIssues(rows))
  const facts = useMemo<Loadable<FactPulse>>(() => {
    if (library.failed) return { state: 'failed', retry: library.refetch }
    if (library.pending || today === null) return { state: 'pending' }
    return { state: 'ready', data: factPulse(rows, today) }
  }, [library.failed, library.pending, library.refetch, rows, today])
  const agent = useMemo<Loadable<AgentPulse>>(() => {
    if (weekly.data !== undefined) return { state: 'ready', data: agentPulse(weekly.data) }
    if (weekly.isError) return { state: 'failed', retry: () => void weekly.refetch() }
    return { state: 'pending' }
  }, [weekly])
  const topics = useMemo<Loadable<HomeTopic[]>>(() => {
    if (catalogue.isError && catalogue.data === undefined)
      return { state: 'failed', retry: () => void catalogue.refetch() }
    if (catalogue.data === undefined || library.pending || today === null)
      return { state: 'pending' }
    return { state: 'ready', data: homeTopics(catalogue.data.terms, rows, today) }
  }, [catalogue, rows, today, library.pending])

  return (
    <Page title="Home" heading="paper" data-template="home">
      <PageContent width="overview" className="gap-8 pt-8 pb-0">
        <header className="flex flex-col gap-1">
          <h1 className="text-title font-bold">Home</h1>
          {firstVisit ? (
            <p data-slot="home-welcome" className="text-body text-muted-foreground">
              Find what your colleagues already know about the numbers.
            </p>
          ) : null}
          <NewToHeed />
        </header>
        <HomeSearchField rows={rows} viewer={library.viewer} onAsk={askAssistant} />
        <YourDrafts />
        <HomePulse
          agent={agent}
          facts={facts}
          freshness={freshness.data ?? null}
          lastWeek={today === null ? null : lastWeekOf(today)}
        />
        <QuickActions />
        <HomeTable
          tab={tab}
          onTab={(next) =>
            void navigate({
              to: '/',
              search: { tab: next === 'recent' ? undefined : next },
              replace: true,
              resetScroll: false,
            })
          }
          recent={recent}
          issues={issues}
          topics={topics}
          today={today}
        />
      </PageContent>
    </Page>
  )
}
