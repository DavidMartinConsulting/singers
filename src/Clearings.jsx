import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  getOrCreateEvent,
  listParticipants,
  upsertParticipant,
  deleteParticipant,
  saveConfig as dbSaveConfig,
  resetRoom,
  subscribeRoom,
  defaultConfig,
} from "./db";

/* ------------------------------------------------------------------ */
/*  Clearings — the inverse of When2Meet.                              */
/*  Everyone carves out the times they're BLOCKED; the Find view       */
/*  surfaces the openings where the group is free.                     */
/* ------------------------------------------------------------------ */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DOW1 = ["S", "M", "T", "W", "T", "F", "S"];
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ---------- date + time helpers (timezone-safe, local) ---------- */
function toISO(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function parseISO(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(iso, n) {
  const dt = parseISO(iso);
  dt.setDate(dt.getDate() + n);
  return toISO(dt);
}
function dowOf(iso) {
  return parseISO(iso).getDay();
}
function fmtDay(iso) {
  const dt = parseISO(iso);
  return `${DOW[dt.getDay()]} · ${MON[dt.getMonth()]} ${dt.getDate()}`;
}
function fmtTime(min) {
  let h = Math.floor(min / 60);
  const m = min % 60;
  const ap = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, "0")} ${ap}`;
}
function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "p_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/* ---------- per-room identity, stored on this device ---------- */
function loadMe(roomId) {
  try { return JSON.parse(localStorage.getItem("clearings:me:" + roomId) || "null"); } catch { return null; }
}
function saveMe(roomId, me) {
  try {
    if (me) localStorage.setItem("clearings:me:" + roomId, JSON.stringify(me));
    else localStorage.removeItem("clearings:me:" + roomId);
  } catch { /* private mode */ }
}

/* ---------- heat colour: 0% busy (clay) -> 100% free (green) ---------- */
function heat(pct) {
  const hue = 6 + pct * (140 - 6);
  const sat = 62 - pct * 14;
  const light = 84 - pct * 26;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

export default function Clearings({ roomId }) {
  const [booted, setBooted] = useState(false);
  const [config, setConfig] = useState(defaultConfig());
  const [people, setPeople] = useState([]);
  const [me, setMe] = useState(null);
  const [myBlocked, setMyBlocked] = useState(() => new Set());
  const [tab, setTab] = useState("block");
  const [showSettings, setShowSettings] = useState(false);
  const [showWho, setShowWho] = useState(false);
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const [nameDraft, setNameDraft] = useState("");
  const [showOthers, setShowOthers] = useState(true);
  const [copied, setCopied] = useState(false);
  const [viewSize, setViewSize] = useState(14); // days visible in the block grid at once
  const [viewStart, setViewStart] = useState(0); // index into `days` of the leftmost visible day
  const [showBulk, setShowBulk] = useState(false);

  const paintingRef = useRef(false);
  const paintModeRef = useRef("add");
  const saveTimer = useRef(null);
  const firstLoad = useRef(true);
  const meRef = useRef(null);
  const myBlockedRef = useRef(new Set());

  useEffect(() => { meRef.current = me; }, [me]);
  useEffect(() => { myBlockedRef.current = myBlocked; }, [myBlocked]);

  /* keep my own live selection visible in the aggregate even before it saves */
  const mergeMine = useCallback((list) => {
    const meId = meRef.current?.id;
    if (!meId) return list;
    return list.map((p) => (p.id === meId ? { ...p, unavailable: [...myBlockedRef.current] } : p));
  }, []);

  const reload = useCallback(async () => {
    try {
      const [ev, ppl] = await Promise.all([getOrCreateEvent(roomId), listParticipants(roomId)]);
      if (ev?.config) setConfig(ev.config);
      setPeople(mergeMine(ppl));
    } catch (e) { console.error(e); }
  }, [roomId, mergeMine]);

  /* ---------------- initial load + realtime ---------------- */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const savedMe = loadMe(roomId);
        const [ev, ppl] = await Promise.all([getOrCreateEvent(roomId), listParticipants(roomId)]);
        if (!alive) return;
        if (ev?.config) setConfig(ev.config);

        let rec = null;
        if (savedMe) {
          setMe(savedMe);
          meRef.current = savedMe;
          rec = ppl.find((p) => p.id === savedMe.id) || null;
          if (rec) {
            const s = new Set(rec.unavailable);
            setMyBlocked(s);
            myBlockedRef.current = s;
          }
        }
        setPeople(mergeMine(ppl));
      } catch (e) {
        console.error(e);
      } finally {
        firstLoad.current = false;
        if (alive) setBooted(true);
      }
    })();

    const unsub = subscribeRoom(roomId, () => reload());
    const up = () => { paintingRef.current = false; };
    const onFocus = () => reload();
    window.addEventListener("pointerup", up);
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      unsub();
      window.removeEventListener("pointerup", up);
      window.removeEventListener("focus", onFocus);
    };
  }, [roomId, reload, mergeMine]);

  /* ---------------- slot generation ---------------- */
  const slots = useMemo(() => {
    const out = [];
    const step = config.slotMinutes;
    for (let d = 0; d < config.numDays; d++) {
      const iso = addDays(config.startDate, d);
      const dow = dowOf(iso);
      for (let min = config.startHour * 60; min + step <= config.endHour * 60 + 1e-9; min += step) {
        const startMin = Math.round(min);
        out.push({
          key: `${iso}T${String(Math.floor(startMin / 60)).padStart(2, "0")}:${String(startMin % 60).padStart(2, "0")}`,
          iso, dow, startMin, endMin: startMin + step,
        });
      }
    }
    return out;
  }, [config]);

  const days = useMemo(() => {
    const arr = [];
    for (let d = 0; d < config.numDays; d++) arr.push(addDays(config.startDate, d));
    return arr;
  }, [config]);

  /* Paging: the block grid shows a window of `viewSize` days at a time so a
     year-long range stays usable. The full range still lives in `days`/`slots`
     and the Find view searches all of it. */
  const maxStart = Math.max(0, days.length - viewSize);
  const clampedStart = Math.min(viewStart, maxStart);
  const visibleDays = useMemo(
    () => days.slice(clampedStart, clampedStart + viewSize),
    [days, clampedStart, viewSize]
  );
  const todayIndex = useMemo(() => {
    const t = toISO(new Date());
    const i = days.indexOf(t);
    if (i >= 0) return Math.min(i, maxStart);
    return t < config.startDate ? 0 : maxStart;
  }, [days, config.startDate, maxStart]);

  // When the grid definition changes, jump the view to today (or the nearest edge).
  useEffect(() => { setViewStart(todayIndex); }, [config.startDate, config.numDays]); // eslint-disable-line

  const timeRows = useMemo(() => {
    const rows = [];
    const step = config.slotMinutes;
    for (let min = config.startHour * 60; min + step <= config.endHour * 60 + 1e-9; min += step) rows.push(Math.round(min));
    return rows;
  }, [config]);

  const othersCount = useMemo(() => {
    const m = new Map();
    const others = people.filter((p) => !me || p.id !== me.id);
    for (const p of others) for (const k of p.unavailable) m.set(k, (m.get(k) || 0) + 1);
    return { map: m, total: others.length };
  }, [people, me]);

  /* ---------------- saving my row ---------------- */
  const persistMine = useCallback(async (blocked, meRec) => {
    if (!meRec) return;
    setPeople((prev) => {
      const rest = prev.filter((p) => p.id !== meRec.id);
      return [...rest, { id: meRec.id, name: meRec.name, unavailable: [...blocked] }]
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    });
    setSaveState("saving");
    try {
      await upsertParticipant(roomId, { id: meRec.id, name: meRec.name, unavailable: [...blocked] });
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1400);
    } catch (e) {
      console.error(e);
      setSaveState("error");
    }
  }, [roomId]);

  useEffect(() => {
    if (firstLoad.current || !me) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => persistMine(myBlocked, me), 550);
    return () => saveTimer.current && clearTimeout(saveTimer.current);
  }, [myBlocked, me, persistMine]);

  /* ---------------- painting ---------------- */
  const applyCell = useCallback((key, mode) => {
    setMyBlocked((prev) => {
      const n = new Set(prev);
      if (mode === "add") n.add(key); else n.delete(key);
      return n;
    });
  }, []);
  const onCellDown = (key) => {
    const mode = myBlocked.has(key) ? "del" : "add";
    paintModeRef.current = mode;
    paintingRef.current = true;
    applyCell(key, mode);
  };
  const onCellEnter = (key) => { if (paintingRef.current) applyCell(key, paintModeRef.current); };
  const onCellKey = (e, key) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      applyCell(key, myBlocked.has(key) ? "del" : "add");
    }
  };

  /* ---------------- identity ---------------- */
  async function claimName(name, existingId) {
    const id = existingId || uid();
    const rec = { id, name };
    setMe(rec);
    meRef.current = rec;
    saveMe(roomId, rec);
    const existing = people.find((p) => p.id === id);
    const blocked = existing ? new Set(existing.unavailable) : new Set();
    setMyBlocked(blocked);
    myBlockedRef.current = blocked;
    await persistMine(blocked, rec);
  }
  function leave() {
    setMe(null);
    meRef.current = null;
    saveMe(roomId, null);
    setMyBlocked(new Set());
    myBlockedRef.current = new Set();
  }
  async function removePerson(id) {
    try { await deleteParticipant(id); } catch (e) { console.error(e); }
    setPeople((prev) => prev.filter((p) => p.id !== id));
    if (me && me.id === id) leave();
  }

  /* ---------------- config ---------------- */
  async function saveConfig(next) {
    setConfig(next);
    try { await dbSaveConfig(roomId, next); } catch (e) { console.error(e); }
  }
  async function resetAll() {
    try { await resetRoom(roomId); } catch (e) { console.error(e); }
    saveMe(roomId, null);
    setPeople([]); setMe(null); meRef.current = null;
    setMyBlocked(new Set()); myBlockedRef.current = new Set();
    setConfig(defaultConfig());
    setShowSettings(false);
  }

  function copyLink() {
    const url = window.location.href;
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1600); };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done).catch(done);
    else done();
  }

  // Wipe only the current person's marks (their row stays, just emptied).
  function clearMine() {
    if (myBlocked.size === 0) return;
    if (window.confirm("Clear all of your blocked times? This only affects your own marks.")) {
      setMyBlocked(new Set());
    }
  }

  // Go to the group home page (list of all polls, where new ones are created).
  function goHome() {
    window.location.hash = "#/";
  }

  // Apply a batch of slot keys to my selection at once (used by the bulk tool,
  // which can span the whole range regardless of what's on screen).
  function applyBulk(keys, mode) {
    setMyBlocked((prev) => {
      const n = new Set(prev);
      for (const k of keys) { if (mode === "block") n.add(k); else n.delete(k); }
      return n;
    });
  }

  const stats = useMemo(() => {
    const total = people.length;
    let allFree = 0;
    if (total > 0) {
      const sets = people.map((p) => new Set(p.unavailable));
      for (const s of slots) if (!sets.some((set) => set.has(s.key))) allFree++;
    }
    return { total, allFree };
  }, [people, slots]);

  if (!booted) {
    return (
      <div className="cl-root">
        <Style />
        <div className="cl-boot">Loading the calendar…</div>
      </div>
    );
  }

  return (
    <div className="cl-root">
      <Style />

      {/* ---------------- header ---------------- */}
      <header className="cl-head">
        <div className="cl-brand">
          <div className="cl-eyebrow">Shared availability</div>
          <h1 className="cl-title">{config.title}</h1>
          <div className="cl-sub">
            <span className="mono">{stats.total}</span> {stats.total === 1 ? "person" : "people"}
            <span className="cl-dot">•</span>
            <span className="mono">{stats.allFree}</span> slots where everyone's free
          </div>
        </div>
        <div className="cl-headbtns">
          <button className="cl-icon" onClick={goHome} title="Back to all polls">‹ All polls</button>
          <button className="cl-icon primary" onClick={copyLink} title="Copy the link to share">
            {copied ? "Link copied ✓" : "Copy share link"}
          </button>
          <button className="cl-icon" onClick={() => setShowWho((v) => !v)}>Who's in</button>
          <button className="cl-icon" onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </header>

      {showWho && (
        <div className="cl-who">
          {people.length === 0 && <div className="cl-empty-inline">No one's joined yet.</div>}
          {people.map((p) => (
            <span key={p.id} className={"cl-chip" + (me && p.id === me.id ? " is-me" : "")}>
              {p.name}
              {p.unavailable.length > 0 && <b className="mono"> · {p.unavailable.length} blocked</b>}
              <button className="cl-chip-x" title="Remove" onClick={() => removePerson(p.id)}>×</button>
            </span>
          ))}
        </div>
      )}

      {/* ---------------- tabs ---------------- */}
      <nav className="cl-tabs">
        <button className={"cl-tab" + (tab === "block" ? " on" : "")} onClick={() => setTab("block")}>
          Block my times
        </button>
        <button className={"cl-tab" + (tab === "find" ? " on" : "")} onClick={() => setTab("find")}>
          Find open times
        </button>
        {tab === "block" && me && (
          <span className="cl-save mono">
            {saveState === "saving" ? "saving…"
              : saveState === "saved" ? "saved ✓"
              : saveState === "error" ? "save failed — retry"
              : `${myBlocked.size} blocked`}
          </span>
        )}
      </nav>

      {/* ---------------- BLOCK view ---------------- */}
      {tab === "block" && (
        !me ? (
          <NameGate
            people={people}
            nameDraft={nameDraft}
            setNameDraft={setNameDraft}
            onJoin={(n) => claimName(n)}
            onClaim={(p) => claimName(p.name, p.id)}
          />
        ) : (
          <section className="cl-panel">
            <div className="cl-blockbar">
              <p className="cl-help">
                Drag across the grid to shade the times <b>you're not available</b>. Everything you leave blank counts as
                free. Drag over shaded cells again to clear them.
              </p>
              <div className="cl-blockbar-actions">
                <button className={"cl-icon" + (showBulk ? " primary" : "")} onClick={() => setShowBulk((v) => !v)}>
                  Bulk block a range {showBulk ? "▴" : "▾"}
                </button>
                <button className="cl-icon" onClick={clearMine} disabled={myBlocked.size === 0}>
                  Clear my times
                </button>
                <label className="cl-toggle">
                  <input type="checkbox" checked={showOthers} onChange={(e) => setShowOthers(e.target.checked)} />
                  Show others' conflicts
                </label>
              </div>
            </div>

            {showBulk && <BulkEdit config={config} slots={slots} onApply={applyBulk} />}

            <div className="cl-legend">
              <span className="cl-lg"><i className="sw sw-mine" /> you're blocked</span>
              {showOthers && othersCount.total > 0 && (
                <span className="cl-lg"><i className="sw sw-oth" /> others blocked (darker = more)</span>
              )}
              <span className="cl-lg mono" style={{ marginLeft: "auto" }}>
                signed in as {me.name} · <button className="cl-link" onClick={leave}>switch</button>
              </span>
            </div>

            {days.length > viewSize && (
              <div className="cl-gridnav">
                <div className="cl-gridnav-move">
                  <button className="cl-icon" onClick={() => setViewStart((s) => Math.max(0, Math.min(s, maxStart) - viewSize))} disabled={clampedStart <= 0}>‹ Earlier</button>
                  <span className="cl-gridnav-range mono">
                    {fmtDay(visibleDays[0])} – {fmtDay(visibleDays[visibleDays.length - 1])}
                  </span>
                  <button className="cl-icon" onClick={() => setViewStart((s) => Math.min(maxStart, Math.min(s, maxStart) + viewSize))} disabled={clampedStart >= maxStart}>Later ›</button>
                  <button className="cl-icon" onClick={() => setViewStart(todayIndex)}>Today</button>
                </div>
                <div className="cl-gridnav-size">
                  <span className="mono">window:</span>
                  {[7, 14, 30].map((n) => (
                    <button key={n} className={"cl-dow" + (viewSize === n ? " on" : "")} style={{ width: "auto", padding: "0 9px" }} onClick={() => setViewSize(n)}>
                      {n === 7 ? "1w" : n === 14 ? "2w" : "1m"}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="cl-gridwrap" style={{ userSelect: "none" }}>
              <div
                className="cl-grid"
                style={{ gridTemplateColumns: `var(--gutter) repeat(${visibleDays.length}, minmax(56px, 1fr))` }}
              >
                <div className="cl-corner" />
                {visibleDays.map((iso) => {
                  const dt = parseISO(iso);
                  const wk = dt.getDay() === 0 || dt.getDay() === 6;
                  return (
                    <div key={iso} className={"cl-colh mono" + (wk ? " wk" : "")}>
                      <span>{DOW[dt.getDay()]}</span>
                      <b>{dt.getDate()}</b>
                      <span className="cl-mon">{MON[dt.getMonth()]}</span>
                    </div>
                  );
                })}

                {timeRows.map((min) => (
                  <React.Fragment key={min}>
                    <div className="cl-rowh mono">{fmtTime(min)}</div>
                    {visibleDays.map((iso) => {
                      const key = `${iso}T${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
                      const mine = myBlocked.has(key);
                      const oth = showOthers ? othersCount.map.get(key) || 0 : 0;
                      const othStyle =
                        oth > 0 && !mine
                          ? { backgroundColor: `hsl(8 55% ${Math.max(60, 88 - (oth / othersCount.total) * 34)}%)` }
                          : undefined;
                      return (
                        <button
                          key={key}
                          type="button"
                          className={"cl-cell" + (mine ? " mine" : "")}
                          style={othStyle}
                          aria-pressed={mine}
                          aria-label={`${fmtDay(iso)} ${fmtTime(min)} ${mine ? "blocked" : "free"}`}
                          onPointerDown={() => onCellDown(key)}
                          onPointerEnter={() => onCellEnter(key)}
                          onKeyDown={(e) => onCellKey(e, key)}
                        >
                          {oth > 0 && !mine && <span className="cl-othn mono">{oth}</span>}
                        </button>
                      );
                    })}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </section>
        )
      )}

      {/* ---------------- FIND view ---------------- */}
      {tab === "find" && <FindView slots={slots} people={people} config={config} />}

      {/* ---------------- settings ---------------- */}
      {showSettings && (
        <SettingsModal
          config={config}
          people={people}
          onSave={saveConfig}
          onClose={() => setShowSettings(false)}
          onRemove={removePerson}
          onReset={resetAll}
          onNewPoll={goHome}
        />
      )}
    </div>
  );
}

