import React, { useEffect, useState, useCallback } from "react";
import { supabaseReady, missingEnv } from "./supabaseClient";
import { listEvents, createEvent, deleteEvent } from "./db";
import Clearings from "./Clearings.jsx";

/* Hash routing keeps this a plain static site — no server rewrite rules on
   any host. A poll lives at:  https://your-site/#/e/<roomId>
   The bare URL (no hash) is the group home page listing every poll. */
function parseRoom() {
  const m = window.location.hash.match(/#\/e\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export default function App() {
  const [room, setRoom] = useState(parseRoom);

  useEffect(() => {
    const on = () => setRoom(parseRoom());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (!supabaseReady) return <Shell><SetupNotice /></Shell>;
  if (!room) return <Shell><Home /></Shell>;
  return <Clearings key={room} roomId={room} />;
}

/* ---------------- home page: list of polls ---------------- */
function Home() {
  const [events, setEvents] = useState(null); // null = loading
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  const load = useCallback(async () => {
    try { setEvents(await listEvents()); }
    catch (e) { console.error(e); setEvents([]); }
  }, []);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  async function create() {
    if (busy) return;
    setBusy(true);
    try {
      const ev = await createEvent(name);
      window.location.hash = `#/e/${ev.id}`;
    } catch (e) {
      console.error(e);
      alert("Couldn't create the poll. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    try { await deleteEvent(id); } catch (e) { console.error(e); }
    setConfirmId(null);
    load();
  }

  return (
    <div className="lp">
      <div className="lp-eyebrow">Shared availability</div>
      <h1 className="lp-title">Clearings</h1>
      <p className="lp-lede">
        Your group's availability polls. Everyone blocks the times they <b>can't</b> make; the app finds the openings.
      </p>

      <div className="lp-create">
        <input
          className="lp-input"
          placeholder="New poll name — e.g. September, Nov–Dec offsite"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
        />
        <button className="lp-btn" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create poll"}</button>
      </div>

      <div className="lp-listhead">Polls</div>

      {events === null ? (
        <div className="lp-muted">Loading…</div>
      ) : events.length === 0 ? (
        <div className="lp-empty">
          No polls yet. Name one above and hit <b>Create poll</b> to get started.
        </div>
      ) : (
        <ul className="lp-list">
          {events.map((ev) => (
            <li key={ev.id} className="lp-item">
              <a className="lp-item-main" href={`#/e/${ev.id}`}>
                <span className="lp-item-title">{ev.config?.title || "Untitled availability"}</span>
                <span className="lp-item-sub mono">{fmtRange(ev.config)} · created {fmtCreated(ev.created_at)}</span>
              </a>
              {confirmId === ev.id ? (
                <span className="lp-confirm">
                  Delete?
                  <button className="lp-link danger" onClick={() => remove(ev.id)}>yes</button>
                  <button className="lp-link" onClick={() => setConfirmId(null)}>no</button>
                </span>
              ) : (
                <button className="lp-item-x" title="Delete poll" onClick={() => setConfirmId(ev.id)}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <p className="lp-note">
        Bookmark this page and share it with your group — anyone with the link can open any poll or make a new one.
      </p>
    </div>
  );
}

/* ---------------- setup notice (env not configured) ---------------- */
function SetupNotice() {
  return (
    <div className="lp">
      <div className="lp-eyebrow">Finish setup</div>
      <h1 className="lp-title">Almost there</h1>
      <p className="lp-lede">
        The app needs your Supabase keys before it can store anything. It looks like{" "}
        {missingEnv.length ? missingEnv.join(" and ") : "the environment variables"} {missingEnv.length === 1 ? "is" : "are"} missing.
      </p>
      <ol className="lp-how">
        <li>Create a free project at <span className="mono">supabase.com</span>.</li>
        <li>Run <span className="mono">supabase/schema.sql</span> in the SQL Editor.</li>
        <li>Copy <span className="mono">.env.example</span> to <span className="mono">.env</span> and paste in your Project URL and anon key.</li>
        <li>Restart the dev server (or set the two variables in your host's dashboard).</li>
      </ol>
      <p className="lp-note">Full walkthrough is in <span className="mono">README.md</span>.</p>
    </div>
  );
}

/* ---------------- shared shell + styles ---------------- */
function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 20px" }}>
      <HomeStyle />
      <div style={{ width: "100%", maxWidth: 560 }}>{children}</div>
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function parseISO(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function addDays(iso, n) { const dt = parseISO(iso); dt.setDate(dt.getDate() + n); const y = dt.getFullYear(); const m = String(dt.getMonth() + 1).padStart(2, "0"); const d = String(dt.getDate()).padStart(2, "0"); return `${y}-${m}-${d}`; }
function fmtRange(cfg) {
  if (!cfg?.startDate) return "";
  const s = parseISO(cfg.startDate);
  const e = parseISO(addDays(cfg.startDate, (cfg.numDays || 1) - 1));
  return `${MON[s.getMonth()]} ${s.getDate()} – ${MON[e.getMonth()]} ${e.getDate()}, ${e.getFullYear()}`;
}
function fmtCreated(ts) {
  try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; }
}

function HomeStyle() {
  return (
    <style>{`
    .lp{background:#fff; border:1px solid #d3d8de; border-radius:18px; padding:34px 32px;
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#14161c;}
    .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;}
    .lp-eyebrow{font-family:ui-monospace,Menlo,monospace; font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:#6b7280;}
    .lp-title{font-size:32px; font-weight:780; letter-spacing:-.02em; margin:6px 0 12px;}
    .lp-lede{font-size:15px; line-height:1.6; color:#3a3f47; margin:0 0 22px;} .lp-lede b{color:#14161c;}
    .lp-create{display:flex; gap:8px; margin-bottom:26px;}
    .lp-input{flex:1; font-size:14px; padding:10px 12px; border:1px solid #d3d8de; border-radius:10px; color:#14161c;}
    .lp-input:focus{outline:none; border-color:#3b3ae0; box-shadow:0 0 0 3px #e9e9fb;}
    .lp-btn{font-size:14px; font-weight:650; padding:10px 18px; border:none; border-radius:10px; background:#3b3ae0; color:#fff; cursor:pointer; white-space:nowrap;}
    .lp-btn:hover{background:#2f2ed0;} .lp-btn:disabled{opacity:.5; cursor:default;}
    .lp-listhead{font-family:ui-monospace,Menlo,monospace; font-size:11px; letter-spacing:.14em; text-transform:uppercase; color:#6b7280; margin-bottom:10px;}
    .lp-muted{color:#6b7280; font-size:14px; padding:8px 0;}
    .lp-empty{border:1px dashed #d3d8de; border-radius:12px; padding:24px; text-align:center; color:#6b7280; font-size:14px;}
    .lp-list{list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:7px;}
    .lp-item{display:flex; align-items:center; gap:10px; border:1px solid #e5e8ec; border-radius:12px; padding:4px 6px 4px 4px;}
    .lp-item:hover{border-color:#c7c7f5;}
    .lp-item-main{flex:1; display:flex; flex-direction:column; gap:2px; text-decoration:none; color:inherit; padding:10px 12px; border-radius:9px;}
    .lp-item-main:hover{background:#f6f5fd;}
    .lp-item-title{font-size:15px; font-weight:650;}
    .lp-item-sub{font-size:12px; color:#6b7280;}
    .lp-item-x{border:none; background:none; color:#9aa0a8; font-size:20px; line-height:1; cursor:pointer; padding:6px 12px; border-radius:8px;}
    .lp-item-x:hover{color:#c0392b; background:#faeceb;}
    .lp-confirm{display:flex; align-items:center; gap:8px; font-size:13px; color:#14161c; padding-right:8px;}
    .lp-link{border:none; background:none; color:#3b3ae0; cursor:pointer; font:inherit; text-decoration:underline; text-underline-offset:2px; padding:0;}
    .lp-link.danger{color:#c0392b;}
    .lp-note{font-size:13px; color:#6b7280; line-height:1.55; margin:22px 0 0; padding-top:18px; border-top:1px solid #e5e8ec;}
    .lp-how{margin:20px 0 0; padding:0 0 0 20px; color:#3a3f47; font-size:14px; line-height:1.7;} .lp-how b{color:#14161c;}
    @media (max-width:520px){ .lp-create{flex-direction:column;} }
    `}</style>
  );
}
