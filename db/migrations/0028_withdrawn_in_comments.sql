-- 0028_withdrawn_in_comments: a suggestion to archive its sender takes back in the comments, and
-- the owner's Close (golden plan P9c; docs/product.md, section 4).
--
-- - The person who suggested archiving a context item may mark one of their own comments on that
--   suggestion as taking it back, while it waits for a decision. The suggestion stays with its
--   owners, who see "Withdrawn by" and the comment's words in the review, and either close it
--   (nothing changes, the context item stays live) or archive it anyway. One comment of a
--   suggestion holds the mark at a time; its writer may take the mark back while it waits.
--   Deleting the comment takes the mark with its words.
-- - Close is the owners' decision not to archive (a reject decision), which its maker may undo in
--   the undo window like a publish or an archive: the suggestion then waits again.

alter table public.comments
    add column withdrew_at timestamp with time zone,
    add constraint comments_withdrew_check check (
        withdrew_at is null or (proposal_id is not null and kind = 'comment' and deleted_at is null));

create unique index comments_withdrawal on public.comments using btree (proposal_id)
    where (withdrew_at is not null);

-- The guard of 0007, and the mark: only the suggestion's sender sets or takes back the mark on their
-- own comment, only on a suggestion to archive that still waits, and the time is the database's.
create or replace function public.comments_guard() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
declare parent comments;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
    new.withdrew_at := null;
    if new.parent_id is not null then
      select * into parent from comments where id = new.parent_id;
      if parent.id is null or parent.parent_id is not null or parent.deleted_at is not null
         or parent.item_id is distinct from new.item_id or parent.proposal_id is distinct from new.proposal_id
         or new.kind <> 'comment' then
        raise exception 'comment % answers no comment of its own on the same subject', new.id
          using errcode = 'check_violation';
      end if;
    end if;
    return new;
  end if;
  if old.deleted_at is not null then
    raise exception 'comment % was deleted', old.id using errcode = 'check_violation';
  end if;
  if (new.id, new.item_id, new.proposal_id, new.parent_id, new.author_id, new.kind, new.decision_id, new.created_at)
     is distinct from (old.id, old.item_id, old.proposal_id, old.parent_id, old.author_id, old.kind, old.decision_id, old.created_at) then
    raise exception 'comment % keeps what it hangs on, its author and its time', old.id
      using errcode = 'check_violation';
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

-- A closed suggestion waits again only when its close is undone in the same transaction, as a
-- published one does when its publish is undone (0006).
insert into public.proposal_transitions (from_state, to_state) values ('rejected', 'submitted');

create or replace function public.proposals_guard_reopen() returns trigger
    language plpgsql
    as $$
begin
  if old.state in ('accepted', 'rejected') and new.state = 'submitted'
     and not exists (select 1 from decision_undos u join decisions d on d.id = u.decision_id
                      where d.proposal_id = new.id
                        and d.outcome = any(case old.state when 'accepted' then array['accept', 'retire']
                                                           else array['reject'] end::decision_outcome[])
                        and u.created_xact = pg_current_xact_id()) then
    raise exception 'proposal % reopens only when its decision is undone', old.id using errcode = 'check_violation';
  end if;
  return new;
end $$;
