import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { BinItem } from '@/api'
import { peopleQuery } from '@/api/queries'
import { RotateCcwIcon, Trash2Icon } from '@/components/icons'
import { ItemDetails } from '@/components/item/item-details'
import { ItemHeader } from '@/components/item/item-header'
import { ItemTabPanels, itemTabItems, useItemFacts } from '@/components/item/item-parts'
import { Page, PageContent } from '@/components/page/page'
import { Alert, AlertContent, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { formatDay } from '@/lib/library'
import type { ItemTab } from '@/lib/search-params'
import { RestoreFromBinDialog } from './bin-dialogs'

/**
 * An item in the Bin, read before restoring it (an administrator's): its summary, scope, evidence
 * and history as the library showed it, under a banner that says agents do not get it, with
 * Restore as the one action. Nothing on it changes the item: Suggest a change, Retire and the
 * links to other items wait until it is back in the library.
 */
export function BinItemPage({ entry, item }: BinItem) {
  const navigate = useNavigate()
  const facts = useItemFacts(item)
  const { data: people = [] } = useQuery(peopleQuery())
  const [tab, setTab] = useState<ItemTab>('read')
  const [restoreOpen, setRestoreOpen] = useState(false)
  const movedBy = people.find((person) => person.id === entry.binnedBy)?.name ?? 'Someone'

  return (
    <Page title={item.title} heading="paper" data-template="document">
      <PageContent className="grow gap-8 item-wide:flex-row item-wide:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <Alert variant="warning" data-slot="bin-item-banner">
            <Trash2Icon aria-hidden />
            <AlertContent>
              <AlertTitle>In the Bin. Agents don't get it.</AlertTitle>
              <AlertDescription>
                <p>
                  Moved by {movedBy} on {formatDay(entry.binnedAt, 'long')}: {entry.reason}
                </p>
                <p>
                  {entry.deletedDomain
                    ? `Its domain, ${entry.deletedDomain}, is deleted. Restore brings it back archived into a domain you choose, with a proposal there for its owners to review.`
                    : entry.wasLive
                      ? 'Restore brings it back to the library, and agents get it again.'
                      : 'Restore brings it back to the library, archived, as it was.'}
                </p>
              </AlertDescription>
              <Button className="w-fit" onClick={() => setRestoreOpen(true)}>
                <RotateCcwIcon />
                Restore
              </Button>
            </AlertContent>
          </Alert>
          <ItemHeader item={item} area={facts.area} state={facts.state} />
          <article data-slot="paper" className="w-full min-w-0">
            <Tabs value={tab} onValueChange={(value: ItemTab) => setTab(value)}>
              <TabsList
                variant="line"
                aria-label="Fact sections"
                className="w-full justify-start border-b"
              >
                {itemTabItems(facts)
                  .filter((entry) => entry.value !== 'links')
                  .map((entry) => (
                    <TabsTrigger key={entry.value} value={entry.value} className="font-normal">
                      {entry.label}
                      {entry.count}
                    </TabsTrigger>
                  ))}
              </TabsList>
              <ItemTabPanels
                item={item}
                facts={facts}
                detailsInRail
                className="flex flex-col gap-8 pt-6 text-body"
              />
            </Tabs>
          </article>
        </div>
        <aside
          aria-label="Fact details"
          data-slot="item-details"
          className="@container relative flex w-full flex-col gap-6 border-t border-border-subtle pt-6 item-wide:w-item-details item-wide:shrink-0 item-wide:self-stretch item-wide:border-t-0 item-wide:pt-0 item-wide:before:absolute item-wide:before:-inset-y-6 item-wide:before:-left-4 item-wide:before:border-l item-wide:before:border-border-subtle"
        >
          <ItemDetails item={item} facts={facts} />
        </aside>
      </PageContent>
      <RestoreFromBinDialog
        subjects={[
          { id: item.id, kind: item.kind, title: item.title, deletedDomain: entry.deletedDomain },
        ]}
        open={restoreOpen}
        onOpenChange={setRestoreOpen}
        onRestored={() =>
          void navigate({ to: '/library/$itemId', params: { itemId: item.id }, replace: true })
        }
      />
    </Page>
  )
}
