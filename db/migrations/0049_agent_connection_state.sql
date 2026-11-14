-- Whether a person's agent connection is open, asked of the database at every MCP request.
--
-- serving_agent_tools gave the agent's tools for any connection it knew, ended or not, and the
-- MCP server kept its own list of ended connections to cover for it, so a disconnect acted at once
-- only in the instance that made it. It now answers as serving_access_key does: a state, open,
-- revoked or expired, beside the agent and its tools. A connection ended with no agent row still
-- answers, with no agent. No row for a connection nobody knows here.
drop function public.serving_agent_tools(uuid);
create function public.serving_agent_tools(p_grant uuid)
    returns table (state text, agent_id uuid, tools text[])
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select case when g.revoked_at is not null then 'revoked'
              when g.expires_at <= now() then 'expired'
              else 'open' end,
         a.id, a.tools
    from auth.oauth_grants g
    left join auth.agents a on a.kind = 'app' and a.person_id = g.person_id and a.client_id = g.client_id
   where g.id = p_grant
$$;
revoke all on function public.serving_agent_tools(uuid) from public;
