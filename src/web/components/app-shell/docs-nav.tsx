import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useShellActions } from './shell-actions'
import { plainClick } from './trail'
import {
  ArrowLeftIcon,
  BookOpenIcon,
  ChevronDownIcon,
  ListTreeIcon,
  SearchIcon,
  XIcon,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import type { DocHit, DocPage, DocsLibrary } from '@/lib/docs'
import { docSections, docSectionTitle, type DocSectionId } from '@/lib/docs-sections'
import { treeKeyMove, type TreeKeyItem } from '@/lib/tree-keys'
import { cn } from '@/lib/utils'

/*
  Docs mode (contract 8.11): the docs' own navigation beside the app's sidebar, which folds to its
  rail while the docs are open. Its title bar names the docs and leads back to the app, then a
  field searches every page, and the tree lists every page under its section, the page open
  picked out. From 1024 wide it is a sidebar of its own; below that a bar under the header opens
  it as a drawer.
*/

/** The page of the docs open, from the address, or none on the docs home. */
export function useDocsSlug(): string | undefined {
  return useRouterState({
    select: (state) => {
      const leaf = state.matches.at(-1)
      return leaf?.routeId === '/docs/$slug' ? (leaf.params as { slug: string }).slug : undefined
    },
  })
}

/** A row of the docs' sidebar: 28 high from 768 wide, 44 on a phone, as the app's sidebar. */
const rowClass =
  'flex h-control-touch min-w-0 items-center gap-2 rounded-md px-2 text-dense -outline-offset-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring md:h-control-sm'

/** The docs' title bar: Docs, the way to the docs home, and Back, the way out. */
function DocsTitleBar({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const { appReturnHref } = useShellActions()
  const navigate = useNavigate()
  const href = appReturnHref()
  return (
    <div className="flex h-header shrink-0 items-center gap-2 border-b px-3">
      {title}
      <a
        href={href}
        onClick={(event) => {
          if (!plainClick(event)) return
          event.preventDefault()
          void navigate({ href })
        }}
        className="ml-auto inline-flex h-control-sm items-center gap-1 rounded-md px-2 text-caption text-muted-foreground -outline-offset-2 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-control-touch"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-icon-sm" />
        Back
      </a>
      {children}
    </div>
  )
}

function DocsHomeLink() {
  const onHome = useRouterState({
    select: (state) => {
      const leaf = state.matches.at(-1)
      return leaf?.routeId === '/docs/' && !leaf.search.section
    },
  })
  return (
    <Link
      to="/docs"
      activeOptions={{ exact: true, includeSearch: true }}
      aria-current={onHome ? 'page' : undefined}
      className="inline-flex h-control-sm items-center gap-2 rounded-md px-2 text-body font-bold -outline-offset-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-control-touch"
    >
      <BookOpenIcon aria-hidden="true" className="size-4 text-brand-ink" />
      Docs
    </Link>
  )
}

/**
 * The search field and, under it, the tree, or what the words match while there are any. A
 * page opened from either closes the drawer (`onFollow`).
 */
function DocsNavBody({
  docs,
  slug,
  onFollow,
  searchRef,
}: {
  docs: DocsLibrary
  slug?: string
  onFollow?: () => void
  searchRef?: (element: HTMLInputElement | null) => void
}) {
  const [query, setQuery] = useState('')
  const trimmed = query.trim()
  const hits = useMemo(() => (trimmed ? docs.search(trimmed, 8) : []), [docs, trimmed])
  const follow = () => {
    setQuery('')
    onFollow?.()
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3">
      <InputGroup className="shrink-0 bg-background max-md:h-control-touch">
        <InputGroupAddon>
          <SearchIcon aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          ref={searchRef}
          type="search"
          aria-label="Search the docs"
          placeholder="Search the docs"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            // Escape empties the field before it goes up a level (contract 9.11).
            if (event.key === 'Escape' && query) {
              event.stopPropagation()
              setQuery('')
            }
          }}
        />
      </InputGroup>
      {trimmed ? (
        <DocsHits query={trimmed} hits={hits} onFollow={follow} />
      ) : (
        <DocsTree docs={docs} slug={slug} onFollow={onFollow} />
      )}
    </div>
  )
}

