import * as React from 'react'
import { useObservability, useReplay } from '@/lib/obs'
import {
  ArrowUpRightIcon,
  CircleCheckIcon,
  ClipboardCheckIcon,
  EyeOffIcon,
  FlagIcon,
  LightbulbIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  PencilLineIcon,
  PlayIcon,
  RouteIcon,
  ScanSearchIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { useQuery } from '@tanstack/react-query'
import { conflictsQuery } from '@/api/queries'
import { DockFrame, DockMissing } from '@/components/dock'
import { StateLine } from '@/components/heed/bits'
import { countedState } from '@/model/ask'
import { ReadingCard } from '@/components/heed/reading'
import { DockStepper } from '@/components/heed/list'
import { BarRows } from '@/components/obs/charts'
import { SaveQuestion } from '@/components/obs/save-question'
import { shownCount, type Counts, type Shown, type Topic, monthName } from '@/model/observability'
import { openDock } from '@/lib/dock'
import { useObsView } from '@/lib/obs'
import { afterAnswer, type ReplayStep, type When } from '@/model/replay'
import { href, setQuery, useRoute } from '@/lib/router'

// The answer panel, opened from a topic: what an agent gets for it now, a replay of the steps an
// agent's request goes through, and what to look at. A replay, not a recording: answering is fixed
// rules with no model, so it runs again on what agents get now, or on what they got before the last
// publish, in about 30 ms. Nothing about the people who asked is kept, so nothing about them shows.

const STEP_ICON: Record<ReplayStep['key'], typeof ScanSearchIcon> = {
  scope: ScanSearchIcon,
  looked: NotebookTextIcon,
  left: EyeOffIcon,
  checked: ClipboardCheckIcon,
  said: MessageSquareIcon,
  next: RouteIcon,
  after: FlagIcon,
}

type Tab = 'overview' | 'steps' | 'warnings'
const strip = (text: string) => text.replace(/\s*\[\d+\]/g, '')

export function AnswerPanel({ id }: { id: string }) {
  const obs = useObservability()
  const t = obs.data.topics.find((x) => x.id === id)
  const view = useObsView()
  const { query } = useRoute()
  const now = useReplay(id, 'now')
  if (t && !now) return null
  if (!t || !now)
    return (
      <DockFrame title="Answer">
        <DockMissing>
          This topic isn't in the list any more. Close the panel and pick another.
        </DockMissing>
      </DockFrame>
    )
  const tab = (
    ['overview', 'steps', 'warnings'].includes(query.get('ptab') ?? '')
      ? query.get('ptab')
      : 'overview'
  ) as Tab
  const when: When = query.get('when') === 'before' ? 'before' : 'now'
  const counts = t.counts
  const asked = t.total
  const warnings = (['missing', 'partial', 'conflict', 'stale'] as Shown[]).filter(
    (s) => t.in.answers.includes(s) || (s === 'missing' && t.in.notFound),
  )
  const question = `What should I know about ${obs.topicName(t)} in ${monthName(t.month)}?`
  const write =
    t.gap?.label === 'Draft ready'
      ? t.gap.href
      : href('/context/new', {
          metric: t.metric,
          market: t.where === 'All markets' ? undefined : t.where,
        })

  return (
    <DockFrame
      title="Answer"
      quietTitle
      actions={<DockStepper list="obs-topics" id={t.id} onGo={(next) => openDock('topic', next)} />}
      footer={
        <>
          <a href={write} className={cn(buttonVariants({ size: 'sm' }))}>
            <PencilLineIcon data-icon="inline-start" />
            Write context for this
          </a>
          <a
            href={href('/ask', { q: question })}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
          >
            <PlayIcon data-icon="inline-start" />
            Try it
          </a>
          {t.domain && <SaveQuestion question={question} domain={t.domain} answer={now.answer} />}
        </>
      }
    >
      <div className="px-4 pt-4 @md:px-5">
        <p className="text-xs text-muted-foreground">
          <span className="font-semibold">Answer</span> - as agents get it now
        </p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight">{obs.topicTitle(t)}</h2>
      </div>
      {/* The replay reads what agents get, as Ask does; a topic opened before shows at once. */}
      <ReadingCard
        seen={`replay:${t.id}`}
        looking="Replaying what agents get…"
        reading={
          now.answer.sources.length
            ? `Reading ${now.answer.sources.length} context ${now.answer.sources.length === 1 ? 'item' : 'items'}…`
            : 'Found no context items'
        }
        className="mt-2 px-4 @md:px-5"
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 px-4 @md:px-5">
          <StateLine state={countedState(now.answer)} className="text-xs" />
          <span className="text-dense text-muted-foreground">
            Asked {asked === null && t.atLeast ? `${t.atLeast}+` : shownCount(asked)} times{' '}
            {view.label}.
            {counts.missing === null
              ? ' How many found nothing is hidden.'
              : counts.missing !== 0
                ? ` ${shownCount(counts.missing)} not found.`
                : ''}
          </span>
        </div>
        <div
          role="tablist"
          aria-label="About this answer"
          className="mt-3 flex gap-1 border-b px-3 @md:px-4"
        >
          {(
            [
              ['overview', 'Overview'],
              ['steps', 'Steps'],
              ['warnings', 'Warnings'],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`ap-tab-${k}`}
              aria-selected={tab === k}
              aria-controls={`ap-panel-${k}`}
              onClick={() => setQuery({ ptab: k === 'overview' ? undefined : k })}
              className={cn(
                '-mb-px flex h-10 items-center gap-1.5 border-b-2 border-transparent px-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                tab === k && 'border-foreground font-medium text-foreground',
              )}
            >
              {label}
              {k === 'warnings' && warnings.length > 0 && (
                <span className="text-xs tabular-nums">{warnings.length}</span>
              )}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          id={`ap-panel-${tab}`}
          aria-labelledby={`ap-tab-${tab}`}
          className="px-4 py-4 @md:px-5"
        >
          {tab === 'overview' && <OverviewTab t={t} />}
          {tab === 'steps' && <StepsTab t={t} when={when} />}
          {tab === 'warnings' && <WarningsTab t={t} counts={counts} />}
        </div>
      </ReadingCard>
    </DockFrame>
  )
}

function OverviewTab({ t }: { t: Topic }) {
  const now = useReplay(t.id, 'now')
  const before = useReplay(t.id, 'before')
  const [compare, setCompare] = React.useState(false)
  if (!now || !before) return null
  const same = strip(now.answer.text) === strip(before.answer.text)
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg bg-muted/60 px-3.5 py-3 text-sm">
        <p className="font-medium">What an agent gets now</p>
        <p className="mt-1 text-pretty">{strip(now.answer.text)}</p>
      </div>
      <div>
        <button
          type="button"
          className="text-sm font-medium underline-offset-4 hover:underline"
          aria-expanded={compare}
          onClick={() => setCompare((c) => !c)}
        >
          {compare
            ? 'Hide the compare'
            : `Compare with what agents got ${before.before.label.toLowerCase()}`}
        </button>
        {compare &&
          (same ? (
            <p className="mt-2 text-sm text-muted-foreground">
              The same {before.before.label.toLowerCase()}: nothing it reads changed.
            </p>
          ) : (
            <div className="mt-2 grid gap-px overflow-hidden rounded-md border bg-border text-sm @md:grid-cols-2">
              <div className="bg-background px-3 py-2.5">
                <p className="text-xs font-semibold text-muted-foreground">{before.before.label}</p>
                <p className="mt-1">{strip(before.answer.text)}</p>
              </div>
              <div className="bg-background px-3 py-2.5">
                <p className="text-xs font-semibold text-muted-foreground">Now</p>
                <p className="mt-1">{strip(now.answer.text)}</p>
              </div>
            </div>
          ))}
      </div>
      {/* The kinds of agent that asked, when the binding has them: a count under 5 is hidden. */}
      {t.agents && t.agents.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Asked by</p>
          <BarRows
            quiet
            caption="Asked by, by kind of agent"
            rows={t.agents.map((a) => ({
              key: a.name,
              name: a.name,
              label: a.name,
              value: a.count ?? 0,
              display: shownCount(a.count),
            }))}
          />
        </div>
      )}
    </div>
  )
}

function StepsTab({ t, when }: { t: Topic; when: When }) {
  const run = useReplay(t.id, when)
  if (!run) return null
  const changed = run.changed
  const steps: ReplayStep[] = [
    ...run.steps,
    { key: 'after', title: 'After the answer', text: afterAnswer(t) },
  ]
  // Where each step starts in the run, for its bar.
  const starts = steps.map((_, i) => steps.slice(0, i).reduce((n, x) => n + (x.ms ?? 0), 0))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-caption-wide text-dense text-muted-foreground">
          This is a replay: it runs the same steps an agent's request runs, with no model. It takes
          about {run.ms} ms.
        </p>
        <div
          role="radiogroup"
          aria-label="Replay on"
          className="flex h-8 items-stretch rounded-md border p-0.5"
        >
          {(
            [
              ['now', 'Now'],
              ['before', run.before.label],
            ] as [When, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={when === k}
              onClick={() => setQuery({ when: k === 'now' ? undefined : k })}
              className={cn(
                'rounded-tile px-2.5 text-dense text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                when === k && 'bg-muted font-medium text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {when === 'before' && !changed.length && (
        <p className="text-dense text-muted-foreground">
          The same steps as now: nothing it reads was published since.
        </p>
      )}
      <ol className="relative flex flex-col">
        {steps.map((s, i) => {
          const Icon = STEP_ICON[s.key]
          const from = starts[i]!
          const isChanged = when === 'before' && changed.includes(s.key)
          return (
            <li key={s.key} className="relative flex gap-3 pb-4 last:pb-0">
              {i < steps.length - 1 && (
                <span aria-hidden className="absolute top-8 bottom-0 left-3.25 w-px bg-border" />
              )}
              <span
                className={cn(
                  'relative z-raised flex size-7 shrink-0 items-center justify-center rounded-full border bg-background text-muted-foreground',
                  s.key === 'checked' && run.answer.state === 'grounded' && 'text-primary',
                  s.key === 'checked' &&
                    (run.answer.state === 'conflict' || run.answer.state === 'stale') &&
                    'text-[var(--warn)]',
                )}
              >
                <Icon className="size-3.5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-baseline justify-between gap-2 text-sm font-medium">
                  <span>
                    {s.title}
                    {isChanged && (
                      <span className="ml-2 rounded-sm bg-primary/10 px-1.5 py-0.5 text-2xs font-medium text-primary">
                        Changed since
                      </span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs font-normal text-muted-foreground tabular-nums">
                    {s.ms !== undefined ? `${s.ms} ms` : 'this week'}
                  </span>
                </p>
                {s.scope && (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                    {s.scope.map((c) => (
                      <span key={c.kind} className="inline-flex items-center gap-1">
                        {c.kind === 'metric' ? 'Metric' : c.kind === 'market' ? 'Market' : 'Dates'}
                        <span className="rounded-md border px-1.5 py-0.5 text-foreground">
                          {c.label}
                        </span>
                      </span>
                    ))}
                  </p>
                )}
                <p className="mt-1 text-dense text-pretty text-muted-foreground">
                  {s.key === 'said' ? `“${s.text}”` : s.text}
                </p>
                {s.items && s.items.length > 0 && (
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {s.items.map((it) => (
                      <li key={it.id} className="text-dense">
                        <a
                          href={href(`/context/${it.id}`)}
                          className="rounded-md border px-1.5 py-0.5 underline-offset-4 hover:underline"
                        >
                          {it.title}
                        </a>
                        {it.why && <span className="text-muted-foreground"> {it.why}.</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {s.ms !== undefined && (
                  <span aria-hidden className="mt-2 block h-1 bg-muted">
                    <span
                      className="ml-(--from) block h-full bg-chart-2"
                      style={
                        {
                          '--from': `${(from / run.ms) * 100}%`,
                          width: `${Math.max(2, (s.ms / run.ms) * 100)}%`,
                        } as React.CSSProperties
                      }
                    />
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function WarningsTab({ t, counts }: { t: Topic; counts: Counts }) {
  const obs = useObservability()
  // The pair agents got for this topic, named, with the way to the comparison (FR-220).
  const name = obs.topicName(t).toLowerCase()
  const pair = (useQuery(conflictsQuery('all')).data ?? []).find(
    (r) => r.topic && name.startsWith(r.topic.toLowerCase()),
  )
  const kinds = (['missing', 'partial', 'conflict', 'stale'] as Shown[]).filter(
    (s) => t.in.answers.includes(s) || (s === 'missing' && t.in.notFound),
  )
  const why: Record<Shown, string> = {
    missing: 'Agents asked and nothing applies.',
    partial: `Agents asked without dates, so ${obs.topicName(t)} was read at today.`,
    conflict: 'Two items that apply say different things. Both are given until an owner chooses.',
    stale: 'An item it answers from has a check date that passed.',
    grounded: '',
  }
  // A hidden count may be one under 5, or one hidden so that none is given away: say neither.
  const times = (n: number | null) => (n === null ? 'a hidden number of times' : `${n} times`)
  if (!kinds.length)
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <CircleCheckIcon className="size-4 text-[var(--ok)]" aria-hidden />
        Nothing to look at: every answer was based on checked context.
      </p>
    )
  return (
    <ul className="flex flex-col divide-y">
      {kinds.map((s) => (
        <li key={s} className="flex gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <StateLine state={s} className="px-1.5 py-0.5 text-xs" />
              <span className="text-muted-foreground">{times(counts[s])}</span>
            </div>
            <p className="text-dense text-muted-foreground">{why[s]}</p>
            {s === 'conflict' && pair && (
              <p className="mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-dense">
                <span className="flex-1">
                  “{pair.holder.title ?? 'An item you cannot read'}” and “
                  {pair.other.title ?? 'An item you cannot read'}”.
                </span>
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0"
                  onClick={() => openDock('conflict', pair.key)}
                >
                  <ArrowUpRightIcon />
                  Compare the two
                </Button>
              </p>
            )}
            {s === 'missing' && t.gap && (
              <p className="mt-2 flex items-center gap-2 rounded-md bg-muted/60 px-2.5 py-2 text-dense">
                <LightbulbIcon className="size-3.5 shrink-0" aria-hidden />
                <span className="flex-1">
                  {t.gap.label === 'Draft ready'
                    ? "A draft is ready in the Inbox, from a payment provider's status page."
                    : 'A suggestion about it waits in the Inbox.'}
                </span>
                <a
                  href={t.gap.href}
                  className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'shrink-0')}
                >
                  <ArrowUpRightIcon />
                  Open
                </a>
              </p>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
