import * as React from 'react'
import {
  ArrowRightLeftIcon,
  ArrowUpRightIcon,
  BookmarkIcon,
  CheckIcon,
  CircleCheckIcon,
  InboxIcon,
  KeyRoundIcon,
  LayersIcon,
  MessageSquareIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  WifiOffIcon,
} from '@/components/icons'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Frame, FrameSection } from '@/components/heed/frame'
import { WordDiff } from '@/components/heed/bits'
import { DomainDot } from '@/components/heed/tag-chip'
import { LineChart } from '@/components/obs/charts'
import { Kpi } from '@/components/obs/controls'
import { ResultIcon } from '@/components/obs/result'
import { ReadingLine } from '@/components/heed/reading'
import { useQuery } from '@tanstack/react-query'
import type { SavedCheck } from '@/api'
import { savedCheckQuery, useWrite } from '@/api/queries'
import { savedCounts, type SavedQuestion, type SavedResult } from '@/model/saved-questions'
import { useSavedQuestions } from '@/api/queries'
import type { DomainId } from '@/model/items'
import { OBS_PURPOSE, useObsPageQuery, useObsView } from '@/lib/obs'
import { href, setQuery, useRoute } from '@/lib/router'
import { useOnline } from '@/lib/send'
import { useDomainList, useDomains, useMe } from '@/lib/workspace'
import { ObsPage } from '@/pages/observability'

// Quality: the one list of saved questions and how each answers after the last change. Needs a look
// first, then Changed, then Same; before and now in place; Open the item or Keep the new answer. The
// check is free and the same every time: it runs after a publish, an archive, a restore, a sync or
// a check date passing, or on Check now. The heavy checks (wording, with and without context, other
// models) need a model key and live in Settings, Advanced. Drift is announced by Alerts, not here.

const TREND = {
  labels: ['1 Sep', '8 Sep', '15 Sep', '22 Sep', '29 Sep', '6 Oct', '13 Oct', '20 Oct'],
  same: [11, 12, 11, 12, 12, 11, 11, 9],
}
const GROUPS: { result: SavedResult; title: string; icon: typeof CheckIcon }[] = [
  { result: 'look', title: 'Needs a look', icon: TriangleAlertIcon },
  { result: 'changed', title: 'Changed', icon: ArrowRightLeftIcon },
  { result: 'same', title: 'Same', icon: CircleCheckIcon },
]

export function QualityPage() {
  // A check that stands elsewhere (running, failed) starts the page afresh.
  const check = useQuery(savedCheckQuery()).data
  const page = useObsPageQuery('quality').data
  return (
    <ObsPage section="quality">
      {check && page && <Quality key={JSON.stringify(check)} run={check} />}
    </ObsPage>
  )
}

