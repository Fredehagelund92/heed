import * as React from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpRightIcon,
  BookOpenIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  FileTextIcon,
  PlugIcon,
  SearchIcon,
  TextQuoteIcon,
  PenLineIcon,
} from 'lucide-react'
import { cn } from 'cn'
import { StateLine } from '@/components/heed/bits'
import { Logo } from '@/components/heed/logo'
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
import { AGENT_TOOLS, CHECKS, PROMPT } from '@/data/agents'
import { setupSteps } from '@/data/inbox'
import { kindHint, kindLabel, type Kind } from '@/data/world'
import {
  ANSWER_LINES,
  DOC_GROUPS,
  DOC_PAGES,
  llmsTxt,
  SUPPORT_EMAIL,
  WORDS,
  type DocPage,
} from '@/lib/help-content'
import { navigate, useRoute } from '@/lib/router'

// The documentation site, drawn inside the mockup so the whole thing clicks. In the product it is its own
// site (public, searchable, readable by agents); it shares the answer lines and words with Help.

const base = '/docs'
const guideHref = (slug: string) => `#${base}/${slug}`

/* ---------- article content ---------- */

type Block =
  | { t: 'p'; text: React.ReactNode }
  | { t: 'h2'; text: string }
  | { t: 'steps'; items: React.ReactNode[] }
  | { t: 'list'; items: React.ReactNode[] }
  | { t: 'code'; text: string; label: string }
  | { t: 'note'; title: string; text: React.ReactNode }
  | { t: 'lines' }
  | { t: 'words' }
  | { t: 'tools' }

const b = (text: string) => <strong className="font-medium">{text}</strong>

