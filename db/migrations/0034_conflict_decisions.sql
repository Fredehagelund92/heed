-- 0034_conflict_decisions: settling a conflict between two context items (FR-220, the conflict view).
--
-- - A conflict is two live items where one's version names the other as disagreeing; agents get both
--   with the Conflict state. An owner settles it here with a reason, and a line from a source if they
--   have one: one kept and the other archived, both kept, or not a conflict (the flag removed).
-- - What a decision changes goes through the paths that already guard it: an archive is a retire
--   decision, removing the flag is a new version its owner publishes. This row records the reason, the
--   versions both items had, and the decisions it made, so Undo takes back exactly those, and both
--   items' history shows it.
-- - Kept both changes nothing agents get: they keep saying Conflict. The pair leaves the conflict lists
--   and the Conflict alert while both items are still at the versions the decision saw.
-- - Everyone signed in who may read both items reads a decision; a person writes only their own, and
--   only the person who decided marks it undone. Agents never read any of it: the serving and
--   analytics roles are granted nothing here.

create table public.conflict_decisions (
    id uuid default uuidv7() not null primary key,
    holder_item_id text not null references public.items(id),
    other_item_id text not null references public.items(id),
    outcome text not null,
    kept_item_id text references public.items(id),
    reason text not null,
    quote text,
    holder_version integer not null,
    other_version integer not null,
    -- The retire and accept decisions it made, for Undo.
    decisions uuid[] default '{}' not null,
    decided_by uuid default public.cl_person() not null references public.people(id),
    decided_at timestamp with time zone default now() not null,
    undone_at timestamp with time zone,
    constraint conflict_decisions_outcome_check
      check (outcome in ('kept_one', 'kept_both', 'not_conflict')),
    constraint conflict_decisions_pair_check check (holder_item_id <> other_item_id),
    constraint conflict_decisions_kept_check check (
      (outcome = 'kept_one') = (kept_item_id is not null)
      and (kept_item_id is null or kept_item_id in (holder_item_id, other_item_id))),
    constraint conflict_decisions_reason_check check (char_length(btrim(reason)) between 1 and 500),
    constraint conflict_decisions_quote_check check (quote is null or char_length(quote) between 1 and 500),
    constraint conflict_decisions_versions_check check (holder_version >= 1 and other_version >= 1)
);
create index conflict_decisions_holder on public.conflict_decisions using btree (holder_item_id, decided_at desc);
create index conflict_decisions_other on public.conflict_decisions using btree (other_item_id, decided_at desc);

alter table public.conflict_decisions enable row level security;

-- Anyone signed in reads a decision on two items they may both read.
create policy conflict_decisions_read on public.conflict_decisions for select
    using (public.cl_person() is not null
           and public.cl_item_open(holder_item_id) and public.cl_item_open(other_item_id));
-- A person records only their own decision, on items they may read; the service checks who may settle.
create policy conflict_decisions_write on public.conflict_decisions for insert
    with check (decided_by = public.cl_person() and undone_at is null
                and public.cl_item_open(holder_item_id) and public.cl_item_open(other_item_id));
-- Only the person who decided marks it undone.
create policy conflict_decisions_undo on public.conflict_decisions for update
    using (decided_by = public.cl_person())
    with check (decided_by = public.cl_person());

-- The pairs kept as both, with the versions the decision saw, for the alert job (no person): the
-- Conflict alert leaves a topic out while every pair it shows is still as it was kept. Ids and
-- version numbers only, never a reason. Runs as the owner, so the job reads them without a person.
create function public.cl_conflicts_kept()
    returns table(holder_item_id text, other_item_id text, holder_version integer, other_version integer)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select distinct on (least(d.holder_item_id, d.other_item_id), greatest(d.holder_item_id, d.other_item_id))
         d.holder_item_id, d.other_item_id, d.holder_version, d.other_version
    from conflict_decisions d
   where d.undone_at is null and d.outcome = 'kept_both'
   order by least(d.holder_item_id, d.other_item_id), greatest(d.holder_item_id, d.other_item_id),
            d.decided_at desc, d.id desc
$$;
revoke all on function public.cl_conflicts_kept() from public;
