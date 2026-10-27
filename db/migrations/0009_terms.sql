-- 0009_terms: the terms and synonyms people write in Definitions (docs/product.md, section 3;
-- FR-138). Metrics and dimensions stay the definitions source's, read only.
--
-- - A term is a word with its own meaning ("Peak season"). A synonym is another name for a metric,
--   a dimension or a term with its own meaning ("GMV" for Gross sales). Both are rows of `terms`:
--   a synonym names what it means (`same_as_key` for a metric or a dimension of the vocabulary,
--   `same_as_term` for a term) instead of a meaning of its own. A synonym never points at another
--   synonym, and a term that other words point at keeps its own meaning.
-- - One word, one meaning: a word (its name, trimmed, its spaces folded and in lower case) is
--   held by one term at most, and a term never takes a word the live vocabulary or the
--   definitions source already uses for a metric or a dimension: its name, its other names, the
--   source's name, title or synonyms for it. A sync can still give a word a second meaning later;
--   the term then shows the conflict until its owner settles it.
-- - Its domain: a term's own; a synonym's is what it means, copied when it is written.
--   An owner of the domain or an admin writes it; a term with no domain is an admin's.
-- - Deleted: a term is never removed. A deleted one records who deleted it and when, and the
--   synonyms that pointed at it go with it (`deleted_with`); restoring it brings them back.
-- - History: every write keeps a version (term_versions, append only).
-- - Changes to many terms at once (delete, move) keep one term_changes row each, with what Undo
--   needs; its maker undoes it within limits.undo_seconds.
-- Agents do not read terms yet: the serving role has no grant on these tables.

create table public.terms (
    id uuid default uuidv7() not null primary key,
    name text not null,
    word text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
    meaning text,
    same_as_key text references public.vocab_terms(key),
    same_as_term uuid references public.terms(id),
    area_id text references public.areas(id),
    created_by uuid not null references public.people(id),
    created_at timestamp with time zone default now() not null,
    updated_by uuid not null references public.people(id),
    updated_at timestamp with time zone default now() not null,
    revision integer default 1 not null,
    deleted_at timestamp with time zone,
    deleted_by uuid references public.people(id),
    deleted_with uuid references public.terms(id),
    constraint terms_name_check check (char_length(btrim(name)) between 1 and 100 and name !~ '[,\r\n\t]'),
    constraint terms_meaning_check check (meaning is null or char_length(btrim(meaning)) between 1 and 4000),
    constraint terms_one_meaning check (num_nonnulls(meaning, same_as_key, same_as_term) = 1),
    constraint terms_not_itself check (same_as_term is distinct from id),
    constraint terms_deleted_check check ((deleted_at is null) = (deleted_by is null)),
    constraint terms_deleted_with_check check (deleted_with is null or deleted_at is not null),
    constraint terms_revision_check check (revision >= 1)
);

create unique index terms_one_word on public.terms using btree (word) where (deleted_at is null);
create index terms_same_as_term on public.terms using btree (same_as_term) where (same_as_term is not null);
create index terms_deleted on public.terms using btree (deleted_at desc) where (deleted_at is not null);

-- The words the live vocabulary and the definitions source use for its metrics and dimensions,
-- each with the metric or dimension that has it: its name and other names (`vocabulary`), and
-- the source's name, title and synonyms for it (`source`, with the connector that read them).
create function public.cl_vocabulary_words() returns table(word text, origin text, key text, name text, connector_id text)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  with live as (
    select s.term_key, v.id as version_id, v.name, v.aliases
      from vocab_term_service s
      join vocab_term_versions v on v.id = s.version_id
      join vocab_terms t on t.key = s.term_key
     where s.editions @> (select seq from live_edition) and t.kind in ('metric', 'dimension'))
  select lower(regexp_replace(btrim(w), '\s+', ' ', 'g')), 'vocabulary', l.term_key, l.name, null::text
    from live l, unnest(array[l.name] || l.aliases) w
  union all
  select lower(regexp_replace(btrim(w), '\s+', ' ', 'g')), 'source', l.term_key, l.name, d.connector_id
    from live l
    join vocab_term_refs r on r.version_id = l.version_id
    join definitions d on d.ref = r.definition_ref and d.missing_since_snapshot is null,
    unnest(array[d.name, d.title] || d.synonyms) w
   where w is not null and btrim(w) <> '' $$;

