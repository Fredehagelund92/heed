-- 0022_alerts: alert rules that raise Inbox cards (FR-621, golden plan P12, part 3).
--
-- - Eight rules (src/domain/alerts.ts), one row each: on or off for everyone, and a threshold an
--   administrator picks. The Not found rule's threshold is the gap detection's own setting
--   (gaps.no_item_threshold), so it has none here.
-- - An owner mutes a rule for a domain they own: its raises stop reaching them for that domain,
--   and still reach the domain's other owners and the administrators.
-- - The alert job (alerts.raise, every 15 minutes beside gaps.detect) raises what a rule finds
--   through cl_alert_raise: one row here, keyed on what it was about, so a second run raises
--   nothing new, and one outbox event in the same transaction. The relay delivers it as Inbox
--   items to the rule's audience, less those who muted it for the domain. Nothing sends an email.
-- - A raise keeps a title made from counts and scopes only, a small count already hidden
--   (FR-614), and never anyone's words. Administrators read every raise; an owner reads those
--   about a domain they own. Agents never read any of it: the serving and analytics roles are
--   granted nothing here.

create table public.alert_rules (
    rule text not null primary key,
    enabled boolean default true not null,
    threshold integer,
    audience text not null,
    changed_by uuid references public.people(id),
    changed_at timestamp with time zone,
    constraint alert_rules_rule_check
      check (rule in ('gap', 'saved', 'disagree', 'share', 'fail', 'spend', 'sync', 'due')),
    constraint alert_rules_audience_check check (audience in ('owners', 'admins', 'both')),
    constraint alert_rules_threshold_check check (threshold is null or threshold between 1 and 100),
    constraint alert_rules_changed_check check ((changed_by is null) = (changed_at is null))
);

insert into public.alert_rules (rule, threshold, audience) values
  ('gap', null, 'owners'),
  ('saved', null, 'owners'),
  ('disagree', 3, 'owners'),
  ('share', 20, 'admins'),
  ('fail', 5, 'admins'),
  ('spend', 80, 'admins'),
  ('sync', null, 'both'),
  ('due', null, 'owners');

create table public.alert_mutes (
    person_id uuid not null references public.people(id),
    area_id text not null references public.areas(id),
    rule text not null references public.alert_rules(rule),
    muted_at timestamp with time zone default now() not null,
    primary key (person_id, area_id, rule)
);

create table public.alert_raises (
    id uuid default uuidv7() not null primary key,
    rule text not null references public.alert_rules(rule),
    -- What it was about, and when: the same key raises once.
    key text not null,
    -- The domains it is about; none for a rule about the whole workspace.
    area_ids text[] default '{}' not null,
    title text not null,
    -- Where it sends people: the card it raised, or the page it is about (RaiseSubject).
    subject jsonb not null,
    raised_at timestamp with time zone default now() not null,
    event_seq bigint,
    constraint alert_raises_key_unique unique (rule, key),
    constraint alert_raises_key_check check (char_length(key) between 1 and 200),
    constraint alert_raises_title_check check (char_length(title) between 1 and 300),
    constraint alert_raises_subject_check
      check (jsonb_typeof(subject) = 'object' and octet_length(subject::text) <= 500)
);
create index alert_raises_raised on public.alert_raises using btree (raised_at desc);
create index alert_raises_rule on public.alert_raises using btree (rule, raised_at desc);

alter table public.alert_rules enable row level security;
alter table public.alert_mutes enable row level security;
alter table public.alert_raises enable row level security;

-- Everyone signed in, and the alert job, read the rules; administrators change them.
create policy alert_rules_read on public.alert_rules for select using (true);
create policy alert_rules_change on public.alert_rules for update
    using (public.cl_is_admin_now())
    with check (public.cl_is_admin_now() and changed_by = public.cl_person());

-- A person reads their own mutes, and mutes only for a domain they own.
create policy alert_mutes_read on public.alert_mutes for select
    using (person_id = public.cl_person());
