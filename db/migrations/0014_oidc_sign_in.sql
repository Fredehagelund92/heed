-- 0014_oidc_sign_in: company sign-in with OpenID Connect (FR-416; golden plan P8, part 2;
-- docs/ai-sign-in.md, "Signing in to the web app").
--
-- - A browser session records how it began (`method`: the dev picker, the demo picker or OIDC),
--   when it was last used and when it ends whatever happens. It ends after a stretch unused (the
--   idle limit, CL_SESSION_IDLE_HOURS) and at its absolute end (CL_SESSION_MAX_DAYS). Sessions
--   from before keep their end as both.
-- - An OIDC sign-in in progress is kept for ten minutes, tied to the browser that started it by a
--   cookie: the hash of its state, the hash of that browser's cookie, the nonce, the PKCE verifier
--   and where to go back. It is used once.
-- - A person's account at the identity provider (issuer and subject) is linked to the person at
--   their first OIDC sign-in, by an email address the provider has verified. Later sign-ins find
--   the person by that link, so a changed address at the provider still signs in the same person,
--   and another account with their address does not.
-- - An invite may come from the operator (the command-line `heed invite`, run with the database
--   owner's credential), which is how the first admin of a new install is invited: its sender is
--   empty, and it is accepted with the full authority of an admin.
-- - A member of a group the provider names and the install maps (CL_OIDC_MEMBER_GROUPS,
--   CL_OIDC_ADMIN_GROUPS) may sign in without an invite: they join as a Member, or an Admin for
--   the admin group. An Admin role given by the admin group ends at a sign-in outside it, unless it
--   would leave no active admin. Someone an admin removed does not come back through a group.

alter table auth.sessions
    add column method text default 'dev' not null,
    add column last_seen_at timestamp with time zone default now() not null,
    add column absolute_expires_at timestamp with time zone;
update auth.sessions set absolute_expires_at = expires_at;
alter table auth.sessions
    alter column absolute_expires_at set not null,
    add constraint sessions_method_check check (method in ('dev', 'demo', 'oidc')),
    add constraint sessions_absolute_check check (expires_at <= absolute_expires_at);
create index sessions_person on auth.sessions using btree (person_id);

create table auth.oidc_requests (
    state_hash text not null primary key,
    browser_hash text not null,
    nonce text not null,
    code_verifier text not null,
    return_to text not null,
    expires_at timestamp with time zone not null,
    created_at timestamp with time zone default now() not null,
    constraint oidc_requests_state_hash_check check (state_hash ~ '^[a-f0-9]{64}$'),
    constraint oidc_requests_browser_hash_check check (browser_hash ~ '^[a-f0-9]{64}$'),
    constraint oidc_requests_nonce_check check (nonce ~ '^[A-Za-z0-9_-]{43}$'),
    constraint oidc_requests_code_verifier_check check (code_verifier ~ '^[A-Za-z0-9_-]{43}$'),
    constraint oidc_requests_return_to_check check (char_length(return_to) between 1 and 512 and return_to like '/%')
);
create index oidc_requests_expiry on auth.oidc_requests using btree (expires_at);

create table auth.identities (
    issuer text not null,
    subject text not null,
    person_id uuid not null references public.people(id),
    created_at timestamp with time zone default now() not null,
    last_signed_in_at timestamp with time zone default now() not null,
    primary key (issuer, subject),
    constraint identities_issuer_check check (char_length(issuer) between 1 and 512),
    constraint identities_subject_check check (char_length(subject) between 1 and 255)
);
-- One account per person at each provider.
create unique index identities_person on auth.identities using btree (issuer, person_id);

-- An Admin role the admin group gave, so a sign-in outside the group ends it and no other.
create table auth.group_admins (
    person_id uuid not null primary key references public.people(id),
    granted_at timestamp with time zone default now() not null
);

-- The operator's invite has no sender, and the operator takes an invite back without one; the
-- row policy still makes everyone else who takes one back name themselves.
alter table public.invites alter column invited_by drop not null;
alter table public.invites drop constraint invites_revoked_check,
    add constraint invites_revoked_check check (revoked_by is null or revoked_at is not null);

-- As in 0012, with the operator's invite: no sender means an admin's authority, recorded as the
-- service's.
create or replace function auth.accept_invite(p_email text, p_name text) returns uuid
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  invite invites;
  person uuid;
  erased boolean;
  removed boolean;
  area text;
  areas text[];
  sender_admin boolean;
  sender_kind text;
  name text := nullif(btrim(p_name), '');
begin
  perform pg_advisory_xact_lock(hashtextextended('heed.roles', 0));
  select * into invite from invites
   where email = lower(btrim(p_email)) and accepted_at is null and revoked_at is null and expires_at > now()
   for update;
  if invite.id is null then return null; end if;
  select id, erased_at is not null, deactivated_at is not null into person, erased, removed
    from people where email = invite.email;
  sender_admin := invite.invited_by is null or cl_is_admin(invite.invited_by, now());
  sender_kind := case when invite.invited_by is null then 'service' else 'person' end;
  -- An erased person never comes back; one an admin removed comes back only on an admin's invite.
  if erased or (removed and not sender_admin) then return null; end if;
  select coalesce(array_agg(a.id order by a.id), '{}') into areas from areas a
   where a.id = any(invite.area_ids) and a.archived_at is null
     and (sender_admin or cl_has_area_role(invite.invited_by, a.id, 'owner', now()));
  if invite.role = 'admin' and not sender_admin then return null; end if;
  if invite.role = 'member' and not sender_admin and cardinality(areas) = 0 then return null; end if;
  if person is null then
    insert into people(email, display_name) values (invite.email, coalesce(name, invite.email))
      returning id into person;
  else
    update people set deactivated_at = null where id = person and deactivated_at is not null;
  end if;
  update invites set accepted_at = now(), accepted_by = person where id = invite.id;
  insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details, source)
    values (person, 'person', 'invite.accepted', 'invite', invite.id::text,
            jsonb_build_object('person', person, 'role', invite.role, 'areas', to_jsonb(invite.area_ids)), 'named');
  if invite.role = 'admin' and not exists (select 1 from global_role_grants g
       where g.person_id = person and g.role = 'administrator' and g.valid_at @> now()) then
    insert into global_role_grants(person_id, role, granted_by) values (person, 'administrator', invite.invited_by);
    insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details, reason, source)
      values (invite.invited_by, sender_kind, 'role.granted', 'person', person::text,
              jsonb_build_object('role', 'administrator'), 'Invited', 'named');
  end if;
  foreach area in array areas loop
    if not cl_has_area_role(person, area, 'owner', now()) then
      insert into area_assignments(area_id, person_id, role, granted_by) values (area, person, 'owner', invite.invited_by);
      insert into audit_log(actor_id, actor_kind, action, area_id, subject_type, subject_id, details, reason, source)
        values (invite.invited_by, sender_kind, 'assignment.granted', area, 'person', person::text,
                jsonb_build_object('role', 'owner'), 'Invited', 'named');
    end if;
  end loop;
  return person;
