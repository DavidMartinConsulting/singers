import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// True only when both env vars are present. App.jsx shows a setup screen
// instead of crashing when they're missing.
export const supabaseReady = Boolean(url && key);

export const supabase = supabaseReady
  ? createClient(url, key, { realtime: { params: { eventsPerSecond: 5 } } })
  : null;

export const missingEnv = [
  !url && "VITE_SUPABASE_URL",
  !key && "VITE_SUPABASE_ANON_KEY",
].filter(Boolean);
