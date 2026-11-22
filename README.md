# Wizard Duel (playtest)

Invite-only two-phone web playtest: Next.js (App Router) + TypeScript on Vercel, Supabase for rooms, commits, realtime, and logs.

## Local run

```bash
cp .env.local.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) on two browsers (or two phones).

### Multiplayer flow

1. **Phone A — Create Game** → Supabase creates a 4-character room, seat A, and a reconnect token in `localStorage`.
2. **Phone B — Join Game** with that code → seat B; match enters the **opening bid**.
3. Both players bid one power card (higher attacks first; ties re-bid).
4. **Attack commit** (spell + power, optional Advantage spend) → school is declared publicly; commit stays hidden.
5. **Defense commit** → when both are in, phase becomes `resolve`.
6. Either client calls **`POST /api/resolve`**, which loads both commits via a token-gated RPC, runs `src/lib/rules`, and applies the result. Both UIs update over **Realtime** (with a short poll fallback).
7. Roles swap until someone hits 0 HP. Refresh the same browser to **reconnect** with the stored token.

Solo `/duel` without a room still runs the local mockup preview.

```bash
npm run build   # production build
npm start       # serve the build
```

## Supabase setup (required once)

Tables are **not** created until you apply SQL. This agent only has the publishable key — it cannot run DDL.

1. Open the Supabase project → **SQL Editor**.
2. Paste and run the entire file:

   [`supabase/APPLY_IN_SQL_EDITOR.sql`](supabase/APPLY_IN_SQL_EDITOR.sql)

   (concatenates `001_init.sql` + `002_rpc_and_rls.sql`)

3. Confirm RPCs exist under **Database → Functions** (`wd_create_match`, `wd_join_match`, `wd_submit_bid`, `wd_submit_commit`, `wd_fetch_resolve_bundle`, `wd_apply_resolution`, `wd_get_match_public`, …).
4. Under **Database → Publications**, ensure `matches`, `match_state`, `match_players`, and `commits` are in `supabase_realtime` (the migration tries to add them).

### Env vars

| Name | Where | Notes |
|------|--------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` + Vercel | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` + Vercel | Publishable / anon key |

**Service role key is not required** for this playtest slice. Mutations use `SECURITY DEFINER` RPCs that hash-check the reconnect token. Commits are not selectable until `revealed = true`.

Optional later: `SUPABASE_SERVICE_ROLE_KEY` would let you lock `wd_apply_resolution` / bundle fetch to a server-only path. Do **not** put a service-role key in `NEXT_PUBLIC_*`.

## Rules engine

Authoritative exchange resolution lives in `src/lib/rules/` and is invoked from `/api/resolve`.

```bash
npm test
```

## Security notes (playtest)

- Room codes are short; treat them as invite secrets.
- `match_players.reconnect_token_hash` must not be queried by the app (use RPCs / omit the column).
- Direct `INSERT`/`UPDATE` on tables is denied for `anon`; use RPCs.
- A client that knows a seat token could call `wd_apply_resolution` with a crafted payload — fine for trusted playtesters; tighten with a service-role-only apply path before any public launch.