function Quality({ run }: { run: SavedCheck }) {
  const domains = useDomains()
  const domainIds = useDomainList().map((d) => d.id)
  const view = useObsView()
  const me = useMe()
  const { query } = useRoute()
  const online = useOnline()
  const all = useSavedQuestions()
  const [checking, setChecking] = React.useState(run.run === 'running')
  // How far a check has got: one saved question at a time ("5 of 12").
  const [checked, setChecked] = React.useState(run.checked)
  const timer = React.useRef(0)
  React.useEffect(() => () => window.clearInterval(timer.current), [])
  const [failed, setFailed] = React.useState(run.run === 'failed')
  const [checkedAt, setCheckedAt] = React.useState('Today, 09:41')
  const [showAll, setShowAll] = React.useState(false)
  // Owners see the domains they own; anyone can narrow to one.
  const asked = query.get('domain')
  const own = view.owned
  const domain = own
    ? asked && own.includes(asked)
      ? asked
      : own.length === 1
        ? own[0]
        : undefined
    : (asked ?? undefined)
  const mine = all.filter(
    (q) => (!own || own.includes(q.domain)) && (!domain || q.domain === domain),
  )
  const shown = mine
  const c = savedCounts(shown)
  const empty = view.state === 'empty' || shown.length === 0

  const check = () => {
    setChecking(true)
    setFailed(false)
    setChecked(0)
    let n = 0
    window.clearInterval(timer.current)
    timer.current = window.setInterval(() => {
      n += 1
      setChecked(n)
      if (n < c.total) return
      window.clearInterval(timer.current)
      setChecking(false)
      setCheckedAt('Just now')
      toast(`Checked ${c.total} saved questions`, {
        description: 'Nothing is published by a check. The results below are as of now.',
      })
    }, 130)
  }

  const domainChoices = own ?? domainIds.filter((d) => !domains[d]?.sandbox)
  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      {domainChoices.length > 1 && (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" className="h-8 gap-1.5 font-normal" />}
          >
            <LayersIcon className="size-3.5" />
            <span className="sr-only">Domain: </span>
            {domain ? domains[domain]?.name : 'All domains'}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Domain</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={domain ?? 'all'}
                onValueChange={(v) => setQuery({ domain: v === 'all' ? undefined : (v as string) })}
              >
                <DropdownMenuRadioItem value="all">All domains</DropdownMenuRadioItem>
                {domainChoices.map((d) => (
                  <DropdownMenuRadioItem key={d} value={d}>
                    {domains[d]?.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <AddQuestion domains={domainChoices} me={me.name} />
      <Button
        variant="outline"
        size="sm"
        aria-disabled={!online || undefined}
        loading={checking}
        loadingLabel="Checking…"
        aria-description={!online ? "Off while you're offline. The last results stay." : undefined}
        title={!online ? "Off while you're offline. The last results stay." : undefined}
        onClick={() => online && !checking && check()}
      >
        <RefreshCwIcon data-icon="inline-start" />
        Check now
      </Button>
    </div>
  )

  if (empty)
    return (
      <Frame>
        <FrameSection title="Quality" description={OBS_PURPOSE.quality} />
        <Empty className="border-t py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookmarkIcon />
            </EmptyMedia>
            <EmptyTitle>No saved questions yet</EmptyTitle>
            <EmptyDescription>
              Save a question from an answer in Ask, or from a gap's draft in the Inbox. Every
              change is then checked against it, and the result shows here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex-row justify-center">
            <a href="/ask" className={cn(buttonVariants())}>
              <MessageSquareIcon data-icon="inline-start" />
              Ask a question
            </a>
            <a href="/inbox" className={cn(buttonVariants({ variant: 'outline' }))}>
              <InboxIcon data-icon="inline-start" />
              Open the Inbox
            </a>
          </EmptyContent>
        </Empty>
      </Frame>
    )

  return (
    <Frame>
      <FrameSection title="Quality" description={OBS_PURPOSE.quality} action={actions} />
      {checking && (
        <div className="border-t px-4 py-3 md:px-5">
          <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span role="status" className="sr-only">
              Checking {c.total} saved questions. Nothing is published.
            </span>
            <ReadingLine running className="text-sm">
              <span aria-hidden>
                Checking saved questions, {Math.min(checked, c.total)} of {c.total}
              </span>
            </ReadingLine>
            <span aria-hidden className="text-xs text-muted-foreground">
              Nothing is published.
            </span>
          </p>
          <span aria-hidden className="mt-2 block h-0.75 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full origin-left bg-primary transition-transform duration-(--dur-2)"
              style={{ transform: `scaleX(${Math.min(1, checked / Math.max(1, c.total))})` }}
            />
          </span>
        </div>
      )}
      {failed && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 border-t bg-warn/8 px-4 py-3 text-sm md:px-5"
        >
          <WifiOffIcon className="size-4 shrink-0 text-[var(--warn)]" aria-hidden />
          <span className="min-w-0 flex-1">
            The check did not finish. It stopped after 8 of {c.total} questions. Nothing was
            changed, and agents still get what was published.
          </span>
          <Button size="sm" variant="outline" onClick={check}>
            Try again
          </Button>
        </div>
      )}
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        <Kpi
          icon={<BookmarkIcon />}
          label="Saved questions"
          value={c.total}
          sub={`in ${c.domains} ${c.domains === 1 ? 'domain' : 'domains'}`}
        />
        <Kpi icon={<CircleCheckIcon />} label="Same" value={c.same} sub="answer as saved" />
        <Kpi
          icon={<ArrowRightLeftIcon />}
          label="Changed"
          value={c.changed}
          sub="answers moved, not worse"
        />
        <Kpi icon={<TriangleAlertIcon />} label="Needs a look" value={c.look} sub="got worse" />
      </div>
      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-(--cols-split-3-2)">
        <div>
          {GROUPS.map((g) => {
            const qs = shown.filter((q) => q.result === g.result)
            if (!qs.length) return null
            const list = g.result === 'same' && !showAll ? qs.slice(0, 3) : qs
            return (
              <section key={g.result} aria-label={g.title}>
                <h2 className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2 text-sm font-semibold md:px-5">
                  <g.icon className="size-3.5 text-muted-foreground" aria-hidden />
                  {g.title}
                  <span className="ml-auto font-medium text-muted-foreground tabular-nums">
                    {qs.length}
                  </span>
                </h2>
                <ul>
                  {list.map((q) => (
                    <QuestionRow
                      key={q.id}
                      q={q}
                      checkedAt={checkedAt}
                      canChange={me.admin || me.owns.includes(q.domain)}
                    />
                  ))}
                </ul>
                {g.result === 'same' && qs.length > 3 && (
                  <button
                    type="button"
                    className="w-full border-b px-4 py-2.5 text-left text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline md:px-5"
                    onClick={() => setShowAll((s) => !s)}
                  >
                    {showAll ? 'Show fewer' : `Show ${qs.length - 3} more`}
                  </button>
                )}
              </section>
            )
          })}
        </div>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
          <FrameSection
            title="Answer the same, by week"
            description="Saved questions that answer as saved after each week's last publish."
          >
            <div className="px-3 pb-3">
              <LineChart
                series={[
                  {
                    name: 'Answer the same',
                    values: TREND.same,
                    color: 'var(--primary)',
                    fill: true,
                  },
                ]}
                labels={TREND.labels}
                max={12}
                caption="Saved questions that answer as saved, by week"
              />
            </div>
          </FrameSection>
          <div className="flex items-start gap-3 border-t px-4 py-4 md:px-5">
            <KeyRoundIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                Check the wording, with and without context, and compare models
              </p>
              <p className="text-dense text-muted-foreground">
                Needs a model key. The free check above already runs after every change.
              </p>
            </div>
            <a
              href="/settings/advanced"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
            >
              <ArrowUpRightIcon data-icon="inline-start" />
              Settings, Advanced
            </a>
          </div>
        </div>
      </div>
    </Frame>
  )
}

function QuestionRow({
  q,
  checkedAt,
  canChange,
}: {
  q: SavedQuestion
  checkedAt: string
  canChange: boolean
}) {
  const domains = useDomains()
  const write = useWrite()
  const open = (
    <a
      key="open"
      href={href(`/context/${q.factId}`)}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
    >
      <ArrowUpRightIcon data-icon="inline-start" />
      Open the item
    </a>
  )
  const keep = (
    <Button
      key="keep"
      variant="outline"
      size="sm"
      aria-disabled={!canChange || undefined}
      aria-description={
        canChange ? undefined : 'Owners of the domain and admins keep a new answer.'
      }
      onClick={() => {
        if (!canChange) return
        void write('keepNewAnswer', { id: q.id }).then(({ undo }) => {
          toast('The new answer is its saved one', {
            description: 'It is checked against it from now on.',
            action: { label: 'Undo', onClick: () => void write('undo', { token: undo }) },
          })
        })
      }}
    >
      <CheckIcon data-icon="inline-start" />
      Keep the new answer
    </Button>
  )
  return (
    <li className={cn('flex gap-3 border-b px-4 py-3 md:px-5', q.result === 'look' && 'bg-warn/5')}>
      <ResultIcon result={q.result} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium text-pretty">{q.question}</p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {q.result === 'same' || q.when === 'Just now'
              ? checkedAt === 'Just now'
                ? 'Just now'
                : q.when
              : q.when}
          </span>
        </div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <DomainDot id={q.domain} />
          {domains[q.domain]?.name} - saved by {q.savedBy} - {q.why}
        </p>
        {q.diff && (
          <>
            <div className="mt-2 grid gap-px overflow-hidden rounded-md border bg-border text-sm @lg:grid-cols-2">
              <div className="bg-background px-3 py-2">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Saved answer</p>
                <p className="text-pretty">{q.diff.saved}</p>
              </div>
              <div className="bg-background px-3 py-2">
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Now</p>
                {/* A changed answer marks its words; one that got worse is read whole. */}
                {q.result === 'changed' ? (
                  <WordDiff before={q.diff.saved} after={q.diff.now} />
                ) : (
                  <p className="text-pretty">{q.diff.now}</p>
                )}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {q.result === 'look' ? [open, keep] : [keep, open]}
            </div>
          </>
        )}
      </div>
    </li>
  )
}

/** Add a question by typing it: what it gets now becomes what it should get. */
function AddQuestion({ domains: choices, me }: { domains: DomainId[]; me: string }) {
  const domains = useDomains()
  const write = useWrite()
  const [open, setOpen] = React.useState(false)
  const [q, setQ] = React.useState('')
  const [d, setD] = React.useState<DomainId>(choices[0] ?? 'sales')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon data-icon="inline-start" />
        Add a question
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 max-w-viewport-inset">
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (!q.trim()) return
            void write('saveQuestion', {
              question: {
                question: q.trim(),
                domain: d,
                savedBy: me,
                expect: 'What it gets now, checked against every change.',
                factId: '',
              },
            }).then(() => {
              setOpen(false)
              setQ('')
              toast('Question saved', {
                description: 'What it gets now is what it should keep getting.',
              })
            })
          }}
        >
          <p className="text-sm font-medium">Add a question</p>
          <label className="flex flex-col gap-1.5 text-sm" htmlFor="add-q">
            <span className="text-xs font-semibold text-muted-foreground">
              The question, as an agent might be asked it
            </span>
            <Input
              id="add-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Why did orders in Spain fall in October?"
            />
          </label>
          {choices.length > 1 && (
            <fieldset className="flex flex-wrap gap-1.5">
              <legend className="mb-1.5 text-xs font-semibold text-muted-foreground">Domain</legend>
              {choices.map((x) => (
                <button
                  key={x}
                  type="button"
                  aria-pressed={d === x}
                  onClick={() => setD(x)}
                  className={cn(
                    'rounded-md border px-2 py-1 text-xs',
                    d === x && 'border-primary bg-primary/8 text-foreground',
                  )}
                >
                  {domains[x]?.name}
                </button>
              ))}
            </fieldset>
          )}
          <p className="text-xs text-muted-foreground">
            It is checked now, and what it gets becomes what it should keep getting. It checks what
            agents get, not how an agent words it.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Save question
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  )
}