function DocsHits({
  query,
  hits,
  onFollow,
}: {
  query: string
  hits: DocHit[]
  onFollow: () => void
}) {
  return (
    <section aria-label="Search results" className="flex flex-col gap-2">
      <p role="status" className="px-2 text-caption text-muted-foreground">
        {hits.length === 0
          ? `No page matches “${query}”. Try fewer words, or the word a screen uses.`
          : `${hits.length} ${hits.length === 1 ? 'page matches' : 'pages match'}`}
      </p>
      {hits.length ? (
        <ul className="flex flex-col">
          {hits.map((hit) => (
            <li key={hit.slug}>
              <Link
                to="/docs/$slug"
                params={{ slug: hit.slug }}
                hash={hit.heading?.id}
                onClick={onFollow}
                className="flex flex-col rounded-md px-2 py-1 text-dense -outline-offset-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring max-md:min-h-control-touch max-md:justify-center"
              >
                <span>{hit.heading ? hit.heading.title : hit.title}</span>
                {hit.heading ? (
                  <span className="text-caption text-muted-foreground">{hit.title}</span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

const sectionKey = (id: DocSectionId) => `section:${id}`
const pageKey = (slug: string) => `page:${slug}`

/**
 * Every page under its section, as a tree (the WAI-ARIA tree view pattern): one tab stop, the
 * arrow keys to move, open and close, Enter to open a page or a section. Every section starts
 * open; one closed stays closed until a page in it opens. Nothing is stored.
 */
export function DocsTree({
  docs,
  slug,
  onFollow,
}: {
  docs: DocsLibrary
  slug?: string
  onFollow?: () => void
}) {
  const id = useId()
  const sections = useMemo(
    () =>
      docSections.flatMap((section) => {
        const pages = docs.pages.filter((page) => page.section === section.id)
        return pages.length ? [{ ...section, pages }] : []
      }),
    [docs],
  )
  const current = slug ? docs.page(slug) : undefined
  const [closed, setClosed] = useState<ReadonlySet<DocSectionId>>(() => new Set())
  // A page opened in a closed section opens it, so the tree shows where the page is.
  const [shown, setShown] = useState(slug)
  if (shown !== slug) {
    setShown(slug)
    if (current && closed.has(current.section))
      setClosed(new Set([...closed].filter((section) => section !== current.section)))
  }
  const items: TreeKeyItem[] = sections.flatMap((section) => {
    const expanded = !closed.has(section.id)
    return [
      { key: sectionKey(section.id), parent: null, branch: true, expanded },
      ...(expanded
        ? section.pages.map((page) => ({
            key: pageKey(page.slug),
            parent: sectionKey(section.id),
            branch: false,
            expanded: false,
          }))
        : []),
    ]
  })
  // The one tab stop: the item last focused, else the page open, else its section, else the first.
  const [active, setActive] = useState<string | null>(null)
  const shownKeys = new Set(items.map((item) => item.key))
  const tabStop =
    [
      active,
      current ? pageKey(current.slug) : null,
      current ? sectionKey(current.section) : null,
    ].find((key): key is string => key !== null && shownKeys.has(key)) ?? items[0]?.key
  const nodes = useRef(new Map<string, HTMLElement>())
  const node = (key: string) => (element: HTMLElement | null) => {
    if (element) nodes.current.set(key, element)
    else nodes.current.delete(key)
  }
  const setOpen = (section: DocSectionId, open: boolean) =>
    setClosed((before) => {
      const next = new Set(before)
      if (open) next.delete(section)
      else next.add(section)
      return next
    })
  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const at = (event.target as HTMLElement).closest<HTMLElement>('[data-tree-key]')?.dataset
      .treeKey
    if (!at) return
    const move = treeKeyMove(items, at, event.key)
    if (!move) return
    event.preventDefault()
    // The app's own keys (j, k, the arrows on a list) do not see a key the tree took.
    event.stopPropagation()
    if ('focus' in move) {
      setActive(move.focus)
      nodes.current.get(move.focus)?.focus()
    } else if ('expand' in move) setOpen(move.expand.slice('section:'.length) as DocSectionId, true)
    else setOpen(move.collapse.slice('section:'.length) as DocSectionId, false)
  }
  return (
    <ul role="tree" aria-label="Docs pages" onKeyDown={onKeyDown} className="flex flex-col gap-3">
      {sections.map((section) => {
        const key = sectionKey(section.id)
        const expanded = !closed.has(section.id)
        const labelId = `${id}-${section.id}`
        return (
          <li
            key={section.id}
            ref={node(key)}
            role="treeitem"
            aria-expanded={expanded}
            aria-labelledby={labelId}
            tabIndex={tabStop === key ? 0 : -1}
            data-tree-key={key}
            onFocus={(event) => {
              if (event.target === event.currentTarget) setActive(key)
            }}
            // The row draws the focus ring: the item holds its pages too.
            className="flex flex-col gap-0 outline-none [&:focus-visible>[data-slot=tree-row]]:outline-2 [&:focus-visible>[data-slot=tree-row]]:outline-ring"
          >
            <div
              id={labelId}
              data-slot="tree-row"
              onClick={() => setOpen(section.id, !expanded)}
              className={cn(
                rowClass,
                'cursor-pointer text-caption text-muted-foreground hover:text-foreground',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{section.title}</span>
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  'size-icon-sm shrink-0 transition-transform duration-fast',
                  !expanded && '-rotate-90',
                )}
              />
            </div>
            {expanded ? (
              <ul role="group" className="flex flex-col gap-0">
                {section.pages.map((page) => (
                  <DocsTreePage
                    key={page.slug}
                    page={page}
                    current={page.slug === slug}
                    tabStop={tabStop === pageKey(page.slug)}
                    nodeRef={node(pageKey(page.slug))}
                    onFocus={() => setActive(pageKey(page.slug))}
                    onFollow={onFollow}
                  />
                ))}
              </ul>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

function DocsTreePage({
  page,
  current,
  tabStop,
  nodeRef,
  onFocus,
  onFollow,
}: {
  page: DocPage
  current: boolean
  tabStop: boolean
  nodeRef: (element: HTMLElement | null) => void
  onFocus: () => void
  onFollow?: () => void
}) {
  return (
    <li role="none">
      <Link
        ref={nodeRef}
        to="/docs/$slug"
        params={{ slug: page.slug }}
        role="treeitem"
        tabIndex={tabStop ? 0 : -1}
        data-tree-key={pageKey(page.slug)}
        aria-current={current ? 'page' : undefined}
        title={page.short ? page.title : undefined}
        onFocus={onFocus}
        onClick={onFollow}
        className={cn(rowClass, current && 'bg-selected font-bold hover:bg-selected')}
      >
        <span className="min-w-0 flex-1 truncate">{page.shortTitle}</span>
      </Link>
    </li>
  )
}

/** The docs' sidebar beside the app's rail, the full height of the window, from 1024 wide. */
export function DocsSidebar({ docs }: { docs: DocsLibrary }) {
  const slug = useDocsSlug()
  return (
    <nav
      aria-label="Docs"
      data-slot="docs-sidebar"
      className="sticky top-0 hidden h-svh w-sidebar shrink-0 flex-col border-r bg-background lg:flex"
    >
      <DocsTitleBar title={<DocsHomeLink />} />
      <DocsNavBody docs={docs} slug={slug} />
    </nav>
  )
}

/**
 * Below 1024 wide: a bar under the header with Pages, which opens the docs' tree as a drawer,
 * where the page is in the docs, and Search, which opens the drawer at its field.
 */
export function DocsPagesBar({ docs }: { docs: DocsLibrary }) {
  const slug = useDocsSlug()
  const section = useRouterState({
    select: (state) => {
      const leaf = state.matches.at(-1)
      return leaf?.routeId === '/docs/' ? leaf.search.section : undefined
    },
  })
  const page = slug ? docs.page(slug) : undefined
  const [open, setOpen] = useState(false)
  const search = useRef<HTMLInputElement | null>(null)
  const [focusSearch, setFocusSearch] = useState(false)
  const place = page
    ? `${docSectionTitle(page.section)} / ${page.shortTitle}`
    : section
      ? docSectionTitle(section)
      : `${docs.pages.length} pages`
  const openDrawer = (atSearch: boolean) => {
    setFocusSearch(atSearch)
    setOpen(true)
  }
  return (
    <>
      <div
        data-slot="docs-pages-bar"
        className="sticky top-header z-sticky flex min-h-toolbar items-center gap-2 border-b bg-background px-gutter lg:hidden"
      >
        <Button
          variant="ghost"
          size="sm"
          aria-haspopup="dialog"
          onClick={() => openDrawer(false)}
          className="font-bold"
        >
          <ListTreeIcon aria-hidden="true" />
          Pages
        </Button>
        <span aria-hidden="true" className="h-4 border-l" />
        <span className="min-w-0 flex-1 truncate text-dense text-muted-foreground">{place}</span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Search the docs"
          aria-haspopup="dialog"
          onClick={() => openDrawer(true)}
        >
          <SearchIcon aria-hidden="true" />
        </Button>
      </div>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          // Pages opens at the page open in the tree, Search at the field.
          initialFocus={() =>
            focusSearch
              ? search.current
              : document.querySelector<HTMLElement>(
                  '[data-slot="sheet-content"] [role="tree"] [tabindex="0"]',
                )
          }
          // The docked sidebar's ground, not the popover's: on the popover the selected page
          // all but vanishes in dark mode.
          className="gap-0 bg-background p-0"
        >
          <DocsTitleBar
            title={
              <SheetTitle className="flex items-center gap-2 px-2 text-body">
                <BookOpenIcon aria-hidden="true" className="size-4 text-brand-ink" />
                Docs
              </SheetTitle>
            }
          >
            <SheetClose render={<Button variant="ghost" size="icon" />}>
              <XIcon aria-hidden="true" />
              <span className="sr-only">Close</span>
            </SheetClose>
          </DocsTitleBar>
          <SheetDescription className="sr-only">
            Every page of the docs, and a field that searches them.
          </SheetDescription>
          <DocsNavBody
            docs={docs}
            slug={slug}
            onFollow={() => setOpen(false)}
            searchRef={(element) => {
              search.current = element
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  )
}
