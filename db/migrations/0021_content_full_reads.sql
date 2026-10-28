-- 0021_content_full_reads: a content read says whether it was a full read (docs/connectors.md).
--
-- A connector that reads the changes since its cursor and sends tombstones (Google Drive) lists
-- everything again now and then, so a full read finds what a change list missed. The core chooses
-- which by the cursor it hands, and keeps on each read whether what it left out counts as gone.
-- Every read before this one listed everything.

alter table public.connector_snapshots
  add column full_read boolean not null default true;
