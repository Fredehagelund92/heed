-- 0048_source_read_state: a source's pending read has one stored form, and a running read is a
-- fact of its own.
--
-- `next_read_at` meant "never read, or changed" when NULL and "read at" otherwise, and the job and
-- the sources' page disagreed on NULL: a source just connected or changed was about to be read
-- while its page called it healthy. NULL is now written as `now()` ("queued"), and the column can
-- no longer be NULL, so a read is queued when `next_read_at <= now()` and scheduled otherwise.
--
-- `reading_since` is set while the job reads the source and cleared when the read ends. The page
-- shows a read as running only while it is recent (a job that died leaves the mark behind).

update public.connectors set next_read_at = now() where next_read_at is null;

alter table public.connectors
  alter column next_read_at set default now(),
  alter column next_read_at set not null,
  add column reading_since timestamp with time zone;
