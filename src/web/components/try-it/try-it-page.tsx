import { useEffect, useMemo } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { DockButton } from '@/components/app-shell/dock-button'
import { Page, PageContent } from '@/components/page/page'
import { sharedScope } from '@/lib/assistant-chat'
import type { TryItSearch } from '@/lib/search-params'
import { panelSearchOf, panelTabOf, scopeFromSearch, searchOf } from '@/lib/try-it'
import { TryItView } from './try-it-view'

/**
 * Try it as a page (Assistant board, "open as a page"): What an agent would get with room for
 * the reply. The scope last asked is in the address, so a link opens the same reply; Back goes to
 * the scope asked before. It is the assistant expanded on that tab (contract 9.8): Dock docks it
 * beside the page the person came from, with the scope asked here. Connecting an AI client is a
 * setting of the person's own (Settings, Connect your AI). A fact opens beside the reply in the
 * docked panel, as the library opens one, and is in the address (`?panel=`).
 */
export function TryItPage({ search }: { search: TryItSearch }) {
  const navigate = useNavigate()
  // The same scope while only the panel changes, so the bar keeps what the person is typing.
  const asked = useMemo(
    () => scopeFromSearch({ about: search.about, from: search.from, to: search.to }),
    [search.about, search.from, search.to],
  )
  const panelId = search.panel ?? null
  const panelTab = panelTabOf(search)
  // The panel shares the scope asked here, so docking keeps it.
  useEffect(() => {
    if (asked) sharedScope.set(asked)
    // The address is the scope: once per change of it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.about, search.from, search.to])
  return (
    <Page title="Try a question">
      <DockButton />
      <PageContent width="reading" className="pt-6 pb-16">
        <TryItView
          asked={asked}
          // A new scope keeps the fact open: the person is still reading it.
          onAsk={(scope) =>
            void navigate({
              to: '/try-it',
              search: {
                ...searchOf(scope),
                panel: search.panel,
                tab: search.panel ? search.tab : undefined,
              },
              resetScroll: false,
            })
          }
          panel={{
            openId: panelId,
            tab: panelTab,
            to: (id, tab) => panelSearchOf(asked, id, tab),
          }}
        />
      </PageContent>
    </Page>
  )
}
