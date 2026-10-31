import type { Agent } from '../../../contract/connections.ts'
import { scopesWith, type AgentKind, type AgentPermission } from '../../../domain/agents.ts'
import type { Queryable } from '../../db/database.ts'
import { initialsOf } from '../auth/index.ts'

/*
  Every agent by name (FR-420): an app a person signed in with is one agent per person and app,
  and an access key is one. An administrator sees each with what it may do and what it suggested
  lately, and sets what it may do; anyone else sees their own apps. The MCP server enforces the
  setting at the agent's next request (mcp/auth.ts withAgents, access-keys createAccessKeyVerifier).
*/

/** How far back an agent's suggestions are counted on its row. */
const RECENT_DAYS = 30
/** How many of its latest suggestions an agent's row names. */
const RECENT_COUNT = 5

type Row = {
  id: string
  kind: AgentKind
  name: string
  /** A document app's own address, or where a registered app sends the person back. */
  from: string | null
  personId: string | null
  personName: string | null
  email: string | null
  madeById: string | null
  madeByName: string | null
  permission: AgentPermission
  setByName: string | null
  setAt: Date | null
  allowed: string[]
  since: Date
  lastUsedAt: Date | null
  lastDays: number
  recent: { id: string; title: string; state: string; at: string }[]
}

/** The signed-in person, and whether the database says they are an administrator now. */
async function actor(tx: Queryable) {
  const [row] = await tx.query<{ admin: boolean; id: string | null }>(
    'select cl_is_admin_now() as admin, cl_person()::text as id',
  )
  return { admin: Boolean(row?.admin), id: row?.id ?? null }
}

/**
 * The agents that may reach context now: apps with an open connection and access keys not
 * revoked, the last used first. An administrator gets every agent; anyone else their own apps.
 */
export async function listAgents(tx: Queryable, now: Date): Promise<Agent[]> {
  const me = await actor(tx)
  if (!me.id) return []
  const rows = await tx.query<Row>(
    `with open_apps as (
       select a.id, min(g.created_at) as since, max(g.last_used_at) as last_used,
              array(select distinct s from auth.oauth_grants g2, unnest(g2.scopes) s
                     where g2.person_id = a.person_id and g2.client_id = a.client_id
                       and g2.revoked_at is null and g2.expires_at > $1) as allowed,
              (select case when c.kind = 'metadata_document' then c.id else c.redirect_uris[1] end
                 from auth.oauth_clients c where c.id = a.client_id) as host
         from auth.agents a
         join auth.oauth_grants g on g.person_id = a.person_id and g.client_id = a.client_id
        where a.kind = 'app' and g.revoked_at is null and g.expires_at > $1
          and ($2 or a.person_id = $3::uuid)
        group by a.id
     ), listed as (
       select a.*, o.since, o.last_used, o.allowed, o.host
         from auth.agents a join open_apps o on o.id = a.id
       union all
       select a.*, k.created_at, k.last_used_at, array['read', 'feedback'], null
         from auth.agents a join auth.access_keys k on k.id = a.key_id
        where $2 and k.revoked_at is null
     )
     select l.id::text, l.kind, l.name, l.host as "from",
            p.id::text as "personId", p.display_name as "personName",
            case when p.erased_at is null then p.email end as email,
            m.id::text as "madeById", m.display_name as "madeByName",
            l.permission, s.display_name as "setByName", l.permission_set_at as "setAt",
            l.allowed, l.since, l.last_used as "lastUsedAt",
            (select count(*)::int from proposals x
              where x.agent_id = l.id and x.created_at > $1 - make_interval(days => $4)) as "lastDays",
            coalesce((select jsonb_agg(r order by r.at desc) from (
               select x.id::text as id, coalesce(x.draft->>'title', 'Untitled suggestion') as title,
                      x.state::text as state, x.created_at as at
                 from proposals x where x.agent_id = l.id and x.discarded_at is null
                order by x.created_at desc limit $5) r), '[]'::jsonb) as recent
       from listed l
       left join public.people p on p.id = l.person_id
       left join auth.access_keys k on k.id = l.key_id
       left join public.people m on m.id = k.created_by
       left join public.people s on s.id = l.permission_set_by
      order by l.last_used desc nulls last, l.since desc, l.id`,
    [now, me.admin, me.id, RECENT_DAYS, RECENT_COUNT],
  )
  return rows.map((row) => {
    const allowed = scopesWith(row.allowed, 'suggest')
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      host: row.from && URL.canParse(row.from) ? new URL(row.from).hostname : null,
      person:
        row.personId && row.personName
          ? {
              id: row.personId,
              name: row.personName,
              initials: initialsOf(row.personName),
              email: row.email,
            }
          : null,
      madeBy:
        row.madeById && row.madeByName
          ? { id: row.madeById, name: row.madeByName, initials: initialsOf(row.madeByName) }
          : null,
      permission: row.permission,
      permissionSetBy:
        row.setByName && row.setAt ? { name: row.setByName, at: row.setAt.toISOString() } : null,
      allowed,
      scopes: scopesWith(allowed, row.permission),
      since: row.since.toISOString(),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      suggestions: {
        lastDays: row.lastDays,
        recent: row.recent.map((r) => ({ ...r, at: new Date(r.at).toISOString() })),
      },
    }
  })
}

/**
 * An administrator sets what one agent may do, with a reason the history log keeps beside the
 * agent's name and what it was before. It acts at the agent's next request. Whether it changed;
 * false when it was so already, null when the signed-in person is no longer an administrator,
 * undefined when there is no such agent or an access key would suggest.
 */
export async function setAgentPermission(
  tx: Queryable,
  id: string,
  permission: AgentPermission,
  reason: string,
): Promise<boolean | null | undefined> {
  const me = await actor(tx)
  if (!me.admin || !me.id) return null
  const [agent] = await tx.query<{ kind: AgentKind; name: string; permission: AgentPermission }>(
    'select kind, name, permission from auth.agents where id = $1 for update',
    [id],
  )
  if (!agent || (agent.kind === 'key' && permission === 'suggest')) return undefined
  if (agent.permission === permission) return false
  await tx.query(
    `update auth.agents set permission = $2, permission_set_by = $3, permission_set_at = now()
      where id = $1`,
    [id, permission, me.id],
  )
  await tx.query(
    `insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details, reason)
     values($1, 'person', 'agent.permission_changed', 'agent', $2, $3, $4)`,
    [
      me.id,
      id,
      JSON.stringify({
        name: agent.name,
        kind: agent.kind,
        from: agent.permission,
        to: permission,
      }),
      reason,
    ],
  )
  return true
}

/** One agent as its revoke needs it: an app's person and client, or a key's id. */
export async function agentFor(tx: Queryable, id: string) {
  const [agent] = await tx.query<{
    kind: AgentKind
    personId: string | null
    keyId: string | null
  }>(
    `select kind, person_id::text as "personId", key_id::text as "keyId"
       from auth.agents where id = $1`,
    [id],
  )
  return agent ?? null
}