create policy alert_mutes_insert on public.alert_mutes for insert
    with check (person_id = public.cl_person() and public.cl_is_owner_now(area_id));
create policy alert_mutes_delete on public.alert_mutes for delete
    using (person_id = public.cl_person());

-- Administrators read every raise, an owner those about a domain they own, and the alert job
-- (no person, no source) every one, to find what it raised last.
create policy alert_raises_read on public.alert_raises for select
    using (public.cl_is_admin_now()
           or exists (select 1 from unnest(area_ids) a where public.cl_is_owner_now(a))
           or (public.cl_person() is null and public.cl_source() is null));

-- Raises what a rule found, once for its key, while the rule is on, with its outbox event in the
-- same transaction. Only the alert job raises: it runs as no person and no source.
create function public.cl_alert_raise(p_rule text, p_key text, p_areas text[], p_title text,
                                      p_subject jsonb)
    returns uuid
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare v_id uuid; v_seq bigint;
begin
  if cl_person() is not null or cl_source() is not null then
    raise exception 'Only the alert job raises alerts' using errcode = 'insufficient_privilege';
  end if;
  if not coalesce((select enabled from alert_rules where rule = p_rule), false) then
    return null;
  end if;
  insert into alert_raises (rule, key, area_ids, title, subject)
  values (p_rule, p_key, coalesce(p_areas, '{}'), p_title, p_subject)
  on conflict (rule, key) do nothing
  returning id into v_id;
  if v_id is null then return null; end if;
  insert into outbox_events (topic, area_id, aggregate_type, aggregate_id, payload, actor_id)
  values ('alert.raised', case when cardinality(p_areas) = 1 then p_areas[1] end, 'alert', v_id::text,
          jsonb_build_object('rule', p_rule, 'areas', to_jsonb(coalesce(p_areas, '{}'))), null)
  returning seq into v_seq;
  update alert_raises set event_seq = v_seq where id = v_id;
  return v_id;
end $$;

-- Who each raise reached, by name, for the raises the reader may read: the people the relay
-- delivered it to. Runs as the owner, since each Inbox item is its own person's.
create function public.cl_alert_reached(p_raises uuid[])
    returns table(raise_id uuid, names text[])
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select r.id, coalesce(array_agg(p.display_name order by p.display_name)
                          filter (where p.display_name is not null), '{}')
    from alert_raises r
    left join inbox_items i on i.event_seq = r.event_seq
    left join people p on p.id = i.person_id and p.erased_at is null
   where r.id = any(p_raises)
     and (cl_is_admin_now() or exists (select 1 from unnest(r.area_ids) a where cl_is_owner_now(a)))
   group by r.id $$;

-- The saved questions that need a look now, by their latest result, with when each came to need
-- one: for the alert job (no person, no source), or the reader's own domains. Runs as the owner,
-- so the job reads them without a person.
create function public.cl_saved_looks()
    returns table(area_id text, question_id uuid, since timestamp with time zone)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select q.area_id, q.id,
         (select min(x.checked_at) from saved_question_results x
           where x.question_id = q.id
             and x.checked_at > coalesce((select max(y.checked_at) from saved_question_results y
                                           where y.question_id = q.id and y.result <> 'look'),
                                         '-infinity'::timestamptz))
    from saved_questions q
    join lateral (select x.result from saved_question_results x where x.question_id = q.id
                   order by x.checked_at desc, x.run_id desc limit 1) r on true
   where q.removed_at is null and r.result = 'look'
     and ((cl_person() is null and cl_source() is null) or cl_is_admin_now() or cl_is_owner_now(q.area_id))
   order by q.area_id, q.created_at, q.id $$;

