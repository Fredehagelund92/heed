-- 0024_source_activity: a source's reads, counted for Settings › Integrations (CON-104).
--
-- A source's page lists its reads, newest first, each with what it did: for a definitions source
-- the definitions it found new, changed and gone. Those are counted from the definitions and their
-- marks by the read that made them, so each count reads an index instead of the whole table.

create index definition_marks_snapshot on public.definition_marks using btree (snapshot_id);
create index definitions_first_seen on public.definitions using btree (first_seen_snapshot);
create index definitions_missing_since on public.definitions using btree (missing_since_snapshot)
  where (missing_since_snapshot is not null);
