-- ============================================================================
-- EventShop Crew Portal — Supabase schema, security, and storage
-- ============================================================================
-- Run this once in your Supabase project:  SQL Editor -> New query -> paste ->
-- Run.  It is safe to re-run (uses IF NOT EXISTS / CREATE OR REPLACE where
-- possible).  Read the top-to-bottom comments if you want to know what each
-- part does — you do not need to be a developer to follow along.
--
-- What this sets up:
--   * profiles ............ one row per person (crew or admin), with approval
--   * events / shifts ..... what work exists, with public + private pay rates
--   * claims .............. a crew member taking a shift (+ waitlist / drop)
--   * hours_entries ....... check-in/out + verified hours + pay math
--   * documents ........... pointers to encrypted files (ID, TABC, deposit…)
--   * reimbursements ...... receipts + approval, pings admin dashboard
--   * onboarding_requests . the QR "add me to the roster" queue
--   * broadcasts .......... blast a message to crew on an event
--   * notifications ....... the little alerts on your admin dashboard
-- Row-Level Security (RLS) is ON for every table: the database itself enforces
-- who can see and change what, so the rules can't be bypassed from the browser.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";        -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Helper: is the current user an approved admin?
--    SECURITY DEFINER so it can read profiles without tripping RLS recursion.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin' and p.status = 'approved'
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. profiles  (extends Supabase auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  full_name     text,
  email         text,
  phone         text,
  role          text not null default 'crew'
                  check (role in ('crew','admin')),
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected','suspended')),
  -- reliability signals (updated as shifts complete / no-show)
  completed_count int not null default 0,
  no_show_count   int not null default 0,
  late_count      int not null default 0,
  created_at    timestamptz not null default now(),
  approved_at   timestamptz,
  approved_by   uuid references public.profiles(id)
);

alter table public.profiles enable row level security;

-- New sign-ins get a profile row automatically (as pending crew).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles policies
drop policy if exists "read own or admin" on public.profiles;
create policy "read own or admin" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

drop policy if exists "update own basic" on public.profiles;
create policy "update own basic" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "admin manage profiles" on public.profiles;
create policy "admin manage profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. events
-- ---------------------------------------------------------------------------
create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  venue       text,
  address     text,
  starts_at   timestamptz,
  ends_at     timestamptz,
  attire      text,
  notes       text,
  is_public   boolean not null default false,   -- show shifts on the no-login board
  status      text not null default 'draft'
                check (status in ('draft','published','completed','cancelled')),
  created_by  uuid references public.profiles(id),
  created_at  timestamptz not null default now()
);
alter table public.events enable row level security;

drop policy if exists "read published or admin" on public.events;
create policy "read published or admin" on public.events
  for select using (status = 'published' or public.is_admin());

drop policy if exists "admin manage events" on public.events;
create policy "admin manage events" on public.events
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 4. shifts  (public + private pay rate per shift)
-- ---------------------------------------------------------------------------
create table if not exists public.shifts (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  role_title    text not null,                  -- e.g. Bartender, Parking
  starts_at     timestamptz,
  ends_at       timestamptz,
  slots         int not null default 1,         -- how many crew needed
  public_rate   numeric(10,2),                  -- rate shown on public board
  private_rate  numeric(10,2),                  -- internal / negotiated rate
  default_rate_kind text not null default 'public'
                  check (default_rate_kind in ('public','private')),
  notes         text,
  created_at    timestamptz not null default now()
);
alter table public.shifts enable row level security;

drop policy if exists "read shifts of published or admin" on public.shifts;
create policy "read shifts of published or admin" on public.shifts
  for select using (
    public.is_admin()
    or exists (select 1 from public.events e
               where e.id = shifts.event_id and e.status = 'published')
  );

drop policy if exists "admin manage shifts" on public.shifts;
create policy "admin manage shifts" on public.shifts
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. claims  (crew take a shift; supports waitlist + drop)
-- ---------------------------------------------------------------------------
create table if not exists public.claims (
  id          uuid primary key default gen_random_uuid(),
  shift_id    uuid not null references public.shifts(id) on delete cascade,
  crew_id     uuid not null references public.profiles(id) on delete cascade,
  status      text not null default 'claimed'
                check (status in ('claimed','confirmed','waitlisted','dropped','no_show','completed')),
  claimed_at  timestamptz not null default now(),
  unique (shift_id, crew_id)
);
alter table public.claims enable row level security;

