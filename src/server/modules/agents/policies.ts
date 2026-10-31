import { ORPCError } from '@orpc/client'
import type {
  AgentPolicy,
  AutoPublishState,
  DomainPolicies,
  SetAgentPolicy,
} from '../../../contract/connections.ts'
import type { ProposalRecord } from '../../../contract/proposals.ts'
import type { PolicySkip } from '../../../domain/agent-policies.ts'
import type { ItemKind } from '../../../domain/item.ts'
import type { Clock } from '../../clock.ts'
import type { Queryable } from '../../db/database.ts'
import { plainReason, recordAudit } from '../admin/index.ts'
import type { BundleCache } from '../answer/index.ts'
import type { CommentsService } from '../comments/index.ts'
import { createReviewPath, createReviewService, loadProposal } from '../review/index.ts'

/*
  Publishing without review (FR-421; docs/ai-sign-in.md). An admin switches it on for the
  workspace; then an owner of a domain, or an admin, sets a policy that lets one app agent's
  suggestions publish there without a review round. The service publishes such a suggestion in the
  transaction that sent it, through the owner's own publish path and as the owner who set the
  policy, so the decision, the edition and the history name that owner, with the policy. It does so
  only for a new item of a kind the policy covers, at low risk, that clashes with nothing live, has
  no claim to check and nothing else that needs care, passes every check, and is under the daily
  cap, while the person who set the policy is still an owner of the domain (or an admin, if they set
  it as one) and the agent may still suggest. Anything else waits for review as before. The database
  checks every rule again when the decision is recorded (cl_policy_decision_problem).
*/

const SETTING = 'agents.auto_publish'

type Row = Omit<AgentPolicy, 'person' | 'setBy' | 'setAt' | 'kinds'> & {
  kinds: ItemKind[]
  personId: string
  personName: string
  setById: string
  setByName: string
  setAt: Date
}

/** Open policies, with who may turn each off and why one waits for review although it is on. */
async function openPolicies(
  tx: Queryable,
  where: { agentIds?: readonly string[]; areaId?: string; ids?: readonly string[] },
): Promise<AgentPolicy[]> {
  const rows = await tx.query<Row>(
    `select p.id::text, p.agent_id::text as "agentId", a.name as "agentName",
            ap.id::text as "personId", ap.display_name as "personName",
            p.area_id as "areaId", ar.name as "areaName", p.kinds, p.per_day as "perDay",
            s.id::text as "setById", s.display_name as "setByName", p.set_at as "setAt", p.reason,
            (select count(*)::int from decisions d
              where d.auto_policy_id = p.id and d.decided_at > now() - interval '24 hours') as today,
            case
              when not ((p.set_as = 'owner' and cl_has_area_role(p.set_by, p.area_id, 'owner', now()))
                     or (p.set_as = 'administrator' and cl_is_admin(p.set_by, now()))) then 'not_owner'
              when not 'suggest_context' = any (a.tools) then 'tool_off'
              when not coalesce((select enabled from tool_config where tool = 'suggest_context'), false)
                then 'workspace_tool_off'
            end as pause,
            (p.set_by = cl_person() or cl_is_owner_now(p.area_id) or cl_is_admin_now()
              or a.person_id = cl_person()) as "canEnd"
       from agent_policies p
       join auth.agents a on a.id = p.agent_id
       join people ap on ap.id = a.person_id
       join areas ar on ar.id = p.area_id
       join people s on s.id = p.set_by
      where p.ended_at is null
        and ($1::uuid[] is null or p.agent_id = any ($1::uuid[]))
        and ($2::text is null or p.area_id = $2)
        and ($3::uuid[] is null or p.id = any ($3::uuid[]))
      order by ar.name, p.set_at desc`,
    [where.agentIds ?? null, where.areaId ?? null, where.ids ?? null],
  )
  return rows.map(({ personId, personName, setById, setByName, setAt, ...row }) => ({
    ...row,
    pause: row.pause,
    person: { id: personId, name: personName },
    setBy: { id: setById, name: setByName },
    setAt: setAt.toISOString(),
  }))
}

/** The open policies of these agents, for their rows in Agents and access. */
export const policiesOfAgents = (tx: Queryable, agentIds: readonly string[]) =>
  agentIds.length ? openPolicies(tx, { agentIds }) : Promise.resolve([])

async function switchOn(tx: Queryable) {
  const [row] = await tx.query<{ on: boolean }>('select cl_auto_publish_on() as on')
  return Boolean(row?.on)
}

