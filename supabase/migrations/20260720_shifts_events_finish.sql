-- ============================================================================
-- EventShop Crew Portal — FINISH SHIFTS + EVENTS migration (2026-07-20)
-- ============================================================================
-- Adds the last pieces for the shift build-out:
--   * shifts.shift_type  (free-text "Type" label)
--   * shifts.attire      (attire moves from event -> per shift)
--   * shifts.sort_order  (manual up/down ordering; falls back to start time)
--   * duplicate_shift()  (copy a shift + its subshifts, NOT its assignments)
--   * admin_delete_crew()(full backend delete of a person + all their data)
--   * reorder_shift()    (move a shift up/down safely, admin only)
--
-- ADDITIVE + IDEMPOTENT. Safe to run more than once. No existing column is
-- dropped or renamed, so live data is untouched.
-- ============================================================================

begin;

-- Re-assert helpers (harmless if they already exist) --------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = uid and p.role = 'admin' and p.status = 'approved');
$$;

-- 1. New shift columns --------------------------------------------------------
alter table public.shifts add column if not exists shift_type  text;
alter table public.shifts add column if not exists attire      text;
alter table public.shifts add column if not exists sort_order  int not null default 0;

create index if not exists idx_shifts_sort on public.shifts(event_id, sort_order, starts_at);

-- Seed sort_order for existing shifts so current events open in time order.
-- (Only touches rows still at the default 0; leaves any manual ordering alone.)
with ordered as (
  select id, row_number() over (
           partition by event_id
           order by starts_at nulls last, created_at
         ) * 10 as rn
  from public.shifts
)
update public.shifts s
   set sort_order = o.rn
  from ordered o
 where s.id = o.id
   and s.sort_order = 0;

-- 2. duplicate_shift() — copy a shift and its subshifts (no claims / no assigns)
create or replace function public.duplicate_shift(p_shift_id uuid)
returns public.shifts
language plpgsql security definer set search_path = public as $$
declare v_src public.shifts; v_new public.shifts; v_max int;
begin
  if not public.is_admin() then raise exception 'Only managers can duplicate shifts'; end if;

  select * into v_src from public.shifts where id = p_shift_id;
  if v_src is null then raise exception 'Shift not found'; end if;

  select coalesce(max(sort_order), 0) into v_max
    from public.shifts where event_id = v_src.event_id;

  insert into public.shifts (
    event_id, role_title, shift_type, attire, location,
    starts_at, ends_at, slots, public_rate, private_rate,
    default_rate_kind, rate_visible, notes, admin_notes, status, sort_order
  )
  values (
    v_src.event_id,
    coalesce(v_src.role_title,'Shift') || ' (copy)',
    v_src.shift_type, v_src.attire, v_src.location,
    v_src.starts_at, v_src.ends_at, v_src.slots, v_src.public_rate, v_src.private_rate,
    v_src.default_rate_kind, coalesce(v_src.rate_visible, true),
    v_src.notes, v_src.admin_notes, 'active', v_max + 10
  )
  returning * into v_new;

  -- copy the subshifts (segments), but never the people assigned to them
  insert into public.subshifts (shift_id, title, location, starts_at, ends_at, notes, sort_order)
  select v_new.id, title, location, starts_at, ends_at, notes, sort_order
    from public.subshifts where shift_id = p_shift_id;

  return v_new;
end; $$;

-- 3. reorder_shift() — nudge a shift up (-1) or down (+1) within its event -----
create or replace function public.reorder_shift(p_shift_id uuid, p_direction int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_event uuid; v_order int; v_swap_id uuid; v_swap_order int;
begin
  if not public.is_admin() then raise exception 'Only managers can reorder shifts'; end if;

  select event_id, sort_order into v_event, v_order
    from public.shifts where id = p_shift_id;
  if v_event is null then raise exception 'Shift not found'; end if;

  if p_direction < 0 then
    select id, sort_order into v_swap_id, v_swap_order
      from public.shifts
     where event_id = v_event and sort_order < v_order
     order by sort_order desc limit 1;
  else
    select id, sort_order into v_swap_id, v_swap_order
      from public.shifts
     where event_id = v_event and sort_order > v_order
     order by sort_order asc limit 1;
  end if;

  if v_swap_id is null then return; end if;  -- already at the top/bottom

  update public.shifts set sort_order = v_swap_order where id = p_shift_id;
  update public.shifts set sort_order = v_order      where id = v_swap_id;
end; $$;

-- 4. resort_event_shifts() — renumber a whole event chronologically ------------
create or replace function public.resort_event_shifts(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only managers can sort shifts'; end if;
  with ordered as (
    select id, row_number() over (order by starts_at nulls last, created_at) * 10 as rn
    from public.shifts where event_id = p_event_id
  )
  update public.shifts s set sort_order = o.rn
    from ordered o where s.id = o.id;
end; $$;

-- 5. admin_delete_crew() — full backend delete of a person + everything of theirs
--    Deleting the auth user cascades to profiles -> claims, hours, docs, etc.
create or replace function public.admin_delete_crew(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only managers can remove people'; end if;
  if p_id = auth.uid() then raise exception 'You can''t delete your own account here'; end if;

  -- clean up rows that reference the profile without ON DELETE CASCADE
  delete from public.notifications        where user_id = p_id;
  delete from public.subshift_assignments where crew_id = p_id;

  -- remove the auth user; FK cascade removes the profile and all owned rows
  delete from auth.users where id = p_id;

  -- belt-and-suspenders in case the auth row was already gone
  delete from public.profiles where id = p_id;
end; $$;

-- 6. Locks: these run as signed-in users; the functions themselves enforce admin
revoke all on function public.duplicate_shift(uuid)          from public, anon;
revoke all on function public.reorder_shift(uuid,int)        from public, anon;
revoke all on function public.resort_event_shifts(uuid)      from public, anon;
revoke all on function public.admin_delete_crew(uuid)        from public, anon;
grant execute on function public.duplicate_shift(uuid)       to authenticated;
grant execute on function public.reorder_shift(uuid,int)     to authenticated;
grant execute on function public.resort_event_shifts(uuid)   to authenticated;
grant execute on function public.admin_delete_crew(uuid)     to authenticated;

commit;

-- ============================================================================
-- End of migration
-- ============================================================================
