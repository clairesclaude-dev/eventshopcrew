-- ============================================================================
-- EventShop Crew Portal — SHIFTS UPGRADE migration
-- ============================================================================
-- Adds: subshifts (rotations), per-shift location, hide-able rate, admin-only
-- cancel, admin assignment, targeted shift trades (no self-cancel), clock in/out
-- totals, shift notes, and Google Calendar plumbing.
--
-- HOW TO RUN:  Supabase -> SQL Editor -> New query -> paste this whole file ->
-- Run.  It is ADDITIVE and IDEMPOTENT (safe to run more than once). It does not
-- drop or rename any existing column, so your live data is untouched.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Helpers (re-assert; harmless if they already exist)
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = uid and p.role = 'admin' and p.status = 'approved');
$$;

create or replace function public.is_approved(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = uid and p.status = 'approved');
$$;

-- ---------------------------------------------------------------------------
-- 1. profiles: track whether the person linked Google Calendar
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists google_calendar_connected boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. shifts: location, hide-able rate, notes split, admin-only cancel
-- ---------------------------------------------------------------------------
alter table public.shifts add column if not exists location     text;
alter table public.shifts add column if not exists rate_visible  boolean not null default true;
alter table public.shifts add column if not exists admin_notes   text;   -- internal, crew never sees
alter table public.shifts add column if not exists status        text not null default 'active';
alter table public.shifts add column if not exists cancelled_at  timestamptz;
alter table public.shifts add column if not exists cancelled_by  uuid references public.profiles(id);

-- constrain status (drop first so re-runs don't error)
do $$ begin
  alter table public.shifts drop constraint if exists shifts_status_check;
  alter table public.shifts add  constraint shifts_status_check
    check (status in ('active','cancelled'));
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. subshifts  (segments inside a shift: Front Gate 4-6pm -> Merch 6-10pm)
-- ---------------------------------------------------------------------------
create table if not exists public.subshifts (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  title       text not null,               -- role / expectation, e.g. "Merch"
  location    text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  notes       text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);
alter table public.subshifts enable row level security;

drop policy if exists "read subshifts w/ shift" on public.subshifts;
create policy "read subshifts w/ shift" on public.subshifts
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.shifts s join public.events e on e.id = s.event_id
      where s.id = subshifts.shift_id and e.status = 'published'
    )
  );

drop policy if exists "admin manage subshifts" on public.subshifts;
create policy "admin manage subshifts" on public.subshifts
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists idx_subshifts_shift on public.subshifts(shift_id);

-- ---------------------------------------------------------------------------
-- 4. claims: allow admin assignment + record who assigned; hours link subshift
-- ---------------------------------------------------------------------------
alter table public.claims add column if not exists assigned_by uuid references public.profiles(id);

-- widen status vocabulary to include 'transferred'
do $$ begin
  alter table public.claims drop constraint if exists claims_status_check;
  alter table public.claims add  constraint claims_status_check
    check (status in ('claimed','confirmed','waitlisted','dropped','no_show','completed','transferred'));
exception when others then null; end $$;

-- Admins can create a claim FOR someone else (assignment). Crew self-claim still
-- flows through claim_shift() below.
drop policy if exists "admin assign claims" on public.claims;
create policy "admin assign claims" on public.claims
  for insert with check (public.is_admin());

-- Remove crew's ability to freely UPDATE their own claim (that is what allowed
-- self-cancel/self-drop). All crew-side state changes now go through the
-- SECURITY DEFINER functions below, which enforce the rules. Admins keep full
-- control via the existing "admin manage" path; re-assert it here.
drop policy if exists "crew update own claim, admin all" on public.claims;
drop policy if exists "admin update claims" on public.claims;
create policy "admin update claims" on public.claims
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete claims" on public.claims;
create policy "admin delete claims" on public.claims
  for delete using (public.is_admin());

alter table public.hours_entries add column if not exists subshift_id uuid references public.subshifts(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 5. subshift_assignments  (who is on which segment — the rotation)
-- ---------------------------------------------------------------------------
create table if not exists public.subshift_assignments (
  id           uuid primary key default gen_random_uuid(),
  subshift_id  uuid not null references public.subshifts(id) on delete cascade,
  crew_id      uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  unique (subshift_id, crew_id)
);
alter table public.subshift_assignments enable row level security;

drop policy if exists "read own + published subshift assigns" on public.subshift_assignments;
create policy "read own + published subshift assigns" on public.subshift_assignments
  for select using (
    crew_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.subshifts ss
      join public.shifts s on s.id = ss.shift_id
      join public.events e on e.id = s.event_id
      where ss.id = subshift_assignments.subshift_id and e.status = 'published'
    )
  );

