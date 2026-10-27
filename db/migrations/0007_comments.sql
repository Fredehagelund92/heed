-- 0007_comments: comments, reactions and mentions on suggestions and context items (FR-817,
-- docs/product.md, sections 4 and 9; golden plan P9).
--
-- - A comment hangs on a suggestion (a proposal) or on a context item, as a reply under a comment
--   or as a comment of its own. Its words are the comment box's small document (JSON), checked by
--   the service (src/domain/comments.ts). Anyone who may read what it hangs on may comment; people
--   edit and delete only their own. A comment something answers keeps its place when deleted, its
--   words gone; one nobody answered goes.
-- - "Return with a note" writes its note as the suggestion's first comment, marked returned and
--   tied to its decision; undoing the return takes the note away again.
-- - A reaction is one of five, on the suggestion or item itself or on a comment, once per person.
-- - A comment's mentions of people are kept apart, so the person mentioned finds them in their
--   Inbox and marks them seen. thread_reads keeps when a person last opened a thread, so a reply
--   since then brings the card back to Needs you.
-- - Agents never read any of it: the serving and analytics roles are granted nothing here, and no
--   edition, export or serving function reads these tables.

-- Whether the person in this transaction may read what a comment hangs on: the item or the
-- suggestion, under their own row security. Runs as its caller, so it never widens what they read.
create function public.cl_comment_subject_open(p_item text, p_proposal uuid) returns boolean
    language sql stable
    set search_path to 'public', 'pg_temp'
    as $$
  select case
    when p_item is not null then exists (select 1 from item_versions v where v.item_id = p_item)
    when p_proposal is not null then exists (select 1 from proposals p where p.id = p_proposal)
    else false end $$;

create table public.comments (
    id uuid default gen_random_uuid() not null primary key,
    item_id text references public.items(id),
    proposal_id uuid references public.proposals(id),
    parent_id uuid references public.comments(id) on delete cascade,
    author_id uuid not null references public.people(id),
    kind text default 'comment' not null,
    -- The return with a note this comment is the note of.
    decision_id uuid unique references public.decisions(id),
    body jsonb not null,
    created_at timestamp with time zone default now() not null,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    constraint comments_subject_check check (num_nonnulls(item_id, proposal_id) = 1),
    constraint comments_kind_check check (kind in ('comment', 'returned')),
    constraint comments_returned_check check ((kind = 'returned') = (decision_id is not null)
                                              and (kind = 'comment' or proposal_id is not null)),
    constraint comments_body_check check (jsonb_typeof(body) = 'object' and body ->> 'type' = 'doc'
                                          and octet_length(body::text) <= 65536),
    constraint comments_deleted_check check (deleted_at is null or body = '{"type": "doc"}'::jsonb)
);

create index comments_item on public.comments using btree (item_id, created_at) where (item_id is not null);
create index comments_proposal on public.comments using btree (proposal_id, created_at) where (proposal_id is not null);
create index comments_parent on public.comments using btree (parent_id) where (parent_id is not null);

-- A reply answers a comment of its own (one level), on the same subject, that is not deleted. What
-- it hangs on, who wrote it, and when, never change; an edit changes the words, and a delete takes
-- them away for good.
create function public.comments_guard() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
declare parent comments;
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.edited_at := null;
    new.deleted_at := null;
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
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  else
    new.edited_at := old.edited_at;
  end if;
  return new;
end $$;

create trigger comments_guard before insert or update on public.comments
    for each row execute function public.comments_guard();

alter table public.comments enable row level security;

-- A signed-in person who may read what a comment hangs on reads it, never a read without a person;
-- anyone may write one there, as themselves; only its author changes or removes it.
create policy comments_read on public.comments for select
    using (public.cl_person() is not null and public.cl_comment_subject_open(item_id, proposal_id));

create policy comments_insert on public.comments for insert
    with check (author_id = public.cl_person() and public.cl_comment_subject_open(item_id, proposal_id));

create policy comments_update on public.comments for update
    using (author_id = public.cl_person() and public.cl_comment_subject_open(item_id, proposal_id))
    with check (author_id = public.cl_person());

create policy comments_delete on public.comments for delete
    using (author_id = public.cl_person());

-- The people a comment mentions, each once, and when they saw it. Its author writes them with the
-- comment and changes them with an edit; the person mentioned reads theirs and marks them seen.
create table public.comment_mentions (
    comment_id uuid not null references public.comments(id) on delete cascade,
    person_id uuid not null references public.people(id),
    seen_at timestamp with time zone,
    primary key (comment_id, person_id)
);