end $$;

-- A member of a mapped group joins as a Member (p_admin false) or an Admin (true): makes the
-- person when the address is new. Returns the person; null for someone removed or erased, who
-- comes back only on an admin's invite. The Admin role is then kept in step by
-- auth.sync_group_admin.
create function auth.join_by_group(p_email text, p_name text) returns uuid
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  person uuid;
  active boolean;
  address text := lower(btrim(p_email));
begin
  perform pg_advisory_xact_lock(hashtextextended('heed.roles', 0));
  select id, deactivated_at is null and erased_at is null into person, active from people where email = address;
  if person is not null then
    if active then return person; end if;
    return null;
  end if;
  insert into people(email, display_name) values (address, coalesce(nullif(btrim(p_name), ''), address))
    returning id into person;
  insert into audit_log(actor_id, actor_kind, action, subject_type, subject_id, details, source)
    values (person, 'person', 'person.joined', 'person', person::text, jsonb_build_object('by', 'group'), 'named');
  return person;
end $$;

-- Keeps an active person's Admin role in step with the admin group at each sign-in: in the group,
-- they hold it; out of it, an Admin role the group gave ends, unless no other active admin is left.
-- An Admin role given any other way is never touched. Returns whether they are an admin now.
create function auth.sync_group_admin(p_person uuid, p_in_group boolean) returns boolean
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  held boolean;
  marked boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('heed.roles', 0));
  held := cl_is_admin(p_person, now());
  marked := exists (select 1 from auth.group_admins where person_id = p_person);
  if p_in_group then
    if not held then
      insert into global_role_grants(person_id, role) values (p_person, 'administrator');
      insert into auth.group_admins(person_id) values (p_person) on conflict do nothing;
      insert into audit_log(actor_kind, action, subject_type, subject_id, details, reason, source)
        values ('service', 'role.granted', 'person', p_person::text,
                jsonb_build_object('role', 'administrator'), 'In the admin group at sign-in', 'named');
    end if;
    return true;
  end if;
  if not marked then return held; end if;
  if held then
    if not exists (select 1 from global_role_grants g join people p on p.id = g.person_id
                    where g.role = 'administrator' and g.valid_at @> now() and g.person_id <> p_person
                      and p.deactivated_at is null and p.erased_at is null) then
      return true;
    end if;
    update global_role_grants set valid_at = tstzrange(lower(valid_at), now(), '[)')
     where person_id = p_person and role = 'administrator' and valid_at @> now();
    insert into audit_log(actor_kind, action, subject_type, subject_id, details, reason, source)
      values ('service', 'role.revoked', 'person', p_person::text,
              jsonb_build_object('role', 'administrator'), 'No longer in the admin group at sign-in', 'named');
  end if;
  delete from auth.group_admins where person_id = p_person;
  return false;
end $$;

-- What an invite link's sign-in screen names, by the SHA-256 of the link's token: the address, the
-- role and the domains still there, while the invite is open and in time. Nothing for any other
-- token, alike whatever the reason. Runs as the owner: nobody is signed in yet.
create function auth.invite_by_token(p_token_hash text)
    returns table(email text, role text, areas jsonb, expires_at timestamp with time zone)
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select i.email, i.role,
         coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name) order by a.name, a.id)
                     from areas a where a.id = any(i.area_ids) and a.archived_at is null), '[]'::jsonb),
         i.expires_at
    from invites i
   where i.token_hash = p_token_hash and i.accepted_at is null and i.revoked_at is null and i.expires_at > now() $$;

revoke all on function auth.invite_by_token(text) from public;
revoke all on function auth.join_by_group(text, text) from public;
revoke all on function auth.sync_group_admin(uuid, boolean) from public;
