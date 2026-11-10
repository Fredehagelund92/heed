-- 0046_saved_view_keys: saved views keep a dimension's chip by keys, and the old Value chips move
-- to them (FR-620).
--
-- Overview's filter is a dimension first, then its values: a saved view's chip is a field, or a
-- dimension (`dim:store`) with the keys of its values (`val:store/alder_row`) or `*` for any value,
-- up to 20 chips. The old Value chip (`market`) kept values by name, of any dimension. Each such
-- chip becomes its dimension's chip when every name is the name (or another name) of exactly one
-- value in the live definitions, all of one dimension that the view filters no other way. Any
-- other is kept as it was, with a `flag` that says why: `shared` when a name is two values or the
-- names are of two dimensions, `unknown` when a name is no value, `taken` when the view filters the
-- dimension already. Nothing is merged into one of the values a name could mean.
--
-- It can be undone: each view changed keeps its filters as they were in `filters_before_keys`, and
-- `select observability_views_from_keys()` puts them back (and `observability_views_to_keys()` runs
-- the move again). The filters may now be longer: 20 chips of up to 50 keys each.

alter table public.observability_views
  drop constraint observability_views_filters_check,
  add constraint observability_views_filters_check
    check (jsonb_typeof(filters) = 'object' and octet_length(filters::text) <= 65536),
  add column filters_before_keys jsonb;

create function public.observability_views_to_keys() returns integer
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
declare
  v record;
  chip jsonb;
  chips jsonb;
  v_name text;
  v_keys text[];
  v_found text[];
  v_flag text;
  v_dim text;
  n integer := 0;
begin
  for v in select id, filters from observability_views
            where filters_before_keys is null and filters -> 'chips' @> '[{"key": "market"}]'
  loop
    chips := '[]'::jsonb;
    for chip in select value from jsonb_array_elements(v.filters -> 'chips')
    loop
      if chip ->> 'key' <> 'market' then
        chips := chips || jsonb_build_array(chip);
        continue;
      end if;
      v_keys := '{}';
      v_flag := null;
      for v_name in select jsonb_array_elements_text(chip -> 'values')
      loop
        select coalesce(array_agg(distinct t.key), '{}') into v_found
          from serving_vocabulary((select seq from live_edition)) t
         where t.kind = 'dimension_value'
           and (lower(t.name) = lower(v_name)
                or exists (select 1 from unnest(t.aliases) a where lower(a) = lower(v_name)));
        if cardinality(v_found) = 0 then v_flag := 'unknown'; exit; end if;
        if cardinality(v_found) > 1 then v_flag := 'shared'; exit; end if;
        v_keys := v_keys || v_found[1];
      end loop;
      if v_flag is null and cardinality(v_keys) = 0 then v_flag := 'unknown'; end if;
      if v_flag is null then
        if (select count(distinct split_part(k, '/', 1)) from unnest(v_keys) k) > 1 then
          v_flag := 'shared';
        else
          v_dim := 'dim:' || substr(split_part(v_keys[1], '/', 1), 5);
          if v.filters -> 'chips' @> jsonb_build_array(jsonb_build_object('key', v_dim)) then
            v_flag := 'taken';
          end if;
        end if;
      end if;
      chips := chips || jsonb_build_array(
        case when v_flag is null
          then jsonb_strip_nulls(jsonb_build_object(
                 'key', v_dim, 'not', chip -> 'not', 'values', to_jsonb(v_keys)))
          else chip || jsonb_build_object('flag', v_flag)
        end);
    end loop;
    update observability_views
       set filters_before_keys = filters,
           filters = jsonb_set(filters, '{chips}', chips)
     where id = v.id;
    n := n + 1;
  end loop;
  return n;
end
$$;

create function public.observability_views_from_keys() returns integer
    language sql
    set search_path to 'public', 'pg_temp'
    as $$
  with back as (
    update observability_views
       set filters = filters_before_keys, filters_before_keys = null
     where filters_before_keys is not null
    returning 1)
  select count(*)::int from back
$$;

select public.observability_views_to_keys();
