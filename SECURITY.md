# EventShop Crew Portal — Security Hardening

The honest headline: **for a site like this, "no hacking" is decided almost
entirely by Supabase (your database rules + auth) — not by the web host.** The
website code is public by design; the anon key in it can only do what your
Row-Level Security (RLS) rules allow. So the checklist below is ordered by
what actually reduces risk.

## 1. Database (Supabase) — highest impact

- **RLS is ON for every table.** The migration keeps it on and adds policies for
  the new tables (subshifts, trades, assignments). Google tokens tables have RLS
  on with **no policies**, so only the Worker's service key can read them.
- **No self-cancel.** Crew can no longer freely update/drop their own claims —
  every crew action (claim, trade, clock) goes through a `SECURITY DEFINER`
  function that enforces the rules. Only admins can cancel/delete a shift.
- **Service role key stays server-side.** It lives only in the Worker's secrets
  (`wrangler secret put`). Never put it in `config.js` or any front-end file.
  The only key in the website is the **anon/publishable** key, which is safe.
- **Turn on these Supabase Auth protections** (Dashboard → Authentication →
  Policies/Settings):
  - **Leaked password protection** (rejects passwords found in breaches).
  - **Minimum password length** ≥ 8.
  - **OTP / magic-link expiry** ≤ 1 hour.
  - Consider **MFA** for the admin account(s).
- **Storage buckets** (`documents`, `receipts`) are already **private**; files are
  reached only via short-lived signed URLs. Keep them private.
- Periodically run Supabase's **Security Advisor** (Dashboard → Advisors) and
  clear any warnings.

## 2. The website (Cloudflare Pages)

- **Security headers** ship in `public/_headers`: HSTS, `X-Frame-Options: DENY`
  (clickjacking), `X-Content-Type-Options`, a Content-Security-Policy, and a tight
  Referrer/Permissions policy. Cloudflare applies them on every response.
- **Auto-HTTPS** is on by default; make sure "Always Use HTTPS" is enabled in
  Cloudflare → SSL/TLS, and set SSL mode to **Full (strict)**.

## 3. Cloudflare edge protections (quick wins in the dashboard)

- **WAF → Managed Rules:** enable the Cloudflare Managed Ruleset.
- **Bot Fight Mode:** on (Security → Bots).
- **Rate limiting:** add a rule limiting requests to the sign-in / auth paths and
  to the Worker (`/sync`, `/connect`) to a sane number per minute per IP. This
  blunts brute-force and abuse.
- Leave **DDoS protection** on (it's automatic and free).

## 4. The Google Calendar Worker

- Secrets (`GOOGLE_CLIENT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `STATE_SECRET`)
  are set via `wrangler secret put` — never committed.
- OAuth `state` is HMAC-signed with a 10-minute expiry to prevent CSRF/replay on
  the connect flow.
- CORS on the Worker is locked to your app origin (`APP_ORIGIN`).
- Every `/sync` verifies the caller's Supabase session and that the shift being
  synced actually belongs to that user.
- Keep the OAuth consent screen in **Testing** with your crew as test users until
  you genuinely need >100 people; that avoids exposing a fully-public OAuth app.

## 5. Known trade-off to revisit (not urgent)

- The app loads **Tailwind from a CDN** (`cdn.tailwindcss.com`), which forces the
  CSP to allow `'unsafe-inline'`/`'unsafe-eval'` for scripts. That's fine for now,
  but moving Tailwind to a build step (compiled CSS instead of the CDN) would let
  us tighten the CSP significantly. A good phase-2 hardening item.

## 6. Housekeeping

- Keep dependencies current: periodically run `npm update` and redeploy.
- Rotate the **crew access code** (Settings tab) if it ever leaks.
- Review the **active crew** list on the Roster tab and suspend anyone who's left.
