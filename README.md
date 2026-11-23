# Wizard Duel — power-card playtest and local research console

Next.js on Vercel, Supabase for authoritative multiplayer state, and a separate localhost-only analysis application. The power-v2 rules implement the saved 12-HP, Power 1–5 game. Foundation/recovery-counter experiments are not included.

## Local setup

Requires Node 22.14+.

1. Run `npm ci`.
2. Copy `.env.local.example` to `.env.local` and fill in the Supabase URL, publishable key (`sb_publishable_…`), and **server-only secret key** (`sb_secret_…` as `SUPABASE_SECRET_KEY`; legacy `service_role` JWT via `SUPABASE_SERVICE_ROLE_KEY` still works).
3. In a separate test Supabase project, apply migrations `001` through `004` in order, or run `supabase/APPLY_IN_SQL_EDITOR.sql` **once on a fresh database**. For an existing database already at migration 003, apply only `004_power_v2_analytics.sql`. The concatenated fresh-install script is not an upgrade/reapply script.
4. Run `npm run dev`; open the game on two separate browsers/devices.
5. Run `npm run analytics`; open **http://127.0.0.1:4310** on this computer.

For a dashboard preview with synthetic records and no credentials: `npm run analytics:demo`. Demo records exist only in memory; they are not written to Supabase.

Never place the secret / service-role key in a `NEXT_PUBLIC_*` variable. Prefer Supabase’s new secret key over the legacy `service_role` JWT ([migration guide](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)). It is used by the server resolution handler and the standalone analytics process; it is never returned to either browser. Keep `.env.local` untracked. The analytics process binds to 127.0.0.1, rejects foreign Host/Origin headers, and has no public Next.js route. Do not proxy or deploy it.

## Multiplayer behavior

Create/join a room, privately bid power, then alternate attacks and defenses. Empty hands automatically recover before each exchange. When someone owns Advantage at exchange start, that owner chooses refresh or keep **before** any attack commitment. Only that original owner may subsequently spend a combat boost, and only if they did not refresh. Spending passes Advantage immediately; resolution can award it again.

The database derives the attack school. The defender sees it in **Inspect**, while spell and power remain hidden until resolution. Delayed damage survives the owner's defending turn and arrives on their next attack, including Gather or another Delayed. Partial bonuses expire on the next matching role. Victory and Reversal damage are simultaneous.

`wd_command(request_id, token, command, arguments)` is the only public game-write gateway. Supported commands are create, join, reconnect, bid, refresh, and commit. Reusing an ID and identical arguments returns the original response; reusing it with different arguments is rejected. Clients retry transient transport failures with the same ID. Invalid commands roll back without an event or receipt.

`wd_get_match_public(room_code)` returns a filtered snapshot. Raw table access and internal helper execution are revoked from player roles. The browser polls the snapshot every four seconds; private tables are not broadcast through Realtime. `/api/resolve` authenticates the seat token, fetches private inputs using server credentials, runs the engine, and applies the result through a server-only RPC. Concurrent resolution is serialized by a match-state lock and cannot apply an exchange twice.

Legacy matches retain their version and cannot submit new power-v2 commands; create a new game after upgrading. New matches have immutable ruleset `power-v2`, engine `power-engine-2`, and event schema 1. Old clients cannot bypass the new command gateway.

## Research records and interpretation

The database writes ordered game records atomically with accepted actions. Each resolved exchange includes replay inputs, engine output, and persisted player state. Initial/phase snapshots, opening bids, refresh decisions, school declarations, Advantage, power changes, preparations, and stored damage are retained. Raw research tables are private. `wd_research_snapshot()` is service-role-only and returns one consistent PostgreSQL snapshot for analysis.

A random browser ID links a tester's games without an account. Another browser, device, or cleared storage creates another identity; two people sharing a browser are indistinguishable. Names, room codes, reconnect credentials, IP addresses, and browser fingerprints are not included in research exports. Names remain in operational match data for the game UI. The hosting provider may separately retain normal service logs.

Optional automatic telemetry records Inspect opens, visibility/recent-input activity, and bounded action-error codes. It contains no free text and never blocks play. Active time counts 15-second intervals while the page is visible and input occurred within the last minute. It is approximate; missing telemetry does not mean inactivity. Multiple tabs can inflate active time. Client errors and activity are not authoritative game events.

Dashboard filters apply to both metrics and downloads: rules version, date, tester, and match status. By default only power-v2 is included. Terminal draws are separate from decisive wins. Stale means no accepted game action for 24 hours; it does not terminate the game. Game duration begins when the second player joins; decision intervals use server phase-entry timestamps and include network delay and interruptions. Unfinished games are excluded from terminal outcome denominators.

Learning views compare the early and later halves of a tester's games **within the current filter**. Spell associations are descriptive and selection-biased, not causal balance estimates. Automatic records cannot establish enjoyment, confusion, or deliberate misdirection. Version comparisons must be kept separate.

Downloads: matches, exchanges, events, and telemetry CSV; complete replay JSON. Unresolved opening bids are excluded and pending-bid snapshots are reduced to readiness flags. Completed exchanges are checked against the matching engine and stored state; unsupported legacy replays are not claimed verified. CSV cells are quoted and spreadsheet formula prefixes escaped.

Records are retained for longitudinal analysis. For owner-operated deletion, remove a match's `wd_telemetry` and `wd_records` rows before deleting its operational match row; remove relevant request receipts separately. Back up exports before maintenance, and do not run destructive maintenance against active games.

## Validation and rollout

```text
npm test
npm run typecheck
npm run build
```

The suite runs the actual PostgreSQL migrations/RPCs in embedded PostgreSQL (PGlite), including access checks, duplicate requests, multi-exchange state, deterministic replay, and analytics/export fixtures. Since PGlite does not ship pgcrypto, tests use PostgreSQL's built-in SHA-256 through the same digest signature; production uses Supabase pgcrypto. Tests do not emulate Supabase's PostgREST gateway or Realtime infrastructure.

Before production rollout:

1. Apply migration 004 in a separate Supabase test project and configure server credentials there.
2. Run a two-device game through bidding, refresh, Inspect, Delayed, reconnect, and game completion. Confirm dashboard replay and exports for that match.
3. Back up the production database; deploy the migration and matching application together during a playtest pause. Existing games should be restarted.
4. Monitor resolution errors, unfinished/stale games, and replay failures. Keep version cohorts separate. If rollback is needed, restore the database backup and matching app together; do not expose the old public result-application RPC against the corrected database.

No production migration, deployment, or live credential setup is performed by local validation.
