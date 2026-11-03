-- 0038_records_asked_conflicts: Ask's records questions grow one about the conflicts (FR-718).
--
-- Ask now also answers which context items disagree ("list conflicts", "any conflicts in Sales?",
-- "what is unresolved", intent `conflicts`), from the pairs Context's Conflicts filter lists to the
-- person, with no model. It is counted in records_asked_weekly like the other records questions,
-- by its fixed id only: never the words, never who asked (FR-602).

alter table public.records_asked_weekly
    drop constraint records_asked_weekly_intent_check,
    add constraint records_asked_weekly_intent_check
      check (intent in ('created', 'changed', 'due', 'archived', 'owner', 'count', 'asked_nothing',
                        'terms', 'values', 'conflicts', 'refused'));