create index comment_mentions_person on public.comment_mentions using btree (person_id) where (seen_at is null);

alter table public.comment_mentions enable row level security;

create policy comment_mentions_read on public.comment_mentions for select
    using (person_id = public.cl_person()
           or exists (select 1 from public.comments c where c.id = comment_mentions.comment_id and c.author_id = public.cl_person()));

create policy comment_mentions_insert on public.comment_mentions for insert
    with check (seen_at is null
                and exists (select 1 from public.comments c where c.id = comment_mentions.comment_id
                              and c.author_id = public.cl_person() and c.deleted_at is null));

create policy comment_mentions_seen on public.comment_mentions for update
    using (person_id = public.cl_person()) with check (person_id = public.cl_person());

create policy comment_mentions_delete on public.comment_mentions for delete
    using (exists (select 1 from public.comments c where c.id = comment_mentions.comment_id and c.author_id = public.cl_person()));

-- A reaction: one of five, by one person, once, on a comment or on the suggestion or item itself.
create table public.reactions (
    id uuid default gen_random_uuid() not null primary key,
    person_id uuid not null references public.people(id),
    emoji text not null,
    comment_id uuid references public.comments(id) on delete cascade,
    item_id text references public.items(id),
    proposal_id uuid references public.proposals(id),
    created_at timestamp with time zone default now() not null,
    constraint reactions_emoji_check check (emoji in ('👍', '👀', '✅', '🤔', '🙏')),
    constraint reactions_target_check check (num_nonnulls(comment_id, item_id, proposal_id) = 1)
);

create unique index reactions_once_comment on public.reactions using btree (comment_id, person_id, emoji) where (comment_id is not null);
create unique index reactions_once_item on public.reactions using btree (item_id, person_id, emoji) where (item_id is not null);
create unique index reactions_once_proposal on public.reactions using btree (proposal_id, person_id, emoji) where (proposal_id is not null);

-- A deleted comment takes no reactions, and loses the ones it had: its words are gone.
create function public.reactions_guard() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
begin
  if new.comment_id is not null and exists (select 1 from comments c where c.id = new.comment_id and c.deleted_at is not null) then
    raise exception 'comment % was deleted', new.comment_id using errcode = 'check_violation';
  end if;
  new.created_at := now();
  return new;
end $$;

create trigger reactions_guard before insert on public.reactions
    for each row execute function public.reactions_guard();

create function public.comments_clear_reactions() returns trigger
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
begin
  delete from reactions where comment_id = new.id;
  delete from comment_mentions where comment_id = new.id;
  return null;
end $$;

create trigger comments_clear_reactions after update of deleted_at on public.comments
    for each row when (new.deleted_at is not null and old.deleted_at is null)
    execute function public.comments_clear_reactions();

alter table public.reactions enable row level security;

create policy reactions_read on public.reactions for select
    using (public.cl_person() is not null and case when comment_id is not null
                then exists (select 1 from public.comments c where c.id = reactions.comment_id)
                else public.cl_comment_subject_open(item_id, proposal_id) end);

create policy reactions_insert on public.reactions for insert
    with check (person_id = public.cl_person()
                and case when comment_id is not null
                         then exists (select 1 from public.comments c where c.id = reactions.comment_id)
                         else public.cl_comment_subject_open(item_id, proposal_id) end);

create policy reactions_delete on public.reactions for delete
    using (person_id = public.cl_person());

-- When a person last opened a thread: a reply since then is new to them.
create table public.thread_reads (
    person_id uuid not null references public.people(id),
    item_id text references public.items(id),
    proposal_id uuid references public.proposals(id),
    seen_at timestamp with time zone default now() not null,
    constraint thread_reads_subject_check check (num_nonnulls(item_id, proposal_id) = 1)
);

create unique index thread_reads_item on public.thread_reads using btree (person_id, item_id) where (item_id is not null);
create unique index thread_reads_proposal on public.thread_reads using btree (person_id, proposal_id) where (proposal_id is not null);

alter table public.thread_reads enable row level security;

create policy thread_reads_own on public.thread_reads
    using (person_id = public.cl_person())
    with check (person_id = public.cl_person() and public.cl_comment_subject_open(item_id, proposal_id));