async function standing(tx: Queryable, areaId: string) {
  const [row] = await tx.query<{ id: string | null; admin: boolean; owner: boolean }>(
    'select cl_person()::text as id, cl_is_admin_now() as admin, cl_is_owner_now($1) as owner',
    [areaId],
  )
  return { id: row?.id ?? null, admin: Boolean(row?.admin), owner: Boolean(row?.owner) }
}

/**
 * One domain's policies, and the apps a policy there may be for: those that sent a suggestion to
 * the domain in the last 90 days and still have a connection and suggest_context, with what came of
 * their suggestions. Only someone who may set a policy here sees the apps.
 */
export async function domainPolicies(tx: Queryable, areaId: string): Promise<DomainPolicies> {
  const [area] = await tx.query('select 1 from areas where id = $1', [areaId])
  if (!area) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this domain." })
  const me = await standing(tx, areaId)
  const canSet = me.owner || me.admin
  const agents = canSet
    ? await tx.query<DomainPolicies['agents'][number]>(
        `select a.id::text, a.name, json_build_object('id', p.id::text, 'name', p.display_name) as person,
                count(x.id)::int as sent, count(x.id) filter (where x.state = 'accepted')::int as published
           from auth.agents a
           join people p on p.id = a.person_id
           join proposals x on x.agent_id = a.id and x.area_id = $1
                           and x.created_at > now() - interval '90 days' and x.state <> 'draft'
          where a.kind = 'app' and 'suggest_context' = any (a.tools)
            and p.deactivated_at is null and p.erased_at is null
            and exists (select 1 from auth.oauth_grants g
                         where g.person_id = a.person_id and g.client_id = a.client_id
                           and g.revoked_at is null and g.expires_at > now())
          group by a.id, p.id
          order by count(x.id) desc, a.name, p.display_name`,
        [areaId],
      )
    : []
  return {
    on: await switchOn(tx),
    canSet,
    policies: await openPolicies(tx, { areaId }),
    agents,
  }
}

async function endOne(tx: Queryable, id: string, reason: string) {
  const ended = await tx.query<{ id: string; agentId: string; areaId: string; name: string }>(
    `update agent_policies p set ended_at = now(), ended_by = cl_person(), ended_reason = $2
       from auth.agents a
      where a.id = p.agent_id and p.ended_at is null
        and p.id = $1
      returning p.id::text, p.agent_id::text as "agentId", p.area_id as "areaId", a.name`,
    [id, reason],
  )
  for (const policy of ended)
    await recordAudit(tx, {
      action: 'agent.policy_ended',
      subjectType: 'agent',
      subjectId: policy.agentId,
      areaId: policy.areaId,
      details: { name: policy.name, policyId: policy.id, reason },
    })
  return ended.length
}

/**
 * An owner of the domain, or an admin, lets one app agent publish without review there, while the
 * workspace allows it. It replaces the agent's policy in that domain, if there is one: a policy is
 * never changed, so a change is a new one.
 */
export async function setPolicy(tx: Queryable, input: SetAgentPolicy): Promise<AgentPolicy> {
  plainReason(input.reason)
  const me = await standing(tx, input.areaId)
  if (!me.id) throw new ORPCError('UNAUTHORIZED')
  if (!(await switchOn(tx)))
    throw new ORPCError('CONFLICT', {
      message:
        'Publishing without review is off for the workspace. An admin turns it on in Agents and access.',
    })
  if (!me.owner && !me.admin)
    throw new ORPCError('FORBIDDEN', {
      message: 'Only the owners of this domain, or an admin, can let an agent publish here.',
    })
  const [area] = await tx.query<{ name: string }>(
    'select name from areas where id = $1 and archived_at is null',
    [input.areaId],
  )
  if (!area) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this domain." })
  const [agent] = await tx.query<{ kind: string; name: string }>(
    'select kind, name from auth.agents where id = $1 for update',
    [input.agentId],
  )
  if (!agent) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this agent." })
  if (agent.kind !== 'app')
    throw new ORPCError('CONFLICT', {
      message: 'An access key names no person and never suggests, so it never publishes.',
    })
  const replaced = await tx.query<{ id: string }>(
    `update agent_policies set ended_at = now(), ended_by = cl_person(), ended_reason = 'Replaced by a new policy.'
      where agent_id = $1 and area_id = $2 and ended_at is null returning id::text`,
    [input.agentId, input.areaId],
  )
  const kinds = [...new Set(input.kinds)]
  const [saved] = await tx.query<{ id: string }>(
    `insert into agent_policies (agent_id, area_id, kinds, per_day, set_by, set_as, reason)
     values ($1, $2, $3, $4, cl_person(), $5, $6) returning id::text`,
    [
      input.agentId,
      input.areaId,
      kinds,
      input.perDay,
      me.owner ? 'owner' : 'administrator',
      input.reason,
    ],
  )
  await recordAudit(tx, {
    action: 'agent.policy_set',
    subjectType: 'agent',
    subjectId: input.agentId,
    areaId: input.areaId,
    details: {
      name: agent.name,
      policyId: saved!.id,
      area: area.name,
      kinds,
      perDay: input.perDay,
      reason: input.reason,
      ...(replaced[0] ? { replaced: replaced[0].id } : {}),
    },
  })
  const [policy] = await openPolicies(tx, { ids: [saved!.id] })
  return policy!
}

