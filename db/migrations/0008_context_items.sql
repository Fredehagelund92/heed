-- 0008_context_items: what the Context list, a context item's page and changes to many items at
-- once keep (docs/product.md, section 3; FR-137, FR-139, FR-140).
--
-- - Kind: a context item's kind belongs to each of its versions, as its domain and words do, so an
--   owner can change it (Change kind) and the item keeps its id, history and links. Every
--   version so far takes the kind its item was created with; items.kind stays as that first kind.
--   A version's content digest has always held its kind, so sealed editions verify as before.
-- - Owners of an item: by default the owners of its domain answer for it; item_owners names
--   others for one item (several are allowed). Each must own the item's domain, or be an admin.
-- - Opened: item_reads keeps which items a person opened, in the quick view or on their page.
--   Mark as checked takes only those: checking means reading.
-- - Changes to many items at once: one item_changes row each, with what it did and what Undo
--   needs, for the History log and Settings, Advanced. Its maker undoes it within
--   limits.undo_seconds.
-- - Deleted drafts: a draft records who deleted it (the Deleted list), and that person may bring it
--   back within the same window. Published context is archived, never deleted.

-- Kind, per version. The append-only trigger is lifted for the one fill; nothing else changes.
alter table public.item_versions add column kind public.item_kind;
alter table public.item_versions disable trigger ao_row_item_versions;
update public.item_versions v set kind = i.kind from public.items i where i.id = v.item_id;
alter table public.item_versions enable trigger ao_row_item_versions;
alter table public.item_versions alter column kind set not null;

-- A version written without a kind (the seeds, a rescue) keeps the kind of the version it follows,
-- or its item's.
create function public.item_versions_default_kind() returns trigger
    language plpgsql
    as $$
begin
  if new.kind is null then
    new.kind := coalesce((select kind from item_versions where id = new.supersedes_version_id),
                         (select kind from items where id = new.item_id));
  end if;
  return new;
end $$;

create trigger item_versions_kind before insert on public.item_versions
    for each row execute function public.item_versions_default_kind();

-- What agents get, and the lists, read the kind of the version.
create or replace function public.serving_items(p_seq bigint) RETURNS TABLE(item_id text, version_id uuid, version_no integer, kind public.item_kind, area_id text, title text, summary text, body text, risk public.risk_level, claim public.claim_level, audience_groups text[], valid_from date, valid_until date, review_date date, owner_id uuid, content_digest bytea, metrics text[], value_keys text[], ref_marks jsonb, conflicts text[], replaces text[], evidence jsonb, dimension_keys text[], not_to_conclude text)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
  select s.item_id, v.id, v.version_no, v.kind, v.area_id, v.title, v.summary, v.body, v.risk, v.claim, v.audience_groups,
         v.valid_from, v.valid_until, v.review_date, v.owner_id, v.content_digest,
         coalesce((select array_agg(m.metric_key order by m.metric_key) from item_version_metrics m where m.version_id = v.id), '{}'),
         coalesce((select array_agg(d.value_key order by d.value_key) from item_version_dimension_values d where d.version_id = v.id), '{}'),
         coalesce((select jsonb_object_agg(r.definition_ref, r.change_mark) from item_version_refs r where r.version_id = v.id), '{}'),
         coalesce((select array_agg(c.other_item_id order by c.other_item_id) from item_version_conflicts c where c.version_id = v.id), '{}'),
         coalesce((select array_agg(x.replaced_item_id order by x.replaced_item_id) from item_version_replaces x where x.version_id = v.id), '{}'),
         coalesce((select jsonb_agg(jsonb_build_object('url', ev.url, 'quote', ev.quote, 'read_on', ev.read_on) order by ev.position) from item_version_evidence ev where ev.version_id = v.id), '[]'),
         coalesce((select array_agg(d.dimension_key order by d.dimension_key) from item_version_dimensions d where d.version_id = v.id), '{}'),
         v.not_to_conclude
    from item_version_service s
    join item_versions v on v.id = s.version_id
   where s.editions @> p_seq $$;


