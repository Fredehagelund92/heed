import * as React from 'react'
import { cn } from '@/lib/utils'
import { PlusIcon } from '@/components/icons'
import { toast } from 'sonner'
import { PersonAvatar } from '@/components/heed/bits'
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { GuideLink } from '@/components/heed/guide-link'
import { servedToAgents } from '@/model/items'
import { useQuery } from '@tanstack/react-query'
import type { Advanced as AdvancedPage, Exported } from '@/api/client'
import { toApiError } from '@/api/errors'
import { advancedPageQuery, useWrite } from '@/api/queries'
import { Loadable, RowsSkeleton } from '@/components/heed/load-state'
import { useFacts, useMe } from '@/lib/workspace'
import { useDomainList, useDomains } from '@/lib/workspace'
import { useDefinitions } from '@/lib/definitions'
import { DomainDot } from '@/components/heed/tag-chip'
import { IntegrationsRoute } from '@/pages/integrations'
import {
  Frame,
  FramePage,
  FrameRows,
  FrameScroll,
  FrameSection,
  FrameTable,
  type FrameColumn,
} from '@/components/heed/frame'
import { SLUG } from '@/lib/brand'
import { People } from '@/pages/people'
import { Agents } from '@/pages/settings-agents'

// Settings, for admins: five sections under the settings navigation (General, Domains and owners,
// Agents and access, Integrations, Advanced). No tabs anywhere.

/* ---------- Domains and owners ---------- */

/**
 * The domains as a grid of square hairline cells: each the domain's dot and name, two lines of what it
 * covers, its owners' faces and a quiet health line ("12 items - 2 due") with a freshness dot. One cell
 * adds a domain. Arrow keys move between cells; search shows once there are more than eight.
 */
