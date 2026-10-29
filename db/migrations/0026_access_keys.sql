-- 0026_access_keys: access keys for a bot or a scheduled job that can't sign in (golden plan
-- P11a; FR-403, FR-410, docs/ai-sign-in.md).
--
-- - An administrator creates a key in Settings, Agents and access. The key is shown once and kept
--   here only as its SHA-256. It names no person: it acts as a service with the read and feedback
--   scopes, under its own client label `access-key` in the MCP request log, deliveries and client
--   policies, so suggest_context refuses it.
-- - A key lasts until an administrator revokes it, which ends it at once: the MCP server asks the
--   database at every request. Who made it and who revoked it are kept for the list and the
--   history log; the history log records `access_key.created` and `access_key.revoked`.
-- - The MCP server reads no row here. serving_access_key answers for one digest whether it is an
--   open key, and notes when it was last used, at most once a minute.

create table auth.access_keys (
    id uuid default uuidv7() primary key,
    key_hash text not null unique,
    created_by uuid not null references public.people(id),
    created_at timestamp with time zone default now() not null,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoked_by uuid references public.people(id),
    constraint access_keys_key_hash_check check (key_hash ~ '^[a-f0-9]{64}$'),
    constraint access_keys_revoked_check check ((revoked_at is null) = (revoked_by is null))
);
create index access_keys_open on auth.access_keys using btree (created_at desc) where revoked_at is null;

insert into public.client_policies (client_label, display_name, tools_allowed, rate_per_minute, max_response_bytes, enabled)
values ('access-key', 'Access keys', null, null, 100000, true);

-- Whether a key's digest is an open key: `open`, `revoked`, or null for no key at all. A used key's
-- last use moves on at most once a minute, so a busy job does not write at every request.
create function public.serving_access_key(p_hash text)
    returns text
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  found_key auth.access_keys%rowtype;
begin
  select * into found_key from auth.access_keys where key_hash = p_hash;
  if not found then return null; end if;
  if found_key.revoked_at is not null then return 'revoked'; end if;
  if found_key.last_used_at is null or found_key.last_used_at < now() - interval '1 minute' then
    update auth.access_keys set last_used_at = now()
     where id = found_key.id and revoked_at is null;
  end if;
  return 'open';
end $$;
revoke all on function public.serving_access_key(text) from public;