create or replace view public.v_item_current_all AS
 SELECT i.id,
    v.kind,
    c.version_id,
    v.version_no,
        CASE
            WHEN c.in_live THEN 'accepted'::text
            ELSE 'retired'::text
        END AS status,
    v.area_id,
    v.title,
    v.summary,
    v.valid_from,
    v.valid_until,
    v.validity,
    v.review_date,
    v.risk,
    v.claim,
    v.audience_groups,
    v.owner_id,
    v.proposer_id,
    v.created_via,
    v.body,
    i.created_at,
    e.created_at AS updated_at,
    v.search,
    v.summary_markup,
    v.body_markup,
    v.not_to_conclude
   FROM (((public.v_items_current c
     JOIN public.items i ON ((i.id = c.item_id)))
     JOIN public.item_versions v ON ((v.id = c.version_id)))
     JOIN public.editions e ON ((e.seq = lower(c.editions))));

create or replace function public.cl_area_deletion_plan(p_area text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'pg_temp'
    AS $$
declare v_live bigint := (select seq from live_edition); v_plan jsonb;
begin
  if not cl_is_admin_now() then
    raise exception 'only an administrator reads what deleting a domain does' using errcode = 'insufficient_privilege';
  end if;
  with live_terms as (
    select s.term_key as key, s.version_id, t.kind, t.parent_key, v.name, v.area_id
      from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
      join vocab_terms t on t.key = s.term_key
     where s.editions @> v_live),
  other_items as (
    select v.id from item_version_service s join item_versions v on v.id = s.version_id
     where s.editions @> v_live and v.area_id <> p_area),
  used as (
    select m.metric_key as key from item_version_metrics m join other_items o on o.id = m.version_id
    union select d.dimension_key from item_version_dimension_values d join other_items o on o.id = d.version_id
    union select d.value_key from item_version_dimension_values d join other_items o on o.id = d.version_id
    union select d.dimension_key from item_version_dimensions d join other_items o on o.id = d.version_id)
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.item_id, 'versionId', v.id,
                                          'title', case when cl_audience_allows(v.audience_groups) then v.title end,
                                          'withheld', not cl_audience_allows(v.audience_groups), 'kind', v.kind,
                                          'proposerId', v.proposer_id)
                       order by not cl_audience_allows(v.audience_groups), v.title, s.item_id)
        from item_version_service s join item_versions v on v.id = s.version_id
       where s.editions @> v_live and v.area_id = p_area), '[]'::jsonb),
    'terms', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'versionId', t.version_id, 'name', t.name, 'kind', t.kind,
                                          'parentKey', t.parent_key,
                                          'usedElsewhere', exists (select 1 from used u where u.key = t.key))
                       order by t.name, t.key)
        from live_terms t where t.area_id = p_area), '[]'::jsonb),
    'parentsOfOthers', coalesce((
      select jsonb_agg(distinct t.parent_key) from live_terms t
       where t.parent_key is not null and t.area_id is distinct from p_area), '[]'::jsonb),
    'sourceTerms', coalesce((
      select jsonb_agg(jsonb_build_object('key', t.key, 'name', t.name, 'kind', t.kind) order by t.name, t.key)
        from live_terms t join source_domain_service d on d.term_key = t.key and d.editions @> v_live
       where t.area_id is null and d.area_id = p_area), '[]'::jsonb),
    'openProposals', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number, 'subject', p.subject, 'revision', p.revision,
                                          'proposerId', p.proposer_id,
                                          'title', case when o.open
                                                   then coalesce(iv.title, tv.name, p.draft->>'title', p.draft->>'name', 'Untitled') end,
                                          'withheld', not o.open)
                       order by not o.open, p.number)
        from proposals p left join item_versions iv on iv.id = p.item_version_id
        left join vocab_term_versions tv on tv.id = p.vocab_version_id
        cross join lateral (select cl_item_open(p.item_id) and cl_version_open(p.item_version_id) as open) o
       where p.area_id = p_area and p.discarded_at is null and p.state in ('submitted', 'in_review', 'changes_requested')),
      '[]'::jsonb),
    'drafts', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'proposerId', p.proposer_id, 'author', a.display_name,
                                          'title', coalesce(nullif(btrim(p.draft->>'title'), ''), 'Untitled draft'))
                       order by p.created_at, p.id)
        from proposals p join people a on a.id = p.proposer_id
       where p.area_id = p_area and p.discarded_at is null and p.state = 'draft'), '[]'::jsonb),
    'team', coalesce((
      select jsonb_agg(jsonb_build_object('personId', x.person_id, 'name', a.display_name, 'role', x.role)
                       order by x.role, a.display_name, x.person_id)
        from area_assignments x join people a on a.id = x.person_id
       where x.area_id = p_area and x.valid_at @> now()), '[]'::jsonb),
    'sourceMembers', (select count(*) from definitions where area_hint = p_area and missing_since_snapshot is null),
    'history', (select h.history from cl_area_holdings(p_area) h))
  into v_plan;
  return v_plan;
