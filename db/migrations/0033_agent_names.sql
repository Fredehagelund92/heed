-- 0033_agent_names: every agent has a name, a kind and what it may do (FR-420, FR-419, FR-121;
-- docs/ai-sign-in.md).
--
-- - One row per agent in auth.agents. An app a person signed in with is one agent per person and
--   app: its name is the one the app gives itself, kept up to date at each sign-in and kept when
--   the app's registration goes. An access key is one agent: its name is the one the administrator
--   gave it, and access keys gain that name.
-- - What an agent may do: suggest (read, give feedback and send suggestions an owner checks), read
--   (read and give feedback) or none (nothing, until an administrator changes it). An app starts
--   at suggest, bounded by what the person allowed when it connected; an access key starts at
--   read and never suggests, as it names no person. Who last changed it, and when, is kept here
--   and in the history log (`agent.permission_changed`).
-- - A suggestion an agent sent names the agent, with its name as it was then, beside the person
--   who said yes to it. Neither changes after the suggestion is made.
-- - The MCP server reads no row here: serving_access_key and serving_agent_permission answer for
--   one key or one connection, at every request, so a change acts at the next one.

alter table auth.access_keys add column name text;
update auth.access_keys set name = 'Access key from ' || to_char(created_at at time zone 'UTC', 'FMDD Mon YYYY');
alter table auth.access_keys
    alter column name set not null,
    add constraint access_keys_name_check check (char_length(name) between 1 and 100 and btrim(name) = name and name !~ '[[:cntrl:]]');

create table auth.agents (
    id uuid default uuidv7() primary key,
    kind text not null,
    name text not null,
    person_id uuid references public.people(id),
    client_id text,
    key_id uuid unique references auth.access_keys(id),
    permission text not null,
    permission_set_by uuid references public.people(id),
    permission_set_at timestamp with time zone,
    created_at timestamp with time zone default now() not null,
    constraint agents_kind_check check (
        (kind = 'app' and person_id is not null and client_id is not null and key_id is null)
        or (kind = 'key' and key_id is not null and person_id is null and client_id is null)),
    constraint agents_name_check check (char_length(name) between 1 and 100 and btrim(name) <> ''),
    constraint agents_permission_check check (
        permission in ('suggest', 'read', 'none') and (kind = 'app' or permission <> 'suggest')),
    constraint agents_permission_set_check check ((permission_set_by is null) = (permission_set_at is null)),
    constraint agents_app_unique unique (person_id, client_id)
);

insert into auth.agents (kind, name, person_id, client_id, permission, created_at)
select distinct on (g.person_id, g.client_id) 'app', c.name, g.person_id, g.client_id, 'suggest', g.created_at
  from auth.oauth_grants g join auth.oauth_clients c on c.id = g.client_id
 order by g.person_id, g.client_id, g.created_at;
insert into auth.agents (kind, name, key_id, permission, created_at)
select 'key', k.name, k.id, 'read', k.created_at from auth.access_keys k;

alter table public.proposals
    add column agent_id uuid references auth.agents(id),
    add column agent_name text,
    add constraint proposals_agent_check check (
        (agent_id is null) = (agent_name is null)
        and (agent_id is null or channel = 'mcp')
        and (agent_name is null or char_length(agent_name) between 1 and 100));
create index proposals_agent on public.proposals using btree (agent_id, created_at desc) where agent_id is not null;

-- Which agent sent a suggestion is part of its record: it never changes after the suggestion is made.
create function public.proposals_keep_agent() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
begin
  if new.agent_id is distinct from old.agent_id or new.agent_name is distinct from old.agent_name then
    raise exception 'The agent that sent a suggestion cannot change' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger proposals_keep_agent before update of agent_id, agent_name on public.proposals
    for each row execute function public.proposals_keep_agent();

-- An access key, by its digest: whether it is open, and the agent it is with what it may do. No
-- row for no key at all. A used key's last use moves on at most once a minute.
drop function public.serving_access_key(text);
create function public.serving_access_key(p_hash text)
    returns table (state text, agent_id uuid, permission text)
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  found_key auth.access_keys%rowtype;
begin
  select * into found_key from auth.access_keys where key_hash = p_hash;
  if not found then return; end if;
  if found_key.revoked_at is null
     and (found_key.last_used_at is null or found_key.last_used_at < now() - interval '1 minute') then
    update auth.access_keys set last_used_at = now()
     where id = found_key.id and revoked_at is null;
  end if;
  return query
    select case when found_key.revoked_at is null then 'open' else 'revoked' end, a.id, a.permission
      from auth.agents a where a.key_id = found_key.id;
end $$;
revoke all on function public.serving_access_key(text) from public;

-- The agent a person's connection signs in as, by the connection's id, with what it may do. No
-- row for a connection nobody knows here.
create function public.serving_agent_permission(p_grant uuid)
    returns table (agent_id uuid, permission text)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select a.id, a.permission
    from auth.oauth_grants g
    join auth.agents a on a.kind = 'app' and a.person_id = g.person_id and a.client_id = g.client_id
   where g.id = p_grant
$$;
revoke all on function public.serving_agent_permission(uuid) from public;
