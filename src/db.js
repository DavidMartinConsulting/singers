import { supabase } from "./supabaseClient";

/* This module is the whole data layer. In the original artifact these calls
   went through window.storage; here they go to Supabase. The rest of the app
   only knows about the functions below. */

function toISO(dt) {
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function defaultConfig() {
  return {
    title: "Untitled availability",
    startDate: toISO(new Date()),
    numDays: 21,
    startHour: 8,
    endHour: 22,
    slotMinutes: 60,
  };
}

// Short, unguessable id for a new poll.
export function genId() {
  const b = new Uint8Array(8);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(36)).join("").slice(0, 10);
}

// Create a brand-new poll with a chosen title. Returns the new event row.
export async function createEvent(title) {
  const id = genId();
  const config = { ...defaultConfig(), title: (title || "").trim() || "Untitled availability" };
  const { data, error } = await supabase.from("events").insert({ id, config }).select().single();
  if (error) throw error;
  return data;
}

// Every poll in the database, newest first — this powers the home page.
export async function listEvents() {
  const { data, error } = await supabase
    .from("events")
    .select("id,config,created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// Delete a poll and (via ON DELETE CASCADE) all its participants.
export async function deleteEvent(id) {
  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) throw error;
}

/* Fetch an event, creating it with defaults if it doesn't exist yet.
   Create-on-demand keeps shared links robust: the first person to open a
   fresh link brings the room into being. */
export async function getOrCreateEvent(roomId) {
  const { data, error } = await supabase
    .from("events")
    .select("*")
    .eq("id", roomId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const config = defaultConfig();
  const { data: inserted, error: e2 } = await supabase
    .from("events")
    .insert({ id: roomId, config })
    .select()
    .single();

  // If two people opened the same new link at once, the insert can lose the
  // race — just read the winner's row.
  if (e2) {
    const retry = await supabase.from("events").select("*").eq("id", roomId).single();
    if (retry.error) throw retry.error;
    return retry.data;
  }
  return inserted;
}

export async function saveConfig(roomId, config) {
  const { error } = await supabase.from("events").update({ config }).eq("id", roomId);
  if (error) throw error;
}

export async function listParticipants(roomId) {
  const { data, error } = await supabase
    .from("participants")
    .select("id,name,unavailable,updated_at")
    .eq("event_id", roomId)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data || []).map((p) => ({ ...p, unavailable: p.unavailable || [] }));
}

export async function upsertParticipant(roomId, p) {
  const row = {
    id: p.id,
    event_id: roomId,
    name: p.name,
    unavailable: p.unavailable,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("participants").upsert(row);
  if (error) throw error;
}

export async function deleteParticipant(id) {
  const { error } = await supabase.from("participants").delete().eq("id", id);
  if (error) throw error;
}

export async function resetRoom(roomId) {
  await supabase.from("participants").delete().eq("event_id", roomId);
  await saveConfig(roomId, defaultConfig());
}

/* Live updates: fire onChange whenever anyone edits this room. Returns an
   unsubscribe function. */
export function subscribeRoom(roomId, onChange) {
  const channel = supabase
    .channel(`room:${roomId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "participants", filter: `event_id=eq.${roomId}` },
      onChange
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "events", filter: `id=eq.${roomId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
