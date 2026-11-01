-- 0036_agent_policies: an owner lets one named agent publish low-risk new items in their domain
-- without a review round (FR-421; docs/ai-sign-in.md, docs/help/publish-without-review.md).
--
-- - It is off for the workspace until an administrator switches it on (`agents.auto_publish`, a
--   versioned setting, false by default). Switching it off again ends every policy there is, on
--   whatever path the setting changes (settings_auto_publish_off).
-- - A policy is one row in agent_policies: one app agent (an access key never suggests), one
--   domain, a daily cap, who set it, when and why. An owner of the domain sets it, as themselves,
--   while the workspace switch is on. A row is never
--   changed or deleted, apart from its end: Turn off ends it, with who and why. A change is a new
--   row. There is at most one open policy per agent and domain, and a policy never expires.
-- - When the agent sends a suggestion that the policy covers, the service accepts it in the same
--   transaction, through the owner's own publish path and as the owner who set the policy: the
--   decision names them as decider, with a link to the policy (decisions.auto_policy_id). The
--   serving guard (cl_item_version_problem, FR-205) is unchanged and still requires an accept by
--   an owner of the domain or an administrator, with every required check passed.
-- - cl_policy_decision_problem refuses a decision that names a policy unless every rule holds at
--   that moment: the policy is open and was set by the decider, who is still an owner of the domain,
--   decides as an owner and is the person deciding; the workspace switch is on; it is a publish of
--   a new item (never a change or an archive) the agent sent for its person, in that domain, at
--   low risk; the agent and the workspace still have suggest_context on; and the policy has not
--   reached its daily cap.
-- - Its owner, any owner of the domain or an administrator may undo such a publish later, while
--   the item is unchanged: the suggestion waits for review again (FR-227).

insert into public.settings_versions (key, version, value, reason)
values ('agents.auto_publish', 1, 'false', 'default: off until an administrator switches it on (FR-421)');

create table public.agent_policies (
    id uuid default uuidv7() primary key,
    agent_id uuid not null references auth.agents(id),
    area_id text not null references public.areas(id),
    per_day integer not null,
    set_by uuid not null references public.people(id),
    set_at timestamp with time zone default now() not null,
    reason text not null,
    ended_at timestamp with time zone,
    ended_by uuid references public.people(id),
    ended_reason text,
    constraint agent_policies_per_day_check check (per_day between 1 and 50),
    constraint agent_policies_reason_check check (char_length(btrim(reason)) between 1 and 500),
    constraint agent_policies_ended_check check (
        (ended_at is null) = (ended_by is null) and (ended_at is null) = (ended_reason is null)
        and (ended_reason is null or char_length(btrim(ended_reason)) between 1 and 500))
);

create unique index agent_policies_open on public.agent_policies using btree (agent_id, area_id)
    where ended_at is null;
create index agent_policies_area on public.agent_policies using btree (area_id, set_at desc);

-- Whether an administrator switched publishing without review on for the workspace.
create function public.cl_auto_publish_on() returns boolean
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select coalesce((select value = 'true'::jsonb from settings_current where key = 'agents.auto_publish'), false) $$;

-- A policy is for an app a person signed in with, and is set while the workspace switch is on.
-- Once set it changes only by its end, which is final.
create function public.agent_policies_guard() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
begin
  if tg_op = 'INSERT' then
    if new.ended_at is not null then
      raise exception 'A policy starts open' using errcode = 'check_violation';
    end if;
    if not exists (select 1 from auth.agents a where a.id = new.agent_id and a.kind = 'app') then
      raise exception 'Only an app a person signed in with can have a policy' using errcode = 'check_violation';
    end if;
    if not cl_auto_publish_on() then
      raise exception 'Publishing without review is off for the workspace' using errcode = 'check_violation';
    end if;
    if not cl_has_area_role(new.set_by, new.area_id, 'owner', now()) then
      raise exception 'Only an owner of the domain sets a policy' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.ended_at is not null
     or (new.id, new.agent_id, new.area_id, new.per_day, new.set_by, new.set_at, new.reason)
        is distinct from (old.id, old.agent_id, old.area_id, old.per_day, old.set_by, old.set_at, old.reason) then
    raise exception 'A policy is never changed: turn it off and set a new one' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger agent_policies_guard before insert or update on public.agent_policies
    for each row execute function public.agent_policies_guard();
