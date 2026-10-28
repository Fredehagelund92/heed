-- 0021_term_mentions: a context item's text can mention a term written in Definitions (FR-138),
-- as it mentions a metric, an item or a domain: `@[words](term:<id>)`, where the id is the term's.
--
-- - A mention of a term is a link, as every mention is (FR-331): get_related follows it, one step,
--   to what the term means, and it never changes which items an answer gets (FR-335). Agents read
--   the term as it stands now, from serving_terms(), never from the version: a term is not sealed
--   in an edition, so a deleted term reads as no longer there, and a term of a stopped domain is
--   counted and not listed (FR-333).
-- - The mention keeps the term's id; the term's own row is never copied into the version, so the
--   serving role still reads nothing of the terms tables but through serving_terms().
-- - A term is deleted by marking it (0009_terms.sql), so the reference always holds.

alter table public.item_version_mentions add column term_id uuid references public.terms(id);
alter table public.item_version_mentions drop constraint item_version_mentions_check;
alter table public.item_version_mentions add constraint item_version_mentions_check
    check (num_nonnulls(term_key, item_id, area_id, term_id) = 1);
create index item_version_mentions_written_term on public.item_version_mentions
    using btree (term_id, version_id) where (term_id is not null);

-- The markup a text may hold: a term by its id, beside the targets it had.
create or replace function public.cl_parse_mention_text(t text) returns jsonb
    language plpgsql immutable
    as $$
declare i int := 1; rest text; m text[]; plain text := ''; tokens jsonb := '[]';
begin
  while i <= char_length(t) loop
    if substr(t,i,1) = chr(92) and substr(t,i+1,1) in (chr(92),'@') then
      plain := plain || substr(t,i+1,1); i := i+2;
    elsif substr(t,i,2) = '@[' then
      rest := substr(t,i);
      m := regexp_match(rest, '^@\[([^\]\r\n]+)\]\(((?:metric|dim):[a-z0-9_]+|val:[a-z0-9_]+/[a-z0-9_]+|item:itm_[a-z0-9]{8,16}|area:[a-z][a-z0-9_-]*|term:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)');
      if m is null then raise exception 'Invalid mention syntax' using errcode='check_violation'; end if;
      plain := plain || m[1];
      tokens := tokens || jsonb_build_array(jsonb_build_object('position',jsonb_array_length(tokens),'label',m[1],'target',m[2]));
      i := i + char_length(m[1]) + char_length(m[2]) + 5;
    else plain := plain || substr(t,i,1); i := i+1;
    end if;
  end loop;
  return jsonb_build_object('text',plain,'mentions',tokens);
end $$;

create or replace function public.item_versions_mentions_match() returns trigger
    language plpgsql
    as $$
declare tokens jsonb; rows_ jsonb; max_mentions int;
begin
  select coalesce(jsonb_agg(token || jsonb_build_object('field',field) order by field, (token->>'position')::int),'[]') into tokens
  from (values ('summary',new.summary_markup),('body',new.body_markup)) fields(field,markup),
       lateral jsonb_array_elements(cl_parse_mention_text(coalesce(markup,''))->'mentions') token;
  select coalesce(jsonb_agg(jsonb_build_object('field',field,'position',position,'label',label,
      'target',coalesce(term_key,'item:'||item_id,'area:'||area_id,'term:'||term_id::text)) order by field::text,position),'[]') into rows_
    from item_version_mentions where version_id=new.id;
  select least(50,greatest(0,value::int)) into max_mentions from settings_current where key='limits.mentions_per_version';
  if jsonb_array_length(tokens)>coalesce(max_mentions,50) then
    raise exception 'at most % mentions are allowed',coalesce(max_mentions,50) using errcode='check_violation';
  end if;
  if tokens is distinct from rows_ then
    raise exception 'Mention rows do not match text' using errcode='check_violation';
  end if;
  if exists(select 1 from item_version_mentions where version_id=new.id and item_id=new.item_id) then
    raise exception 'item % mentions itself', new.item_id using errcode='check_violation';
  end if;
  return null;
