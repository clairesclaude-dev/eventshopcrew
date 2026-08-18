-- ============================================================================
-- EventShop Crew Portal — invited crew can be assigned to shifts
--
-- Adding someone by email now creates a real (placeholder) crew record right
-- away, so you can assign them to shifts, subtasks and private events before
-- they've accepted. When they sign up with that email the placeholder is
-- adopted by their new account and every assignment carries over.
--
-- Additive and safe to re-run. No existing rows are deleted or renamed.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Placeholder crew rows have no auth.users row yet, so profiles.id can no
--    longer be a hard FK to auth.users. Lifecycle is handled by
--    handle_new_user() (adopt on signup) and admin_delete_crew() (removal).
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles alter column id set default gen_random_uuid();

alter table public.profiles
  add column if not exists pending_invite boolean not null default false,
  add column if not exists invited_at     timestamptz,
  add column if not exists invited_by     uuid;

-- Only ever one open placeholder per email address.
create unique index if not exists profiles_pending_invite_email_idx
  on public.profiles (lower(email)) where pending_invite;

-- ---------------------------------------------------------------------------
-- 2. When a placeholder is adopted, its id changes to the new auth user's id.
--    Every FK pointing at profiles(id) needs ON UPDATE CASCADE so assignments,
--    hours, notifications etc. follow the person instead of breaking.
--    Delete behaviour is preserved exactly as-is.
-- ---------------------------------------------------------------------------
do $$
declare r record; v_del text;
begin
  for r in
    select con.conname,
           rel.relname as tbl,
           con.confdeltype,
           (select a.attname from pg_attribute a
             where a.attrelid = con.conrelid and a.attnum = con.conkey[1]) as col
      from pg_constraint con
      join pg_class rel  on rel.oid  = con.conrelid
      join pg_class frel on frel.oid = con.confrelid
      join pg_namespace n on n.oid   = rel.relnamespace
     where con.contype = 'f'
       and frel.relname = 'profiles'
       and n.nspname = 'public'
       and con.confupdtype <> 'c'          -- skip ones already cascading
  loop
    v_del := case r.confdeltype
               when 'c' then ' on delete cascade'
               when 'n' then ' on delete set null'
               when 'd' then ' on delete set default'
               when 'r' then ' on delete restrict'
               else '' end;
    execute format('alter table public.%I drop constraint %I', r.tbl, r.conname);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references public.profiles(id) on update cascade%s',
      r.tbl, r.conname, r.col, v_del);
  end loop;
end $$;

-- invited_by points at profiles too (added above without a constraint so the
-- cascade loop doesn't have to run twice).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_invited_by_fkey') then
    alter table public.profiles
      add constraint profiles_invited_by_fkey
      foreign key (invited_by) references public.profiles(id) on update cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Signup adopts a matching placeholder instead of creating a second record.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_placeholder uuid;
begin
  select p.id into v_placeholder
    from public.profiles p
   where p.pending_invite
     and lower(p.email) = lower(new.email)
   limit 1;

  if v_placeholder is not null and not exists (select 1 from public.profiles where id = new.id) then
    -- Re-key the placeholder onto the real account. FKs cascade, so shifts,
    -- subtasks, event assignments and hours all follow.
    update public.profiles
       set id             = new.id,
           pending_invite = false,
           invited_at     = null,
           email          = new.email,
           full_name      = coalesce(nullif(full_name, ''),
                                     new.raw_user_meta_data->>'full_name', '')
     where id = v_placeholder;
    return new;
  end if;

  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. Add / cancel an invite, atomically, admin-only.
-- ---------------------------------------------------------------------------
create or replace function public.admin_invite_crew(p_email text, p_name text default null)
returns public.profiles
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_email text; v_row public.profiles;
begin
  if not public.is_admin() then raise exception 'Only managers can add crew'; end if;

  v_email := lower(trim(p_email));
  if v_email is null or v_email = '' or v_email not like '%_@_%.__%' then
    raise exception 'That doesn''t look like an email address';
  end if;

  if exists (select 1 from public.profiles p
              where lower(p.email) = v_email and not p.pending_invite) then
    raise exception 'Someone with that email is already on the crew';
  end if;

  -- keeps the existing pre-approval path working for anyone who signs up
  -- through the front door instead of the invite
  insert into public.invited_emails (email, added_by)
  values (v_email, auth.uid())
  on conflict (email) do nothing;

  insert into public.profiles (email, full_name, role, status,
                               pending_invite, invited_at, invited_by, approved_at)
  values (v_email, coalesce(nullif(trim(p_name), ''), ''), 'crew', 'approved',
          true, now(), auth.uid(), now())
  on conflict (lower(email)) where pending_invite
    do update set full_name = coalesce(nullif(trim(p_name), ''), profiles.full_name)
  returning * into v_row;

  return v_row;
end;
$function$;

create or replace function public.admin_cancel_invite(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_email text;
begin
  if not public.is_admin() then raise exception 'Only managers can remove crew'; end if;

  select email into v_email from public.profiles
   where id = p_id and pending_invite;
  if v_email is null then
    raise exception 'That person has already accepted — remove them from Active crew instead';
  end if;

  delete from public.invited_emails where lower(email) = lower(v_email);
  delete from public.notifications        where user_id = p_id;
  delete from public.subshift_assignments where crew_id = p_id;
  delete from public.profiles             where id = p_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Crew-to-crew shift trades can only target people who can actually accept.
-- ---------------------------------------------------------------------------
create or replace function public.list_crew_basic()
returns table(id uuid, full_name text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select p.id, coalesce(nullif(p.full_name, ''), 'Crew member') as full_name
  from public.profiles p
  where p.status = 'approved'
    and not p.pending_invite
    and p.id <> auth.uid()
    and public.is_approved(auth.uid())
  order by 2;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Deleting a placeholder shouldn't try to touch auth.users.
-- ---------------------------------------------------------------------------
create or replace function public.admin_delete_crew(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not public.is_admin() then raise exception 'Only managers can remove people'; end if;
  if p_id = auth.uid() then raise exception 'You can''t delete your own account here'; end if;

  delete from public.invited_emails
   where lower(email) = (select lower(email) from public.profiles where id = p_id);
  delete from public.notifications        where user_id = p_id;
  delete from public.subshift_assignments where crew_id = p_id;
  delete from auth.users                  where id = p_id;
  delete from public.profiles             where id = p_id;
end;
$function$;

grant execute on function public.admin_invite_crew(text, text) to authenticated;
grant execute on function public.admin_cancel_invite(uuid)     to authenticated;
