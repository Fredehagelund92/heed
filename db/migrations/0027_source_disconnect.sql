-- 0026_source_disconnect: Disconnect in Settings › Integrations (CON-118).
--
-- An admin disconnects a source they added: it is read no more, its secrets leave the secret
-- store, and it leaves the integrations' list. Its row stays, because its reads, the suggestions
-- it made and the definitions it read name it: the history log, the Inbox's past and the
-- Definitions keep pointing at it. Who disconnected it, and when, are kept on the row; why is in
-- the history log (`source.removed`).
--
-- A disconnected source is switched off for good: nothing switches it on again. Connecting the
-- tool again adds a new source, which takes over the definitions the old one read.

alter table public.connectors
    add column removed_at timestamp with time zone,
    add column removed_by uuid references public.people(id),
    add constraint connectors_removed_check check (
        (removed_at is null) = (removed_by is null)
        and (removed_at is null or (not enabled and secret_ref is null and origin = 'workspace')));