create trigger agent_policies_no_delete before delete on public.agent_policies
    for each row execute function public.cl_forbid_mutation();
create trigger agent_policies_no_truncate before truncate on public.agent_policies
    for each statement execute function public.cl_forbid_mutation();

alter table public.agent_policies enable row level security;

-- Anyone signed in reads the policies: the domain page and the agent's Details show them.
create policy agent_policies_read on public.agent_policies for select
    using (public.cl_person() is not null);

-- An owner of the domain sets one, as themselves.
create policy agent_policies_insert on public.agent_policies for insert
    with check (set_by = public.cl_person() and public.cl_is_owner_now(area_id));

-- Turn off is open to whoever set it, an owner of the domain, an administrator, and the person the
-- agent works for: it only ever narrows what publishes.
create policy agent_policies_end on public.agent_policies for update
    using (ended_at is null
           and (set_by = public.cl_person() or public.cl_is_owner_now(area_id) or public.cl_is_admin_now()
                or exists (select 1 from auth.agents a where a.id = agent_id and a.person_id = public.cl_person())))
    with check (ended_by = public.cl_person());

alter table public.decisions add column auto_policy_id uuid references public.agent_policies(id);
create index decisions_auto_policy on public.decisions using btree (auto_policy_id, decided_at)
    where auto_policy_id is not null;

-- Why a decision that names a policy may not be recorded, or null when every rule of the policy holds
-- now. Runs as its owner, so it reads the agent and the setting whoever decides.
create function public.cl_policy_decision_problem(d public.decisions) returns text
    language plpgsql
    security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  pol agent_policies;
  p proposals;
  v item_versions;
  used integer;
begin
  select * into pol from agent_policies where id = d.auto_policy_id for update;
  if not found or pol.ended_at is not null then return 'the policy is off'; end if;
  if not cl_auto_publish_on() then return 'publishing without review is off for the workspace'; end if;
  if d.outcome <> 'accept' or d.proposal_id is null or d.item_version_id is null then
    return 'a policy only publishes a suggestion';
  end if;
  if d.decided_by <> pol.set_by or d.decided_by is distinct from cl_person() then
    return 'the decision is not by the person who set the policy';
  end if;
  if d.area_id is distinct from pol.area_id then return 'the policy is for another domain'; end if;
  if d.capacity::text <> 'owner' or not cl_has_area_role(d.decided_by, pol.area_id, 'owner', now()) then
    return 'the person who set the policy is no longer an owner of the domain';
  end if;
  select * into p from proposals where id = d.proposal_id;
  if p.agent_id is distinct from pol.agent_id or p.channel <> 'mcp' then
    return 'the suggestion is not from the agent of the policy';
  end if;
  if p.action <> 'create' then return 'a policy only publishes new items'; end if;
  select * into v from item_versions where id = d.item_version_id;
  if v.area_id <> pol.area_id or p.area_id is distinct from pol.area_id then
    return 'the policy is for another domain';
  end if;
  if v.risk <> 'low' then return 'a policy only publishes low-risk items'; end if;
  if not exists (select 1 from auth.agents a where a.id = pol.agent_id and a.kind = 'app'
                    and 'suggest_context' = any (a.tools)) then
    return 'suggest_context is off for the agent';
  end if;
  if not coalesce((select enabled from tool_config where tool = 'suggest_context'), false) then
    return 'suggest_context is off for the workspace';
  end if;
  select count(*) into used from decisions
   where auto_policy_id = pol.id and decided_at > now() - interval '24 hours';
  if used >= pol.per_day then return 'the policy published its most for today'; end if;
  return null;