/**
 * Turns one policy off at once. Whoever set it, an owner of the domain, an admin and the person the
 * agent works for may: row security decides. Whether it changed; false when it was off already.
 */
export async function endPolicy(tx: Queryable, id: string, reason: string): Promise<boolean> {
  plainReason(reason)
  const [policy] = await tx.query<{ ended: boolean }>(
    'select ended_at is not null as ended from agent_policies where id = $1',
    [id],
  )
  if (!policy) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this policy." })
  if (policy.ended) return false
  if (await endOne(tx, id, reason)) return true
  throw new ORPCError('FORBIDDEN', {
    message:
      'Only whoever set it, an owner of the domain, an admin or the person the agent works for can turn it off.',
  })
}

export async function autoPublishState(tx: Queryable): Promise<AutoPublishState> {
  const [row] = await tx.query<{ open: number }>(
    'select count(*)::int as open from agent_policies where ended_at is null',
  )
  return { on: await switchOn(tx), open: row?.open ?? 0 }
}

/**
 * An admin switches publishing without review on or off for the workspace: a new version of the
 * setting, with the reason, in the history log. Off ends every policy at once, so switching it on
 * again starts with none.
 */
export async function switchAutoPublish(
  tx: Queryable,
  on: boolean,
  reason: string,
): Promise<{ on: boolean; ended: number }> {
  plainReason(reason)
  const [me] = await tx.query<{ admin: boolean }>('select cl_is_admin_now() as admin')
  if (!me?.admin) throw new ORPCError('FORBIDDEN')
  await tx.query("select pg_advisory_xact_lock(hashtextextended('heed.setting:' || $1,0))", [
    SETTING,
  ])
  const [current] = await tx.query<{ version: number; value: unknown }>(
    'select version, value from settings_versions where key = $1 order by version desc limit 1',
    [SETTING],
  )
  if (!current) throw new ORPCError('NOT_FOUND', { message: "We couldn't find this setting." })
  if ((current.value === true) === on) return { on, ended: 0 }
  // Off ends every policy, in the database (settings_auto_publish_off), with the history log.
  const { open } = await autoPublishState(tx)
  await tx.query(
    `insert into settings_versions (key, version, value, changed_by, reason)
     values ($1, $2, $3, cl_person(), $4)`,
    [SETTING, current.version + 1, JSON.stringify(on), reason],
  )
  await recordAudit(tx, {
    action: 'setting.changed',
    subjectType: 'setting',
    subjectId: SETTING,
    details: { from: current.version, to: current.version + 1, value: on, reason },
  })
  return { on, ended: on ? 0 : open }
}

/** What came of a suggestion an agent sent, under the policy for its agent and domain. */
export type PolicyOutcome = {
  policyId: string
  setBy: { id: string; name: string }
  areaName: string
} & (
  | { published: true; decisionId: string; itemId: string; edition: string }
  | { published: false; skip: PolicySkip }
)

type Candidate = {
  action: string
  agentId: string | null
  agentName: string | null
  areaId: string | null
  kind: ItemKind | null
  risk: string | null
  revision: number
  flagged: boolean
}

type Policy = {
  id: string
  kinds: ItemKind[]
  perDay: number
  setBy: string
  setByName: string
  setAs: 'owner' | 'administrator'
  areaName: string
  standing: boolean
  toolOn: boolean
  used: number
}

/**
 * After an agent's suggestion is sent for review, in the same transaction: publishes it under the
 * open policy for its agent and domain when every rule holds, as the owner who set the policy, or
 * leaves it waiting for review and says why. Null when no policy is on for them. Whatever goes wrong
 * while publishing leaves the suggestion exactly as it was sent.
 */
