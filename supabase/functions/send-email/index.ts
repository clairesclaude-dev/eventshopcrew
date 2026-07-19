// ============================================================================
// EventShop Crew Portal — transactional email via Resend (Supabase Edge Function)
// ----------------------------------------------------------------------------
// The app renders the editable template (from public.email_templates) and calls
// this with { to, subject, html }. A minimal built-in fallback remains for
// { kind } payloads. It safely no-ops (returns { skipped:true }) until
// RESEND_API_KEY is set, so the portal never breaks if email isn't configured.
//
// Secrets (Supabase → Edge Functions → send-email → Secrets):
//   RESEND_API_KEY   (required to actually send)
//   EMAIL_FROM       optional, e.g. "EventShop Crew <crew@eventshopcrew.com>"
//   REPLY_TO         optional, defaults to eventshopknox@gmail.com
// ============================================================================
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") ?? "EventShop Crew <onboarding@resend.dev>";
const REPLY_TO = Deno.env.get("REPLY_TO") ?? "eventshopknox@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

function fallback(kind: string, p: any): { subject: string; html: string } | null {
  const first = esc(String(p.name || "there").split(" ")[0]);
  const when = [p.date, p.time].filter(Boolean).join(" · ");
  const wrap = (h: string) =>
    `<div style="font-family:sans-serif;font-size:16px;line-height:1.6;color:#0B0B0B;max-width:520px;">${h}<p style="margin-top:16px"><a href="https://eventshopcrew.com">Open the portal</a></p></div>`;
  const d = `Role: ${esc(p.roleTitle)}<br>Event: ${esc(p.eventName)}<br>When: ${esc(when)}<br>Where: ${esc(p.location)}`;
  switch (kind) {
    case "welcome": return { subject: "Welcome to the EventShop Crew", html: wrap(`Hi ${first}! You're in — welcome to the crew portal.`) };
    case "claimed": return { subject: `Shift claimed: ${esc(p.roleTitle)}`, html: wrap(`Nice grab, ${first}!<br><br>${d}`) };
    case "transferred": return { subject: `A shift is now yours: ${esc(p.roleTitle)}`, html: wrap(`It's yours now, ${first}!<br><br>${d}`) };
    case "cancelled": return { subject: "A shift was cancelled", html: wrap(`Heads up ${first} — a shift was cancelled.<br><br>${d}`) };
    default: return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = await req.json();
    let { to, subject, html } = body;
    if ((!subject || !html) && body.kind) {
      const m = fallback(body.kind, body);
      if (m) { subject = subject || m.subject; html = html || m.html; }
    }
    if (!to || !subject || !html) return json({ skipped: true, reason: "nothing to send" });
    if (!RESEND_API_KEY) return json({ skipped: true, reason: "RESEND_API_KEY not set yet" });
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], reply_to: REPLY_TO, subject, html }),
    });
    const data = await r.json().catch(() => ({}));
    return json({ ok: r.ok, data }, r.ok ? 200 : 502);
  } catch (e) {
    return json({ error: String(e) }, 400);
  }
});
