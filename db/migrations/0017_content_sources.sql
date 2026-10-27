-- 0017_content_sources: content sources turn documents into suggestions (CON-601 to CON-611).
--
-- A content source reads documents from the scopes an administrator chose (folders, spaces or
-- pages), each mapped to one domain, and turns each new or changed document into at most one
-- suggestion for that domain's owners, through the same checks as any proposal. A read never
-- accepts, publishes or changes an item or an edition (CON-604): only an owner does.
--
-- - A suggestion a read made is created by the read, not by a person: its proposer is nobody,
--   its channel is `source`, and it names the source and the read that made it. Its version is
--   created via `source` with no proposer too. A person who edits it in review is its editor, as
--   for any suggestion. Row security lets a read's own transaction (`cl.source_id`, never set by
--   a person's request) write and read the suggestions of its source, and nothing else.
-- - `connector_documents` keeps, per document, only what CON-605 allows: its id in the tool, its
--   scope, title and link, the change mark of the text last handled, a quote of at most 500
--   characters, and what the pipeline did with it. Never the text.
-- - A read is one `connector_snapshots` row for both kinds of source, so health, the operations
--   view and the watchdog see them the same way; a content read counts what it did.
-- - Each source has its own schedule (CON-115): how often it is read, when next, and how many
--   reads in a row failed for a reason that clears by itself (backoff). Content sources keep the
--   scopes chosen for them.
-- - Owners are told once per source per read (`source.suggested`), and an item whose document
--   is gone is listed for its owners (`source.document_gone`, CON-609).

-- The source a transaction reads for, set by the content pipeline only: null in a person's request.
create function public.cl_source() returns text
    language sql stable
    as $$ select nullif(current_setting('cl.source_id', true), '') $$;

-- Sources: their scopes and their schedule.
alter table public.connectors
  add column scopes jsonb not null default '[]'::jsonb
    constraint connectors_scopes_check check (jsonb_typeof(scopes) = 'array' and jsonb_array_length(scopes) <= 200),
  add column schedule interval
    constraint connectors_schedule_check check (schedule is null or schedule >= interval '1 minute'),
  add column next_read_at timestamp with time zone,
  add column failures integer not null default 0
    constraint connectors_failures_check check (failures >= 0);

-- A read of a content source counts what it did. The connector's version is kept on every read.
alter table public.connector_snapshots
  add column connector_version text
    constraint connector_snapshots_connector_version_check check (char_length(connector_version) <= 100),
  add column documents_seen integer not null default 0,
  add column suggested integer not null default 0,
  add column replaced integer not null default 0,
  add column withdrawn integer not null default 0,
  add column waiting integer not null default 0,
  add column skipped integer not null default 0,
  add constraint connector_snapshots_counts_check
    check (least(documents_seen, suggested, replaced, withdrawn, waiting, skipped) >= 0);

-- A suggestion made by a read: nobody proposed it, and it names its source, its read and its document.
alter table public.proposals
  alter column proposer_id drop not null,
  add column source_id text references public.connectors(id),
  add column source_read_id uuid references public.connector_snapshots(id),
  add column source_document_id text,
  add constraint proposals_source_check check (
    (channel = 'source') = (proposer_id is null)
    and (channel = 'source') = (source_id is not null)
    and (channel = 'source') = (source_read_id is not null)
    and (channel = 'source') = (source_document_id is not null));
create index proposals_source on public.proposals using btree (source_id, created_at desc)
  where (source_id is not null);

alter table public.proposals drop constraint proposals_provenance_check;
alter table public.proposals add constraint proposals_provenance_check check (
  provenance is null or (jsonb_typeof(provenance) = 'object'
    and (provenance ->> 'by') = any (array['agent', 'assistant', 'source'])
    and jsonb_typeof(provenance -> 'fields') = 'object'
    and jsonb_typeof(provenance -> 'flags') = 'array'));

alter table public.item_versions
  alter column proposer_id drop not null,
  add constraint item_versions_source_check check ((created_via = 'source') = (proposer_id is null));

