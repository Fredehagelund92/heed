import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Loadable } from '@/components/heed/load-state'
import { StaticField } from '@/components/heed/field-controls'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toApiError } from '@/api/errors'
import { domainPoliciesQuery, useWrite } from '@/api/queries'
import {
  lowRiskKind,
  POLICY_DEFAULT_PER_DAY,
  POLICY_MAX_PER_DAY,
  policyPauseLine,
  policyRule,
  policySetLine,
  policyTodayLine,
  type DomainPolicies,
  type Policy,
} from '@/lib/policies'
import { href } from '@/lib/router'
import { kindHint, kindLabel, type DomainId, type Kind } from '@/model/items'

// Publishing without review (FR-421): an owner of a domain lets one named agent's suggestions for
// low-risk new items publish there without a review round, as their own decision, up to a daily
// cap. It stays on until someone turns it off, so Turn off is beside every policy, here and in the
// agent's Details in Agents and access.

const KINDS: Kind[] = ['note', 'event', 'issue', 'guide']

/** One policy: what it lets through, who set it and why, today's count, and Turn off. */
export function PolicyCard({
  policy,
  title,
  from,
}: {
  policy: Policy
  /** What the card names first: the agent, on a domain page; the domain, in an agent's Details. */
  title: string
  from: 'agents' | 'domain'
}) {
  const write = useWrite()
  const [ending, setEnding] = React.useState(false)
  const paused = policyPauseLine(policy)
  const turnOff = () => {
    setEnding(true)
    void write('endAgentPolicy', { id: policy.id, from }).then(
      () =>
        toast(`Turned off for ${policy.agent} in ${policy.domainName}`, {
          description: 'Its suggestions wait for review again.',
        }),
      (e: unknown) => {
        setEnding(false)
        toast("Couldn't turn it off", { description: toApiError(e).message })
      },
    )
  }
  return (
    <li className="flex items-start justify-between gap-3 rounded-md border bg-background px-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5 text-sm">
        <span className="font-medium">{title}</span>
        <span>{policyRule(policy)}.</span>
        <span className="text-xs text-muted-foreground">
          {policySetLine(policy)}. {policyTodayLine(policy)}.
        </span>
        <span className="text-xs text-muted-foreground">Why: {policy.reason}</span>
        {paused && <span className="text-xs text-caution-text">{paused}</span>}
      </div>
      {policy.canEnd && (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={ending}
          aria-label={`Turn off publishing without review for ${policy.agent} in ${policy.domainName}`}
          onClick={turnOff}
        >
          Turn off
        </Button>
      )}
    </li>
  )
}

/** The domain page's row: its policies, and for an owner or an admin, a way to set one. */
export function DomainPoliciesField({
  domain,
  domainName,
  admin,
}: {
  domain: DomainId
  domainName: string
  admin: boolean
}) {
  const load = useQuery(domainPoliciesQuery(domain))
  const [setting, setSetting] = React.useState(0)
  return (
    <Loadable
      what="who publishes without review"
      skeleton={<StaticField>Loading</StaticField>}
      query={load}
    >
      {load.data && (
        <DomainPoliciesBody
          d={load.data}
          domainName={domainName}
          admin={admin}
          onSet={() => setSetting((n) => n + 1)}
        />
      )}
      {load.data && setting > 0 && (
        <SetPolicyDialog
          key={setting}
          d={load.data}
          domain={domain}
          domainName={domainName}
          onClose={() => setSetting(0)}
        />
      )}
    </Loadable>
  )
}

function DomainPoliciesBody({
  d,
  domainName,
  admin,
  onSet,
}: {
  d: DomainPolicies
  domainName: string
  admin: boolean
  onSet: () => void
}) {
  if (!d.on && !d.policies.length)
    return (
      <StaticField>
        <span>
          Off for the workspace.{' '}
          {admin ? (
            <a
              href={href('/settings/agents')}
              className="text-foreground underline underline-offset-4"
            >
              Turn it on in Agents and access
            </a>
          ) : (
            'An admin turns it on in Agents and access.'
          )}
        </span>
      </StaticField>
    )
  return (
    <div className="@container flex flex-col gap-2 py-1">
      {d.policies.length ? (
        <ul
          className="flex flex-col gap-2"
          aria-label={`Agents that publish without review in ${domainName}`}
        >
          {d.policies.map((p) => (
            <PolicyCard key={p.id} policy={p} title={`${p.agent} for ${p.who}`} from="domain" />
          ))}
        </ul>
      ) : (
        <p className="flex min-h-8 items-center text-sm text-muted-foreground">
          No agent. Every suggestion waits for an owner.
        </p>
      )}
      {d.canSet && d.on && (
        <div>
          <Button variant="outline" size="sm" onClick={onSet}>
            Let an agent publish without review
          </Button>
        </div>
      )}
    </div>
  )
}

