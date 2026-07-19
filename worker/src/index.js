/* ============================================================================
 * EventShop Crew Portal — Google Calendar sync Worker (Cloudflare)
 * ----------------------------------------------------------------------------
 * Endpoints:
 *   GET  /connect?token=<supabase access token>   -> start Google OAuth
 *   GET  /oauth/callback?code=&state=             -> finish OAuth, store tokens
 *   POST /sync   { claim_id }  (Bearer supabase token) -> add/update calendar event
 *   POST /remove { claim_id }  (Bearer supabase token) -> delete calendar event
 *
 * Secrets (wrangler secret put ...):
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY, STATE_SECRET
 * Vars (wrangler.toml [vars]):
 *   SUPABASE_URL, APP_ORIGIN, REDIRECT_URI, TIMEZONE
 * ==========================================================================*/

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.events";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env);

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    try {
      if (url.pathname === "/connect" && request.method === "GET") return connect(url, env);
      if (url.pathname === "/oauth/callback" && request.method === "GET") return callback(url, env);
      if (url.pathname === "/sync" && request.method === "POST") return sync(request, env, cors);
      if (url.pathname === "/remove" && request.method === "POST") return remove(request, env, cors);
      if (url.pathname === "/health") return json({ ok: true }, 200, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  },
};

/* ----------------------------- helpers ---------------------------------- */
function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.APP_ORIGIN || "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...extra } });
}
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
}
async function signState(env, userId) {
  const payload = `${userId}.${Date.now() + 10 * 60 * 1000}`;      // 10-min expiry
  const sig = await hmac(env.STATE_SECRET, payload);
  return b64url(new TextEncoder().encode(`${payload}.${sig}`));
}
async function verifyState(env, state) {
  const raw = new TextDecoder().decode(Uint8Array.from(atob(state.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
  const [userId, exp, sig] = raw.split(".");
  if (!userId || !exp || !sig) throw new Error("bad state");
  if (await hmac(env.STATE_SECRET, `${userId}.${exp}`) !== sig) throw new Error("bad state sig");
  if (Date.now() > Number(exp)) throw new Error("state expired");
  return userId;
}

/* ---- Supabase (service role) REST + auth ---- */
async function supaUser(env, accessToken) {
  const r = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) throw new Error("invalid session");
  return r.json(); // { id, email, ... }
}
function svc(env, path, init = {}) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
}

/* ------------------------------ OAuth ----------------------------------- */
async function connect(url, env) {
  const token = url.searchParams.get("token");
  if (!token) return new Response("missing token", { status: 400 });
  const user = await supaUser(env, token);
  const state = await signState(env, user.id);
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  auth.searchParams.set("redirect_uri", env.REDIRECT_URI);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", GOOGLE_SCOPE);
  auth.searchParams.set("access_type", "offline");
  auth.searchParams.set("prompt", "consent");
  auth.searchParams.set("include_granted_scopes", "true");
  auth.searchParams.set("state", state);
  return Response.redirect(auth.toString(), 302);
}

async function callback(url, env) {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const back = (ok) => Response.redirect(`${env.APP_ORIGIN}/?calendar=${ok ? "connected" : "error"}`, 302);
  if (!code || !state) return back(false);
  let userId;
  try { userId = await verifyState(env, state); } catch { return back(false); }

  const tok = await exchangeCode(env, code);
  if (!tok.refresh_token) return back(false); // needs consent w/ offline access

  // fetch the Google account email (best-effort)
  let gEmail = null;
  try {
    const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: `Bearer ${tok.access_token}` } });
    if (me.ok) gEmail = (await me.json()).email;
  } catch { /* ignore */ }

  await svc(env, "google_calendar_tokens", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      user_id: userId,
      refresh_token: tok.refresh_token,
      access_token: tok.access_token,
      expiry: new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString(),
      google_email: gEmail,
      calendar_id: "primary",
    }),
  });
  await svc(env, `profiles?id=eq.${userId}`, { method: "PATCH", body: JSON.stringify({ google_calendar_connected: true }) });
  return back(true);
}

