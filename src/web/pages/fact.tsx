import * as React from 'react'
import { cn } from '@/lib/utils'
import { DisagreesSection } from '@/components/heed/disagrees'
import { mentionId } from '@/lib/mentions'
import { CircleCheckIcon, ClockIcon, EllipsisIcon, MessageSquareIcon } from '@/components/icons'
import { toast } from 'sonner'
import { Canvas, Paper, SideSection } from '@/components/heed/doc'
import { ItemDocument } from '@/components/heed/item-document'
import { ResizableAside } from '@/components/resizable-aside'
import { Panel, PanelRail } from '@/components/heed/panel'
import { useSideChoice } from '@/lib/side-panel'
import { Page } from '@/components/site-header'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Related } from '@/components/heed/related'
import { useRelated } from '@/hooks/use-related'
import { openDock } from '@/lib/dock'
import { href, navigate } from '@/lib/router'
import { useQuery } from '@tanstack/react-query'
import { itemPageQuery, useInbox, useLibrary, useWrite } from '@/api/queries'
import { useCommentActions } from '@/lib/comments'
import { useDomains, useFacts, useMe } from '@/lib/workspace'
import type { LogEntry } from '@/model/items'
import { useWide } from '@/hooks/use-wide'
import { VersionHistory } from '@/components/heed/version-history'
import { today } from '@/lib/today'
import { DeleteDialog } from '@/components/heed/delete-dialog'
import { Loadable, NoSuchItem, PageSkeleton, SideSkeleton } from '@/components/heed/load-state'

// The comments load on their own: their composer is Tiptap, which stays out of the first load.
const CommentBox = React.lazy(() =>
  import('@/components/templates/comment-box').then((m) => ({ default: m.CommentBox })),
)

