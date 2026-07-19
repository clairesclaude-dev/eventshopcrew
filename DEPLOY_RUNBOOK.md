# EventShop Crew Portal — Shifts Upgrade: Deploy Runbook

This ships in **5 stages**. Nothing touches the live crew until you push to
GitHub in Stage 2. Do them in order. Total hands-on time ≈ 45–60 min.

Everything here is additive — no existing data is deleted or renamed.

---

## Stage 0 — What changed (so you know what you're deploying)

- **`supabase/migrations/20260719_shifts_upgrade.sql`** — adds subshifts, per-shift
  location, hide-able rate, admin-only cancel, per-shift assignment, targeted
  trades, clock in/out, and Google-calendar tables. Additive + safe to re-run.
- **`src/main.jsx` / `src/config.js`** — the upgraded app (new shift board,
  calendar view, clock in/out, trades, admin shift+subshift editor).
- **`worker/`** — the Cloudflare Worker that does Google Calendar auto-add.
- **`public/_headers`** — security headers for Cloudflare Pages.

---

## Stage 1 — Run the database migration (do this FIRST)

1. Open **Supabase → your project → SQL Editor → New query**.
2. Paste the entire contents of `supabase/migrations/20260719_shifts_upgrade.sql`.
3. Click **Run**. You should see `Success. No rows returned`.
4. It's safe to run again if you're unsure whether it completed.

> Why first: the new app calls new database functions (`claim_shift`,
> `offer_shift_trade`, `clock_in`, …). If the app deploys before the migration,
> those calls fail until the SQL is run. DB-first = zero downtime.

---

## Stage 2 — Move hosting to Cloudflare Pages (GitHub → auto-deploy)

You keep your GitHub workflow exactly the same (push to `main` → auto-build).
We just point Cloudflare at the repo. **Leave Netlify running** — it's your
rollback until you confirm Cloudflare works.

1. Push the updated files to GitHub `main` (see Stage 5 for the file list).
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the `clairesclaude-dev/eventshopcrew` repo.
4. Build settings:
   - **Framework preset:** None
   - **Build command:** `npm run build`
   - **Build output directory:** `public`
5. Deploy. You'll get a `*.pages.dev` URL — open it and confirm the portal loads
   and you can sign in.
6. **Custom domain:** Pages → your project → **Custom domains → Set up** →
   `eventshopcrew.com`. Cloudflare walks you through the DNS switch. Only do this
   once the `*.pages.dev` preview looks right. (This is the moment traffic moves
   off Netlify. If anything looks wrong, point DNS back to Netlify to roll back.)
7. After cutover is verified for a day or two, you can delete the Netlify project
   and remove `netlify.toml` from the repo.

> Security note: hosting doesn't change how "hackable" the site is — your data is
> protected by Supabase's Row-Level Security, which is unchanged. Cloudflare just
> makes the extras (WAF, rate limiting, bot protection) easy — see `SECURITY.md`.

---

## Stage 3 — Create the Google OAuth credential (needed for calendar auto-add)

Only you can do this part (it's tied to your Google account).

1. Go to **Google Cloud Console → console.cloud.google.com** → create a project
   (e.g. "EventShop Crew Calendar").
2. **APIs & Services → Library →** enable **Google Calendar API**.
3. **APIs & Services → OAuth consent screen:**
   - User type: **External**
   - App name, support email, developer email — fill in.
   - Scopes: add **`.../auth/calendar.events`**.
   - **Test users:** add the Google addresses of your crew (in "Testing" mode
     you can add up to 100 people without Google's lengthy app-verification —
     plenty for a crew, and the fastest path). Publish to "Production" later only
     if you outgrow 100.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID:**
   - Application type: **Web application**
   - **Authorized redirect URIs:** leave blank for now — you'll add the Worker
     URL in Stage 4 once it exists.
   - Save. Copy the **Client ID** and **Client Secret** (you'll paste them in
     Stage 4).

---

## Stage 4 — Deploy the Google Calendar Worker

From the `worker/` folder on your machine (needs Node + `npm i -g wrangler`, then
`wrangler login`):

1. `cd worker && npm install`
2. `wrangler deploy` — this prints your Worker URL, e.g.
   `https://es-crew-calendar.<you>.workers.dev`. Copy it.
3. Set the redirect URI everywhere it must match:
   - In **`worker/wrangler.toml`** set `REDIRECT_URI` to
     `https://es-crew-calendar.<you>.workers.dev/oauth/callback`
   - In **Google Cloud → Credentials → your OAuth client → Authorized redirect
     URIs**, add that exact same URL.
   - Re-run `wrangler deploy` after editing `wrangler.toml`.
4. Set the four secrets (they're never stored in the repo):
   ```
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   wrangler secret put SUPABASE_SERVICE_ROLE_KEY   # Supabase → Settings → API → service_role
   wrangler secret put STATE_SECRET                # any long random string, e.g. from a password generator
   ```
5. Turn the feature on in the app: edit **`src/config.js`** and set
   `CALENDAR_WORKER_URL = "https://es-crew-calendar.<you>.workers.dev";`
   then commit + push (Cloudflare Pages auto-rebuilds).

> The `SUPABASE_SERVICE_ROLE_KEY` lives **only** inside the Worker's secrets —
> never in the website code. That key can bypass all security, so it must stay
> server-side. The app never sees it.

---

## Stage 5 — Files to push to GitHub

```
src/main.jsx                                 (updated)
src/config.js                                (updated — set CALENDAR_WORKER_URL after Stage 4)
public/_headers                              (new)
supabase/migrations/20260719_shifts_upgrade.sql   (new — but run it in Supabase, Stage 1)
worker/                                       (new — deploys separately via wrangler, not Pages)
SECURITY.md, DEPLOY_RUNBOOK.md               (new — docs)
```

Cloudflare Pages only builds the website (`src` → `public`). The `worker/` folder
is deployed separately with `wrangler` and is ignored by Pages.

---

## Verify checklist (after all stages)

- [ ] Admin: open an event → **Add shift** → set time, location, rate, toggle
      "Show rate to crew", add a subshift, assign a crew member. Save.
- [ ] Crew (2nd account): **Open shifts** → Claim a shift. It moves to **My shifts**.
- [ ] Crew: **Clock in** → timer runs → **Clock out** → total appears; admin sees
      it under Hours to verify.
- [ ] Crew A: **Offer to…** crew B. Crew B sees the offer, taps **Take it**; the
      shift moves to B. Neither can outright cancel — only hand off. Admin can cancel.
- [ ] Crew: **Connect** Google Calendar → claim a shift → it appears in Google
      Calendar within a few seconds.
- [ ] Calendar view (phone): month grid shows shift days; tapping a day filters.