export async function publishUnderPolicy(
  tx: Queryable,
  deps: {
    clock: Clock
    cache: BundleCache
    comments: Pick<CommentsService, 'returned' | 'unreturn' | 'withdrawal'>
    proposalRecord: (id: string) => Promise<ProposalRecord>
  },
  proposalId: string,
): Promise<PolicyOutcome | null> {
  const [c] = await tx.query<Candidate>(
    `select p.action::text, p.agent_id::text as "agentId", p.agent_name as "agentName", p.area_id as "areaId",
            i.kind::text as kind, v.risk::text as risk, p.revision,
            jsonb_array_length(coalesce(p.provenance -> 'flags', '[]'::jsonb)) > 0 as flagged
       from proposals p
       left join item_versions v on v.id = p.item_version_id
       left join items i on i.id = v.item_id
      where p.id = $1 and p.state = 'submitted' and p.channel = 'mcp'`,
    [proposalId],
  )
  if (!c?.agentId || !c.areaId) return null
  if (!(await switchOn(tx))) return null
  const [policy] = await tx.query<Policy>(
    `select p.id::text, p.kinds, p.per_day as "perDay", p.set_by::text as "setBy",
            s.display_name as "setByName", p.set_as as "setAs", ar.name as "areaName",
            ((p.set_as = 'owner' and cl_has_area_role(p.set_by, p.area_id, 'owner', now()))
              or (p.set_as = 'administrator' and cl_is_admin(p.set_by, now()))) as standing,
            ('suggest_context' = any (a.tools)
              and coalesce((select enabled from tool_config where tool = 'suggest_context'), false)) as "toolOn",
            (select count(*)::int from decisions d
              where d.auto_policy_id = p.id and d.decided_at > now() - interval '24 hours') as used
       from agent_policies p
       join auth.agents a on a.id = p.agent_id
       join people s on s.id = p.set_by
       join areas ar on ar.id = p.area_id
      where p.agent_id = $1 and p.area_id = $2 and p.ended_at is null
      for update of p`,
    [c.agentId, c.areaId],
  )
  if (!policy) return null
  const named = {
    policyId: policy.id,
    setBy: { id: policy.setBy, name: policy.setByName },
    areaName: policy.areaName,
  }
  const skip = (why: PolicySkip): PolicyOutcome => ({ ...named, published: false, skip: why })
  if (c.action !== 'create') return skip('not_new')
  if (!c.kind || !policy.kinds.includes(c.kind)) return skip('kind')
  if (c.risk !== 'low') return skip('risk')
  if (!policy.standing) return skip('not_owner')
  if (!policy.toolOn) return skip('tool_off')
  if (policy.used >= policy.perDay) return skip('daily_cap')
  if (c.flagged) return skip('needs_care')

  // From here on the owner decides: the review path runs as them, and only on this suggestion.
  const [proposer] = await tx.query<{ id: string }>('select cl_person()::text as id')
  const actAs = (person: string) =>
    tx.query("select set_config('cl.person_id', $1, true)", [person])
  await tx.query('savepoint policy_publish')
  await actAs(policy.setBy)
  try {
    const review = createReviewService(tx, deps.clock)
    const path = createReviewPath(
      tx,
      deps.clock,
      deps.cache,
      review,
      deps.proposalRecord,
      deps.comments,
    )
    const care = await path.care(await loadProposal(tx, proposalId))
    const why: PolicySkip | null = care.clash ? 'clash' : care.claims ? 'needs_care' : null
    if (why) {
      await tx.query('rollback to savepoint policy_publish')
      await actAs(proposer!.id)
      return skip(why)
    }
    const published = await path.publish(
      {
        id: proposalId,
        revision: c.revision,
        reason: `Published under ${policy.setByName}'s policy for ${c.agentName ?? 'the agent'}, without a review round.`,
      },
      {
        policy: {
          policyId: policy.id,
          details: {
            policy: { id: policy.id, setBy: policy.setBy, setByName: policy.setByName },
            agent: { name: c.agentName, personId: proposer!.id },
          },
        },
      },
    )
    await tx.query('release savepoint policy_publish')
    await actAs(proposer!.id)
    return {
      ...named,
      published: true,
      decisionId: published.undo.replace(/^decision:/, ''),
      itemId: published.proposal.itemId ?? '',
      edition: published.edition?.label ?? '',
    }
  } catch (error) {
    await tx.query('rollback to savepoint policy_publish')
    await actAs(proposer!.id)
    if (error instanceof ORPCError || (error as { code?: string }).code === '23514')
      return skip('checks')
    throw error
  }
}