drop policy if exists "crew see own, admin all" on public.claims;
create policy "crew see own, admin all" on public.claims
  for select using (crew_id = auth.uid() or public.is_admin());

drop policy if exists "crew claim for self" on public.claims;
create policy "crew claim for self" on public.claims
  for insert with check (
    crew_id = auth.uid()
    and public.is_approved(auth.uid())
  );

drop policy if exists "crew update own claim, admin all" on public.claims;
create policy "crew update own claim, admin all" on public.claims
  for update using (crew_id = auth.uid() or public.is_admin())
  with check (crew_id = auth.uid() or public.is_admin());

-- helper: approved (crew or admin)
create or replace function public.is_approved(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles p
                 where p.id = uid and p.status = 'approved');
$$;

-- ---------------------------------------------------------------------------
-- 6. hours_entries  (check-in/out, verified hours, pay math)
-- ---------------------------------------------------------------------------
create table if not exists public.hours_entries (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid references public.events(id) on delete cascade,
  shift_id      uuid references public.shifts(id) on delete set null,
  crew_id       uuid not null references public.profiles(id) on delete cascade,
  check_in_at   timestamptz,
  check_out_at  timestamptz,
  hours         numeric(6,2),
  source        text not null default 'self'
                  check (source in ('qr','self','admin')),
  status        text not null default 'submitted'
                  check (status in ('submitted','verified','disputed')),
  rate_applied  numeric(10,2),
  amount        numeric(12,2),                  -- hours * rate_applied
  verified_by   uuid references public.profiles(id),
  verified_at   timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.hours_entries enable row level security;

drop policy if exists "crew own hours, admin all" on public.hours_entries;
create policy "crew own hours, admin all" on public.hours_entries
  for select using (crew_id = auth.uid() or public.is_admin());

drop policy if exists "crew submit own hours" on public.hours_entries;
create policy "crew submit own hours" on public.hours_entries
  for insert with check (crew_id = auth.uid() and public.is_approved(auth.uid()));

drop policy if exists "crew edit unverified, admin all" on public.hours_entries;
create policy "crew edit unverified, admin all" on public.hours_entries
  for update using (
    public.is_admin() or (crew_id = auth.uid() and status = 'submitted')
  ) with check (
    public.is_admin() or (crew_id = auth.uid() and status = 'submitted')
  );

-- ---------------------------------------------------------------------------
-- 7. documents  (pointer to encrypted file in private bucket; purge on download)
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  crew_id       uuid not null references public.profiles(id) on delete cascade,
  doc_type      text not null
                  check (doc_type in ('photo_id','tabc','direct_deposit','w9','other')),
  storage_path  text,                           -- path inside the private bucket
  file_name     text,
  expires_at    date,                           -- e.g. TABC card expiry
  status        text not null default 'uploaded'
                  check (status in ('uploaded','downloaded_purged')),
  downloaded_at timestamptz,
  downloaded_by uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);
alter table public.documents enable row level security;

drop policy if exists "crew own docs meta, admin all" on public.documents;
create policy "crew own docs meta, admin all" on public.documents
  for select using (crew_id = auth.uid() or public.is_admin());

drop policy if exists "crew add own docs" on public.documents;
create policy "crew add own docs" on public.documents
  for insert with check (crew_id = auth.uid() and public.is_approved(auth.uid()));