-- The domain of what a synonym means: a term's own, or the live vocabulary's for a metric or a
-- dimension, else the one its source gives, else none.
create function public.cl_term_target_area(p_key text, p_term uuid) returns text
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select case when p_term is not null then (select area_id from terms where id = p_term)
    else (select coalesce(v.area_id, d.area_id)
            from vocab_term_service s join vocab_term_versions v on v.id = s.version_id
            left join source_domain_service d on d.term_key = s.term_key
                  and d.editions @> (select seq from live_edition)
           where s.term_key = p_key and s.editions @> (select seq from live_edition)
           limit 1)
  end $$;

-- The rules every write keeps, whatever path it comes by.
create function public.terms_guard() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  -- A stored generated column is computed after this trigger: the word is worked out here.
  v_word text := lower(regexp_replace(btrim(new.name), '\s+', ' ', 'g'));
  restoring boolean := tg_op = 'UPDATE' and old.deleted_at is not null and new.deleted_at is null;
  claims boolean := tg_op = 'INSERT' or restoring
                    or (new.deleted_at is null and (v_word <> old.word
                        or new.same_as_key is distinct from old.same_as_key
                        or new.same_as_term is distinct from old.same_as_term));
begin
  if tg_op = 'UPDATE' then
    if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at then
      raise exception 'a term keeps its id and who wrote it' using errcode = 'check_violation';
    end if;
    if old.deleted_at is not null and not restoring then
      raise exception 'term % was deleted: restore it first', old.id using errcode = 'check_violation';
    end if;
    if new.deleted_at is not null and old.deleted_at is null then
      if exists (select 1 from terms s where s.same_as_term = new.id and s.deleted_at is null) then
        raise exception 'delete the synonyms of term % with it', new.id using errcode = 'check_violation';
      end if;
      new.deleted_by := cl_person();
    end if;
    if restoring then
      new.deleted_by := null;
      new.deleted_with := null;
    end if;
    new.revision := old.revision + 1;
    new.updated_at := now();
  end if;
  if new.deleted_at is null then
    if new.same_as_key is not null and not exists (
         select 1 from vocab_term_service s join vocab_terms t on t.key = s.term_key
          where s.term_key = new.same_as_key and t.kind in ('metric', 'dimension')
            and s.editions @> (select seq from live_edition)) and claims then
      raise exception 'a synonym means a metric or a dimension agents get now' using errcode = 'foreign_key_violation';
    end if;
    if new.same_as_term is not null and not exists (
         select 1 from terms t where t.id = new.same_as_term and t.deleted_at is null and t.meaning is not null) then
      raise exception 'a synonym means a term with its own meaning' using errcode = 'check_violation';
    end if;
    if new.meaning is null and exists (
         select 1 from terms s where s.same_as_term = new.id and s.deleted_at is null) then
      raise exception 'other words mean term %: it keeps its own meaning', new.id using errcode = 'check_violation';
    end if;
    -- A synonym's domain is what it means.
    if new.meaning is null then
      new.area_id := cl_term_target_area(new.same_as_key, new.same_as_term);
    end if;
    if claims and exists (select 1 from cl_vocabulary_words() w where w.word = v_word) then
      raise exception 'the word "%" already means a metric or a dimension', btrim(new.name)
        using errcode = 'unique_violation', constraint = 'terms_vocabulary_word';
    end if;
  end if;
  return new;
end $$;

create trigger terms_guard before insert or update on public.terms
    for each row execute function public.terms_guard();

-- A term's synonyms follow it to its new domain.
create function public.terms_follow() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
begin
  update terms set updated_by = coalesce(cl_person(), updated_by)
   where same_as_term = new.id and deleted_at is null and area_id is distinct from new.area_id;
  return null;
end $$;

create trigger terms_follow after update of area_id on public.terms
    for each row when (new.meaning is not null and new.deleted_at is null and new.area_id is distinct from old.area_id)
    execute function public.terms_follow();

