-- 0019_saved_questions: saved questions and the free check (FR-526, golden plan P12, part 2).
--
-- - A saved question is a question an owner or an administrator keeps for a domain, with their
--   name (FR-602 as amended: words a person sends on purpose are kept with their name). It names
--   the items it should answer from; a person may leave some of the answer's items out. Removing
--   one keeps it, marked removed.
-- - Its baselines are the answers it should keep getting: the first is what the answer engine gave
--   when it was saved; keeping a new answer adds one, which its keeper may undo; publishing a
--   suggestion from the review adds one for each question the review showed as Changed, so what
--   it said becomes its saved answer. The latest one not undone is the one it is checked against.
-- - A check run answers saved questions again on what agents get, with no model: after a
--   publish, an archive, a restore, a sync and a check date passing (the `saved.check` job reads
--   what changed), on Check now, and once for a question saved or a new answer kept. Its results
--   are Same, Changed or Needs a look; a run that could not finish is failed, never a result. It
--   counts how far it got, for the page that waits on it. A check never blocks a publish: it runs
--   after the change, in its own transactions.
-- - The owners of the domain and administrators read and change a domain's saved questions;
--   nobody else does. The scheduled check (no person, no source) reads them through
--   cl_saved_questions_to_check. Agents never read any of it: the serving and analytics roles are
--   granted nothing here, and no edition, export or serving function reads these tables.

create table public.saved_questions (
    id uuid default uuidv7() not null primary key,
    area_id text not null references public.areas(id),
    question text not null,
    -- Where it was saved from: an answer in Ask, a Not found card's draft, or typed in Quality.
    origin text not null,
    expect_items text[] not null default '{}',
    created_by uuid not null references public.people(id),
    created_at timestamp with time zone default now() not null,
    removed_at timestamp with time zone,
    removed_by uuid references public.people(id),
    constraint saved_questions_question_check check (char_length(btrim(question)) between 1 and 500),
    constraint saved_questions_origin_check check (origin in ('ask', 'gap', 'typed')),
    constraint saved_questions_expect_check check (cardinality(expect_items) <= 20),
    constraint saved_questions_removed_check check ((removed_at is null) = (removed_by is null))
);
create index saved_questions_area on public.saved_questions using btree (area_id, created_at)
    where removed_at is null;

create table public.saved_question_baselines (
    id uuid default uuidv7() not null primary key,
    question_id uuid not null references public.saved_questions(id),
    -- The answer as src/domain/saved-check.ts keeps it: its state, its items and what it says.
    answer jsonb not null,
    edition bigint,
    why text not null,
    -- Who saved it, kept it, or published the change it takes.
    kept_by uuid not null references public.people(id),
    kept_at timestamp with time zone default now() not null,
    undone_at timestamp with time zone,
    constraint saved_question_baselines_answer_check
      check (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 40000),
    constraint saved_question_baselines_why_check check (why in ('saved', 'kept', 'published'))
);
create index saved_question_baselines_question on public.saved_question_baselines
    using btree (question_id, kept_at desc);

create table public.check_runs (
    id uuid default uuidv7() not null primary key,
    trigger text not null,
    -- One domain's questions; null for every question the run's reader manages.
    area_id text references public.areas(id),
    -- Who pressed Check now, saved or kept; null for a run the check job started.
    started_by uuid references public.people(id),
    -- What agents got when it ran: the live edition, the stops and flags over it, and the day.
    edition bigint,
    overlay bigint,
    day date not null,
    total integer default 0 not null,
    checked integer default 0 not null,
    started_at timestamp with time zone default now() not null,
    finished_at timestamp with time zone,
    failed_at timestamp with time zone,
    constraint check_runs_trigger_check
      check (trigger in ('saved', 'kept', 'publish', 'archive', 'restore', 'sync', 'check_date', 'manual')),
    constraint check_runs_count_check check (total >= 0 and checked between 0 and total),
    constraint check_runs_end_check check (finished_at is null or failed_at is null)
);
create index check_runs_started on public.check_runs using btree (started_at desc);