function Domains() {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const facts = useFacts()
  const defs = useDefinitions()
  const [q, setQ] = React.useState('')
  const grid = React.useRef<HTMLDivElement>(null)
  // Sorted by name; the sandbox, which never reaches agents, comes last.
  const ids = [...domainIds]
    .sort((a, b) =>
      domains[a]?.sandbox
        ? 1
        : domains[b]?.sandbox
          ? -1
          : domains[a]!.name.localeCompare(domains[b]!.name),
    )
    .filter((id) =>
      `${domains[id]?.name} ${domains[id]?.covers}`.toLowerCase().includes(q.trim().toLowerCase()),
    )
  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 0, ArrowUp: 0 } as Record<
      string,
      number
    >
    if (!(e.key in keys) || !grid.current) return
    const cells = [...grid.current.querySelectorAll<HTMLElement>('[data-cell]')]
    const i = cells.indexOf(document.activeElement as HTMLElement)
    if (i < 0) return
    const cols = getComputedStyle(grid.current).gridTemplateColumns.split(' ').length
    const step = e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : keys[e.key]
    const next = cells[i + (step ?? 0)]
    if (!next) return
    e.preventDefault()
    next.focus()
  }
  return (
    <Frame>
      <FrameSection
        title="Domains and owners"
        description="A domain is a part of the business with its own owners. Owners publish its context and check it when it is due."
        action={
          domainIds.length > 8 && (
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search domains"
              aria-label="Search domains"
              className="h-8 w-56 max-w-full"
            />
          )
        }
      >
        <div
          ref={grid}
          onKeyDown={onKeyDown}
          role="list"
          aria-label="Domains"
          className="grid grid-cols-1 gap-px border-t bg-border @2xl/main:grid-cols-2 @5xl/main:grid-cols-3"
        >
          {ids.map((id) => {
            const items = facts.filter((f) => f.domain === id && servedToAgents(f))
            const due = items.filter((f) => f.status === 'Needs checking').length
            const terms = defs.filter((d) => d.domain === id).length
            return (
              <a
                key={id}
                role="listitem"
                data-cell
                href={`/settings/domains/${id}`}
                className="group/cell flex min-h-36 flex-col gap-2 bg-background p-4 outline-none hover:bg-muted/40 focus-visible:z-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:p-5 @2xl/main:min-h-44"
              >
                <span className="flex items-center gap-2">
                  <DomainDot id={id} />
                  <span className="truncate font-medium">{domains[id]?.name}</span>
                  {domains[id]?.sandbox && (
                    <span className="text-xs text-muted-foreground">Never reaches agents</span>
                  )}
                </span>
                <span className="line-clamp-2 text-sm text-muted-foreground">
                  {domains[id]?.covers || 'Nothing written yet.'}
                </span>
                <span className="mt-auto flex items-end justify-between gap-3 pt-2">
                  <span
                    className="flex -space-x-1.5 *:ring-2 *:ring-background"
                    aria-label={`Owners: ${domains[id]?.owners.join(', ')}`}
                  >
                    {domains[id]?.owners.slice(0, 4).map((o) => (
                      <PersonAvatar key={o} name={o} />
                    ))}
                    {domains[id]!.owners.length > 4 && (
                      <span className="grid size-7 place-items-center rounded-full bg-muted text-2xs font-medium">
                        +{domains[id]!.owners.length - 4}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                    <span
                      aria-hidden
                      className={cn(
                        'size-1.5 rounded-full',
                        !items.length
                          ? 'border border-muted-foreground'
                          : due
                            ? 'bg-due'
                            : 'bg-ready',
                      )}
                    />
                    {items.length} {items.length === 1 ? 'item' : 'items'}
                    {due > 0 && ` - ${due} due`}
                    {terms > 0 && ` - ${terms} ${terms === 1 ? 'term' : 'terms'}`}
                  </span>
                </span>
              </a>
            )
          })}
          <a
            role="listitem"
            data-cell
            href="/settings/domains/new"
            className="flex min-h-24 flex-col items-center justify-center gap-2 bg-background p-4 text-sm text-muted-foreground outline-none hover:bg-muted/40 hover:text-foreground focus-visible:z-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset @2xl/main:min-h-44"
          >
            <PlusIcon aria-hidden className="size-5" />
            Add a domain
          </a>
        </div>
        {q && !ids.length && (
          <p className="border-t p-4 text-sm text-muted-foreground">
            No domain matches “{q.trim()}”.
          </p>
        )}
      </FrameSection>
    </Frame>
  )
}

/* ---------- About our business ---------- */

// The editor loads on its own (Tiptap stays out of the first load); until it does, the page's skeleton.
// A domain is a document too, so its page loads with the editor.
const DomainPage = React.lazy(() =>
  import('@/pages/domain-page').then((m) => ({ default: m.DomainPage })),
)
const AboutPage = React.lazy(() =>
  import('@/pages/about-editor').then((m) => ({ default: m.AboutPage })),
)

/** General's side help, in the aside (or under the frame on narrower screens). */
function AboutHelp() {
  return (
    <>
      <ul>
        <li>What the business is, in one or two sentences.</li>
        <li>Words that are easy to misread here, each with what it means for you.</li>
        <li>House rules for reading numbers, such as which calendar or currency to assume.</li>
        <li>No figures, deals or names of customers: agents read this with every question.</li>
      </ul>
      <GuideLink slug="write-context" className="mt-4" />
    </>
  )
}

/* ---------- Advanced ---------- */

const link = 'underline underline-offset-4'
const cols = (...labels: string[]): FrameColumn[] =>
  labels.map((label, i) => ({
    label,
    className: i === 0 ? 'w-56' : i === 1 ? 'whitespace-nowrap' : undefined,
    cell: i === 0 ? 'font-medium' : 'text-muted-foreground',
  }))

/** A file the binding made, saved the way a download is. */
function save(file: Exported) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: file.name })
  document.body.append(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** A link inside a table cell, or the words alone when there is nowhere to go. */
const cellLink = (text: string, href?: string) =>
  href ? (
    <a key={href} href={href} className={link}>
      {text}
    </a>
  ) : (
    text
  )

function Advanced() {
  const load = useQuery(advancedPageQuery())
  return (
    <Frame>
      <FrameSection
        title="Advanced"
        description="For the day someone needs them. Nothing here is needed day to day."
      />
      <Loadable what="Advanced" skeleton={<RowsSkeleton rows={8} />} query={load}>
        {load.data && <AdvancedSections page={load.data} />}
      </Loadable>
    </Frame>
  )
}

/** Every tuning setting in one table, a header row for each group, so the columns line up. */
function SettingsTable({ groups }: { groups: AdvancedPage['settings'] }) {
  const cell = 'px-4 py-2 align-middle first:md:pl-5 last:md:pr-5'
  const columns = ['Setting', 'Value', 'Default or changed', 'Set by', 'What it does']
  return (
    <FrameScroll>
      <table className="w-full text-sm" aria-label="Tuning settings">
        <thead>
          <tr className="bg-band text-xs text-muted-foreground">
            {columns.map((c) => (
              <th
                key={c}
                className="h-9 px-4 text-left font-medium whitespace-nowrap first:md:pl-5 last:md:pr-5"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.group}>
            <tr className="border-t bg-band-soft">
              <th
                scope="rowgroup"
                colSpan={columns.length}
                className="h-9 px-4 text-left text-xs font-medium md:px-5"
              >
                {g.group}
              </th>
            </tr>
            {g.rows.map((r) => (
              <tr key={r.key} className="border-t">
                <th
                  scope="row"
                  className={cn(cell, 'w-56 text-left font-mono text-xs font-normal')}
                >
                  {r.key}
                </th>
                <td className={cn(cell, 'min-w-40 break-words')}>{r.value}</td>
                <td className={cn(cell, 'whitespace-nowrap')}>
                  {r.changed ? 'Changed' : 'Default'}
                </td>
                <td className={cn(cell, 'min-w-48')}>
                  {r.changed ? (
                    <>
                      {r.changed.who ?? 'An update or a script'}, {r.changed.when}
                      {r.changed.why && (
                        <span className="block text-xs text-muted-foreground">{r.changed.why}</span>
                      )}
                    </>
                  ) : (
                    'Install'
                  )}
                </td>
                {/* On a phone the table scrolls sideways rather than squeeze this to a word a line. */}
                <td className={cn(cell, 'min-w-64 text-muted-foreground')}>{r.what}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </FrameScroll>
  )
}

/** An API address in a sentence. */
const CODE = 'rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground'

function AdvancedSections({ page }: { page: AdvancedPage }) {
  const domains = useDomains()
  const write = useWrite()
  const failed = (what: string) => (e: unknown) =>
    toast(`Couldn't ${what}`, { description: toApiError(e).message })
  const checkChain = () =>
    void write('checkHistory', undefined).then(
      ({ whole, entries }) =>
        toast(whole ? 'The chain is whole' : 'The chain is broken', {
          description:
            entries === null
              ? whole
                ? 'Every entry checked.'
                : 'An entry was changed after the fact.'
              : `${entries.toLocaleString('en')} entries checked.`,
        }),
      failed('check the chain'),
    )
  const exported = (what: 'exportHistory' | 'exportContext') =>
    void write(what, undefined).then((file) => {
      save(file)
      toast('Exported', { description: file.name })
    }, failed('export'))
  const count = page.settings.reduce((sum, g) => sum + g.rows.length, 0)
  return (
    <>
      <FrameSection
        title="Tuning settings"
        level={3}
        description={`All ${count} settings and their values now. This page only shows them.`}
        collapsible
      >
        <div className="space-y-2 border-t px-4 py-3 text-sm text-muted-foreground md:px-5">
          <p>
            Each setting is kept in the database, and only an Admin can change one, through the API:{' '}
            <code className={CODE}>PUT /api/v1/settings/{'{key}'}</code> with the version they read,
            the new value and a reason. The change applies at once, and the History log keeps who
            made it and why. About our business can also be changed in General, and the Not found
            threshold in Observability, Alerts.
          </p>
          <p>
            Default means the value the app was installed with. Changed names who changed it last:
            an Admin, or, with no person, an update of the app or a script run on the database.
            Whether a real model is called at all, and its key, are set by whoever runs the app,
            where it runs, not here.
          </p>
        </div>
        <SettingsTable groups={page.settings} />
      </FrameSection>
      <FrameSection
        title="History log"
        level={3}
        description="Who changed what, and when. Hash-chained, so a change after the fact shows."
        collapsible
        defaultOpen={page.history.length > 4}
        action={
          <>
            <Button variant="outline" size="sm" onClick={checkChain}>
              Check the chain
            </Button>
            <Button variant="outline" size="sm" onClick={() => exported('exportHistory')}>
              Export
            </Button>
          </>
        }
      >
        <FrameTable
          label="History log"
          columns={[
            { label: 'When', className: 'w-36 whitespace-nowrap', cell: 'text-muted-foreground' },
            { label: 'Who', className: 'w-56', cell: 'font-medium' },
            { label: 'What', className: 'min-w-64' },
          ]}
          rows={page.history.map((h) => [h.when, h.who, cellLink(h.what, h.href)])}
        />
      </FrameSection>
      <FrameSection
        title="Jobs"
        level={3}
        description="What runs on its own."
        collapsible
        defaultOpen={false}
      >
        {page.jobs ? (
          <FrameTable
            label="Jobs"
            columns={cols('Job', 'Last run', 'Result')}
            rows={page.jobs.map((j) => [cellLink(j.job, j.href), j.last, j.result])}
          />
        ) : (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground md:px-5">
            The jobs aren&apos;t answering right now. Try again in a minute.
          </p>
        )}
      </FrameSection>
      <FrameSection
        title="Editions"
        level={3}
        description="Agents read a sealed edition. Each publish seals a new one."
        collapsible
        defaultOpen={false}
      >
        <FrameTable
          label="Editions"
          columns={cols('Edition', 'Sealed', 'Change').map((c, i) =>
            i === 0
              ? { ...c, cell: 'font-mono text-xs' }
              : i === 2
                ? { ...c, className: 'min-w-56' }
                : c,
          )}
          rows={page.editions.map((e) => [e.label, e.sealed, e.change])}
        />
      </FrameSection>
      <FrameSection
        title="Answer tests"
        level={3}
        description="The heavy checks, with a real model. The free check of saved questions already runs after every change, in Observability, Quality."
        collapsible
        defaultOpen={false}
      >
        <FrameRows
          rows={[
            {
              label: 'Needs a model key',
              hint: "Answer tests only run with a real model, so a passed test always means something. Whoever runs the app turns real models on and adds the model provider's key where it runs.",
              value: <span className="text-xs text-muted-foreground">Not set here</span>,
            },
            {
              label: 'With and without context',
              hint: 'Runs the saved questions twice, with context and without, and a model judges whether context helps. It is run once from the command line first; this comes after, with a key.',
              value: (
                <Button
                  variant="outline"
                  size="sm"
                  aria-disabled
                  aria-description="Run it once from the command line first. A model key turns this on later."
                  title="Run it once from the command line first. A model key turns this on later."
                >
                  Run with and without
                </Button>
              ),
            },
          ]}
        />
      </FrameSection>
      <FrameSection
        title="Import and export"
        level={3}
        description={
          <>
            Context as JSON, for a backup or a move. To bring context in, the command line&apos;s{' '}
            <code className={CODE}>{SLUG} import</code> checks a file, and sends its items as
            suggestions with <code className={CODE}>--apply</code>.
          </>
        }
        action={
          <Button variant="outline" size="sm" onClick={() => exported('exportContext')}>
            Export context
          </Button>
        }
      />
      <FrameSection
        title="Deleted"
        level={3}
        description="Drafts and terms that were deleted, by whom and when. Deleting is for good; published context is archived instead, so it keeps its history."
        collapsible
        defaultOpen={page.deleted.length > 1}
      >
        {page.deleted.length ? (
          <FrameRows
            rows={page.deleted.map((d) => ({
              id: d.key,
              label: d.title,
              hint: d.hint,
              value: (
                <span className="text-xs text-muted-foreground">
                  {d.domain ? domains[d.domain]?.name : ''}
                </span>
              ),
            }))}
          />
        ) : (
          <p className="border-t px-4 py-3 text-sm text-muted-foreground md:px-5">
            Nothing deleted yet.
          </p>
        )}
      </FrameSection>
    </>
  )
}

const TITLES: Record<string, string> = {
  people: 'People',
  general: 'General',
  domains: 'Domains and owners',
  agents: 'Agents and access',
  integrations: 'Integrations',
  advanced: 'Advanced',
}

/** Settings > Integrations > Cube: where you are inside Settings, each step a link back. */
export function SettingsCrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <Breadcrumb>
      <BreadcrumbList className="flex-nowrap text-sm">
        {trail.map((t, i) => (
          <React.Fragment key={t.label}>
            {i > 0 && (
              <BreadcrumbSeparator
                className={cn(
                  i < trail.length - 1 && 'max-sm:hidden',
                  i === trail.length - 1 && 'max-sm:hidden',
                )}
              />
            )}
            <BreadcrumbItem className={cn(i < trail.length - 1 && 'max-sm:hidden', 'min-w-0')}>
              {t.href && i < trail.length - 1 ? (
                <BreadcrumbLink href={t.href} className="text-foreground/75 hover:text-foreground">
                  {t.label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="truncate font-medium">{t.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  )
}

/** One Settings section, with its title and what it is for, under the settings navigation. No tabs. */
export function SettingsPage({
  section,
  sub,
  step,
}: {
  section?: string
  sub?: string
  step?: string
}) {
  const me = useMe()
  const current = section && TITLES[section] ? section : me.admin ? 'general' : 'domains'
  // Owners who aren't admins use two places here: their domains and the people list.
  if (!me.admin && current !== 'domains' && current !== 'people')
    return (
      <Page title="Settings">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Settings are for admins</EmptyTitle>
            <EmptyDescription>
              Ask Ravi Kapoor or Jon Abara if something here needs changing.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </Page>
    )
  if (current === 'integrations') return <IntegrationsRoute id={sub} step={step} />
  if (current === 'domains' && sub)
    return (
      <React.Suspense fallback={<Page title="Domain">{null}</Page>}>
        <DomainPage
          id={sub}
          crumbs={(name) => (
            <SettingsCrumbs
              trail={[
                { label: 'Settings', href: '/settings/general' },
                { label: 'Domains and owners', href: '/settings/domains' },
                { label: name },
              ]}
            />
          )}
        />
      </React.Suspense>
    )
  const title = (
    <SettingsCrumbs
      trail={[{ label: 'Settings', href: '/settings/general' }, { label: TITLES[current]! }]}
    />
  )
  if (current === 'general')
    return (
      <React.Suspense fallback={<Page title={title}>{null}</Page>}>
        <AboutPage title={title} helpText={<AboutHelp />} />
      </React.Suspense>
    )
  return (
    <Page title={title}>
      <FramePage>
        {current === 'domains' && <Domains />}
        {current === 'people' && <People />}
        {current === 'agents' && <Agents />}
        {current === 'advanced' && <Advanced />}
      </FramePage>
    </Page>
  )
}