// Every page is written from the same sources as the app: the setup steps, the connect prompt and
// its checks, the kinds, the answer lines, the words and the tools. A change there changes here.
const ARTICLES: Record<string, { lead: string; blocks: Block[] }> = {
  'get-started': {
    lead: 'From an empty workspace to a first answer from what you wrote, in about ten minutes. The Inbox keeps these five steps until they are done.',
    blocks: [
      { t: 'h2', text: 'The five steps' },
      {
        t: 'steps',
        items: setupSteps.map((st) => (
          <>
            {b(st.title)}. {st.description}
          </>
        )),
      },
      { t: 'h2', text: 'Your first answer' },
      {
        t: 'p',
        text: 'Ask about what you wrote. The answer starts with an answer line, such as Checked, and cites your context item. If it says Not found, nothing applies to that question yet: that is the honest answer, not an error.',
      },
      {
        t: 'note',
        title: 'It can wait',
        text: 'Connecting your definitions is the last step on purpose. Context works without it; metric names just arrive by themselves once it is done.',
      },
    ],
  },
  'connect-an-agent': {
    lead: 'Connect Claude, Cursor or another agent, so it reads your published context before it answers a question about the numbers.',
    blocks: [
      { t: 'h2', text: 'Before you start' },
      {
        t: 'p',
        text: 'You need to be signed in. Anyone in the workspace can connect their own agent. It reads only context an owner has published, never drafts or comments.',
      },
      { t: 'h2', text: 'Paste the prompt' },
      {
        t: 'steps',
        items: [
          <>
            Open {b('Settings')}, then {b('Agents and access')}.
          </>,
          <>Press {b('Copy prompt')} and paste it into your agent.</>,
          "Let the agent run it. It adds the connection, writes one line into the project's instructions file (CLAUDE.md if there is one, otherwise AGENTS.md), and tells you how to sign in. It never asks for a key.",
        ],
      },
      { t: 'code', label: 'The prompt, exactly as the app shows it', text: PROMPT },
      { t: 'h2', text: 'Approve it once' },
      {
        t: 'p',
        text: "Your browser opens a screen that names the agent and what it can do: read published context, and send a report or a suggestion after you say yes. Choose Allow. The page says Connected, with the agent's name and yours, and it joins Connected agents.",
      },
      {
        t: 'note',
        title: 'Cursor and VS Code',
        text: "They have one-click install links on the same page. Claude's app and ChatGPT take the address as a connector; their steps are under Prefer to do it by hand.",
      },
      { t: 'h2', text: 'If nothing signs in' },
      {
        t: 'p',
        text: 'The page checks every few seconds. After two minutes it shows what usually helps, and after ten it stops, with Check again:',
      },
      { t: 'list', items: CHECKS },
      {
        t: 'note',
        title: 'Revoking',
        text: 'Revoke an agent from Connected agents. It signs out at once, and you can connect it again.',
      },
    ],
  },
  'write-context': {
    lead: 'What a context item is, what to put in it, and the line that stops an agent from reading a cause into it.',
    blocks: [
      { t: 'h2', text: 'What a context item is' },
      { t: 'p', text: WORDS.find(([w]) => w === 'Context item')![1] },
      { t: 'h2', text: 'The four kinds' },
      {
        t: 'list',
        items: (Object.keys(kindLabel) as Kind[]).map((k) => (
          <>
            {b(kindLabel[k])}: {kindHint[k]}
          </>
        )),
      },
      { t: 'p', text: 'Most of the time the kind is read from the dates, so you rarely pick one.' },
      { t: 'h2', text: 'What to put in it' },
      {
        t: 'steps',
        items: [
          'A title that is one plain sentence, with its date.',
          'What agents should know: two or three sentences, with what it is not if people mix it up.',
          'Where and when it applies: the metrics and markets, and the dates.',
          'A source anyone can open, and a check date.',
          "Don't conclude: the one line that stops an agent from reading a cause into it.",
        ],
      },
      {
        t: 'note',
        title: 'About our business',
        text: 'A short text every agent reads first, in Settings, General: what the business is, words that are easy to misread, and house rules for reading numbers. No figures or customer names.',
      },
    ],
  },
  'review-a-suggestion': {
    lead: "A suggestion waits in its owner's Inbox. The quick view says what changes; the review is where you decide.",
    blocks: [
      { t: 'h2', text: 'The quick view' },
      {
        t: 'p',
        text: 'Select a suggestion in the Inbox to see what changes, who sent it, and anything that needs care, such as claims to check. Review opens the full screen.',
      },
      { t: 'h2', text: 'The review' },
      {
        t: 'list',
        items: [
          'The change, one block per kind of change: wording, formatting, a link, the order, dates.',
          'Try it: what agents will say with the draft, and what they say now.',
          "The Ready line, which never says more than was checked: new numbers in an edit say they aren't checked against the source.",
          'Publish, or Return with a note: the note is the first comment, and the sender answers there.',
        ],
      },
      { t: 'h2', text: 'Publishing several' },
      {
        t: 'p',
        text: "Publish the ones you've read takes only suggestions you read: the whole change on screen for a few seconds, or Mark as read. It lists them first, and Undo puts them all back.",
      },
      {
        t: 'note',
        title: 'Keys',
        text: 'J and K move through the queue, N and P through the changes, Command and Enter publishes, and ? lists them all.',
      },
    ],
  },
  'definitions-and-synonyms': {
    lead: "Metrics and dimensions, the business's own terms, and other names for them.",
    blocks: [
      { t: 'h2', text: 'Metrics and dimensions' },
      {
        t: 'p',
        text: 'They come from where your metrics are defined, and are read-only here: their name, meaning and other names belong to that source. Write context about them instead.',
      },
      { t: 'h2', text: 'Terms and synonyms' },
      { t: 'p', text: WORDS.find(([w]) => w === 'Synonym')![1] },
      {
        t: 'list',
        items: [
          'A term is a word with its own meaning, such as Peak season.',
          'On a definition, type other names into Also called: a comma or Enter makes each one a tag.',
          "In a term's editor, Another name for points the word at a metric or a dimension.",
          'A word that already means something else says who has it, and is never saved twice.',
        ],
      },
    ],
  },
  'domains-and-owners': {
    lead: 'Who publishes what, how to add a domain, and the sandbox.',
    blocks: [
      { t: 'h2', text: 'Domains' },
      { t: 'p', text: WORDS.find(([w]) => w === 'Domain')![1] },
      { t: 'h2', text: 'Owners' },
      { t: 'p', text: WORDS.find(([w]) => w === 'Owner')![1] },
      {
        t: 'list',
        items: [
          'Admins do everything, including roles and invitations.',
          "An owner who isn't an admin edits their own domain and adds owners to it.",
          'A domain with no context can be deleted; the sandbox never reaches agents.',
        ],
      },
    ],
  },
  integrations: {
    lead: 'Connect where metrics are defined and where documents live, and what is read from each.',
    blocks: [
      { t: 'h2', text: 'Definitions' },
      {
        t: 'p',
        text: 'Metric and dimension names arrive from the tool where they are defined, and stay read-only. When a definition changes there, the context that relies on it comes back to its owners to check.',
      },
      { t: 'h2', text: 'Documents' },
      {
        t: 'p',
        text: "A folder shared with a service account, or Markdown in a repository. A read never publishes: each document becomes a suggestion in its owners' Inbox.",
      },
      { t: 'h2', text: 'Figures in Ask' },
      {
        t: 'p',
        text: 'Off by default. Switched on per integration, Ask shows one figure, read when asked and kept nowhere, with its source, how fresh it is, and the data contact who hears about a figure that looks wrong.',
      },
    ],
  },
  'how-agents-use-it': {
    lead: 'Published context only, one answer line first, and what happens when nothing is written down.',
    blocks: [
      { t: 'h2', text: 'What an agent reads' },
      {
        t: 'list',
        items: [
          'Only what an owner published. A suggestion changes nothing until it is published.',
          'Every answer starts with an answer line, in the app and in your own agent.',
          'Not found is said plainly, never filled in.',
        ],
      },
      { t: 'h2', text: 'Following links' },
      {
        t: 'p',
        text: 'An agent can follow a link between context items, definitions and domains, one step at a time, to read what it points to. A retired item is never followed, and following never changes what an answer includes. Admins can switch it off in Agents and access.',
      },
      { t: 'h2', text: 'Agents offer, people decide' },
      {
        t: 'p',
        text: 'When something is missing or wrong, an agent offers to tell the owner, and sends only after the person says yes.',
      },
    ],
  },
  'answer-lines': {
    lead: 'Every answer, in the app and in your own agent, starts with one of six lines. Each says what the answer rests on, and what it asks of you.',
    blocks: [
      { t: 'h2', text: 'The six lines' },
      { t: 'lines' },
      { t: 'h2', text: 'Words' },
      { t: 'words' },
      {
        t: 'note',
        title: 'One list',
        text: 'Help in the app shows the same lines and words, from the same source. If one changes, both change.',
      },
    ],
  },
  privacy: {
    lead: 'What is kept about the questions agents ask, what is never kept, and who can see a chat.',
    blocks: [
      { t: 'h2', text: "What agents' questions leave behind" },
      {
        t: 'p',
        text: 'Only what a question was about, and how often. Never the words, and never who asked.',
      },
      { t: 'h2', text: 'What is kept with a name' },
      {
        t: 'p',
        text: "Words are kept only when a person sends something on purpose: a suggestion or a report. They carry that person's name, so the owner knows who to ask.",
      },
      { t: 'h2', text: 'Comments and chats' },
      {
        t: 'p',
        text: 'Comments are for people: agents never read or write them. Your chats in Ask are yours, and only you can see them.',
      },
    ],
  },
  tools: {
    lead: 'The six tools an agent can call. All read, apart from the two that send something to an owner after the person says yes.',
    blocks: [
      { t: 'tools' },
      {
        t: 'note',
        title: 'Switching tools off',
        text: 'Admins switch tools off in Agents and access, Tools and access keys. Following links has its own switch.',
      },
    ],
  },
}

