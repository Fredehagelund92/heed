-- 0037_records_asked_catalogue: Ask's records questions grow two about the vocabulary (FR-718).
--
-- Ask now also answers what Definitions lists: the metrics and dimensions ("list 10 dimensions",
-- "how many metrics are in Sales", intent `terms`) and the values of a dimension ("what markets
-- are there", intent `values`), from the vocabulary as the person may see it, with no model. Each
-- is counted in records_asked_weekly like the other records questions, by its fixed id only:
-- never the words, never who asked (FR-602).

alter table public.records_asked_weekly
    drop constraint records_asked_weekly_intent_check,
    add constraint records_asked_weekly_intent_check
      check (intent in ('created', 'changed', 'due', 'archived', 'owner', 'count', 'asked_nothing',
                        'terms', 'values', 'refused'));
