-- 0010_serving_terms: agents read the terms and synonyms people write in Definitions
-- (docs/product.md, sections 3 and 10; FR-138).
--
-- - serving_terms() gives the serving path every live term (never a deleted one): its word, its
--   own meaning or what it means (`same_as`: a metric or a dimension of the vocabulary by its key,
--   or `term:<id>`), its domain, the UTC day it was last written and the role it was written in
--   (an owner of its domain, or an administrator), never who wrote it. `conflict` marks a word
--   agents can't read as one meaning: the vocabulary or the definitions source uses it for
--   another metric or dimension (a sync gave it a second meaning), or the metric or dimension a
--   synonym means is gone. The service leaves those out (src/domain/served-terms.ts).
-- - serving_terms_mark() changes with every write to a term (term_versions is append only) and
--   with every sync of a definitions source (each records a connector snapshot), so a cached
--   serving bundle is read again once a person writes, deletes or restores a term, or a sync gives
--   a word a second meaning.
-- - Both run as their owner: the serving role still has no grant on the terms tables.

create function public.serving_terms()
    returns table(id text, name text, meaning text, same_as text, area_id text,
                  written_on text, written_as text, conflict boolean)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  with words as materialized (select w.word, w.key from cl_vocabulary_words() w),
  live as materialized (
    select s.term_key as key
      from vocab_term_service s join vocab_terms t on t.key = s.term_key
     where s.editions @> (select seq from live_edition) and t.kind in ('metric', 'dimension'))
  select t.id::text, t.name, t.meaning,
         coalesce(t.same_as_key, 'term:' || t.same_as_term::text),
         t.area_id,
         to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD'),
         case when t.area_id is not null and cl_has_area_role(t.updated_by, t.area_id, 'owner', t.updated_at) then 'owner'
              when cl_is_admin(t.updated_by, t.updated_at) then 'administrator'
              when t.area_id is null then 'administrator'
              else 'owner' end,
         exists (select 1 from words w where w.word = t.word and w.key is distinct from t.same_as_key)
           or (t.same_as_key is not null and not exists (select 1 from live l where l.key = t.same_as_key))
    from terms t
   where t.deleted_at is null
   order by t.word $$;

create function public.serving_terms_mark() returns text
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$ select (select count(*) from term_versions)::text || ':'
                 || coalesce((select id::text from connector_snapshots order by id desc limit 1), '') $$;

revoke execute on function public.serving_terms(), public.serving_terms_mark() from public;
