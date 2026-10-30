import * as React from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
  FileTextIcon,
  PlugIcon,
  SearchIcon,
  TextQuoteIcon,
  PenLineIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { StateLine } from '@/components/heed/state-line'
import { Logo } from '@/components/heed/logo'
import { CopiedIcon, useCopied } from '@/components/heed/copied-icon'
import { buttonVariants } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandDialog,
} from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import { AGENT_TOOLS, CHECKS, PROMPT } from '@/lib/agents'
import { setupSteps } from '@/lib/setup'
import { kindHint, kindLabel, type Kind } from '@/model/items'
import { ANSWER_LINES, supportMail, WORDS } from '@/lib/help-content'
import {
  CHANGELOG_SLUG,
  CHANGES,
  DOC_GROUPS,
  DOC_PAGES,
  docHref,
  docPage,
  DOCS_HOME,
  llmsTxt,
  searchDocs,
  type DocPage,
} from '@/lib/docs'
import { wordOf } from '@/lib/docs-includes'
import type { DocBlock, DocInline, DocTarget } from '@domain/docs'

// The documentation site. Its pages are the Markdown files in docs/help, read at build time
// (lib/docs.ts), so the app's Docs area and the static docs site (npm run docs:build) show the same
// pages. Where a page names one of the app's own lists (the setup steps, the prompt and its checks,
// the kinds, the answer lines, the words and the tools), it shows that list from its source, so a
// change there changes here. It knows nothing of the app's router: the app and the static site
// each say which page is open and how to go to another.

const base = DOCS_HOME
const guideHref = (slug: string) => docHref(slug)

/**
 * Where the app is, for a link from the docs to one of its screens. In the app the docs share its
 * origin; the static docs site is built with VITE_DOCS_APP_URL when it is hosted elsewhere.
 */
const APP = ((import.meta.env.VITE_DOCS_APP_URL as string | undefined) ?? '').replace(/\/$/, '')
const appHref = (path: string) => `${APP}${path}`

/** Which page is open, and how to go to another: the app's router, or the browser's address. */
export type DocsPlace = { slug?: string; query: URLSearchParams; go: (href: string) => void }

/* ---------- article content ---------- */

const b = (text: string) => <strong className="font-medium">{text}</strong>

const hrefOf = (to: DocTarget) =>
  'page' in to
    ? guideHref(to.page) + (to.hash ? `#${to.hash}` : '')
    : 'screen' in to
      ? appHref(to.screen)
      : to.web

function Inline({ nodes }: { nodes: readonly DocInline[] }) {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text
      case 'break':
        return <br key={i} />
      case 'code':
        return (
          <code key={i} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-sm">
            {node.text}
          </code>
        )
      case 'strong':
        return (
          <strong key={i} className="font-medium">
            <Inline nodes={node.children} />
          </strong>
        )
      case 'em':
        return (
          <em key={i}>
            <Inline nodes={node.children} />
          </em>
        )
      case 'link': {
        const web = 'web' in node.to
        return (
          <a
            key={i}
            href={hrefOf(node.to)}
            {...(web ? { target: '_blank', rel: 'noreferrer' } : {})}
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            <Inline nodes={node.children} />
          </a>
        )
      }
    }
  })
}

/** A block's words as one item of a list: a paragraph's words without a paragraph around them. */
function ItemBody({ blocks }: { blocks: readonly DocBlock[] }) {
  const [first] = blocks
  if (blocks.length === 1 && first?.type === 'paragraph') return <Inline nodes={first.children} />
  return <ArticleBody blocks={blocks} />
}
/* ---------- parts ---------- */

