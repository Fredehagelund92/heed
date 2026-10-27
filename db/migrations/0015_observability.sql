-- 0015_observability: what Observability counts (FR-620), and the month edge of a gap (FR-606).
--
-- - Each agent delivery keeps the answer state its reply gave (FR-349: grounded, partial,
--   conflict, stale, missing, or failed; none when the question could not be read) and the kind
--   of agent that called (FR-410's fixed list), never its name. Deliveries before this keep their
--   resolver's status as their state: a match is grounded, as it was told.
-- - `observability_views` keeps the views people save on Questions for everyone in the workspace:
--   a name and the filters, never a question, and who saved it.
-- - Case 1 of FR-606 counts across a month edge: no-item calls in the period about the same
--   domain, metrics, values and dimensions count together whatever month their dates start in.
--   The gap stays on one topic: the one an open gap of that scope already has, else the topic of
--   the latest call. Its weekly counts add up every month of the scope.

alter table public.deliveries
  add column answer_state text
    constraint deliveries_answer_state_check
    check (answer_state in ('grounded', 'partial', 'conflict', 'stale', 'missing', 'failed')),
  add column app_family text not null default 'unknown'
    constraint deliveries_app_family_check
    check (app_family in ('claude_code', 'claude_ai', 'chatgpt', 'codex', 'cursor', 'vscode_copilot',
                          'windsurf', 'gemini_cli', 'goose', 'heed', 'other', 'unknown'));

update public.deliveries
   set answer_state = case status
         when 'matched' then 'grounded'
         when 'conflict' then 'conflict'
         when 'no_match' then 'missing'
         when 'check_failed' then 'failed'
       end
 where answer_state is null;

create table public.observability_views (
    id uuid default uuidv7() not null primary key,
    name text not null constraint observability_views_name_check check (char_length(btrim(name)) between 1 and 60),
    filters jsonb not null constraint observability_views_filters_check
      check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 2000),
    created_by uuid not null references public.people(id),
    created_at timestamp with time zone default now() not null
);
create unique index observability_views_name_key on public.observability_views (lower(btrim(name)));

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
  -- their dates start in. A check failure is not a gap (FR-319), and calls from before a
  -- resolution of that scope do not count again.
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
       and x.type = 'missing' and x.status in ('open', 'proposal_made', 'wont_fix')
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
   where x.type = 'missing' and x.status in ('open', 'proposal_made', 'wont_fix')
     and c.week >= date_trunc('week', x.first_seen)::date
   group by x.id, c.week
  having sum(c.no_item_calls) > 0
  on conflict (gap_id, week) do update set no_item_calls = excluded.no_item_calls
   where gap_weekly_counts.no_item_calls is distinct from excluded.no_item_calls;
  get diagnostics k = row_count;
  return query select 'weekly_counts_updated', k;
end $$;
