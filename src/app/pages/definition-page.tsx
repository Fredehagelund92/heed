import { BookAIcon, ExternalLinkIcon, NotebookPenIcon, PencilIcon } from '@/components/icons'
import { DefinitionDetails, TypeTile } from '@/components/heed/definition'
import { Canvas, Paper } from '@/components/heed/doc'
import { SiteHeader } from '@/components/site-header'
import { Button } from '@/components/ui/button'
import { findDefinition, kindName, meaningOf, sourceUrl, useDefinitions } from '@/lib/definitions'
import { href, navigate } from '@/lib/router'
import { Loadable, PageSkeleton } from '@/components/heed/load-state'

// A definition's own page, read-only like its peek, on the same paper sheet as a context item's
// page. A synced metric or dimension can't be edited here at all: its page says where to change it.
// Only a term has Edit.

export function DefinitionPage({ name }: { name: string }) {
  useDefinitions()
  const d = findDefinition(name)
  if (!d)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <SiteHeader title="Definitions" icon={<BookAIcon />} />
        <p className="p-6 text-sm text-muted-foreground">
          There is no definition called “{name}”. It may have been renamed; search Definitions for
          it.
        </p>
      </div>
    )
  const subject = meaningOf(d)
  return (
    <div className="flex h-full min-h-0 flex-col">
      <SiteHeader title={d.name} icon={<BookAIcon />}>
        {d.synced ? (
          <>
            {subject.type === 'metric' && (
              <Button
                size="sm"
                nativeButton={false}
                aria-label="Write context"
                render={<a href={href('/context/new', { metric: d.name })} />}
              >
                <NotebookPenIcon data-icon="inline-start" />
                <span className="max-sm:sr-only">Write context</span>
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              aria-label="Open in source"
              render={<a href={sourceUrl(d)} target="_blank" rel="noreferrer" />}
            >
              <ExternalLinkIcon data-icon="inline-start" />
              <span className="max-sm:sr-only">Open in source</span>
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            onClick={() => navigate(`/definitions/${encodeURIComponent(d.name)}/edit`)}
          >
            <PencilIcon data-icon="inline-start" />
            Edit
          </Button>
        )}
      </SiteHeader>
      <Canvas className="min-h-0 flex-1 overflow-y-auto">
        <Paper className="@container">
          <Loadable what="this definition" skeleton={<PageSkeleton />} errorClassName="p-0">
            <div className="mb-6 flex items-center gap-3 sm:mb-8">
              <TypeTile d={d} size="lg" />
              <div className="min-w-0">
                <h2 className="text-2xl leading-tight font-bold tracking-tight sm:text-3xl">
                  {d.name}
                </h2>
                <p className="text-sm text-muted-foreground">{kindName(d)}</p>
              </div>
            </div>
            <DefinitionDetails d={d} />
          </Loadable>
        </Paper>
      </Canvas>
    </div>
  )
}
