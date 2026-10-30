-- 0029_obs_weekly: weekly counts of what agents asked, kept without limit (FR-612, FR-620).
--
-- Observability reads the delivery records, which retention drops after `retention.delivery_days`
-- (180 by default), so a trend longer than that, or a summary over a year, has nothing left to
-- read. `topic_week_counts` outlives them, but per topic and by the resolver's status (matched,
-- no match), not by the five answer states a chart tells apart.
--
-- - `obs_weekly` keeps, for each completed week (Monday to Sunday, in UTC), how many agent calls
--   each domain had in each of the five answer states (grounded, partial, conflict, stale,
--   missing). Counts only: never the words of a question,
--   never a topic or any scope finer than the domain, never who asked (FR-602, FR-613). A call
--   about a topic with no domain counts with no domain. A call that failed its check, or that
--   could not be read, is not in it, as in Observability's views.
-- - It is kept without limit, the deliberate exception to the delivery period: FR-612 keeps counts
--   once the records go. Small counts are kept as they are and hidden when they are read (FR-614).
-- - `cl_obs_weekly_rollup(week)` counts one week again from the deliveries and replaces what was
--   kept for it, so running it twice keeps the same counts. A week whose deliveries retention may
--   have started to drop is left as it was kept: counting it again would make it smaller.
-- - `cl_obs_weekly_rollup_due(today)`, which the `observability.rollup` job runs each night,
--   counts every completed week from the latest one kept (again, for a call that came in late) up
--   to the week of `today`, or from the oldest delivery when nothing is kept yet.
-- - This migration counts every completed week the deliveries still hold, once.

create table public.obs_weekly (
    week date not null
      constraint obs_weekly_week_check check (week = (date_trunc('week', week::timestamp))::date),
    area_id text references public.areas(id),
    answer_state text not null
      constraint obs_weekly_answer_state_check
      check (answer_state in ('grounded', 'partial', 'conflict', 'stale', 'missing')),
    calls integer not null constraint obs_weekly_calls_check check (calls > 0),
    constraint obs_weekly_key unique nulls not distinct (week, area_id, answer_state)
);

-- Whether every delivery of a week is still kept: it starts inside the delivery period, or at or
-- after the oldest delivery partition, as retention drops whole partitions, the oldest first.
create function public.cl_obs_week_kept(p_week date) returns boolean
    language plpgsql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_kept int := (select (value #>> '{}')::int from settings_current where key = 'retention.delivery_days');
  v_start timestamptz := p_week::timestamp at time zone 'UTC';
  v_oldest timestamptz;
begin
  if v_kept is null or v_kept < 1 then
    raise exception 'retention.delivery_days must be set and at least one' using errcode = '22023';
  end if;
  select min((regexp_match(pg_get_expr(c.relpartbound, c.oid), 'FROM \(''([^'']+)''\)'))[1]::timestamptz)
    into v_oldest
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
   where i.inhparent = 'public.deliveries'::regclass;
  return coalesce(v_start >= now() - make_interval(days => v_kept) or (v_oldest is not null and v_start >= v_oldest), false);
end $$;

-- One week counted again from the deliveries: the rows it now keeps, or null when the week's
-- deliveries may no longer all be kept and it stays as it was.
create function public.cl_obs_weekly_rollup(p_week date) returns bigint
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare k bigint;
begin
  if p_week is null or p_week <> (date_trunc('week', p_week::timestamp))::date then
    raise exception 'a week starts on a Monday' using errcode = '22023';
  end if;
  if not cl_obs_week_kept(p_week) then
    return null;
  end if;
  delete from obs_weekly where week = p_week;
  insert into obs_weekly (week, area_id, answer_state, calls)
  select p_week, t.area_id, d.answer_state, count(*)
    from deliveries d join topics t on t.id = d.topic_id
   where d.caller = 'agent' and d.answer_state in ('grounded', 'partial', 'conflict', 'stale', 'missing')
     and d.delivered_hour >= p_week::timestamp at time zone 'UTC'
     and d.delivered_hour < (p_week + 7)::timestamp at time zone 'UTC'
   group by t.area_id, d.answer_state;
  get diagnostics k = row_count;
  return k;
end $$;

-- Every completed week before the week of p_today, from the latest one kept, or from the oldest
-- delivery when nothing is kept yet: each week counted and the rows it keeps.
create function public.cl_obs_weekly_rollup_due(p_today date) returns table(week date, kept bigint)
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_from date := coalesce(
    (select max(o.week) from obs_weekly o),
    (select (date_trunc('week', min(d.delivered_hour) at time zone 'UTC'))::date from deliveries d));
  v_to date := (date_trunc('week', p_today::timestamp))::date;
  w date; n bigint;
begin
  if p_today is null then
    raise exception 'today must be given' using errcode = '22023';
  end if;
  if v_from is null then
    return;
  end if;
  for w in select g::date from generate_series(v_from, v_to - 7, interval '1 week') g loop
    n := cl_obs_weekly_rollup(w);
    if n is not null then
      week := w;
      kept := n;
      return next;
    end if;
  end loop;
end $$;

revoke execute on function public.cl_obs_week_kept(date), public.cl_obs_weekly_rollup(date),
  public.cl_obs_weekly_rollup_due(date) from public;

-- The backfill: every completed week the deliveries still hold.
select count(*) from public.cl_obs_weekly_rollup_due((now() at time zone 'UTC')::date);
