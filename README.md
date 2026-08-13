# Clearings

The inverse of When2Meet. Everyone blocks out the times they **can't** make on a
shared grid, and the app surfaces the openings where the group — or most of the
group — is free. Filter by date and time, sort by availability, and share a
single link.

- **No accounts.** Anyone with the event link can join and edit, exactly like When2Meet.
- **Live.** Everyone's grid updates in real time via Supabase.
- **Installable.** Works in any mobile browser and can be added to a phone home screen.

---

## What you need

- [Node.js](https://nodejs.org) 18 or newer (`node -v` to check).
- A free [Supabase](https://supabase.com) account for the database.

---

## 1. Install and run locally

```bash
npm install
cp .env.example .env      # you'll fill this in during step 2
npm run dev
```

Open the URL it prints (usually `http://localhost:5173`). Until the database
keys are set, you'll see a "Finish setup" screen — that's expected.

---

## 2. Set up the database (Supabase)

1. Go to [supabase.com](https://supabase.com), create a project, and wait for it
   to finish provisioning (about a minute).
2. In the left sidebar open **SQL Editor**, click **New query**, paste the entire
   contents of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**.
   This creates the tables, opens link-based access, and turns on realtime.
3. Open **Project Settings → API** and copy two values:
   - **Project URL**
   - the **anon / public** API key
4. Paste them into your `.env` file:

   ```
   VITE_SUPABASE_URL=https://your-project-ref.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```

5. Stop and restart `npm run dev` so it picks up the new variables.

You should now land on the "Create an availability poll" screen. Create one, and
you're running the full app locally.

> The anon key is meant to live in the client bundle — it isn't a secret.
> Access is governed by the row-level-security policies in `schema.sql`, not by
> hiding the key.

---

## 3. Put it on the web

The app is a static site, so any static host works. Here's the shortest path with
**Vercel** (Netlify and Cloudflare Pages are nearly identical):

1. Push this folder to a GitHub repository.
2. At [vercel.com](https://vercel.com), **Add New → Project**, and import the repo.
3. Vercel auto-detects Vite. Confirm:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Under **Environment Variables**, add the same two keys from step 2
   (`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`).
5. **Deploy.** You get an `https://…vercel.app` link. Every future `git push`
   redeploys automatically.

Because routing is hash-based (`/#/e/<id>`), you don't need any SPA rewrite rules.

---

## 4. Share it

1. Open your deployed link and click **Create an availability poll**.
2. Click **Copy share link** in the header and send it to your group (text,
   email, group chat, wherever).
3. Everyone opens the link, adds a name under **Block my times**, and shades the
   times they're busy. **Find open times** shows the openings, ranked.

Each event has its own unguessable id in the URL, so separate groups stay
separate. Bookmark an event link to come back to it.

---

## Add to a phone home screen

The app ships a web manifest, so it installs like an app:

- **iPhone/iPad (Safari):** Share → *Add to Home Screen*.
- **Android (Chrome):** menu → *Install app* / *Add to Home Screen*.

For a polished iOS icon, drop a 180×180 PNG at `public/apple-touch-icon.png` and
add `<link rel="apple-touch-icon" href="/apple-touch-icon.png" />` to
`index.html`. (Full offline support would need a service worker — not included,
since it mostly adds cache-busting headaches for a live-data app.)

---

## How it fits together

```
src/
  main.jsx          React entry point
  App.jsx           Hash routing, landing page, setup screen
  supabaseClient.js Creates the Supabase client from your .env
  db.js             All data access — the Supabase replacement for the
                    original artifact's window.storage
  Clearings.jsx     The whole UI: block grid, find view, settings
supabase/
  schema.sql        Run once in the Supabase SQL editor
```

Data model:

- **events** — one row per poll. `config` (a JSON blob) holds the date range,
  daily time window, and slot length.
- **participants** — one row per person, holding the list of slot keys they've
  marked as unavailable. Each browser only ever writes its own row, so
  simultaneous edits don't clobber each other.

A slot key looks like `2026-08-14T09:00`. "Available" is the default; a slot
counts against a person only if their row lists it.

---

## Notes and trade-offs

- **Link = access.** Anyone with an event link can view and edit it, including
  removing participants. That's the When2Meet model. If you need private or
  read-only events, add Supabase Auth and tighten the policies in `schema.sql`.
- **Identity is per device.** Your name is remembered in this browser's
  `localStorage`. On a new device, use the **"This is …"** button on the join
  screen to pick up your existing entry instead of creating a duplicate.
- **Free tiers change.** Supabase and the static hosts all have generous free
  tiers, but the exact limits shift over time — check current terms before you
  rely on them for anything large.

---

## Common issues

- **Stuck on "Finish setup":** `.env` is missing or the dev server wasn't
  restarted after editing it. On a host, the env vars weren't added to the
  project settings.
- **Changes don't sync between devices:** re-run `schema.sql` — the realtime
  `alter publication` lines at the bottom are what enable live updates.
- **"permission denied" / rows won't save:** the RLS policies didn't apply.
  Re-run `schema.sql`; it drops and recreates them safely.
