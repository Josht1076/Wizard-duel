# Wizard Duel (playtest)

Invite-only two-phone web playtest: Next.js (App Router) + TypeScript on Vercel, Supabase for rooms/realtime/logs.

## Local run

```bash
cp .env.local.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

- **Create Game / Join Game** — client-local stubs that store a guest seat in `localStorage` and navigate to `/duel`.
- **Solo duel UI** — ported mockup with attacker/defender preview and local resolve via `lib/rules`.

```bash
npm run build   # production build
npm start       # serve the build
```

## Rules engine

Authoritative exchange resolution lives in `src/lib/rules/`. Unit tests cover:

- Full @ Power 5 vs Full @ Power 3
- Feint vs Full (Advantage to attacker)
- Reversal retaliation

```bash
npm test
```

## Supabase

1. Create a project (or use the playtest project).
2. Apply the migration in the SQL editor:

   `supabase/migrations/001_init.sql`

   Tables: `matches`, `match_players`, `match_state`, `commits`, `events`.

3. Put public keys in `.env.local` (see below). The browser client stub is `src/lib/supabase/client.ts`.

Realtime create/join/commit/resolve is **not wired yet** — schema + client stub only.

## Vercel env vars

Set these on the Vercel project (Production + Preview):

| Name | Notes |
|------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon / publishable key |

Do **not** put service-role keys in `NEXT_PUBLIC_*` vars. Server-only secrets (when added later) use non-public names.

## What’s stubbed vs real

| Piece | Status |
|-------|--------|
| Mockup duel UI | Real (ported, local resolve) |
| Create / Join screens | Stub (navigate + localStorage only) |
| Rules engine + tests | Real |
| Supabase schema SQL | Real (apply manually) |
| Supabase JS client | Stub (env-backed factory) |
| Two-phone realtime / server resolve | Not yet |
