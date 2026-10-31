-- 0033_obs_caught: weekly counts of what Heed caught, kept without limit (FR-612, FR-620).
--
-- Summary says what was caught as three separate lines, never added up and never called
-- prevented. The first, answers that went out with a warning, is in `obs_weekly` already (the
-- partial, conflict and stale calls). This keeps the other two, for each completed week (Monday to
-- Sunday, in UTC):
--
-- - `saved`: how many times a saved question's answer came out Changed or Needs a look, where its
--   result before was Same, in a check run Heed started after a change: a publish, an archive, a
--   restore, a sync or a check date passing (`kind` is that trigger). Check now, a question saved
--   and a new answer kept are not changes, so their runs do not count. A question counts in its
--   domain.
-- - `alert`: how many alerts each rule raised (`kind` is the rule), and how many of those an owner
--   or an administrator acted on within 14 days of the raise (`acted`), by a decision Heed keeps:
--   - Not found (`gap`): the gap's state was changed (a draft or suggestion made, a change
--     published, or closed as not something we write down), or an owner or administrator started
--     a draft or suggestion for it;
--   - A saved question needs a look (`saved`): a new answer was kept for one of the domain's saved
--     questions, a published change set one, or one was removed;
--   - A check is due (`due`): the item was checked, changed or archived, by a decision not undone.
--   The other rules raise something no owner decides in Heed, so they are counted as raised only.
--   An alert about one domain counts in it; one about none or several counts with no domain.
--
-- Counts only: never the words of a question or of an alert, never a saved question, a topic, an
-- item or any scope finer than the domain, never who asked, kept or acted (FR-602, FR-613). Check
-- constraints refuse anything but the fixed lists, a Monday and a count over 0. Small counts are
-- kept as they are and hidden when they are read (FR-614). Kept without limit, as `obs_weekly` is,
-- and retention never deletes it.
--
-- - `cl_obs_caught(from, to)` counts the days from `from` up to, not including, `to` from the
--   records (check runs and their results, raised alerts, and the decisions after them, none of
--   which retention deletes). It runs as the owner, so the counts are the same whoever reads: an
--   administrator, an owner, or the jobs, which read as no person. Summary reads a whole week from
--   the weekly counts and a piece of one from this.
-- - `cl_obs_caught_rollup(week)` counts one week again and replaces what was kept for it, so
--   running it twice keeps the same counts.
-- - `cl_obs_caught_rollup_due(today)`, which the `observability.rollup` job runs each night,
--   counts every completed week after the latest one kept and again the last four, whose alerts
--   may still be acted on, or every week from the first record when nothing is kept yet.
-- - This migration counts every completed week the records hold, once.

create table public.obs_caught_weekly (
    week date not null
      constraint obs_caught_weekly_week_check check (week = (date_trunc('week', week::timestamp))::date),
    area_id text references public.areas(id),
    line text not null constraint obs_caught_weekly_line_check check (line in ('saved', 'alert')),
    kind text not null,
    count integer not null constraint obs_caught_weekly_count_check check (count > 0),
    acted integer not null default 0,
    constraint obs_caught_weekly_kind_check check (
      (line = 'saved' and kind in ('publish', 'archive', 'restore', 'sync', 'check_date'))
      or (line = 'alert' and kind in ('gap', 'saved', 'disagree', 'share', 'fail', 'spend', 'sync', 'due'))),
    constraint obs_caught_weekly_acted_check
      check (acted between 0 and count and (acted = 0 or (line = 'alert' and kind in ('gap', 'saved', 'due')))),
    constraint obs_caught_weekly_key unique nulls not distinct (week, area_id, line, kind)
);

-- Whether a person was an administrator, or an owner of one of p_areas, at p_at.
create function public.cl_obs_managed_at(p_person uuid, p_areas text[], p_at timestamp with time zone)
    returns boolean
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select exists (select 1 from global_role_grants g
                  where g.person_id = p_person and g.role = 'administrator' and g.valid_at @> p_at)
      or exists (select 1 from area_assignments a
                  where a.person_id = p_person and a.area_id = any(p_areas) and a.role = 'owner'
                    and a.valid_at @> p_at) $$;

