-- 0049_gap_states: a gap has three states, and only the moves between them that Heed makes (#201).
--
-- - Open (`open`): agents keep asking and nothing covers it yet. Covered (`resolved`): context was
--   published for it. Set aside (`wont_fix`): its owners decided it is not something to write
--   down. `proposal_made` had no writer, so it goes; a gap that had it is open.
-- - `gap_transitions` lists the four moves: open to covered (a publish that names the gap) and
--   back (the Undo of that publish), open to set aside (Not something we write down) and back (its
--   Undo). The trigger refuses any other change of status with `check_violation`, as
--   `proposals_guard_state` does. A miss seen again after a gap was covered opens a new gap
--   (`cl_gap_touch`), never the old one.
-- - What nothing wrote goes too: the verification of a covered gap (`verified_at`,
--   `verified_edition_seq`), its tests (`gap_tests` and the functions that read or wrote them) and
--   `gap_proposals`. A suggestion names the gap it was written for in `proposals.source_gap_id`,
--   which a publish from a Not found card now writes, so the readers that used `gap_proposals`
--   read that instead.

-- Three states. `v_gap_totals` and the one-open index name the type, so they are made again.
drop view public.v_gap_totals;
drop index public.gaps_one_open_per_topic_type;
alter table public.gaps
  drop constraint gaps_resolved_edition,
  drop constraint gaps_verified_edition,
  drop constraint gaps_verified_hour,
  drop constraint gaps_verified_needs_resolved,
  drop column verified_at,
  drop column verified_edition_seq,
  alter column status drop default;
alter type public.gap_status rename to gap_status_before;
create type public.gap_status as enum ('open', 'wont_fix', 'resolved');
alter table public.gaps
  alter column status type public.gap_status
    using (case status::text when 'proposal_made' then 'open' else status::text end)::public.gap_status,
  alter column status set default 'open',
  add constraint gaps_resolved_edition check (resolved_edition_seq is null or status = 'resolved');
drop type public.gap_status_before;
create unique index gaps_one_open_per_topic_type on public.gaps using btree (topic_id, type) where (status = 'open');
create view public.v_gap_totals as
 select t.area_id,
    g.type,
    g.status,
    (count(*))::integer as gaps
   from (public.gaps g
     join public.topics t on ((t.id = g.topic_id)))
  group by t.area_id, g.type, g.status;

create table public.gap_transitions (
    from_status public.gap_status not null,
    to_status public.gap_status not null,
    primary key (from_status, to_status)
);
insert into public.gap_transitions (from_status, to_status) values
  ('open', 'resolved'),
  ('resolved', 'open'),
  ('open', 'wont_fix'),
  ('wont_fix', 'open');

create function public.gaps_guard_status() returns trigger
    language plpgsql
    as $$
begin
  if new.status is distinct from old.status
     and not exists (select 1 from public.gap_transitions t where t.from_status = old.status and t.to_status = new.status) then
    raise exception 'gap % cannot move from % to %', old.id, old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger gaps_status before update on public.gaps for each row execute function public.gaps_guard_status();

-- The tests of a gap and the links nothing wrote.
drop function public.cl_gap_draft_tests(uuid);
drop function public.cl_gap_run_tests(uuid);
drop function public.cl_gap_record_pass(uuid, uuid, text);
drop table public.gap_tests;
drop table public.gap_proposals;

create or replace function public.cl_test_link_check() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  q golden_questions%rowtype;
  v_ok boolean;
begin
  select * into strict q from golden_questions where id = new.question_id for share;
  if q.split = 'held_out' then
    raise exception 'A held-out test question cannot be attached to a proposal' using errcode = '23514';
  end if;
  select area_id is not distinct from q.area_id into v_ok from proposals where id = new.proposal_id;
  if not coalesce(v_ok, false) then
    raise exception 'The test question % is not in the area of this proposal', q.id using errcode = '23514';
  end if;
  return null;
end $$;

create or replace function public.cl_question_links_guard() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  attached boolean := exists (
    select 1 from proposal_tests a join proposals p on p.id = a.proposal_id
     where a.question_id = new.id and p.discarded_at is null
       and p.state in ('draft', 'submitted', 'in_review', 'changes_requested'));
begin
  if new.split = 'held_out' and old.split <> 'held_out' and attached then
    raise exception 'The test question % is attached to an open proposal; detach it before holding it out', new.id
      using errcode = '23514';
  end if;
  if new.area_id <> old.area_id and attached then
    raise exception 'The test question % is attached to an open proposal; detach it before moving it', new.id
      using errcode = '23514';
  end if;
  return new;
end $$;

-- Every way of seeing a gap, with `open` as the one state still in play besides set aside.
create or replace function public.cl_gap_touch(p_topic uuid, p_type public.gap_type, p_case smallint, p_seen timestamp with time zone, p_first timestamp with time zone default null::timestamp with time zone, p_reports integer default 0, p_note text default null::text, p_note_source text default null::text) returns uuid
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  g gaps%rowtype;
  v_last date := (p_seen at time zone 'UTC')::date;
  v_first date := (coalesce(p_first, p_seen) at time zone 'UTC')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended('cl.gap:' || p_topic || ':' || p_type, 0));
  select * into g from gaps where topic_id = p_topic and type = p_type
   order by status = 'open' desc, status = 'wont_fix' desc, status_since desc, created_at desc
   limit 1;
  if not found or (g.status = 'resolved' and p_seen > g.status_since) then
    insert into gaps (topic_id, type, opened_by_case, first_seen, last_seen)
    values (p_topic, p_type, p_case, v_first, v_last) returning * into g;
  elsif g.status = 'resolved' then
    return g.id;
  else
    update gaps set last_seen = greatest(last_seen, v_last) where id = g.id;
  end if;
  if p_reports > 0 then
    insert into gap_weekly_counts (gap_id, week, reports)
    values (g.id, date_trunc('week', p_seen at time zone 'UTC')::date, p_reports)
    on conflict (gap_id, week) do update set reports = gap_weekly_counts.reports + excluded.reports;
  end if;
  if p_note is not null then
    insert into gap_notes (gap_id, source, note) values (g.id, p_note_source, p_note);
  end if;
  return g.id;
