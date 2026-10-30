import type { CSSProperties } from 'react'
import { useObservability, useObsPageQuery } from '@/lib/obs'
import type { UsageData } from '@/model/observability'
import {
  ArrowUpRightIcon,
  BotIcon,
  CircleAlertIcon,
  CoinsIcon,
  PlugIcon,
  TimerIcon,
  WrenchIcon,
} from '@/components/icons'
import { cn } from '@/lib/utils'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { buttonVariants } from '@/components/ui/button'
import { Frame, FrameSection } from '@/components/heed/frame'
import { Loadable } from '@/components/heed/load-state'
import { ObsSkeleton } from '@/components/obs/obs-skeleton'
import { LineChart } from '@/components/obs/charts'
import { Kpi, kpiChange, moreOrFewer, RangeSwitch } from '@/components/obs/controls'
import { AGENT_TOOLS } from '@/lib/agents'
import { askedChange, HIDE_UNDER, money, shownCount } from '@/model/observability'
import { OBS_PURPOSE, useObsView } from '@/lib/obs'
import { ObsPage } from '@/pages/observability'

// Usage, for admins: how agents call the tools, how fast they get a reply, which kinds of agent
// call, and what the model costs. Answering an agent needs no model, so the spend is Ask's wording,
// web reads and answer tests, from the ledger, against the caps that stop a feature and say why.
// Agents are counted by kind: the name an agent gives itself maps to a fixed list and is not kept.

const SPEND_FILL = ['var(--primary)', 'var(--chart-3)', 'var(--chart-2)']

export function UsagePage() {
  const load = useObsPageQuery('usage')
  return (
    <ObsPage section="usage">
      <Loadable
        query={load}
        what="the usage"
        skeleton={<ObsSkeleton section="usage" kpis={4} body="table" />}
      >
        <Usage />
      </Loadable>
    </ObsPage>
  )
}