end $$;

-- What a version keeps: a mention of a term adds its id, so the versions written before stay as
-- they were.
create or replace function public.cl_item_version_kept(p_version uuid) returns jsonb
    language sql stable
    as $$
  select jsonb_build_object(
    'item', v.item_id, 'title', v.title, 'summary', v.summary, 'body', v.body,
    'summaryMarkup', v.summary_markup, 'bodyMarkup', v.body_markup, 'notToConclude', v.not_to_conclude,
    'validFrom', v.valid_from, 'validUntil', v.valid_until, 'proposer', v.proposer_id, 'via', v.created_via,
    'audience', v.audience_groups, 'recheck', v.is_recheck,
    'metrics', (select coalesce(jsonb_agg(m.metric_key order by m.metric_key), '[]')
                  from item_version_metrics m where m.version_id = v.id),
    'dimensions', (select coalesce(jsonb_agg(d.dimension_key order by d.dimension_key), '[]')
                     from item_version_dimensions d where d.version_id = v.id),
    'values', (select coalesce(jsonb_agg(jsonb_build_array(d.dimension_key, d.value_key) order by d.value_key), '[]')
                 from item_version_dimension_values d where d.version_id = v.id),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_array(e.url, e.quote, e.read_on) order by e.position), '[]')
                   from item_version_evidence e where e.version_id = v.id),
    'references', (select coalesce(jsonb_object_agg(r.definition_ref, r.change_mark), '{}')
                     from item_version_refs r where r.version_id = v.id),
    'replaces', (select coalesce(jsonb_agg(x.replaced_item_id order by x.replaced_item_id), '[]')
                   from item_version_replaces x where x.version_id = v.id),
    'conflicts', (select coalesce(jsonb_agg(c.other_item_id order by c.other_item_id), '[]')
                    from item_version_conflicts c where c.version_id = v.id),
    'mentions', (select coalesce(jsonb_agg(
                     case when n.term_id is null
                          then jsonb_build_array(n.field, n.position, n.label, n.term_key, n.item_id, n.area_id)
                          else jsonb_build_array(n.field, n.position, n.label, n.term_key, n.item_id, n.area_id, n.term_id) end
                     order by n.field, n.position), '[]')
                   from item_version_mentions n where n.version_id = v.id))
  from item_versions v where v.id = p_version $$;