-- What a read knew about each document of a content source. Never its text (CON-605).
create table public.connector_documents (
    source_id text not null references public.connectors(id),
    document_id text not null constraint connector_documents_document_id_check
      check (char_length(document_id) between 1 and 500),
    scope text not null constraint connector_documents_scope_check check (char_length(scope) between 1 and 500),
    title text not null constraint connector_documents_title_check check (char_length(title) between 1 and 300),
    link text not null constraint connector_documents_link_check
      check (link ~ '^https://' and char_length(link) <= 2000),
    modified_at timestamp with time zone not null,
    change_mark text not null constraint connector_documents_change_mark_check check (change_mark ~ '^[a-f0-9]{64}$'),
    quote text not null constraint connector_documents_quote_check check (char_length(quote) <= 500),
    -- drafted: its suggestion is `proposal_id`; waiting: past the day's drafts, it goes first next
    -- time; skipped: it is not offered (`skip_reason`); gone: deleted, or out of the chosen scopes.
    state text not null constraint connector_documents_state_check
      check (state in ('drafted', 'waiting', 'skipped', 'gone')),
    skip_reason text constraint connector_documents_skip_reason_check
      check ((state = 'skipped') = (skip_reason is not null)
             and (skip_reason is null or skip_reason ~ '^[a-z][a-z_]{1,39}$')),
    proposal_id uuid references public.proposals(id),
    first_read_id uuid not null references public.connector_snapshots(id),
    last_read_id uuid not null references public.connector_snapshots(id),
    first_seen_at timestamp with time zone default now() not null,
    last_seen_at timestamp with time zone default now() not null,
    gone_at timestamp with time zone,
    constraint connector_documents_gone_check check ((state = 'gone') = (gone_at is not null)),
    constraint connector_documents_drafted_check check (state <> 'drafted' or proposal_id is not null),
    primary key (source_id, document_id)
);
create index connector_documents_proposal on public.connector_documents using btree (proposal_id)
  where (proposal_id is not null);
alter table public.proposals add constraint proposals_source_document_fkey
  foreign key (source_id, source_document_id) references public.connector_documents(source_id, document_id);

-- Row security: a read's transaction names its source (cl_source) and no person; it writes the
-- suggestions of that source and their versions, and reads them back.
create policy proposals_source on public.proposals
  using (cl_person() is null and source_id = cl_source())
  with check (cl_person() is null and source_id = cl_source() and channel = 'source' and proposer_id is null);
create policy item_versions_source_insert on public.item_versions for insert
  with check (cl_person() is null and cl_source() is not null and created_via = 'source' and proposer_id is null);
create policy item_versions_source_read on public.item_versions for select
  using (cl_person() is null and cl_source() is not null and created_via = 'source');
do $$
declare t text;
begin
  foreach t in array array['item_version_conflicts', 'item_version_dimension_values', 'item_version_dimensions',
    'item_version_evidence', 'item_version_mentions', 'item_version_metrics', 'item_version_refs', 'item_version_replaces']
  loop
    execute format(
      'create policy version_child_source_insert on public.%I for insert with check (
         cl_person() is null and cl_source() is not null and exists (
           select 1 from public.item_versions v where v.id = %I.version_id and v.created_via = %L))',
      t, t, 'source');
  end loop;
end $$;

-- The gate (FR-202, FR-206): a suggestion nobody proposed is decided like any other; the owner who
-- publishes it is not its proposer.
create or replace function public.cl_item_version_problem(p_version uuid) returns text
    language plpgsql stable
    as $$
declare v item_versions; prev item_versions; owner_ok boolean; waive boolean := false;
begin
  select * into v from item_versions where id = p_version;
  if not found then return 'version does not exist'; end if;
  if v.is_recheck then                       -- CON-211: only change marks / review date may differ
    select * into prev from item_versions where id = v.supersedes_version_id;
    if not found or prev.core_digest <> v.core_digest then return 'a recheck must keep the content of the version it checks'; end if;
    waive := true;
  end if;
  select exists (select 1 from decisions d
    where d.item_version_id = v.id and d.outcome = 'accept' and d.area_id = v.area_id
      and ((d.capacity in ('owner', 'deputy') and cl_has_area_role(d.decided_by, v.area_id, 'owner', d.decided_at))
        or (d.capacity = 'administrator' and cl_is_admin(d.decided_by, d.decided_at)))
      and (waive or d.decided_by is distinct from v.proposer_id
           or cl_decides_own(d.decided_by, v.area_id, d.decided_at))) into owner_ok;          -- FR-202, FR-206
  if not owner_ok then return 'no accept decision by an owner of the domain or an administrator'; end if;
  if not cl_version_gate_ok(v.id) then return 'a required check has not passed'; end if;          -- FR-205
  return null;
end $$;

-- Who an event tells: as before, and a content source's read tells its domain's owners once, as
-- does a document gone from under an item (CON-609).
create or replace function public.cl_inbox_recipients(e public.outbox_events) returns setof uuid
    language plpgsql stable
    set search_path to 'public', 'pg_temp'
    as $$
declare p proposals; reviewers uuid[]; owners uuid[]; discussing uuid[];
begin
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

-- A read numbers the versions of the suggestions it makes, as a person's request does.
create or replace function public.cl_next_item_version(p_item text) returns integer
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
begin
  if cl_person() is null and cl_source() is null then
    raise exception 'Sign in required' using errcode='insufficient_privilege';
  end if;
  perform 1 from items where id=p_item for update;
  return (select coalesce(max(version_no),0)+1 from item_versions where item_id=p_item);
end $$;