end $$;


-- Who answers for an item besides the owners of its domain. Written by an owner of the item's
-- domain or an admin; the person named owns that domain or is an admin.
create table public.item_owners (
    item_id text not null references public.items(id),
    person_id uuid not null references public.people(id),
    added_by uuid not null references public.people(id),
    added_at timestamp with time zone default now() not null,
    primary key (item_id, person_id)
);

alter table public.item_owners enable row level security;

create policy item_owners_read on public.item_owners for select using (public.cl_item_open(item_id));

create policy item_owners_insert on public.item_owners for insert
    with check (added_by = public.cl_person() and exists (
        select 1 from public.v_items_current c join public.item_versions v on v.id = c.version_id
         where c.item_id = item_owners.item_id
           and (public.cl_is_admin_now() or public.cl_is_owner_now(v.area_id))
           and (public.cl_is_admin(item_owners.person_id, now())
                or public.cl_has_area_role(item_owners.person_id, v.area_id, 'owner', now()))));

create policy item_owners_delete on public.item_owners for delete using (exists (
    select 1 from public.v_items_current c join public.item_versions v on v.id = c.version_id
     where c.item_id = item_owners.item_id
       and (public.cl_is_admin_now() or public.cl_is_owner_now(v.area_id))));

-- The items a person opened: only their own rows.
create table public.item_reads (
    person_id uuid not null references public.people(id),
    item_id text not null references public.items(id),
    read_at timestamp with time zone default now() not null,
    primary key (person_id, item_id)
);

alter table public.item_reads enable row level security;

create policy item_reads_own on public.item_reads
    using (person_id = public.cl_person()) with check (person_id = public.cl_person());

-- One change to many items at once. `items` lists the rows it changed ({id, title, areaId});
-- `undo` holds what taking it back needs: the decisions it made, the drafts it deleted, the
-- owners each item had before. A deletion is read by its maker and admins only, since a draft is
-- read by its writer, its domain's owners and admins.
create table public.item_changes (
    id uuid default uuidv7() not null primary key,
    action text not null,
    made_by uuid not null references public.people(id),
    made_at timestamp with time zone default now() not null,
    summary text not null,
    items jsonb not null,
    undo jsonb default '{}'::jsonb not null,
    undone_at timestamp with time zone,
    constraint item_changes_action_check
        check (action in ('archived', 'deleted', 'moved', 'kind', 'owners', 'checked')),
    constraint item_changes_summary_check check (char_length(btrim(summary)) between 1 and 500),
    constraint item_changes_items_check check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) > 0)
);

create index item_changes_made_at on public.item_changes using btree (made_at desc);

alter table public.item_changes enable row level security;

create policy item_changes_read on public.item_changes for select
    using (action <> 'deleted' or made_by = public.cl_person() or public.cl_is_admin_now());

create policy item_changes_insert on public.item_changes for insert
    with check (made_by = public.cl_person());

