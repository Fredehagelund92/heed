-- 0013_named_reports: a person reports a wrong answer from Ask, with their name (FR-622,
-- docs/product.md, section 9; golden plan P10).
--
-- - A named report keeps what the person sent on purpose, with who sent it: the question they
--   asked, the part that is wrong (one context item of the answer, or the answer itself, filed on
--   its first item), what is wrong and, optionally, the correct version and a link. Nothing else of
--   the chat is kept. It is never changed or deleted by anyone.
-- - It reaches the owners of the item's domain as a Reported card. The person who sent it, the
--   owners of its domain and administrators read it; nobody else does. Agents never read it: the
--   serving and analytics roles are granted nothing here, and no edition, export or serving
--   function reads this table.
-- - Its outcome is what the owners did after it, the first of: closed as not a problem (the card's
--   state), or the item checked again, changed or archived (its decisions, an undone one left
--   out). cl_report_outcome answers it for anyone who may read the report, so the person who sent
--   it sees it back in their chat without reading the owners' records.

create table public.reports (
    id uuid default uuidv7() not null primary key,
    person_id uuid not null references public.people(id),
    area_id text not null references public.areas(id),
    item_id text not null references public.items(id),
    -- The part that is wrong: the item, or the answer itself (filed on its first item).
    part text not null,
    question text not null,
    what text not null,
    correction text,
    link text,
    created_at timestamp with time zone default now() not null,
    constraint reports_part_check check (part in ('item', 'answer')),
    constraint reports_question_check check (char_length(btrim(question)) between 1 and 2000),
    constraint reports_what_check check (char_length(btrim(what)) between 1 and 2000),
    constraint reports_correction_check check (correction is null or char_length(btrim(correction)) between 1 and 2000),
    constraint reports_link_check check (link is null or (char_length(link) <= 2000 and link ~ '^https?://'))
);

create index reports_person on public.reports using btree (person_id, created_at);
create index reports_area on public.reports using btree (area_id, created_at);
create index reports_item on public.reports using btree (item_id, created_at);

select public.cl_make_append_only('public.reports');

alter table public.reports enable row level security;

-- Its sender, the owners of its domain and administrators read it; a person sends one as
-- themselves, about an item they may read.
create policy reports_read on public.reports for select
    using (person_id = public.cl_person() or public.cl_is_admin_now() or public.cl_is_owner_now(area_id));

create policy reports_insert on public.reports for insert
    with check (person_id = public.cl_person() and public.cl_item_open(item_id));

-- What the owners did after a report, for anyone who may read it: 'not_a_problem', 'checked',
-- 'changed' or 'archived', and when; nothing while nobody has acted on it. Runs as its owner, so
-- the sender sees the outcome without reading the card states or the decisions themselves.
create function public.cl_report_outcome(p_report uuid)
    returns table(outcome text, decided_at timestamp with time zone)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  with r as (
    select * from reports
     where id = p_report
       and (person_id = cl_person() or cl_is_admin_now() or cl_is_owner_now(area_id))
  )
  select x.outcome, x.at from (
    select 'not_a_problem'::text as outcome, c.decided_at as at
      from r join card_states c on c.card = 'report:' || r.id::text
    union all
    select case when d.outcome = 'retire' then 'archived'
                when v.is_recheck then 'checked'
                else 'changed' end,
           d.decided_at
      from r join item_versions v on v.item_id = r.item_id
             join decisions d on d.item_version_id = v.id
     where d.outcome in ('accept', 'retire') and d.decided_at > r.created_at
       and not exists (select 1 from decision_undos u where u.decision_id = d.id)
  ) x
  order by x.at limit 1 $$;
