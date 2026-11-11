-- 0047_source_view_lists: a definitions source reads every group (a Cube view), or only the groups
-- an administrator listed, and a list may be empty.
--
-- Until now an empty `scopes` meant every group, so a source could not list no group at all, and
-- an allow list emptied by mistake read everything. `all_groups` says which it is: true reads every
-- group, the chosen scopes then only mapping domains; false reads only the groups in `scopes`, and
-- none when it is empty. A source with groups chosen already reads only those, as before. A content
-- source always reads only its chosen scopes, so the column says nothing for it.
--
-- A source may now list up to 2,000 groups, for a model of hundreds of views.

alter table public.connectors
  add column all_groups boolean not null default true,
  drop constraint connectors_scopes_check,
  add constraint connectors_scopes_check
    check (jsonb_typeof(scopes) = 'array' and jsonb_array_length(scopes) <= 2000);

update public.connectors set all_groups = false where jsonb_array_length(scopes) > 0;