-- What each write made of the term, newest last.
create table public.term_versions (
    id uuid default uuidv7() not null primary key,
    term_id uuid not null references public.terms(id),
    revision integer not null,
    change text not null,
    name text not null,
    meaning text,
    same_as_key text,
    same_as_term uuid,
    area_id text,
    made_by uuid not null references public.people(id),
    made_at timestamp with time zone default now() not null,
    constraint term_versions_change_check
        check (change in ('created', 'edited', 'moved', 'deleted', 'restored')),
    unique (term_id, revision)
);

select public.cl_make_append_only('public.term_versions');

create function public.terms_version() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
begin
  insert into term_versions (term_id, revision, change, name, meaning, same_as_key, same_as_term, area_id, made_by)
  values (new.id, new.revision,
          case when tg_op = 'INSERT' then 'created'
               when new.deleted_at is not null then 'deleted'
               when old.deleted_at is not null then 'restored'
               when new.area_id is distinct from old.area_id and new.name = old.name
                    and new.meaning is not distinct from old.meaning
                    and new.same_as_key is not distinct from old.same_as_key
                    and new.same_as_term is not distinct from old.same_as_term then 'moved'
               else 'edited' end,
          new.name, new.meaning, new.same_as_key, new.same_as_term, new.area_id,
          coalesce(cl_person(), new.updated_by));
  return null;
end $$;

create trigger terms_version after insert or update on public.terms
    for each row execute function public.terms_version();

alter table public.terms enable row level security;
alter table public.term_versions enable row level security;

-- Anyone signed in reads the terms; a deleted one, its domain's owners, admins and who deleted it.
create policy terms_read on public.terms for select
    using (deleted_at is null or public.cl_is_admin_now() or deleted_by = public.cl_person()
           or (area_id is not null and public.cl_is_owner_now(area_id)));

create policy terms_insert on public.terms for insert
    with check (created_by = public.cl_person() and updated_by = public.cl_person()
                and (public.cl_is_admin_now() or (area_id is not null and public.cl_is_owner_now(area_id))));

-- An owner changes a term of their domain, and moves it only to a domain they own too.
create policy terms_update on public.terms for update
    using (public.cl_is_admin_now() or (area_id is not null and public.cl_is_owner_now(area_id)))
    with check (updated_by = public.cl_person()
                and (public.cl_is_admin_now() or (area_id is not null and public.cl_is_owner_now(area_id))));

create policy term_versions_read on public.term_versions for select
    using (exists (select 1 from public.terms t where t.id = term_versions.term_id));

-- One change to many terms at once. `terms` lists the terms it changed ({id, name, areaId});
-- `undo` holds what taking it back needs: the terms it deleted, or each term's domain before.
create table public.term_changes (
    id uuid default uuidv7() not null primary key,
    action text not null,
    made_by uuid not null references public.people(id),
    made_at timestamp with time zone default now() not null,
    summary text not null,
    terms jsonb not null,
    undo jsonb default '{}'::jsonb not null,
    undone_at timestamp with time zone,
    constraint term_changes_action_check check (action in ('deleted', 'moved')),
    constraint term_changes_summary_check check (char_length(btrim(summary)) between 1 and 500),
    constraint term_changes_terms_check check (jsonb_typeof(terms) = 'array' and jsonb_array_length(terms) > 0)
);

create index term_changes_made_at on public.term_changes using btree (made_at desc);

alter table public.term_changes enable row level security;

create policy term_changes_read on public.term_changes for select
    using (made_by = public.cl_person() or public.cl_is_admin_now());

create policy term_changes_insert on public.term_changes for insert
    with check (made_by = public.cl_person());

-- Only its maker undoes a change, once, within the window.
create policy term_changes_undo on public.term_changes for update
    using (made_by = public.cl_person() and undone_at is null
           and made_at > now() - make_interval(secs => coalesce(
                 (select (value #>> '{}')::int from public.settings_current where key = 'limits.undo_seconds'), 15)))
    with check (made_by = public.cl_person() and undone_at is not null);