-- The domains whose live items rely on a connector's definitions: whose owners hear that it did
-- not sync. Runs as the owner, so the alert job reads it without a person.
create function public.cl_connector_domains(p_connector text)
    returns text[]
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select coalesce(array_agg(distinct v.area_id order by v.area_id), '{}')
    from item_version_service s
    join item_versions v on v.id = s.version_id
    join item_version_refs r on r.version_id = v.id
    join definitions d on d.ref = r.definition_ref
   where upper_inf(s.editions) and d.connector_id = p_connector $$;

-- Who an event tells: as before, and a raised alert tells its rule's audience: the
-- administrators, the owners of the domains it is about less those who muted the rule for that
-- domain, or both.
create or replace function public.cl_inbox_recipients(e public.outbox_events) returns setof uuid
    language plpgsql stable
    set search_path to 'public', 'pg_temp'
    as $$
declare p proposals; reviewers uuid[]; owners uuid[]; discussing uuid[]; v_audience text; v_areas text[];
begin
  if e.topic = 'alert.raised' then
    v_audience := (select audience from alert_rules where rule = e.payload->>'rule');
    v_areas := array(select jsonb_array_elements_text(coalesce(e.payload->'areas', '[]'::jsonb)));
    return query
      select distinct r from (
        select g.person_id as r from global_role_grants g
         where v_audience in ('admins', 'both') and g.role = 'administrator' and g.valid_at @> now()
        union
        select a.person_id from area_assignments a
         where v_audience in ('owners', 'both') and a.area_id = any(v_areas) and a.role = 'owner'
           and a.valid_at @> now()
           and not exists (select 1 from alert_mutes m
                            where m.person_id = a.person_id and m.area_id = a.area_id
                              and m.rule = e.payload->>'rule')) x
      join people x2 on x2.id = x.r
     where x2.deactivated_at is null and x2.erased_at is null;
    return;
  end if;
  if e.topic = 'area.deleted' then
    return query
      select distinct r from area_deletions d cross join unnest(d.recipients) r join people x on x.id = r
       where d.id = (e.payload->>'deletion')::uuid
         and x.deactivated_at is null and x.erased_at is null and r is distinct from e.actor_id;
    return;
  end if;
  if e.topic in ('item.flagged', 'item.links_stale', 'vocabulary.domain_changed', 'gap.verified',
                 'source.suggested', 'source.document_gone') then
    owners := case when e.area_id is null then array(
        select g.person_id from global_role_grants g where g.role = 'administrator' and g.valid_at @> now())
      else array(
        select a.person_id from area_assignments a
         where a.area_id = e.area_id and a.role = 'owner' and a.valid_at @> now()) end;
    return query
      select distinct r from unnest(owners) r join people x on x.id = r
       where x.deactivated_at is null and x.erased_at is null and r is distinct from e.actor_id;
    return;
  end if;
  if e.aggregate_type <> 'proposal' then return; end if;
  select * into p from proposals where id = e.aggregate_id::uuid;
  if not found then return; end if;
  reviewers := case when p.claimed_by is not null then array[p.claimed_by] else array(
    select a.person_id from area_assignments a
     where a.area_id = p.area_id and a.role = 'owner' and a.valid_at @> now()) end;
  discussing := case when p.claimed_by is null and p.area_id is null and p.subject = 'vocabulary' then array(
    select g.person_id from global_role_grants g where g.role = 'administrator' and g.valid_at @> now())
    else reviewers end;
  return query
    select distinct r from unnest(case e.topic
        when 'proposal.submitted'   then reviewers
        when 'proposal.commented'   then array[p.proposer_id] || discussing
        when 'proposal.claimed'     then array[p.proposer_id]
        when 'proposal.handed_over' then array[(e.payload->>'personId')::uuid]
        when 'proposal.withdrawn'   then reviewers
        when 'proposal.decided'     then array[p.proposer_id]
        else '{}'::uuid[] end) r
      join people x on x.id = r
     where x.deactivated_at is null and x.erased_at is null and r is distinct from e.actor_id;
end $$;