function Usage() {
  const obs = useObservability()
  const view = useObsView()
  if (view.state === 'empty')
    return (
      <Frame>
        <FrameSection title="Usage" description={OBS_PURPOSE.usage} />
        <Empty className="border-t py-12">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <PlugIcon />
            </EmptyMedia>
            <EmptyTitle>No agent has called yet</EmptyTitle>
            <EmptyDescription>
              Connect an agent, and its calls show here by tool and by kind of agent. Ask in the app
              counts toward the model spend.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <a
              href="/settings/agents"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Agents and access
            </a>
          </EmptyContent>
        </Empty>
      </Frame>
    )

  const usage = obs.data.usage!
  const tools = usage.tools
  const calls = tools.reduce((a, t) => a + t.calls, 0)
  const unread = usage.couldNotRead
  const agents = usage.agents
  const speed = usage.speed
  const median = middle(speed.median)
  const p95 = middle(speed.p95)
  // More calls is neither good nor bad: an arrow, never a colour.
  const change = usage.before !== null ? askedChange(calls, usage.before) : null

  return (
    <Frame>
      <FrameSection
        title="Usage"
        description={OBS_PURPOSE.usage}
        action={<RangeSwitch value={view.range} />}
      />
      <div className="grid grid-cols-2 gap-px border-t bg-border @3xl/main:grid-cols-4">
        <Kpi
          icon={<WrenchIcon />}
          label="Tool calls"
          value={calls.toLocaleString('en')}
          change={kpiChange(change, (c) =>
            change?.percent != null
              ? `${change.percent > 0 ? '+' : ''}${change.percent}%`
              : moreOrFewer(c),
          )}
          sub={`by ${agents.length} kinds of agent`}
        />
        <Kpi
          icon={<TimerIcon />}
          label="Median reply"
          value={median ?? '-'}
          unit={median === null ? undefined : 'ms'}
          sub={p95 === null ? 'no replies timed' : `95 of 100 under ${p95} ms`}
        />
        <Kpi
          icon={<CircleAlertIcon />}
          label="Could not be read"
          value={shownCount(unread)}
          sub={
            unread === null || unread < HIDE_UNDER
              ? 'a count under 5 is hidden'
              : `${calls ? ((unread / calls) * 100).toFixed(1) : '0'}% of calls`
          }
        />
        <Kpi
          icon={<CoinsIcon />}
          label="Model spend"
          value={money(usage.spend.total)}
          sub={`of ${money(usage.spend.cap).replace('.00', '')} this month`}
        />
      </div>

      <FrameSection
        title="Tools"
        description="Each call an agent made, by tool. Answering needs no model."
      >
        <Tools tools={tools} />
      </FrameSection>

      <div className="grid grid-cols-1 border-t @4xl/main:grid-cols-2">
        <FrameSection
          title="How fast"
          description={`The median reply and 95 of 100 replies, by ${speed.per}.`}
        >
          <div className="px-3 pb-3">
            <SeriesLegend
              items={[
                { name: 'Median', color: 'var(--primary)' },
                { name: '95 of 100', color: 'var(--chart-2)' },
              ]}
            />
            <LineChart
              series={[
                // A day or week with no reply timed draws at zero.
                {
                  name: 'Median',
                  values: speed.median.map((v) => v ?? 0),
                  color: 'var(--primary)',
                },
                {
                  name: '95 of 100',
                  values: speed.p95.map((v) => v ?? 0),
                  color: 'var(--chart-2)',
                },
              ]}
              labels={speed.labels}
              max={150}
              height={210}
              format={(v) => `${v} ms`}
              caption={`How long a reply took, by ${speed.per}, in milliseconds`}
            />
          </div>
        </FrameSection>
        <div className="border-t @4xl/main:border-t-0 @4xl/main:border-l">
          <FrameSection
            title="Agents"
            description="Counted by kind. The name an agent gives itself is not kept."
            action={<PageLink href="/settings/agents">Agents and access</PageLink>}
          >
            <table className="w-full text-sm" aria-label="Calls by kind of agent">
              <thead>
                <tr className="border-t bg-band text-xs text-muted-foreground">
                  <th className="h-9 px-4 text-left font-medium md:pl-5">Agent</th>
                  <th className="h-9 px-4 text-right font-medium">Calls</th>
                  <th className="h-9 px-4 text-right font-medium md:pr-5">Last call</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => (
                  <tr key={a.name} className="border-t">
                    <td className="h-11 px-4 md:pl-5">
                      <span className="flex items-center gap-2">
                        <BotIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                        {a.name}
                      </span>
                    </td>
                    <td className="h-11 px-4 text-right tabular-nums">{shownCount(a.calls)}</td>
                    <td className="h-11 px-4 text-right whitespace-nowrap text-muted-foreground md:pr-5">
                      {a.last}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </FrameSection>
        </div>
      </div>

      <section className="border-t">
        <FrameSection
          title="Model spend"
          description="From the ledger, this month. A cap stops a feature and says why."
          action={<PageLink href="/settings/advanced">Limits</PageLink>}
        >
          <Spend />
        </FrameSection>
      </section>
    </Frame>
  )
}

/** The middle value of a few: the median of the days' medians; null when none was timed. */
function middle(values: (number | null)[]) {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b)
  return v.length ? v[Math.floor(v.length / 2)]! : null
}

/** A link out of the page, quiet, at a section's right end. */
function PageLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      className="inline-flex h-7 items-center gap-1 rounded-sm text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
      <ArrowUpRightIcon className="size-3.5" aria-hidden />
    </a>
  )
}

function SeriesLegend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 pb-2 text-xs text-muted-foreground">
      {items.map((s) => (
        <li key={s.name} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-0.5 w-3 rounded-full bg-(--swatch)"
            style={{ '--swatch': s.color } as CSSProperties}
          />
          {s.name}
        </li>
      ))}
    </ul>
  )
}