function DocsHeader({ slug, onSearch }: { slug?: string; onSearch: () => void }) {
  const tabs = [
    {
      label: 'Guides',
      href: `${base}`,
      on: slug !== 'tools' && slug !== CHANGELOG_SLUG,
    },
    {
      label: 'Reference',
      href: guideHref('tools'),
      on: slug === 'tools',
    },
    {
      label: "What's new",
      href: guideHref(CHANGELOG_SLUG),
      on: slug === CHANGELOG_SLUG,
    },
  ]
  return (
    <header className="sticky top-0 z-site-header border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-12 max-w-352 items-center gap-4 px-4 md:px-6">
        <a
          href={`${base}`}
          className="flex items-center gap-3 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <Logo className="h-5" />
          <span className="h-4 w-px bg-border" aria-hidden />
          <span className="text-sm font-medium text-foreground/75">Docs</span>
        </a>
        <nav aria-label="Documentation" className="ml-2 flex items-center gap-1 max-sm:hidden">
          {tabs.map((t) => (
            <a
              key={t.label}
              href={t.href}
              aria-current={t.on ? 'page' : undefined}
              className={cn(
                'rounded-md px-2.5 py-1 text-sm',
                t.on
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onSearch}
            className="flex h-8 w-9 items-center justify-center gap-2 rounded-md border border-input bg-background text-sm text-muted-foreground outline-none hover:border-foreground/40 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:w-60 sm:justify-start sm:px-2.5"
          >
            <SearchIcon className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 text-left max-sm:hidden">Search the docs</span>
            <Kbd className="max-sm:hidden">⌘K</Kbd>
            <span className="sr-only sm:hidden">Search the docs</span>
          </button>
          <a
            href={appHref('/inbox')}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-sm:hidden')}
          >
            Open the app
            <ArrowUpRightIcon />
          </a>
        </div>
      </div>
    </header>
  )
}

function DocsNav({ slug }: { slug?: string }) {
  return (
    <nav aria-label="Pages" className="flex flex-col gap-5 text-sm">
      {DOC_GROUPS.map((g) => (
        <div key={g}>
          <div className="mb-1.5 px-2 text-sm font-medium">{g}</div>
          <ul className="flex flex-col">
            {DOC_PAGES.filter((p) => p.group === g).map((p) => (
              <li key={p.slug}>
                <a
                  href={guideHref(p.slug)}
                  aria-current={slug === p.slug ? 'page' : undefined}
                  className={cn(
                    'block rounded-md px-2 py-1.5 text-muted-foreground hover:text-foreground',
                    slug === p.slug && 'bg-muted font-medium text-foreground',
                  )}
                >
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
      <a
        href={guideHref(CHANGELOG_SLUG)}
        aria-current={slug === CHANGELOG_SLUG ? 'page' : undefined}
        className="rounded-md px-2 py-1.5 font-medium hover:bg-muted"
      >
        {CHANGES.title}
      </a>
    </nav>
  )
}

function Code({ label, text }: { label: string; text: string }) {
  const [copied, copy] = useCopied()
  return (
    <figure className="overflow-hidden rounded-frame border">
      <figcaption className="flex items-center justify-between border-b bg-band px-4 py-2 text-xs text-muted-foreground">
        {label}
        <button
          type="button"
          onClick={() => copy(text)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          <CopiedIcon copied={copied} className="[&_svg]:size-3.5" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-dense leading-6 whitespace-pre-wrap">
        {text}
      </pre>
    </figure>
  )
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {items.map((it, j) => (
        <li key={j} className="flex gap-3">
          <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground tabular-nums">
            {j + 1}
          </span>
          <span className="min-w-0 text-pretty text-foreground/85">{it}</span>
        </li>
      ))}
    </ol>
  )
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-muted-foreground">
      {items.map((it, j) => (
        <li key={j} className="text-pretty text-foreground/85">
          {it}
        </li>
      ))}
    </ul>
  )
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return <p className="text-pretty text-foreground/85">{children}</p>
}

/** One of the app's own lists, where a page names it, drawn from its source. */
function Include({ block }: { block: Extract<DocBlock, { type: 'include' }> }) {
  switch (block.name) {
    case 'setup-steps':
      return (
        <Steps
          items={setupSteps.map((st) => (
            <>
              {b(st.title)}. {st.description}
            </>
          ))}
        />
      )
    case 'prompt':
      return <Code label="The prompt, exactly as the app shows it" text={PROMPT} />
    case 'checks':
      return <List items={CHECKS} />
    case 'kinds':
      return (
        <List
          items={(Object.keys(kindLabel) as Kind[]).map((k) => (
            <>
              {b(kindLabel[k])}: {kindHint[k]}
            </>
          ))}
        />
      )
    case 'word':
      return <Paragraph>{wordOf(block.arg)}</Paragraph>
    case 'words':
      return (
        <dl className="grid gap-px overflow-hidden rounded-frame border bg-border sm:grid-cols-2">
          {WORDS.map(([w, d]) => (
            <div key={w} className="bg-background px-4 py-3">
              <dt className="text-sm font-medium">{w}</dt>
              <dd className="mt-0.5 text-sm leading-6 text-muted-foreground">{d}</dd>
            </div>
          ))}
        </dl>
      )
    case 'tools':
      return (
        <div className="overflow-hidden rounded-frame border">
          {AGENT_TOOLS.map((tool) => (
            <section key={tool.name} className="border-t px-4 py-3.5 first:border-t-0">
              <h3 className="font-mono text-sm font-medium">{tool.name}</h3>
              <p className="mt-0.5 text-sm leading-6 text-foreground/85">{tool.what}</p>
              <dl className="mt-2 grid grid-cols-(--cols-lead-18) gap-x-3 gap-y-1 text-sm leading-6">
                <dt className="text-muted-foreground">Takes</dt>
                <dd>{tool.takes}</dd>
                <dt className="text-muted-foreground">Returns</dt>
                <dd>{tool.returns}</dd>
              </dl>
            </section>
          ))}
        </div>
      )
    case 'answer-lines':
      return (
        <div className="overflow-hidden rounded-frame border">
          {ANSWER_LINES.map((a) => (
            <div
              key={a.state}
              className="grid gap-x-6 gap-y-1.5 border-t px-4 py-3.5 first:border-t-0 md:grid-cols-(--cols-lead-56)"
            >
              <div>
                <StateLine state={a.state} sentence tip={false} />
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                <span className="font-medium text-foreground">{a.long}.</span> {a.means}{' '}
                <span className="text-foreground">{a.todo}</span>
              </p>
            </div>
          ))}
        </div>
      )
  }
}

function ArticleBody({ blocks }: { blocks: readonly DocBlock[] }) {
  return (
    <div className="flex flex-col gap-4 text-reading leading-7">
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'heading':
            return b.depth === 2 ? (
              <h2
                key={i}
                id={b.id}
                className="mt-6 scroll-mt-20 text-xl leading-snug font-semibold tracking-tight first:mt-0"
              >
                {b.text}
              </h2>
            ) : (
              <h3 key={i} id={b.id} className="mt-2 scroll-mt-20 text-base font-semibold">
                {b.text}
              </h3>
            )
          case 'paragraph':
            return (
              <Paragraph key={i}>
                <Inline nodes={b.children} />
              </Paragraph>
            )
          case 'list':
            return b.ordered ? (
              <Steps
                key={i}
                items={b.items.map((it, j) => (
                  <ItemBody key={j} blocks={it} />
                ))}
              />
            ) : (
              <List
                key={i}
                items={b.items.map((it, j) => (
                  <ItemBody key={j} blocks={it} />
                ))}
              />
            )
          case 'code':
            return <Code key={i} label={b.title} text={b.text} />
          case 'note':
            return (
              <aside key={i} className="rounded-frame border bg-band px-4 py-3 text-sm leading-6">
                <strong className="font-medium">{b.title}. </strong>
                <span className="text-foreground/85">
                  <ItemBody blocks={b.children} />
                </span>
              </aside>
            )
          case 'table':
            return (
              <div key={i} className="overflow-x-auto rounded-frame border">
                <table className="w-full text-left text-sm leading-6">
                  <thead className="border-b bg-band text-xs text-muted-foreground">
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} className="px-4 py-2 font-normal">
                          <Inline nodes={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, j) => (
                      <tr key={j} className="border-t first:border-t-0">
                        {row.map((c, k) => (
                          <td key={k} className="px-4 py-2.5 align-top">
                            <Inline nodes={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'include':
            return <Include key={i} block={b} />
        }
      })}
    </div>
  )
}

const sectionsOf = (page: DocPage) => page.headings.filter((h) => h.depth === 2)

function Toc({ page }: { page: DocPage }) {
  const heads = sectionsOf(page)
  return (
    <nav aria-label="On this page" className="text-sm">
      <div className="mb-2 font-medium">On this page</div>
      <ul className="flex flex-col border-l">
        {heads.map((h, i) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                '-ml-px block border-l py-1 pl-3 text-muted-foreground hover:text-foreground',
                i === 0 ? 'border-foreground font-medium text-foreground' : 'border-transparent',
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Article({ page }: { page: DocPage }) {
  const i = DOC_PAGES.findIndex((p) => p.slug === page.slug)
  const prev = DOC_PAGES[i - 1]
  const next = DOC_PAGES[i + 1]
  const heads = sectionsOf(page)
  return (
    <div className="grid min-w-0 lg:grid-cols-(--cols-docs-page)">
      <article className="min-w-0 px-4 py-8 md:px-10 md:py-10 lg:px-14">
        <div className="mx-auto max-w-176">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <a href={`${base}`} className="hover:text-foreground">
              Docs
            </a>
            <span className="mx-1.5" aria-hidden>
              /
            </span>
            <span>{page.group}</span>
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-hero leading-hero font-bold tracking-hero text-balance">
              {page.title}
            </h1>
            {page.open && (
              <a
                href={appHref(page.open.href)}
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <PlugIcon />
                {page.open.label}
                <ArrowUpRightIcon />
              </a>
            )}
          </div>
          <p className="mt-3 mb-8 text-lg leading-7 text-pretty text-muted-foreground">
            <Inline nodes={page.lead} />
          </p>
          {/* On a phone the right-hand list folds into one row under the title. */}
          {heads.length > 0 && (
            <details className="mb-8 rounded-frame border text-sm lg:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium">
                On this page
                <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden />
              </summary>
              <ul className="border-t px-3 py-2">
                {heads.map((h) => (
                  <li key={h.id} className="py-1">
                    <a href={`#${h.id}`} className="text-muted-foreground hover:text-foreground">
                      {h.text}
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <ArticleBody blocks={page.blocks} />
          <div className="mt-12 grid gap-px overflow-hidden rounded-frame border bg-border sm:grid-cols-2">
            {prev ? (
              <a
                href={guideHref(prev.slug)}
                className="flex flex-col gap-1 bg-background px-4 py-3.5 hover:bg-muted/50"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ArrowLeftIcon className="size-3.5" aria-hidden />
                  Previous
                </span>
                <span className="text-sm font-medium">{prev.title}</span>
              </a>
            ) : (
              <span className="bg-background" />
            )}
            {next && (
              <a
                href={guideHref(next.slug)}
                className="flex flex-col items-end gap-1 bg-background px-4 py-3.5 text-right hover:bg-muted/50"
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  Next
                  <ArrowRightIcon className="size-3.5" aria-hidden />
                </span>
                <span className="text-sm font-medium">{next.title}</span>
              </a>
            )}
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            Something wrong or missing on this page?{' '}
            <a
              href={supportMail(`The docs: ${page.title}`, `Page: ${guideHref(page.slug)}`)}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Tell support
            </a>
            .
          </p>
        </div>
      </article>
      <aside className="hidden border-l py-10 pr-6 pl-6 lg:block">
        <div className="sticky top-20">
          <Toc page={page} />
        </div>
      </aside>
    </div>
  )
}

function Landing({ onSearch }: { onSearch: () => void }) {
  // The first page of each of the first steps: start, connect, write.
  const start = DOC_PAGES.slice(0, 3)
  const icons = [BookOpenIcon, PlugIcon, PenLineIcon]
  return (
    <div className="min-w-0">
      <div className="px-4 py-10 md:px-10 md:py-14 lg:px-14">
        <div className="max-w-2xl">
          <h1 className="text-hero-lg leading-hero-lg font-bold tracking-tight text-balance">
            Documentation
          </h1>
          <p className="mt-3 text-lg leading-7 text-pretty text-muted-foreground">
            How to write context, connect your agents and review suggestions, and how agents read
            what you wrote.
          </p>
          <button
            type="button"
            onClick={onSearch}
            className="mt-6 flex h-11 w-full max-w-md items-center gap-2.5 rounded-md border border-input bg-background px-3.5 text-left text-sm text-muted-foreground outline-none hover:border-foreground/40 focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <SearchIcon className="size-4" aria-hidden />
            <span className="flex-1">Search the docs</span>
            <Kbd className="max-sm:hidden">⌘K</Kbd>
          </button>
        </div>
      </div>
      <div className="grid gap-px border-y bg-border md:grid-cols-3">
        {start.map((p, i) => {
          const Icon = icons[i]!
          return (
            <a
              key={p.slug}
              href={guideHref(p.slug)}
              className="group flex flex-col gap-2 bg-background px-5 py-5 outline-none hover:bg-muted/40 focus-visible:bg-muted/40 md:px-6"
            >
              <Icon className="size-5 text-muted-foreground" aria-hidden />
              <span className="mt-2 flex items-center gap-1.5 text-base font-medium">
                {p.title}
                <ArrowRightIcon
                  className="size-4 -translate-x-1 opacity-0 transition group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden
                />
              </span>
              <span className="text-sm leading-6 text-pretty text-muted-foreground">{p.line}</span>
            </a>
          )
        })}
      </div>
      <div className="grid gap-px bg-border md:grid-cols-2">
        {DOC_GROUPS.map((g) => (
          <section key={g} className="bg-background px-5 py-5 md:px-6 lg:px-8">
            <h2 className="mb-2 text-sm font-medium">{g}</h2>
            <ul>
              {DOC_PAGES.filter((p) => p.group === g).map((p) => (
                <li key={p.slug} className="border-t first:border-t-0">
                  <a
                    href={guideHref(p.slug)}
                    className="flex items-baseline justify-between gap-4 py-2.5 hover:text-primary"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium">{p.title}</span>
                      <span className="block text-sm text-pretty text-muted-foreground">
                        {p.line}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {p.minutes} min
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <section className="bg-background px-5 py-5 md:px-6 lg:px-8">
          <h2 className="mb-2 text-sm font-medium">In the app</h2>
          <p className="text-sm leading-6 text-pretty text-muted-foreground">
            Help, from the sidebar, has the product's own words, the answer lines and the keyboard
            shortcuts, and works without leaving your page.
          </p>
          <a
            href={appHref('/help')}
            className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Open Help
            <ArrowUpRightIcon className="size-3.5" aria-hidden />
          </a>
        </section>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-muted-foreground md:px-6 lg:px-8">
        <span>
          Need a person?{' '}
          <a className="underline underline-offset-4 hover:text-foreground" href={supportMail()}>
            Contact support
          </a>
        </span>
        <span>
          Agents can read these pages as plain text at{' '}
          <a
            href={`${base}/llms.txt`}
            className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground hover:underline"
          >
            {base}/llms.txt
          </a>
        </span>
      </div>
    </div>
  )
}

const day = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

function Changelog() {
  return (
    <article className="min-w-0 px-4 py-8 md:px-10 md:py-10 lg:px-14">
      <div className="mx-auto max-w-176">
        <h1 className="text-hero leading-hero font-bold tracking-hero">{CHANGES.title}</h1>
        <p className="mt-3 mb-8 text-lg leading-7 text-muted-foreground">{CHANGES.line}</p>
        <ol className="border-l">
          {CHANGES.changes.map((c) => (
            <li key={c.id} id={c.id} className="relative scroll-mt-20 pb-8 pl-6 last:pb-0">
              <span
                className="absolute top-2 -left-0.75 size-1.5 rounded-full bg-foreground"
                aria-hidden
              />
              <time dateTime={c.date} className="block text-xs text-muted-foreground tabular-nums">
                {day(c.date)}
              </time>
              <h2 className="text-base font-semibold">{c.title}</h2>
              <div className="mt-1 text-reading leading-7 text-foreground/85">
                <ItemBody blocks={c.children} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </article>
  )
}

const matches = (q: string, ...parts: string[]) =>
  parts.join(' ').toLowerCase().includes(q.trim().toLowerCase())

function SearchDialog({
  open,
  onOpenChange,
  initial,
  go,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: string
  go: (href: string) => void
}) {
  const [value, setValue] = React.useState(initial)
  const to = (href: string) => () => (onOpenChange(false), go(href))
  const q = value.trim()
  // Every page while nothing is typed; then the parts of pages whose words match, best first.
  const hits = q
    ? searchDocs(q)
    : DOC_PAGES.map((p) => ({ slug: p.slug, title: p.title, heading: '', id: '', group: p.group }))
  const words = WORDS.filter(([w, d]) => !q || matches(q, w, d))
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search the docs"
      description="Search guides, answer lines and words"
    >
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search the docs" value={value} onValueChange={setValue} />
        <CommandList>
          <CommandEmpty>Nothing found. Try another word, or contact support.</CommandEmpty>
          {hits.length > 0 && (
            <CommandGroup heading="Guides">
              {hits.map((h) => (
                <CommandItem
                  key={`${h.slug}#${h.id}`}
                  value={`${h.slug}#${h.id}`}
                  onSelect={to(guideHref(h.slug) + (h.id ? `#${h.id}` : ''))}
                >
                  <FileTextIcon />
                  <span className="min-w-0 flex-1 truncate">
                    {h.title}
                    {h.heading && <span className="text-muted-foreground"> › {h.heading}</span>}
                  </span>
                  <span className="text-xs text-muted-foreground max-sm:hidden">{h.group}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          {words.length > 0 && (
            <CommandGroup className="border-t" heading="Words">
              {words.map(([w]) => (
                <CommandItem
                  key={w}
                  value={`${w} (word)`}
                  onSelect={to(guideHref('answer-lines') + '#words')}
                >
                  <TextQuoteIcon />
                  <span className="min-w-0 flex-1 truncate">{w}</span>
                  <span className="text-xs text-muted-foreground max-sm:hidden">Word</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
        </CommandList>
        <CommandFooter>
          <span className="flex items-center gap-1.5">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd>
            to move
          </span>
          <span className="flex items-center gap-1.5">
            <Kbd>↵</Kbd>
            to open
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <Kbd>Esc</Kbd>
            to close
          </span>
        </CommandFooter>
      </Command>
    </CommandDialog>
  )
}

const noChange = () => () => undefined

/** The documentation, at the page `slug` names: the landing page without one. */
export function DocsSite({ slug, query, go }: DocsPlace) {
  // Help's "Search the documentation" arrives with its term: the search opens with it, once the
  // page is in the browser, so the static site's drawn page and the browser's agree. After that it
  // is open while the person keeps it open.
  const asked = query.get('open') === 'search' || !!query.get('q')
  const inBrowser = React.useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  )
  const [chosen, setSearching] = React.useState<boolean | null>(null)
  const searching = chosen ?? (asked && inBrowser)
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearching((o) => !(o ?? (asked && inBrowser)))
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [asked, inBrowser])
  const page = docPage(slug)
  // The plain-text index for agents: no page around it, as a text file would be.
  if (slug === 'llms.txt')
    return (
      <pre className="min-h-svh bg-background p-6 font-mono text-sm leading-6 whitespace-pre-wrap text-foreground">
        {llmsTxt()}
      </pre>
    )
  return (
    <div className="min-h-svh bg-background text-foreground">
      <DocsHeader slug={slug} onSearch={() => setSearching(true)} />
      <div
        className={cn('mx-auto grid max-w-352 border-x', slug && 'lg:grid-cols-(--cols-lead-62)')}
        style={{ minHeight: 'calc(100svh - 3rem)' }}
      >
        {slug && (
          <aside className="hidden border-r px-4 py-8 lg:block">
            <div className="sticky top-20 max-h-screen-inset-lg overflow-y-auto">
              <DocsNav slug={slug} />
            </div>
          </aside>
        )}
        <main className="min-w-0">
          {slug === CHANGELOG_SLUG ? (
            <Changelog />
          ) : page ? (
            <Article page={page} />
          ) : (
            <Landing onSearch={() => setSearching(true)} />
          )}
        </main>
      </div>
      <SearchDialog
        key={query.get('q') ?? ''}
        open={searching}
        onOpenChange={setSearching}
        initial={query.get('q') ?? ''}
        go={go}
      />
    </div>
  )
}