end $$;

create or replace function public.cl_gaps_detect() returns table(what text, n bigint)
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v_rule jsonb := (select value from settings_current where key = 'gaps.no_item_threshold');
  v_calls int := (v_rule ->> 'calls')::int;
  v_days int := (v_rule ->> 'days')::int;
  v_kept int := (select (value #>> '{}')::int from settings_current where key = 'retention.delivery_days');
  r record; k bigint; g uuid; v_topic uuid;
begin
  if v_calls is null or v_days is null or v_kept is null or least(v_calls, v_days, v_kept) < 1 then
    raise exception 'gaps.no_item_threshold and retention.delivery_days must be set and at least one' using errcode = '22023';
  end if;

  -- Case 1: enough agent calls about one scope found nothing within the period, whatever month
  -- their dates start in. A check failure is not a gap (FR-319), and calls from before that scope
  -- was covered do not count again.
  k := 0;
  for r in
    select t.area_id, t.metric_keys, t.value_keys, t.dimension_keys,
           min(d.delivered_hour) as first_hour, max(d.delivered_hour) as last_hour,
           (array_agg(d.topic_id order by d.delivered_hour desc, t.month desc, d.topic_id))[1] as latest
      from deliveries d join topics t on t.id = d.topic_id
     where d.caller = 'agent' and d.status = 'no_match'
       and d.delivered_hour >= date_trunc('hour', now(), 'UTC') - make_interval(days => v_days)
       and d.delivered_hour > coalesce((
             select max(x.status_since) from gaps x join topics xt on xt.id = x.topic_id
              where xt.area_id is not distinct from t.area_id and xt.metric_keys = t.metric_keys
                and xt.value_keys = t.value_keys and xt.dimension_keys = t.dimension_keys
                and x.type = 'missing' and x.status = 'resolved'), '-infinity')
     group by t.area_id, t.metric_keys, t.value_keys, t.dimension_keys
    having count(*) >= v_calls
  loop
    select x.topic_id into v_topic
      from gaps x join topics xt on xt.id = x.topic_id
     where xt.area_id is not distinct from r.area_id and xt.metric_keys = r.metric_keys
       and xt.value_keys = r.value_keys and xt.dimension_keys = r.dimension_keys
       and x.type = 'missing' and x.status in ('open', 'wont_fix')
     order by x.status_since desc, x.created_at desc
     limit 1;
    perform cl_gap_touch(coalesce(v_topic, r.latest), 'missing', 1::smallint, r.last_hour, r.first_hour);
    k := k + 1;
  end loop;
  return query select 'case_1_no_item_topics', k;

  -- Case 3: negative feedback on an agent delivery. Its note moves under the notes' row security.
  -- Feedback older than the kept deliveries can no longer find its topic.
  k := 0;
  for r in
    select f.id, f.verdict, f.note, f.created_hour, d.topic_id
      from feedback f join deliveries d on d.id = f.delivery_id
     where f.gap_id is null and f.verdict <> 'helpful' and d.caller = 'agent' and d.topic_id is not null
       and f.created_hour >= now() - make_interval(days => v_kept)
     order by f.created_hour, f.id
  loop
    g := cl_gap_touch(r.topic_id,
           case r.verdict when 'wrong' then 'incorrect' when 'missing' then 'missing' else 'unclear_question' end::gap_type,
           3::smallint, r.created_hour, null, 1, r.note, 'feedback');
    update feedback set gap_id = g, note = null where id = r.id;
    k := k + 1;
  end loop;
  return query select 'case_3_feedback', k;

  -- Case 4: a source definition changed (not a first sighting or a reappearance with the same
  -- mark). Recent topics about a metric defined there may now hold outdated context.
  k := 0;
  for r in
    select distinct t.id as topic_id, s.fetched_at
      from definition_marks m
      join connector_snapshots s on s.id = m.snapshot_id
      join lateral (select p.change_mark from definition_marks p join connector_snapshots ps on ps.id = p.snapshot_id
                     where p.definition_ref = m.definition_ref and ps.fetched_at < s.fetched_at
                     order by ps.fetched_at desc limit 1) prev on prev.change_mark <> m.change_mark
      join vocab_term_refs tr on tr.definition_ref = m.definition_ref
      join vocab_term_versions v on v.id = tr.version_id
      join topics t on v.term_key = any(t.metric_keys)
                   and t.month >= (date_trunc('month', s.fetched_at at time zone 'UTC') - interval '1 month')::date
     where s.fetched_at >= now() - make_interval(days => v_days)
  loop
    perform cl_gap_touch(r.topic_id, 'outdated', 4::smallint, r.fetched_at);
    k := k + 1;
  end loop;
  return query select 'case_4_definition_topics', k;

  -- Weekly no-item calls of every gap still in play, from the counts of every month of its scope
  -- since it was seen.
  insert into gap_weekly_counts (gap_id, week, no_item_calls)
  select x.id, c.week, sum(c.no_item_calls)
    from gaps x
    join topics xt on xt.id = x.topic_id
    join topics t on t.area_id is not distinct from xt.area_id and t.metric_keys = xt.metric_keys
                 and t.value_keys = xt.value_keys and t.dimension_keys = xt.dimension_keys
    join topic_week_counts c on c.topic_id = t.id and c.status = 'no_match'
   where x.type = 'missing' and x.status in ('open', 'wont_fix')
     and c.week >= date_trunc('week', x.first_seen)::date
   group by x.id, c.week
  having sum(c.no_item_calls) > 0
  on conflict (gap_id, week) do update set no_item_calls = excluded.no_item_calls
   where gap_weekly_counts.no_item_calls is distinct from excluded.no_item_calls;
  get diagnostics k = row_count;
  return query select 'weekly_counts_updated', k;
end $$;

-- A Not found alert was acted on when the gap's state changed, or a manager started a draft or
-- suggestion written for it, within 14 days of the raise.
create or replace function public.cl_obs_caught(p_from date, p_to date)
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
                       or exists (select 1 from proposals p
                                   where p.source_gap_id = g.id
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
