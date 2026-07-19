-- ============================================================================
-- EventShop Crew Portal — editable email templates + send log (2026-07-20)
-- ============================================================================
-- Lets admins view / edit the transactional emails from the portal and monitor
-- what has been sent. Additive + idempotent.
-- ============================================================================
begin;

create table if not exists public.email_templates (
  kind        text primary key,
  label       text not null,
  subject     text not null,
  body        text not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now()
);
alter table public.email_templates enable row level security;

drop policy if exists "read templates (any signed-in)" on public.email_templates;
create policy "read templates (any signed-in)" on public.email_templates
  for select to authenticated using (true);
drop policy if exists "admin manage templates" on public.email_templates;
create policy "admin manage templates" on public.email_templates
  for all using (public.is_admin()) with check (public.is_admin());

create table if not exists public.email_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text,
  to_email    text,
  subject     text,
  status      text not null default 'sent',   -- sent | skipped | error
  detail      text,
  created_at  timestamptz not null default now()
);
alter table public.email_log enable row level security;

drop policy if exists "any signed-in can log" on public.email_log;
create policy "any signed-in can log" on public.email_log
  for insert to authenticated with check (true);
drop policy if exists "admin read log" on public.email_log;
create policy "admin read log" on public.email_log
  for select using (public.is_admin());

create index if not exists idx_email_log_created on public.email_log(created_at desc);

-- Seed the four default emails (leave existing rows untouched on re-run).
insert into public.email_templates (kind, label, subject, body) values
('welcome', 'Welcome to the portal', '🎉 You’re in! Welcome to the EventShop Crew',
$b$Heyyy {name}! You made it 🎉

You’re officially in. This portal is your home base for working events with us — kind of like your backstage pass. Here’s the whole thing, quick and painless:

📅 Shifts — See what’s open, tap Claim, and it’s yours.
⏱️ Clock in / out — Green button when you start, red button when you’re done. Easy.
💵 My Hours — Your time shows up here. We double-check it, you get paid.
📄 Documents — Upload your ID and tax stuff once, safely. Done forever.

Stuck on anything? Every event has an Ask button — use it! Or just reply here.

Can’t wait to work with you. Let’s go make some events awesome. 🙌$b$),
('claimed', 'Shift claimed', '✅ Shift claimed: {role}',
$b$Nice grab, {name}! ✅

You’re locked in. Here are the details:

Role: {role}
Event: {event}
When: {when}
Where: {where}

Show up a few minutes early, clock in when you get there, and you’re golden. Need to hand it off? Open the portal and tap “Offer to…”.$b$),
('transferred', 'Shift transferred to them', '🤝 A shift is now yours: {role}',
$b$It’s yours now, {name}! 🤝

{from} handed you a shift and you took it — love the teamwork. Here’s what you’ve got:

Role: {role}
Event: {event}
When: {when}
Where: {where}

All set — clock in when you arrive. See you there!$b$),
('cancelled', 'Shift cancelled', '❌ Heads up: a shift was cancelled',
$b$Quick heads up, {name} 💛

One of your shifts got cancelled — and it’s nothing you did. Plans just changed on our end:

Role: {role}
Event: {event}
When: {when}
Where: {where}

Hop back into the portal whenever you’re ready and grab another open shift. Questions? Just reply. 💛$b$)
on conflict (kind) do nothing;

commit;