-- A mention of a term is current while the term is there, and retired once it is deleted.
create or replace view public.v_mention_status with (security_invoker='true') as
 select m.version_id,
    m.field,
    m."position",
    m.label,
    coalesce(m.term_key, ('item:'::text || m.item_id), ('area:'::text || m.area_id), ('term:'::text || m.term_id::text)) as target,
        case
            when (m.item_id is not null) then 'item'::text
            when (m.area_id is not null) then 'area'::text
            when (m.term_id is not null) then 'term'::text
            else ( select (k.kind)::text as kind
               from public.vocab_terms k
              where (k.key = m.term_key))
        end as target_type,
    d.ref as definition_ref,
    d.renamed_to,
    rep.item_id as replaced_by,
        case
            when (m.item_id is not null) then
            case
                when (exists ( select 1
                   from public.item_version_service s
                  where ((s.item_id = m.item_id) and (s.editions @> ( select live_edition.seq
                           from public.live_edition))))) then 'current'::text
                when (rep.item_id is not null) then 'replaced'::text
                else 'retired'::text
            end
            when (m.area_id is not null) then 'current'::text
            when (m.term_id is not null) then
            case
                when (exists ( select 1
                   from public.terms w
                  where ((w.id = m.term_id) and (w.deleted_at is null)))) then 'current'::text
                else 'retired'::text
            end
            when (t.served is null) then 'unresolved'::text
            when (d.ref is null) then 'current'::text
            when d.missing then 'source_missing'::text
            when d.changed then 'source_changed'::text
            else 'current'::text
        end as status
   from (((public.item_version_mentions m
     left join lateral ( select true as served,
            public.cl_relevant_refs(coalesce(( select array_agg(r.definition_ref order by (r.definition_ref collate "C")) as array_agg
                   from public.vocab_term_refs r
                  where (r.version_id = s.version_id)), '{}'::text[]), public.cl_version_metric_refs(m.version_id)) as refs
           from public.vocab_term_service s
          where ((s.term_key = m.term_key) and (s.editions @> ( select live_edition.seq
                   from public.live_edition)))) t on ((m.term_key is not null)))
     left join lateral ( select d_1.ref,
            d_1.renamed_to,
            (d_1.missing_since_snapshot is not null) as missing,
            coalesce(((m.definition_ref = d_1.ref) and (m.change_mark <> d_1.change_mark)), false) as changed
           from (unnest(t.refs) with ordinality x(ref, n)
             join public.definitions d_1 on ((d_1.ref = x.ref)))
          order by (d_1.missing_since_snapshot is not null) desc, coalesce(((m.definition_ref = d_1.ref) and (m.change_mark <> d_1.change_mark)), false) desc, x.n
         limit 1) d on (true))
     left join lateral ( select s.item_id
           from (public.item_version_service s
             join public.item_version_replaces r on ((r.version_id = s.version_id)))
          where ((r.replaced_item_id = m.item_id) and (s.editions @> ( select live_edition.seq
                   from public.live_edition)))
          order by s.item_id
         limit 1) rep on ((m.item_id is not null)));

-- The links of a version: a mention of a term goes to the term as `term:<id>`, the way a metric is
-- named by its key.
create or replace view public.v_version_links with (security_invoker='true') as
 select item_version_mentions.version_id,
    'mentions'::text as rel,
        case
            when (item_version_mentions.term_key is not null) then ( select (t.kind)::text as kind
               from public.vocab_terms t
              where (t.key = item_version_mentions.term_key))
            when (item_version_mentions.item_id is not null) then 'item'::text
            when (item_version_mentions.term_id is not null) then 'term'::text
            else 'area'::text
        end as to_kind,
    coalesce(item_version_mentions.term_key, item_version_mentions.item_id, item_version_mentions.area_id, ('term:'::text || item_version_mentions.term_id::text)) as to_id,
    item_version_mentions.label,
    item_version_mentions.definition_ref,
    item_version_mentions.change_mark
   from public.item_version_mentions
union all
 select item_version_metrics.version_id,
    'applies_to'::text as rel,
    'metric'::text as to_kind,
    item_version_metrics.metric_key as to_id,
    null::text as label,
    null::text as definition_ref,
    null::text as change_mark
   from public.item_version_metrics
union all
 select item_version_dimension_values.version_id,
    'applies_to'::text as rel,
    'dimension_value'::text as to_kind,
    item_version_dimension_values.value_key as to_id,
    null::text as label,
    null::text as definition_ref,
    null::text as change_mark
   from public.item_version_dimension_values
union all
 select item_version_replaces.version_id,
    'replaces'::text as rel,
    'item'::text as to_kind,
    item_version_replaces.replaced_item_id as to_id,
    null::text as label,
    null::text as definition_ref,
    null::text as change_mark
   from public.item_version_replaces
union all
 select item_version_conflicts.version_id,
    'conflicts_with'::text as rel,
    'item'::text as to_kind,
    item_version_conflicts.other_item_id as to_id,
    null::text as label,
    null::text as definition_ref,
    null::text as change_mark
   from public.item_version_conflicts
union all
 select item_version_dimensions.version_id,
    'applies_to'::text as rel,
    'dimension'::text as to_kind,
    item_version_dimensions.dimension_key as to_id,
    null::text as label,
    null::text as definition_ref,
    null::text as change_mark
   from public.item_version_dimensions;

