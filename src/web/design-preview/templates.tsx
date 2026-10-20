import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LibraryBigIcon, SearchIcon } from '@/components/icons'
import { Page, PageContent, PageDocument, PageToolbar } from '@/components/page/page'
import { PageRail, RailSection } from '@/components/page/page-rail'
import { RecordPane } from '@/components/page/record-pane'
import {
  WorkbenchListBar,
  WorkbenchListBody,
  WorkbenchListFoot,
  WorkbenchListGroupHeading,
  WorkbenchListPane,
  WorkbenchPanes,
  WorkbenchTemplate,
  workbenchRowClass,
} from '@/components/page/workbench'
import { TabsContent } from '@/components/ui/tabs'
import type { PageTemplateId } from './catalog'

/**
 * One example per page template, built only from the shared page regions and shadcn parts, with
 * skeletons where product content will go. Each template carries `data-template`, which is the
 * screenshot target in tests/e2e/screenshots.spec.ts.
 */

function ListTemplate() {
  return (
    <Page title="List page" data-template="list">
      <PageToolbar>
        <Tabs defaultValue="all">
          <TabsList variant="line">
            <TabsTrigger value="all">All facts</TabsTrigger>
            <TabsTrigger value="review">Needs checking</TabsTrigger>
            <TabsTrigger value="drafts">Drafts</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          <Input aria-label="Filter items" placeholder="Filter" className="w-popover" />
          <Button variant="outline">Group</Button>
        </div>
      </PageToolbar>
      <PageContent className="gap-0 py-0">
        {Array.from({ length: 12 }, (_, row) => (
          <div key={row} className="flex h-control-md items-center gap-4 border-b">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 max-w-popover flex-1" />
            <Skeleton className="hidden h-4 w-16 @md:block" />
            <Badge form="outline" className="ml-auto">
              Event
            </Badge>
          </div>
        ))}
      </PageContent>
    </Page>
  )
}

function DocumentTemplate() {
  return (
    <Page title="Document page" data-template="document">
      <PageToolbar>
        <Button variant="outline">Suggest a change</Button>
        <Badge form="outline">Version 2</Badge>
      </PageToolbar>
      <PageDocument>
        <article data-slot="paper" className="flex w-full max-w-reading min-w-0 flex-col gap-6">
          <Skeleton className="h-8 w-full max-w-popover" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-12" />
          </div>
          <div className="grid gap-4 border-t pt-6 @md:grid-cols-2">
            {Array.from({ length: 4 }, (_, field) => (
              <div key={field} className="flex flex-col gap-2">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-control-md w-full" />
              </div>
            ))}
          </div>
        </article>
        <PageRail aria-label="Checks and details">
          {['Checks', 'Details'].map((title) => (
            <RailSection key={title} title={title}>
              <div className="flex flex-col gap-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-16" />
              </div>
            </RailSection>
          ))}
        </PageRail>
      </PageDocument>
    </Page>
  )
}

function OverviewTemplate() {
  return (
    <Page title="Overview page" data-template="overview">
      <PageContent width="overview">
        <div className="grid gap-4 @sm:grid-cols-2 @3xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, card) => (
            <div key={card} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        {Array.from({ length: 2 }, (_, section) => (
          <section key={section} className="flex flex-col gap-3">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-16 w-full" />
          </section>
        ))}
      </PageContent>
    </Page>
  )
}

function EmptyTemplate() {
  return (
    <Page title="First-run and empty page" data-template="empty">
      <PageContent>
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryBigIcon />
            </EmptyMedia>
            <EmptyTitle>No context yet</EmptyTitle>
            <EmptyDescription>
              Nothing is published before an owner reviews it. Add the first item to get started.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline">
              <SearchIcon />
              Browse examples
            </Button>
          </EmptyContent>
        </Empty>
      </PageContent>
    </Page>
  )
}

const workbenchTabs = [
  { value: 'evidence', label: 'Evidence' },
  { value: 'result', label: 'Test result' },
  { value: 'history', label: 'History' },
] as const

function WorkbenchPreview() {
  return (
    <WorkbenchTemplate title="Workbench page">
      <PageToolbar aria-label="Scope">
        <Button variant="outline" size="toolbar">
          Sales
        </Button>
        <Skeleton className="h-4 w-16" />
        <Skeleton className="ml-auto h-4 w-16" />
      </PageToolbar>
      <WorkbenchPanes>
        <WorkbenchListPane aria-label="Work list">
          <WorkbenchListBar>
            <Skeleton className="h-control-sm w-full" />
            <Skeleton className="h-control-sm w-full" />
          </WorkbenchListBar>
          <WorkbenchListBody>
            <WorkbenchListGroupHeading>
              <span className="font-bold text-foreground">Got worse</span>
              <span>8</span>
            </WorkbenchListGroupHeading>
            {Array.from({ length: 8 }, (_, row) => (
              <div key={row} className={workbenchRowClass}>
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
            ))}
          </WorkbenchListBody>
          <WorkbenchListFoot>8 of 8 shown</WorkbenchListFoot>
        </WorkbenchListPane>
        <RecordPane
          title="Net revenue this month so far"
          meta="Test question · 1 of 9"
          badges={<Badge form="outline">Got worse</Badge>}
          tabs={workbenchTabs}
          tab="evidence"
          tabsLabel="Test question sections"
          onPrevious={() => undefined}
          onNext={() => undefined}
          onClose={() => undefined}
          actions={['Gap', 'Correction', 'Verification'].map((title) => (
            <RailSection key={title} title={title}>
              <Skeleton className="h-16 w-full" />
            </RailSection>
          ))}
        >
          <TabsContent value="evidence" className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-4 w-16" />
          </TabsContent>
        </RecordPane>
      </WorkbenchPanes>
    </WorkbenchTemplate>
  )
}

export function PageTemplatePreview({ template }: { template: PageTemplateId }) {
  switch (template) {
    case 'list':
      return <ListTemplate />
    case 'document':
      return <DocumentTemplate />
    case 'overview':
      return <OverviewTemplate />
    case 'empty':
      return <EmptyTemplate />
    case 'workbench':
      return <WorkbenchPreview />
  }
}
