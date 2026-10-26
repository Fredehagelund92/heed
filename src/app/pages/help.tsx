import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  ArrowUpRightIcon,
  EyeOffIcon,
  HandHelpingIcon,
  MessageSquareTextIcon,
  PenLineIcon,
  SearchIcon,
  XIcon,
} from '@/components/icons'
import { StateLine } from '@/components/heed/bits'
import { Frame, FrameFooter, FramePage, FrameSection } from '@/components/heed/frame'
import { Switch } from '@/components/ui/switch'
import { setSlowNetwork, useSlowNetwork } from '@/lib/loading'
import { Page } from '@/components/site-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { open } from '@/lib/events'
import { pageKey } from '@/lib/keys'
import { ANSWER_LINES, DOC_PAGES, DOCS_HOME, SUPPORT_EMAIL, WORDS } from '@/lib/help-content'
import { setQuery, useRoute } from '@/lib/router'

// Help: the product's own words, short enough to read in a minute: the six answer lines, ten words
// and four facts on how agents use what people write. Everything comes from one list
// (lib/help-content.ts) that the answer line's card and the documentation draw from too. A "how do
// I" goes to the documentation, which opens as its own site.

const match = (q: string, ...parts: string[]) =>
  !q || parts.join(' ').toLowerCase().includes(q.toLowerCase())

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ArrowUpRightIcon className="size-3.5" aria-hidden />
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

function HelpSearch({ q, onChange }: { q: string; onChange: (q: string) => void }) {
  const input = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || !pageKey(e)) return
      e.preventDefault()
      input.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="relative">
      <SearchIcon
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={input}
        type="search"
        value={q}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && q && (e.stopPropagation(), onChange(''))}
        placeholder="Search help"
        aria-label="Search help"
        className="h-10 w-full rounded-md border border-input bg-background pr-16 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-search-cancel-button]:hidden"
      />
      {q ? (
        <button
          type="button"
          aria-label="Clear the search"
          onClick={() => onChange('')}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      ) : (
        <Kbd className="absolute top-1/2 right-2.5 -translate-y-1/2 max-md:hidden">/</Kbd>
      )}
    </div>
  )
}

function AnswerLines({ q }: { q: string }) {
  const rows = ANSWER_LINES.filter((a) => match(q, a.label, a.long, a.sentence, a.means, a.todo))
  if (!rows.length) return null
  return (
    <FrameSection
      title="What an answer line means"
      description="Every answer, in Ask and in your own agent, starts with one of these."
    >
      <div className="border-t" role="table" aria-label="Answer lines">
        <div
          role="row"
          className="hidden grid-cols-(--cols-help) gap-x-6 border-b bg-band px-5 py-2 text-xs text-muted-foreground md:grid"
        >
          <span role="columnheader">The line</span>
          <span role="columnheader">What it means</span>
          <span role="columnheader">What you do</span>
        </div>
        <div role="rowgroup">
          {rows.map((a) => (
            <div
              key={a.state}
              role="row"
              className="grid gap-x-6 gap-y-1.5 border-t px-4 py-3.5 first:border-t-0 md:grid-cols-(--cols-help) md:items-start md:px-5"
            >
              <div role="cell">
                <StateLine state={a.state} sentence tip={false} />
              </div>
              <p role="cell" className="text-sm text-pretty text-muted-foreground">
                <span className="font-medium text-foreground">{a.long}.</span> {a.means}
              </p>
              <p role="cell" className="text-sm text-pretty">
                {a.todo}
              </p>
            </div>
          ))}
        </div>
      </div>
    </FrameSection>
  )
}

function Words({ q }: { q: string }) {
  const rows = WORDS.filter(([w, d]) => match(q, w, d))
  if (!rows.length) return null
  return (
    <FrameSection title="Words" description="What this product calls things.">
      <dl className="grid gap-px border-t bg-border md:grid-cols-2">
        {rows.map(([w, d]) => (
          <div key={w} className="bg-background px-4 py-3 md:px-5">
            <dt className="text-sm font-medium">{w}</dt>
            <dd className="mt-0.5 text-sm text-pretty text-muted-foreground">{d}</dd>
          </div>
        ))}
      </dl>
    </FrameSection>
  )
}

const HOW = [
  {
    icon: PenLineIcon,
    lead: 'You write, an owner publishes.',
    rest: 'Agents read only what the owner of a domain has published. A suggestion changes nothing until it is published.',
  },
  {
    icon: MessageSquareTextIcon,
    lead: 'Every answer starts with an answer line.',
    rest: 'It says what the answer rests on, in Ask and in your own agent.',
  },
  {
    icon: HandHelpingIcon,
    lead: 'Agents offer, people decide.',
    rest: 'When something is missing or wrong, an agent offers to tell the owner. It sends only after the person says yes.',
  },
  {
    icon: EyeOffIcon,
    lead: 'What is kept about questions.',
    rest: 'How often a topic was asked about, never the words or who asked. Words are kept only when someone sends a suggestion or a report, with their name.',
  },
]