const articleOf = (p: DocPage) => ARTICLES[p.slug] ?? { lead: p.line, blocks: [] }

/* ---------- parts ---------- */

function DocsHeader({ onSearch }: { onSearch: () => void }) {
  const { path } = useRoute()
  const tabs = [
    {
      label: 'Guides',
      href: `#${base}`,
      on:
        path === base ||
        (path.startsWith(`${base}/`) && !path.endsWith('/tools') && !path.endsWith('/changelog')),
    },
    {
      label: 'Reference',
      href: guideHref('tools'),
      on: path.endsWith('/tools'),
    },
    {
      label: "What's new",
      href: guideHref('changelog'),
      on: path.endsWith('/changelog'),
    },
  ]
  return (
    <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm supports-backdrop-filter:bg-background/70">
      <div className="mx-auto flex h-12 max-w-[88rem] items-center gap-4 px-4 md:px-6">
        <a
          href={`#${base}`}
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
            href="#/inbox"
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
        href={guideHref('changelog')}
        className="rounded-md px-2 py-1.5 font-medium hover:bg-muted"
      >
        What's new
      </a>
    </nav>
  )
}

function Code({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <figure className="overflow-hidden rounded-frame border">
      <figcaption className="flex items-center justify-between border-b bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] px-4 py-2 text-xs text-muted-foreground">
        {label}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(text).catch(() => undefined)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          }}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </figcaption>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[13px] leading-6 whitespace-pre-wrap">
        {text}
      </pre>
    </figure>
  )
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function ArticleBody({ blocks }: { blocks: Block[] }) {
  return (
    <div className="flex flex-col gap-4 text-[15px] leading-7">
      {blocks.map((b, i) => {
        if (b.t === 'h2')
          return (
            <h2
              key={i}
              id={slugify(b.text)}
              className="mt-6 scroll-mt-20 text-xl leading-snug font-semibold tracking-tight first:mt-0"
            >
              {b.text}
            </h2>
          )
        if (b.t === 'p')
          return (
            <p key={i} className="text-pretty text-foreground/85">
              {b.text}
            </p>
          )
        if (b.t === 'steps')
          return (
            <ol key={i} className="flex flex-col gap-3">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-3">
                  <span className="mt-1 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground tabular-nums">
                    {j + 1}
                  </span>
                  <span className="min-w-0 text-pretty text-foreground/85">{it}</span>
                </li>
              ))}
            </ol>
          )
        if (b.t === 'list')
          return (
            <ul key={i} className="flex list-disc flex-col gap-2 pl-5 marker:text-muted-foreground">
              {b.items.map((it, j) => (
                <li key={j} className="text-pretty text-foreground/85">
                  {it}
                </li>
              ))}
            </ul>
          )
        if (b.t === 'words')
          return (
            <dl
              key={i}
              className="grid gap-px overflow-hidden rounded-frame border bg-border sm:grid-cols-2"
            >
              {WORDS.map(([w, d]) => (
                <div key={w} className="bg-background px-4 py-3">
                  <dt className="text-sm font-medium">{w}</dt>
                  <dd className="mt-0.5 text-sm leading-6 text-muted-foreground">{d}</dd>
                </div>
              ))}
            </dl>
          )
        if (b.t === 'tools')
          return (
            <div key={i} className="overflow-hidden rounded-frame border">
              {AGENT_TOOLS.map((tool) => (
                <section key={tool.name} className="border-t px-4 py-3.5 first:border-t-0">
                  <h3 className="font-mono text-sm font-medium">{tool.name}</h3>
                  <p className="mt-0.5 text-sm leading-6 text-foreground/85">{tool.what}</p>
                  <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm leading-6">
                    <dt className="text-muted-foreground">Takes</dt>
                    <dd>{tool.takes}</dd>
                    <dt className="text-muted-foreground">Returns</dt>
                    <dd>{tool.returns}</dd>
                  </dl>
                </section>
              ))}
            </div>
          )
        if (b.t === 'code') return <Code key={i} label={b.label} text={b.text} />
        if (b.t === 'note')
          return (
            <aside
              key={i}
              className="rounded-frame border bg-[color-mix(in_oklab,var(--muted)_45%,var(--background))] px-4 py-3 text-sm leading-6"
            >
              <strong className="font-medium">{b.title}. </strong>
              <span className="text-foreground/85">{b.text}</span>
            </aside>
          )
        return (
          <div key={i} className="overflow-hidden rounded-frame border">
            {ANSWER_LINES.map((a) => (
              <div
                key={a.state}
                className="grid gap-x-6 gap-y-1.5 border-t px-4 py-3.5 first:border-t-0 md:grid-cols-[14rem_minmax(0,1fr)]"
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
      })}
    </div>
  )
}

function Toc({ blocks }: { blocks: Block[] }) {
  const heads = blocks.filter((b): b is Extract<Block, { t: 'h2' }> => b.t === 'h2')
  return (
    <nav aria-label="On this page" className="text-sm">
      <div className="mb-2 font-medium">On this page</div>
      <ul className="flex flex-col border-l">
        {heads.map((h, i) => (
          <li key={h.text}>
            <a
              href={`#${base}`}
              onClick={(e) => (
                e.preventDefault(),
                document.getElementById(slugify(h.text))?.scrollIntoView({ behavior: 'smooth' })
              )}
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
  const art = articleOf(page)
  const i = DOC_PAGES.findIndex((p) => p.slug === page.slug)
  const prev = DOC_PAGES[i - 1]
  const next = DOC_PAGES[i + 1]
  const heads = art.blocks.filter((b): b is Extract<Block, { t: 'h2' }> => b.t === 'h2')
  return (
    <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_14rem]">
      <article className="min-w-0 px-4 py-8 md:px-10 md:py-10 lg:px-14">
        <div className="mx-auto max-w-[44rem]">
          <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted-foreground">
            <a href={`#${base}`} className="hover:text-foreground">
              Docs
            </a>
            <span className="mx-1.5" aria-hidden>
              /
            </span>
            <span>{page.group}</span>
          </nav>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.02em] text-balance">
              {page.title}
            </h1>
            {page.slug === 'connect-an-agent' && (
              <a
                href="#/settings/agents"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <PlugIcon />
                Open Agents and access
                <ArrowUpRightIcon />
              </a>
            )}
          </div>
          <p className="mt-3 mb-8 text-lg leading-7 text-pretty text-muted-foreground">
            {art.lead}
          </p>
          {/* On a phone the right-hand list folds into one row under the title. */}
          <details className="mb-8 rounded-frame border text-sm lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-medium">
              On this page
              <ChevronDownIcon className="size-4 text-muted-foreground" aria-hidden />
            </summary>
            <ul className="border-t px-3 py-2">
              {heads.map((h) => (
                <li key={h.text} className="py-1 text-muted-foreground">
                  {h.text}
                </li>
              ))}
            </ul>
          </details>
          <ArticleBody blocks={art.blocks} />
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
              href={`mailto:${SUPPORT_EMAIL}`}
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
          <Toc blocks={art.blocks} />
        </div>
      </aside>
    </div>
  )
}

function Landing({ onSearch }: { onSearch: () => void }) {
  const start = ['get-started', 'connect-an-agent', 'write-context'].map((s) =>
    DOC_PAGES.find((p) => p.slug === s)!,
  )
  const icons = [BookOpenIcon, PlugIcon, PenLineIcon]
  return (
    <div className="min-w-0">
      <div className="px-4 py-10 md:px-10 md:py-14 lg:px-14">
        <div className="max-w-2xl">
          <h1 className="text-[2.5rem] leading-[1.05] font-bold tracking-[-0.025em] text-balance">
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
          const Icon = icons[i]
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
                      {p.mins} min
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
            href="#/help"
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
          <a
            className="underline underline-offset-4 hover:text-foreground"
            href={`mailto:${SUPPORT_EMAIL}`}
          >
            Contact support
          </a>
        </span>
        <span>
          Agents can read these pages as plain text at{' '}
          <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
            /docs/llms.txt
          </code>
        </span>
      </div>
    </div>
  )
}

function Changelog() {
  const items = [
    [
      '23 Oct',
      'Help in one place',
      'One Help menu in the sidebar, a short Help page, a card on every answer line, and ? for the keys.',
    ],
    [
      '23 Oct',
      'Agents can follow links',
      'An agent can follow a link between context items, definitions and domains, one step at a time. Related shows the same.',
    ],
    [
      '22 Oct',
      'Synonyms are tags',
      'Type other names for a definition and a comma; a word that already means something else says who has it.',
    ],
    [
      '22 Oct',
      'Event, Warning, Rule and Guide',
      'The four kinds of context have short, plain names.',
    ],
    [
      '21 Oct',
      'The review waits while you type',
      "Single keys never act in a note, offline publishing waits, and Publish the ones you've read lists them first.",
    ],
    [
      '20 Oct',
      'Connect an agent with one prompt',
      "A live line shows waiting, then Connected, with the agent's name and yours.",
    ],
  ]
  return (
    <article className="min-w-0 px-4 py-8 md:px-10 md:py-10 lg:px-14">
      <div className="mx-auto max-w-[44rem]">
        <h1 className="text-[2rem] leading-[1.1] font-bold tracking-[-0.02em]">What's new</h1>
        <p className="mt-3 mb-8 text-lg leading-7 text-muted-foreground">
          Changes people notice, newest first.
        </p>
        <ol className="border-l">
          {items.map(([d, t, l]) => (
            <li key={t} className="relative pb-8 pl-6 last:pb-0">
              <span
                className="absolute top-2 -left-[3px] size-1.5 rounded-full bg-foreground"
                aria-hidden
              />
              <div className="text-xs text-muted-foreground tabular-nums">{d}</div>
              <h2 className="text-base font-semibold">{t}</h2>
              <p className="mt-1 text-[15px] leading-7 text-foreground/85">{l}</p>
            </li>
          ))}
        </ol>
      </div>
    </article>
  )
}

function SearchDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initial: string
}) {
  const [value, setValue] = React.useState(initial)
  const go = (fn: () => void) => () => (onOpenChange(false), fn())
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search the docs"
      description="Search guides, answer lines and words"
    >
      <Command>
        <CommandInput placeholder="Search the docs" value={value} onValueChange={setValue} />
        <CommandList>
          <CommandEmpty>Nothing found. Try another word, or contact support.</CommandEmpty>
          <CommandGroup heading="Guides">
            {DOC_PAGES.map((p) => (
              <CommandItem
                key={p.slug}
                value={p.title}
                onSelect={go(() => navigate(`${base}/${p.slug}`))}
              >
                <FileTextIcon />
                <span className="min-w-0 flex-1 truncate">{p.title}</span>
                <span className="text-xs text-muted-foreground max-sm:hidden">{p.group}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup className="border-t" heading="Words">
            {WORDS.map(([w]) => (
              <CommandItem
                key={w}
                value={`${w} (word)`}
                onSelect={go(() => navigate(`${base}/answer-lines`))}
              >
                <TextQuoteIcon />
                <span className="min-w-0 flex-1 truncate">{w}</span>
                <span className="text-xs text-muted-foreground max-sm:hidden">Word</span>
              </CommandItem>
            ))}
          </CommandGroup>
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

export function DocsSite() {
  const { parts, query } = useRoute()
  const slug = parts[1]
  // Help's "Search the documentation" arrives with its term: the search opens with it.
  const [searching, setSearching] = React.useState(
    query.get('open') === 'search' || !!query.get('q'),
  )
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearching((o) => !o)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])
  const page = DOC_PAGES.find((p) => p.slug === slug)
  // The plain-text index for agents: no page around it, as a text file would be.
  if (slug === 'llms.txt')
    return (
      <pre className="min-h-svh bg-background p-6 font-mono text-sm leading-6 whitespace-pre-wrap text-foreground">
        {llmsTxt()}
      </pre>
    )
  return (
    <div className="min-h-svh bg-background text-foreground">
      <DocsHeader onSearch={() => setSearching(true)} />
      <div
        className={cn(
          'mx-auto grid max-w-[88rem] border-x',
          slug && 'lg:grid-cols-[15.5rem_minmax(0,1fr)]',
        )}
        style={{ minHeight: 'calc(100svh - 3rem)' }}
      >
        {slug && (
          <aside className="hidden border-r px-4 py-8 lg:block">
            <div className="sticky top-20 max-h-[calc(100svh-6rem)] overflow-y-auto">
              <DocsNav slug={slug} />
            </div>
          </aside>
        )}
        <main className="min-w-0">
          {slug === 'changelog' ? (
            <Changelog />
          ) : page ? (
            <Article page={page} />
          ) : (
            <Landing onSearch={() => setSearching(true)} />
          )}
        </main>
      </div>
      <SearchDialog open={searching} onOpenChange={setSearching} initial={query.get('q') ?? ''} />
    </div>
  )
}
