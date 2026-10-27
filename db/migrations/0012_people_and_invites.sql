-- 0012_people_and_invites: invites, owners who add owners, and removing a person (FR-417, FR-804;
-- docs/product.md, section 11; golden plan P8, part 1).
--
-- - An invite asks one email address to join, as an Admin or a Member, owning some domains from
--   the start. Its link carries a random token; only the token's SHA-256 is kept, so the database
--   never holds a working link. An invite is open until it is accepted, revoked or expires; an
--   address has at most one open invite. Sending it again gives it a new token (the old link stops
--   working) and a new expiry.
-- - An invite is accepted once, at the person's first sign-in, by the address the sign-in proves
--   (auth.accept_invite). It makes the person (or, on an admin's invite, brings back one who was
--   removed), gives the role and the ownership of every domain it names that still exists, and
--   closes the invite.
-- - Anyone signed in reads the open invites, as the People page lists them. An admin invites
--   anyone as anything; an owner who is not an admin invites a Member who owns domains the owner
--   owns. An admin, or whoever sent it, sends it again or revokes it.
-- - Owners add and remove the owners of their own domains (they could not before: only an admin
--   wrote area_assignments). Every other role change stays an admin's.
-- - Admin and Member are the roles of v1: the administrator grant is Admin, anyone else is a
--   Member. The auditor and approver values stay in the data for history.

create table public.invites (
    id uuid default uuidv7() not null primary key,
    email text not null,
    role text not null,
    area_ids text[] default '{}'::text[] not null,
    invited_by uuid not null references public.people(id),
    token_hash text not null unique,
    created_at timestamp with time zone default now() not null,
    sent_at timestamp with time zone default now() not null,
    expires_at timestamp with time zone not null,
    accepted_at timestamp with time zone,
    accepted_by uuid references public.people(id),
    revoked_at timestamp with time zone,
    revoked_by uuid references public.people(id),
    constraint invites_email_check check (email = lower(btrim(email)) and char_length(email) between 3 and 320
                                          and email ~ '^[^@\s]+@[^@\s]+$'),
    constraint invites_role_check check (role in ('admin', 'member')),
    constraint invites_areas_check check (cardinality(area_ids) <= 50 and array_position(area_ids, null) is null),
    constraint invites_token_hash_check check (token_hash ~ '^[a-f0-9]{64}$'),
    constraint invites_expiry_check check (expires_at > sent_at),
    constraint invites_accepted_check check ((accepted_at is null) = (accepted_by is null)),
    constraint invites_revoked_check check ((revoked_at is null) = (revoked_by is null)),
    constraint invites_closed_once_check check (accepted_at is null or revoked_at is null)
);

-- One open invite per address; an accepted or revoked one is history.
create unique index invites_open_email on public.invites using btree (email)
    where accepted_at is null and revoked_at is null;
create index invites_invited_by on public.invites using btree (invited_by);

-- What an invite is never changes: its address, role, domains, sender and start. Sending it again
-- changes the token, when it was sent and when it ends; revoking and accepting close it once.
create function public.invites_guard() returns trigger
    language plpgsql
    set search_path to 'public', 'pg_temp'
    as $$
begin
  if old.accepted_at is not null or old.revoked_at is not null then
    raise exception 'invite % is closed', old.id using errcode = 'check_violation';
  end if;
  if (new.email, new.role, new.area_ids, new.invited_by, new.created_at)
     is distinct from (old.email, old.role, old.area_ids, old.invited_by, old.created_at) then
    raise exception 'invite % may only be sent again, revoked or accepted', old.id
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

create trigger invites_guard before update on public.invites
    for each row execute function public.invites_guard();

-- Whether the person in this transaction owns every one of these domains.
create function public.cl_owns_all(p_areas text[]) returns boolean
    language sql stable security definer
    set search_path to 'public', 'pg_temp'
    as $$
  select cl_person() is not null
     and not exists (select 1 from unnest(p_areas) a where not cl_has_area_role(cl_person(), a, 'owner', now())) $$;

alter table public.invites enable row level security;

create policy invites_read on public.invites for select using (public.cl_person() is not null);
create policy invites_insert on public.invites for insert
    with check (invited_by = public.cl_person() and accepted_at is null and revoked_at is null
                and (public.cl_is_admin_now()
                     or (role = 'member' and cardinality(area_ids) > 0 and public.cl_owns_all(area_ids))));
create policy invites_update on public.invites for update
    using (public.cl_is_admin_now() or invited_by = public.cl_person())
    with check (accepted_at is null and (revoked_at is null or revoked_by = public.cl_person()));

-- Owners give and end the ownership of their own domains; every other role stays an admin's.
drop policy assignments_insert on public.area_assignments;
create policy assignments_insert on public.area_assignments for insert
    with check (public.cl_is_admin_now() or (role = 'owner' and public.cl_is_owner_now(area_id)));
drop policy assignments_update on public.area_assignments;
create policy assignments_update on public.area_assignments for update
    using (public.cl_is_admin_now() or (role = 'owner' and public.cl_is_owner_now(area_id)))
    with check (public.cl_is_admin_now() or (role = 'owner' and public.cl_is_owner_now(area_id)));

-- Accepts the open invite of an address that a sign-in has just proven, once: makes the person, or
-- on an admin's invite brings back one who was removed, gives the invite's role and the ownership
-- of each of its domains that still exists, and closes it. Returns the person, or null when the
-- address has no open invite that is still in time (or one that may not bring them back). Runs as
-- the owner: nobody is signed in yet. Takes the role lock first, as every role change does
-- (src/server/modules/auth/roles.ts).
create function auth.accept_invite(p_email text, p_name text) returns uuid
    language plpgsql security definer
    set search_path to 'public', 'pg_temp'
    as $$
declare
  invite invites;
  person uuid;
  erased boolean;
  removed boolean;
  area text;
  name text := nullif(btrim(p_name), '');
begin
  perform pg_advisory_xact_lock(hashtextextended('heed.roles', 0));
  select * into invite from invites
   where email = lower(btrim(p_email)) and accepted_at is null and revoked_at is null and expires_at > now()
   for update;
  if invite.id is null then return null; end if;
  select id, erased_at is not null, deactivated_at is not null into person, erased, removed
    from people where email = invite.email;
  -- An erased person never comes back; one an admin removed comes back only on an admin's invite.
  if erased or (removed and not cl_is_admin(invite.invited_by, now())) then return null; end if;
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
      values (invite.invited_by, 'person', 'role.granted', 'person', person::text,
              jsonb_build_object('role', 'administrator'), 'Invited', 'named');
  end if;
  for area in select a.id from areas a where a.id = any(invite.area_ids) and a.archived_at is null order by a.id loop
    if not cl_has_area_role(person, area, 'owner', now()) then
      insert into area_assignments(area_id, person_id, role, granted_by) values (area, person, 'owner', invite.invited_by);
      insert into audit_log(actor_id, actor_kind, action, area_id, subject_type, subject_id, details, reason, source)
        values (invite.invited_by, 'person', 'assignment.granted', area, 'person', person::text,
                jsonb_build_object('role', 'owner'), 'Invited', 'named');
    end if;
  end loop;
  return person;
end $$;

revoke all on function auth.accept_invite(text, text) from public;