/** The tools, one row each. On a narrow page the four results fold into one line under the name. */
function Tools({ tools }: { tools: UsageData['tools'] }) {
  const what = (name: string) =>
    AGENT_TOOLS.find((t) => t.name === name)
      ?.what.replace(/\.$/, '')
      .replace(/, (with|after) .*$/, '')
  const cell = (v: number, warn?: boolean) =>
    v ? (
      <span className={cn(warn && 'font-semibold text-[var(--warn)]')}>
        {v.toLocaleString('en')}
      </span>
    ) : (
      <span className="text-muted-foreground">-</span>
    )
  const th = 'h-9 px-4 text-right font-medium whitespace-nowrap'
  return (
    <table className="w-full text-sm" aria-label="Calls by tool">
      <thead>
        <tr className="border-t bg-band text-xs text-muted-foreground">
          <th className="h-9 px-4 text-left font-medium md:pl-5">Tool</th>
          <th className={th}>Calls</th>
          <th className={cn(th, '@max-2xl/main:hidden')}>Answered</th>
          <th className={cn(th, '@max-2xl/main:hidden')}>Needed more detail</th>
          <th className={cn(th, '@max-2xl/main:hidden')}>Not found</th>
          <th className={cn(th, 'md:pr-5 @max-2xl/main:hidden')}>Failed</th>
        </tr>
      </thead>
      <tbody>
        {tools.map((t) => (
          <tr key={t.name} className="border-t">
            <td className="px-4 py-2.5 md:pl-5">
              <span className="block font-mono text-xs">{t.name}</span>
              <span className="block text-dense text-muted-foreground">{what(t.name)}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground @2xl/main:hidden">
                {[
                  t.answered && `${t.answered} answered`,
                  t.detail && `${t.detail} needed more detail`,
                  t.nothing && `${t.nothing} not found`,
                  t.failed && `${t.failed} failed`,
                ]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            </td>
            <td className="px-4 pt-2.5 text-right align-top tabular-nums @2xl/main:pt-0 @2xl/main:align-middle">
              {t.calls.toLocaleString('en')}
            </td>
            <td className="px-4 text-right tabular-nums @max-2xl/main:hidden">
              {cell(t.answered)}
            </td>
            <td className="px-4 text-right tabular-nums @max-2xl/main:hidden">{cell(t.detail)}</td>
            <td className="px-4 text-right tabular-nums @max-2xl/main:hidden">{cell(t.nothing)}</td>
            <td className="px-4 text-right tabular-nums md:pr-5 @max-2xl/main:hidden">
              {cell(t.failed, true)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** This month's spend as one bar against the cap, by feature, and the caps under it. */
function Spend() {
  const obs = useObservability()
  return (
    <div className="grid grid-cols-1 gap-y-4 pb-1 @4xl/main:grid-cols-2">
      <div className="px-4 md:px-5">
        <p className="flex items-baseline gap-1.5">
          <span className="text-2xl font-semibold tracking-tight tabular-nums">
            {money(obs.data.usage!.spend.total)}
          </span>
          <span className="text-sm text-muted-foreground">
            of {money(obs.data.usage!.spend.cap).replace('.00', '')} this month
          </span>
        </p>
        <div
          className="mt-2 flex h-3 w-full gap-px overflow-hidden rounded-xs bg-muted"
          aria-hidden
        >
          {obs.data.usage!.spend.parts.map((p, i) => (
            <span
              key={p.name}
              className="bg-(--swatch)"
              style={
                {
                  width: `${(p.amount / obs.data.usage!.spend.cap) * 100}%`,
                  '--swatch': SPEND_FILL[i],
                } as CSSProperties
              }
            />
          ))}
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
          {obs.data.usage!.spend.parts.map((p, i) => (
            <li key={p.name} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2.5 bg-(--swatch)"
                style={{ '--swatch': SPEND_FILL[i] } as CSSProperties}
              />
              {p.name}{' '}
              <span className="font-medium text-foreground tabular-nums">{money(p.amount)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-dense text-muted-foreground">
          Answering agents costs nothing. Answer tests ran once, from the command line.
        </p>
      </div>
      <table className="w-full self-start text-sm @4xl/main:border-l" aria-label="Spend caps">
        <thead>
          <tr className="border-t bg-band text-xs text-muted-foreground @4xl/main:border-t-0">
            <th className="h-9 px-4 text-left font-medium md:pl-5">Cap</th>
            <th className="h-9 px-4 text-right font-medium">Used</th>
            <th className="h-9 px-4 text-right font-medium md:pr-5">Of</th>
          </tr>
        </thead>
        <tbody>
          {obs.data.usage!.spend.limits.map((l) => (
            <tr key={l.name} className="border-t">
              <td className="h-11 px-4 md:pl-5">{l.name}</td>
              <td className="h-11 px-4 text-right tabular-nums">{money(l.used)}</td>
              <td className="h-11 px-4 text-right text-muted-foreground tabular-nums md:pr-5">
                {money(l.cap)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
