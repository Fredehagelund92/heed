-- 0006_inbox_and_undo: what the Inbox and the review's decisions keep (docs/product.md, sections 4
-- and 5; FR-227, FR-816).
--
-- - Undo (FR-227): the person who made a decision takes it back within a short window
--   (`limits.undo_seconds`). The undo is a new edition, with its own reason, that serves again
--   what the decision changed, and a row in decision_undos that says so. A suggestion whose
--   publish was undone waits for a decision again. Nothing is deleted: decisions stay as they
--   were, and the undo is history beside them.
-- - Cards: the Inbox shows cards made from today's records (suggestions, gaps, reports, items due
--   for a check). card_reads keeps which ones a person opened; card_states keeps a card closed for
--   every owner, such as a report that is not a problem. A report is anonymous: its card is named
--   by text, never by a key into the anonymous tables, so nothing joins a person to it.
-- - Setup: the checklist of a new workspace is read from what exists, except a question asked in
--   Ask, which keeps no record of its own (FR-602); setup_marks keeps only that a step happened,
--   never who or what.

alter type public.edition_reason add value 'decision_undone';

-- How long after a decision its maker may undo it. The screens offer Undo for 6 seconds; the
-- window is longer, so a slow connection still lands in it.
insert into public.settings_versions (key, version, value, reason)
values ('limits.undo_seconds', 1, '15', 'default (FR-227)');

-- One undo of one decision, by the person who made it, in the edition that undid it (null when
-- the decision published nothing, such as a return with a note).
create table public.decision_undos (
    decision_id uuid not null primary key references public.decisions(id),
    undone_by uuid not null references public.people(id),
    undone_at timestamp with time zone default now() not null,
    edition_seq bigint references public.editions(seq),
    created_xact xid8 default pg_current_xact_id() not null
);

select public.cl_make_append_only('public.decision_undos');

alter table public.decision_undos enable row level security;

-- Whoever reads the decision reads its undo; only its maker undoes it, in the window, as themselves.
create policy decision_undos_read on public.decision_undos for select
    using (exists (select 1 from public.decisions d where d.id = decision_undos.decision_id));

create policy decision_undos_insert on public.decision_undos for insert
    with check (undone_by = public.cl_person()
           and exists (select 1 from public.decisions d
                        where d.id = decision_undos.decision_id and d.decided_by = public.cl_person()
                          and d.decided_at > now() - make_interval(secs => coalesce(
                                (select (value #>> '{}')::int from public.settings_current
                                  where key = 'limits.undo_seconds'), 15))));

-- A person decides a version once, unless they undid that decision: the next one is a new round.
-- A second click of the same decision still finds the first and records nothing.
alter table public.decisions add column round smallint default 0 not null;
alter table public.decisions add constraint decisions_round_check check (round >= 0);
drop index public.decisions_once_item;
create unique index decisions_once_item on public.decisions
    using btree (item_version_id, decided_by, outcome, round) where (item_version_id is not null);

-- An item leaves service in an undo edition only when that edition records the undo.
create or replace function public.item_version_service_closing_authorized() returns trigger
    language plpgsql
    as $$
declare e editions;
begin
  select * into e from editions where seq = upper(new.editions);
  if e.reason = 'rollback' then return null; end if;                                  -- edition_seal proves content equality
  if e.reason = 'decision_undone' and exists (select 1 from decision_undos u where u.edition_seq = e.seq) then return null; end if;
  if exists (select 1 from decisions d where d.item_version_id = new.version_id and d.outcome = 'retire'
             and d.area_id = (select area_id from item_versions where id = new.version_id)
             and (cl_is_admin(d.decided_by, d.decided_at)
                  or cl_has_area_role(d.decided_by, d.area_id, 'owner', d.decided_at))) then return null; end if;
  if exists (select 1 from item_version_service s where s.item_id = new.item_id and lower(s.editions) = upper(new.editions)) then return null; end if;
  if exists (select 1 from item_version_service s join item_version_replaces r on r.version_id = s.version_id
             where r.replaced_item_id = new.item_id and lower(s.editions) = upper(new.editions)) then return null; end if;
  raise exception 'item % left service at edition % without a retire decision or a replacing version', new.item_id, upper(new.editions)
    using errcode = 'check_violation';
end $$;

-- The owner's answer to a clash (FR-225) goes on the version under review: "replaces" names the
-- live item in its replaced items and "disagrees" in its conflicts. That is a review edit like the
-- others (a new version of the same item that supersedes the submitted one), and it may change only
-- those two lists, adding to them. It may be made by the proposer too, when they own the domain:
-- naming a relation never lowers the bar of their own suggestion.
create or replace function public.proposals_guard_state() returns trigger
    language plpgsql
    as $$
declare
  edit_ok boolean := false;
begin
  if old.discarded_at is not null then
    raise exception 'proposal % was discarded', old.id using errcode = 'check_violation';
  end if;
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

-- A published suggestion waits again, and only when its accept is undone in the same transaction.
insert into public.proposal_transitions (from_state, to_state) values ('accepted', 'submitted');

create function public.proposals_guard_reopen() returns trigger
    language plpgsql
    as $$
begin
  if old.state = 'accepted' and new.state = 'submitted'
     and not exists (select 1 from decision_undos u join decisions d on d.id = u.decision_id
                      where d.proposal_id = new.id and d.outcome in ('accept', 'retire')
                        and u.created_xact = pg_current_xact_id()) then
    raise exception 'proposal % reopens only when its accept is undone', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger proposals_reopen before update of state on public.proposals
    for each row execute function public.proposals_guard_reopen();

-- Which cards a person opened. A card is named by what it shows ("gap:<id>", "check:<item>",
-- "feedback:<id>"); a suggestion's card is its review_reads row instead.
create table public.card_reads (
    person_id uuid not null references public.people(id),
    card text not null,
    read_at timestamp with time zone default now() not null,
    primary key (person_id, card),
    constraint card_reads_card_check check (card ~ '^[a-z]+:[A-Za-z0-9_.:-]{1,80}$')
);

alter table public.card_reads enable row level security;

create policy card_reads_own on public.card_reads
    using (person_id = public.cl_person()) with check (person_id = public.cl_person());

-- A card closed for every owner of its domain, by one of them or an administrator: a report that
-- is not a problem. Opening it again (an undo) removes the row.
create table public.card_states (
    card text not null primary key,
    area_id text not null references public.areas(id),
    state text not null,
    decided_by uuid not null references public.people(id),
    decided_at timestamp with time zone default now() not null,
    constraint card_states_card_check check (card ~ '^[a-z]+:[A-Za-z0-9_.:-]{1,80}$'),
    constraint card_states_state_check check (state in ('closed'))
);

alter table public.card_states enable row level security;

create policy card_states_read on public.card_states for select
    using (public.cl_is_admin_now() or public.cl_is_owner_now(area_id));

create policy card_states_insert on public.card_states for insert
    with check (decided_by = public.cl_person() and (public.cl_is_admin_now() or public.cl_is_owner_now(area_id)));

create policy card_states_delete on public.card_states for delete
    using (decided_by = public.cl_person() and decided_at > now() - make_interval(secs => coalesce(
             (select (value #>> '{}')::int from public.settings_current where key = 'limits.undo_seconds'), 15)));

-- The steps of the setup checklist that leave no other record: when one first happened.
create table public.setup_marks (
    step text not null primary key,
    done_at timestamp with time zone default now() not null,
    constraint setup_marks_step_check check (step in ('ask'))
);
