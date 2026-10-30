-- 0030_records_asked: how often each kind of records question is asked in Ask (FR-718).
--
-- Ask answers a closed list of questions about the context's own records ("what was created in the
-- last 24 hours", "who owns Sales"). To learn which of them people use, Ask counts, for each week
-- (Monday to Sunday, in UTC), how often each was asked, by its fixed id only: never the words of a
-- question, never who asked, never a domain or anything else it named (FR-602). A question about
-- one person's work, which Ask refuses, counts as `refused`.

create table public.records_asked_weekly (
    week date not null
      constraint records_asked_weekly_week_check
      check (week = (date_trunc('week', week::timestamp))::date),
    intent text not null
      constraint records_asked_weekly_intent_check
      check (intent in ('created', 'changed', 'due', 'archived', 'owner', 'count', 'asked_nothing', 'refused')),
    asks integer not null constraint records_asked_weekly_asks_check check (asks > 0),
    constraint records_asked_weekly_key primary key (week, intent)
);