drop policy if exists "admin manage subshift assigns" on public.subshift_assignments;
create policy "admin manage subshift assigns" on public.subshift_assignments
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists idx_ssa_subshift on public.subshift_assignments(subshift_id);
create index if not exists idx_ssa_crew     on public.subshift_assignments(crew_id);

-- ---------------------------------------------------------------------------
-- 6. shift_trades  (targeted hand-off to ONE person; recipient must accept)
-- ---------------------------------------------------------------------------
create table if not exists public.shift_trades (
  id          uuid primary key default gen_random_uuid(),
  claim_id    uuid not null references public.claims(id) on delete cascade,
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  from_crew   uuid not null references public.profiles(id) on delete cascade,
  to_crew     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'offered'
                check (status in ('offered','accepted','declined','cancelled')),
  message     text,
  created_at  timestamptz not null default now(),
  decided_at  timestamptz
);
alter table public.shift_trades enable row level security;

drop policy if exists "trade parties + admin read" on public.shift_trades;
create policy "trade parties + admin read" on public.shift_trades
  for select using (
    from_crew = auth.uid() or to_crew = auth.uid() or public.is_admin()
  );
-- inserts/updates only via the SECURITY DEFINER functions below (and admins)
drop policy if exists "admin manage trades" on public.shift_trades;
create policy "admin manage trades" on public.shift_trades
  for all using (public.is_admin()) with check (public.is_admin());

create index if not exists idx_trades_to   on public.shift_trades(to_crew, status);
create index if not exists idx_trades_from on public.shift_trades(from_crew, status);

