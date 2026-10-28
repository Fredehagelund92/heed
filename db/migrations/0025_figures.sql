-- 0025_figures: figures in Ask (golden plan P11a; FR-716, CON-612, docs/product.md, sections 9
-- and 12).
--
-- - A definitions source whose connector reads figures keeps its figures settings with it, in
--   `capabilities.figures`: whether Ask shows figures from it (off by default), the data endpoint
--   an administrator set, and the name of the endpoint's token in the secret store (never the
--   token). Its data contact is one person, who hears about a figure that looks wrong. No figure
--   is ever stored, here or anywhere.
-- - A named report can be about a figure: a person in Ask says the figure doesn't fit a context
--   item of the answer. It names the source, the metric, the values and the days of the figure,
--   and is filed on the item, in the item's domain, like any named report. It goes to the owners
--   of that domain, to the data contact, or to both (`figure_route`). The data contact reads it
--   and may close it, as the owners do.
-- - While such a report is open, Ask shows that figure and the item side by side, with no verdict.
--   cl_figure_disputes answers whether one is open for anyone signed in, with the item only:
--   never who sent it or what they wrote.

alter table public.connectors
    add column capabilities jsonb default '{}'::jsonb not null,
    add column data_contact_id uuid references public.people(id),
    add constraint connectors_capabilities_object check (jsonb_typeof(capabilities) = 'object'),
    add constraint connectors_figures_secret_ref check (
        capabilities #>> '{figures,secretRef}' is null
        or capabilities #>> '{figures,secretRef}' ~ '^[a-z]+:[A-Za-z0-9_-]{1,100}$');

alter table public.reports
    drop constraint reports_part_check,
    add constraint reports_part_check check (part in ('item', 'answer', 'figure')),
    add column figure_source text references public.connectors(id),
    add column figure_metric text,
    add column figure_values text[],
    add column figure_from date,
    add column figure_to date,
    add column figure_route text,
    add constraint reports_figure_check check (
        (part = 'figure') = (figure_source is not null and figure_metric is not null
            and figure_values is not null and figure_from is not null and figure_to is not null
            and figure_route is not null)),
    add constraint reports_figure_route_check check (
        figure_route is null or figure_route in ('owners', 'contact', 'both')),
    add constraint reports_figure_days_check check (figure_to is null or figure_from <= figure_to),
    add constraint reports_figure_metric_check check (
        figure_metric is null or figure_metric ~ '^metric:[a-z0-9_]+$');

create index reports_figure on public.reports using btree (figure_source, figure_metric)
    where part = 'figure';

-- Whether the person signed in is the data contact of a source. Runs as its owner, so a policy
-- can ask it of a source the person may not read.
create function public.cl_is_figure_contact(p_source text)
    returns boolean
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select exists (select 1 from connectors where id = p_source and data_contact_id = cl_person()) $$;

-- The data contact reads a figure report sent to them.
drop policy reports_read on public.reports;
create policy reports_read on public.reports for select
    using (person_id = public.cl_person() or public.cl_is_admin_now() or public.cl_is_owner_now(area_id)
        or (figure_route in ('contact', 'both') and public.cl_is_figure_contact(figure_source)));

-- What became of a report, for anyone who may read it, the data contact of a figure report too.
create or replace function public.cl_report_outcome(p_report uuid)
    returns table(outcome text, decided_at timestamp with time zone)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  with r as (
    select * from reports
     where id = p_report
       and (person_id = cl_person() or cl_is_admin_now() or cl_is_owner_now(area_id)
            or (figure_route in ('contact', 'both') and cl_is_figure_contact(figure_source)))
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

-- Whether the person signed in is the data contact a figure report on this card went to.
create function public.cl_closes_figure_report(p_card text)
    returns boolean
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select exists (
    select 1 from reports r join connectors c on c.id = r.figure_source
     where 'report:' || r.id::text = p_card and r.figure_route in ('contact', 'both')
       and c.data_contact_id = cl_person()) $$;

-- The data contact closes a figure report sent to them as not a problem, as an owner does.
create policy card_states_insert_contact on public.card_states for insert
    with check (decided_by = public.cl_person() and public.cl_closes_figure_report(card));
create policy card_states_read_contact on public.card_states for select
    using (public.cl_closes_figure_report(card));

-- The context items an open figure report says a figure doesn't fit: same source, metric and
-- values, days that overlap, sent in the last 90 days, the item still readable, and nobody has
-- acted on it yet (closed as not a problem, or the item checked, changed or archived since);
-- newest first. Anyone signed in may ask: it answers with the items only, never who sent a report
-- or what it says.
create function public.cl_figure_disputes(p_source text, p_metric text, p_values text[],
        p_from date, p_to date)
    returns table(item_id text, reported_at timestamp with time zone)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select r.item_id, max(r.created_at) from reports r
   where r.part = 'figure' and r.figure_source = p_source and r.figure_metric = p_metric
     and r.figure_values = p_values and r.figure_from <= p_to and r.figure_to >= p_from
     and r.created_at > now() - interval '90 days'
     and cl_item_open(r.item_id)
     and not exists (select 1 from card_states c where c.card = 'report:' || r.id::text)
     and not exists (
       select 1 from item_versions v join decisions d on d.item_version_id = v.id
        where v.item_id = r.item_id and d.outcome in ('accept', 'retire')
          and d.decided_at > r.created_at
          and not exists (select 1 from decision_undos u where u.decision_id = d.id))
   group by r.item_id
   order by max(r.created_at) desc $$;