export function FactPage({ id }: { id: string }) {
  const facts = useFacts()
  const page = useQuery(itemPageQuery(id))
  // The page's own read shows the item; the library knows it exists while that read loads.
  const fact = page.data?.item ?? facts.find((f) => f.id === id)
  const history = page.data?.history ?? []
  const { published: publishedNow } = useLibrary()
  const { sent } = useInbox()
  const domains = useDomains()
  const me = useMe()
  const write = useWrite()
  const commentActions = useCommentActions()
  const [deleting, setDeleting] = React.useState(false)
  const [bodyRef, wide] = useWide<HTMLDivElement>()
  // The panel folds to a rail and stays the way the person left it this session.
  const [panelChoice, setPanelOpen] = useSideChoice('page-side')
  const panelOpen = panelChoice ?? true
  const related = useRelated(mentionId('context', id))
  // Opening the item is reading the comments that mention you here.
  React.useEffect(() => {
    void commentActions.seenMention(`context:${id}`)
    // Once per item opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me.name])
  // Opened here counts as read: only items someone opened can be marked checked together.
  const found = !!fact
  React.useEffect(() => {
    if (found) void write('markViewed', { id })
    // Once per item opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [found, id])
  if (!fact)
    return (
      <Page title="Context">
        <NoSuchItem />
      </Page>
    )
  const owner = me.owns.includes(fact.domain) || me.admin
  const entryFor = (what: LogEntry['what'], summary: string): LogEntry => ({
    id: `log-${what}-${fact.id}`,
    on: today(),
    who: me.name,
    what,
    summary,
    items: [{ id: fact.id, title: fact.title, domain: fact.domain }],
  })
  const archive = async () => {
    const entry = entryFor('archived', 'Archived: agents stop getting it.')
    const { undo } = await write('applyBulk', {
      action: 'archive',
      patches: { [fact.id]: { status: 'Archived' } },
      remove: [],
      entry,
    })
    toast('Archived', {
      description: 'Agents stop getting it from the next question.',
      action: { label: 'Undo', onClick: () => void write('undo', { token: undo }) },
    })
  }
  // A draft nobody published is deleted for good, after a confirmation, with Undo for a few seconds.
  const deleteDraft = async () => {
    const entry = entryFor('deleted', 'Deleted: a draft nobody published.')
    const { undo } = await write('applyBulk', {
      action: 'delete',
      patches: {},
      remove: [fact.id],
      entry,
    })
    navigate('/context')
    toast('Deleted 1 draft', {
      description: 'You can undo it for 10 seconds; then it is gone for good.',
      duration: 10_000,
      action: { label: 'Undo', onClick: () => void write('undo', { token: undo }) },
    })
  }
  const pending = sent.find((x) => x.factId === fact.id && x.by === me.name)
  const published = publishedNow[fact.id]
  // The item it is in a conflict with, whichever of the two holds the flag.
  const other = facts.find(
    (f) =>
      f.id !== fact.id &&
      (f.id === fact.disagreesWith || f.disagreesWith === fact.id) &&
      (f.status === 'Live' || f.status === 'Needs checking'),
  )

  // What needs a decision: in the side when there is room, and in the document itself on a phone,
  // above the comments rather than below them.
  const attention = (fact.outOfDate || other) && (
    <>
      {fact.outOfDate && (
        <SideSection title="Outdated" description={fact.outOfDate}>
          {owner && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void write('editItem', {
                  id: fact.id,
                  patch: {
                    status: 'Live',
                    outOfDate: undefined,
                    checkedBy: me.name,
                    checkedOn: '22 Oct 2026',
                  },
                }).then(() => toast('Checked: still true'))
              }
            >
              Still true
            </Button>
          )}
        </SideSection>
      )}
      {other && <DisagreesSection self={fact} other={other} pair={page.data?.conflict} />}
    </>
  )
  const side = (
    <Loadable what="this context item" skeleton={<SideSkeleton />} quiet query={page}>
      {wide && attention}
      {/* What an agent can follow from here, both ways: the links in the text and the owners' relations. */}
      {related.links.length > 0 && (
        <SideSection title="Related" className={cn(!history.length && 'border-b-0')}>
          <Related id={mentionId('context', fact.id)} />
        </SideSection>
      )}
      {history.length > 0 && (
        <SideSection title="History" className="border-b-0">
          <VersionHistory
            versions={history}
            canRestore={owner}
            onRestore={(version) => write('restoreAsDraft', { id: fact.id, v: version.v })}
            onUndo={(token) => write('undo', { token })}
          />
        </SideSection>
      )}
    </Loadable>
  )
  // A draft nobody linked to has nothing beside it: no panel, once the read says so.
  const sideEmpty = !!page.data && !related.links.length && !history.length

  return (
    <Page
      bodyRef={bodyRef}
      className="flex overflow-hidden"
      title={
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/context">Context</BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage className="truncate">{fact.title}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      }
      actions={
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ask about this context item"
            onClick={() => openDock('ask')}
          >
            <MessageSquareIcon />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="icon-sm" aria-label="More" />}
            >
              <EllipsisIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuGroup>
                {owner && fact.status === 'Needs checking' && (
                  <DropdownMenuItem
                    onClick={() =>
                      void write('editItem', {
                        id: fact.id,
                        patch: {
                          status: 'Live',
                          outOfDate: undefined,
                          checkedBy: me.name,
                          checkedOn: '22 Oct 2026',
                        },
                      }).then(() => toast('Checked: still true'))
                    }
                  >
                    Still true
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={() => navigate('/context/' + fact.id + (owner ? '/edit' : '/suggest'))}
                >
                  {owner ? 'Edit' : 'Suggest a change'}
                </DropdownMenuItem>
                {owner && fact.status !== 'Archived' && fact.status !== 'Draft' && (
                  <DropdownMenuItem onClick={() => void archive()}>Archive</DropdownMenuItem>
                )}
              </DropdownMenuGroup>
              {owner && fact.status !== 'Archived' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setDeleting(true)}>Delete</DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {owner ? (
            <Button
              size="sm"
              nativeButton={false}
              render={<a href={href(`/context/${fact.id}/edit`)} />}
            >
              Edit
            </Button>
          ) : (
            !pending && (
              <Button
                size="sm"
                nativeButton={false}
                render={<a href={href(`/context/${fact.id}/suggest`)} />}
              >
                Suggest a change
              </Button>
            )
          )}
        </>
      }
    >
      <Canvas className="min-h-0 min-w-0 flex-1 overflow-y-auto sm:pt-3 sm:pb-2">
        <Paper>
          <Loadable
            what="this context item"
            skeleton={<PageSkeleton />}
            errorClassName="p-0"
            refreshClassName="mb-5 rounded-frame border"
            query={page}
          >
            {/* What happened to it, said on the item itself rather than in a toast that leaves. */}
            {pending && (
              <div
                role="status"
                className="mb-5 flex animate-in flex-wrap items-center gap-x-3 gap-y-2 rounded-frame border border-dashed px-3 py-2 text-sm duration-(--dur-2) fade-in-0"
              >
                <ClockIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  Your suggestion is waiting for {pending.to}, owner of{' '}
                  {domains[pending.domain]?.name}. Sent {pending.at}.
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7"
                  onClick={() =>
                    void write('withdrawSuggestion', { id: pending.id }).then(() =>
                      toast('Withdrawn', { description: 'The owner no longer sees it.' }),
                    )
                  }
                >
                  Withdraw
                </Button>
              </div>
            )}
            {published && !pending && (
              <p
                role="status"
                className="mb-5 flex animate-in items-center gap-2 text-sm text-muted-foreground duration-(--dur-2) fade-in-0"
              >
                <CircleCheckIcon className="size-4 shrink-0 text-primary" aria-hidden />
                Published {published} by you. Agents get it from the next question.
              </p>
            )}
            {/* The document is the page: the item as people read it, the same view a review previews. */}
            <ItemDocument fact={fact} />
            {!wide && attention && (
              <div className="mt-6 overflow-hidden rounded-frame border border-caution/45 bg-caution/8 dark:border-caution/45 dark:bg-caution/8 [&>section]:border-b-0 [&>section+section]:border-t">
                {attention}
              </div>
            )}
            <React.Suspense fallback={null}>
              <CommentBox
                key={fact.id}
                subject={`context:${fact.id}`}
                me={me.name}
                owners={domains[fact.domain]?.owners ?? []}
                className="mt-8 border-t pt-6 sm:mt-10"
              />
            </React.Suspense>
          </Loadable>
        </Paper>
        {!wide && !sideEmpty && <div className="border-t bg-background">{side}</div>}
      </Canvas>
      {wide && !(sideEmpty && !attention) && (
        <ResizableAside
          side="right"
          storageKey="doc-side"
          defaultWidth={320}
          min={280}
          max={520}
          label="About this context item"
          collapsed={!panelOpen}
          onCollapsedChange={(c) => setPanelOpen(!c)}
          rail={<PanelRail label="Show the panel" onShow={() => setPanelOpen(true)} />}
          railWidth={48}
          className="border-l bg-background"
        >
          <Panel
            title="About this item"
            onClose={() => setPanelOpen(false)}
            closeLabel="Fold the panel"
          >
            {side}
          </Panel>
        </ResizableAside>
      )}
      <DeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        noun="draft"
        titles={fact.status === 'Draft' ? [fact.title] : []}
        consequence="Nobody published it, so agents never got it. It is removed for good; you can undo it for a few seconds."
        archive={
          fact.status === 'Draft' ? undefined : { count: 1, onArchive: () => void archive() }
        }
        onDelete={() => void deleteDraft()}
      />
    </Page>
  )
}
