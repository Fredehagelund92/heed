-- 0005_review_path: one review path for every context item (docs/product.md, sections 4 and 11).
--
-- Every item is checked the same way, whatever its risk level: levels 1 to 3 (format, matching
-- and delivery) must pass, and an accept by an owner of its domain or an administrator publishes
-- it (FR-205, FR-513 and FR-514 as changed). The high-risk approver leaves the gate (FR-207 is
-- withdrawn), and so do the answer tests: no suggestion waits for them, so the job that queued
-- them for normal and high-risk versions goes too. The risk column, the approver role, the
-- approver capacity of a decision and the answer levels of a check stay, for history: what was
-- decided and checked before keeps what it says.
--
-- The review of Heed v1 reads three more things:
-- - the version a suggestion was written against, so its difference is the change its writer
--   made (FR-224); src/domain/doc-diff.ts compares the two versions' Markdown;
-- - who read which suggested version, so "Publish the N you've read" publishes only what its
--   owner read (FR-226); opening a suggestion is not reading it;
-- - how a suggestion relates to live context it clashes with: it replaces it, the two disagree,
--   or they are unrelated (FR-225). Publishing waits for that answer, and each answer is kept.

-- Levels 1 to 3 at every risk level. The argument stays, so every caller keeps working.
create or replace function public.cl_required_levels(r public.risk_level) returns public.check_level[]
    language sql immutable
    as $$ select array['format','matching','delivery']::check_level[] $$;

-- The gate: an accept by an owner of the domain or an administrator (FR-202, FR-206), and every
-- required check passed (FR-205). No second accept by an approver.
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
      and (waive or d.decided_by <> v.proposer_id
           or cl_decides_own(d.decided_by, v.area_id, d.decided_at))) into owner_ok;          -- FR-202, FR-206
  if not owner_ok then return 'no accept decision by an owner of the domain or an administrator'; end if;
  if not cl_version_gate_ok(v.id) then return 'a required check has not passed'; end if;          -- FR-205
  return null;
end $$;

-- No version waits for answer tests any more, so nothing queues them.
drop function public.cl_eval_versions_due();

-- The version in service a suggested version was written against, through any resubmissions: the
-- earlier side of the review's difference, and what a publish checks is still live.
create function public.cl_proposal_base(p_version uuid) returns uuid
    language sql stable
    set search_path to 'public', 'pg_temp'
    as $$
  with recursive chain(id, supersedes, depth) as (
    select id, supersedes_version_id, 0 from item_versions where id = p_version
    union all
    select v.id, v.supersedes_version_id, c.depth + 1 from item_versions v join chain c on v.id = c.supersedes)
  select c.id from chain c
   where c.depth > 0 and exists (select 1 from item_version_service s where s.version_id = c.id)
   order by c.depth limit 1 $$;

-- Read receipts (FR-226): one row for each person and suggestion. Opening it sets opened_at; read_at
-- is set once its change was on screen long enough, or the person marked it as read. A read counts
-- only for the suggested version it was read on, so a suggestion changed since is unread again.
create table public.review_reads (
    proposal_id uuid not null references public.proposals(id),
    person_id uuid not null references public.people(id),
    item_version_id uuid references public.item_versions(id),
    opened_at timestamp with time zone default now() not null,
    read_at timestamp with time zone,
    primary key (proposal_id, person_id),
    constraint review_reads_read_after_open check (read_at is null or read_at >= opened_at),
    constraint review_reads_read_version check (read_at is null or item_version_id is not null)
);

alter table public.review_reads enable row level security;

-- A person keeps their own receipts, and only for suggestions they can see.
create policy review_reads_own on public.review_reads
    using (person_id = public.cl_person()
           and exists (select 1 from public.proposals p where p.id = review_reads.proposal_id))
    with check (person_id = public.cl_person()
           and exists (select 1 from public.proposals p where p.id = review_reads.proposal_id));

-- How a suggestion relates to a live item it clashes with (FR-225).
create type public.proposal_relation as enum (
    'replaces',
    'disagrees',
    'unrelated'
);

-- One row for each answer, never changed: the newest for a suggested version and a live item
-- counts. A change of the suggestion makes a new version, which needs its own answer.
create table public.proposal_relations (
    id uuid default uuidv7() not null primary key,
    proposal_id uuid not null references public.proposals(id),
    item_version_id uuid not null references public.item_versions(id),
    item_id text not null references public.items(id),
    relation public.proposal_relation not null,
    decided_by uuid not null references public.people(id),
    decided_at timestamp with time zone default now() not null
);

create index proposal_relations_current on public.proposal_relations
    using btree (item_version_id, item_id, decided_at desc, id desc);

select public.cl_make_append_only('public.proposal_relations');

alter table public.proposal_relations enable row level security;

-- Whoever can see the suggestion reads the answers; an owner of its domain or an administrator
-- gives one, as themselves, for the version under review and an item other than its own.
create policy proposal_relations_read on public.proposal_relations for select
    using (exists (select 1 from public.proposals p where p.id = proposal_relations.proposal_id));

create policy proposal_relations_insert on public.proposal_relations for insert
    with check (decided_by = public.cl_person()
           and exists (select 1 from public.proposals p
                        where p.id = proposal_relations.proposal_id
                          and p.item_version_id = proposal_relations.item_version_id
                          and p.state in ('submitted', 'in_review')
                          and p.item_id is distinct from proposal_relations.item_id
                          and (public.cl_is_admin_now() or public.cl_is_owner_now(p.area_id))));