create table public.saved_question_results (
    run_id uuid not null references public.check_runs(id),
    question_id uuid not null references public.saved_questions(id),
    baseline_id uuid not null references public.saved_question_baselines(id),
    result text not null,
    reason text not null,
    answer jsonb not null,
    checked_at timestamp with time zone default now() not null,
    primary key (run_id, question_id),
    constraint saved_question_results_result_check check (result in ('same', 'changed', 'look')),
    constraint saved_question_results_reason_check
      check (reason in ('saved', 'same', 'kept', 'published', 'words', 'items', 'better', 'worse', 'gone')),
    constraint saved_question_results_answer_check
      check (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 40000)
);
create index saved_question_results_question on public.saved_question_results
    using btree (question_id, checked_at desc);

alter table public.saved_questions enable row level security;
alter table public.saved_question_baselines enable row level security;
alter table public.check_runs enable row level security;
alter table public.saved_question_results enable row level security;

-- A domain's owners and administrators read its saved questions, save them as themselves, and
-- remove them.
create policy saved_questions_read on public.saved_questions for select
    using (public.cl_is_admin_now() or public.cl_is_owner_now(area_id));
create policy saved_questions_insert on public.saved_questions for insert
    with check (created_by = public.cl_person() and removed_at is null
                and (public.cl_is_admin_now() or public.cl_is_owner_now(area_id)));
create policy saved_questions_remove on public.saved_questions for update
    using (public.cl_is_admin_now() or public.cl_is_owner_now(area_id))
    with check (removed_by = public.cl_person());

-- A baseline follows its question; a person keeps one as themselves, and undoes only their own
-- kept one.
create policy saved_question_baselines_read on public.saved_question_baselines for select
    using (exists (select 1 from public.saved_questions q where q.id = question_id));
create policy saved_question_baselines_insert on public.saved_question_baselines for insert
    with check (kept_by = public.cl_person()
                and exists (select 1 from public.saved_questions q where q.id = question_id));
create policy saved_question_baselines_undo on public.saved_question_baselines for update
    using (kept_by = public.cl_person() and why = 'kept')
    with check (kept_by = public.cl_person());

-- A run names no question: anyone signed in, and the check, read how far one got. A person starts
-- and ends their own, for a domain they manage or for every one they manage; the check its own.
create policy check_runs_read on public.check_runs for select using (true);
create policy check_runs_insert on public.check_runs for insert
    with check (
      (started_by = public.cl_person()
        and (area_id is null or public.cl_is_admin_now() or public.cl_is_owner_now(area_id)))
      or (started_by is null and public.cl_person() is null and public.cl_source() is null));
create policy check_runs_update on public.check_runs for update
    using (started_by is not distinct from public.cl_person() and public.cl_source() is null)
    with check (started_by is not distinct from public.cl_person());

-- A result follows its question; a person's run writes results for the questions they manage,
-- the check for every question.
create policy saved_question_results_read on public.saved_question_results for select
    using (exists (select 1 from public.saved_questions q where q.id = question_id));
create policy saved_question_results_insert on public.saved_question_results for insert
    with check (
      exists (select 1 from public.saved_questions q where q.id = question_id)
      or (public.cl_person() is null and public.cl_source() is null));

-- The questions a run checks, each with the baseline it is checked against: those the reader
-- manages, or for the check (no person, no source) every one. Runs as the owner, so the check
-- reads them without a person.
create function public.cl_saved_questions_to_check(p_area text default null)
    returns table(id uuid, area_id text, question text, expect_items text[], baseline_id uuid,
                  answer jsonb, created_at timestamp with time zone)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select q.id, q.area_id, q.question, q.expect_items, b.id, b.answer, q.created_at
    from saved_questions q
    join lateral (select x.id, x.answer from saved_question_baselines x
                   where x.question_id = q.id and x.undone_at is null
                   order by x.kept_at desc, x.id desc limit 1) b on true
   where q.removed_at is null
     and (p_area is null or q.area_id = p_area)
     and ((cl_person() is null and cl_source() is null) or cl_is_admin_now() or cl_is_owner_now(q.area_id))
   order by q.created_at, q.id $$;
