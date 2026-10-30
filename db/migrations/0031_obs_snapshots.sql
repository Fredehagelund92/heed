-- 0031_obs_snapshots: a stored snapshot of Observability's Summary for each whole month, kept
-- without limit (FR-612, FR-620).
--
-- Summary reads the delivery records, which retention drops after `retention.delivery_days` (180 by
-- default), so a month read again later would show other numbers, or none. A snapshot keeps what
-- the page said when it was taken, so a digest printed from it says the same thing a year later.
--
-- - `obs_snapshots` keeps, for each whole calendar month and each scope (every domain, or one
--   domain), the Summary's numbers as they were shown: every count already through the disclosure
--   pass (FR-614), so a count under the minimum is kept as hidden, never as its value; and the
--   sentences made from them by fixed templates. Counts only: never the words of a question, never
--   a topic, an item or any scope finer than the domain, never who asked or who approved (FR-602,
--   FR-613). `summary` is the service's own JSON; check constraints refuse anything but an object
--   of a bounded size, a month's first day, and a random id.
-- - A month and scope has one snapshot, never changed once taken: the `observability.snapshot`
--   job takes the last whole month's each night until it has one, and an administrator can take it
--   at once. Both run the same service code.
-- - It is kept without limit, the deliberate exception to the delivery period, as `obs_weekly` is.
--   Retention never deletes it.
-- - `cl_obs_changes(areas, from, to)` counts the changes published after review in some days, in
--   some domains (all when null). It runs as the owner, so the count is the same whoever reads:
--   an administrator, an owner of the domains, or the job, which reads as no person.

create table public.obs_snapshots (
    id uuid default gen_random_uuid() not null primary key
      constraint obs_snapshots_id_check check (uuid_extract_version(id) = 4),
    period text not null constraint obs_snapshots_period_check check (period = 'month'),
    starts date not null
      constraint obs_snapshots_starts_check check (starts = (date_trunc('month', starts::timestamp))::date),
    area_id text references public.areas(id),
    taken_on date not null,
    summary jsonb not null
      constraint obs_snapshots_summary_check
      check (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 20000),
    constraint obs_snapshots_key unique nulls not distinct (period, starts, area_id)
);
create index obs_snapshots_area on public.obs_snapshots using btree (area_id, starts desc);

alter table public.obs_snapshots enable row level security;

-- Administrators read every snapshot, an owner those of a domain they own, and the snapshot job
-- (no person, no source) every one, to find what it already took.
create policy obs_snapshots_read on public.obs_snapshots for select
    using (public.cl_is_admin_now()
           or (area_id is not null and public.cl_is_owner_now(area_id))
           or (public.cl_person() is null and public.cl_source() is null));

-- Taken by the job (no person, no source) or by an administrator; never changed or deleted.
create policy obs_snapshots_insert on public.obs_snapshots for insert
    with check (public.cl_is_admin_now()
                or (public.cl_person() is null and public.cl_source() is null));

-- The changes published after review from p_from up to, not including, p_to, about an item in one
-- of p_areas (every domain when null).
create function public.cl_obs_changes(p_areas text[], p_from date, p_to date) returns integer
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select count(*)::int
    from editions e
    join lateral (
      select s.version_id from item_version_service s
       where lower(s.editions) = e.seq order by s.item_id limit 1) s on true
    join item_versions v on v.id = s.version_id
   where e.reason = 'proposal_accepted'
     and e.created_at >= p_from::timestamp at time zone 'UTC'
     and e.created_at < p_to::timestamp at time zone 'UTC'
     and (p_areas is null or v.area_id = any(p_areas)) $$;

revoke execute on function public.cl_obs_changes(text[], date, date) from public;