end $$;
revoke all on function public.cl_policy_decision_problem(public.decisions) from public;

create function public.decisions_policy_guard() returns trigger
    language plpgsql
    security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare problem text;
begin
  problem := cl_policy_decision_problem(new);
  if problem is not null then
    raise exception 'Not published under the policy: %', problem using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger decisions_policy_guard before insert on public.decisions
    for each row when (new.auto_policy_id is not null)
    execute function public.decisions_policy_guard();

-- A publish under a policy is undone by its owner, by any owner of the domain or by an
-- administrator, as themselves, at any time: nobody read it before it was published. Every other
-- decision is undone only by its maker, in the window.
drop policy decision_undos_insert on public.decision_undos;
create policy decision_undos_insert on public.decision_undos for insert
    with check (undone_by = public.cl_person()
           and exists (select 1 from public.decisions d
                        where d.id = decision_undos.decision_id
                          and ((d.decided_by = public.cl_person()
                                and d.decided_at > now() - make_interval(secs => coalesce(
                                      (select (value #>> '{}')::int from public.settings_current
                                        where key = 'limits.undo_seconds'), 15)))
                               or (d.auto_policy_id is not null
                                   and (public.cl_is_owner_now(d.area_id) or public.cl_is_admin_now())))));

-- The workspace switch off ends every policy, whoever switches it and however: a new version of the
-- setting that says false. Switching it on again starts with none.
create function public.settings_auto_publish_off() returns trigger
    language plpgsql
    security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare who uuid := coalesce(new.changed_by, cl_person());
begin
  with ended as (
    update agent_policies p set ended_at = now(), ended_by = coalesce(who, p.set_by),
                                ended_reason = 'Turned off for the workspace.'
     where p.ended_at is null
    returning p.id, p.agent_id, p.area_id)
  insert into audit_log (actor_id, actor_kind, action, area_id, subject_type, subject_id, details)
  select who, case when who is null then 'system' else 'person' end, 'agent.policy_ended', e.area_id,
         'agent', e.agent_id::text,
         jsonb_build_object('name', (select a.name from auth.agents a where a.id = e.agent_id),
                            'policyId', e.id::text, 'reason', 'Turned off for the workspace.')
    from ended e;
  return null;
end $$;
create trigger settings_auto_publish_off after insert on public.settings_versions
    for each row when (new.key = 'agents.auto_publish' and new.value = 'false'::jsonb)
    execute function public.settings_auto_publish_off();

-- An app whose last open connection is revoked, by whoever and on whatever path, has every policy
-- ended with it: once it connects again, its suggestions wait for review until someone sets one
-- anew. A connection that only expires leaves its policies, as it is renewed in the usual way.
create function public.oauth_grants_end_policies() returns trigger
    language plpgsql
    security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  agent auth.agents;
  who uuid := cl_person();
begin
  select * into agent from auth.agents a
   where a.kind = 'app' and a.person_id = new.person_id and a.client_id = new.client_id;
  if not found then return null; end if;
  if exists (select 1 from auth.oauth_grants g
              where g.person_id = new.person_id and g.client_id = new.client_id
                and g.revoked_at is null and g.expires_at > now()) then
    return null;
  end if;
  with ended as (
    update agent_policies set ended_at = now(), ended_by = coalesce(who, new.person_id),
                              ended_reason = 'The agent was revoked.'
     where agent_id = agent.id and ended_at is null
    returning id, area_id)
  insert into audit_log (actor_id, actor_kind, action, area_id, subject_type, subject_id, details)
  select who, case when who is null then 'system' else 'person' end, 'agent.policy_ended', e.area_id,
         'agent', agent.id::text,
         jsonb_build_object('name', agent.name, 'policyId', e.id::text, 'reason', 'The agent was revoked.')
    from ended e;
  return null;
end $$;
create trigger oauth_grants_end_policies after update of revoked_at on auth.oauth_grants
    for each row when (old.revoked_at is null and new.revoked_at is not null)
    execute function public.oauth_grants_end_policies();
