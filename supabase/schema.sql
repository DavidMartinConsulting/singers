-- Clearings — database schema
-- Paste this whole file into the Supabase SQL Editor and run it once.
-- Safe to re-run: it uses "if not exists" and drops/recreates policies.

-- One row per event ("room"). config holds the grid definition.
create table if not exists public.events (
  id         text primary key,
  config     jsonb not null,
  created_at timestamptz not null default now()
);

-- One row per participant, scoped to an event.
create table if not exists public.participants (
  id          uuid primary key,
  event_id    text not null references public.events(id) on delete cascade,
  name        text not null,
  unavailable jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now()
);

create index if not exists participants_event_idx on public.participants(event_id);

-- ------------------------------------------------------------------
-- Access model: "anyone with the link can view and edit."
-- There is no login, exactly like When2Meet. Security is the
-- unguessability of the event id in the URL. RLS is enabled with
-- permissive policies so the public anon key can read/write.
-- If you later add auth, tighten these policies.
-- ------------------------------------------------------------------
alter table public.events       enable row level security;
alter table public.participants enable row level security;

drop policy if exists "events_open"       on public.events;
drop policy if exists "participants_open" on public.participants;

create policy "events_open"
  on public.events       for all
  using (true) with check (true);

create policy "participants_open"
  on public.participants for all
  using (true) with check (true);

-- ------------------------------------------------------------------
-- Realtime: publish changes so every open browser updates live.
-- Wrapped so re-running the file doesn't error if already added.
-- ------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.events;
exception when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.participants;
exception when duplicate_object then null;
end $$;
