import { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Calendar, Clock, FileText, DollarSign, Users, Radio, LayoutDashboard,
  LogOut, Upload, Check, X, Plus, QrCode, ShieldCheck, AlertCircle,
  MapPin, ChevronRight, ChevronLeft, ChevronDown, Loader2, Megaphone, UserPlus, Download, Trash2, Settings, KeyRound, Mail,
  MessageCircle, HelpCircle, Send, AlertTriangle, Receipt,
  CalendarPlus, CalendarDays, ArrowLeftRight, Play, Square, Timer, User, Ban, Info, Repeat, List,
} from "lucide-react";
import QRCode from "qrcode";
import { supabase } from "./supabaseClient.js";
import { IS_CONFIGURED, ADMIN_EMAIL, CALENDAR_WORKER_URL, CALENDAR_ENABLED } from "./config.js";

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */
const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
const fmtTime = (s) =>
  s ? new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);
const fmtRange = (a, b) => (a || b) ? `${fmtTime(a)}${b ? "–" + fmtTime(b) : ""}` : "Time TBD";

// hours (number) -> "3h 15m"
const fmtDur = (hrs) => {
  const h = Math.floor(Number(hrs || 0));
  const m = Math.round((Number(hrs || 0) - h) * 60);
  return `${h}h${m ? ` ${m}m` : ""}`;
};
// running duration between an ISO start and now (or an end), as "1:04:22"
const liveDur = (startIso, endIso) => {
  if (!startIso) return "0:00:00";
  const ms = (endIso ? new Date(endIso) : new Date()) - new Date(startIso);
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
};
const dayKey = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.toISOString().slice(0, 10); };

// Ask the Calendar Worker to (re)sync a claim into the person's Google Calendar.
// No-op (silent) if the Worker isn't configured or the user hasn't connected.
async function syncClaimToCalendar(claimId) {
  if (!CALENDAR_ENABLED || !claimId) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await fetch(`${CALENDAR_WORKER_URL}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ claim_id: claimId }),
    });
  } catch { /* calendar is best-effort; never block the claim */ }
}

function Spinner({ label }) {
  return (
    <div className="flex items-center gap-2 text-ink/60 py-10 justify-center">
      <Loader2 className="w-5 h-5 animate-spin" /> {label || "Loading…"}
    </div>
  );
}

function Btn({ children, onClick, variant = "primary", type = "button", disabled, className = "" }) {
  const base = "inline-flex items-center justify-center gap-2 font-semibold rounded-xl px-4 py-2.5 transition disabled:opacity-50 disabled:cursor-not-allowed";
  const styles = {
    primary: "bg-ink text-white hover:bg-black",
    canary: "bg-canary text-ink hover:brightness-95",
    forest: "bg-forest text-white hover:brightness-110",
    ghost: "bg-transparent text-ink hover:bg-ink/5 border border-ink/15",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${styles[variant]} ${className}`}>
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  return <div className={`bg-white border border-ink/10 rounded-2xl shadow-sm ${className}`}>{children}</div>;
}

function Pill({ children, tone = "default" }) {
  const tones = {
    default: "bg-ink/8 text-ink",
    canary: "bg-canary text-ink",
    forest: "bg-forest text-white",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-700",
    amber: "bg-amber-100 text-amber-800",
  };
  return <span className={`text-xs font-bold uppercase tracking-wide px-2.5 py-1 rounded-full ${tones[tone]}`}>{children}</span>;
}

/* ------------------------------------------------------------------ */
/*  Auth hook                                                          */
/* ------------------------------------------------------------------ */
function useAuth() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (uid) => {
    const { data } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
    setProfile(data || null);
  }, []);

  useEffect(() => {
    if (!IS_CONFIGURED) { setLoading(false); return; }
    supabase.auth.getSession().then(async ({ data }) => {
      setSession(data.session);
      if (data.session) await loadProfile(data.session.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, s) => {
      setSession(s);
      if (s) await loadProfile(s.user.id);
      else setProfile(null);
    });
    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  return { session, profile, loading, reloadProfile: () => session && loadProfile(session.user.id) };
}

/* ------------------------------------------------------------------ */
/*  Branding                                                           */
/* ------------------------------------------------------------------ */
function Header({ profile, onSignOut, onNav }) {
  return (
    <header className="border-b border-ink/10 bg-white sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
        <button onClick={() => onNav && onNav(profile?.role === "admin" ? "admin-home" : "shifts")} className="flex items-center gap-3">
          <img src="/assets/es-logo.png" alt="EventShop" className="h-11 w-11 rounded-full" />
          <img src="/assets/heading.png" alt="EventShop Crew Portal" className="h-10 hidden sm:block" />
        </button>
        {profile && (
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="font-bold leading-tight">{profile.full_name || profile.email}</div>
              <div className="text-xs text-ink/50 capitalize">{profile.role}</div>
            </div>
            <Btn variant="ghost" onClick={onSignOut}><LogOut className="w-4 h-4" /> Sign out</Btn>
          </div>
        )}
      </div>
    </header>
  );
}

function Hero() {
  return (
    <div className="text-center py-8">
      <img src="/assets/heading.png" alt="EventShop Crew Portal" className="mx-auto h-24 sm:h-32" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Not-configured + Sign-in + Pending screens                         */
/* ------------------------------------------------------------------ */
function NotConfigured() {
  return (
    <div className="max-w-lg mx-auto px-4 py-16 text-center">
      <Hero />
      <Card className="p-6 mt-4 text-left">
        <div className="flex items-center gap-2 font-bold text-lg"><AlertCircle className="w-5 h-5 text-canary" /> Almost ready</div>
        <p className="mt-2 text-ink/70">
          The portal is built and just needs its Supabase <b>anon key</b> to connect. Once that's
          added, sign-in, saved data, and document uploads all go live.
        </p>
      </Card>
    </div>
  );
}

function SignIn() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function signInPw(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setErr("Couldn't sign in with that password. If it's your first time here (or you haven't set a password yet), use “Email me a sign-in link” below.");
  }
  async function sendLink() {
    if (!email.trim()) { setErr("Enter your email first."); return; }
    setBusy(true); setErr("");
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: window.location.origin } });
    setBusy(false);
    if (error) setErr(error.message); else setSent(true);
  }

  if (sent) return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Hero />
      <Card className="p-6 text-center py-8">
        <Check className="w-10 h-10 text-forest mx-auto" />
        <h2 className="font-display font-extrabold text-2xl mt-3">Check your email</h2>
        <p className="text-ink/70 mt-2">We sent a secure sign-in link to <b>{email}</b>. Tap it to confirm and enter your portal. Once you're in, set a password so next time it's one tap.</p>
      </Card>
    </div>
  );

  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Hero />
      <Card className="p-6">
        <h2 className="font-display font-extrabold text-2xl">Sign in to your portal</h2>
        <form onSubmit={signInPw} className="mt-4 space-y-3">
          <input
            type="email" required value={email} autoComplete="username"
            onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com"
            className="w-full border border-ink/20 rounded-xl px-4 py-3 outline-none focus:border-ink"
          />
          <input
            type="password" value={password} autoComplete="current-password"
            onChange={(e) => setPassword(e.target.value)} placeholder="Password"
            className="w-full border border-ink/20 rounded-xl px-4 py-3 outline-none focus:border-ink"
          />
          {err && <p className="text-red-600 text-sm">{err}</p>}
          <Btn type="submit" variant="canary" disabled={busy || !email || !password} className="w-full">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign in"}
          </Btn>
        </form>
        <div className="mt-4 pt-4 border-t border-ink/10 text-center">
          <p className="text-ink/60 text-sm">First time here, or no password yet?</p>
          <Btn variant="ghost" onClick={sendLink} disabled={busy} className="mt-2 w-full">
            <Mail className="w-4 h-4" /> Email me a sign-in link
          </Btn>
        </div>
      </Card>
    </div>
  );
}

function AccessGate({ profile, onSignOut, onApproved }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [checking, setChecking] = useState(true);

  // If a manager already added this person's email to the roster, approve them
  // automatically so they skip the code entirely.
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("try_auto_approve");
      if (data === true) { await onApproved(); return; }
      setChecking(false);
    })();
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { data, error } = await supabase.rpc("redeem_access_code", { code: code.trim() });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    if (data === true) { await onApproved(); }
    else setErr("That code isn't right — double-check it with your manager.");
  }

  if (checking) return <div className="pt-20"><Spinner label="Checking your access…" /></div>;

  return (
    <div className="max-w-md mx-auto px-4 py-10 text-center">
      <Hero />
      <Card className="p-6">
        <KeyRound className="w-10 h-10 text-forest mx-auto" />
        <h2 className="font-display font-extrabold text-2xl mt-3">Enter your crew code</h2>
        <p className="text-ink/70 mt-2">
          Welcome, {profile.full_name || profile.email}. Enter the crew access code your manager
          gave you to unlock your portal.
        </p>
        <form onSubmit={submit} className="mt-4">
          <input
            value={code} onChange={(e) => setCode(e.target.value)} placeholder="Crew code"
            className="w-full border border-ink/20 rounded-xl px-4 py-3 text-center text-lg font-bold tracking-widest uppercase outline-none focus:border-ink"
          />
          {err && <p className="text-red-600 text-sm mt-2">{err}</p>}
          <Btn type="submit" variant="canary" disabled={busy || !code.trim()} className="w-full mt-3">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Unlock my portal"}
          </Btn>
        </form>
        <Btn variant="ghost" onClick={onSignOut} className="mt-3"><LogOut className="w-4 h-4" /> Sign out</Btn>
      </Card>
    </div>
  );
}