async function exchangeCode(env, code) {
  const body = new URLSearchParams({
    code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: env.REDIRECT_URI, grant_type: "authorization_code",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error("token exchange failed");
  return r.json();
}

async function freshAccessToken(env, row) {
  if (row.access_token && row.expiry && new Date(row.expiry) > new Date()) return row.access_token;
  const body = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: row.refresh_token, grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  if (!r.ok) throw new Error("refresh failed");
  const t = await r.json();
  await svc(env, `google_calendar_tokens?user_id=eq.${row.user_id}`, {
    method: "PATCH",
    body: JSON.stringify({ access_token: t.access_token, expiry: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString() }),
  });
  return t.access_token;
}

/* ------------------------------- sync ----------------------------------- */
async function loadTokenRow(env, userId) {
  const r = await svc(env, `google_calendar_tokens?user_id=eq.${userId}&select=*`);
  const rows = await r.json();
  return rows[0];
}
async function loadClaim(env, claimId) {
  const r = await svc(env, `claims?id=eq.${claimId}&select=id,crew_id,shift_id,shifts(role_title,location,starts_at,ends_at,notes,status,events(name,venue,address))`);
  const rows = await r.json();
  return rows[0];
}
function dtField(v, tz) {
  if (!v) return null;
  let s = String(v);
  // normalize "YYYY-MM-DDTHH:MM" -> add seconds; leave full ISO alone
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s = s + ":00";
  return { dateTime: s, timeZone: tz || "America/New_York" };
}

async function sync(request, env, cors) {
  const auth = (request.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!auth) return json({ error: "no auth" }, 401, cors);
  const user = await supaUser(env, auth);
  const { claim_id } = await request.json();
  const claim = await loadClaim(env, claim_id);
  if (!claim) return json({ error: "claim not found" }, 404, cors);
  if (claim.crew_id !== user.id) return json({ error: "not your shift" }, 403, cors);

  const row = await loadTokenRow(env, user.id);
  if (!row) return json({ error: "not connected", need_connect: true }, 200, cors);

  const access = await freshAccessToken(env, row);
  const s = claim.shifts || {};
  const ev = s.events || {};
  const tz = env.TIMEZONE || "America/New_York";
  const start = dtField(s.starts_at, tz);
  const end = dtField(s.ends_at || s.starts_at, tz);
  if (!start) return json({ error: "shift has no time set" }, 200, cors);

  const evtBody = {
    summary: `${s.role_title || "Shift"} — ${ev.name || "EventShop"}`,
    location: s.location || ev.venue || ev.address || "",
    description: `EventShop crew shift.${s.notes ? "\nNotes: " + s.notes : ""}`,
    start, end,
    source: { title: "EventShop Crew Portal", url: env.APP_ORIGIN },
  };

  // already synced? -> update
  const mapR = await svc(env, `google_calendar_events?claim_id=eq.${claim_id}&select=google_event_id`);
  const mapRows = await mapR.json();
  const cal = row.calendar_id || "primary";
  let resp, eventId = mapRows[0]?.google_event_id;

  if (eventId) {
    resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events/${eventId}`, {
      method: "PUT", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify(evtBody),
    });
  } else {
    resp = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events`, {
      method: "POST", headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" }, body: JSON.stringify(evtBody),
    });
  }
  if (!resp.ok) return json({ error: "calendar write failed", detail: await resp.text() }, 200, cors);
  const evt = await resp.json();
  if (!eventId) {
    await svc(env, "google_calendar_events", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({ claim_id, user_id: user.id, google_event_id: evt.id, updated_at: new Date().toISOString() }),
    });
  }
  return json({ ok: true, event_id: evt.id }, 200, cors);
}

async function remove(request, env, cors) {
  const auth = (request.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!auth) return json({ error: "no auth" }, 401, cors);
  const user = await supaUser(env, auth);
  const { claim_id } = await request.json();
  const mapR = await svc(env, `google_calendar_events?claim_id=eq.${claim_id}&user_id=eq.${user.id}&select=google_event_id`);
  const mapRows = await mapR.json();
  if (!mapRows[0]) return json({ ok: true }, 200, cors);
  const row = await loadTokenRow(env, user.id);
  if (row) {
    const access = await freshAccessToken(env, row);
    await fetch(`https://www.googleapis.com/calendar/v3/calendars/${row.calendar_id || "primary"}/events/${mapRows[0].google_event_id}`, {
      method: "DELETE", headers: { Authorization: `Bearer ${access}` },
    });
  }
  await svc(env, `google_calendar_events?claim_id=eq.${claim_id}`, { method: "DELETE" });
  return json({ ok: true }, 200, cors);
}
