-- 0018_settings_agents: the workspace's name and the live line of Connect an agent (golden plan
-- P11a; FR-418, FR-818).
--
-- - The workspace's name is a setting an admin changes like any other (`workspace.name`), empty
--   until they name it. Everyone signed in reads it, and only it, through `workspace.get`: the
--   share card of an answer names the workspace it came from.
-- - When a person says no on the consent screen of an agent's sign-in, the live line on Connect an
--   agent says the connection was declined. The no is kept for an hour, for that person alone: who
--   said it, the app's own name for itself and when. Nothing else of the sign-in is kept, and the
--   history log is not told, as nothing changed.

insert into public.settings_versions (key, version, value, reason)
values ('workspace.name', 1, to_jsonb(''::text), 'default: no name until an admin gives the workspace one');

create table auth.oauth_declines (
    person_id uuid not null references public.people(id),
    client_name text not null,
    declined_at timestamp with time zone default now() not null,
    constraint oauth_declines_client_name_check check (char_length(client_name) between 1 and 200)
);
create index oauth_declines_person on auth.oauth_declines using btree (person_id, declined_at desc);