drop policy if exists "admin update/purge docs" on public.documents;
create policy "admin update/purge docs" on public.documents
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete docs, crew own" on public.documents;
create policy "admin delete docs, crew own" on public.documents
  for delete using (public.is_admin() or crew_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 8. reimbursements  (receipts + approval; pings admin dashboard)
-- ---------------------------------------------------------------------------
create table if not exists public.reimbursements (
  id            uuid primary key default gen_random_uuid(),
  submitted_by  uuid not null references public.profiles(id) on delete cascade,
  event_id      uuid references public.events(id) on delete set null,
  amount        numeric(12,2) not null,
  description   text,
  receipt_path  text,                           -- file in private "receipts" bucket
  status        text not null default 'submitted'
                  check (status in ('submitted','approved','paid','rejected')),
  created_at    timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references public.profiles(id)
);
alter table public.reimbursements enable row level security;

drop policy if exists "submitter own reimb, admin all" on public.reimbursements;
create policy "submitter own reimb, admin all" on public.reimbursements
  for select using (submitted_by = auth.uid() or public.is_admin());

drop policy if exists "approved users submit reimb" on public.reimbursements;
create policy "approved users submit reimb" on public.reimbursements
  for insert with check (submitted_by = auth.uid() and public.is_approved(auth.uid()));

drop policy if exists "admin decide reimb" on public.reimbursements;
create policy "admin decide reimb" on public.reimbursements
  for update using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 9. onboarding_requests  (the public QR "add me to the roster" form)
--    Anyone (no login) can submit; only admins can read / act.
-- ---------------------------------------------------------------------------
create table if not exists public.onboarding_requests (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null,
  email       text not null,
  phone       text,
  message     text,
  status      text not null default 'new'
                check (status in ('new','invited','approved','declined')),
  created_at  timestamptz not null default now()
);
alter table public.onboarding_requests enable row level security;

drop policy if exists "anyone can request roster" on public.onboarding_requests;
create policy "anyone can request roster" on public.onboarding_requests
  for insert to anon, authenticated with check (true);

drop policy if exists "admin read/act onboarding" on public.onboarding_requests;
create policy "admin read/act onboarding" on public.onboarding_requests
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 10. broadcasts  (blast a message to crew on an event)
-- ---------------------------------------------------------------------------
create table if not exists public.broadcasts (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references public.events(id) on delete cascade,
  sender_id   uuid references public.profiles(id),
  body        text not null,
  created_at  timestamptz not null default now()
);
alter table public.broadcasts enable row level security;

drop policy if exists "crew on event read, admin all" on public.broadcasts;
create policy "crew on event read, admin all" on public.broadcasts
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.claims c
      join public.shifts s on s.id = c.shift_id
      where s.event_id = broadcasts.event_id and c.crew_id = auth.uid()
    )
  );

drop policy if exists "admin send broadcasts" on public.broadcasts;
create policy "admin send broadcasts" on public.broadcasts
  for insert with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- 11. notifications  (dashboard alerts: new access request, reimbursement, drop)
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  type        text not null,                    -- 'reimbursement','onboarding','drop',...
  title       text,
  body        text,
  link        text,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);
alter table public.notifications enable row level security;

drop policy if exists "own notifications" on public.notifications;
create policy "own notifications" on public.notifications
  for select using (user_id = auth.uid());

drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 12. Helpful indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_shifts_event   on public.shifts(event_id);
create index if not exists idx_claims_shift    on public.claims(shift_id);
create index if not exists idx_claims_crew     on public.claims(crew_id);
create index if not exists idx_hours_crew      on public.hours_entries(crew_id);
create index if not exists idx_hours_event     on public.hours_entries(event_id);
create index if not exists idx_docs_crew       on public.documents(crew_id);
create index if not exists idx_reimb_status    on public.reimbursements(status);
create index if not exists idx_notif_user      on public.notifications(user_id, read);

-- ============================================================================
-- 13. STORAGE  (private, encrypted-at-rest buckets — run after tables above)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('documents','documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('receipts','receipts', false)
on conflict (id) do nothing;

-- Crew upload their own docs into a folder named after their user id
-- (path convention: documents/<auth.uid()>/<filename>). Admins can read/delete all.
drop policy if exists "crew upload own documents" on storage.objects;
create policy "crew upload own documents" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "crew read own, admin read all documents" on storage.objects;
create policy "crew read own, admin read all documents" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "admin or owner delete documents" on storage.objects;
create policy "admin or owner delete documents" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- Receipts: submitter uploads to receipts/<auth.uid()>/...; admins read/delete all.
drop policy if exists "user upload own receipts" on storage.objects;
create policy "user upload own receipts" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "user read own, admin all receipts" on storage.objects;
create policy "user read own, admin all receipts" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'receipts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

drop policy if exists "admin or owner delete receipts" on storage.objects;
create policy "admin or owner delete receipts" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'receipts'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
  );

-- ============================================================================
-- 14. Make yourself the first admin
-- ============================================================================
-- After you sign in to the portal once with your email, run this (replace the
-- address) to promote your account to admin:
--
--   update public.profiles
--   set role = 'admin', status = 'approved', approved_at = now()
--   where email = 'you@youremail.com';
--
-- ============================================================================
-- End of schema
-- ============================================================================
