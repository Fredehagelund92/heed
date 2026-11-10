-- 0044_topic_value_index: an index to find the topics that name a value (FR-620).
--
-- Observability filters by a dimension first, then its values, and a topic names its values in
-- `value_keys`. A GIN index answers `value_keys && $1` and `value_keys @> $1` without reading
-- every topic, and the table only grows: a topic per scope and month. The filter's reads of a
-- range count from the range's topics after their disclosure pass, so they do not look topics up
-- by value yet; the index is there for the reads that will. Dropping it changes no answer.

create index topics_value_keys on public.topics using gin (value_keys);
