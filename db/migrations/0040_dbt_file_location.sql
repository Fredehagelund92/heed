-- 0039_dbt_file_location: dbt MetricFlow sources say where their file lives (CON-701).
--
-- The connector now reads its file from more places than a repository, and a source says which in
-- its `location` setting. Every source added so far reads a repository.
update connectors
   set config = config || '{"location":"git"}'::jsonb
 where type = 'dbt-metricflow' and origin = 'workspace' and not config ? 'location';
