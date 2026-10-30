-- 0031_anchored_comments: comments on a line of a suggestion's text or on one of its fields, and
-- a thread's resolved state (docs/product.md, section 4; design contract, section 5.3).
--
-- - A comment of its own on a suggestion may hang on one place of the review's source: a line of
--   its stored text, on the side it was read on (the text now, or the suggested text), or a field
--   of the Fields table by its name. The anchor names the two versions it was read against, so it
--   reads the same after a reload, and a later version of the suggestion shows it as written on an
--   earlier one. What a comment hangs on never changes, its anchor included.
-- - A thread on a line or a field is open or resolved. Anyone who may read the suggestion resolves
--   or reopens it; the database keeps who did and when, the last time each. Changing that is all
--   anyone but its author may do to a comment, and a thread whose first comment was deleted with
--   replies under it can still be resolved. Resolved or open, a thread never holds Publish.
-- - Agents never read any of it: these are columns of the comments table, which the serving and
--   analytics roles may not read (0007).

alter table public.comments
    add column anchor_before uuid references public.item_versions(id),
    add column anchor_after uuid references public.item_versions(id),
    add column anchor_field text,
    add column anchor_side text,
    add column anchor_line integer,
    add column resolved_at timestamp with time zone,
    add column resolved_by uuid references public.people(id),
    add column reopened_at timestamp with time zone,
    add column reopened_by uuid references public.people(id),
    -- An anchor is a field by its name, or a line on one side, read against the versions it names:
    -- only on a comment of its own on a suggestion.
    add constraint comments_anchor_check check (
        num_nonnulls(anchor_before, anchor_after, anchor_field, anchor_side, anchor_line) = 0
        or (proposal_id is not null and parent_id is null and kind = 'comment'
            and num_nonnulls(anchor_before, anchor_after) >= 1
            and ((anchor_field in ('title', 'kind', 'domain', 'owner', 'scope', 'validity',
                                   'reviewDate', 'sources', 'dontConclude')
                  and anchor_side is null and anchor_line is null)
                 or (anchor_field is null and anchor_line between 1 and 20000
                     and ((anchor_side = 'before' and anchor_before is not null)
                          or (anchor_side = 'after' and anchor_after is not null)))))),
    -- Only a thread on a line or a field is resolved, and each time says who.
    add constraint comments_resolved_check check (
        (resolved_at is null) = (resolved_by is null)
        and (reopened_at is null) = (reopened_by is null)
        and (num_nonnulls(resolved_at, reopened_at) = 0
             or num_nonnulls(anchor_field, anchor_line) = 1));

create index comments_open_anchors on public.comments using btree (proposal_id)
    where (num_nonnulls(anchor_field, anchor_line) = 1 and resolved_at is null);

-- The guard of 0028, with the anchor and the resolved state: an anchor names versions of the item
-- the suggestion changes and never changes; whoever may update a comment that is not theirs only
-- resolves or reopens it, and the database writes who and when.
create or replace function public.comments_guard() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
declare parent comments;
declare resolution_only boolean;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    new.withdrew_at := null;
    new.resolved_at := null;
    new.resolved_by := null;
    new.reopened_at := null;
    new.reopened_by := null;
    if new.parent_id is not null then
      select * into parent from comments where id = new.parent_id;
      if parent.id is null or parent.parent_id is not null or parent.deleted_at is not null
         or parent.item_id is distinct from new.item_id or parent.proposal_id is distinct from new.proposal_id
         or new.kind <> 'comment' then
        raise exception 'comment % answers no comment of its own on the same subject', new.id
          using errcode = 'check_violation';
      end if;
    end if;
    if exists (select 1 from unnest(array[new.anchor_before, new.anchor_after]) a(version)
                where a.version is not null
                  and not exists (select 1 from item_versions v join proposals p on p.item_id = v.item_id
                                   where v.id = a.version and p.id = new.proposal_id)) then
      raise exception 'comment % is anchored to a version of another item', new.id
        using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if (new.id, new.item_id, new.proposal_id, new.parent_id, new.author_id, new.kind, new.decision_id, new.created_at,
      new.anchor_before, new.anchor_after, new.anchor_field, new.anchor_side, new.anchor_line)
     is distinct from (old.id, old.item_id, old.proposal_id, old.parent_id, old.author_id, old.kind, old.decision_id, old.created_at,
      old.anchor_before, old.anchor_after, old.anchor_field, old.anchor_side, old.anchor_line) then
    raise exception 'comment % keeps what it hangs on, its author and its time', old.id
      using errcode = 'check_violation';
  end if;
  resolution_only := (new.body, new.edited_at, new.deleted_at, new.withdrew_at)
                     is not distinct from (old.body, old.edited_at, old.deleted_at, old.withdrew_at);
  if (old.deleted_at is not null or old.author_id is distinct from cl_person()) and not resolution_only then
    if old.deleted_at is not null then
      raise exception 'comment % was deleted', old.id using errcode = 'check_violation';
    end if;
    raise exception 'comment % changes only by its author, but for its resolved state', old.id
      using errcode = 'check_violation';
  end if;
  if (new.resolved_at is null) is distinct from (old.resolved_at is null) then
    if new.resolved_at is null then
      new.resolved_by := null;
      new.reopened_at := now();
      new.reopened_by := cl_person();
    else
      new.resolved_at := now();
      new.resolved_by := cl_person();
      new.reopened_at := old.reopened_at;
      new.reopened_by := old.reopened_by;
    end if;
  else
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
    new.reopened_at := old.reopened_at;
    new.reopened_by := old.reopened_by;
  end if;
  if resolution_only then
    return new;
  end if;
  if new.deleted_at is not null then
    new.deleted_at := now();
    new.edited_at := old.edited_at;
    new.withdrew_at := null;
    return new;
  end if;
  if (new.withdrew_at is null) is distinct from (old.withdrew_at is null) then
    if not exists (select 1 from proposals p
                    where p.id = new.proposal_id and p.proposer_id = new.author_id
                      and p.action = 'retire' and p.state in ('submitted', 'in_review')) then
      raise exception 'comment % takes back only its writer''s suggestion to archive, while it waits', old.id
        using errcode = 'check_violation';
    end if;
    new.withdrew_at := case when new.withdrew_at is null then null else now() end;
  else
    new.withdrew_at := old.withdrew_at;
  end if;
  if new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;

-- Anyone who may read a suggestion resolves or reopens a thread on one of its lines or fields;
-- the guard keeps the rest of the comment as its author left it.
create policy comments_resolve on public.comments for update
    using (public.cl_person() is not null and parent_id is null
           and num_nonnulls(anchor_field, anchor_line) = 1
           and public.cl_comment_subject_open(item_id, proposal_id))
    with check (public.cl_person() is not null and parent_id is null
                and num_nonnulls(anchor_field, anchor_line) = 1
                and public.cl_comment_subject_open(item_id, proposal_id));
