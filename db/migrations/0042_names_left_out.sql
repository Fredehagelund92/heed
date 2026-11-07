-- 0042_names_left_out: the members of a definition source an owner left out of the names a read
-- makes (FR-141).
--
-- A read makes a name for each member no live term names, worked out from `definitions` and the
-- live vocabulary whenever it is read, so a name can never go stale. The one thing that is not
-- worked out is an owner's "leave this out": it is kept here by member, so the next read does not
-- offer it again, and goes when an owner accepts the name after all. Nothing reads this table but
-- the names service, so dropping it undoes this migration and only offers those names again.

create table public.names_left_out (
    definition_ref text primary key references public.definitions(ref),
    left_by uuid not null default public.cl_person() references public.people(id),
    left_at timestamp with time zone default now() not null
);

alter table public.names_left_out enable row level security;

-- Everyone who may see the names may see which were left out. An owner of the member's domain or
-- an administrator leaves one out, as they may accept it (CON-206).
create policy names_left_out_read on public.names_left_out for select using (true);
create policy names_left_out_insert on public.names_left_out for insert
  with check (left_by = public.cl_person()
              and (public.cl_is_admin_now()
                   or public.cl_is_owner_now((select d.area_hint from public.definitions d
                                               where d.ref = definition_ref))));
create policy names_left_out_delete on public.names_left_out for delete
  using (public.cl_is_admin_now()
         or public.cl_is_owner_now((select d.area_hint from public.definitions d
                                     where d.ref = definition_ref)));
