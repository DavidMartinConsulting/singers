import React, { useEffect, useState } from "react";
import { supabaseReady, missingEnv } from "./supabaseClient";
import Clearings from "./Clearings.jsx";

/* Hash routing keeps this a plain static site — no server rewrite rules on
   any host. A room lives at:  https://your-site/#/e/<roomId>  */
function parseRoom() {
  const m = window.location.hash.match(/#\/e\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}
function newRoomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36)).join("").slice(0, 10);
}

export default function App() {
  const [room, setRoom] = useState(parseRoom);

  useEffect(() => {
    const on = () => setRoom(parseRoom());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  if (!supabaseReady) return <SetupNotice />;
  if (!room) return <Landing onCreate={() => { window.location.hash = `#/e/${newRoomId()}`; }} />;
  return <Clearings key={room} roomId={room} />;
}

/* ---------------- landing / create ---------------- */
function Landing({ onCreate }) {
  return (
    <div style={S.wrap}>
      <LandingStyle />
      <div className="lp">
        <div className="lp-eyebrow">Shared availability</div>
        <h1 className="lp-title">Clearings</h1>
        <p className="lp-lede">
          The inverse of a when-are-you-free poll. Everyone blocks out the times they <b>can't</b> make —
          then the app surfaces the openings where the group is free.
        </p>
        <button className="lp-btn" onClick={onCreate}>Create an availability poll</button>
        <p className="lp-note">
          You'll get a private link to share. Anyone with the link can add their name and mark their
          blocked times — no accounts, no sign-in.
        </p>
        <ol className="lp-how">
          <li><b>Create</b> a poll and send the link to your group.</li>
          <li>Everyone <b>blocks</b> the times they're busy on the shared grid.</li>
          <li><b>Find</b> the slots where everyone — or most people — is free.</li>
        </ol>
      </div>
    </div>
  );
}

/* ---------------- setup notice (env not configured) ---------------- */
function SetupNotice() {
  return (
    <div style={S.wrap}>
      <LandingStyle />
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
    </div>
  );
}

const S = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "32px 20px",
  },
};

function LandingStyle() {
  return (
    <style>{`
    .lp{background:#fff; border:1px solid #d3d8de; border-radius:18px; max-width:520px; width:100%;
      padding:36px 34px; font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; color:#14161c;}
    .mono{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size:.92em;}
    .lp-eyebrow{font-family:ui-monospace,Menlo,monospace; font-size:11px; letter-spacing:.16em;
      text-transform:uppercase; color:#6b7280;}
    .lp-title{font-size:34px; font-weight:780; letter-spacing:-.02em; margin:6px 0 14px;}
    .lp-lede{font-size:15px; line-height:1.6; color:#3a3f47; margin:0 0 22px;}
    .lp-lede b{color:#14161c;}
    .lp-btn{font-size:15px; font-weight:650; padding:12px 22px; border:none; border-radius:10px;
      background:#3b3ae0; color:#fff; cursor:pointer;}
    .lp-btn:hover{background:#2f2ed0;}
    .lp-note{font-size:13px; color:#6b7280; line-height:1.55; margin:16px 0 0;}
    .lp-how{margin:24px 0 0; padding:20px 0 0 20px; border-top:1px solid #e5e8ec; color:#3a3f47;
      font-size:14px; line-height:1.7;}
    .lp-how li{margin-bottom:4px;} .lp-how b{color:#14161c;}
    `}</style>
  );
}