-- ---------------------------------------------------------------------------
-- 7. Google Calendar plumbing (tokens are SERVER-ONLY — no RLS policies, so
--    only the Worker's service_role key can touch them)
-- ---------------------------------------------------------------------------
create table if not exists public.google_calendar_tokens (
  user_id       uuid primary key references public.profiles(id) on delete cascade,
  refresh_token text,
  access_token  text,
  expiry        timestamptz,
  google_email  text,
  calendar_id   text not null default 'primary',
  connected_at  timestamptz not null default now()
);
alter table public.google_calendar_tokens enable row level security;  -- deny-all by default

-- maps a claim to the calendar event the Worker created (for update/delete)
create table if not exists public.google_calendar_events (
  claim_id        uuid primary key references public.claims(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  google_event_id text not null,
  updated_at      timestamptz not null default now()
);
alter table public.google_calendar_events enable row level security;  -- deny-all by default

-- ---------------------------------------------------------------------------
-- 8. notifications: let admins create them (RPCs below also create them)
-- ---------------------------------------------------------------------------
drop policy if exists "admin insert notifications" on public.notifications;
create policy "admin insert notifications" on public.notifications
  for insert with check (public.is_admin());

-- ============================================================================
-- 9. RPCs — the rules live here (SECURITY DEFINER = bypass RLS but enforce
--    the checks in code). Callable by authenticated users.
-- ============================================================================

-- 9a. claim a shift for yourself (respects slots + can't claim cancelled)
create or replace function public.claim_shift(p_shift_id uuid)
returns public.claims
language plpgsql security definer set search_path = public as $$
declare
  v_slots   int;
  v_status  text;
  v_taken   int;
  v_claim   public.claims;
  v_pubshow boolean;
begin
  if not public.is_approved(auth.uid()) then
    raise exception 'Not an approved crew member';
  end if;

  select s.slots, s.status,
         exists(select 1 from public.events e where e.id = s.event_id and e.status='published')
    into v_slots, v_status, v_pubshow
  from public.shifts s where s.id = p_shift_id;

  if v_status is distinct from 'active' then
    raise exception 'This shift is not open';
  end if;
  if not v_pubshow and not public.is_admin() then
    raise exception 'This shift is not available';
  end if;

  -- already have a live claim?
  if exists (select 1 from public.claims c
             where c.shift_id = p_shift_id and c.crew_id = auth.uid()
               and c.status in ('claimed','confirmed','waitlisted','completed')) then
    raise exception 'You already hold this shift';
  end if;

  select count(*) into v_taken from public.claims c
   where c.shift_id = p_shift_id
     and c.status in ('claimed','confirmed','completed');

  insert into public.claims (shift_id, crew_id, status)
  values (p_shift_id, auth.uid(),
          case when v_taken < coalesce(v_slots,1) then 'claimed' else 'waitlisted' end)
  on conflict (shift_id, crew_id)
    do update set status = case when v_taken < coalesce(v_slots,1) then 'claimed' else 'waitlisted' end
  returning * into v_claim;

  -- ping admins
  insert into public.notifications (user_id, type, title, body)
  select p.id, 'claim', 'Shift claimed',
         (select full_name from public.profiles where id = auth.uid()) || ' claimed a shift'
  from public.profiles p where p.role='admin' and p.status='approved';

  return v_claim;
end; $$;

-- 9b. offer YOUR claim to ONE specific person (no self-cancel path exists)
create or replace function public.offer_shift_trade(p_claim_id uuid, p_to_crew uuid, p_message text default null)
returns public.shift_trades
language plpgsql security definer set search_path = public as $$
declare v_claim public.claims; v_trade public.shift_trades;
begin
  select * into v_claim from public.claims where id = p_claim_id;
  if v_claim is null then raise exception 'Claim not found'; end if;
  if v_claim.crew_id <> auth.uid() then raise exception 'That is not your shift to trade'; end if;
  if v_claim.status not in ('claimed','confirmed') then raise exception 'This shift cannot be traded right now'; end if;
  if p_to_crew = auth.uid() then raise exception 'Pick someone other than yourself'; end if;
  if not public.is_approved(p_to_crew) then raise exception 'That person is not approved crew'; end if;

  -- cancel any prior outstanding offer on this claim
  update public.shift_trades set status='cancelled', decided_at=now()
    where claim_id = p_claim_id and status='offered';

  insert into public.shift_trades (claim_id, shift_id, from_crew, to_crew, message)
  values (p_claim_id, v_claim.shift_id, auth.uid(), p_to_crew, p_message)
  returning * into v_trade;

  insert into public.notifications (user_id, type, title, body, link)
  values (p_to_crew, 'trade_offer', 'Shift offered to you',
          (select full_name from public.profiles where id = auth.uid()) || ' wants to hand you a shift',
          'shifts');

  return v_trade;
end; $$;

-- 9c. accept an offer aimed at you -> the claim transfers to you
create or replace function public.accept_shift_trade(p_trade_id uuid)
returns public.claims
language plpgsql security definer set search_path = public as $$
declare v_trade public.shift_trades; v_claim public.claims; v_slots int; v_taken int;
begin
  select * into v_trade from public.shift_trades where id = p_trade_id;
  if v_trade is null then raise exception 'Offer not found'; end if;
  if v_trade.to_crew <> auth.uid() then raise exception 'This offer is not for you'; end if;
  if v_trade.status <> 'offered' then raise exception 'This offer is no longer open'; end if;
  if not public.is_approved(auth.uid()) then raise exception 'Not an approved crew member'; end if;

  select * into v_claim from public.claims where id = v_trade.claim_id;
  if v_claim is null or v_claim.status not in ('claimed','confirmed') then
    raise exception 'The shift is no longer available';
  end if;

  -- capacity guard (in case recipient already holds a spot etc.)
  select s.slots into v_slots from public.shifts s where s.id = v_claim.shift_id;
  if exists (select 1 from public.claims c where c.shift_id=v_claim.shift_id and c.crew_id=auth.uid()
             and c.status in ('claimed','confirmed','completed')) then
    raise exception 'You already hold this shift';
  end if;

  -- clear any stale (e.g. previously dropped) claim row this recipient had on
  -- the same shift, so the ownership transfer can't collide on unique(shift,crew)
  delete from public.claims
   where shift_id = v_claim.shift_id and crew_id = auth.uid() and id <> v_claim.id;

  -- transfer ownership of the claim
  update public.claims
     set crew_id = auth.uid(), status = 'claimed', assigned_by = null, claimed_at = now()
   where id = v_claim.id
  returning * into v_claim;

  -- move any subshift rotation rows to the new owner
  update public.subshift_assignments sa
     set crew_id = auth.uid()
   where sa.crew_id = v_trade.from_crew
     and sa.subshift_id in (select id from public.subshifts where shift_id = v_claim.shift_id);

  update public.shift_trades set status='accepted', decided_at=now() where id = p_trade_id;

  -- calendar cleanup: forget the giver's synced event so the Worker re-syncs
  delete from public.google_calendar_events where claim_id = v_claim.id;

  insert into public.notifications (user_id, type, title, body)
  values (v_trade.from_crew, 'trade_accepted', 'Shift handed off',
          (select full_name from public.profiles where id = auth.uid()) || ' took the shift you offered');
  insert into public.notifications (user_id, type, title, body)
  select p.id, 'trade_accepted', 'Shift traded',
         'A shift was handed off between crew'
  from public.profiles p where p.role='admin' and p.status='approved';

  return v_claim;
end; $$;

-- 9d. decline / cancel an offer (does NOT drop the shift — giver keeps it)
create or replace function public.respond_decline_trade(p_trade_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trade public.shift_trades;
begin
  select * into v_trade from public.shift_trades where id = p_trade_id;
  if v_trade is null then raise exception 'Offer not found'; end if;
  if auth.uid() not in (v_trade.to_crew, v_trade.from_crew) then
    raise exception 'Not your offer';
  end if;
  if v_trade.status <> 'offered' then return; end if;
  update public.shift_trades
     set status = case when auth.uid()=v_trade.to_crew then 'declined' else 'cancelled' end,
         decided_at = now()
   where id = p_trade_id;
  insert into public.notifications (user_id, type, title, body)
  values (case when auth.uid()=v_trade.to_crew then v_trade.from_crew else v_trade.to_crew end,
          'trade_update', 'Shift offer closed', 'A shift offer was closed');
end; $$;

-- 9e. clock in / clock out (crew, self only). Total hours auto-computed.
create or replace function public.clock_in(p_shift_id uuid, p_subshift_id uuid default null)
returns public.hours_entries
language plpgsql security definer set search_path = public as $$
declare v_event uuid; v_row public.hours_entries;
begin
  if not public.is_approved(auth.uid()) then raise exception 'Not approved'; end if;
  if not exists (select 1 from public.claims c where c.shift_id=p_shift_id and c.crew_id=auth.uid()
                 and c.status in ('claimed','confirmed','completed')) then
    raise exception 'You have not claimed this shift';
  end if;
  -- already clocked in and not out?
  if exists (select 1 from public.hours_entries h where h.shift_id=p_shift_id and h.crew_id=auth.uid()
             and h.check_in_at is not null and h.check_out_at is null) then
    raise exception 'You are already clocked in';
  end if;
  select event_id into v_event from public.shifts where id = p_shift_id;
  insert into public.hours_entries (event_id, shift_id, subshift_id, crew_id, check_in_at, source, status)
  values (v_event, p_shift_id, p_subshift_id, auth.uid(), now(), 'self', 'submitted')
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.clock_out(p_entry_id uuid)
returns public.hours_entries
language plpgsql security definer set search_path = public as $$
declare v_row public.hours_entries; v_hours numeric(6,2);
begin
  select * into v_row from public.hours_entries where id = p_entry_id;
  if v_row is null then raise exception 'No open clock-in'; end if;
  if v_row.crew_id <> auth.uid() then raise exception 'Not your entry'; end if;
  if v_row.check_out_at is not null then raise exception 'Already clocked out'; end if;
  v_hours := round(extract(epoch from (now() - v_row.check_in_at))/3600.0, 2);
  update public.hours_entries
     set check_out_at = now(), hours = v_hours
   where id = p_entry_id
  returning * into v_row;
  return v_row;
end; $$;

-- 9f. approved crew can see a minimal name list of OTHER approved crew, so they
--     can pick who to hand a shift to — without opening up the whole profiles table.
create or replace function public.list_crew_basic()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name,''), p.email) as full_name
  from public.profiles p
  where p.status = 'approved' and p.id <> auth.uid()
    and public.is_approved(auth.uid())
  order by 2;
$$;

-- 9g. incoming trade offers for the caller, with names/details resolved server-side
create or replace function public.incoming_trade_offers()
returns table (
  trade_id uuid, shift_id uuid, from_name text, message text,
  event_name text, role_title text, location text,
  starts_at timestamptz, ends_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select t.id, t.shift_id,
         coalesce(nullif(pf.full_name,''), pf.email),
         t.message, e.name, s.role_title, coalesce(s.location, e.venue),
         s.starts_at, s.ends_at
  from public.shift_trades t
  join public.shifts s   on s.id = t.shift_id
  join public.events e   on e.id = s.event_id
  join public.profiles pf on pf.id = t.from_crew
  where t.to_crew = auth.uid() and t.status = 'offered'
  order by t.created_at desc;
$$;

-- lock these down to signed-in users
revoke all on function public.claim_shift(uuid)                 from public, anon;
revoke all on function public.offer_shift_trade(uuid,uuid,text) from public, anon;
revoke all on function public.accept_shift_trade(uuid)          from public, anon;
revoke all on function public.respond_decline_trade(uuid)       from public, anon;
revoke all on function public.clock_in(uuid,uuid)               from public, anon;
revoke all on function public.clock_out(uuid)                   from public, anon;
grant execute on function public.claim_shift(uuid)                 to authenticated;
grant execute on function public.offer_shift_trade(uuid,uuid,text) to authenticated;
grant execute on function public.accept_shift_trade(uuid)          to authenticated;
grant execute on function public.respond_decline_trade(uuid)       to authenticated;
grant execute on function public.clock_in(uuid,uuid)               to authenticated;
grant execute on function public.clock_out(uuid)                   to authenticated;
revoke all  on function public.list_crew_basic()                   from public, anon;
revoke all  on function public.incoming_trade_offers()             from public, anon;
grant execute on function public.list_crew_basic()                 to authenticated;
grant execute on function public.incoming_trade_offers()           to authenticated;

commit;

-- ============================================================================
-- End of migration
-- ============================================================================