-- Only its maker undoes a change, once, within the window.
create policy item_changes_undo on public.item_changes for update
    using (made_by = public.cl_person() and undone_at is null
           and made_at > now() - make_interval(secs => coalesce(
                 (select (value #>> '{}')::int from public.settings_current where key = 'limits.undo_seconds'), 15)))
    with check (made_by = public.cl_person() and undone_at is not null);

-- Who deleted a draft.
alter table public.proposals add column discarded_by uuid references public.people(id);
alter table public.proposals add constraint proposals_discarded_by_check
    check (discarded_by is null or discarded_at is not null);
create index proposals_discarded on public.proposals using btree (discarded_at desc) where (discarded_at is not null);

create or replace function public.proposals_guard_state() returns trigger
    language plpgsql
    as $$
declare
  edit_ok boolean := false;
begin
  if old.discarded_at is not null then
    -- A deleted draft comes back only as its deleter's undo, within the window: nothing else changes.
    if new.discarded_at is null and old.discarded_by = cl_person()
       and old.discarded_at > now() - make_interval(secs => coalesce(
             (select (value #>> '{}')::int from settings_current where key = 'limits.undo_seconds'), 15))
       and (to_jsonb(new) - '{discarded_at,discarded_by,revision,updated_at}'::text[])
             = (to_jsonb(old) - '{discarded_at,discarded_by,revision,updated_at}'::text[]) then
      new.discarded_by := null;
      if new.revision = old.revision then new.revision := old.revision + 1; end if;
      return new;
    end if;
    raise exception 'proposal % was discarded', old.id using errcode = 'check_violation';
  end if;
  -- Whoever deletes a draft is recorded with it, for the Deleted list.
  if new.discarded_at is not null then new.discarded_by := cl_person(); end if;
  if new.state is distinct from old.state
     and not exists (select 1 from proposal_transitions t where t.from_state = old.state and t.to_state = new.state) then
    raise exception 'proposal % cannot move from % to %', old.id, old.state, new.state using errcode = 'check_violation';
  end if;
  -- After submit the version is fixed, except for a review edit: a new version of the same item, edited by the person
  -- making this change, that supersedes the submitted one and keeps its content.
  if old.item_version_id is not null and new.item_version_id is distinct from old.item_version_id and old.state <> 'changes_requested' then
    edit_ok := coalesce(
       old.state in ('submitted', 'in_review') and new.state = old.state and old.action in ('create', 'change')
       and new.item_id = old.item_id
       and exists (select 1 from item_versions v where v.id = new.item_version_id and v.item_id = old.item_id
                     and v.supersedes_version_id = old.item_version_id and v.edited_by = cl_person() and not v.is_recheck
                     and exists (select 1 from item_versions o where o.id = old.item_version_id
                                   and cl_has_area_role(cl_person(), o.area_id, 'owner', now()))
                     and (v.area_id = (select o.area_id from item_versions o where o.id = old.item_version_id)
                          or cl_is_admin(cl_person(), now())
                          or cl_has_area_role(cl_person(), v.area_id, 'owner', now()))
                     and ((v.proposer_id is distinct from cl_person()
                           and cl_item_version_kept(new.item_version_id) = cl_item_version_kept(old.item_version_id))
                          or (cl_item_version_kept(new.item_version_id) - 'replaces' - 'conflicts'
                                = cl_item_version_kept(old.item_version_id) - 'replaces' - 'conflicts'
                              and cl_item_version_kept(new.item_version_id) <> cl_item_version_kept(old.item_version_id)
                              and (cl_item_version_kept(new.item_version_id) -> 'replaces')
                                    @> (cl_item_version_kept(old.item_version_id) -> 'replaces')
                              and (cl_item_version_kept(new.item_version_id) -> 'conflicts')
                                    @> (cl_item_version_kept(old.item_version_id) -> 'conflicts')))), false);
    if not edit_ok then
      raise exception 'proposal % version is fixed after submit', old.id using errcode = 'check_violation';
    end if;
  end if;
  if new.revision = old.revision then new.revision := old.revision + 1; end if;
  return new;
end $$;