/** Sets a policy for one app in this domain: which kinds, up to how many a day, and why. */
function SetPolicyDialog({
  d,
  domain,
  domainName,
  onClose,
}: {
  d: DomainPolicies
  domain: DomainId
  domainName: string
  onClose: () => void
}) {
  const write = useWrite()
  const ids = React.useId()
  const [agentId, setAgentId] = React.useState(d.agents[0]?.id ?? '')
  const [kinds, setKinds] = React.useState<Kind[]>(['note'])
  const [perDay, setPerDay] = React.useState(String(POLICY_DEFAULT_PER_DAY))
  const [reason, setReason] = React.useState('')
  const [problem, setProblem] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const agent = d.agents.find((a) => a.id === agentId)
  const label = (a: DomainPolicies['agents'][number]) => `${a.agent} for ${a.who}`
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const cap = Number(perDay)
    const found = !agent
      ? 'Choose an agent.'
      : !kinds.length
        ? 'Choose at least one kind.'
        : !Number.isInteger(cap) || cap < 1 || cap > POLICY_MAX_PER_DAY
          ? `Choose a number from 1 to ${POLICY_MAX_PER_DAY}.`
          : !reason.trim()
            ? 'Say why, for the history log.'
            : null
    setProblem(found)
    if (found || !agent) return
    setSaving(true)
    try {
      await write('setAgentPolicy', {
        agentId: agent.id,
        domain,
        kinds,
        perDay: cap,
        reason: reason.trim(),
      })
      toast(`${agent.agent} for ${agent.who} publishes without review in ${domainName}`, {
        description: 'Turn it off here or in its Details, in Agents and access.',
      })
      onClose()
    } catch (e) {
      setSaving(false)
      toast("Couldn't set it", { description: toApiError(e).message })
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Publish without review in {domainName}</DialogTitle>
            <DialogDescription>
              Its suggestions for new, low-risk items publish at once, as your decision. Everything
              else still waits for an owner. You or another owner can undo each one from its
              history.
            </DialogDescription>
          </DialogHeader>
          {d.agents.length ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${ids}-agent`} className="text-sm font-medium">
                Agent
              </label>
              <Select
                items={d.agents.map((a) => ({ label: label(a), value: a.id }))}
                value={agentId}
                onValueChange={(v) => setAgentId(String(v ?? ''))}
              >
                <SelectTrigger id={`${ids}-agent`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {d.agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {label(a)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              {agent && (
                <p className="text-xs text-muted-foreground">
                  {agent.sent} sent here in the last 90 days, {agent.published} published.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No agent sent a suggestion to {domainName} in the last 90 days. An agent earns this
              with suggestions an owner checked.
            </p>
          )}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Kinds</legend>
            {KINDS.map((k) => {
              const low = lowRiskKind(k)
              const id = `${ids}-kind-${k}`
              return (
                <div key={k} className="flex items-start gap-2">
                  <Checkbox
                    id={id}
                    className="mt-0.5"
                    checked={kinds.includes(k)}
                    disabled={!low}
                    aria-describedby={`${id}-hint`}
                    onCheckedChange={(on) =>
                      setKinds((was) => (on ? [...was, k] : was.filter((x) => x !== k)))
                    }
                  />
                  <span className="flex flex-col gap-0.5">
                    <label
                      htmlFor={id}
                      className={low ? 'text-sm' : 'text-sm text-muted-foreground'}
                    >
                      {kindLabel[k]}
                    </label>
                    <span id={`${id}-hint`} className="text-xs text-muted-foreground">
                      {low ? kindHint[k] : 'Starts at normal risk, so it waits for review.'}
                    </span>
                  </span>
                </div>
              )
            })}
          </fieldset>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-cap`} className="text-sm font-medium">
              Most in a day
            </label>
            <Input
              id={`${ids}-cap`}
              type="number"
              inputMode="numeric"
              min={1}
              max={POLICY_MAX_PER_DAY}
              className="w-24"
              value={perDay}
              onChange={(e) => setPerDay(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Over this, its suggestions wait for review until the next day.
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${ids}-why`} className="text-sm font-medium">
              Why
            </label>
            <Input
              id={`${ids}-why`}
              maxLength={500}
              autoComplete="off"
              placeholder="Its month-end rules have been right for weeks"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <ul className="flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
            <li>It never changes or archives a live item.</li>
            <li>A suggestion that clashes with live context, or has a claim to check, waits.</li>
            <li>It stays on until someone turns it off.</li>
          </ul>
          {problem && (
            <p role="alert" className="text-sm text-destructive">
              {problem}
            </p>
          )}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={saving || !d.agents.length}>
              Let it publish
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
