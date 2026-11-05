-- 0040_records_asked_analysis: Ask's records questions grow an analysis of the records, the
-- person's own Inbox and a word people wrote in Definitions (FR-718, FR-720).
--
-- Ask now also answers what is missing, stale, unowned or written twice (intent `audit`), what is
-- waiting on the person asking (`queue`) and what a word of the workspace means (`glossary`). They
-- are counted in records_asked_weekly like the other records questions, by their fixed ids only:
-- never the words, never who asked (FR-602).

alter table public.records_asked_weekly
    drop constraint records_asked_weekly_intent_check,
    add constraint records_asked_weekly_intent_check
      check (intent in ('created', 'changed', 'due', 'archived', 'owner', 'count', 'asked_nothing',
                        'terms', 'values', 'conflicts', 'audit', 'queue', 'glossary', 'refused'));