function HowAgentsUseIt({ q }: { q: string }) {
  const rows = HOW.filter((h) => match(q, h.lead, h.rest, 'agents privacy kept'))
  if (!rows.length) return null
  return (
    <FrameSection
      title="How agents use it"
      description="Four things worth knowing before you write the first line."
    >
      <ul className="border-t">
        {rows.map((h) => (
          <li key={h.lead} className="flex gap-3 border-t px-4 py-3.5 first:border-t-0 md:px-5">
            <h.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-sm text-pretty">
              <span className="font-medium">{h.lead}</span>{' '}
              <span className="text-muted-foreground">{h.rest}</span>
            </p>
          </li>
        ))}
      </ul>
      <div className="border-t px-4 py-3 text-sm md:px-5">
        <Ext href={`${DOCS_HOME}/how-agents-use-it`}>Read how agents use it</Ext>
      </div>
    </FrameSection>
  )
}

function Nothing({ q, onTry }: { q: string; onTry: (q: string) => void }) {
  return (
    <Frame>
      <div className="flex flex-col items-start gap-4 px-5 py-10 sm:items-center sm:text-center">
        <SearchIcon className="size-5 text-muted-foreground" aria-hidden />
        <div className="max-w-md">
          <h2 className="text-base font-medium text-balance">Nothing in Help matches “{q}”</h2>
          <p className="mt-1 text-sm text-pretty text-muted-foreground">
            Help covers the product's own words. For how to do something, search the documentation.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-center">
          <a
            href={`${DOCS_HOME}?q=${encodeURIComponent(q)}`}
            target="_blank"
            rel="noreferrer"
            className={cn(buttonVariants())}
          >
            Search the documentation
            <ArrowUpRightIcon />
          </a>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className={cn(buttonVariants({ variant: 'outline' }))}
          >
            Contact support
          </a>
        </div>
        <p className="text-sm text-muted-foreground">
          Or try{' '}
          {['owner', 'out of date', 'shortcuts'].map((t, i) => (
            <React.Fragment key={t}>
              {i > 0 && ', '}
              <button
                type="button"
                className="underline underline-offset-4 hover:text-foreground"
                onClick={() => onTry(t)}
              >
                {t}
              </button>
            </React.Fragment>
          ))}
        </p>
      </div>
    </Frame>
  )
}

/** A review switch: with it on, each page waits the first time it opens, so its loading can be seen. */
function SlowNetwork() {
  const on = useSlowNetwork()
  return (
    <Frame>
      <div className="flex items-start gap-4 px-4 py-4 md:px-5">
        <div className="min-w-0 flex-1">
          <label htmlFor="slow-network" className="text-sm font-medium">
            Slow network
          </label>
          <p className="mt-0.5 text-sm text-pretty text-muted-foreground">
            Each page waits the first time you open it, and saving takes longer, as on a slow
            connection, so you can see how loading looks. Off by default.
          </p>
        </div>
        <Switch
          id="slow-network"
          checked={on}
          onCheckedChange={(v) => setSlowNetwork(v)}
          className="mt-0.5"
        />
      </div>
    </Frame>
  )
}

export function HelpPage() {
  const { query } = useRoute()
  const [q, setQ] = React.useState(query.get('q') ?? '')
  const nothing =
    q &&
    ![
      ANSWER_LINES.some((a) => match(q, a.label, a.long, a.sentence, a.means, a.todo)),
      WORDS.some(([w, d]) => match(q, w, d)),
      HOW.some((h) => match(q, h.lead, h.rest, 'agents privacy kept')),
      DOC_PAGES.some((p) => match(q, p.title, p.line)),
    ].some(Boolean)
  return (
    <Page title="Help">
      <FramePage>
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
          <HelpSearch q={q} onChange={(v) => (setQ(v), setQuery({ q: v || undefined }))} />
          {nothing ? (
            <Nothing q={q} onTry={(t) => (setQ(t), setQuery({ q: t }))} />
          ) : (
            <Frame>
              <AnswerLines q={q} />
              <Words q={q} />
              <HowAgentsUseIt q={q} />
              {q ? (
                <FrameFooter className="justify-between">
                  <span className="text-sm text-muted-foreground">Not what you were after?</span>
                  <Ext href={`${DOCS_HOME}?q=${encodeURIComponent(q)}`}>
                    Search the documentation
                  </Ext>
                </FrameFooter>
              ) : (
                <FrameFooter className="justify-between">
                  <span className="text-sm text-muted-foreground">Can't find it?</span>
                  <span className="flex flex-wrap items-center gap-2">
                    <a
                      href={`mailto:${SUPPORT_EMAIL}`}
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    >
                      Contact support
                    </a>
                    <Button variant="outline" size="sm" onClick={() => open('report')}>
                      Report a problem
                    </Button>
                    <a
                      href={DOCS_HOME}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
                    >
                      Documentation
                      <ArrowUpRightIcon />
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </span>
                </FrameFooter>
              )}
            </Frame>
          )}
          {!q && <SlowNetwork />}
        </div>
      </FramePage>
    </Page>
  )
}