/* ================================================================== */
/*  Bulk edit — apply a block/clear across a whole date range at once   */
/* ================================================================== */
function BulkEdit({ config, slots, onApply }) {
  const lastDate = config.numDays > 0 ? addDays(config.startDate, config.numDays - 1) : config.startDate;
  const [from, setFrom] = useState(config.startDate);
  const [to, setTo] = useState(lastDate);
  const [dows, setDows] = useState(() => new Set([1, 2, 3, 4, 5])); // default: weekdays
  const [todFrom, setTodFrom] = useState(config.startHour);
  const [todTo, setTodTo] = useState(config.endHour);

  useEffect(() => {
    setFrom(config.startDate);
    setTo(lastDate);
    setTodFrom(config.startHour);
    setTodTo(config.endHour);
  }, [config.startDate, config.numDays, config.startHour, config.endHour]); // eslint-disable-line

  const matching = useMemo(() => {
    const fromMin = todFrom * 60, toMin = todTo * 60;
    return slots
      .filter((s) => s.iso >= from && s.iso <= to && dows.has(s.dow) && s.startMin >= fromMin && s.startMin <= toMin - 1)
      .map((s) => s.key);
  }, [slots, from, to, dows, todFrom, todTo]);

  const toggleDow = (d) => setDows((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });

  return (
    <div className="cl-filters cl-bulk">
      <p className="cl-help" style={{ marginBottom: 4 }}>
        Mark a repeating pattern across the whole range in one go — e.g. weekdays, 9 AM–5 PM, for the next few months.
      </p>
      <div className="cl-fgrid">
        <label className="cl-field">
          <span>From date</span>
          <input type="date" className="cl-input" value={from} min={config.startDate} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="cl-field">
          <span>To date</span>
          <input type="date" className="cl-input" value={to} min={from} max={lastDate} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="cl-field">
          <span>Time from</span>
          <select className="cl-input" value={todFrom} onChange={(e) => setTodFrom(+e.target.value)}>
            {hourRange(config.startHour, config.endHour).map((h) => <option key={h} value={h}>{fmtTime(h * 60)}</option>)}
          </select>
        </label>
        <label className="cl-field">
          <span>Time to</span>
          <select className="cl-input" value={todTo} onChange={(e) => setTodTo(+e.target.value)}>
            {hourRange(config.startHour + 1, config.endHour + 1).map((h) => (
              <option key={h} value={h}>{h === 24 ? "12:00 AM" : fmtTime(h * 60)}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="cl-frow">
        <div className="cl-field">
          <span>Days of week</span>
          <div className="cl-dows">
            {DOW1.map((lbl, d) => (
              <button key={d} className={"cl-dow" + (dows.has(d) ? " on" : "")} onClick={() => toggleDow(d)} title={DOW[d]}>{lbl}</button>
            ))}
          </div>
        </div>
        <div className="cl-field" style={{ flex: 1, minWidth: 160 }}>
          <span>Matches</span>
          <div className="cl-bulk-count mono">{matching.length} time {matching.length === 1 ? "slot" : "slots"}</div>
        </div>
        <div className="cl-bulk-actions">
          <button className="cl-btn" disabled={!matching.length} onClick={() => onApply(matching, "block")}>Block these</button>
          <button className="cl-btn ghost" disabled={!matching.length} onClick={() => onApply(matching, "clear")}>Clear these</button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Name gate                                                          */
/* ================================================================== */
function NameGate({ people, nameDraft, setNameDraft, onJoin, onClaim }) {
  return (
    <section className="cl-gate">
      <div className="cl-gate-card">
        <div className="cl-eyebrow">Step one</div>
        <h2>Add your name to start blocking times</h2>
        <p>Your name labels the times you can't make. You can change or remove it later.</p>
        <div className="cl-gate-row">
          <input
            className="cl-input"
            placeholder="e.g. Jordan"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && nameDraft.trim()) onJoin(nameDraft.trim()); }}
            autoFocus
          />
          <button className="cl-btn" disabled={!nameDraft.trim()} onClick={() => onJoin(nameDraft.trim())}>
            Start
          </button>
        </div>
        {people.length > 0 && (
          <div className="cl-gate-claim">
            <div className="cl-eyebrow">Already added on another device?</div>
            <div className="cl-claimrow">
              {people.map((p) => (
                <button key={p.id} className="cl-chip claimable" onClick={() => onClaim(p)}>
                  This is {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ================================================================== */
/*  Find view                                                          */
/* ================================================================== */
function FindView({ slots, people, config }) {
  const lastDate = config.numDays > 0 ? addDays(config.startDate, config.numDays - 1) : config.startDate;
  const [from, setFrom] = useState(config.startDate);
  const [to, setTo] = useState(lastDate);
  const [dows, setDows] = useState(() => new Set([0, 1, 2, 3, 4, 5, 6]));
  const [todFrom, setTodFrom] = useState(config.startHour);
  const [todTo, setTodTo] = useState(config.endHour);
  const [threshold, setThreshold] = useState(100);
  const [sortBy, setSortBy] = useState("avail");
  const [sortDir, setSortDir] = useState("desc");
  const [open, setOpen] = useState(() => new Set());

  useEffect(() => {
    setFrom(config.startDate);
    setTo(lastDate);
    setTodFrom(config.startHour);
    setTodTo(config.endHour);
  }, [config.startDate, config.numDays, config.startHour, config.endHour]); // eslint-disable-line

  const peopleSets = useMemo(() => people.map((p) => ({ name: p.name, set: new Set(p.unavailable) })), [people]);
  const total = people.length;

  const results = useMemo(() => {
    const out = [];
    for (const s of slots) {
      if (s.iso < from || s.iso > to) continue;
      if (!dows.has(s.dow)) continue;
      if (s.startMin < todFrom * 60 || s.startMin > todTo * 60 - 1) continue;
      const busy = peopleSets.filter((p) => p.set.has(s.key));
      const avail = total - busy.length;
      const pct = total > 0 ? avail / total : 1;
      if (pct * 100 + 1e-9 < threshold) continue;
      out.push({ ...s, busy, avail, pct });
    }
    out.sort((a, b) => {
      if (sortBy === "avail") {
        if (b.pct !== a.pct) return sortDir === "desc" ? b.pct - a.pct : a.pct - b.pct;
        return a.iso === b.iso ? a.startMin - b.startMin : a.iso < b.iso ? -1 : 1;
      }
      const cmp = a.iso === b.iso ? a.startMin - b.startMin : a.iso < b.iso ? -1 : 1;
      return sortDir === "desc" ? -cmp : cmp;
    });
    return out;
  }, [slots, from, to, dows, todFrom, todTo, threshold, sortBy, sortDir, peopleSets, total]);

  const toggleDow = (d) => setDows((prev) => { const n = new Set(prev); n.has(d) ? n.delete(d) : n.add(d); return n; });
  const toggleOpen = (k) => setOpen((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });

  return (
    <section className="cl-panel">
      <div className="cl-filters">
        <div className="cl-fgrid">
          <label className="cl-field">
            <span>From</span>
            <input type="date" className="cl-input" value={from} min={config.startDate} max={to} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="cl-field">
            <span>To</span>
            <input type="date" className="cl-input" value={to} min={from} max={lastDate} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className="cl-field">
            <span>Earliest</span>
            <select className="cl-input" value={todFrom} onChange={(e) => setTodFrom(+e.target.value)}>
              {hourRange(config.startHour, config.endHour).map((h) => <option key={h} value={h}>{fmtTime(h * 60)}</option>)}
            </select>
          </label>
          <label className="cl-field">
            <span>Latest</span>
            <select className="cl-input" value={todTo} onChange={(e) => setTodTo(+e.target.value)}>
              {hourRange(config.startHour + 1, config.endHour + 1).map((h) => (
                <option key={h} value={h}>{h === 24 ? "12:00 AM" : fmtTime(h * 60)}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="cl-frow">
          <div className="cl-field">
            <span>Days of week</span>
            <div className="cl-dows">
              {DOW1.map((lbl, d) => (
                <button key={d} className={"cl-dow" + (dows.has(d) ? " on" : "")} onClick={() => toggleDow(d)} title={DOW[d]}>{lbl}</button>
              ))}
            </div>
          </div>

          <div className="cl-field cl-grow">
            <span>Minimum availability · <b className="mono">{threshold}%</b> {threshold === 100 ? "(everyone free)" : ""}</span>
            <input type="range" min="0" max="100" step="5" value={threshold} onChange={(e) => setThreshold(+e.target.value)} className="cl-range" />
          </div>

          <div className="cl-field">
            <span>Sort</span>
            <div className="cl-sortrow">
              <select className="cl-input" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                <option value="avail">Availability</option>
                <option value="time">Date &amp; time</option>
              </select>
              <button className="cl-icon" onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))} title="Flip direction">
                {sortDir === "desc" ? "↓" : "↑"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="cl-resulthead mono">
        {total === 0
          ? "No one has blocked any times yet"
          : `${results.length} matching ${results.length === 1 ? "slot" : "slots"}${results.length > MAX_RESULTS ? ` · showing first ${MAX_RESULTS}` : ""}`}
      </div>

      {total === 0 ? (
        <div className="cl-empty">Head to <b>Block my times</b> and add a name so there's something to search.</div>
      ) : results.length === 0 ? (
        <div className="cl-empty">Nothing matches these filters. Try widening the dates, the time window, or lowering the availability threshold.</div>
      ) : (
        <ul className="cl-results">
          {results.slice(0, MAX_RESULTS).map((r) => {
            const isOpen = open.has(r.key);
            return (
              <li key={r.key} className="cl-result">
                <button className="cl-result-main" onClick={() => r.busy.length && toggleOpen(r.key)} style={{ cursor: r.busy.length ? "pointer" : "default" }}>
                  <span className="cl-r-when">
                    <span className="cl-r-date mono">{fmtDay(r.iso)}</span>
                    <span className="cl-r-time mono">{fmtTime(r.startMin)} – {fmtTime(r.endMin)}</span>
                  </span>
                  <span className="cl-r-bar">
                    <span className="cl-r-fill" style={{ width: `${r.pct * 100}%`, background: heat(r.pct) }} />
                  </span>
                  <span className="cl-r-num">
                    <b className="mono">{Math.round(r.pct * 100)}%</b>
                    <span className="cl-r-count mono">{r.avail}/{total} free</span>
                  </span>
                  <span className="cl-r-caret">{r.busy.length ? (isOpen ? "−" : "+") : ""}</span>
                </button>
                {isOpen && r.busy.length > 0 && (
                  <div className="cl-busy">
                    <span className="cl-busy-lbl mono">busy:</span>
                    {r.busy.map((b, i) => <span key={i} className="cl-busy-name">{b.name}</span>)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {results.length > MAX_RESULTS && (
        <div className="cl-note" style={{ marginTop: 10 }}>
          {results.length - MAX_RESULTS} more match. Narrow the date range, time window, or raise the availability threshold to see them.
        </div>
      )}
    </section>
  );
}

const MAX_RESULTS = 400;

function hourRange(a, b) {
  const out = [];
  for (let h = a; h <= b; h++) out.push(h);
  return out;
}

/* ================================================================== */
/*  Settings modal                                                     */
/* ================================================================== */
function SettingsModal({ config, people, onSave, onClose, onRemove, onReset, onNewPoll }) {
  const [d, setD] = useState(config);
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (patch) => setD((p) => ({ ...p, ...patch }));

  const apply = () => {
    const clean = {
      ...d,
      numDays: Math.max(1, Math.min(366, Math.round(d.numDays) || 1)),
      startHour: Math.max(0, Math.min(23, d.startHour)),
      endHour: Math.max(1, Math.min(24, d.endHour)),
      slotMinutes: [15, 30, 60].includes(d.slotMinutes) ? d.slotMinutes : 60,
      title: d.title.trim() || "Untitled availability",
    };
    if (clean.endHour <= clean.startHour) clean.endHour = clean.startHour + 1;
    onSave(clean);
    onClose();
  };

  return (
    <div className="cl-modal-bg" onClick={onClose}>
      <div className="cl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cl-modal-head">
          <h2>Settings</h2>
          <button className="cl-icon" onClick={onClose}>Close</button>
        </div>

        <label className="cl-field">
          <span>Event name</span>
          <input className="cl-input" value={d.title} onChange={(e) => set({ title: e.target.value })} />
        </label>

        <div className="cl-fgrid">
          <label className="cl-field">
            <span>Start date</span>
            <input type="date" className="cl-input" value={d.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </label>
          <label className="cl-field">
            <span>Number of days</span>
            <input type="number" min="1" max="366" className="cl-input" value={d.numDays} onChange={(e) => set({ numDays: +e.target.value })} />
          </label>
          <label className="cl-field">
            <span>Day starts</span>
            <select className="cl-input" value={d.startHour} onChange={(e) => set({ startHour: +e.target.value })}>
              {hourRange(0, 23).map((h) => <option key={h} value={h}>{fmtTime(h * 60)}</option>)}
            </select>
          </label>
          <label className="cl-field">
            <span>Day ends</span>
            <select className="cl-input" value={d.endHour} onChange={(e) => set({ endHour: +e.target.value })}>
              {hourRange(1, 24).map((h) => <option key={h} value={h}>{h === 24 ? "12:00 AM" : fmtTime(h * 60)}</option>)}
            </select>
          </label>
          <label className="cl-field">
            <span>Slot length</span>
            <select className="cl-input" value={d.slotMinutes} onChange={(e) => set({ slotMinutes: +e.target.value })}>
              <option value={15}>15 min</option>
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
            </select>
          </label>
        </div>
        <p className="cl-note">Ranges up to a year are supported — the grid pages through a few weeks at a time. Changing the grid keeps everyone's existing marks that still fall inside it.</p>

        {people.length > 0 && (
          <div className="cl-manage">
            <div className="cl-eyebrow">Participants</div>
            {people.map((p) => (
              <div key={p.id} className="cl-manage-row">
                <span>{p.name} <b className="mono">· {p.unavailable.length} blocked</b></span>
                <button className="cl-link danger" onClick={() => onRemove(p.id)}>Remove</button>
              </div>
            ))}
          </div>
        )}

        <div className="cl-manage">
          <div className="cl-eyebrow">This poll</div>
          <div className="cl-manage-row">
            <span>See all polls or start a new one<br /><small style={{ color: "var(--muted)" }}>Opens the group home page. This poll stays where it is.</small></span>
            <button className="cl-link" onClick={onNewPoll}>All polls →</button>
          </div>
        </div>

        <div className="cl-modal-foot">
          {!confirmReset ? (
            <button className="cl-link danger" onClick={() => setConfirmReset(true)}>Reset everything (clear this poll)</button>
          ) : (
            <span className="cl-confirm">
              Delete all people and marks in this poll? <button className="cl-link danger" onClick={onReset}>Yes, reset</button>
              <button className="cl-link" onClick={() => setConfirmReset(false)}>cancel</button>
            </span>
          )}
          <div style={{ flex: 1 }} />
          <button className="cl-btn ghost" onClick={onClose}>Cancel</button>
          <button className="cl-btn" onClick={apply}>Save settings</button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Styles                                                             */
/* ================================================================== */
function Style() {
  return (
    <style>{`
    .cl-root{
      --paper:#e9ebef; --card:#ffffff; --ink:#14161c; --muted:#6b7280;
      --line:#d3d8de; --line-soft:#e5e8ec; --mine:#23262f; --accent:#3b3ae0; --accent-soft:#e9e9fb;
      --gutter:74px;
      --mono:ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace;
      --ui:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
      font-family:var(--ui); color:var(--ink); background:var(--paper);
      max-width:1080px; margin:0 auto; padding:22px 20px 60px;
    }
    .cl-root *{box-sizing:border-box;}
    .mono{font-family:var(--mono); font-variant-numeric:tabular-nums;}
    .cl-boot{padding:80px 0; text-align:center; color:var(--muted); font-family:var(--mono);}
    .cl-eyebrow{font-family:var(--mono); font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:var(--muted);}

    .cl-head{display:flex; align-items:flex-start; gap:16px; justify-content:space-between; margin-bottom:14px; flex-wrap:wrap;}
    .cl-title{font-size:30px; line-height:1.05; font-weight:760; letter-spacing:-.02em; margin:3px 0 6px;}
    .cl-sub{font-size:13px; color:var(--muted);}
    .cl-dot{margin:0 8px; color:var(--line);}
    .cl-headbtns{display:flex; gap:8px; flex-shrink:0; flex-wrap:wrap;}

    .cl-icon{font-family:var(--mono); font-size:12px; letter-spacing:.02em; padding:7px 12px; border:1px solid var(--line);
      background:var(--card); color:var(--ink); border-radius:8px; cursor:pointer;}
    .cl-icon:hover{border-color:var(--ink);}
    .cl-icon.primary{background:var(--accent); border-color:var(--accent); color:#fff;}
    .cl-icon.primary:hover{background:#2f2ed0; border-color:#2f2ed0;}

    .cl-who{display:flex; flex-wrap:wrap; gap:7px; margin-bottom:14px; padding:12px; background:var(--card);
      border:1px solid var(--line-soft); border-radius:12px;}
    .cl-empty-inline{color:var(--muted); font-size:13px;}
    .cl-chip{display:inline-flex; align-items:center; gap:4px; font-size:12px; padding:5px 6px 5px 11px;
      background:var(--paper); border:1px solid var(--line); border-radius:999px;}
    .cl-chip.is-me{background:var(--accent-soft); border-color:#c7c7f5;}
    .cl-chip b{color:var(--muted); font-weight:600;}
    .cl-chip-x{border:none; background:none; cursor:pointer; color:var(--muted); font-size:15px; line-height:1; padding:0 3px; border-radius:50%;}
    .cl-chip-x:hover{color:#c0392b;}

    .cl-tabs{display:flex; align-items:center; gap:4px; border-bottom:1.5px solid var(--line); margin-bottom:18px;}
    .cl-tab{font-family:var(--ui); font-size:14px; font-weight:600; padding:10px 14px; border:none; background:none;
      color:var(--muted); cursor:pointer; border-bottom:2.5px solid transparent; margin-bottom:-1.5px;}
    .cl-tab.on{color:var(--ink); border-bottom-color:var(--accent);}
    .cl-save{margin-left:auto; font-size:12px; color:var(--muted); padding-right:4px;}

    .cl-panel{animation:fade .2s ease;}
    @keyframes fade{from{opacity:0; transform:translateY(3px);} to{opacity:1; transform:none;}}

    .cl-blockbar{display:flex; align-items:flex-start; gap:16px; justify-content:space-between; flex-wrap:wrap; margin-bottom:8px;}
    .cl-help{font-size:13.5px; color:var(--muted); max-width:60ch; line-height:1.5; margin:0;}
    .cl-help b{color:var(--ink);}
    .cl-blockbar-actions{display:flex; align-items:center; gap:14px; flex-wrap:wrap;}
    .cl-icon:disabled{opacity:.4; cursor:default;}
    .cl-icon:disabled:hover{border-color:var(--line);}
    .cl-toggle{display:flex; align-items:center; gap:7px; font-size:13px; color:var(--muted); white-space:nowrap;}

    .cl-legend{display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin:10px 0 12px; font-size:12px; color:var(--muted);}
    .cl-lg{display:inline-flex; align-items:center; gap:6px;}
    .sw{width:14px; height:14px; border-radius:3px; display:inline-block; border:1px solid var(--line);}
    .sw-mine{background:var(--mine); border-color:var(--mine);}
    .sw-oth{background:hsl(8 55% 72%);}
    .cl-link{border:none; background:none; color:var(--accent); cursor:pointer; font:inherit; padding:0; text-decoration:underline; text-underline-offset:2px;}
    .cl-link.danger{color:#c0392b;}

    .cl-bulk{margin-bottom:14px;}
    .cl-bulk-count{font-size:15px; color:var(--ink); padding-top:2px;}
    .cl-bulk-actions{display:flex; gap:8px; align-items:flex-end;}
    .cl-gridnav{display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:10px;}
    .cl-gridnav-move{display:flex; align-items:center; gap:8px; flex-wrap:wrap;}
    .cl-gridnav-range{font-size:13px; color:var(--ink); min-width:180px; text-align:center;}
    .cl-gridnav-size{display:flex; align-items:center; gap:5px; font-size:11px; color:var(--muted);}

    .cl-gridwrap{overflow-x:auto; border:1px solid var(--line); border-radius:12px; background:var(--card); -webkit-overflow-scrolling:touch;}
    .cl-grid{display:grid; min-width:max-content;}
    .cl-corner{position:sticky; left:0; z-index:3; background:var(--card); border-right:1px solid var(--line); border-bottom:1px solid var(--line);}
    .cl-colh{padding:8px 4px; text-align:center; border-bottom:1px solid var(--line); border-left:1px solid var(--line-soft);
      display:flex; flex-direction:column; align-items:center; gap:0; line-height:1.15; font-size:11px; color:var(--muted); position:sticky; top:0; background:var(--card); z-index:2;}
    .cl-colh b{font-size:15px; color:var(--ink); font-weight:700;}
    .cl-colh .cl-mon{font-size:10px;}
    .cl-colh.wk{background:#f3f2f6;}
    .cl-rowh{position:sticky; left:0; z-index:2; background:var(--card); border-right:1px solid var(--line); border-bottom:1px solid var(--line-soft);
      padding:0 8px; font-size:11px; color:var(--muted); display:flex; align-items:center; justify-content:flex-end; white-space:nowrap;}
    .cl-cell{height:30px; border:none; border-left:1px solid var(--line-soft); border-bottom:1px solid var(--line-soft);
      background:var(--card); cursor:pointer; padding:0; position:relative; touch-action:none; transition:background .04s;}
    .cl-cell:hover{background:#eceaf9; box-shadow:inset 0 0 0 1.5px var(--accent);}
    .cl-cell.mine{background:var(--mine); border-left-color:var(--mine);}
    .cl-cell.mine:hover{background:#3a3d4d;}
    .cl-cell:focus-visible{outline:2px solid var(--accent); outline-offset:-2px; z-index:1;}
    .cl-othn{position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:10px; color:#8a3b2e; pointer-events:none;}

    .cl-gate{display:flex; justify-content:center; padding:24px 0;}
    .cl-gate-card{background:var(--card); border:1px solid var(--line); border-radius:16px; padding:30px; max-width:520px; width:100%;}
    .cl-gate-card h2{font-size:22px; letter-spacing:-.01em; margin:8px 0 6px;}
    .cl-gate-card p{color:var(--muted); font-size:14px; margin:0 0 18px; line-height:1.5;}
    .cl-gate-row{display:flex; gap:8px;}
    .cl-gate-claim{margin-top:22px; padding-top:18px; border-top:1px solid var(--line-soft);}
    .cl-claimrow{display:flex; flex-wrap:wrap; gap:7px; margin-top:8px;}
    .cl-chip.claimable{cursor:pointer; padding:6px 12px;}
    .cl-chip.claimable:hover{border-color:var(--accent); color:var(--accent);}

    .cl-input{font-family:var(--ui); font-size:14px; padding:9px 11px; border:1px solid var(--line); border-radius:9px;
      background:var(--card); color:var(--ink); width:100%;}
    .cl-input:focus{outline:none; border-color:var(--accent); box-shadow:0 0 0 3px var(--accent-soft);}
    .cl-btn{font-family:var(--ui); font-size:14px; font-weight:600; padding:9px 18px; border:none; border-radius:9px;
      background:var(--accent); color:#fff; cursor:pointer; white-space:nowrap;}
    .cl-btn:hover{background:#2f2ed0;} .cl-btn:disabled{opacity:.4; cursor:default;}
    .cl-btn.ghost{background:var(--card); color:var(--ink); border:1px solid var(--line);}
    .cl-btn.ghost:hover{background:var(--paper);}

    .cl-filters{background:var(--card); border:1px solid var(--line-soft); border-radius:14px; padding:16px; margin-bottom:16px;}
    .cl-fgrid{display:grid; grid-template-columns:repeat(4,1fr); gap:12px;}
    .cl-frow{display:flex; gap:20px; flex-wrap:wrap; margin-top:14px; align-items:flex-end;}
    .cl-field{display:flex; flex-direction:column; gap:6px;}
    .cl-field>span{font-size:11px; letter-spacing:.05em; text-transform:uppercase; color:var(--muted); font-family:var(--mono);}
    .cl-field.cl-grow, .cl-grow{flex:1; min-width:180px;}
    .cl-dows{display:flex; gap:4px;}
    .cl-dow{width:32px; height:32px; border:1px solid var(--line); background:var(--card); border-radius:7px; cursor:pointer;
      font-family:var(--mono); font-size:12px; color:var(--muted);}
    .cl-dow.on{background:var(--ink); color:#fff; border-color:var(--ink);}
    .cl-range{width:100%; accent-color:var(--accent);}
    .cl-sortrow{display:flex; gap:6px;} .cl-sortrow .cl-input{width:auto;}

    .cl-resulthead{font-size:12px; color:var(--muted); margin:0 2px 10px; letter-spacing:.02em;}
    .cl-empty{background:var(--card); border:1px dashed var(--line); border-radius:12px; padding:34px; text-align:center;
      color:var(--muted); font-size:14px;}
    .cl-results{list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:5px;}
    .cl-result{background:var(--card); border:1px solid var(--line-soft); border-radius:10px; overflow:hidden;}
    .cl-result-main{width:100%; display:grid; grid-template-columns:210px 1fr 128px 22px; align-items:center; gap:14px;
      border:none; background:none; padding:11px 14px; text-align:left; font:inherit;}
    .cl-result-main:hover{background:#fafafc;}
    .cl-r-when{display:flex; flex-direction:column; gap:1px;}
    .cl-r-date{font-size:13px; font-weight:600; color:var(--ink);}
    .cl-r-time{font-size:12px; color:var(--muted);}
    .cl-r-bar{height:9px; background:var(--line-soft); border-radius:999px; overflow:hidden;}
    .cl-r-fill{display:block; height:100%; border-radius:999px;}
    .cl-r-num{text-align:right; display:flex; flex-direction:column; gap:1px;}
    .cl-r-num b{font-size:15px;}
    .cl-r-count{font-size:11px; color:var(--muted);}
    .cl-r-caret{font-family:var(--mono); color:var(--muted); text-align:center; font-size:15px;}
    .cl-busy{display:flex; flex-wrap:wrap; align-items:center; gap:6px; padding:0 14px 12px 14px;}
    .cl-busy-lbl{font-size:11px; color:var(--muted); text-transform:uppercase; letter-spacing:.08em;}
    .cl-busy-name{font-size:12px; background:#f6e9e7; color:#8a3b2e; padding:2px 9px; border-radius:999px;}

    .cl-modal-bg{position:fixed; inset:0; background:rgba(20,22,28,.44); display:flex; align-items:flex-start;
      justify-content:center; padding:40px 16px; z-index:50; overflow-y:auto;}
    .cl-modal{background:var(--card); border-radius:16px; width:100%; max-width:560px; padding:24px; box-shadow:0 24px 60px rgba(0,0,0,.24);}
    .cl-modal-head{display:flex; align-items:center; justify-content:space-between; margin-bottom:18px;}
    .cl-modal-head h2{font-size:20px; margin:0;}
    .cl-modal .cl-field{margin-bottom:14px;}
    .cl-note{font-size:12px; color:var(--muted); margin:2px 0 6px;}
    .cl-manage{border-top:1px solid var(--line-soft); margin-top:8px; padding-top:14px;}
    .cl-manage-row{display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:14px;}
    .cl-manage-row b{color:var(--muted); font-weight:600;}
    .cl-modal-foot{display:flex; align-items:center; gap:10px; margin-top:20px; padding-top:16px; border-top:1px solid var(--line-soft); flex-wrap:wrap;}
    .cl-confirm{font-size:13px; color:var(--ink); display:flex; gap:8px; align-items:center;}

    @media (max-width:680px){
      .cl-fgrid{grid-template-columns:1fr 1fr;}
      .cl-result-main{grid-template-columns:1fr 96px 20px; gap:10px;}
      .cl-r-bar{display:none;}
      .cl-title{font-size:24px;}
    }
    @media (prefers-reduced-motion:reduce){ .cl-panel{animation:none;} .cl-cell{transition:none;} }
    `}</style>
  );
}
