import { useState, useEffect, useCallback } from "react";
import { createRoot } from "react-dom/client";
import {
  Calendar, Clock, FileText, DollarSign, Users, Radio, LayoutDashboard,
  LogOut, Upload, Check, X, Plus, QrCode, ShieldCheck, AlertCircle,
  MapPin, ChevronRight, Loader2, Megaphone, UserPlus, Download, Trash2, Settings, KeyRound, Mail,
} from "lucide-react";
import { supabase } from "./supabaseClient.js";
import { IS_CONFIGURED, ADMIN_EMAIL } from "./config.js";

/* ------------------------------------------------------------------ */
/*  Small helpers                                                      */
/* ------------------------------------------------------------------ */
const fmtDate = (s) =>
  s ? new Date(s).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";
const fmtTime = (s) =>
  s ? new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "";
const money = (n) => (n == null ? "—" : `$${Number(n).toFixed(2)}`);

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
/*  CREW: Shift board                                                  */
/* ------------------------------------------------------------------ */
function ShiftBoard({ profile }) {
  const [rows, setRows] = useState(null);
  const [claims, setClaims] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    const { data: events } = await supabase
      .from("events").select("*, shifts(*)")
      .eq("status", "published").order("starts_at");
    setRows(events || []);
    const { data: myClaims } = await supabase.from("claims").select("*").eq("crew_id", profile.id);
    const map = {}; (myClaims || []).forEach((c) => { map[c.shift_id] = c; });
    setClaims(map);
  }, [profile.id]);

  useEffect(() => { load(); }, [load]);

  async function claim(shift) {
    setBusyId(shift.id);
    await supabase.from("claims").insert({ shift_id: shift.id, crew_id: profile.id, status: "claimed" });
    await load(); setBusyId(null);
  }
  async function drop(shift) {
    setBusyId(shift.id);
    const c = claims[shift.id];
    if (c) await supabase.from("claims").update({ status: "dropped" }).eq("id", c.id);
    await load(); setBusyId(null);
  }

  if (!rows) return <Spinner label="Loading shifts…" />;
  if (rows.length === 0)
    return <Empty icon={Calendar} title="No shifts posted yet" body="Check back soon — new events show up here as they're scheduled." />;

  return (
    <div className="space-y-5">
      {rows.map((ev) => (
        <Card key={ev.id} className="overflow-hidden">
          <div className="bg-ink text-white px-5 py-3 flex items-center justify-between">
            <div>
              <div className="font-display font-extrabold text-xl">{ev.name}</div>
              <div className="text-white/70 text-sm flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5" /> {ev.venue || "TBD"} · {fmtDate(ev.starts_at)}
              </div>
            </div>
            {ev.is_public && <Pill tone="canary">Public</Pill>}
          </div>
          <div className="divide-y divide-ink/8">
            {(ev.shifts || []).map((s) => {
              const mine = claims[s.id];
              const active = mine && mine.status !== "dropped";
              return (
                <div key={s.id} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold">{s.role_title}</div>
                    <div className="text-sm text-ink/60">
                      {fmtTime(s.starts_at)}–{fmtTime(s.ends_at)} · {money(s.public_rate)}/hr · {s.slots} needed
                    </div>
                  </div>
                  {active ? (
                    <div className="flex items-center gap-2">
                      <Pill tone="green">{mine.status}</Pill>
                      <Btn variant="ghost" disabled={busyId === s.id} onClick={() => drop(s)}>Drop</Btn>
                    </div>
                  ) : (
                    <Btn variant="canary" disabled={busyId === s.id} onClick={() => claim(s)}>
                      {busyId === s.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Claim <ChevronRight className="w-4 h-4" /></>}
                    </Btn>
                  )}
                </div>
              );
            })}
            {(ev.shifts || []).length === 0 && <div className="px-5 py-4 text-ink/50 text-sm">No shifts on this event yet.</div>}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  CREW: My hours                                                     */
/* ------------------------------------------------------------------ */
function MyHours({ profile }) {
  const [rows, setRows] = useState(null);
  const load = useCallback(async () => {
    const { data } = await supabase.from("hours_entries")
      .select("*, events(name)").eq("crew_id", profile.id).order("created_at", { ascending: false });
    setRows(data || []);
  }, [profile.id]);
  useEffect(() => { load(); }, [load]);

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
      {rows.length === 0 ? (
        <Empty icon={Clock} title="No hours yet" body="After you work an event, confirm your hours here and they'll be sent for verification." />
      ) : rows.map((r) => (
        <Card key={r.id} className="p-4 flex items-center justify-between">
          <div>
            <div className="font-bold">{r.events?.name || "Event"}</div>
            <div className="text-sm text-ink/60">{fmtDate(r.created_at)} · {Number(r.hours || 0).toFixed(1)} hrs</div>
          </div>
          <Pill tone={r.status === "verified" ? "green" : r.status === "disputed" ? "red" : "amber"}>{r.status}</Pill>
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
          <p>Your documents upload to a private, encrypted store only EventShop managers can open. They're never shared, and are deleted from the server once a manager downloads them.</p>
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
  useEffect(() => {
    (async () => {
      const [pend, reimb, onboard, events] = await Promise.all([
        supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("reimbursements").select("id", { count: "exact", head: true }).eq("status", "submitted"),
        supabase.from("onboarding_requests").select("id", { count: "exact", head: true }).eq("status", "new"),
        supabase.from("events").select("id", { count: "exact", head: true }).eq("status", "published"),
      ]);
      setStats({ pend: pend.count || 0, reimb: reimb.count || 0, onboard: onboard.count || 0, events: events.count || 0 });
    })();
  }, []);

  const tiles = [
    { key: "roster", label: "Access requests", value: stats?.pend, icon: UserPlus, tone: "canary" },
    { key: "reimb", label: "Reimbursements", value: stats?.reimb, icon: DollarSign, tone: "forest" },
    { key: "roster", label: "New roster requests", value: stats?.onboard, icon: QrCode, tone: "canary" },
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
  const [shifts, setShifts] = useState(event.shifts || []);
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

  async function addShift() {
    if (!event.id) { alert("Save the event first, then add shifts."); return; }
    const s = { event_id: event.id, role_title: "New role", slots: 1, public_rate: null, private_rate: null };
    const { data } = await supabase.from("shifts").insert(s).select().single();
    setShifts((p) => [...p, data]);
  }
  async function updShift(id, patch) {
    setShifts((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    await supabase.from("shifts").update(patch).eq("id", id);
  }
  async function delShift(id) {
    setShifts((p) => p.filter((s) => s.id !== id));
    await supabase.from("shifts").delete().eq("id", id);
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

      {event.id && (
        <Card className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="font-bold text-lg">Shifts & rates</div>
            <Btn variant="ghost" onClick={addShift}><Plus className="w-4 h-4" /> Add shift</Btn>
          </div>
          <div className="space-y-2">
            {shifts.map((s) => (
              <div key={s.id} className="grid grid-cols-12 gap-2 items-center">
                <input className={`${inp} col-span-4`} value={s.role_title || ""} placeholder="Role" onChange={(e) => updShift(s.id, { role_title: e.target.value })} />
                <input className={`${inp} col-span-2`} type="number" value={s.slots || 1} placeholder="#" onChange={(e) => updShift(s.id, { slots: Number(e.target.value) })} />
                <input className={`${inp} col-span-2`} type="number" step="0.01" value={s.public_rate ?? ""} placeholder="Public $" onChange={(e) => updShift(s.id, { public_rate: e.target.value ? Number(e.target.value) : null })} />
                <input className={`${inp} col-span-2`} type="number" step="0.01" value={s.private_rate ?? ""} placeholder="Private $" onChange={(e) => updShift(s.id, { private_rate: e.target.value ? Number(e.target.value) : null })} />
                <button className="col-span-2 text-red-600 flex justify-center" onClick={() => delShift(s.id)}><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            {shifts.length === 0 && <div className="text-ink/50 text-sm">No shifts yet — add one above.</div>}
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <Btn variant="primary" onClick={() => onSave(f)}>Save event</Btn>
        <Btn variant="ghost" onClick={onCancel}>Cancel</Btn>
      </div>
    </div>
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
    <div className="bg-forest text-white">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-sm font-semibold flex items-center gap-2"><KeyRound className="w-4 h-4" /> Set a password so next time you can just log straight in.</div>
        {open ? (
          <form onSubmit={save} className="flex items-center gap-2">
            <input type="email" value={profile.email || ""} autoComplete="username" readOnly className="hidden" />
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="New password (min 6)"
              className="rounded-lg px-3 py-1.5 text-ink outline-none" />
            <Btn type="submit" variant="canary" disabled={busy || pw.length < 6}>{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}</Btn>
            {err && <span className="text-xs text-canary">{err}</span>}
          </form>
        ) : (
          <button onClick={() => setOpen(true)} className="text-sm font-bold underline">Set it now</button>
        )}
      </div>
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

  if (!IS_CONFIGURED) return <NotConfigured />;
  if (loading) return <div className="pt-20"><Spinner /></div>;
  if (!session) return <SignIn />;
  if (!profile) return <div className="pt-20"><Spinner label="Setting up your profile…" /></div>;
  if (profile.status !== "approved") return <AccessGate profile={profile} onSignOut={() => supabase.auth.signOut()} onApproved={reloadProfile} />;

  const isAdmin = profile.role === "admin";
  const nav = isAdmin ? ADMIN_NAV : CREW_NAV;

  function render() {
    switch (view) {
      case "shifts": return <ShiftBoard profile={profile} />;
      case "hours": return isAdmin ? <ComingSoon title="Collect & verify hours" /> : <MyHours profile={profile} />;
      case "docs": return <MyDocuments profile={profile} />;
      case "reimb": return <ComingSoon title="Reimbursements" body="Submit receipts and track approvals — arriving in the next update." />;
      case "admin-home": return <AdminHome profile={profile} onNav={setView} />;
      case "events": return <ManageEvents />;
      case "roster": return <Roster />;
      case "broadcast": return <ComingSoon title="Broadcast to crew" />;
      case "settings": return <AdminSettings />;
      case "qr": return <ComingSoon title="Roster QR code" />;
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