function AdminSettings() {
  const [code, setCode] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("app_settings").select("access_code").eq("id", 1).maybeSingle();
      setCode(data?.access_code || "");
    })();
  }, []);
  async function save() {
    setSaving(true); setSaved(false);
    await supabase.from("app_settings").update({ access_code: code.trim() }).eq("id", 1);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }
  if (code === null) return <Spinner />;
  return (
    <div className="space-y-4 max-w-lg">
      <h1 className="font-display font-black text-3xl">Settings</h1>
      <Card className="p-5">
        <div className="font-bold text-lg flex items-center gap-2"><KeyRound className="w-5 h-5 text-forest" /> Crew access code</div>
        <p className="text-ink/60 text-sm mt-1">
          New crew enter this code once, right after signing in, to unlock their portal — no
          approval needed. Change it anytime; the old code stops working immediately.
        </p>
        <input
          value={code} onChange={(e) => setCode(e.target.value)}
          className="w-full border border-ink/20 rounded-xl px-4 py-3 mt-3 text-lg font-bold tracking-widest uppercase outline-none focus:border-ink"
        />
        <div className="flex items-center gap-3 mt-3">
          <Btn variant="primary" onClick={save} disabled={saving || !code.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save code"}
          </Btn>
          {saved && <span className="text-forest font-semibold flex items-center gap-1"><Check className="w-4 h-4" /> Saved</span>}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CREW: Shift board  (mobile-first: My shifts + Open shifts + calendar)*/
/* ------------------------------------------------------------------ */
function rateFor(shift) {
  // crew always see the public rate; hidden if admin turned rate_visible off
  if (shift.rate_visible === false) return null;
  return shift.public_rate ?? null;
}

function ShiftBoard({ profile }) {
  const [events, setEvents] = useState(null);   // published events w/ shifts+subshifts
  const [claims, setClaims] = useState([]);     // my claims (with shift+event)
  const [ssa, setSsa] = useState([]);           // my subshift assignments
  const [hours, setHours] = useState([]);       // my hours entries
  const [offers, setOffers] = useState([]);     // incoming trade offers
  const [casts, setCasts] = useState([]);
  const [crew, setCrew] = useState([]);         // for trade target picker
  const [tab, setTab] = useState("mine");       // mine | open
  const [mode, setMode] = useState("list");     // list | calendar
  const [selDay, setSelDay] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [asking, setAsking] = useState(null);
  const [tradeFor, setTradeFor] = useState(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const load = useCallback(async () => {
    const [{ data: ev }, { data: cl }, { data: sa }, { data: hh }, { data: of }, { data: bc }, { data: cr }] =
      await Promise.all([
        supabase.from("events").select("*, shifts(*, subshifts(*))").eq("status", "published").order("starts_at"),
        supabase.from("claims").select("*, shifts(*, subshifts(*), events(*))").eq("crew_id", profile.id)
          .in("status", ["claimed", "confirmed", "waitlisted", "completed"]),
        supabase.from("subshift_assignments").select("*").eq("crew_id", profile.id),
        supabase.from("hours_entries").select("*").eq("crew_id", profile.id).order("check_in_at", { ascending: false }),
        supabase.rpc("incoming_trade_offers"),
        supabase.from("broadcasts").select("*, events(name)").order("created_at", { ascending: false }).limit(5),
        supabase.rpc("list_crew_basic"),
      ]);
    setEvents(ev || []); setClaims(cl || []); setSsa(sa || []); setHours(hh || []);
    setOffers(of || []); setCasts(bc || []); setCrew(cr || []);
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

  const myShiftIds = new Set(claims.map((c) => c.shift_id));
  const mySsIds = new Set(ssa.map((a) => a.subshift_id));

  async function claim(shiftId) {
    setBusyId(shiftId);
    const { data, error } = await supabase.rpc("claim_shift", { p_shift_id: shiftId });
    if (error) alert(error.message);
    else if (data?.id) syncClaimToCalendar(data.id);
    await load(); setBusyId(null);
  }
  async function clockIn(shiftId, subshiftId) {
    setBusyId(shiftId);
    const { error } = await supabase.rpc("clock_in", { p_shift_id: shiftId, p_subshift_id: subshiftId || null });
    if (error) alert(error.message);
    await load(); setBusyId(null);
  }
  async function clockOut(entryId, shiftId) {
    setBusyId(shiftId);
    const { error } = await supabase.rpc("clock_out", { p_entry_id: entryId });
    if (error) alert(error.message);
    await load(); setBusyId(null);
  }
  async function acceptOffer(t) {
    setBusyId(t.trade_id);
    const { data, error } = await supabase.rpc("accept_shift_trade", { p_trade_id: t.trade_id });
    if (error) alert(error.message);
    else if (data?.id) syncClaimToCalendar(data.id);
    await load(); setBusyId(null);
  }
  async function declineOffer(t) {
    setBusyId(t.trade_id);
    await supabase.rpc("respond_decline_trade", { p_trade_id: t.trade_id });
    await load(); setBusyId(null);
  }

  if (!events) return <Spinner label="Loading shifts…" />;

  // open shifts = published, active, not already mine
  const openByEvent = events
    .map((e) => ({ ...e, shifts: (e.shifts || []).filter((s) => s.status !== "cancelled" && !myShiftIds.has(s.id)) }))
    .filter((e) => e.shifts.length);

  // day filter for calendar mode
  const dayMatch = (iso) => !selDay || (iso && dayKey(iso) === selDay);

  return (
    <div className="space-y-4">
      {casts.length > 0 && (
        <Card className="p-4 bg-canary/20 border-canary">
          <div className="font-bold flex items-center gap-2 mb-1"><Megaphone className="w-4 h-4" /> Updates from EventShop</div>
          {casts.map((b) => <div key={b.id} className="text-sm">{b.body}{b.events?.name ? <span className="text-ink/50"> · {b.events.name}</span> : null}</div>)}
        </Card>
      )}

      {offers.length > 0 && (
        <Card className="p-4 border-forest bg-forest/5">
          <div className="font-bold flex items-center gap-2 mb-2"><ArrowLeftRight className="w-4 h-4 text-forest" /> Shifts offered to you</div>
          <div className="space-y-2">
            {offers.map((t) => (
              <div key={t.trade_id} className="flex items-center justify-between gap-2 border-t border-ink/8 pt-2">
                <div className="text-sm min-w-0">
                  <div className="font-bold truncate">{t.role_title} · {t.event_name}</div>
                  <div className="text-ink/60">{fmtDate(t.starts_at)} · {fmtRange(t.starts_at, t.ends_at)} · from {t.from_name}</div>
                  {t.message && <div className="text-ink/60 italic">“{t.message}”</div>}
                </div>
                <div className="flex gap-1 shrink-0">
                  <Btn variant="forest" disabled={busyId === t.trade_id} onClick={() => acceptOffer(t)}><Check className="w-4 h-4" /> Take it</Btn>
                  <Btn variant="ghost" disabled={busyId === t.trade_id} onClick={() => declineOffer(t)}><X className="w-4 h-4" /></Btn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {CALENDAR_ENABLED && !profile.google_calendar_connected && <GoogleConnectCard />}

      {/* view toggles */}
      <div className="flex items-center justify-between gap-2">
        <div className="inline-flex rounded-xl bg-ink/5 p-1">
          <TabBtn active={tab === "mine"} onClick={() => setTab("mine")} icon={Check} label={`My shifts${claims.length ? ` (${claims.length})` : ""}`} />
          <TabBtn active={tab === "open"} onClick={() => setTab("open")} icon={Plus} label="Open shifts" />
        </div>
        <div className="inline-flex rounded-xl bg-ink/5 p-1">
          <TabBtn active={mode === "list"} onClick={() => { setMode("list"); setSelDay(null); }} icon={List} label="" title="List" />
          <TabBtn active={mode === "calendar"} onClick={() => setMode("calendar")} icon={CalendarDays} label="" title="Calendar" />
        </div>
      </div>

      {mode === "calendar" && (
        <MonthCalendar
          claims={claims}
          openEvents={openByEvent}
          tab={tab}
          selDay={selDay}
          onSelDay={setSelDay}
        />
      )}

      {tab === "mine" ? (
        claims.filter((c) => dayMatch(c.shifts?.starts_at)).length === 0 ? (
          <Empty icon={Calendar} title={selDay ? "Nothing on this day" : "No shifts yet"} body="Claim an open shift and it shows up here with clock-in, notes, and calendar sync." />
        ) : (
          <div className="space-y-3">
            {claims.filter((c) => dayMatch(c.shifts?.starts_at)).map((c) => (
              <MyShiftCard key={c.id} claim={c} hours={hours} mySsIds={mySsIds} now={now}
                busyId={busyId} onClockIn={clockIn} onClockOut={clockOut} onTrade={() => setTradeFor(c)}
                connected={profile.google_calendar_connected} />
            ))}
          </div>
        )
      ) : (
        openByEvent.filter((e) => e.shifts.some((s) => dayMatch(s.starts_at))).length === 0 ? (
          <Empty icon={Calendar} title={selDay ? "Nothing open on this day" : "No open shifts"} body="New shifts appear here as events get scheduled." />
        ) : (
          <div className="space-y-4">
            {openByEvent.map((ev) => {
              const shifts = ev.shifts.filter((s) => dayMatch(s.starts_at));
              if (!shifts.length) return null;
              return (
                <Card key={ev.id} className="overflow-hidden">
                  <div className="bg-ink text-white px-4 py-3 flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-display font-extrabold text-lg truncate">{ev.name}</div>
                      <div className="text-white/70 text-sm flex items-center gap-1.5"><MapPin className="w-3.5 h-3.5 shrink-0" /> {ev.venue || "TBD"} · {fmtDate(ev.starts_at)}</div>
                    </div>
                    <button onClick={() => setAsking(ev)} className="text-white/80 hover:text-white text-xs font-semibold flex items-center gap-1 shrink-0"><HelpCircle className="w-4 h-4" /> Ask</button>
                  </div>
                  <div className="divide-y divide-ink/8">
                    {shifts.map((s) => (
                      <OpenShiftRow key={s.id} shift={s} mySsIds={mySsIds} busy={busyId === s.id} onClaim={() => claim(s.id)} />
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      )}

      {asking && <AskQuestion event={asking} profile={profile} onClose={() => setAsking(null)} />}
      {tradeFor && <OfferTradeModal claim={tradeFor} crew={crew} onClose={() => setTradeFor(null)} onDone={async () => { setTradeFor(null); await load(); }} />}
    </div>
  );
}

function TabBtn({ active, onClick, icon: Icon, label, title }) {
  return (
    <button onClick={onClick} title={title}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold transition ${active ? "bg-white shadow-sm text-ink" : "text-ink/50"}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

function SubshiftChips({ subshifts, mySsIds }) {
  const list = [...(subshifts || [])].sort((a, b) => (a.sort_order - b.sort_order) || ((a.starts_at || "") < (b.starts_at || "") ? -1 : 1));
  if (!list.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {list.map((ss) => {
        const mine = mySsIds?.has(ss.id);
        return (
          <span key={ss.id} className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-lg border ${mine ? "bg-canary/30 border-canary text-ink" : "bg-ink/5 border-ink/10 text-ink/60"}`}>
            <Repeat className="w-3 h-3" /> {ss.starts_at ? fmtTime(ss.starts_at) : ""}{ss.ends_at ? `–${fmtTime(ss.ends_at)}` : ""} {ss.title}{ss.location ? ` · ${ss.location}` : ""}
          </span>
        );
      })}
    </div>
  );
}

function MyShiftCard({ claim, hours, mySsIds, now, busyId, onClockIn, onClockOut, onTrade, connected }) {
  const s = claim.shifts || {};
  const ev = s.events || {};
  const rate = rateFor(s);
  const myHours = hours.filter((h) => h.shift_id === s.id);
  const open = myHours.find((h) => h.check_in_at && !h.check_out_at);
  const total = myHours.reduce((a, h) => a + Number(h.hours || 0), 0);
  const cancelled = s.status === "cancelled";
  return (
    <Card className={`p-4 ${cancelled ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display font-extrabold text-lg truncate">{s.role_title}</div>
          <div className="text-sm text-ink/60">{ev.name}</div>
        </div>
        <Pill tone={cancelled ? "red" : claim.status === "waitlisted" ? "amber" : "green"}>{cancelled ? "cancelled" : claim.status}</Pill>
      </div>

      <div className="mt-2 grid grid-cols-1 gap-1 text-sm text-ink/70">
        <div className="flex items-center gap-1.5"><Calendar className="w-4 h-4 text-ink/40" /> {fmtDate(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at)}</div>
        <div className="flex items-center gap-1.5"><MapPin className="w-4 h-4 text-ink/40" /> {s.location || ev.venue || "TBD"}</div>
        {rate != null && <div className="flex items-center gap-1.5"><DollarSign className="w-4 h-4 text-ink/40" /> {money(rate)}/hr</div>}
      </div>

      <SubshiftChips subshifts={s.subshifts} mySsIds={mySsIds} />

      {s.notes && <div className="mt-2 text-sm bg-ink/5 rounded-lg px-3 py-2 flex gap-2"><Info className="w-4 h-4 text-ink/40 shrink-0 mt-0.5" /> {s.notes}</div>}

      {!cancelled && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {open ? (
            <>
              <span className="inline-flex items-center gap-1.5 font-mono font-bold text-forest bg-forest/10 rounded-lg px-3 py-2"><Timer className="w-4 h-4" /> {liveDur(open.check_in_at, null)}</span>
              <Btn variant="danger" disabled={busyId === s.id} onClick={() => onClockOut(open.id, s.id)}><Square className="w-4 h-4" /> Clock out</Btn>
            </>
          ) : (
            <Btn variant="forest" disabled={busyId === s.id} onClick={() => onClockIn(s.id, null)}><Play className="w-4 h-4" /> Clock in</Btn>
          )}
          {total > 0 && <span className="text-sm text-ink/60">Total: <b>{fmtDur(total)}</b></span>}
          <Btn variant="ghost" onClick={onTrade}><ArrowLeftRight className="w-4 h-4" /> Offer to…</Btn>
          {CALENDAR_ENABLED && connected && (
            <span className="inline-flex items-center gap-1 text-xs text-forest font-semibold"><CalendarPlus className="w-3.5 h-3.5" /> On Google Calendar</span>
          )}
        </div>
      )}
      {cancelled && <div className="mt-3 text-sm text-red-700 flex items-center gap-1.5"><Ban className="w-4 h-4" /> This shift was cancelled by a manager.</div>}
    </Card>
  );
}

function OpenShiftRow({ shift: s, mySsIds, busy, onClaim }) {
  const rate = rateFor(s);
  return (
    <div className="px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="font-bold">{s.role_title}</div>
        <div className="text-sm text-ink/60 flex flex-wrap gap-x-2">
          <span>{fmtRange(s.starts_at, s.ends_at)}</span>
          {s.location && <span>· {s.location}</span>}
          {rate != null && <span>· {money(rate)}/hr</span>}
          <span>· {s.slots} {s.slots === 1 ? "spot" : "spots"}</span>
        </div>
        <SubshiftChips subshifts={s.subshifts} mySsIds={mySsIds} />
      </div>
      <Btn variant="canary" disabled={busy} onClick={onClaim} className="shrink-0">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Claim <ChevronRight className="w-4 h-4" /></>}
      </Btn>
    </div>
  );
}

function GoogleConnectCard() {
  function connect() {
    if (!CALENDAR_ENABLED) return;
    supabase.auth.getSession().then(({ data }) => {
      const tok = data.session?.access_token;
      if (tok) window.location.href = `${CALENDAR_WORKER_URL}/connect?token=${encodeURIComponent(tok)}`;
    });
  }
  return (
    <Card className="p-4 flex items-center justify-between gap-3 bg-forest/5 border-forest/20">
      <div className="flex items-start gap-2 text-sm">
        <CalendarPlus className="w-5 h-5 text-forest shrink-0" />
        <div><div className="font-bold">Auto-add shifts to Google Calendar</div><div className="text-ink/60">Connect once — every shift you claim lands in your calendar automatically.</div></div>
      </div>
      <Btn variant="forest" onClick={connect} className="shrink-0">Connect</Btn>
    </Card>
  );
}

function OfferTradeModal({ claim, crew, onClose, onDone }) {
  const [to, setTo] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const s = claim.shifts || {};
  async function submit(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.rpc("offer_shift_trade", { p_claim_id: claim.id, p_to_crew: to, p_message: msg.trim() || null });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone();
  }
  return (
    <Modal title="Offer this shift" onClose={onClose}>
      <div className="text-sm text-ink/60 mb-3">{s.role_title} · {fmtDate(s.starts_at)} · {fmtRange(s.starts_at, s.ends_at)}. It stays yours until they accept — you can't cancel a shift, only hand it off.</div>
      <form onSubmit={submit} className="space-y-3">
        <Field label="Offer to">
          <select className={inp} value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Pick a crew member…</option>
            {crew.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </Field>
        <Field label="Note (optional)"><input className={inp} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Can you cover this?" /></Field>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <div className="flex gap-2">
          <Btn type="submit" variant="canary" disabled={busy || !to}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Send className="w-4 h-4" /> Send offer</>}</Btn>
          <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        </div>
      </form>
    </Modal>
  );
}

function MonthCalendar({ claims, openEvents, tab, selDay, onSelDay }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d; });
  const byDay = {};
  const add = (iso) => { if (!iso) return; const k = dayKey(iso); byDay[k] = (byDay[k] || 0) + 1; };
  if (tab === "mine") claims.forEach((c) => add(c.shifts?.starts_at));
  else openEvents.forEach((e) => (e.shifts || []).forEach((s) => add(s.starts_at)));

  const year = cursor.getFullYear(), month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startPad = first.getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  const todayK = dayKey(new Date());

  return (
    <Card className="p-3">
      <div className="flex items-center justify-between px-1 pb-2">
        <button onClick={() => setCursor(new Date(year, month - 1, 1))} className="p-1.5 rounded-lg hover:bg-ink/5"><ChevronLeft className="w-5 h-5" /></button>
        <div className="font-display font-extrabold">{cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</div>
        <button onClick={() => setCursor(new Date(year, month + 1, 1))} className="p-1.5 rounded-lg hover:bg-ink/5"><ChevronRight className="w-5 h-5" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-bold text-ink/40 uppercase">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i} className="py-1">{d}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = dayKey(d);
          const count = byDay[k] || 0;
          const sel = selDay === k;
          return (
            <button key={i} onClick={() => onSelDay(sel ? null : k)}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center text-sm relative transition
                ${sel ? "bg-ink text-white" : count ? "bg-canary/25 hover:bg-canary/40" : "hover:bg-ink/5"}
                ${k === todayK && !sel ? "ring-1 ring-ink/30" : ""}`}>
              <span className={count && !sel ? "font-bold" : ""}>{d.getDate()}</span>
              {count > 0 && <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${sel ? "bg-canary" : "bg-forest"}`} />}
            </button>
          );
        })}
      </div>
      {selDay && <div className="text-center text-xs text-ink/50 pt-2">Showing {new Date(selDay).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })} · <button className="underline" onClick={() => onSelDay(null)}>clear</button></div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  CREW: My hours                                                     */
/* ------------------------------------------------------------------ */
function MyHours({ profile }) {
  const [rows, setRows] = useState(null);
  const [events, setEvents] = useState([]);
  const [logEvent, setLogEvent] = useState("");
  const [logHours, setLogHours] = useState("");
  const [busy, setBusy] = useState(false);
  const [dispute, setDispute] = useState(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.from("hours_entries").select("*, events(name)").eq("crew_id", profile.id).order("created_at", { ascending: false });
    setRows(data || []);
    const { data: cl } = await supabase.from("claims").select("shifts(events(id,name))").eq("crew_id", profile.id).neq("status", "dropped");
    const map = {};
    (cl || []).forEach((c) => { const ev = c.shifts?.events; if (ev) map[ev.id] = ev.name; });
    setEvents(Object.entries(map).map(([id, name]) => ({ id, name })));
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

  async function logHrs(e) {
    e.preventDefault();
    setBusy(true);
    await supabase.from("hours_entries").insert({ crew_id: profile.id, event_id: logEvent || null, hours: Number(logHours), status: "submitted", source: "self" });
    setLogEvent(""); setLogHours(""); setBusy(false); await load();
  }
  async function submitDiscrepancy(id) {
    await supabase.from("hours_entries").update({ status: "disputed", note: note.trim() }).eq("id", id);
    setDispute(null); setNote(""); await load();
  }

  if (!rows) return <Spinner />;
  const total = rows.filter((r) => r.status === "verified").reduce((a, r) => a + Number(r.hours || 0), 0);

  return (
    <div className="space-y-4">
      <Card className="p-5 flex items-center justify-between">
        <div>
          <div className="text-ink/60 text-sm font-semibold uppercase tracking-wide">Verified hours</div>
          <div className="font-display font-black text-4xl">{total.toFixed(1)}</div>
        </div>
        <Clock className="w-10 h-10 text-canary" />
      </Card>

      <Card className="p-5">
        <div className="font-bold text-lg mb-2">Log your hours</div>
        <form onSubmit={logHrs} className="grid sm:grid-cols-3 gap-2 items-end">
          <div className="sm:col-span-2"><Field label="Event">
            <select className={inp} value={logEvent} onChange={(e) => setLogEvent(e.target.value)}>
              <option value="">(pick an event)</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select></Field></div>
          <Field label="Hours"><input type="number" step="0.25" className={inp} value={logHours} onChange={(e) => setLogHours(e.target.value)} required /></Field>
          <Btn type="submit" variant="canary" disabled={busy || !logHours}><Plus className="w-4 h-4" /> Submit hours</Btn>
        </form>
      </Card>

      {rows.length === 0 ? (
        <Empty icon={Clock} title="No hours yet" body="After you work an event, log your hours above and they'll be sent for verification." />
      ) : rows.map((r) => (
        <Card key={r.id} className="p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-bold">{r.events?.name || "Event"}</div>
              <div className="text-sm text-ink/60">{fmtDate(r.created_at)} · {Number(r.hours || 0).toFixed(1)} hrs{r.note ? ` · “${r.note}”` : ""}</div>
            </div>
            <div className="flex items-center gap-2">
              <Pill tone={r.status === "verified" ? "green" : r.status === "disputed" ? "red" : "amber"}>{r.status}</Pill>
              {r.status !== "disputed" && <Btn variant="ghost" onClick={() => { setDispute(r.id); setNote(""); }}><AlertTriangle className="w-4 h-4" /> Discrepancy</Btn>}
            </div>
          </div>
          {dispute === r.id && (
            <div className="mt-3 flex gap-2">
              <input className={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What's off about these hours?" />
              <Btn variant="primary" onClick={() => submitDiscrepancy(r.id)} disabled={!note.trim()}>Send</Btn>
              <Btn variant="ghost" onClick={() => setDispute(null)}>Cancel</Btn>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CREW: Documents (upload to private bucket)                         */
/* ------------------------------------------------------------------ */
const DOC_TYPES = [
  { key: "photo_id", label: "Photo ID" },
  { key: "tabc", label: "TABC Card" },
  { key: "direct_deposit", label: "Direct Deposit" },
  { key: "w9", label: "W-9" },
];

function MyDocuments({ profile }) {
  const [docs, setDocs] = useState(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    const { data } = await supabase.from("documents").select("*").eq("crew_id", profile.id);
    setDocs(data || []);
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

  async function upload(type, file) {
    if (!file) return;
    setBusy(type);
    const path = `${profile.id}/${type}-${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("documents").upload(path, file, { upsert: false });
    if (!error) {
      await supabase.from("documents").insert({ crew_id: profile.id, doc_type: type, storage_path: path, file_name: file.name });
    }
    await load(); setBusy("");
  }

  if (!docs) return <Spinner />;
  return (
    <div className="space-y-4">
      <Card className="p-4 bg-forest/5 border-forest/20">
        <div className="flex items-start gap-2 text-sm text-ink/70">
          <ShieldCheck className="w-5 h-5 text-forest shrink-0" />
          <p>Your documents upload to a private, encrypted store only EventShop managers can open. They're never shared, and are deleted from the server once you are added to the system. Never saved, never printed.</p>
        </div>
      </Card>
      {DOC_TYPES.map((d) => {
        const existing = docs.find((x) => x.doc_type === d.key);
        return (
          <Card key={d.key} className="p-4 flex items-center justify-between gap-3">
            <div>
              <div className="font-bold">{d.label}</div>
              <div className="text-sm text-ink/60">
                {existing ? (existing.status === "downloaded_purged" ? "Received & secured" : `Uploaded: ${existing.file_name}`) : "Not uploaded yet"}
              </div>
            </div>
            <label className="cursor-pointer">
              <span className={`inline-flex items-center gap-2 font-semibold rounded-xl px-4 py-2.5 ${existing ? "bg-ink/5 text-ink border border-ink/15" : "bg-canary text-ink"}`}>
                {busy === d.key ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {existing ? "Replace" : "Upload"}
              </span>
              <input type="file" className="hidden" onChange={(e) => upload(d.key, e.target.files[0])} />
            </label>
          </Card>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Dashboard home                                              */
/* ------------------------------------------------------------------ */
function AdminHome({ profile, onNav }) {
  const [stats, setStats] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const load = useCallback(async () => {
    const [pend, reimb, onboard, events, disp, quest] = await Promise.all([
      supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
      supabase.from("reimbursements").select("id", { count: "exact", head: true }).eq("status", "submitted"),
      supabase.from("onboarding_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
      supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "published"),
      supabase.from("hours_entries").select("id", { count: "exact", head: true }).eq("status", "disputed"),
      supabase.from("shift_questions").select("*, profiles!shift_questions_crew_id_fkey(full_name,email), events(name)").eq("answered", false).order("created_at", { ascending: false }),
    ]);
    setStats({ pend: pend.count || 0, reimb: reimb.count || 0, onboard: onboard.count || 0, events: events.count || 0, disp: disp.count || 0, quest: (quest.data || []).length });
    setQuestions(quest.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function answer(q) {
    const text = (answers[q.id] || "").trim();
    if (!text) return;
    await supabase.from("shift_questions").update({ answer: text, answered: true }).eq("id", q.id);
    await load();
  }

  const tiles = [
    { key: "roster", label: "Access requests", value: stats?.pend, icon: UserPlus, tone: "canary" },
    { key: "reimb", label: "Reimbursements", value: stats?.reimb, icon: DollarSign, tone: "forest" },
    { key: "hours", label: "Hours disputes", value: stats?.disp, icon: AlertTriangle, tone: "canary" },
    { key: "events", label: "Live events", value: stats?.events, icon: Calendar, tone: "forest" },
  ];

  return (
    <div className="space-y-5">
      <h1 className="font-display font-black text-3xl">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {tiles.map((t, i) => (
          <button key={i} onClick={() => onNav(t.key)} className="text-left">
            <Card className="p-4 hover:shadow-md transition">
              <t.icon className={`w-7 h-7 ${t.tone === "canary" ? "text-canary" : "text-forest"}`} />
              <div className="font-display font-black text-3xl mt-2">{stats ? t.value : "—"}</div>
              <div className="text-ink/60 text-sm font-semibold">{t.label}</div>
            </Card>
          </button>
        ))}
      </div>

      {questions.length > 0 && (
        <Card className="p-5">
          <div className="font-bold text-lg flex items-center gap-2 mb-2"><MessageCircle className="w-5 h-5 text-forest" /> Questions from crew ({questions.length})</div>
          <div className="space-y-3">
            {questions.map((q) => (
              <div key={q.id} className="border-t border-ink/8 pt-3">
                <div className="text-sm"><b>{q.profiles?.full_name || q.profiles?.email}</b>{q.events?.name ? ` · ${q.events.name}` : ""} · {fmtDate(q.created_at)}</div>
                <div className="text-ink/80 mt-1">{q.body}</div>
                <div className="flex gap-2 mt-2">
                  <input className={inp} placeholder="Type a reply…" value={answers[q.id] || ""} onChange={(e) => setAnswers((p) => ({ ...p, [q.id]: e.target.value }))} />
                  <Btn variant="forest" onClick={() => answer(q)} disabled={!(answers[q.id] || "").trim()}><Send className="w-4 h-4" /> Reply</Btn>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-5">
        <div className="font-bold text-lg mb-1">Quick actions</div>
        <div className="flex flex-wrap gap-2 mt-2">
          <Btn variant="canary" onClick={() => onNav("events")}><Plus className="w-4 h-4" /> New event</Btn>
          <Btn variant="ghost" onClick={() => onNav("hours")}><Clock className="w-4 h-4" /> Collect hours</Btn>
          <Btn variant="ghost" onClick={() => onNav("broadcast")}><Megaphone className="w-4 h-4" /> Broadcast</Btn>
          <Btn variant="ghost" onClick={() => onNav("qr")}><QrCode className="w-4 h-4" /> Roster QR</Btn>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Access requests (approve crew)                              */
/* ------------------------------------------------------------------ */
function Roster() {
  const [pending, setPending] = useState(null);
  const [invited, setInvited] = useState([]);
  const [crew, setCrew] = useState([]);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [{ data: p }, { data: inv }, { data: appr }] = await Promise.all([
      supabase.from("profiles").select("*").eq("status", "pending").order("created_at"),
      supabase.from("invited_emails").select("*").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,full_name,email,role").eq("status", "approved").order("full_name"),
    ]);
    setPending(p || []); setInvited(inv || []); setCrew(appr || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function decide(id, status) {
    await supabase.from("profiles").update({ status, approved_at: new Date().toISOString() }).eq("id", id);
    await load();
  }
  async function invite(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    await supabase.from("invited_emails").insert({ email: email.trim().toLowerCase() });
    setEmail(""); setBusy(false); await load();
  }
  async function removeInvite(em) { await supabase.from("invited_emails").delete().eq("email", em); await load(); }

  if (!pending) return <Spinner />;
  return (
    <div className="space-y-5">
      <h1 className="font-display font-black text-3xl">Roster</h1>

      <Card className="p-5">
        <div className="font-bold text-lg flex items-center gap-2"><UserPlus className="w-5 h-5 text-forest" /> Add crew by email</div>
        <p className="text-ink/60 text-sm mt-1">Anyone you add is pre-approved — they skip the crew code and get straight in the first time they sign in with that email.</p>
        <form onSubmit={invite} className="flex gap-2 mt-3">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@email.com" className={inp} />
          <Btn type="submit" variant="canary" disabled={busy || !email.trim()}><Plus className="w-4 h-4" /> Add</Btn>
        </form>
        {invited.length > 0 && (
          <div className="mt-4 space-y-1">
            {invited.map((iv) => (
              <div key={iv.email} className="flex items-center justify-between text-sm border-t border-ink/8 pt-2">
                <span>{iv.email}</span>
                <button onClick={() => removeInvite(iv.email)} className="text-ink/40 hover:text-red-600"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <div className="font-bold text-lg mb-2">Access requests</div>
        {pending.length === 0 ? <p className="text-ink/50 text-sm">No one waiting for approval.</p> :
          <div className="space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 border-t border-ink/8 pt-3">
                <div><div className="font-bold">{p.full_name || p.email}</div><div className="text-sm text-ink/60">{p.email}</div></div>
                <div className="flex gap-2">
                  <Btn variant="forest" onClick={() => decide(p.id, "approved")}><Check className="w-4 h-4" /> Approve</Btn>
                  <Btn variant="ghost" onClick={() => decide(p.id, "rejected")}><X className="w-4 h-4" /></Btn>
                </div>
              </div>
            ))}
          </div>}
      </Card>

      <Card className="p-5">
        <div className="font-bold text-lg mb-2">Active crew ({crew.length})</div>
        {crew.length === 0 ? <p className="text-ink/50 text-sm">No approved crew yet.</p> :
          <div className="space-y-1">
            {crew.map((c) => (
              <div key={c.id} className="flex items-center justify-between text-sm border-t border-ink/8 pt-2">
                <span>{c.full_name || c.email}</span>
                {c.role === "admin" ? <Pill tone="forest">Admin</Pill> : <span className="text-ink/50">{c.email}</span>}
              </div>
            ))}
          </div>}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Events (create / edit / publish + shifts w/ rates)          */
/* ------------------------------------------------------------------ */
function ManageEvents() {
  const [events, setEvents] = useState(null);
  const [editing, setEditing] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("events").select("*, shifts(*)").order("starts_at", { ascending: false });
    setEvents(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function saveEvent(ev) {
    if (ev.id) await supabase.from("events").update(ev).eq("id", ev.id);
    else await supabase.from("events").insert(ev);
    setEditing(null); await load();
  }
  async function togglePublish(ev) {
    await supabase.from("events").update({ status: ev.status === "published" ? "draft" : "published" }).eq("id", ev.id);
    await load();
  }

  if (!events) return <Spinner />;
  if (editing) return <EventEditor event={editing} onCancel={() => setEditing(null)} onSave={saveEvent} onReload={load} />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display font-black text-3xl">Events</h1>
        <Btn variant="canary" onClick={() => setEditing({ name: "", status: "draft", is_public: false, visibility: "all_crew" })}><Plus className="w-4 h-4" /> New event</Btn>
      </div>
      {events.length === 0 ? <Empty icon={Calendar} title="No events yet" body="Create your first event to start posting shifts." /> :
        events.map((ev) => (
          <Card key={ev.id} className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display font-extrabold text-xl">{ev.name}</div>
                <div className="text-sm text-ink/60">{ev.venue || "—"} · {fmtDate(ev.starts_at)} · {(ev.shifts || []).length} shifts</div>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={ev.status === "published" ? "green" : "default"}>{ev.status}</Pill>
                <Btn variant="ghost" onClick={() => togglePublish(ev)}>{ev.status === "published" ? "Unpublish" : "Publish"}</Btn>
                <Btn variant="ghost" onClick={() => setEditing(ev)}>Edit</Btn>
              </div>
            </div>
          </Card>
        ))}
    </div>
  );
}

function EventEditor({ event, onCancel, onSave, onReload }) {
  const [f, setF] = useState({
    name: event.name || "", venue: event.venue || "", address: event.address || "",
    starts_at: event.starts_at ? event.starts_at.slice(0, 16) : "",
    ends_at: event.ends_at ? event.ends_at.slice(0, 16) : "",
    attire: event.attire || "", notes: event.notes || "", is_public: !!event.is_public,
    visibility: event.visibility || "all_crew",
    status: event.status || "draft", id: event.id,
  });
  const [crew, setCrew] = useState([]);
  const [assigned, setAssigned] = useState({});
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    (async () => {
      const { data: cr } = await supabase.from("profiles").select("id,full_name,email").eq("role", "crew").eq("status", "approved").order("full_name");
      setCrew(cr || []);
      if (event.id) {
        const { data: as } = await supabase.from("event_assignments").select("crew_id").eq("event_id", event.id);
        const m = {}; (as || []).forEach((a) => { m[a.crew_id] = true; }); setAssigned(m);
      }
    })();
  }, [event.id]);

  async function toggleAssign(cid) {
    if (!event.id) { alert("Save the event first, then assign people."); return; }
    const now = !assigned[cid];
    setAssigned((p) => ({ ...p, [cid]: now }));
    if (now) await supabase.from("event_assignments").insert({ event_id: event.id, crew_id: cid });
    else await supabase.from("event_assignments").delete().eq("event_id", event.id).eq("crew_id", cid);
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display font-black text-3xl">{event.id ? "Edit event" : "New event"}</h1>
      <Card className="p-5 space-y-3">
        <Field label="Event name"><input className={inp} value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Venue"><input className={inp} value={f.venue} onChange={(e) => set("venue", e.target.value)} /></Field>
          <Field label="Address"><input className={inp} value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts"><input type="datetime-local" className={inp} value={f.starts_at} onChange={(e) => set("starts_at", e.target.value)} /></Field>
          <Field label="Ends"><input type="datetime-local" className={inp} value={f.ends_at} onChange={(e) => set("ends_at", e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Attire"><input className={inp} value={f.attire} onChange={(e) => set("attire", e.target.value)} /></Field>
          <Field label="Notes"><input className={inp} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></Field>
        </div>
        <Field label="Who can see this event">
          <select className={inp} value={f.visibility} onChange={(e) => set("visibility", e.target.value)}>
            <option value="all_crew">All approved crew</option>
            <option value="private">Private — only people I assign</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" checked={f.is_public} onChange={(e) => set("is_public", e.target.checked)} />
          Also show shifts on the public (no-login) board
        </label>
      </Card>

      {f.visibility === "private" && event.id && (
        <Card className="p-5">
          <div className="font-bold text-lg mb-1">Assign crew</div>
          <p className="text-ink/60 text-sm mb-3">Only the people you check will see and claim this event.</p>
          <div className="grid sm:grid-cols-2 gap-2 max-h-72 overflow-auto">
            {crew.map((c) => (
              <label key={c.id} className="flex items-center gap-2 text-sm border border-ink/10 rounded-lg px-3 py-2 cursor-pointer">
                <input type="checkbox" checked={!!assigned[c.id]} onChange={() => toggleAssign(c.id)} />
                {c.full_name || c.email}
              </label>
            ))}
            {crew.length === 0 && <div className="text-ink/50 text-sm">No approved crew yet.</div>}
          </div>
        </Card>
      )}
      {f.visibility === "private" && !event.id && (
        <Card className="p-4 text-sm text-ink/60">Save the event first, then a list of crew to assign will appear here.</Card>
      )}

      {event.id && <ShiftManager eventId={event.id} eventVenue={f.venue} crew={crew} />}
      {!event.id && <Card className="p-4 text-sm text-ink/60">Save the event first, then you can add shifts, subshifts, rates, and assignments.</Card>}

      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => onSave(f)}>Save event</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Shift + Subshift manager (dropdown-driven accordions)       */
/* ------------------------------------------------------------------ */
const dtInput = (iso) => (iso ? String(iso).slice(0, 16) : "");

function ShiftManager({ eventId, eventVenue, crew }) {
  const [shifts, setShifts] = useState(null);
  const [claimsBy, setClaimsBy] = useState({});   // shift_id -> [claim w/ profile]
  const [ssaBy, setSsaBy] = useState({});         // subshift_id -> [crew_id]
  const [open, setOpen] = useState({});           // shift_id -> bool
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: sh } = await supabase.from("shifts").select("*, subshifts(*)").eq("event_id", eventId).order("starts_at");
    setShifts(sh || []);
    const ids = (sh || []).map((s) => s.id);
    const subIds = (sh || []).flatMap((s) => (s.subshifts || []).map((x) => x.id));
    if (ids.length) {
      const { data: cl } = await supabase.from("claims")
        .select("*, profiles!claims_crew_id_fkey(id,full_name,email)").in("shift_id", ids)
        .in("status", ["claimed", "confirmed", "waitlisted", "completed"]);
      const cm = {}; (cl || []).forEach((c) => { (cm[c.shift_id] ||= []).push(c); }); setClaimsBy(cm);
    } else setClaimsBy({});
    if (subIds.length) {
      const { data: sa } = await supabase.from("subshift_assignments").select("*").in("subshift_id", subIds);
      const sm = {}; (sa || []).forEach((a) => { (sm[a.subshift_id] ||= []).push(a.crew_id); }); setSsaBy(sm);
    } else setSsaBy({});
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  async function addShift() {
    setBusy(true);
    const { data } = await supabase.from("shifts").insert({ event_id: eventId, role_title: "New role", slots: 1, rate_visible: true, status: "active" }).select("*, subshifts(*)").single();
    setBusy(false);
    if (data) { setOpen((p) => ({ ...p, [data.id]: true })); await load(); }
  }
  async function updShift(id, patch) {
    setShifts((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await supabase.from("shifts").update(patch).eq("id", id);
  }
  async function delShift(id) {
    if (!confirm("Delete this shift? (Use Cancel instead if crew already claimed it.)")) return;
    await supabase.from("shifts").delete().eq("id", id); await load();
  }
  async function cancelShift(s) {
    const claimants = (claimsBy[s.id] || []);
    await supabase.from("shifts").update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", s.id);
    // let anyone who claimed it know
    for (const c of claimants) {
      await supabase.from("notifications").insert({ user_id: c.crew_id, type: "shift_cancelled", title: "Shift cancelled", body: `${s.role_title} was cancelled by a manager.` });
    }
    await load();
  }
  async function reactivateShift(s) { await supabase.from("shifts").update({ status: "active", cancelled_at: null }).eq("id", s.id); await load(); }

  async function addSubshift(shiftId, count) {
    await supabase.from("subshifts").insert({ shift_id: shiftId, title: "Segment", sort_order: count });
    await load();
  }
  async function updSubshift(id, patch, shiftId) {
    setShifts((p) => p.map((s) => s.id !== shiftId ? s : { ...s, subshifts: s.subshifts.map((x) => x.id === id ? { ...x, ...patch } : x) }));
    await supabase.from("subshifts").update(patch).eq("id", id);
  }
  async function delSubshift(id) { await supabase.from("subshifts").delete().eq("id", id); await load(); }

  async function toggleAssign(shiftId, crewId, on) {
    if (on) await supabase.from("claims").insert({ shift_id: shiftId, crew_id: crewId, status: "claimed" });
    else {
      const c = (claimsBy[shiftId] || []).find((x) => x.crew_id === crewId);
      if (c) await supabase.from("claims").delete().eq("id", c.id);
    }
    await load();
  }
  async function toggleSubAssign(subId, crewId, on) {
    if (on) await supabase.from("subshift_assignments").insert({ subshift_id: subId, crew_id: crewId });
    else await supabase.from("subshift_assignments").delete().eq("subshift_id", subId).eq("crew_id", crewId);
    await load();
  }

  if (!shifts) return <Card className="p-4"><Spinner label="Loading shifts…" /></Card>;

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="font-bold text-lg">Shifts</div>
        <Btn variant="canary" onClick={addShift} disabled={busy}><Plus className="w-4 h-4" /> Add shift</Btn>
      </div>
      {shifts.length === 0 && <div className="text-ink/50 text-sm">No shifts yet — add one above.</div>}
      <div className="space-y-2">
        {shifts.map((s) => {
          const claimants = claimsBy[s.id] || [];
          const nameFor = (id) => { const c = claimants.find((x) => x.crew_id === id); return c?.profiles?.full_name || c?.profiles?.email; };
          return (
            <div key={s.id} className={`border rounded-xl ${s.status === "cancelled" ? "border-red-200 bg-red-50/40" : "border-ink/10"}`}>
              <button onClick={() => setOpen((p) => ({ ...p, [s.id]: !p[s.id] }))} className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left">
                <div className="min-w-0">
                  <div className="font-bold flex items-center gap-2">{s.role_title || "Untitled"} {s.status === "cancelled" && <Pill tone="red">cancelled</Pill>}</div>
                  <div className="text-xs text-ink/50">{s.starts_at ? `${fmtDate(s.starts_at)} · ${fmtRange(s.starts_at, s.ends_at)}` : "No time set"} · {claimants.length}/{s.slots} filled{(s.subshifts || []).length ? ` · ${s.subshifts.length} subshifts` : ""}</div>
                </div>
                <ChevronDown className={`w-5 h-5 shrink-0 text-ink/40 transition ${open[s.id] ? "rotate-180" : ""}`} />
              </button>

              {open[s.id] && (
                <div className="px-3 pb-3 space-y-3 border-t border-ink/8 pt-3">
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Role / position"><input className={inp} value={s.role_title || ""} onChange={(e) => updShift(s.id, { role_title: e.target.value })} /></Field>
                    <Field label="Location"><input className={inp} value={s.location || ""} placeholder={eventVenue || "Where"} onChange={(e) => updShift(s.id, { location: e.target.value })} /></Field>
                    <Field label="Starts"><input type="datetime-local" className={inp} value={dtInput(s.starts_at)} onChange={(e) => updShift(s.id, { starts_at: e.target.value })} /></Field>
                    <Field label="Ends"><input type="datetime-local" className={inp} value={dtInput(s.ends_at)} onChange={(e) => updShift(s.id, { ends_at: e.target.value })} /></Field>
                    <Field label="People needed"><input type="number" min="1" className={inp} value={s.slots || 1} onChange={(e) => updShift(s.id, { slots: Number(e.target.value) })} /></Field>
                    <Field label="Rate $/hr"><input type="number" step="0.01" className={inp} value={s.public_rate ?? ""} onChange={(e) => updShift(s.id, { public_rate: e.target.value ? Number(e.target.value) : null })} /></Field>
                  </div>
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={s.rate_visible !== false} onChange={(e) => updShift(s.id, { rate_visible: e.target.checked })} />
                    Show this rate to crew {s.rate_visible === false && <span className="text-ink/40 font-normal">(hidden)</span>}
                  </label>
                  <Field label="Notes (crew can see)"><input className={inp} value={s.notes || ""} onChange={(e) => updShift(s.id, { notes: e.target.value })} placeholder="Arrive 15 min early, park in Lot C…" /></Field>
                  <Field label="Internal notes (admins only)"><input className={inp} value={s.admin_notes || ""} onChange={(e) => updShift(s.id, { admin_notes: e.target.value })} /></Field>

                  {/* Subshifts / rotation */}
                  <div className="rounded-lg bg-ink/[0.03] p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-bold text-sm flex items-center gap-1.5"><Repeat className="w-4 h-4 text-forest" /> Subshifts (rotation)</div>
                      <Btn variant="ghost" onClick={() => addSubshift(s.id, (s.subshifts || []).length)} className="!px-2 !py-1 text-xs"><Plus className="w-3.5 h-3.5" /> Add</Btn>
                    </div>
                    {(s.subshifts || []).length === 0 && <div className="text-ink/40 text-xs">Optional — e.g. Front Gate 4–6p, then Merch 6–10p.</div>}
                    <div className="space-y-2">
                      {[...(s.subshifts || [])].sort((a, b) => a.sort_order - b.sort_order).map((ss) => (
                        <div key={ss.id} className="bg-white border border-ink/10 rounded-lg p-2 space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <input className={inp} value={ss.title || ""} placeholder="Segment name" onChange={(e) => updSubshift(ss.id, { title: e.target.value }, s.id)} />
                            <input className={inp} value={ss.location || ""} placeholder="Location" onChange={(e) => updSubshift(ss.id, { location: e.target.value }, s.id)} />
                            <input type="datetime-local" className={inp} value={dtInput(ss.starts_at)} onChange={(e) => updSubshift(ss.id, { starts_at: e.target.value }, s.id)} />
                            <input type="datetime-local" className={inp} value={dtInput(ss.ends_at)} onChange={(e) => updSubshift(ss.id, { ends_at: e.target.value }, s.id)} />
                          </div>
                          {claimants.length > 0 && (
                            <div>
                              <div className="text-[11px] font-bold uppercase tracking-wide text-ink/40 mb-1">Who's on this segment</div>
                              <div className="flex flex-wrap gap-1.5">
                                {claimants.map((c) => {
                                  const on = (ssaBy[ss.id] || []).includes(c.crew_id);
                                  return (
                                    <button key={c.crew_id} onClick={() => toggleSubAssign(ss.id, c.crew_id, !on)}
                                      className={`text-xs font-semibold px-2 py-1 rounded-lg border ${on ? "bg-canary/40 border-canary" : "bg-white border-ink/15 text-ink/60"}`}>
                                      {c.profiles?.full_name || c.profiles?.email}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          <div className="flex justify-end"><button className="text-red-600 text-xs flex items-center gap-1" onClick={() => delSubshift(ss.id)}><Trash2 className="w-3.5 h-3.5" /> Remove segment</button></div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Assignment */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-wide text-ink/40 mb-1">Assign crew ({claimants.length}/{s.slots})</div>
                    <div className="grid sm:grid-cols-2 gap-1.5 max-h-56 overflow-auto">
                      {crew.map((c) => {
                        const on = claimants.some((x) => x.crew_id === c.id);
                        return (
                          <label key={c.id} className="flex items-center gap-2 text-sm border border-ink/10 rounded-lg px-2.5 py-1.5 cursor-pointer">
                            <input type="checkbox" checked={on} onChange={(e) => toggleAssign(s.id, c.id, e.target.checked)} />
                            {c.full_name || c.email}
                          </label>
                        );
                      })}
                      {crew.length === 0 && <div className="text-ink/40 text-sm">No approved crew yet.</div>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    {s.status === "cancelled"
                      ? <Btn variant="ghost" onClick={() => reactivateShift(s)}><Check className="w-4 h-4" /> Reactivate</Btn>
                      : <Btn variant="ghost" onClick={() => cancelShift(s)}><Ban className="w-4 h-4" /> Cancel shift</Btn>}
                    <button className="text-red-600 text-sm flex items-center gap-1 ml-auto" onClick={() => delShift(s.id)}><Trash2 className="w-4 h-4" /> Delete</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

const inp = "w-full border border-ink/20 rounded-lg px-3 py-2 outline-none focus:border-ink";
function Field({ label, children }) {
  return <label className="block"><span className="text-xs font-bold uppercase tracking-wide text-ink/50">{label}</span><div className="mt-1">{children}</div></label>;
}

/* ------------------------------------------------------------------ */
/*  Shared empty state + simple placeholder screens                    */
/* ------------------------------------------------------------------ */
function Empty({ icon: Icon, title, body }) {
  return (
    <Card className="p-10 text-center">
      <Icon className="w-10 h-10 text-ink/30 mx-auto" />
      <div className="font-display font-extrabold text-xl mt-3">{title}</div>
      <p className="text-ink/60 mt-1 max-w-sm mx-auto">{body}</p>
    </Card>
  );
}

function ComingSoon({ title, body }) {
  return <Empty icon={Loader2} title={title} body={body || "This screen is being wired up in the next update."} />;
}

function SetPasswordBanner({ profile, onDone }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr("");
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) { setErr(error.message); setBusy(false); return; }
    await supabase.from("profiles").update({ has_password: true }).eq("id", profile.id);
    setBusy(false);
    await onDone();
  }
  return (
    <div className="bg-canary text-ink">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" /> Set a password so next time you can just log straight in.</div>
        {open ? (
          <form onSubmit={save} className="flex items-center gap-2">
            <input type="email" value={profile.email || ""} autoComplete="username" readOnly className="hidden" />
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 6)"
              className="rounded-lg px-3 py-1.5 text-ink outline-none border border-ink/20" />
            <Btn type="submit" variant="primary" disabled={busy || pw.length < 6}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Btn>
            {err && <span className="text-xs text-red-700 font-semibold">{err}</span>}
          </form>
        ) : (
          <button onClick={() => setOpen(true)} className="text-sm font-bold underline">Set it now</button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal + Ask a question                                             */
/* ------------------------------------------------------------------ */
function Modal({ title, children, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-md w-full p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <div className="font-display font-extrabold text-lg">{title}</div>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function AskQuestion({ event, profile, onClose }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await supabase.from("shift_questions").insert({ event_id: event.id, crew_id: profile.id, body: body.trim() });
    setBusy(false); setSent(true);
  }
  return (
    <Modal title={`Question about ${event.name}`} onClose={onClose}>
      {sent ? (
        <div className="text-center py-3">
          <Check className="w-8 h-8 text-forest mx-auto" />
          <p className="mt-2 text-ink/70">Sent! A manager will see it on their dashboard and get back to you.</p>
          <Btn variant="ghost" onClick={onClose} className="mt-3">Close</Btn>
        </div>
      ) : (
        <form onSubmit={submit}>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4}
            placeholder="What would you like to ask about this event or your shift?" className={inp} />
          <div className="flex gap-2 mt-3">
            <Btn type="submit" variant="canary" disabled={busy || !body.trim()}><Send className="w-4 h-4" /> Send question</Btn>
            <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/*  CREW: Reimbursements (submit + receipt upload)                     */
/* ------------------------------------------------------------------ */
function CrewReimbursements({ profile }) {
  const [rows, setRows] = useState(null);
  const [amount, setAmount] = useState("");
  const [desc, setDesc] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const { data } = await supabase.from("reimbursements").select("*").eq("submitted_by", profile.id).order("created_at", { ascending: false });
    setRows(data || []);
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    let receipt_path = null;
    if (file) {
      const path = `${profile.id}/${Date.now()}-${file.name}`;
      const { error } = await supabase.storage.from("receipts").upload(path, file);
      if (!error) receipt_path = path;
    }
    await supabase.from("reimbursements").insert({ submitted_by: profile.id, amount: Number(amount), description: desc, receipt_path });
    setAmount(""); setDesc(""); setFile(null); setBusy(false); await load();
  }
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4">
      <h1 className="font-display font-black text-3xl">Reimbursements</h1>
      <Card className="p-5">
        <div className="font-bold text-lg mb-2">Submit a reimbursement</div>
        <form onSubmit={submit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount ($)"><input type="number" step="0.01" className={inp} value={amount} onChange={(e) => setAmount(e.target.value)} required /></Field>
            <Field label="What for?"><input className={inp} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="parking, supplies…" /></Field>
          </div>
          <div>
            <span className="text-xs font-bold uppercase tracking-wide text-ink/50">Receipt</span>
            <label className="mt-1 flex items-center gap-3 cursor-pointer">
              <span className="inline-flex items-center gap-2 font-semibold rounded-xl px-4 py-2.5 bg-ink/5 border border-ink/15"><Upload className="w-4 h-4" /> {file ? "Change file" : "Upload receipt"}</span>
              <span className="text-sm text-ink/60">{file ? file.name : "photo or PDF"}</span>
              <input type="file" className="hidden" onChange={(e) => setFile(e.target.files[0])} />
            </label>
          </div>
          <Btn type="submit" variant="canary" disabled={busy || !amount}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Receipt className="w-4 h-4" /> Submit request</>}</Btn>
        </form>
      </Card>
      {rows.length > 0 && (
        <Card className="p-5">
          <div className="font-bold text-lg mb-2">Your requests</div>
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.id} className="flex items-center justify-between border-t border-ink/8 pt-2">
                <div><div className="font-bold">{money(r.amount)}</div><div className="text-sm text-ink/60">{r.description || "—"} · {fmtDate(r.created_at)}</div></div>
                <Pill tone={r.status === "paid" ? "green" : r.status === "approved" ? "forest" : r.status === "rejected" ? "red" : "amber"}>{r.status}</Pill>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Reimbursements (approve + receipt download)                 */
/* ------------------------------------------------------------------ */
function AdminReimbursements() {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("reimbursements")
      .select("*, profiles!reimbursements_submitted_by_fkey(full_name,email)").order("created_at", { ascending: false });
    setRows(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function decide(id, status) {
    await supabase.from("reimbursements").update({ status, decided_at: new Date().toISOString() }).eq("id", id);
    await load();
  }
  async function viewReceipt(path) {
    const { data } = await supabase.storage.from("receipts").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  }
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4">
      <h1 className="font-display font-black text-3xl">Reimbursements</h1>
      {rows.length === 0 ? <Empty icon={DollarSign} title="No reimbursements" body="Requests from crew show up here with their receipts." /> :
        rows.map((r) => (
          <Card key={r.id} className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <div className="font-bold">{money(r.amount)} · {r.profiles?.full_name || r.profiles?.email}</div>
                <div className="text-sm text-ink/60">{r.description || "—"} · {fmtDate(r.created_at)}</div>
              </div>
              <div className="flex items-center gap-2">
                {r.receipt_path && <Btn variant="ghost" onClick={() => viewReceipt(r.receipt_path)}><Download className="w-4 h-4" /> Receipt</Btn>}
                <Pill tone={r.status === "paid" ? "green" : r.status === "approved" ? "forest" : r.status === "rejected" ? "red" : "amber"}>{r.status}</Pill>
              </div>
            </div>
            {r.status === "submitted" && (
              <div className="flex gap-2 mt-3">
                <Btn variant="forest" onClick={() => decide(r.id, "approved")}><Check className="w-4 h-4" /> Approve</Btn>
                <Btn variant="ghost" onClick={() => decide(r.id, "paid")}>Mark paid</Btn>
                <Btn variant="ghost" onClick={() => decide(r.id, "rejected")}><X className="w-4 h-4" /></Btn>
              </div>
            )}
            {r.status === "approved" && <div className="mt-3"><Btn variant="forest" onClick={() => decide(r.id, "paid")}>Mark paid</Btn></div>}
          </Card>
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Hours — collect, verify, export CSV                         */
/* ------------------------------------------------------------------ */
function AdminHours() {
  const [rows, setRows] = useState(null);
  const [crew, setCrew] = useState([]);
  const [events, setEvents] = useState([]);
  const [form, setForm] = useState({ crew_id: "", event_id: "", hours: "", rate: "" });
  const [editHours, setEditHours] = useState({});
  const load = useCallback(async () => {
    const [{ data: h }, { data: c }, { data: e }] = await Promise.all([
      supabase.from("hours_entries").select("*, profiles!hours_entries_crew_id_fkey(full_name,email), events(name)").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id,full_name,email").eq("status", "approved").order("full_name"),
      supabase.from("events").select("id,name").order("starts_at", { ascending: false }),
    ]);
    setRows(h || []); setCrew(c || []); setEvents(e || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function verify(r) {
    const hrs = editHours[r.id] != null ? Number(editHours[r.id]) : Number(r.hours || 0);
    const amount = r.rate_applied ? hrs * Number(r.rate_applied) : r.amount;
    await supabase.from("hours_entries").update({ hours: hrs, amount, status: "verified", verified_at: new Date().toISOString() }).eq("id", r.id);
    await load();
  }
  async function addHours(e) {
    e.preventDefault();
    const hrs = Number(form.hours), rate = form.rate ? Number(form.rate) : null;
    await supabase.from("hours_entries").insert({ crew_id: form.crew_id, event_id: form.event_id || null, hours: hrs, rate_applied: rate, amount: rate ? hrs * rate : null, status: "verified", source: "admin", verified_at: new Date().toISOString() });
    setForm({ crew_id: "", event_id: "", hours: "", rate: "" }); await load();
  }
  function exportCsv() {
    const header = ["Crew", "Event", "Hours", "Rate", "Amount", "Status", "Date"];
    const lines = rows.map((r) => [
      (r.profiles?.full_name || r.profiles?.email || "").replace(/,/g, " "),
      (r.events?.name || "").replace(/,/g, " "),
      r.hours || 0, r.rate_applied || "", r.amount || "", r.status, new Date(r.created_at).toLocaleDateString(),
    ].join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "eventshop-timesheet.csv"; a.click(); URL.revokeObjectURL(url);
  }
  if (!rows) return <Spinner />;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="font-display font-black text-3xl">Hours</h1>
        <Btn variant="ghost" onClick={exportCsv}><Download className="w-4 h-4" /> Export timesheet (CSV)</Btn>
      </div>
      <Card className="p-5">
        <div className="font-bold text-lg mb-2">Log hours for a crew member</div>
        <form onSubmit={addHours} className="grid sm:grid-cols-5 gap-2 items-end">
          <div className="sm:col-span-2"><Field label="Crew">
            <select className={inp} value={form.crew_id} onChange={(e) => setForm((p) => ({ ...p, crew_id: e.target.value }))} required>
              <option value="">Select…</option>
              {crew.map((c) => <option key={c.id} value={c.id}>{c.full_name || c.email}</option>)}
            </select></Field></div>
          <div className="sm:col-span-2"><Field label="Event">
            <select className={inp} value={form.event_id} onChange={(e) => setForm((p) => ({ ...p, event_id: e.target.value }))}>
              <option value="">(none)</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select></Field></div>
          <Field label="Hours"><input type="number" step="0.25" className={inp} value={form.hours} onChange={(e) => setForm((p) => ({ ...p, hours: e.target.value }))} required /></Field>
          <div className="sm:col-span-4"><Field label="Rate $/hr (optional)"><input type="number" step="0.01" className={inp} value={form.rate} onChange={(e) => setForm((p) => ({ ...p, rate: e.target.value }))} /></Field></div>
          <Btn type="submit" variant="canary" disabled={!form.crew_id || !form.hours}><Plus className="w-4 h-4" /> Add</Btn>
        </form>
      </Card>
      {rows.map((r) => (
        <Card key={r.id} className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="font-bold">{r.profiles?.full_name || r.profiles?.email} · {r.events?.name || "—"}</div>
            <div className="text-sm text-ink/60">{Number(r.hours || 0).toFixed(2)} hrs{r.amount ? ` · ${money(r.amount)}` : ""} · {fmtDate(r.created_at)}{r.note ? ` · “${r.note}”` : ""}</div>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={r.status === "verified" ? "green" : r.status === "disputed" ? "red" : "amber"}>{r.status}</Pill>
            {r.status !== "verified" && (
              <>
                <input type="number" step="0.25" defaultValue={r.hours || ""} onChange={(e) => setEditHours((p) => ({ ...p, [r.id]: e.target.value }))}
                  className="w-20 border border-ink/20 rounded-lg px-2 py-1.5" placeholder="hrs" />
                <Btn variant="forest" onClick={() => verify(r)}><Check className="w-4 h-4" /> Verify</Btn>
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Broadcast                                                   */
/* ------------------------------------------------------------------ */
function AdminBroadcast() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [recent, setRecent] = useState([]);
  const load = useCallback(async () => {
    const [{ data: e }, { data: b }] = await Promise.all([
      supabase.from("events").select("id,name").eq("status", "published").order("starts_at", { ascending: false }),
      supabase.from("broadcasts").select("*, events(name)").order("created_at", { ascending: false }).limit(10),
    ]);
    setEvents(e || []); setRecent(b || []);
  }, []);
  useEffect(() => { load(); }, [load]);
  async function send(e) {
    e.preventDefault();
    setBusy(true);
    await supabase.from("broadcasts").insert({ event_id: eventId || null, sender_id: null, body: body.trim() });
    setBody(""); setBusy(false); setSent(true); setTimeout(() => setSent(false), 2000); await load();
  }
  return (
    <div className="space-y-4">
      <h1 className="font-display font-black text-3xl">Broadcast</h1>
      <Card className="p-5">
        <div className="font-bold text-lg mb-2">Message your crew</div>
        <form onSubmit={send} className="space-y-3">
          <Field label="Event (who sees it)">
            <select className={inp} value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">All crew on any event</option>
              {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </Field>
          <Field label="Message"><textarea className={inp} rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="e.g. Gates moved to Lot C — arrive by 4pm." /></Field>
          <div className="flex items-center gap-3">
            <Btn type="submit" variant="canary" disabled={busy || !body.trim()}><Megaphone className="w-4 h-4" /> Send broadcast</Btn>
            {sent && <span className="text-forest font-semibold flex items-center gap-1"><Check className="w-4 h-4" /> Sent</span>}
          </div>
        </form>
      </Card>
      {recent.length > 0 && (
        <Card className="p-5">
          <div className="font-bold text-lg mb-2">Recent broadcasts</div>
          <div className="space-y-2">
            {recent.map((b) => (
              <div key={b.id} className="border-t border-ink/8 pt-2">
                <div className="text-sm">{b.body}</div>
                <div className="text-xs text-ink/50">{b.events?.name || "All events"} · {fmtDate(b.created_at)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ADMIN: Roster QR                                                   */
/* ------------------------------------------------------------------ */
function RosterQR() {
  const [dataUrl, setDataUrl] = useState("");
  const joinUrl = window.location.origin + "/?join=1";
  useEffect(() => {
    QRCode.toDataURL(joinUrl, { width: 320, margin: 2, color: { dark: "#0B0B0B", light: "#ffffff" } }).then(setDataUrl).catch(() => {});
  }, [joinUrl]);
  return (
    <div className="space-y-4 max-w-md">
      <h1 className="font-display font-black text-3xl">Roster QR</h1>
      <Card className="p-6 text-center">
        <p className="text-ink/60 text-sm mb-3">New hires scan this to request a spot on your roster. Print it or show it on your phone.</p>
        {dataUrl ? <img src={dataUrl} alt="Roster QR code" className="mx-auto rounded-xl border border-ink/10" /> : <Spinner />}
        <div className="mt-3 text-sm break-all text-ink/50">{joinUrl}</div>
        {dataUrl && <a href={dataUrl} download="eventshop-roster-qr.png" className="inline-block mt-3"><Btn variant="canary"><Download className="w-4 h-4" /> Download QR</Btn></a>}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PUBLIC: Join the crew (no login, reached from the QR)              */
/* ------------------------------------------------------------------ */
function PublicJoin() {
  const [f, setF] = useState({ full_name: "", email: "", phone: "", message: "" });
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    await supabase.from("onboarding_requests").insert(f);
    setBusy(false); setSent(true);
  }
  return (
    <div className="max-w-md mx-auto px-4 py-10">
      <Hero />
      <Card className="p-6">
        {sent ? (
          <div className="text-center py-4">
            <Check className="w-10 h-10 text-forest mx-auto" />
            <h2 className="font-display font-extrabold text-2xl mt-3">Request sent!</h2>
            <p className="text-ink/70 mt-2">Thanks, {f.full_name || "there"}. EventShop will be in touch about getting you on the crew.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <h2 className="font-display font-extrabold text-2xl">Join the crew</h2>
            <p className="text-ink/60">Tell us a bit about you and we'll get you set up.</p>
            <Field label="Full name"><input className={inp} value={f.full_name} onChange={(e) => set("full_name", e.target.value)} required /></Field>
            <Field label="Email"><input type="email" className={inp} value={f.email} onChange={(e) => set("email", e.target.value)} required /></Field>
            <Field label="Phone"><input className={inp} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
            <Field label="Anything else? (optional)"><textarea className={inp} rows={3} value={f.message} onChange={(e) => set("message", e.target.value)} /></Field>
            <Btn type="submit" variant="canary" disabled={busy || !f.full_name || !f.email} className="w-full">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send my request"}</Btn>
          </form>
        )}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Navigation shell                                                   */
/* ------------------------------------------------------------------ */
const CREW_NAV = [
  { key: "shifts", label: "Shifts", icon: Calendar },
  { key: "hours", label: "My Hours", icon: Clock },
  { key: "docs", label: "Documents", icon: FileText },
  { key: "reimb", label: "Reimburse", icon: DollarSign },
];
const ADMIN_NAV = [
  { key: "admin-home", label: "Dashboard", icon: LayoutDashboard },
  { key: "events", label: "Events", icon: Calendar },
  { key: "hours", label: "Hours", icon: Clock },
  { key: "roster", label: "Roster", icon: Users },
  { key: "reimb", label: "Reimburse", icon: DollarSign },
  { key: "broadcast", label: "Broadcast", icon: Radio },
  { key: "settings", label: "Settings", icon: Settings },
];

function Nav({ items, view, onNav }) {
  return (
    <nav className="bg-white border-b border-ink/10 sticky top-[68px] z-10">
      <div className="max-w-6xl mx-auto px-2 flex gap-1 overflow-x-auto">
        {items.map((it) => (
          <button key={it.key} onClick={() => onNav(it.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap border-b-2 transition ${view === it.key ? "border-canary text-ink" : "border-transparent text-ink/50 hover:text-ink"}`}>
            <it.icon className="w-4 h-4" /> {it.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/*  Root app                                                           */
/* ------------------------------------------------------------------ */
function App() {
  const { session, profile, loading, reloadProfile } = useAuth();
  const [view, setView] = useState("shifts");

  useEffect(() => {
    if (profile?.role === "admin") setView("admin-home");
    else setView("shifts");
  }, [profile?.role]);

  const isJoin = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("join");

  if (!IS_CONFIGURED) return <NotConfigured />;
  if (isJoin) return <PublicJoin />;
  if (loading) return <div className="pt-20"><Spinner /></div>;
  if (!session) return <SignIn />;
  if (!profile) return <div className="pt-20"><Spinner label="Setting up your profile…" /></div>;
  if (profile.status !== "approved") return <AccessGate profile={profile} onSignOut={() => supabase.auth.signOut()} onApproved={reloadProfile} />;

  const isAdmin = profile.role === "admin";
  const nav = isAdmin ? ADMIN_NAV : CREW_NAV;

  function render() {
    switch (view) {
      case "shifts": return <ShiftBoard profile={profile} />;
      case "hours": return isAdmin ? <AdminHours /> : <MyHours profile={profile} />;
      case "docs": return <MyDocuments profile={profile} />;
      case "reimb": return isAdmin ? <AdminReimbursements /> : <CrewReimbursements profile={profile} />;
      case "admin-home": return <AdminHome profile={profile} onNav={setView} />;
      case "events": return <ManageEvents />;
      case "roster": return <Roster />;
      case "broadcast": return <AdminBroadcast />;
      case "settings": return <AdminSettings />;
      case "qr": return <RosterQR />;
      default: return <ShiftBoard profile={profile} />;
    }
  }

  return (
    <div className="min-h-full bg-neutral-50">
      {!profile.has_password && <SetPasswordBanner profile={profile} onDone={reloadProfile} />}
      <Header profile={profile} onSignOut={() => supabase.auth.signOut()} onNav={setView} />
      <Nav items={nav} view={view} onNav={setView} />
      <main className="max-w-6xl mx-auto px-4 py-6">{render()}</main>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