-- What was caught from p_from up to, not including, p_to, by domain: the saved questions whose
-- answer changed after a change, by trigger, and the alerts raised and acted on, by rule.
create function public.cl_obs_caught(p_from date, p_to date)
    returns table(area_id text, line text, kind text, count integer, acted integer)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  with saved as (
    select q.area_id, c.trigger as kind
      from saved_question_results r
      join check_runs c on c.id = r.run_id
      join saved_questions q on q.id = r.question_id
     where c.trigger in ('publish', 'archive', 'restore', 'sync', 'check_date')
       and r.result in ('changed', 'look')
       and r.checked_at >= p_from::timestamp at time zone 'UTC'
       and r.checked_at < p_to::timestamp at time zone 'UTC'
       and (select x.result from saved_question_results x
             where x.question_id = r.question_id
               and (x.checked_at < r.checked_at or (x.checked_at = r.checked_at and x.run_id < r.run_id))
             order by x.checked_at desc, x.run_id desc limit 1) = 'same'
  ),
  alerts as (
    select case when cardinality(a.area_ids) = 1 then a.area_ids[1] end as area_id, a.rule as kind,
           case a.rule
             when 'gap' then exists (
               select 1 from gaps g
                where g.id::text = a.key
                  and (exists (select 1 from audit_log l
                                where l.action = 'gap.status_changed' and l.subject_type = 'gap'
                                  and l.subject_id = g.ref and l.actor_kind = 'person'
                                  and l.at > a.raised_at and l.at <= a.raised_at + interval '14 days')
                       or exists (select 1 from gap_proposals gp join proposals p on p.id = gp.proposal_id
                                   where gp.gap_id = g.id
                                     and p.created_at > a.raised_at
                                     and p.created_at <= a.raised_at + interval '14 days'
                                     and cl_obs_managed_at(p.proposer_id, a.area_ids, p.created_at))))
             when 'saved' then exists (
               select 1 from saved_question_baselines b join saved_questions q on q.id = b.question_id
                where q.area_id = any(a.area_ids) and b.why in ('kept', 'published')
                  and b.kept_at > a.raised_at and b.kept_at <= a.raised_at + interval '14 days')
               or exists (
               select 1 from saved_questions q
                where q.area_id = any(a.area_ids)
                  and q.removed_at > a.raised_at and q.removed_at <= a.raised_at + interval '14 days')
             when 'due' then exists (
               select 1 from decisions d join item_versions v on v.id = d.item_version_id
                where v.item_id = substr(a.subject->>'card', length('check:') + 1)
                  and d.outcome in ('accept', 'retire')
                  and d.decided_at > a.raised_at and d.decided_at <= a.raised_at + interval '14 days'
                  and not exists (select 1 from decision_undos u where u.decision_id = d.id))
             else false
           end as acted
      from alert_raises a
     where a.raised_at >= p_from::timestamp at time zone 'UTC'
       and a.raised_at < p_to::timestamp at time zone 'UTC'
  )
  select s.area_id, 'saved', s.kind, count(*)::int, 0 from saved s group by s.area_id, s.kind
  union all
  select a.area_id, 'alert', a.kind, count(*)::int, (count(*) filter (where a.acted))::int
    from alerts a group by a.area_id, a.kind $$;

-- One week counted again from the records: the rows it now keeps.
create function public.cl_obs_caught_rollup(p_week date) returns bigint
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare k bigint;
begin
  if p_week is null or p_week <> (date_trunc('week', p_week::timestamp))::date then
    raise exception 'a week starts on a Monday' using errcode = '22023';
  end if;
  delete from obs_caught_weekly where week = p_week;
  insert into obs_caught_weekly (week, area_id, line, kind, count, acted)
  select p_week, c.area_id, c.line, c.kind, c.count, c.acted from cl_obs_caught(p_week, p_week + 7) c;
  get diagnostics k = row_count;
  return k;
end $$;

-- Every completed week before the week of p_today after the latest one kept, and again the last
-- four (an alert is acted on within 14 days of its raise); or, when nothing is kept yet, every
-- week from the first record: each week counted and the rows it keeps.
create function public.cl_obs_caught_rollup_due(p_today date) returns table(week date, kept bigint)
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_to date := (date_trunc('week', p_today::timestamp))::date;
  v_first date := (date_trunc('week', least(
    (select min(r.checked_at) from saved_question_results r) at time zone 'UTC',
    (select min(a.raised_at) from alert_raises a) at time zone 'UTC')))::date;
  v_latest date := (select max(o.week) from obs_caught_weekly o);
  v_from date;
  w date;
begin
  if p_today is null then
    raise exception 'today must be given' using errcode = '22023';
  end if;
  if v_first is null then
    return;
  end if;
  v_from := greatest(v_first, least(coalesce(v_latest + 7, v_first), v_to - 28));
  for w in select g::date from generate_series(v_from, v_to - 7, interval '1 week') g loop
    week := w;
    kept := cl_obs_caught_rollup(w);
    return next;
  end loop;
end $$;

revoke execute on function public.cl_obs_managed_at(uuid, text[], timestamp with time zone),
  public.cl_obs_caught(date, date), public.cl_obs_caught_rollup(date),
  public.cl_obs_caught_rollup_due(date) from public;

-- The backfill: every completed week the records hold.
select count(*) from public.cl_obs_caught_rollup_due((now() at time zone 'UTC')::date);
